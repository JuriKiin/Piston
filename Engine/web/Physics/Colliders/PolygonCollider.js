import { Bounds } from '../Bounds.js';
import { Vector2 } from '../Vector2.js';
import { Collider } from './Collider.js';
import { PolygonRenderer } from '../../PolygonRenderer.js';

export class PolygonCollider extends Collider {
    /**
     * Three ways to get a shape, in priority order:
     *  1. If the entity also has a PolygonRenderer, its vertices are used - read live every frame
     *     (see #currentLocalVertices), not copied once, so editing them (with the pen tool) keeps
     *     collision in sync automatically. This is how the generic `Polygon` entity works and is
     *     the intended way to build a custom shape.
     *  2. `new PolygonCollider(entity, vertices)` - an explicit array of {x,y}-like points in the
     *     entity's own local space, for a custom shape with no matching PolygonRenderer.
     *  3. `new PolygonCollider(entity, numPoints, width, height)` - the original axis-aligned
     *     rectangle shorthand every existing entity (Wall, Player, SandTrap) already uses.
     */
    constructor(entity, verticesOrNumPoints, width, height) {
        super(entity);

        if (Array.isArray(verticesOrNumPoints)) {
            this.setVertices(verticesOrNumPoints);
        } else {
            this.numPoints = verticesOrNumPoints ?? 4; //Default to 4 points (rectangle)
            // width/height are only a fallback for the rare case entity.transform.size isn't set
            // yet - #rectVertices() below reads the transform live, not these, on every call. They
            // used to be the only source, captured once here and never updated again, which meant
            // a Wall (or anything else built this way) resized after construction - by the
            // Inspector's Scale tool, or by applyEntityData restoring a saved size onto an entity
            // freshly built with buildEntitiesFromLevelData's no-args-then-restore sequence - kept
            // colliding at its original size while looking entirely different. Reading the
            // transform instead means there's nothing left to keep in sync.
            this.width = width ?? 10;
            this.height = height ?? 10;
            this.localVertices = null; // null = "generate a rectangle from transform.size" (see #rectVertices)
        }

        this.vertices = [];
        this.transformVertices = [];
        // Convex decomposition of a concave shape (see #convexLocalParts) - the one genuinely
        // non-trivial cost concave support adds, so it's cached rather than redone every frame.
        // Keyed by a content signature, not just left stale on the vertices array reference, since
        // a PolygonRenderer-driven shape is mutated in place (the Inspector's drag handles edit
        // renderer.vertices' elements directly) rather than ever being replaced wholesale.
        this._decomposeCache = null;
    }

    /**
     * Replaces this collider's shape with an arbitrary simple polygon - convex or concave. A
     * concave one collides correctly via convex decomposition under the hood (see
     * #convexLocalParts); nothing about calling this needs to know that happens.
     */
    setVertices(vertices) {
        if (vertices.length < 3) {
            throw new Error('PolygonCollider needs at least 3 vertices.');
        }
        this.localVertices = vertices.map(v => new Vector2(v.x, v.y));
        this.width = undefined;
        this.height = undefined;
        this._decomposeCache = null; // the old shape's cached decomposition no longer applies
    }

    /** True iff `vertices`, taken in order (either winding direction), describe a simple convex polygon. */
    static isConvex(vertices) {
        if (vertices.length < 3) return false;
        const n = vertices.length;
        let sign = 0;
        for (let i = 0; i < n; i++) {
            const a = vertices[i];
            const b = vertices[(i + 1) % n];
            const c = vertices[(i + 2) % n];
            const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
            if (cross !== 0) {
                const s = Math.sign(cross);
                if (sign === 0) sign = s;
                else if (s !== sign) return false;
            }
        }
        return true;
    }

    /** Moment of inertia about the entity's own origin (its rotation pivot). One general formula
     * covers every shape source below - for a centered axis-aligned rectangle it's provably exact
     * and reduces to the textbook mass*(w^2+h^2)/12, so there's no need for a separate rectangle
     * case. */
    getMomentOfInertia(mass) {
        return PolygonCollider.#polygonMomentOfInertia(this.#currentLocalVertices(), mass);
    }

    /** The vertices this collider currently uses, in priority order - see the constructor comment. */
    #currentLocalVertices() {
        const renderer = this.entity.getComponent(PolygonRenderer);
        if (renderer) return PolygonCollider.#tessellate(renderer.vertices);
        return this.localVertices ?? this.#rectVertices();
    }

    /**
     * This collider's local shape, split into convex pieces if it isn't one already - true SAT
     * (see #satCollision) only ever works between two convex shapes, so a concave one has to be
     * decomposed before it can collide correctly. A convex shape comes back as a single one-part
     * list, so nothing downstream (or upstream, in polygonCollision) pays any cost over the
     * pre-concave-support code path in the common case - decomposition (ear-clipping - see
     * #triangulate) only runs at all once a shape actually fails isConvex.
     *
     * Cached by a content signature rather than left to run fresh every physics step: it's the one
     * genuinely non-trivial cost concave support adds, and level geometry built with the pen tool
     * doesn't change outside the editor. A signature (not reference equality) because the
     * Inspector's vertex-drag handles mutate a PolygonRenderer's vertices array's ELEMENTS in
     * place rather than ever replacing the array itself.
     */
    #convexLocalParts() {
        const vertices = this.#currentLocalVertices();
        if (PolygonCollider.isConvex(vertices)) return [vertices];

        const signature = JSON.stringify(vertices);
        if (this._decomposeCache?.signature === signature) return this._decomposeCache.parts;

        const parts = PolygonCollider.#triangulate(vertices);
        this._decomposeCache = { signature, parts };
        return parts;
    }

    /** #convexLocalParts, transformed into world space for this frame - the cheap part (a matrix
     * multiply per vertex) that does have to happen every frame, same as the whole-shape
     * transformVertices getBounds() already recomputes every frame regardless. */
    #convexWorldParts() {
        return this.#convexLocalParts().map(part => part.map(v => Vector2.transform(v, this.entity.transform)));
    }

    /**
     * Expands a PolygonRenderer vertex list's curved edges (see its own doc comment on `curve`)
     * into several short straight segments, so SAT and the closest-point-on-perimeter math below -
     * which only ever know how to work with straight edges - see a shape that looks like the curve
     * without needing to know curves exist at all. A fixed segment count rather than one that
     * adapts to the curve's size/angle: these are small UI-scale shapes (course obstacles), not
     * architectural curves, so a flat resolution is plenty smooth without adaptive-subdivision
     * complexity. A vertex with no `curve` passes through untouched, so a plain straight-edged
     * shape tessellates to exactly its own vertices, unchanged.
     */
    static #CURVE_SEGMENTS = 8;
    static #tessellate(vertices) {
        const n = vertices.length;
        const result = [];
        for (let i = 0; i < n; i++) {
            const v = vertices[i];
            result.push(new Vector2(v.x, v.y));
            if (v.curve) {
                const next = vertices[(i + 1) % n];
                for (let s = 1; s < PolygonCollider.#CURVE_SEGMENTS; s++) {
                    const t = s / PolygonCollider.#CURVE_SEGMENTS;
                    const mt = 1 - t;
                    result.push(new Vector2(
                        mt * mt * v.x + 2 * mt * t * v.curve.x + t * t * next.x,
                        mt * mt * v.y + 2 * mt * t * v.curve.y + t * t * next.y,
                    ));
                }
            }
        }
        return result;
    }

    /**
     * Standard polygon moment-of-inertia formula (see e.g. Box2D's b2PolygonShape::ComputeMass),
     * evaluated directly about the origin the vertices are already expressed in rather than the
     * polygon's own centroid - which is exactly what's wanted here, since that origin IS the
     * entity's rotation pivot. Works for either winding order via the abs()es, since listing the
     * vertices clockwise vs counter-clockwise just flips every cross product's sign consistently.
     */
    static #polygonMomentOfInertia(vertices, mass) {
        let signedAreaSum = 0;
        let numerator = 0;
        const n = vertices.length;
        for (let i = 0; i < n; i++) {
            const v1 = vertices[i];
            const v2 = vertices[(i + 1) % n];
            const cross = v1.cross(v2);
            signedAreaSum += cross;
            numerator += cross * (v1.dot(v1) + v1.dot(v2) + v2.dot(v2));
        }
        if (signedAreaSum === 0) return 0;
        return mass * Math.abs(numerator / signedAreaSum) / 6;
    }

    /** Shoelace signed area - positive for counter-clockwise, negative for clockwise. Only the
     * sign is used below (to know which side of a vertex "outward" is for ear-clipping), so it
     * doesn't matter which screen/world Y convention the caller uses. */
    static #signedArea(vertices) {
        let sum = 0;
        const n = vertices.length;
        for (let i = 0; i < n; i++) {
            const a = vertices[i], b = vertices[(i + 1) % n];
            sum += a.x * b.y - b.x * a.y;
        }
        return sum / 2;
    }

    /** True iff `p` lies inside (or on the edge of) triangle (a,b,c) - ear-clipping's guard
     * against cutting off a triangle that would wrongly swallow some OTHER vertex of the polygon. */
    static #pointInTriangle(p, a, b, c) {
        const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
        const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y);
        const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y);
        const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
        const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
        return !(hasNeg && hasPos);
    }

    /**
     * Ear-clipping triangulation - splits ANY simple polygon (concave included) into convex
     * pieces, since a triangle is always convex. This is what actually makes concave collision
     * possible: real SAT only ever works convex-vs-convex (see #satCollision), so a concave shape
     * has no meaning to it until it's been cut into pieces that do.
     *
     * O(n^2) worst case (find one ear, repeat) - which is nothing at the vertex counts a
     * hand-drawn course boundary ever has (tens, not thousands), and #convexLocalParts caches the
     * result anyway, so this only runs once per shape rather than every frame. A more elaborate
     * decomposer (reflex-vertex partitioning a la Bayazit, or merging ears back into bigger convex
     * polygons a la Hertel-Mehlhorn) would produce fewer, larger convex parts - strictly a runtime
     * micro-optimization on top of an already-cached, already-cheap-at-this-scale result, so it's
     * not worth the extra implementation risk unless a shape's vertex count actually grows enough
     * for the per-frame SAT pair count (parts-of-A x parts-of-B) to matter.
     */
    static #triangulate(vertices) {
        const verts = PolygonCollider.#signedArea(vertices) < 0 ? [...vertices].reverse() : [...vertices];
        const triangles = [];
        let indices = verts.map((_, i) => i);

        while (indices.length > 3) {
            let clipped = false;
            for (let i = 0; i < indices.length; i++) {
                const iPrev = indices[(i - 1 + indices.length) % indices.length];
                const iCur = indices[i];
                const iNext = indices[(i + 1) % indices.length];
                const a = verts[iPrev], b = verts[iCur], c = verts[iNext];

                const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
                if (cross <= 0) continue; // reflex (or degenerate) at b - can't be an ear

                const isEar = !indices.some(idx =>
                    idx !== iPrev && idx !== iCur && idx !== iNext && PolygonCollider.#pointInTriangle(verts[idx], a, b, c)
                );
                if (!isEar) continue;

                triangles.push([a, b, c]);
                indices.splice(i, 1);
                clipped = true;
                break;
            }
            // Degenerate input (duplicate or collinear points) can leave no valid ear to clip -
            // stop rather than loop forever; whatever's already been clipped is still a valid
            // (if incomplete) decomposition rather than nothing at all.
            if (!clipped) break;
        }

        if (indices.length === 3) {
            triangles.push([verts[indices[0]], verts[indices[1]], verts[indices[2]]]);
        }
        return triangles;
    }

    #rectVertices() {
        const size = this.entity.transform.size;
        const width = size?.x ?? this.width;
        const height = size?.y ?? this.height;
        const left = -width / 2;
        const right = left + width;
        const bottom = -height / 2;
        const top = bottom + height;
        return [
            new Vector2(left, top),
            new Vector2(right, top),
            new Vector2(right, bottom),
            new Vector2(left, bottom),
        ];
    }

    //Need to call this function whenever moving || rotating the entity
    getBounds() {
        this.vertices = this.#currentLocalVertices();

        this.transformVertices = this.vertices.map(v => {
            return Vector2.transform(
                v,
                this.entity.transform
            );
        });

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const v of this.transformVertices) {
            if (v.x < minX) minX = v.x;
            if (v.x > maxX) maxX = v.x;
            if (v.y < minY) minY = v.y;
            if (v.y > maxY) maxY = v.y;
        }

        return new Bounds(minX, maxX, minY, maxY);
    }

    getTransformedBounds() {
        // Refresh this.transformVertices for the entity's current position/rotation.
        this.getBounds();

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const v of this.transformVertices) {
            if (v.x < minX) minX = v.x;
            if (v.x > maxX) maxX = v.x;
            if (v.y < minY) minY = v.y;
            if (v.y > maxY) maxY = v.y;
        }

        return {
            left: new Vector2(minX, 0),
            right: new Vector2(maxX, 0),
            top: new Vector2(0, minY),
            bottom: new Vector2(0, maxY)
        };
    }

    checkCollision(otherCollider) {
        return otherCollider.polygonCollision(this);
    }

    circleCollision(circleCollider) {
        const info = circleCollider.boxCollision(this);
        // boxCollision legitimately returns null here: the broad-phase AABB check that gated this
        // call is looser than the real circle-vs-rotated-box test, especially once the box is
        // rotated (its AABB is bigger than the box itself), so "AABBs overlap" doesn't guarantee
        // "the actual shapes overlap." Not guarding this crashed the whole engine the moment a
        // circle-based entity (the golf ball) grazed a rotated wall's bounding box without truly
        // touching the wall.
        if (!info) return null;
        info.normal.scale(-1);
        return info;
    }

    /**
     * Separating Axis Theorem (SAT) for polygon vs polygon collision - dispatches to whichever of
     * `this`/`other` is concave (see #convexLocalParts) rather than assuming both already are
     * convex, since real SAT (below, in #satCollision) only has meaning between two convex shapes.
     */
    polygonCollision(other) {
        if (this.isInverse || other.isInverse) {
            return this.#containmentPolygonCollision(other);
        }

        const centerA = this.entity.transform.position;
        const centerB = other.entity.transform.position;
        const partsA = this.#convexWorldParts();
        const partsB = other.#convexWorldParts();

        if (partsA.length === 1 && partsB.length === 1) {
            return PolygonCollider.#satCollision(partsA[0], partsB[0], centerA, centerB);
        }

        // At least one shape is concave: decomposition tiles it into non-overlapping convex
        // pieces whose union is the original shape exactly, so a genuine overlap between the two
        // ORIGINAL (possibly concave) shapes always shows up as a real SAT overlap between at
        // least one (partA, partB) pair. Several pairs can be simultaneously overlapping (contact
        // straddling the seam between two parts) - like #containmentPolygonCollision below, this
        // resolves against the single deepest one and leans on the engine's existing
        // multi-iteration convergence for anything smaller left over, rather than merging several
        // simultaneous contacts into one manifold.
        let best = undefined;
        for (const partA of partsA) {
            for (const partB of partsB) {
                const result = PolygonCollider.#satCollision(partA, partB, centerA, centerB);
                if (result && (!best || result.depth > best.depth)) best = result;
            }
        }
        return best;
    }

    /** The actual SAT test - always between two CONVEX vertex lists (either two whole shapes that
     * both happened to already be convex, or two decomposition pieces of ones that weren't - see
     * polygonCollision). `vertsA`/`vertsB` must already be in world space. */
    static #satCollision(vertsA, vertsB, centerA, centerB) {
        let normal = Vector2.Zero;
        let depth = Infinity;

        for (let i = 0; i < vertsA.length; i++) {
            const v1 = vertsA[i].clone();
            const v2 = vertsA[(i + 1) % vertsA.length].clone();

            const edge = v2.subtract(v1);
            const axis = new Vector2(-edge.y, edge.x).normalize(); // Normalize axis before projection

            const projectionA = PolygonCollider.#projectVertices(axis, vertsA);
            const projectionB = PolygonCollider.#projectVertices(axis, vertsB);

            if (projectionA.min >= projectionB.max || projectionB.min >= projectionA.max) {
                return undefined;
            }

            const tempDepth = Math.min(projectionB.max - projectionA.min, projectionA.max - projectionB.min);
            if (tempDepth < depth) {
                depth = tempDepth;
                normal = axis;
            }
        }
        for (let i = 0; i < vertsB.length; i++) {
            const v1 = vertsB[i].clone();
            const v2 = vertsB[(i + 1) % vertsB.length].clone();

            const edge = v2.subtract(v1);
            const axis = new Vector2(-edge.y, edge.x).normalize(); // Normalize axis before projection

            const projectionA = PolygonCollider.#projectVertices(axis, vertsA);
            const projectionB = PolygonCollider.#projectVertices(axis, vertsB);

            if (projectionA.min >= projectionB.max || projectionB.min >= projectionA.max) {
                return undefined;
            }

            const tempDepth = Math.min(projectionB.max - projectionA.min, projectionA.max - projectionB.min);
            if (tempDepth < depth) {
                depth = tempDepth;
                normal = axis;
            }
        }

        const ab = new Vector2(centerB.x - centerA.x, centerB.y - centerA.y);

        // Flip the normal if the dot product is positive
        if (ab.dot(normal) > 0) {
            normal.x = -normal.x;
            normal.y = -normal.y;
        }

        const contactPoint = PolygonCollider.#findContactPointBetween(vertsA, vertsB, centerA, centerB);

        return {
            normal,
            depth,
            contactPoint
        }
    }

    /**
     * One of these two polygons is a containment boundary (isInverse) - the OTHER must stay fully
     * inside it. Tests each content vertex with the general ray-casting inside test
     * (isPointInPolygon) rather than SAT's convex-only half-plane check, and measures a violation
     * by the vertex's actual distance to the boundary's nearest perimeter point rather than a
     * single edge's half-plane distance - both correct for ANY simple boundary shape, concave
     * included (the same recipe CircleCollider's own polygon containment already uses). No
     * decomposition needed here at all, unlike solid SAT above: "is this point inside" and "how
     * far to the nearest edge" are already well-defined for a concave shape on their own, with
     * nothing to decompose it INTO that would make either question easier to answer.
     *
     * Only content's vertices are tested - the same approximation the old convex half-plane
     * version also made (a content polygon's edge could in principle poke through a boundary notch
     * narrower than its own vertex spacing without any single vertex registering a violation).
     * Acceptable at course-obstacle scale, and no worse than before.
     *
     * Among whichever vertices actually escape, the worst single violation (not the smallest, the
     * way solid SAT picks minimum overlap) is used as this frame's correction - there isn't a
     * solid-SAT-style guarantee that fixing one violation fixes every escaped vertex at once, so
     * this instead corrects the most severe breach and leans on the engine's existing multi-frame/
     * multi-iteration convergence (see PhysicsEngine.physicsIterations) for any lesser one left over.
     */
    #containmentPolygonCollision(other) {
        const boundaryIsThis = this.isInverse;
        const boundary = boundaryIsThis ? this : other;
        const content = boundaryIsThis ? other : this;

        const boundaryVerts = boundary.transformVertices;
        const contentVerts = content.transformVertices;

        let worst = null; // { distance, point, closest }
        for (const v of contentVerts) {
            if (PolygonCollider.isPointInPolygon(v, boundaryVerts)) continue; // safely inside - no violation
            const { point: closest, distance } = PolygonCollider.#closestPointOnPolygon(v, boundaryVerts);
            if (!worst || distance > worst.distance) worst = { distance, point: v, closest };
        }

        if (!worst) return null; // Every content vertex is inside the boundary.

        // Escaped -> back toward the boundary's interior. A near-zero distance means the vertex
        // sits right on the perimeter; normalize() on that near-zero vector would be unstable, so
        // fall back to a fixed direction rather than an unpredictable one.
        const pushDir = worst.distance > 0.0001
            ? worst.closest.clone().subtract(worst.point).normalize()
            : new Vector2(0, -1);

        // Same first-to-second role-reversal correction as the solid case's own centerA/centerB
        // flip above - checkCollision's double dispatch makes `this` always the SECOND collider
        // PhysicsEngine is resolving and `other` the first, so which literal direction pushes
        // "content" inward depends on which of the two content happens to be.
        const normal = boundaryIsThis ? pushDir.clone().scale(-1) : pushDir;

        return { depth: worst.distance, normal, contactPoint: worst.point };
    }

    static #closestPointOnSegment(p, a, b) {
        const ab = b.clone().subtract(a);
        const abLenSq = ab.magnitudeSq();
        if (abLenSq === 0) return a.clone();
        const t = Math.max(0, Math.min(1, p.clone().subtract(a).dot(ab) / abLenSq));
        return a.clone().add(ab.scale(t));
    }

    /** Closest point on `vertices`' own perimeter to `point`, and the distance to it - a per-edge
     * nearest-point scan, which (unlike a half-plane or same-side test) needs no convexity
     * assumption at all: it works identically for any simple polygon. */
    static #closestPointOnPolygon(point, vertices) {
        let closest = null;
        let minDistSq = Infinity;
        const n = vertices.length;
        for (let i = 0; i < n; i++) {
            const candidate = PolygonCollider.#closestPointOnSegment(point, vertices[i], vertices[(i + 1) % n]);
            const distSq = candidate.clone().subtract(point).magnitudeSq();
            if (distSq < minDistSq) {
                minDistSq = distSq;
                closest = candidate;
            }
        }
        return { point: closest, distance: Math.sqrt(minDistSq) };
    }

    /**
     * The actual touching point(s), used for torque - not just a stand-in for "where they overlap".
     * A vertex of one polygon sitting inside the other is exactly that point. Real physics engines
     * clip a full 2-point manifold for edge-vs-edge contact (e.g. a box resting flat on both
     * corners); this averages every interior vertex found instead as a cheaper stand-in for that -
     * critically, when a box rests flat and BOTH bottom corners are touching, using only the first
     * one found would give an off-center torque arm for a geometrically symmetric contact, biasing
     * every resolved impulse's torque to one side and never letting the box settle (that was
     * happening even after fixing the single-point case: the previous "midpoint of the two
     * centers" wasn't a point on either polygon at all, so its torque didn't cancel out at rest and
     * kept slowly spinning objects up; returning only the *first* interior vertex fixed that for a
     * corner-balanced box but reintroduced the same kind of bias for a flat-resting one).
     */
    static #findContactPointBetween(vertsA, vertsB, centerA, centerB) {
        const points = [];
        for (const v of vertsA) {
            if (PolygonCollider.#pointInConvexPolygon(v, vertsB)) points.push(v);
        }
        for (const v of vertsB) {
            if (PolygonCollider.#pointInConvexPolygon(v, vertsA)) points.push(v);
        }

        if (points.length > 0) {
            const sum = points.reduce((acc, p) => acc.add(p.clone()), new Vector2(0, 0));
            return sum.scale(1 / points.length);
        }

        // SAT already confirmed overlap, so this shouldn't normally happen - fall back to the old
        // approximation rather than leaving contactPoint undefined.
        return centerA.clone().add(centerB).scale(0.5);
    }

    static #pointInConvexPolygon(point, vertices) {
        // True iff `point` is on the same side of every edge - works for either winding order.
        let sign = 0;
        for (let i = 0; i < vertices.length; i++) {
            const a = vertices[i];
            const b = vertices[(i + 1) % vertices.length];
            const cross = b.clone().subtract(a).cross(point.clone().subtract(a));
            if (cross !== 0) {
                const s = Math.sign(cross);
                if (sign === 0) sign = s;
                else if (s !== sign) return false;
            }
        }
        return true;
    }

    /**
     * True iff `point` is inside `vertices` - the standard even-odd ray-casting rule: count how
     * many edges a ray from `point` out to +X crosses, odd means inside. Unlike
     * #pointInConvexPolygon above, this is correct for ANY simple (non-self-intersecting) polygon,
     * concave included, at the same O(n) cost - so it's the one to reach for wherever "inside"
     * actually has to hold up against a concave shape (see CircleCollider's polygon checks) rather
     * than the cheaper convex-only test everywhere, since convex is still the common case and
     * every other use of "same side of every edge" here (contact points, SAT itself) is only ever
     * asked about shapes SAT already requires to be convex anyway.
     */
    static isPointInPolygon(point, vertices) {
        let inside = false;
        const n = vertices.length;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const vi = vertices[i], vj = vertices[j];
            const straddles = (vi.y > point.y) !== (vj.y > point.y);
            if (straddles && point.x < (vj.x - vi.x) * (point.y - vi.y) / (vj.y - vi.y) + vi.x) {
                inside = !inside;
            }
        }
        return inside;
    }

    static #projectVertices(axis, vertices) {
        let min = Infinity;
        let max = -Infinity;
        for (const v of vertices) {
            const projection = v.dot(axis);
            min = Math.min(min, projection);
            max = Math.max(max, projection);
        }
        return { min, max };
    }

    onCollisionEnter(otherCollider) {
        //These can be defined by the Entity. Do nothing by default
    }

    onCollisionExit(otherCollider) {
        //These can be defined by the Entity. Do nothing by default
    }


    // Visual debug: draw OBB corners and collision normal if ctx is provided
    drawCollider(ctx, color = 'red') {
        if (this.transformVertices.length === 0) { this.getBounds(); }

        ctx.save();
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(this.transformVertices[0].x, this.transformVertices[0].y);

        for(let i = 0; i < this.transformVertices.length; i++) {
            const v = this.transformVertices[i];
            ctx.lineTo(v.x, v.y);
        }
        ctx.closePath();
        ctx.stroke();

        for (let i = 0; i < this.transformVertices.length; i++) {
            const v = this.transformVertices[i];
            ctx.beginPath();
            ctx.arc(v.x, v.y, 3, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    debugDrawNormal(ctx, collisionResult, color = 'blue') {
        if (!ctx || !collisionResult) return;
        const center = this.entity.transform.position;
        const normal = collisionResult.normal;
        const depth = collisionResult.depth;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(center.x, center.y);
        // Draw the normal as an arrow from the center, scaled by depth (or a fixed length if depth is small)
        const len = Math.max(30, depth * 10);
        ctx.lineTo(center.x + normal.x * len, center.y + normal.y * len);
        ctx.stroke();
        // Draw a dot at the tip
        ctx.beginPath();
        ctx.arc(center.x + normal.x * len, center.y + normal.y * len, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

}
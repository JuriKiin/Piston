import { Bounds } from '../Bounds.js';
import { Vector2 } from '../Vector2.js';
import { Collider } from './Collider.js';

export class PolygonCollider extends Collider {
    constructor(entity, numPoints, width, height) {
        super(entity);
        this.numPoints = numPoints ?? 4; //Default to 4 points (rectangle)
        this.width = width ?? 10;
        this.height = height ?? 10;

        this.vertices = [];
        this.transformVertices = [];

        this.activeCollisions = new Set(); // Track active collisions
    }

    //Need to call this function whenever moving || rotating the entity
    getBounds() {
        const left = -this.width / 2;
        const right = left + this.width;
        const bottom = -this.height / 2;
        const top = bottom + this.height;


        //Starting with just a box
        const topLeft = new Vector2(left, top);
        const topRight = new Vector2(right, top);
        const bottomRight = new Vector2(right, bottom);
        const bottomLeft = new Vector2(left, bottom);
        this.vertices = [
            topLeft,
            topRight,
            bottomRight,
            bottomLeft
        ];

        this.transformVertices = this.vertices.map(v => {
            return Vector2.transform(
                v,
                this.entity.transform
            );
        });

        return new Bounds(
            topLeft, 
            topRight, 
            bottomRight, 
            bottomLeft
        );
    }

    getTransformedBounds() {
        const bounds = this.getBounds();

        // Transform bounds positions using Vector2.transform()
        const left = Vector2.transform(bounds.left, this.entity.transform);
        const top = Vector2.transform(bounds.top, this.entity.transform);
        const right = Vector2.transform(bounds.right, this.entity.transform);
        const bottom = Vector2.transform(bounds.bottom, this.entity.transform);

        return {
            left,
            top,
            right,
            bottom
        };
    }

    checkCollision(otherCollider) {
        return otherCollider.polygonCollision(this);
    }
    
    circleCollision(circleCollider) {
        const info = circleCollider.polygonCollision(this);
        info.normal.scale(-1);
        return info;
    }

    //The vertices of both this + other colliders MUST be transformed into world space (i.e accounting for rotation and translation)
    //Separating Axis Theorem (SAT) for polygon vs polygon collision
    polygonCollision(other) {

        let normal = Vector2.Zero;
        let depth = Infinity;

        for (let i = 0; i < this.transformVertices.length; i++) {
            const v1 = this.transformVertices[i].clone();
            const v2 = this.transformVertices[(i + 1) % this.transformVertices.length].clone();

            const edge = v2.subtract(v1);
            const axis = new Vector2(-edge.y, edge.x).normalize(); // Normalize axis before projection

            const projectionA = this.#projectVertices(axis, this.transformVertices);
            const projectionB = this.#projectVertices(axis, other.transformVertices);

            if (projectionA.min >= projectionB.max || projectionB.min >= projectionA.max) {
                return undefined;
            }

            const tempDepth = Math.min(projectionB.max - projectionA.min, projectionA.max - projectionB.min);
            if (tempDepth < depth) {
                depth = tempDepth;
                normal = axis;
            }
        }
        for (let i = 0; i < other.transformVertices.length; i++) {
            const v1 = other.transformVertices[i].clone();
            const v2 = other.transformVertices[(i + 1) % other.transformVertices.length].clone();

            const edge = v2.subtract(v1);
            const axis = new Vector2(-edge.y, edge.x).normalize(); // Normalize axis before projection

            const projectionA = this.#projectVertices(axis, this.transformVertices);
            const projectionB = this.#projectVertices(axis, other.transformVertices);

            if (projectionA.min >= projectionB.max || projectionB.min >= projectionA.max) {
                return undefined;
            }

            const tempDepth = Math.min(projectionB.max - projectionA.min, projectionA.max - projectionB.min);
            if (tempDepth < depth) {
                depth = tempDepth;
                normal = axis;
            }
        }

        const centerA = this.entity.transform.position;
        const centerB = other.entity.transform.position;
        const ab = new Vector2(centerB.x - centerA.x, centerB.y - centerA.y);

        // Flip the normal if the dot product is positive
        if (ab.dot(normal) > 0) {
            normal.x = -normal.x;
            normal.y = -normal.y;
        }

        // Calculate the contact point as the midpoint of the closest edge
        const contactPoint = centerA.clone().add(centerB).scale(0.5);

        return {
            normal,
            depth,
            contactPoint
        }
    }

    #projectVertices(axis, vertices) {
        let min = Infinity;
        let max = -Infinity;
        for (const v of vertices) {
            const projection = v.dot(axis);
            min = Math.min(min, projection);
            max = Math.max(max, projection);
        }
        return { min, max };
    }

    boxCollision(otherBox) {
        // SAT for OBB vs OBB
        const cornersA = this.getOBBCorners();
        const cornersB = otherBox.getOBBCorners();
        const axes = [...getAxes(cornersA), ...getAxes(cornersB)];
        let minOverlap = Infinity;
        let smallestAxis = null;
        for (const axis of axes) {
            const projA = projectCorners(axis, cornersA);
            const projB = projectCorners(axis, cornersB);
            const overlap = Math.min(projA.max, projB.max) - Math.max(projA.min, projB.min);
            if (overlap <= 0) return null; // Separating axis found
            if (overlap < minOverlap) {
                minOverlap = overlap;
                smallestAxis = axis.clone(); // Use a clone to avoid mutation
            }
        }
        // Use the axis of minimum overlap as the normal, but INVERSE it from previous logic
        const centerA = this.entity.transform.position;
        const centerB = otherBox.entity.transform.position;
        const ab = new Vector2(centerB.x - centerA.x, centerB.y - centerA.y);
        // Inverse: flip the normal if the projection is POSITIVE
        if (ab.dot(smallestAxis) > 0) {
            smallestAxis.x = -smallestAxis.x;
            smallestAxis.y = -smallestAxis.y;
        }
        return {
            depth: minOverlap,
            normal: smallestAxis
        };
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

    #getRotatedCorners(center, width, height, angleDegrees) {
        const angle = angleDegrees * (Math.PI / 180);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const hw = width / 2;
        const hh = height / 2;
        // Corners relative to center
        const corners = [
            new Vector2(-hw, -hh),
            new Vector2(hw, -hh),
            new Vector2(hw, hh),
            new Vector2(-hw, hh)
        ];
        // Rotate and translate
        return corners.map(corner => {
            return new Vector2(
                center.x + corner.x * cos - corner.y * sin,
                center.y + corner.x * sin + corner.y * cos
            );
        });
    }

    #getAxes(corners) {
        const axes = [];
        for (let i = 0; i < 2; i++) {
            const p1 = corners[i];
            const p2 = corners[(i + 1) % 4];
            const edge = new Vector2(p2.x - p1.x, p2.y - p1.y);
            // Normal (perpendicular)
            axes.push(new Vector2(-edge.y, edge.x).normalize());
        }
        return axes;
    }

    #projectCorners(axis, corners) {
        let min = axis.x * corners[0].x + axis.y * corners[0].y;
        let max = min;
        for (let i = 1; i < corners.length; i++) {
            const proj = axis.x * corners[i].x + axis.y * corners[i].y;
            if (proj < min) min = proj;
            if (proj > max) max = proj;
        }
        return { min, max };
    }


}
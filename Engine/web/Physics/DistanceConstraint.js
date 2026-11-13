/**
 * Position-based distance constraint between two entities (or an entity and a fixed point). The building block of DistanceJoint and RopeChain.
 *
 * Each call moves the bodies along the line between them so their distance moves toward `length` by `stiffness` (0..1) of the error, split by inverse mass.
 * The same displacement is added to a dynamic body's velocity (velocities are per step, so a displacement per step IS a velocity), which keeps momentum
 * and lets a hanging chain swing. A body counts as immovable (inverse mass 0) when it has no Rigidbody (moved by script), is static, or is pinned.
 * Nothing here is random or time-dependent, so the result is identical on every machine for the same inputs and step order.
 *
 * @param {object} a Entity A (transform.position, optional rigidbody)
 * @param {object|null} b Entity B, or null to use the fixed point `anchor`
 * @param {number} length Rest distance
 * @param {object} [o]
 * @param {{x:number,y:number}} [o.anchor] Fixed point used when `b` is null
 * @param {number} [o.stiffness=1] Fraction of the error removed per call
 * @param {boolean} [o.maxOnly=false] Rope behaviour: only pull together when stretched, never push apart
 * @param {boolean} [o.pinA=false] Treat A as immovable
 * @param {boolean} [o.pinB=false] Treat B as immovable
 * @param {number} [o.damping=0] 0..1 share of the relative velocity along the line removed per call
 * @returns {number} The distance error before correction (positive = stretched)
 */
export function solveDistance(a, b, length, { anchor = null, stiffness = 1, maxOnly = false, pinA = false, pinB = false, damping = 0 } = {}) {
    const pa = a.transform.position, pb = b ? b.transform.position : anchor;
    if (!pb) return 0;
    const wA = invMass(a, pinA), wB = b ? invMass(b, pinB) : 0, wSum = wA + wB;
    let dx = pb.x - pa.x, dy = pb.y - pa.y, dist = Math.hypot(dx, dy);
    if (dist < 1e-9) { dx = 1; dy = 0; dist = 0; } else { dx /= dist; dy /= dist; } // coincident bodies: separate along +x, deterministically
    const err = dist - length;
    if (wSum === 0 || !Number.isFinite(err)) return err;
    if (maxOnly && err <= 0) return err;
    const k = Math.max(0, Math.min(1, stiffness)), cx = dx * err * k, cy = dy * err * k;
    if (wA) move(a, cx * wA / wSum, cy * wA / wSum);
    if (wB) move(b, -cx * wB / wSum, -cy * wB / wSum);
    if (damping > 0) {
        const va = a.rigidbody && wA ? a.rigidbody.velocity : { x: 0, y: 0 }, vb = b && b.rigidbody && wB ? b.rigidbody.velocity : { x: 0, y: 0 };
        const rel = (vb.x - va.x) * dx + (vb.y - va.y) * dy, d = rel * Math.min(1, damping);
        if (wA) { a.rigidbody.velocity.x += dx * d * wA / wSum; a.rigidbody.velocity.y += dy * d * wA / wSum; }
        if (wB) { b.rigidbody.velocity.x -= dx * d * wB / wSum; b.rigidbody.velocity.y -= dy * d * wB / wSum; }
    }
    return err;
}

function invMass(e, pinned) {
    const rb = e.rigidbody;
    if (pinned || !rb || rb.isStatic || !(rb.mass > 0)) return 0;
    return 1 / rb.mass;
}

function move(e, x, y) {
    e.transform.position.x += x; e.transform.position.y += y;
    const rb = e.rigidbody;
    if (rb) { rb.velocity.x += x; rb.velocity.y += y; }
}

import { Bounds } from '../Bounds.js';
import { Vector2 } from '../Vector2.js';
import { Collider } from './Collider.js';

export class BoxCollider extends Collider {
    constructor(entity, width, height) {
        super(entity);
        this.width = width;
        this.height = height;
    }

    getOBBCorners() {
        return getRotatedCorners(
            this.entity.transform.position,
            this.width,
            this.height,
            this.entity.transform.rotation || 0
        );
    }

    getBounds() {
        // Returns AABB for broadphase
        const corners = this.getOBBCorners();
        let minX = corners[0].x, maxX = corners[0].x, minY = corners[0].y, maxY = corners[0].y;
        for (let i = 1; i < 4; i++) {
            if (corners[i].x < minX) minX = corners[i].x;
            if (corners[i].x > maxX) maxX = corners[i].x;
            if (corners[i].y < minY) minY = corners[i].y;
            if (corners[i].y > maxY) maxY = corners[i].y;
        }
        return new Bounds(minX, maxX, minY, maxY);
    }

    checkCollision(otherCollider) {
        return otherCollider.boxCollision(this);
    }
    
    circleCollision(circleCollider) {
        const info = circleCollider.boxCollision(this);
        if (info) {
            info.normal.scale(-1);
        }
        return info;
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
            penetration: minOverlap,
            normal: smallestAxis
        };
    }

    // Visual debug: draw OBB corners and collision normal if ctx is provided
    drawCollider(ctx, color = 'red') {
        const corners = this.getOBBCorners();
        if (!ctx) return;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 4; i++) {
            ctx.lineTo(corners[i].x, corners[i].y);
        }
        ctx.closePath();
        ctx.stroke();
        // Draw corners
        ctx.fillStyle = color;
        for (let i = 0; i < 4; i++) {
            ctx.beginPath();
            ctx.arc(corners[i].x, corners[i].y, 3, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    debugDrawNormal(ctx, collisionResult, color = 'blue') {
        if (!ctx || !collisionResult) return;
        const center = this.entity.transform.position;
        const normal = collisionResult.normal;
        const penetration = collisionResult.penetration;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(center.x, center.y);
        // Draw the normal as an arrow from the center, scaled by penetration (or a fixed length if penetration is small)
        const len = Math.max(30, penetration * 10);
        ctx.lineTo(center.x + normal.x * len, center.y + normal.y * len);
        ctx.stroke();
        // Draw a dot at the tip
        ctx.beginPath();
        ctx.arc(center.x + normal.x * len, center.y + normal.y * len, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function getRotatedCorners(center, width, height, angleDegrees) {
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

function getAxes(corners) {
    // Returns the 2 unique axes (normals to edges)
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

function projectCorners(axis, corners) {
    let min = axis.x * corners[0].x + axis.y * corners[0].y;
    let max = min;
    for (let i = 1; i < corners.length; i++) {
        const proj = axis.x * corners[i].x + axis.y * corners[i].y;
        if (proj < min) min = proj;
        if (proj > max) max = proj;
    }
    return { min, max };
}
import { Bounds } from '../Bounds.js';
import { Vector2 } from '../Vector2.js';
import { Collider } from './Collider.js';

export class BoxCollider extends Collider {
    constructor(entity, width, height) {
        super(entity);
        this.width = width;
        this.height = height;
    }

    getBounds() {
        const pos = this.entity.transform.position;
        const halfW = this.width / 2;
        const halfH = this.height / 2;
        return new Bounds(pos.x - halfW, pos.x + halfW, pos.y - halfH, pos.y + halfH);
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
        const boundsA = this.getBounds();
        const boundsB = otherBox.getBounds();
        
        const overlapX = Math.min(boundsA.right, boundsB.right) - Math.max(boundsA.left, boundsB.left);
        const overlapY = Math.min(boundsA.bottom, boundsB.bottom) - Math.max(boundsA.top, boundsB.top);

        if (overlapX > 0 && overlapY > 0) {
            if (overlapX < overlapY) {
                const normalX = this.entity.transform.position.x < otherBox.entity.transform.position.x ? -1 : 1;
                return {
                    penetration: overlapX,
                    normal: new Vector2(normalX, 0),
                };
            } else {
                const normalY = this.entity.transform.position.y < otherBox.entity.transform.position.y ? -1 : 1;
                return {
                    penetration: overlapY,
                    normal: new Vector2(0, normalY),
                };
            }
        }
        return null;
    }
}
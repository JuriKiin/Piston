import Constants from "./Constants.js";
import { Rigidbody } from "./Physics/Rigidbody.js";
import { Vector2 } from "./Physics/Vector2.js";

export class Transform {
    constructor(position, size) {
        this.position = position ?? new Vector2(0);
        this.size = size;
    }

    update(rigidbody) {
        if (!(rigidbody instanceof Rigidbody)) return;
        if (!(this.position instanceof Vector2)) return;

        this.position.x += rigidbody.velocity.x * Constants.DELTA_TIME;
        this.position.y += rigidbody.velocity.y * Constants.DELTA_TIME;
    
    }

    setBounds(bounds) {
        if (bounds instanceof Bounds) {
            this.bounds = bounds;
        } else {
            console.error("setBounds expects a Bounds instance");
        }
    }
}
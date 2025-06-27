import { Rigidbody } from "./Physics/Rigidbody.js";
import { Vector2 } from "./Physics/Vector2.js";
import Constants from "./static/Constants.js";


export class Transform {
    constructor(position, rotation, size) {
        this.position = position ?? new Vector2(0);
        this.rotation = rotation ?? 0;
        this.size = size ?? Vector2.One;
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

    rotate(degrees, speed) {
        if (degrees !== undefined) {
            this.rotation += degrees * Constants.DELTA_TIME * speed;
        }
        if (this.rotation > 360) {
            this.rotation = 0;
        } else if (this.rotation < 0) {
            this.rotation = 360;
        }
    }

    //This is used to resolve collisions
    move(vec) {
        this.position.x += vec.x;
        this.position.y += vec.y;
    }
}
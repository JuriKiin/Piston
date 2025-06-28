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

        this.position = this.position.add(rigidbody.velocity);
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

    /**
     * Translates the position of the transform based on a direction and speed.
     * @param {Vector2} direction - The direction to move in.
     * @param {number} speed - The speed of movement.
     */
    translate(direction, speed) {
        if (!(direction instanceof Vector2)) {
            console.error("translate expects a Vector2 instance for direction");
            return;
        }
        const movement = direction.normalize().scale(speed * Constants.DELTA_TIME);
        this.position = this.position.add(movement);
    }
}
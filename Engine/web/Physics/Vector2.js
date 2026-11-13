import MathLib from "../static/Math.js";


export class Vector2 {
    constructor(x, y) {
        this.x = x ?? 0;
        this.y = y ?? 0;
    }

    add(otherVector) {
        this.x += otherVector.x;
        this.y += otherVector.y;
        return this;
    }

    subtract(otherVector) {
        this.x -= otherVector.x;
        this.y -= otherVector.y;
        return this;
    }

    multiply(otherVector) {
        this.x *= otherVector.x;
        this.y *= otherVector.y;
        return this;
    }

    scale(scalar) {
        this.x *= scalar;
        this.y *= scalar;
        return this;
    }

    dot(otherVector) {
        return this.x * otherVector.x + this.y * otherVector.y;
    }

    cross(otherVector) {
        // In 2D, the cross product is a scalar representing the magnitude of the perpendicular vector
        return this.x * otherVector.y - this.y * otherVector.x;
    }

    magnitude() {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    magnitudeSq() {
        return this.x * this.x + this.y * this.y;
    }

    normalize() {
        const mag = this.magnitude();
        if (mag > 0) {
            this.x /= mag;
            this.y /= mag;
        }
        return this;
    }

    clone() {
        return new Vector2(this.x, this.y);
    }

    /** This vector's heading in degrees (0 = +x axis, increasing clockwise, matching Transform.rotation). */
    angle() {
        return Math.atan2(this.y, this.x) * (180 / Math.PI);
    }

    /** Heading in degrees from this point to another, e.g. aiming a turret at a target. */
    angleTo(other) {
        return Math.atan2(other.y - this.y, other.x - this.x) * (180 / Math.PI);
    }

    /** Rotates this vector in place by `degrees`, matching Transform.rotation's convention. */
    rotate(degrees) {
        const rad = MathLib.degreesToRadians(degrees);
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const x = this.x * cos - this.y * sin;
        const y = this.x * sin + this.y * cos;
        this.x = x;
        this.y = y;
        return this;
    }

    /** Moves this vector a fraction `t` (0-1) of the way toward `other`. */
    lerp(other, t) {
        this.x += (other.x - this.x) * t;
        this.y += (other.y - this.y) * t;
        return this;
    }

    /** Scales this vector down in place if it's longer than maxLength; leaves it alone otherwise. */
    clampMagnitude(maxLength) {
        const magSq = this.magnitudeSq();
        if (magSq > maxLength * maxLength && magSq > 0) {
            const scale = maxLength / Math.sqrt(magSq);
            this.x *= scale;
            this.y *= scale;
        }
        return this;
    }

    /** A unit vector (or one of `length`) pointing at `degrees`, matching Transform.rotation's convention. */
    static fromAngle(degrees, length = 1) {
        return new Vector2(MathLib.cos(degrees) * length, MathLib.sin(degrees) * length);
    }

    static distance(vector1, vector2) {
        return Math.sqrt(
            Math.pow(vector2.x - vector1.x, 2) +
            Math.pow(vector2.y - vector1.y, 2)
        );
    }

    static multiply(vector, scalar) {
        return new Vector2(vector.x * scalar, vector.y * scalar);
    }

    static transform(vector, transform) {

        const rotationInRadians = MathLib.degreesToRadians(transform.rotation);


        return new Vector2(
            Math.cos(rotationInRadians) * vector.x - Math.sin(rotationInRadians) * vector.y + transform.position.x,
            Math.sin(rotationInRadians) * vector.x + Math.cos(rotationInRadians) * vector.y + transform.position.y
        );
    }

    static get Left() {
        return new Vector2(-1, 0);
    }
    static get Right() {
        return new Vector2(1, 0);
    }
    static get Up() {
        return new Vector2(0, -1);
    }
    static get Down() {
        return new Vector2(0, 1);
    }
    static get Zero() {
        return new Vector2(0, 0);
    }

    static get One() {
        return new Vector2(1, 1);
    }
}
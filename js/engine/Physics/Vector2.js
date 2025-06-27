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

    magnitude() {
        return Math.sqrt(this.x * this.x + this.y * this.y);
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
export class PhysicsMaterial {

    //Friction coefficient, typically between 0 (no friction) and 1 (maximum friction)
    constructor(friction = 0.1, restitution = 0) {
        this.friction = friction;
        this.restitution = restitution;
    }

    static get Default() {
        return new PhysicsMaterial(0.1, 0.2);
    }

    static get Bouncy() {
        return new PhysicsMaterial(0.1, 0.6);
    }
    
    static get Frictionless() {
        return new PhysicsMaterial(0.2, 0.2);
    }
}
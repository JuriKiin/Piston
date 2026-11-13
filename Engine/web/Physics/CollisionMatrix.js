// Named collision layers as bit flags. Colliders default to Default and can opt into others
// by setting `collider.layer = Layers.Enemy`, etc. A collider may only belong to one layer.
export const Layers = {
    Default: 1 << 0,
    Player: 1 << 1,
    Enemy: 1 << 2,
    PlayerProjectile: 1 << 3,
    EnemyProjectile: 1 << 4,
    Wall: 1 << 5,
    Pickup: 1 << 6,
};

// Every layer pair collides by default. Call CollisionMatrix.ignore(layerA, layerB) to turn a
// pair off, e.g. so a projectile doesn't hit the layer it was fired from.
class CollisionMatrixImpl {
    constructor() {
        this.ignoredPairs = new Set();
    }

    #key(layerA, layerB) {
        return layerA < layerB ? `${layerA}-${layerB}` : `${layerB}-${layerA}`;
    }

    ignore(layerA, layerB, shouldIgnore = true) {
        const key = this.#key(layerA, layerB);
        if (shouldIgnore) {
            this.ignoredPairs.add(key);
        } else {
            this.ignoredPairs.delete(key);
        }
    }

    shouldCollide(layerA, layerB) {
        return !this.ignoredPairs.has(this.#key(layerA, layerB));
    }
}

export const CollisionMatrix = new CollisionMatrixImpl();

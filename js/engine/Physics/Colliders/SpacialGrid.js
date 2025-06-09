export class SpatialGrid {
    constructor(worldWidth, worldHeight, cellSize) {
        this.cellSize = cellSize;
        this.gridWidth = Math.ceil(worldWidth / cellSize);
        this.gridHeight = Math.ceil(worldHeight / cellSize);
        this.grid = new Map();
    }

    _getKey(x, y) {
        return `${x},${y}`;
    }

    clear() {
        this.grid.clear();
    }

    insert(entity) {
        const bounds = entity.rigidbody.collider.getBounds();
        const startX = Math.floor(bounds.left / this.cellSize);
        const startY = Math.floor(bounds.top / this.cellSize);
        const endX = Math.floor(bounds.right / this.cellSize);
        const endY = Math.floor(bounds.bottom / this.cellSize);
        for (let x = startX; x <= endX; x++) {
            for (let y = startY; y <= endY; y++) {
                const key = this._getKey(x, y);
                if (!this.grid.has(key)) {
                    this.grid.set(key, []);
                }
                this.grid.get(key).push(entity);
            }
        }
    }

    getNearby(entity) {
        const nearby = new Set();
        const bounds = entity.rigidbody.collider.getBounds();
        const startX = Math.floor(bounds.left / this.cellSize);
        const startY = Math.floor(bounds.top / this.cellSize);
        const endX = Math.floor(bounds.right / this.cellSize);
        const endY = Math.floor(bounds.bottom / this.cellSize);

        for (let x = startX; x <= endX; x++) {
            for (let y = startY; y <= endY; y++) {
                const key = this._getKey(x, y);
                if (this.grid.has(key)) {
                    const entities = this.grid.get(key);
                    for (const otherEntity of entities) {
                        if (otherEntity !== entity) {
                            nearby.add(otherEntity);
                        }
                    }
                }
            }
        }
        return Array.from(nearby);
    }
}
export class SpatialGrid {
    constructor(worldWidth, worldHeight, cellSize, drawGrid = false, ctx) {
        this.cellSize = cellSize;
        this.gridWidth = Math.ceil(worldWidth / cellSize);
        this.gridHeight = Math.ceil(worldHeight / cellSize);
        this.grid = new Map();
        this.drawGrid = drawGrid;
        this.ctx = ctx;
    }

    _getKey(x, y) {
        const offsetX = x + Math.abs(this.minX || 0);
        const offsetY = y + Math.abs(this.minY || 0);
        return `${offsetX},${offsetY}`;
    }

    update(entities) {
        this.grid.clear();

        for (const entity of entities) {
            this.insert(entity);
        }

        if (this.drawGrid) {
            this.drawGridLines();
            this.drawActiveCells(this.ctx);
        }
    }

    insert(entity) {
        const bounds = entity.rigidbody.collider.getTransformedBounds();

        const normalizedBounds = {
            left: Math.min(bounds.left.x, bounds.right.x),
            top: Math.min(bounds.top.y, bounds.bottom.y),
            right: Math.max(bounds.left.x, bounds.right.x),
            bottom: Math.max(bounds.top.y, bounds.bottom.y)
        };

        const startX = Math.floor(normalizedBounds.left / this.cellSize);
        const startY = Math.floor(normalizedBounds.top / this.cellSize);
        const endX = Math.floor(normalizedBounds.right / this.cellSize);
        const endY = Math.floor(normalizedBounds.bottom / this.cellSize);

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
        const bounds = entity.rigidbody.collider.getTransformedBounds();

        const normalizedBounds = {
            left: Math.min(bounds.left.x, bounds.right.x),
            top: Math.min(bounds.top.y, bounds.bottom.y),
            right: Math.max(bounds.left.x, bounds.right.x),
            bottom: Math.max(bounds.top.y, bounds.bottom.y)
        };

        const startX = Math.floor(normalizedBounds.left / this.cellSize);
        const startY = Math.floor(normalizedBounds.top / this.cellSize);
        const endX = Math.floor(normalizedBounds.right / this.cellSize);
        const endY = Math.floor(normalizedBounds.bottom / this.cellSize);

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

    drawGridLines() {
        this.ctx.save();
        this.ctx.strokeStyle = 'lightgray';

        // Draw grid lines starting from 0,0
        for (let x = 0; x < this.gridWidth; x++) {
            const cellX = x * this.cellSize;
            this.ctx.beginPath();
            this.ctx.moveTo(cellX, 0);
            this.ctx.lineTo(cellX, this.gridHeight * this.cellSize);
            this.ctx.stroke();
        }
        for (let y = 0; y < this.gridHeight; y++) {
            const cellY = y * this.cellSize;
            this.ctx.beginPath();
            this.ctx.moveTo(0, cellY);
            this.ctx.lineTo(this.gridWidth * this.cellSize, cellY);
            this.ctx.stroke();
        }

        this.ctx.restore();
    }

    drawActiveCells(ctx) {
        if (!ctx) return;

        ctx.save();
        ctx.strokeStyle = 'blue';
        for (const [key, entities] of this.grid.entries()) {
            if (entities.length > 0) {
                const [x, y] = key.split(',').map(Number);
                const cellX = x * this.cellSize;
                const cellY = y * this.cellSize;
                const adjustedX = cellX + Math.abs(this.minX * this.cellSize || 0);
                const adjustedY = cellY + Math.abs(this.minY * this.cellSize || 0);

                ctx.strokeRect(adjustedX, adjustedY, this.cellSize, this.cellSize);
            }
        }
        ctx.restore();
    }
}
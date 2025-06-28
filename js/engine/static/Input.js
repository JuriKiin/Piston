class Input {
    constructor() {
        this.keys = new Set();
        this.keysUp = new Set();
        this.mouse = {
            position: { x: 0, y: 0 },
            buttons: new Set()
        };

        window.addEventListener("keydown", (event) => {
            this.keys.add(event.code);
        });

        window.addEventListener("keyup", (event) => {
            this.keys.delete(event.code);
            this.keysUp.add(event.code);
        });

        window.addEventListener("mousemove", (event) => {
            this.mouse.position.x = event.clientX;
            this.mouse.position.y = event.clientY;
        });

        window.addEventListener("mousedown", (event) => {
            this.mouse.buttons.add(event.button);
        });

        window.addEventListener("mouseup", (event) => {
            this.mouse.buttons.delete(event.button);
        });
    }

    getKeyDown(key) {
        return this.keys.has(key);
    }

    getKeyUp(key) {
        if (this.keysUp.has(key)) {
            this.keysUp.delete(key); // Clear the key immediately after checking
            return true;
        }
        return false;
    }

    lateUpdate() {
        this.keysUp.clear();
    }

    isMouseButtonPressed(button) {
        return this.mouse.buttons.has(button);
    }
    getMousePosition() {
        return { x: this.mouse.position.x, y: this.mouse.position.y };
    }
    clear() {
        this.keys.clear();
        this.mouse.buttons.clear();
    }
    update() {
        // This method can be used to clear the input state if needed
        // For example, if you want to reset the keys after processing them
        this.clear();
    }
    destroy() {
        // Clean up event listeners if necessary
        window.removeEventListener("keydown", this.handleKeyDown);
        window.removeEventListener("keyup", this.handleKeyUp);
        window.removeEventListener("mousemove", this.handleMouseMove);
        window.removeEventListener("mousedown", this.handleMouseDown);
        window.removeEventListener("mouseup", this.handleMouseUp);
    }
    isMouseOverElement(element) {
        const rect = element.getBoundingClientRect();
        const mousePos = this.getMousePosition();
        return (
            mousePos.x >= rect.left &&
            mousePos.x <= rect.right &&
            mousePos.y >= rect.top &&
            mousePos.y <= rect.bottom
        );
    }
    isMouseOverCanvas(canvas) {
        const rect = canvas.getBoundingClientRect();
        const mousePos = this.getMousePosition();
        return (
            mousePos.x >= rect.left &&
            mousePos.x <= rect.right &&
            mousePos.y >= rect.top &&
            mousePos.y <= rect.bottom
        );
    }
    isMouseOverCanvasElement(canvas, element) {
        const rect = element.getBoundingClientRect();
        const mousePos = this.getMousePosition();
        return (
            mousePos.x >= rect.left &&
            mousePos.x <= rect.right &&
            mousePos.y >= rect.top &&
            mousePos.y <= rect.bottom &&
            this.isMouseOverCanvas(canvas)
        );
    }
}

const input = new Input();
export default input;
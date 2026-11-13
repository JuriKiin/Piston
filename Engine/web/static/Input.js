class Input {
    constructor() {
        this.keys = new Set();
        this.keysUp = new Set();
        // Edge sets: filled by the DOM events the instant they happen, emptied by endStep() after each simulation step. A press and release that both
        // land between two steps (a quick tap) still shows up in `pressed` for the next step, which a held-keys-only set would miss.
        this.pressed = new Set();
        this.released = new Set();
        this.mousePressed = new Set();
        this.mouseReleased = new Set();
        this.mouse = {
            position: { x: 0, y: 0 },
            buttons: new Set()
        };
        this.canvas = null;

        window.addEventListener("keydown", (event) => {
            if (!event.repeat) this.pressed.add(event.code); // key auto-repeat is not a new press
            this.keys.add(event.code);
        });

        window.addEventListener("keyup", (event) => {
            this.keys.delete(event.code);
            this.keysUp.add(event.code);
            this.released.add(event.code);
        });

        window.addEventListener("mousemove", (event) => {
            this.mouse.position.x = event.clientX;
            this.mouse.position.y = event.clientY;
        });

        window.addEventListener("mousedown", (event) => {
            this.mouse.buttons.add(event.button);
            this.mousePressed.add(event.button);
        });

        window.addEventListener("mouseup", (event) => {
            this.mouse.buttons.delete(event.button);
            this.mouseReleased.add(event.button);
        });
    }

    /** True while the key is held, and also for the step after a tap that was pressed and released between two steps. */
    getKeyDown(key) {
        return this.keys.has(key) || this.pressed.has(key);
    }

    /** True for exactly one simulation step after the key went down (never repeats while held; a quick tap counts). */
    wasPressed(key) {
        return this.pressed.has(key);
    }

    /** True for exactly one simulation step after the key came up. */
    wasReleased(key) {
        return this.released.has(key);
    }

    /** Mouse button edges, same rules as wasPressed/wasReleased (0 = left, 1 = middle, 2 = right). */
    wasMousePressed(button = 0) {
        return this.mousePressed.has(button);
    }

    wasMouseReleased(button = 0) {
        return this.mouseReleased.has(button);
    }

    /** Ends an input step: forgets the press/release edges. GameLoop calls this after every simulation step (and every frozen frame). */
    endStep() {
        this.pressed.clear();
        this.released.clear();
        this.mousePressed.clear();
        this.mouseReleased.clear();
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

    /** True while the button is held, and for the step after a click that was pressed and released between two steps. */
    isMouseButtonPressed(button) {
        return this.mouse.buttons.has(button) || this.mousePressed.has(button);
    }
    getMousePosition() {
        return { x: this.mouse.position.x, y: this.mouse.position.y };
    }
    /** Registers the game canvas so getCanvasMousePosition() can convert client -> canvas coords. */
    setCanvas(canvas) {
        this.canvas = canvas;
    }
    /**
     * Mouse position in canvas pixel space (accounts for the canvas's page offset and any CSS
     * scaling between its element size and its internal resolution). Falls back to raw client
     * coordinates if setCanvas() hasn't been called.
     */
    getCanvasMousePosition() {
        if (!this.canvas) return this.getMousePosition();
        const rect = this.canvas.getBoundingClientRect();
        if (!(rect.width > 0) || !(rect.height > 0)) return this.getMousePosition(); // a canvas with no layout box (hidden tab, mid-resize) would give NaN
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        return {
            x: (this.mouse.position.x - rect.left) * scaleX,
            y: (this.mouse.position.y - rect.top) * scaleY,
        };
    }
    clear() {
        this.keys.clear();
        this.mouse.buttons.clear();
        this.endStep();
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
// @template: Game Manager
// @kind: entity
// @summary: An invisible singleton for game rules: score, timers, win and lose. One per scene.
import { Entity } from "@piston/Entity.js";
import { Vector2 } from "@piston/Physics/Vector2.js";
import Constants from "@piston/static/Constants.js";
import { EntityRegistry } from "@piston/EntityRegistry.js";

export class {{Class}} extends Entity {
    static fields = [
        { key: 'startMessage', label: 'Start message', type: 'text' },
    ];

    constructor() {
        super();
        this.tag = '{{Class}}';
        this.startMessage = '{{Class}} ready';
        this.elapsed = 0;
        this.score = 0;
    }

    start() {
        // Gives it a box so you can still click it in the editor; it draws nothing in the game.
        this.transform.size = new Vector2(24, 24);
        console.log(this.startMessage);
    }

    update() {
        super.update();
        this.elapsed += Constants.DELTA_TIME;
        // Game rules go here. Find other entities with: window.Piston.gameLoop.findObjectWithTag('Player')
    }

    addScore(points) {
        this.score += points;
    }

    captureEditState() {
        const state = super.captureEditState();
        state.elapsed = this.elapsed;
        state.score = this.score;
        return state;
    }

    restoreEditState(state) {
        super.restoreEditState(state);
        this.elapsed = state.elapsed;
        this.score = state.score;
    }
}

EntityRegistry.register('{{Class}}', {{Class}}, 'Game');

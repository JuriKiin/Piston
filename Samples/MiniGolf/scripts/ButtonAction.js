import { Component } from "@piston/Component.js";
import { ComponentRegistry } from "@piston/ComponentRegistry.js";
import { Button } from "@piston/UI/Button.js";
import { UIContainer } from "@piston/UI/UIContainer.js";
import { LevelFlow } from "@piston/LevelFlow.js";
import { sfx } from "./Sfx.js";

/**
 * Makes a Button do something, from the Inspector: put it next to the engine's Button (and a UIContainer for the look) on a UI entity.
 *  - New game: forget the scores and open the `Target` scene (default hole1).
 *  - Open scene: open the `Target` scene.
 *  - Main menu: open the "menu" scene.
 * The button also lights up in `Hover color` while the mouse is over it.
 */
export class ButtonAction extends Component {
    static description = "Gives a Button a job: start a new game, open a scene, or go to the main menu. Also sets the hover color.";

    static fields = [
        { key: 'action', label: 'Action', type: 'select', options: ['newGame', 'openScene', 'mainMenu'] },
        { key: 'target', label: 'Scene to open', type: 'text' },
        { key: 'hoverColor', label: 'Hover color', type: 'color' },
    ];

    constructor({ action = 'openScene', target = '', hoverColor = '#3fa35e' } = {}) {
        super();
        this.action = action;
        this.target = target;
        this.hoverColor = hoverColor;
        this.wired = false;
    }

    update() {
        const button = this.entity.getComponent(Button);
        const container = this.entity.getComponent(UIContainer);
        if (!button) return;
        if (!this.wired) { // saved fields only exist after start(), so wire on the first update
            this.wired = true;
            this.baseColor = container?.color;
            button.onClick = () => this.#run();
        }
        if (container) container.color = button.isHovering ? this.hoverColor : this.baseColor;
    }

    #run() {
        sfx.play('click', { minGap: 0.2 });
        const loop = window.Piston.gameLoop;
        if (this.action === 'newGame') { LevelFlow.reset(); loop.scenes.load(this.target || 'hole1'); }
        else if (this.action === 'mainMenu') loop.scenes.load('menu');
        else if (this.target) loop.scenes.load(this.target);
    }

    restoreState() { this.wired = false; }
}

ComponentRegistry.register('ButtonAction', ButtonAction, 'game');

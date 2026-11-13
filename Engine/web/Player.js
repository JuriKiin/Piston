// The web Player: how an exported (or Run-in-Browser) game starts. No editor tools are ever loaded.
import GameLoop from './GameLoop.js';
import { SceneRegistry } from './SceneRegistry.js';

/**
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {string} [options.startScene] id of the scene to open first (default: the first registered scene)
 * @param {object} [options.data] compiled project data ({ scenes, prefabs }) for release builds
 */
export async function startGame({ canvas, startScene, data } = {}) {
    if (data) globalThis.__PISTON_DATA__ = data;

    // Same rule as the editor's Game view: with a design resolution the canvas keeps that size and is scaled (letterboxed) to fit the
    // window, so the game looks identical at any window size. Without one it simply fills the window.
    const design = globalThis.__PISTON_PROJECT__?.resolution;
    if (Array.isArray(design) && design[0] > 0 && design[1] > 0) {
        canvas.width = design[0];
        canvas.height = design[1];
        const fit = () => {
            const scale = Math.min(window.innerWidth / design[0], window.innerHeight / design[1]);
            canvas.style.width = `${Math.floor(design[0] * scale)}px`;
            canvas.style.height = `${Math.floor(design[1] * scale)}px`;
        };
        fit();
        window.addEventListener('resize', fit);
    } else {
        const resize = () => { canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; };
        canvas.style.width = '100%'; canvas.style.height = '100%';
        resize();
        window.addEventListener('resize', resize);
    }

    const scene = (startScene && SceneRegistry.get(startScene)) || SceneRegistry.list()[0];
    if (!scene) throw new Error('This game has no scenes. Create one in the Piston editor.');

    const loop = new GameLoop(canvas, scene, { devTools: false });
    window.Piston = { gameLoop: loop, scenes: loop.scenes, audio: loop.audio }; // game code reaches the loop through this (ENGINE_GUIDE section 4)
    await loop.start();
    loop.play();
    return loop;
}

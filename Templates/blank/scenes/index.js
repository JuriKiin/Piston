import { Scene } from '@piston/Scene.js';
import { SceneRegistry } from '@piston/SceneRegistry.js';

// Every scene in this game. Its layout lives next to this file as <id>.json; the editor adds a line here
// whenever you create a scene (File Explorer > New Scene).
export const Scene_main = new Scene({ id: 'main', name: 'Main', backgroundColor: '#1b1d23' });
SceneRegistry.register(Scene_main);

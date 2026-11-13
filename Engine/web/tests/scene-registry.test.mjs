// Run: node Engine/web/tests/scene-registry.test.mjs
import assert from 'node:assert/strict';
import { SceneRegistry } from '../SceneRegistry.js';
import { Scene } from '../Scene.js';
import { SceneManager } from '../SceneManager.js';

globalThis.__PISTON_PROJECT__ = { sceneIds: ['hole1', 'hole2', 'hole10'] };
const custom = new Scene({ id: 'hole2', name: 'Custom Two', backgroundColor: '#123456' });
SceneRegistry.register(custom); // a game may still register some scenes by hand
SceneRegistry.register(new Scene({ id: 'extra', name: 'Extra' }));

SceneRegistry.syncFromProject();
assert.deepEqual(SceneRegistry.list().map(s => s.id), ['hole1', 'hole2', 'hole10', 'extra']);
assert.equal(SceneRegistry.get('hole2'), custom);                 // hand-registered scene objects are kept
assert.equal(SceneRegistry.get('hole1').name, 'hole1');           // missing ones are created from the project's files
SceneRegistry.syncFromProject();                                  // idempotent
assert.equal(SceneRegistry.list().length, 4);

const loop = { scene: SceneRegistry.get('hole1'), loaded: [], async loadScene(s) { this.scene = s; this.loaded.push(s.id); } };
const mgr = new SceneManager(loop);
assert.equal(mgr.nextScene.id, 'hole2');
assert.equal(await mgr.next(), true);
assert.equal(await mgr.load('hole10'), true);
assert.equal(mgr.nextScene.id, 'extra');
assert.equal(await mgr.load('nope'), false);
await mgr.restart();
assert.deepEqual(loop.loaded, ['hole2', 'hole10', 'hole10']);
console.log('PASS scene registry sync + manager\n');

// LevelFlow.finish: records, then follows nextScene, else the scene order, else reports the course is done.
const { LevelFlow, LevelInfo } = await import('../LevelFlow.js');
LevelFlow.reset();
const fl = { scene: SceneRegistry.get('hole1'), entities: [{ components: [new LevelInfo({ par: 3 })] }], async loadScene(s) { this.scene = s; } };
fl.scenes = new SceneManager(fl);
let r = await LevelFlow.finish(fl, 4);
assert.equal(fl.scene.id, 'hole2'); assert.equal(r.done, false); assert.equal(r.totals.strokes, 4);
fl.entities = [{ components: [new LevelInfo({ par: 3, nextScene: 'extra' })] }];
r = await LevelFlow.finish(fl, 2);
assert.equal(fl.scene.id, 'extra');                         // an explicit nextScene beats the scene order
fl.entities = [{ components: [new LevelInfo({ par: 3 })] }];
r = await LevelFlow.finish(fl, 1);                          // 'extra' is last: nothing left
assert.equal(r.done, true); assert.equal(r.totals.levels, 3);
console.log('PASS LevelFlow.finish');

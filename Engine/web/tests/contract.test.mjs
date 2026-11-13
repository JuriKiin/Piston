// Run: node Engine/web/tests/contract.test.mjs   (no browser needed)
// The engine contract's conformance checks: the scene validator's rules, and every shipped sample/template scene passing them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateScene } from '../SceneValidator.js';
import { ComponentRegistry } from '../ComponentRegistry.js';
import { EntityRegistry } from '../EntityRegistry.js';
import '../Animator.js';
import '../ShapeRenderer.js';
import '../PolygonRenderer.js';
import '../PhysicsMaterialComponent.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fieldsOf = (C) => (C.fields ?? []).map(f => ({ ...f }));
const schemas = {
    entities: EntityRegistry.entries.map(e => ({ name: e.name, fields: fieldsOf(e.EntityClass) })),
    components: ComponentRegistry.entries.map(c => ({ name: c.name, fields: fieldsOf(c.ComponentClass) })),
};
const ent = (key, extra = {}) => ({ sceneKey: key, type: 'Empty', tag: 'Empty', transform: { position: { x: 0, y: 0 }, rotation: 0, size: { x: 10, y: 10 } }, fields: {}, components: [], ...extra });
const check = (entities, extra = {}) => validateScene({ version: 1, entities, ...extra }, { entities: [{ name: 'Empty', fields: [] }, ...schemas.entities], components: schemas.components });
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('PASS', name); };
const messages = (r) => [...r.errors, ...r.warnings].map(i => i.message).join(' | ');

test('a minimal valid scene has no issues', () => { const r = check([ent('a'), ent('b', { parentKey: 'a' })]); assert.equal(r.errors.length + r.warnings.length, 0, messages(r)); });
test('scene shape: not an object, no entities array', () => {
    assert.ok(validateScene(null).errors.length); assert.ok(validateScene({}).errors[0].message.includes('entities'));
});
test('every entity needs a unique sceneKey', () => {
    assert.match(messages(check([ent('a'), ent('a')])), /Duplicate sceneKey "a"/);
    assert.match(messages(check([ent(undefined)])), /no `sceneKey`/);
});
test('transform values must be finite numbers', () => {
    const bad = ent('a'); bad.transform.position.x = 'ten'; bad.transform.size.y = NaN;
    const r = check([bad]); assert.equal(r.errors.length, 2, messages(r));
    assert.ok(check([{ ...ent('b'), transform: undefined }]).errors.some(i => i.message.includes('Missing `transform`')));
});
test('parent links: missing parent warns, self and cycles are errors', () => {
    assert.match(messages(check([ent('a', { parentKey: 'ghost' })])), /doesn't exist/);
    assert.match(messages(check([ent('a', { parentKey: 'a' })])), /own parent/);
    assert.match(messages(check([ent('a', { parentKey: 'b' }), ent('b', { parentKey: 'a' })])), /cycle/);
});
test('unregistered entity and component types warn (they are skipped at load), they do not fail', () => {
    const r = check([ent('a', { type: 'Nope', components: [{ type: 'Mystery', fields: {} }] })]);
    assert.equal(r.errors.length, 0); assert.match(messages(r), /Entity type "Nope"/); assert.match(messages(r), /Component type "Mystery"/);
});
test('field values are checked against their declared types', () => {
    const r = check([ent('a', { components: [{ type: 'ShapeRenderer', fields: { radius: 'big', color: 12, strokeWidth: 3, shape: 'circle', opacity: 0.5 } }] })]);
    assert.ok(r.errors.some(i => i.path.endsWith('radius'))); assert.ok(r.errors.some(i => i.path.endsWith('color'))); assert.equal(r.errors.length, 2, messages(r));
    assert.match(messages(check([ent('b', { components: [{ type: 'ShapeRenderer', fields: { bogus: 1 } }] })])), /isn't a declared field/);
    assert.equal(check([ent('c', { components: [{ type: 'ShapeRenderer', fields: { strokeColor: null } }] })]).errors.length, 0); // unset is fine
});
test('every CSS color form passes; nonsense warns', () => {
    for (const c of ['#fff', '#ffcc00', '#ffcc0080', 'rgb(1,2,3)', 'rgba(1,2,3,0.5)', 'white']) assert.equal(check([ent('a', { components: [{ type: 'ShapeRenderer', fields: { color: c } }] })]).warnings.length, 0, c);
    assert.ok(check([ent('a', { components: [{ type: 'ShapeRenderer', fields: { color: '#12' } }] })]).warnings.length);
});
test('animator clips: structure, durations, keys, easing, paths, defaults', () => {
    const clip = { name: 'idle', duration: 1, loop: true, tracks: [{ path: 'ShapeRenderer.color', keys: [{ t: 0, v: '#000000' }, { t: 1, v: '#ffffff', ease: 'easeIn' }] }, { path: 'transform.position.x', keys: [{ t: 0, v: 0 }] }], events: [{ t: 0.5, name: 'x' }] };
    const make = (c, f = {}) => check([ent('a', { components: [{ type: 'ShapeRenderer', fields: {} }, { type: 'Animator', fields: { clips: [c], defaultClip: 'idle', ...f } }] })]);
    assert.equal(make(clip).errors.length + make(clip).warnings.length, 0, messages(make(clip)));
    assert.match(messages(make({ ...clip, duration: 0 })), /duration/);
    assert.match(messages(make({ ...clip, tracks: [{ path: 'ShapeRenderer.nope', keys: [{ t: 0, v: 1 }] }] })), /isn't an animatable property/);
    assert.match(messages(make({ ...clip, tracks: [{ path: 'transform.rotation', keys: [{ t: 5, v: 1 }] }] })), /after the clip ends/);
    assert.match(messages(make({ ...clip, tracks: [{ path: 'transform.rotation', keys: [{ t: 0, v: 1, ease: 'wobble' }] }] })), /Unknown easing/);
    assert.match(messages(make(clip, { defaultClip: 'missing' })), /Default clip/);
    assert.match(messages(make(clip, { asset: './assets/animations/x.anim.json' })), /inline clips win/);
});

// Every scene we ship must satisfy the contract (unknown game types are only warnings, so game-specific scenes still pass).
const roots = [path.resolve(here, '../../../Samples'), path.resolve(here, '../../../Templates')];
const scenes = [];
const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) { if (f.name !== 'node_modules') walk(p); } else if (p.includes(`${path.sep}scenes${path.sep}`) && p.endsWith('.json')) scenes.push(p); } };
roots.filter(fs.existsSync).forEach(walk);
test(`all ${scenes.length} shipped scenes pass the contract with no errors`, () => {
    assert.ok(scenes.length >= 2);
    for (const file of scenes) {
        const r = validateScene(JSON.parse(fs.readFileSync(file, 'utf8')), schemas);
        assert.equal(r.errors.length, 0, `${path.relative(path.resolve(here, '../../..'), file)}: ${r.errors.map(i => `${i.path}: ${i.message}`).join(' | ')}`);
    }
});
console.log(`\n${passed} passed`);

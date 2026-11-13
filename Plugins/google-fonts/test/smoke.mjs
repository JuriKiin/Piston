// Run: node Plugins/google-fonts/test/smoke.mjs   (needs network: it talks to Google's real font catalog and GitHub)
// Drives the plugin through a fake `piston` backed by real fetch and a temp folder, exactly the way Piston's host would.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import plugin, { parseMetadata, manifestEntry, localName, searchCatalog } from '../index.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-'));
const allowedHosts = new Set(['fonts.google.com', 'raw.githubusercontent.com']);
const checkHost = (u) => { if (!allowedHosts.has(new URL(u).host)) throw new Error('host not allowed'); };
const ok = (r, u) => { if (!r.ok) throw new Error(`HTTP ${r.status} ${u}`); return r; };
let spec;
const piston = {
  commands: { register: (id, fn) => { piston.run = fn; } },
  ui: { pick: (s) => { spec = s; } },
  net: {
    fetchText: async (u) => { checkHost(u); return (ok(await fetch(u), u)).text(); },
    download: async (u, rel) => { checkHost(u); assert.ok(rel.startsWith('assets/fonts/') && !rel.includes('..')); const buf = Buffer.from(await (ok(await fetch(u), u)).arrayBuffer());
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), buf); },
  },
  project: {
    readText: (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return ''; } },
    writeText: (rel, text) => { assert.ok(rel.startsWith('assets/fonts/')); fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); },
  },
};
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log('PASS', name); };

await test('metadata parsing: files, weights, variable axes, license', () => {
  const m = parseMetadata(`name: "Roboto"\nlicense: "OFL"\nfonts {\n  style: "normal"\n  weight: 400\n  filename: "Roboto[wdth,wght].ttf"\n}\nfonts {\n  style: "italic"\n  weight: 400\n  filename: "Roboto-Italic[wdth,wght].ttf"\n}\naxes {\n  tag: "wght"\n  min_value: 100.0\n  max_value: 900.0\n}\n`);
  assert.equal(m.license, 'OFL'); assert.equal(m.fonts.length, 2); assert.deepEqual(m.axes.wght, [100, 900]);
  assert.equal(localName('Roboto-Italic[wdth,wght].ttf'), 'Roboto-Italic-VF.ttf');
  const e = manifestEntry('Roboto', m); assert.equal(e.files[0].weight, '100 900'); assert.equal(e.files[1].style, 'italic'); assert.equal(e.files[0].file, './assets/fonts/Roboto/Roboto-VF.ttf');
});

plugin.activate(piston); piston.run({ selection: [] });

await test('search lists real fonts, most popular first, filtered by every word', async () => {
  const items = await spec.search('press start');
  assert.ok(items.some((i) => i.id === 'Press Start 2P'), JSON.stringify(items.slice(0, 5)));
  const all = await spec.search('');
  assert.equal(all.length, 100); assert.ok(searchCatalog([], 'x').length === 0);
});

await test('selecting a family shows its license and files', async () => {
  const d = await spec.select({ id: 'Press Start 2P' });
  assert.match(d.text, /Open Font License/); assert.match(d.text, /PressStart2P-Regular\.ttf/); assert.equal(d.actions[0].id, 'download');
  assert.equal(d.fontPreview.files.length, 1); assert.equal(d.fontPreview.files[0].label, 'Regular');
  const res = await fetch(d.fontPreview.files[0].url); assert.equal(res.status, 200);                  // the preview file is real
  const roboto = await spec.select({ id: 'Roboto' }); assert.deepEqual(roboto.fontPreview.files.map((f) => f.label), ['Regular', 'Italic']);
  assert.ok(roboto.fontPreview.files[0].url.includes('Roboto%5Bwdth%2Cwght%5D.ttf'));
});

await test('download writes the font, its license, and merges fonts.json', async () => {
  const progress = [];
  const msg = await spec.run('download', { id: 'Press Start 2P' }, (t) => progress.push(t));
  const ttf = path.join(root, 'assets/fonts/Press Start 2P/PressStart2P-Regular.ttf');
  assert.ok(fs.statSync(ttf).size > 10000, 'font file is real'); assert.equal(fs.readFileSync(ttf).subarray(0, 4).toString('hex'), '00010000'); // TrueType header
  assert.ok(fs.existsSync(path.join(root, 'assets/fonts/Press Start 2P/OFL.txt')));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/fonts/fonts.json'), 'utf8'));
  assert.equal(manifest['Press Start 2P'].files[0].weight, 400); assert.match(msg, /Press Start 2P/); assert.ok(progress.length >= 1);
});

await test('a variable font (brackets in the file name) downloads and a second family merges in', async () => {
  await spec.run('download', { id: 'Roboto' }, () => {});
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/fonts/fonts.json'), 'utf8'));
  assert.ok(manifest['Press Start 2P'] && manifest['Roboto']);
  assert.ok(fs.existsSync(path.join(root, 'assets/fonts/Roboto/Roboto-VF.ttf')));
});

await test('an unknown family reports a clear error', async () => {
  await assert.rejects(() => spec.select({ id: 'Definitely Not A Font 123' }), /Couldn't find the files/);
});

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed`);

// Google Fonts for Piston: search the open-source font library, download a family into the project, and use it by name.
//
// Fonts are saved to  assets/fonts/<Family>/  together with the family's license, and listed in  assets/fonts/fonts.json.
// The engine's Text component loads from that file first (no network at play time), and only falls back to the Google CDN
// for families that aren't in the project.
//
// About licenses: Google Fonts are open-source licensed, not public domain. Almost all are SIL OFL 1.1 (free for any game,
// commercial included; keep the license file with the font), the rest Apache 2.0 or the Ubuntu Font License. The plugin
// shows each family's license before you download.

const CATALOG_URL = 'https://fonts.google.com/metadata/fonts';
const RAW = 'https://raw.githubusercontent.com/google/fonts/main';
const FONTS_DIR = 'assets/fonts';

const LICENSES = {
  OFL: { dir: 'ofl', name: 'SIL Open Font License 1.1', files: ['OFL.txt', 'LICENSE.txt'] },
  APACHE2: { dir: 'apache', name: 'Apache License 2.0', files: ['LICENSE.txt'] },
  UFL: { dir: 'ufl', name: 'Ubuntu Font License 1.0', files: ['UFL.txt', 'LICENSE.txt'] },
};

export const slugOf = (family) => family.toLowerCase().replace(/[^a-z0-9]/g, '');

/** "Roboto[wdth,wght].ttf" → "Roboto-VF.ttf" (no brackets in project file names). */
export const localName = (filename) => filename.replace(/\[[^\]]*\]/, '-VF');

/** Parses the few fields we need from a family's METADATA.pb (protobuf text format). */
export function parseMetadata(text) {
  const grab = (re) => (re.exec(text) || [])[1];
  const fonts = [...text.matchAll(/^fonts\s*\{([\s\S]*?)^\}/gm)].map((m) => ({
    style: (/style:\s*"([^"]+)"/.exec(m[1]) || [])[1] || 'normal',
    weight: Number((/weight:\s*(\d+)/.exec(m[1]) || [])[1] || 400),
    filename: (/filename:\s*"([^"]+)"/.exec(m[1]) || [])[1],
  })).filter((f) => f.filename);
  const axes = {};
  for (const m of text.matchAll(/^axes\s*\{([\s\S]*?)^\}/gm)) {
    const tag = (/tag:\s*"([^"]+)"/.exec(m[1]) || [])[1];
    if (tag) axes[tag] = [Number((/min_value:\s*([\d.]+)/.exec(m[1]) || [])[1]), Number((/max_value:\s*([\d.]+)/.exec(m[1]) || [])[1])];
  }
  return { name: grab(/^name:\s*"([^"]+)"/m), designer: grab(/^designer:\s*"([^"]+)"/m), license: grab(/^license:\s*"([^"]+)"/m) || 'OFL', fonts, axes };
}

/** The fonts.json entry for a family: one record per file, with the CSS weight range for variable fonts. */
export function manifestEntry(family, meta) {
  return {
    license: meta.license,
    files: meta.fonts.map((f) => ({
      file: `./${FONTS_DIR}/${family}/${localName(f.filename)}`,
      weight: f.filename.includes('[') && meta.axes.wght ? `${meta.axes.wght[0]} ${meta.axes.wght[1]}` : f.weight,
      style: f.style,
    })),
  };
}

let catalog = null;

async function loadCatalog(piston) {
  if (catalog) return catalog;
  const text = await piston.net.fetchText(CATALOG_URL);
  catalog = JSON.parse(text.slice(text.indexOf('{'))).familyMetadataList; // the endpoint prefixes its JSON with a guard line
  return catalog;
}

export function searchCatalog(list, query) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return list
    .filter((f) => words.every((w) => `${f.family} ${f.category} ${(f.classifications || []).join(' ')}`.toLowerCase().includes(w)))
    .sort((a, b) => a.popularity - b.popularity)
    .slice(0, 100)
    .map((f) => ({ id: f.family, title: f.family, subtitle: `${f.category} · ${Object.keys(f.fonts).length} styles` }));
}

/** Finds the family's folder in the google/fonts repo (ofl, apache or ufl) and reads its metadata. */
async function loadFamily(piston, family) {
  const slug = slugOf(family);
  for (const info of Object.values(LICENSES)) {
    try {
      const text = await piston.net.fetchText(`${RAW}/${info.dir}/${slug}/METADATA.pb`);
      return { dir: info.dir, slug, meta: parseMetadata(text) };
    } catch { /* not in this folder */ }
  }
  throw new Error(`Couldn't find the files for "${family}" on GitHub`);
}

function describe(family, { meta }) {
  const lic = LICENSES[meta.license] || LICENSES.OFL;
  const variable = meta.fonts.some((f) => f.filename.includes('['));
  return [
    family + (meta.designer ? `\nby ${meta.designer}` : ''),
    `\nLicense: ${lic.name}`,
    meta.license === 'OFL'
      ? 'Free to use and embed in any game, commercial included. Keep the license file with the font (it is saved next to it). Not public domain.'
      : 'Free to use in games. Keep the license file with the font (it is saved next to it). Not public domain.',
    `\nFiles: ${meta.fonts.length}${variable ? ` (variable font, weights ${meta.axes.wght ? meta.axes.wght.join('–') : 'adjustable'})` : ''}`,
    meta.fonts.map((f) => `  • ${f.filename}`).join('\n'),
    `\nSaves to ${FONTS_DIR}/${family}/. Then set a Text component's Font to "${family}".`,
  ].join('\n');
}

/** The files Piston should draw a preview with: the regular style, plus the italic if the family has one. */
export function previewOf({ dir, slug, meta }) {
  const pick = (style) => meta.fonts.find((f) => f.style === style && (style === 'italic' || f.weight === 400)) || meta.fonts.find((f) => f.style === style);
  const files = [pick('normal'), pick('italic')].filter(Boolean);
  if (!files.length && meta.fonts[0]) files.push(meta.fonts[0]);
  return {
    sample: 'The quick brown fox jumps over the lazy dog 0123456789',
    files: files.map((f) => ({ url: `${RAW}/${dir}/${slug}/${encodeURIComponent(f.filename)}`, label: f.style === 'italic' ? 'Italic' : 'Regular' })),
  };
}

async function install(piston, family, found, report) {
  const { dir, slug, meta } = found;
  const base = `${FONTS_DIR}/${family}`;
  let n = 0;
  for (const f of meta.fonts) {
    report(`Downloading ${f.filename} (${++n}/${meta.fonts.length})…`);
    await piston.net.download(`${RAW}/${dir}/${slug}/${encodeURIComponent(f.filename)}`, `${base}/${localName(f.filename)}`);
  }
  const lic = LICENSES[meta.license] || LICENSES.OFL;
  for (const name of lic.files) { // best effort: the license text that ships with the family
    try { piston.project.writeText(`${base}/${name}`, await piston.net.fetchText(`${RAW}/${dir}/${slug}/${name}`)); break; } catch { /* try the next name */ }
  }
  let manifest = {};
  try { manifest = JSON.parse(piston.project.readText(`${FONTS_DIR}/fonts.json`) || '{}'); } catch { manifest = {}; }
  manifest[family] = manifestEntry(family, meta);
  piston.project.writeText(`${FONTS_DIR}/fonts.json`, JSON.stringify(manifest, null, 2));
  return `Added ${family}: ${meta.fonts.length} file${meta.fonts.length === 1 ? '' : 's'} in ${base}. Use "${family}" as a Text component's font.`;
}

export default {
  activate(piston) {
    piston.commands.register('search', () => {
      const cache = new Map();
      piston.ui.pick({
        title: 'Google Fonts',
        placeholder: 'Search fonts (e.g. "pixel", "serif", "Press Start")',
        hint: 'Open-source fonts, downloaded into assets/fonts. The license is shown before you download.',
        search: async (query) => searchCatalog(await loadCatalog(piston), query),
        select: async (item) => {
          if (!cache.has(item.id)) cache.set(item.id, await loadFamily(piston, item.id));
          const found = cache.get(item.id);
          return { text: describe(item.id, found), fontPreview: previewOf(found), actions: [{ id: 'download', title: 'Download to Project' }] };
        },
        run: async (actionId, item, report) => {
          if (!cache.has(item.id)) cache.set(item.id, await loadFamily(piston, item.id));
          return install(piston, item.id, cache.get(item.id), report);
        },
      });
    });
  },
};

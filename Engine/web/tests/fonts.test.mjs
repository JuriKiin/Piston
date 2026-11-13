// Run: node Engine/web/tests/fonts.test.mjs   (no browser needed)
import assert from 'node:assert/strict';
import { GoogleFonts } from '../UI/GoogleFonts.js';
import { Text } from '../UI/Text.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('PASS', name); };

test('a font field can be a family name or a font file', () => {
    assert.equal(GoogleFonts.isFile('./assets/fonts/Chewy/Chewy-Regular.ttf'), true);
    assert.equal(GoogleFonts.isFile('Chewy.OTF'), true); assert.equal(GoogleFonts.isFile('x.woff2'), true);
    assert.equal(GoogleFonts.isFile('Chewy'), false); assert.equal(GoogleFonts.isFile('sans-serif'), false);
});
test('a file is drawn under a CSS family derived from its name; a name is used as it is', () => {
    assert.equal(GoogleFonts.familyFor('./assets/fonts/Chewy/Chewy-Regular.ttf'), 'Chewy-Regular');
    assert.equal(GoogleFonts.familyFor('Press Start 2P'), 'Press Start 2P');
});
test('the Text font field is declared as accepting a font file (so the Inspector shows a file chooser)', () => {
    assert.equal(Text.fields.find(f => f.key === 'fontFamily').accept, 'font');
});
console.log(`\n${passed} passed`);

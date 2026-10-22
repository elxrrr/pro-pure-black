import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {generateSkinXml, normaliseThemes, createSkinZip, ATOMIX_DEFAULT} from '../docs/generator.js';
import {applyToolbar, toolbarLayout} from '../docs/toolbar.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const xml = readFileSync(join(root, 'skin', 'Pro.xml'), 'utf8');
const themes = JSON.parse(readFileSync(join(root, 'themes.json'), 'utf8'));
const custom = {id: 25, name: 'Custom', slug: 'custom', colors: ['#010305', '#CDCDCD', '#FA92B3', '#000000']};
const optional = ['account', 'shoutout', 'scheduler', 'sandbox'];

function generatedRegionsRemoved(text) {
  return text.replace(/<!-- BEGIN PURE BLACK DECK THEMES -->[\s\S]*?<!-- END PURE BLACK DECK THEMES -->/, 'PALETTES')
    .replace(/<submenu text="Deck Colours"[^>]*>[\s\S]*?<\/submenu>/g, 'MENU')
    .replace(/(<!-- BEGIN PURE BLACK (WAVEFORM|METER) -->)([\s\S]*?)(<!-- END PURE BLACK \2 -->)/g,
      (_, begin, type, content, end) => begin + content.replace(/<group condition="[^"]*">/g, '<group>') + end);
}

function python(script, args = []) {
  const result = spawnSync('python3', ['-c', script, ...args], {encoding: 'utf8', cwd: root});
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  return result.stdout;
}

test('published assets match the authoritative skin and palettes', () => {
  for (const name of ['Pro.xml', 'gfx-pro.png', 'icons_daylight.png', 'themes.json']) {
    const source = join(root, name === 'themes.json' ? '' : 'skin', name);
    assert.deepEqual(readFileSync(join(root, 'docs', 'assets', name)), readFileSync(source), name);
  }
});

test('all existing palettes reproduce the released source exactly', () => {
  assert.equal(generateSkinXml(xml, themes), xml);
});

test('Default is mandatory and immutable; custom names and colours are validated', () => {
  for (const invalid of [[], [null], themes.slice(1), [{...themes[0], colors: ['#FFFFFF', ...ATOMIX_DEFAULT.slice(1)]}]]) {
    assert.throws(() => generateSkinXml(xml, invalid), /Default/);
  }
  for (const value of ['#abc', '#12345G', 'red', '#123456"/>', null]) {
    assert.throws(() => normaliseThemes([themes[0], {...custom, colors: [value, ...custom.colors.slice(1)]}]), /six-digit hex/);
  }
  assert.throws(() => normaliseThemes([themes[0], {...custom, name: 'Default'}]), /different name/);
  assert.throws(() => normaliseThemes([themes[0], {...custom, slug: 'default'}]), /different name/);
  assert.throws(() => normaliseThemes([themes[0], {...custom, name: 'Bad\nName'}]), /1–64/);
  const escaped = generateSkinXml(xml, [themes[0], {...custom, name: 'A "quote" & <tag>', slug: '" onload="bad'}]);
  assert.equal((escaped.match(/text="A &quot;quote&quot; &amp; &lt;tag&gt;"/g) || []).length, 2);
  assert.ok(escaped.includes('name="pureblack-theme-a-quote-tag"'));
  assert.ok(!escaped.includes('onload="bad'));
});

test('subsets and custom palettes leave native controls, colours and black surfaces untouched', () => {
  for (const selection of [[themes[0]], [themes[0], themes[8]], [themes[0], themes[3], custom]]) {
    const generated = generateSkinXml(xml, selection);
    assert.equal(generatedRegionsRemoved(generated), generatedRegionsRemoved(xml));
    assert.equal(generateSkinXml(generated, selection), generated, 'regeneration is idempotent');
    const counts = [...generated.matchAll(/<group name="pureblack-theme-([^"]+)" condition="var_equal '@\$pureblackdecktheme' (\d+)">/g)];
    assert.deepEqual(counts.map(match => Number(match[2])), selection.slice(1).map((_, index) => index + 1));
    assert.equal((generated.match(/<item text="Default"/g) || []).length, 2);
    if (selection.length === 1) {
      assert.equal((generated.match(/<group condition="true">/g) || []).length, 56);
      assert.equal((generated.match(/<group condition="false">/g) || []).length, 56);
    }
  }
  const generated = generateSkinXml(xml, [themes[0], custom]);
  custom.colors.forEach((color, index) => {
    const deck = index + 1;
    for (const role of ['deckcolor', 'scratch1', 'scratch2', 'pureblack_waveinstru']) {
      assert.ok(generated.includes(`<define color="${role}" value="${color}" deck="${deck}"/>`));
    }
    for (const role of [`waveform_active${deck}`, `pureblack_meter${deck}`]) {
      assert.ok(generated.includes(`<define color="${role}" value="${color}"/>`));
    }
  });
  assert.throws(() => generateSkinXml(xml.replace('BEGIN PURE BLACK METER', 'BROKEN'), themes), /incomplete/);
});

test('custom palette output matches the independent Python skin builder', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'pure-black-palette-'));
  try {
    const selected = normaliseThemes([themes[0], themes[7], custom]);
    writeFileSync(join(temporary, 'Pro.xml'), xml);
    writeFileSync(join(temporary, 'themes.json'), JSON.stringify(selected));
    python(`import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location('builder', 'tools/build_themes.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
builder.ROOT = pathlib.Path(sys.argv[1])
builder.PATH = builder.ROOT / 'Pro.xml'
builder.build()
`, [temporary]);
    assert.equal(generateSkinXml(xml, selected), readFileSync(join(temporary, 'Pro.xml'), 'utf8'));
  } finally { rmSync(temporary, {recursive: true, force: true}); }
});

test('all sixteen toolbar combinations preserve existing markup and fit native clear regions', () => {
  assert.equal(applyToolbar(xml, {}), xml);
  for (let mask = 0; mask < 16; mask++) {
    const options = Object.fromEntries(optional.map((key, bit) => [key, Boolean(mask & (1 << bit))]));
    const output = applyToolbar(xml, options);
    for (const platform of ['mac', 'pc']) {
      const layout = toolbarLayout(options, platform);
      assert.deepEqual(layout.map(item => item.key), optional.filter(key => options[key]));
      for (let index = 0; index < layout.length; index++) {
        const item = layout[index];
        assert.equal(item.y, 8);
        assert.equal(item.height, 27);
        if (platform === 'mac') {
          assert.ok(item.x >= 195 && item.x + item.width <= 759, `${mask}: mac ${item.key}`);
        } else if (item.key === 'sandbox') {
          assert.ok(item.x >= 573 && item.x + item.width <= 822, `${mask}: pc sandbox`);
        } else {
          assert.ok(item.x >= 100 && item.x + item.width <= 359, `${mask}: pc ${item.key}`);
        }
        if (index) assert.ok(layout[index - 1].x + layout[index - 1].width + 10 <= item.x);
      }
    }
    const restored = output.replace(/\r?\n<!-- BEGIN PURE BLACK OPTIONAL TOOLBAR -->[\s\S]*?<!-- END PURE BLACK OPTIONAL TOOLBAR -->\r?\n/g, '');
    assert.equal(restored, xml);
    for (const [key, action, copies] of [['account', 'connect', 2], ['shoutout', 'shoutout', 2], ['scheduler', 'eventscheduler', 2], ['sandbox', 'sandbox', 6]]) {
      assert.equal((output.match(new RegExp(`<button action="${action}"`, 'g')) || []).length, options[key] ? copies : 0, `${mask}: ${key}`);
    }
  }
  assert.throws(() => applyToolbar(xml, {sandbox: 'true'}), /on or off/);
});

test('exported ZIP passes Python zipfile CRC checks and preserves binary and Unicode data', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'pure-black-zip-'));
  try {
    const skin = applyToolbar(generateSkinXml(xml, [themes[0], custom]), Object.fromEntries(optional.map(key => [key, true])));
    const sprite = readFileSync(join(root, 'skin', 'gfx-pro.png'));
    const files = [{name: 'Pro.xml', data: skin}, {name: 'gfx-pro.png', data: sprite},
      {name: 'icons_daylight.png', data: readFileSync(join(root, 'skin', 'icons_daylight.png'))},
      {name: 'é.txt', data: 'Pure black ✨'}, {name: 'empty.txt', data: new ArrayBuffer(0)}];
    const zipped = createSkinZip(files);
    assert.ok(zipped instanceof Uint8Array);
    assert.deepEqual(createSkinZip(files), zipped, 'archive is deterministic');
    writeFileSync(join(temporary, 'skin.zip'), zipped);
    writeFileSync(join(temporary, 'expected.xml'), skin);
    python(`import pathlib, sys, zipfile
root = pathlib.Path(sys.argv[1])
with zipfile.ZipFile(root / 'skin.zip') as archive:
    assert archive.testzip() is None
    assert archive.namelist() == ['Pro.xml', 'gfx-pro.png', 'icons_daylight.png', 'é.txt', 'empty.txt']
    assert archive.read('Pro.xml') == (root / 'expected.xml').read_bytes()
    assert archive.read('gfx-pro.png') == pathlib.Path('skin/gfx-pro.png').read_bytes()
    assert archive.read('icons_daylight.png') == pathlib.Path('skin/icons_daylight.png').read_bytes()
    assert archive.read('é.txt').decode() == 'Pure black ✨'
    assert archive.read('empty.txt') == b''
`, [temporary]);
    for (const name of ['../file', '/file', 'C:\\file', 'folder/../file', 'folder//file']) {
      assert.throws(() => createSkinZip([{name, data: ''}]), /filename/);
    }
    assert.throws(() => createSkinZip([{name: 'x', data: ''}, {name: 'x', data: ''}]), /duplicate/);
  } finally { rmSync(temporary, {recursive: true, force: true}); }
});

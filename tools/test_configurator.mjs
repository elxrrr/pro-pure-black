import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {generateSkinXml, normaliseThemes, createSkinZip, ATOMIX_DEFAULT} from '../docs/generator.js';
import {applyToolbar, toolbarLayout, DEFAULT_TOOLBAR_ORDER, normaliseToolbarOrder, measureToolbarFit} from '../docs/toolbar.js';
import {websiteThemeProperties} from '../docs/appearance.js';
import {DISPLAY_PROFILES, getDisplayProfile, toolbarFit} from '../docs/display.js';

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
  for (const selection of [[themes[0]], [themes[0], themes[4]], [themes[0], themes[3], custom]]) {
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
    const selected = normaliseThemes([themes[0], themes[2], custom]);
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

test('custom presets have no artificial count limit and retain distinct menu entries', () => {
  const customs = Array.from({length: 80}, (_, index) => ({
    ...custom, name: `Custom ${index + 1}`, slug: `custom-${index + 1}`,
  }));
  const selection = [themes[0], ...customs];
  const generated = generateSkinXml(xml, selection);
  assert.equal(normaliseThemes(selection).length, 81);
  assert.equal((generated.match(/<group name="pureblack-theme-custom-/g) || []).length, 80);
  assert.equal((generated.match(/<item text="Custom 80"[^>]*action="set '@\$pureblackdecktheme' 80 & load_skin"/g) || []).length, 2);
  assert.equal(generatedRegionsRemoved(generated), generatedRegionsRemoved(xml));
});

// Read complete nested groups independently of the toolbar implementation.
function skinGroup(text, name) {
  const start = text.indexOf(`<group name="${name}"`);
  assert.notEqual(start, -1, `Missing ${name}`);
  const tags = /<group\b[^>]*>|<\/group>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let token; (token = tags.exec(text));) {
    if (token[0] === '</group>') depth--;
    else if (!token[0].endsWith('/>')) depth++;
    if (!depth) return text.slice(start, tags.lastIndex);
  }
  assert.fail(`Incomplete ${name}`);
}

function withoutToolbar(text) {
  for (const platform of ['mac', 'pc']) text = text.replace(skinGroup(text, `pureblack_toolbar_${platform}`), 'TOOLBAR');
  return text;
}

function permutations(items) {
  return items.length === 0 ? [[]] : items.flatMap((item, index) =>
    permutations(items.filter((_, other) => other !== index)).map(rest => [item, ...rest]));
}

const orders = permutations(DEFAULT_TOOLBAR_ORDER);
const representativeOrders = [DEFAULT_TOOLBAR_ORDER, [...DEFAULT_TOOLBAR_ORDER].reverse(),
  ['layout', 'sandbox', 'settings', 'scheduler', 'account', 'shoutout']];

test('every toolbar order and toggle combination fits beside the native counters and window controls', () => {
  assert.equal(orders.length, 720);
  const widths = { account: 135, shoutout: 35, scheduler: 35, sandbox: 235, layout: 123, settings: 35 };
  for (let mask = 0; mask < 16; mask++) {
    const options = Object.fromEntries(optional.map((key, bit) => [key, Boolean(mask & (1 << bit))]));
    for (const order of orders) {
      for (const platform of ['mac', 'pc']) {
        const layout = toolbarLayout(options, platform, order);
        assert.deepEqual(layout.map(item => item.key), order.filter(key => !optional.includes(key) || options[key]));
        const leftBoundary = platform === 'mac' ? 1160 : 1102;
        const rightBoundary = platform === 'mac' ? 1910 : 1789;
        assert.ok(layout[0].x > leftBoundary, `${platform}: controls overlap the beat counters`);
        assert.equal(layout.at(-1).x + layout.at(-1).width, rightBoundary, `${platform}: controls are not right aligned`);
        for (let index = 0; index < layout.length; index++) {
          const item = layout[index];
          assert.equal(item.width, widths[item.key]);
          assert.equal(item.y, 8);
          assert.equal(item.height, 27);
          if (index) assert.ok(layout[index - 1].x + layout[index - 1].width + 10 <= item.x,
            `${platform}: ${item.key} overlaps preceding control, including active Sandbox waveform`);
        }
      }
    }
  }
});

test('display fit checks use the exported geometry across all profiles, including the active Sandbox width', () => {
  assert.deepEqual(DISPLAY_PROFILES.map(profile => profile.id), ['13', '14', '15', '16']);
  for (const profile of DISPLAY_PROFILES) {
    assert.equal(getDisplayProfile(profile.id), profile);
    for (const notch of [false, true]) {
      for (let mask = 0; mask < 16; mask++) {
        const options = Object.fromEntries(optional.map((key, bit) => [key, Boolean(mask & (1 << bit))]));
        for (const order of representativeOrders) {
          const fit = toolbarFit(options, order, { notch, profile: profile.id });
          assert.deepEqual(fit.items, toolbarLayout(options, 'mac', order));
          assert.equal(fit.fits, true, 'All current controls fit; display size must not invent a count limit');
          assert.equal(fit.requiredWidth, fit.items.at(-1).x + fit.items.at(-1).width - fit.items[0].x);
          assert.equal(fit.gap, fit.items[0].x - (notch ? 1160 : 1102));
          assert.ok(fit.gap >= fit.minGap && fit.requiredWidth <= fit.availableWidth);
          assert.equal(fit.scale, profile.width / 1920);
          if (options.sandbox) assert.equal(fit.items.find(item => item.key === 'sandbox').width, 235);
          if (mask === 15) assert.equal(fit.requiredWidth, 648);
        }
      }
    }
  }
  assert.throws(() => toolbarFit({}, DEFAULT_TOOLBAR_ORDER, { profile: 'unknown' }), /display/i);
  for (const platform of ['mac', 'pc']) {
    const phraseEnd = platform === 'mac' ? 1160 : 1102;
    const right = platform === 'mac' ? 1910 : 1789;
    const fitting = [{ key: 'settings', x: phraseEnd + 10, y: 8, width: right - phraseEnd - 10, height: 27 }];
    assert.equal(measureToolbarFit(fitting, platform).fits, true, 'Exact safe boundary must fit');
    assert.equal(measureToolbarFit([{...fitting[0], x: phraseEnd + 9}], platform).fits, false, 'Reject intrusion into the counter gap');
    assert.equal(measureToolbarFit([{...fitting[0], width: fitting[0].width + 1}], platform).fits, false, 'Reject intrusion into the window controls');
  }
});

test('toolbar exports preserve native status, menus, actions, colours and automatic notch layout', () => {
  for (let mask = 0; mask < 16; mask++) {
    const options = Object.fromEntries(optional.map((key, bit) => [key, Boolean(mask & (1 << bit))]));
    for (const order of representativeOrders) {
      const output = applyToolbar(xml, options, order);
      assert.equal(withoutToolbar(output), withoutToolbar(xml), 'Only toolbar groups may change');
      for (const platform of ['mac', 'pc']) {
        const base = skinGroup(xml, `pureblack_toolbar_${platform}`);
        const toolbar = skinGroup(output, `pureblack_toolbar_${platform}`);
        const status = skinGroup(toolbar, 'topbar_status');
        assert.equal(status, skinGroup(base, 'topbar_status'), 'Native status behavior must be retained');
        assert.match(status, new RegExp(`^<group name="topbar_status" x="${platform === 'mac' ? 195 : 100}" y="8">`));
        assert.ok(status.includes('source="get_cpu"') && status.includes('source="get_battery"'));
        const normalizeX = block => block.replace(/^(<group[^>]* x=")[^"]+/, '$1X');
        assert.equal(normalizeX(skinGroup(toolbar, 'layout_options')), normalizeX(skinGroup(base, 'layout_options')),
          'Native Layout menu must remain unchanged');
        const settings = block => block.match(/<button action="settings">[\s\S]*?<\/button>/)[0]
          .replace(/(<pos x=")[^"]+/, '$1X');
        assert.equal(settings(toolbar), settings(base), 'Native Settings action and sprites must remain unchanged');
        const layout = toolbarLayout(options, platform, order);
        for (const item of layout) {
          const start = item.key === 'layout' ? `<group name="layout_options" x="${item.x}"`
            : item.key === 'account' ? `<group name="login" x="${item.x}"`
            : item.key === 'sandbox' ? `<group name="sandbox" x="${item.x}"` : null;
          if (start) assert.ok(toolbar.includes(start), `${platform}: ${item.key} exported position`);
          else {
            const action = item.key === 'scheduler' ? 'eventscheduler' : item.key;
            assert.match(toolbar, new RegExp(`<button action="${action}">\\s*<pos x="${item.x}" y="8"`));
          }
        }
      }
      for (const [key, action, copies] of [['account', 'connect', 2], ['shoutout', 'shoutout', 2], ['scheduler', 'eventscheduler', 2], ['sandbox', 'sandbox', 6]]) {
        assert.equal((output.match(new RegExp(`<button action="${action}"`, 'g')) || []).length, options[key] ? copies : 0, `${mask}: ${key}`);
      }
      assert.throws(() => applyToolbar(output, options, order), /already/);
      assert.equal(output.replaceAll('\r\n', '').includes('\n'), false, 'CRLF skin must retain its newline format');
    }
  }
});

test('invalid toolbar values or incomplete, duplicate and unknown orders fail clearly', () => {
  assert.deepEqual(normaliseToolbarOrder(), DEFAULT_TOOLBAR_ORDER);
  for (const order of [null, 'settings', [], DEFAULT_TOOLBAR_ORDER.slice(1), [...DEFAULT_TOOLBAR_ORDER, 'settings'],
    ['account', 'shoutout', 'scheduler', 'sandbox', 'layout', 'layout'],
    ['account', 'shoutout', 'scheduler', 'sandbox', 'layout', 'unknown']]) {
    assert.throws(() => normaliseToolbarOrder(order), /order|button|control/i);
    assert.throws(() => applyToolbar(xml, {}, order), /order|button|control/i);
  }
  assert.throws(() => applyToolbar(xml, {sandbox: 'true'}), /on or off/);
  assert.throws(() => toolbarLayout({}, 'unknown'), /platform/i);
});

test('website accents stay readable for dark custom colours without changing deck colours or black surfaces', () => {
  const luminance = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const palette = themes[0];
  const before = JSON.stringify(palette);
  websiteThemeProperties(palette);
  assert.equal(JSON.stringify(palette), before, 'Website styling must not mutate Atomix Default');
  for (const colour of ['#000000', '#010203', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF']) {
    const properties = websiteThemeProperties({...custom, colors: [colour, ...custom.colors.slice(1)]});
    const accent = properties['--accent'];
    assert.match(accent, /^#[0-9a-f]{6}$/i);
    const ink = properties['--accent-ink'];
    assert.match(ink, /^#0{3}(?:0{3})?$/);
    assert.ok((luminance(accent) + 0.05) / 0.05 >= 4.5, `Website button contrast fails for ${colour}`);
    assert.equal(properties['--bg'], undefined, 'Appearance must not tint the black body');
    assert.equal(properties['--panel'], undefined, 'Appearance must not tint black panels');
  }
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

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(root, 'docs');
const artifacts = join(root, 'browser-checks');
const defaults = ['#156C89', '#AC2F37', '#0D7264', '#A54D30'];
const customStart = ['#E98DB6', '#89BFF0', '#B69BE4', '#F2C48F'];
const colours = ['#E89CBE', '#89BFF0', '#84D6B5', '#F2C48F'];
const customName = 'Studio <&> Mix';
const secondColours = ['#CA8CD3', '#82D8D1', '#EDB274', '#C7CFEF'];
const secondName = 'Second preset';
const paletteNames = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Greyscale'];
const defaultToolbarOrder = ['account', 'shoutout', 'scheduler', 'sandbox', 'layout', 'settings'];
const errors = [];
let server;
let browser;
const pages = [];

async function localServer() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.xml': 'application/xml', '.png': 'image/png', '.svg': 'image/svg+xml' };
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const filename = resolve(docs, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!filename.startsWith(docs + sep)) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(filename);
      response.writeHead(200, { 'Content-Type': types[extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(body);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}/`;
}

async function openPage(base, viewport, mobile = false) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const label = mobile ? 'mobile' : 'desktop';
  page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`${label}: ${message.text()}`);
  });
  pages.push({ page, label });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !document.querySelector('#download')?.disabled);
  return page;
}

async function noHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    content: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
  }));
  assert.ok(dimensions.content <= dimensions.viewport + 1, `Horizontal overflow: ${JSON.stringify(dimensions)}`);
}

async function assertAnimatedPreview(page, selector, parts = ['.preview-rotor', '.preview-wave-strip', '.preview-meter-fill']) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.waitForFunction(selector => document.querySelector(selector).dataset.motion === 'running', selector);
  const before = await page.locator(selector).evaluate((preview, parts) =>
    parts.map(part => getComputedStyle(preview.querySelector(part)).transform), parts);
  await page.waitForFunction(({ selector, parts, before }) => parts.every((part, index) =>
    getComputedStyle(document.querySelector(selector).querySelector(part)).transform !== before[index]),
  { selector, parts, before });
}

async function recordAnimatedPreview(base) {
  const size = { width: 720, height: 420 };
  const context = await browser.newContext({ viewport: size, reducedMotion: 'no-preference', recordVideo: { dir: artifacts, size } });
  const page = await context.newPage();
  try {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Preview Pastel Orange', exact: true }).click();
    await assertAnimatedPreview(page, '#preset-preview');
    await page.waitForTimeout(4400);
  } finally {
    await context.close();
  }
  await page.video().saveAs(join(artifacts, 'animated-deck-preview.webm'));
  await page.video().delete();
}

async function websiteAccent(page) {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
}

async function assertBlackSurfaces(page) {
  const problems = await page.locator('body, .panel, .preset-card, .custom-card, .toolbar-order-row, .download-panel, .toolbar-simulation, .palette-preview, input[type="text"]').evaluateAll(elements =>
    elements.flatMap(element => {
      const style = getComputedStyle(element);
      let fill = style.backgroundColor;
      let ancestor = element.parentElement;
      while ((fill === 'rgba(0, 0, 0, 0)' || fill === 'transparent') && ancestor) {
        fill = getComputedStyle(ancestor).backgroundColor;
        ancestor = ancestor.parentElement;
      }
      return fill === 'rgb(0, 0, 0)' && style.backgroundImage === 'none' ? []
        : [`${element.tagName}.${element.className}: ${fill}, ${style.backgroundImage}`];
    }));
  assert.deepEqual(problems, [], 'Structural website surfaces must stay pure black');
}

async function assertToolbarPreview(page, { notch, profile, colors, order, fits = true }) {
  const preview = await page.locator('#toolbar-preview').evaluate(container => ({
    profile: container.dataset.profile,
    notch: container.dataset.notch,
    width: container.querySelector('.toolbar-sim-svg').viewBox.baseVal.width,
    notchCount: container.querySelectorAll('.toolbar-sim-notch').length,
    barsCount: container.querySelectorAll('.toolbar-sim-beat-bars').length,
    controls: [...container.querySelectorAll('[data-toolbar-control]')].map(item => ({
      key: item.dataset.toolbarControl, x: Number(item.dataset.nativeX), y: Number(item.dataset.nativeY),
      width: Number(item.dataset.nativeWidth), height: Number(item.dataset.nativeHeight),
    })),
    circles: [...container.querySelectorAll('[data-phrase-deck]')].map(item => ({
      deck: item.dataset.phraseDeck, x: Number(item.dataset.nativeX), y: Number(item.dataset.nativeY),
      width: Number(item.dataset.nativeWidth), color: item.dataset.color,
    })),
  }));
  const canvasWidth = ({ '13': 1280, '14': 1512, '15': 1440, '16': 1728 })[profile] / .75;
  const phraseOffset = (canvasWidth - 1920) / 2;
  assert.ok(Math.abs(preview.width - canvasWidth) < .001, 'Display size must change available width rather than shrink the controls');
  assert.equal(preview.profile, String(profile));
  assert.equal(preview.notch, String(notch));
  assert.equal(preview.notchCount, notch ? 1 : 0);
  assert.equal(preview.barsCount, notch ? 0 : 1);
  assert.deepEqual(preview.controls.map(item => item.key), order);
  const phrasePositions = notch ? { A: 760, C: 795, B: 1095, D: 1130 } : { C: 823, A: 858, B: 1037, D: 1072 };
  assert.equal(preview.circles.length, 4);
  for (const circle of preview.circles) {
    assert.ok(Math.abs(circle.x - (phrasePositions[circle.deck] + phraseOffset)) < .001);
    assert.equal(circle.y, 6);
    assert.equal(circle.width, 30);
    assert.equal(circle.color.toUpperCase(), colors['ABCD'.indexOf(circle.deck)]);
  }
  const sortedCircles = [...preview.circles].sort((a, b) => a.x - b.x).map(item => item.deck);
  assert.deepEqual(sortedCircles, notch ? ['A', 'C', 'B', 'D'] : ['C', 'A', 'B', 'D']);
  for (let index = 0; index < preview.controls.length; index++) {
    const item = preview.controls[index];
    assert.equal(item.y, 8, 'Controls must share one toolbar row instead of wrapping');
    assert.equal(item.height, 27);
    if (item.key === 'sandbox') assert.equal(item.width, 235, 'Reserve the complete active Sandbox waveform');
    if (index) assert.ok(preview.controls[index - 1].x + preview.controls[index - 1].width + 10 <= item.x);
  }
  assert.equal(preview.controls[0].x >= (notch ? 1160 : 1102) + phraseOffset + 10, fits,
    'Fit result must agree with the actual gap beside the phrase counters');
  assert.ok(Math.abs(preview.controls.at(-1).x + preview.controls.at(-1).width - (canvasWidth - 10)) < .001);
}

async function assertToolbarScrolling(page) {
  assert.equal(await page.locator('#toolbar-preview .toolbar-preview-zoom').count(), 0, 'The toolbar needs no Zoom/Fit switch');
  const geometry = await page.locator('#toolbar-preview').evaluate(container => {
    const viewport = container.querySelector('.toolbar-preview-viewport');
    return { width: container.querySelector('.toolbar-sim-svg').getBoundingClientRect().width,
      profile: container.dataset.profile, viewport: viewport.clientWidth, scrollWidth: viewport.scrollWidth, tabIndex: viewport.tabIndex,
      label: viewport.getAttribute('aria-label') || viewport.getAttribute('aria-labelledby') };
  });
  assert.ok(geometry.tabIndex >= 0 && geometry.label, 'Toolbar viewport must be named and keyboard focusable');
  assert.ok(Math.abs(geometry.width - ({13: 1280, 14: 1512, 15: 1440, 16: 1728})[geometry.profile]) < 1,
    'The toolbar must remain readable at its fixed display scale');
  assert.ok(geometry.scrollWidth > geometry.viewport, 'Only the preview gets a horizontal scroll area');
  await noHorizontalOverflow(page);
}

async function assertLogoControlLayout(page, mobile = false) {
  const display = await page.locator('.toolbar-profile-label').boundingBox();
  const logo = await page.locator('.custom-logo-controls').boundingBox();
  assert.ok(display && logo);
  if (mobile) assert.ok(logo.y >= display.y + display.height, 'Logo controls wrap below display controls on mobile');
  else {
    assert.ok(logo.x > display.x + display.width, 'Logo controls sit to the right of display controls');
    assert.ok(Math.abs(logo.y + logo.height / 2 - display.y - display.height / 2) < 2,
      'Logo and display controls share one desktop line');
  }
}

async function assertPaletteGroup(page, group, checked, indeterminate = false) {
  assert.deepEqual(await page.locator(`#select-${group}`).evaluate(input => [input.checked, input.indeterminate]), [checked, indeterminate]);
}

async function toolbarConfiguration(page) {
  return page.evaluate(() => ({
    order: [...document.querySelectorAll('#toolbar-order > [data-toolbar-key]')].map(item => item.dataset.toolbarKey),
    toggles: [...document.querySelectorAll('#toolbar-order input')].map(input => [input.id, input.checked]),
    presets: [...document.querySelectorAll('#presets input')].map(input => [input.getAttribute('aria-label'), input.checked]),
    customInputs: [...document.querySelectorAll('#custom-presets input')].map(input => [input.type, input.value, input.checked]),
    preview: document.querySelector('#preview-title').textContent,
  }));
}

async function logoFixtures(page) {
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 144; canvas.height = 34;
    const context = canvas.getContext('2d');
    const empty = canvas.toDataURL('image/png');
    context.fillStyle = '#E89CBE'; context.fillRect(14, 6, 116, 22);
    const transparent = canvas.toDataURL('image/png');
    context.fillStyle = '#82D8D1'; context.fillRect(0, 0, 144, 34);
    return { transparent, opaque: canvas.toDataURL('image/png'), empty };
  });
  return Object.fromEntries(Object.entries(encoded).map(([key, value]) => [key, Buffer.from(value.split(',')[1], 'base64')]));
}

async function uploadLogo(page, name, buffer) {
  await page.locator('#custom-logo-upload').setInputFiles({ name, mimeType: 'image/png', buffer });
  await page.waitForFunction(() => document.querySelector('#custom-logo-upload').getAttribute('aria-busy') === 'false');
}

async function assertDefaultLocked(page) {
  const locked = page.getByRole('checkbox', { name: 'Default is always included' });
  assert.equal(await locked.isChecked(), true);
  assert.equal(await locked.isDisabled(), true);
}

async function download(page, filename) {
  const pending = page.waitForEvent('download');
  await page.locator('#download').click();
  const result = await pending;
  assert.equal(result.suggestedFilename(), 'pro-pure-black-custom.zip');
  assert.equal(await result.failure(), null);
  await result.saveAs(filename);
  assert.match(await page.locator('#status').innerText(), /ZIP|download/i);
}

function verifyPaletteSelectionZip(filename, expectedNames) {
  const result = spawnSync('python3', ['-c', String.raw`
import json, pathlib, re, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    assert archive.testzip() is None
    xml = archive.read('Pro.xml').decode()
expected = json.loads(sys.argv[2])
menus = re.findall(r'<submenu text="Deck Colours"[^>]*>(.*?)</submenu>', xml, re.S)
assert len(menus) == 2
for menu in menus:
    assert re.findall(r'<item text="([^"]+)"', menu) == expected
assert re.findall(r'<group name="pureblack-theme-([^"]+)"', xml) == [name.lower().replace(' ', '-') for name in expected[1:]]
source = (pathlib.Path(sys.argv[3]) / 'skin' / 'Pro.xml').read_text()
normal = xml.replace('\r\n', '\n').replace('name="Pro Pure Black Custom"', 'name="Pro Pure Black"', 1)
assert normal.split('<!-- BEGIN PURE BLACK DECK THEMES -->')[0] == source.split('<!-- BEGIN PURE BLACK DECK THEMES -->')[0]
`, filename, JSON.stringify(expectedNames), root], { encoding: 'utf8', cwd: root });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
}

function verifyDownloadedZip(filename, toolbarOrder) {
  const result = spawnSync('python3', ['-c', String.raw`
from html.parser import HTMLParser
from pathlib import Path
import json, re, sys, zipfile

root = Path(sys.argv[1])
colours = json.loads(sys.argv[3])
second_colours = json.loads(sys.argv[4])
toolbar_order = json.loads(sys.argv[5])
with zipfile.ZipFile(sys.argv[2]) as archive:
    assert archive.testzip() is None, 'ZIP checksum failed'
    assert archive.namelist() == ['Pro.xml', 'gfx-pro.png', 'icons_daylight.png']
    for image in ('gfx-pro.png', 'icons_daylight.png'):
        assert archive.read(image) == (root / 'skin' / image).read_bytes()
    xml = archive.read('Pro.xml').decode('utf-8')

class Structure(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.stack = []
    def handle_starttag(self, tag, attrs):
        self.stack.append(tag)
    def handle_endtag(self, tag):
        assert self.stack.pop() == tag, 'Unbalanced skin markup'

structure = Structure()
structure.feed(xml)
assert not structure.stack
assert 'name="Pro Pure Black Custom"' in xml
menus = re.findall(r'<submenu text="Deck Colours"[^>]*>(.*?)</submenu>', xml, re.S)
assert len(menus) == 2
for menu in menus:
    assert re.findall(r'<item text="([^"]+)"', menu) == ['Default', 'Pastel Red', 'Studio &lt;&amp;&gt; Mix', 'Second preset']
assert 'pureblack-theme-pastel-red' in xml
assert 'pureblack-theme-custom-1' in xml
assert 'pureblack-theme-custom-2' in xml
assert 'pureblack-theme-custom-3' not in xml
assert 'pureblack-theme-bold-red' not in xml
for action, count in [('connect', 2 if 'account' in toolbar_order else 0), ('shoutout', 2), ('eventscheduler', 2), ('sandbox', 6)]:
    assert xml.count('<button action="' + action + '"') == count, action
for index, palette in enumerate([colours, second_colours], 1):
    block = re.search(r'<group name="pureblack-theme-custom-' + str(index) + r'".*?</group>', xml, re.S).group(0)
    for deck, colour in enumerate(palette, 1):
        for role in ['deckcolor', 'scratch1', 'scratch2', 'pureblack_waveinstru']:
            assert f'<define color="{role}" value="{colour}" deck="{deck}"/>' in block
        for role in [f'waveform_active{deck}', f'pureblack_meter{deck}']:
            assert f'<define color="{role}" value="{colour}"/>' in block

def skin_group(text, name):
    start = text.index('<group name="' + name + '"')
    depth = 0
    for match in re.finditer(r'<group\b[^>]*>|</group>', text[start:]):
        token = match.group(0)
        if token == '</group>': depth -= 1
        elif not token.endswith('/>'): depth += 1
        if depth == 0: return text[start:start + match.end()]
    raise AssertionError('Unclosed ' + name)

# Requested order must reach the exported native controls on both platforms.
widths = dict(account=135, shoutout=35, scheduler=35, sandbox=235, layout=123, settings=35)
for platform, left, right, status_x in [('mac', 1160, 1910, 195), ('pc', 1102, 1789, 100)]:
    toolbar = skin_group(xml, 'pureblack_toolbar_' + platform)
    positions = {}
    for key in toolbar_order:
        if key in ['account', 'sandbox', 'layout']:
            name = {'account': 'login', 'layout': 'layout_options', 'sandbox': 'sandbox'}[key]
            positions[key] = int(re.search(r'<group name="' + name + r'" x="(\d+)"', toolbar).group(1))
        else:
            action = 'eventscheduler' if key == 'scheduler' else key
            positions[key] = int(re.search(r'<button action="' + action + r'">\s*<pos x="(\d+)"', toolbar).group(1))
    assert sorted(positions, key=positions.get) == toolbar_order, (platform, positions)
    assert positions[toolbar_order[0]] > left
    assert positions[toolbar_order[-1]] + widths[toolbar_order[-1]] == right
    for before, after in zip(toolbar_order, toolbar_order[1:]):
        assert positions[before] + widths[before] + 10 <= positions[after]
    assert f'<group name="topbar_status" x="{status_x}" y="8">' in toolbar

# The untouched source preceding the generated palettes contains the native
# Atomix colours, original skin controls and fixed black surfaces.
source = (root / 'skin' / 'Pro.xml').read_text()
normal = xml.replace('\r\n', '\n').replace('name="Pro Pure Black Custom"', 'name="Pro Pure Black"', 1)
assert normal.split('<!-- BEGIN PURE BLACK DECK THEMES -->')[0] == source.split('<!-- BEGIN PURE BLACK DECK THEMES -->')[0]
print('Browser-exported ZIP: valid CRC, exact sprites, two independent custom palettes, all four native toolbar controls, custom deck/waveform/VU colours, unchanged Atomix definitions.')
`, root, filename, JSON.stringify(colours), JSON.stringify(secondColours), JSON.stringify(toolbarOrder)], { encoding: 'utf8', cwd: root });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  console.log(result.stdout.trim());
}

function verifyLogoZip(filename, originalFilename) {
  const result = spawnSync('python3', ['-c', String.raw`
import re, struct, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as added, zipfile.ZipFile(sys.argv[2]) as original:
    assert added.testzip() is None
    assert added.namelist() == original.namelist() == ['Pro.xml', 'gfx-pro.png', 'icons_daylight.png']
    assert added.read('icons_daylight.png') == original.read('icons_daylight.png')
    source_png = original.read('gfx-pro.png')
    logo_png = added.read('gfx-pro.png')
    assert logo_png[:8] == source_png[:8] == b'\x89PNG\r\n\x1a\n'
    width, height = struct.unpack('>II', source_png[16:24])
    assert struct.unpack('>II', logo_png[16:24]) == (width, height + 17)
    assert logo_png[24:26] == bytes([8, 6]), 'Appended sprite must remain lossless 8-bit RGBA'
    source_xml = original.read('Pro.xml').decode()
    logo_xml = added.read('Pro.xml').decode()
    assert re.findall(r'<logo>.*?</logo>', logo_xml, re.S) == re.findall(r'<logo>.*?</logo>', source_xml, re.S)
    visuals = re.findall(r'<visual\b[^>]*>.*?</visual>', logo_xml, re.S)
    logo_visuals = [visual for visual in visuals if f'<off x="0" y="{height}"' in visual]
    assert len(logo_visuals) == 2
    assert all('<size width="72" height="17"' in visual for visual in logo_visuals)
    assert any('<pos x="182" y="13"' in visual for visual in logo_visuals)
    assert any('<pos x="92" y="13"' in visual for visual in logo_visuals)
    assert '<group name="topbar_status" x="276" y="8">' in logo_xml
    assert '<group name="topbar_status" x="181" y="8">' in logo_xml
print('Logo ZIP: valid CRC, native logo retained, 72×17 tile appended, both platform positions and status offsets correct.')
`, filename, originalFilename], { encoding: 'utf8', cwd: root });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  console.log(result.stdout.trim());
}

await mkdir(artifacts, { recursive: true });
try {
  const base = process.env.BASE_URL || await localServer();
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
  const desktop = await openPage(base, { width: 1440, height: 1050 });
  await assertDefaultLocked(desktop);
  const defaultAccent = await websiteAccent(desktop);
  await assertBlackSurfaces(desktop);
  assert.equal(await desktop.locator('#presets .preset-card input:checked').count(), 15);
  await assertPaletteGroup(desktop, 'pastel', true);
  await assertPaletteGroup(desktop, 'bold', true);
  for (const group of ['pastel', 'bold']) {
    assert.deepEqual(await desktop.locator(`#presets .preset-card[data-slug^="${group}-"] .preset-name`).allTextContents(), paletteNames,
      'Group headings supply the palette family; card names stay concise');
  }
  assert.equal(await desktop.locator('#custom-preview').count(), 0);
  assert.equal(await desktop.locator('.palette-preview').count(), 1, 'All palettes share one animated preview');
  assert.equal(await desktop.locator('#custom-presets .custom-card').count(), 0);
  assert.equal(await desktop.locator('header').count(), 0);
  for (const removed of ['VIRTUALDJ · PRO LAYOUT', 'Black base. Your colours.', 'Pure black, always',
    'Keep what you use', 'Your own four', 'Build your palette menu', 'Made for VirtualDJ', 'Ready to build your skin']) {
    assert.ok(!(await desktop.locator('body').innerText()).includes(removed), `Removed copy remains: ${removed}`);
  }
  assert.equal(await desktop.locator('footer a[href="https://github.com/elxrrr/pro-pure-black"]').count(), 1);
  assert.equal(await desktop.locator('footer a[href="https://github.com/elxrrr/pro-pure-black/releases/latest"]').count(), 1);
  assert.match(await desktop.locator('footer').innerText(), /Made with AI/i);
  await desktop.locator('#skin-folder-paths summary').click();
  const macPath = '~/Library/Application Support/VirtualDJ/Skins';
  const windowsPath = String.raw`%LOCALAPPDATA%\VirtualDJ\Skins`;
  assert.equal(await desktop.locator('#skin-path-macos').innerText(), macPath);
  assert.equal(await desktop.locator('#skin-path-windows').innerText(), windowsPath);
  await desktop.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true,
    value: { writeText: async value => { window.copiedSkinPath = value; } } }));
  await desktop.locator('[data-copy-path="macos"]').click();
  await desktop.waitForFunction(() => document.querySelector('#path-copy-status').textContent.toLowerCase().includes('copied'));
  assert.equal(await desktop.evaluate(() => window.copiedSkinPath), macPath);
  await desktop.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Clipboard permission denied'); }; });
  await desktop.locator('[data-copy-path="windows"]').click();
  await desktop.waitForFunction(() => document.querySelector('#path-copy-status').textContent.toLowerCase().includes('manually'));
  assert.equal(await desktop.evaluate(() => window.getSelection().toString()), windowsPath);
  assert.equal(await desktop.locator('a[href^="file:"]').count(), 0);
  await desktop.locator('#skin-folder-paths summary').click();
  assert.deepEqual(await desktop.locator('#preset-preview .preview-deck-hex').allTextContents(), defaults);
  assert.equal(await desktop.locator('#preset-preview .preview-deck').count(), 4);
  assert.equal(await desktop.locator('#preset-preview .preview-wave').count(), 4);
  assert.equal(await desktop.locator('#preset-preview .preview-meter').count(), 4);
  assert.deepEqual(await desktop.locator('#toolbar-preview [data-toolbar-control]').evaluateAll(items => items.map(item => item.dataset.toolbarControl)), ['layout', 'settings']);
  assert.deepEqual(await desktop.locator('#toolbar-order > [data-toolbar-key]').evaluateAll(items => items.map(item => item.dataset.toolbarKey)), defaultToolbarOrder);
  assert.equal(await desktop.locator('#toolbar-preview .toolbar-sim-left > .toolbar-sim-window + .toolbar-sim-status').count(), 1,
    'Status must sit beside the VDJ logo on the left');
  for (const part of ['master', 'cpu', 'battery', 'clock']) assert.equal(await desktop.locator(`#toolbar-preview .toolbar-sim-left .toolbar-sim-${part}`).count(), 1);
  assert.equal(await desktop.locator('#toolbar-preview .toolbar-sim-right [data-toolbar-control]').count(), 2);
  assert.equal(await desktop.locator('#toolbar-count').innerText(), '2 visible');
  assert.equal(await desktop.locator('#toolbar-notch-preview').isChecked(), false);
  assert.equal(await desktop.locator('#toolbar-display-profile').inputValue(), '14');
  assert.deepEqual(await desktop.locator('#toolbar-display-profile option').evaluateAll(items => items.map(item => item.value)), ['13', '14', '15', '16']);
  await assertToolbarPreview(desktop, { notch: false, profile: '14', colors: defaults, order: ['layout', 'settings'] });
  await assertToolbarScrolling(desktop);
  await assertLogoControlLayout(desktop);
  await assertAnimatedPreview(desktop, '#toolbar-preview', ['.toolbar-phrase-progress', '.toolbar-master-fill', '.toolbar-cpu-fill']);
  assert.ok(await desktop.evaluate(() => Boolean(document.querySelector('.custom-panel').compareDocumentPosition(document.querySelector('.toolbar-panel')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'Custom preset editor must precede toolbar controls');
  await desktop.locator('#preset-preview').scrollIntoViewIfNeeded();
  await desktop.waitForFunction(() => document.querySelector('#preset-preview').dataset.motion === 'running');
  await assertAnimatedPreview(desktop, '#preset-preview');
  // Compositor animations stop when the system asks for reduced motion.
  await desktop.emulateMedia({ reducedMotion: 'reduce' });
  await desktop.waitForFunction(() => document.querySelector('#preset-preview').dataset.motion === 'paused');
  assert.ok(await desktop.locator('#preset-preview .preview-motion').evaluateAll(elements =>
    elements.length > 0 && elements.every(element => {
      const style = getComputedStyle(element);
      return style.animationName === 'none' || style.animationPlayState === 'paused';
    })));
  assert.ok(await desktop.locator('#toolbar-preview .toolbar-motion').evaluateAll(elements =>
    elements.length > 0 && elements.every(element => getComputedStyle(element).animationPlayState === 'paused')));
  await desktop.emulateMedia({ reducedMotion: 'no-preference' });
  await noHorizontalOverflow(desktop);
  await desktop.screenshot({ path: join(artifacts, 'desktop-default.png'), fullPage: true, animations: 'disabled' });

  // A whole family and individual entries from the other family can be mixed.
  await desktop.locator('#select-bold').uncheck();
  assert.equal(await desktop.locator('#presets .preset-card input:checked').count(), 8);
  await desktop.getByRole('checkbox', { name: 'Include Pastel Red', exact: true }).uncheck();
  await assertPaletteGroup(desktop, 'pastel', false, true);
  await desktop.locator('#select-pastel').click();
  await assertPaletteGroup(desktop, 'pastel', true);
  await assertPaletteGroup(desktop, 'bold', false);
  await desktop.getByRole('checkbox', { name: 'Include Bold Blue', exact: true }).check();
  await assertPaletteGroup(desktop, 'bold', false, true);
  await assertDefaultLocked(desktop);
  assert.deepEqual(await desktop.locator('#preset-preview .preview-deck-hex').allTextContents(), defaults,
    'Group inclusion does not change the active Default preview');
  const groupedArchive = join(artifacts, 'pro-pure-black-mixed-groups.zip');
  await download(desktop, groupedArchive);
  verifyPaletteSelectionZip(groupedArchive, ['Default', ...paletteNames.map(name => `Pastel ${name}`), 'Bold Blue']);
  await desktop.locator('#select-pastel').uncheck();
  assert.deepEqual(await desktop.locator('#presets .preset-card input:checked').evaluateAll(inputs => inputs.map(input => input.closest('.preset-card').dataset.slug)),
    ['default', 'bold-blue'], 'Removing a whole group must preserve selections from the other group');

  // Previewing is independent of including a preset in the downloaded skin.
  await desktop.locator('#select-default').click();
  await desktop.getByRole('button', { name: 'Preview Pastel Red', exact: true }).click();
  assert.equal(await desktop.locator('#preview-title').innerText(), 'Pastel Red');
  const redAccent = await websiteAccent(desktop);
  assert.notEqual(redAccent, defaultAccent, 'Previewing Red must change the website accent');
  await assertBlackSurfaces(desktop);
  assert.equal(await desktop.locator('#presets .preset-card input:checked').count(), 1);
  await desktop.getByRole('checkbox', { name: 'Include Pastel Red', exact: true }).check();
  assert.equal(await websiteAccent(desktop), redAccent, 'Inclusion alone must not change website appearance');
  await desktop.getByRole('button', { name: 'Preview Pastel Blue', exact: true }).click();
  const blueAccent = await websiteAccent(desktop);
  assert.notEqual(blueAccent, redAccent, 'Previewing Blue must change the website accent');
  assert.notEqual(blueAccent, defaultAccent);
  await assertBlackSurfaces(desktop);
  await desktop.getByRole('button', { name: 'Preview Default', exact: true }).click();
  assert.equal(await websiteAccent(desktop), defaultAccent, 'Returning to Default restores its website accent');
  assert.deepEqual(await desktop.locator('#preset-preview .preview-deck-hex').allTextContents(), defaults);
  await desktop.getByRole('button', { name: 'Preview Pastel Red', exact: true }).click();
  await assertDefaultLocked(desktop);

  // Custom presets are independent and can be added, excluded and removed.
  await desktop.locator('#add-custom').click();
  const first = desktop.locator('.custom-card[data-custom-id="custom-1"]');
  assert.equal(await first.locator('.custom-include').isChecked(), true);
  const firstTile = desktop.locator('#presets .preset-card[data-slug="custom-1"]');
  assert.equal(await firstTile.count(), 1, 'New custom must appear in the top palette list');
  assert.equal(await firstTile.locator('input').isChecked(), true);
  assert.deepEqual(await first.locator('.hex-input').evaluateAll(inputs => inputs.map(input => input.value)), customStart,
    'A fresh custom starts from the same fixed palette regardless of the selected builtin');
  await first.locator('.custom-include').uncheck();
  await first.getByRole('button', { name: 'Random', exact: true }).click();
  const randomised = await first.locator('.hex-input').evaluateAll(inputs => inputs.map(input => input.value));
  assert.notEqual(randomised[0], customStart[0], 'Random starts with a new deck A colour');
  assert.notDeepEqual(randomised.slice(1), customStart.slice(1));
  assert.equal(new Set(randomised).size, 4);
  assert.ok(randomised.every(color => /^#[0-9A-F]{6}$/.test(color)));
  assert.equal(await first.locator('.custom-include').isChecked(), true);
  assert.equal(await firstTile.locator('input').isChecked(), true);
  assert.deepEqual(await first.locator('.colour-picker').evaluateAll(inputs => inputs.map(input => input.value.toUpperCase())), randomised);
  assert.deepEqual(await firstTile.locator('.palette-swatches i').evaluateAll(items => items.map(item => item.style.getPropertyValue('--swatch'))), randomised);
  assert.deepEqual(await desktop.locator('#preset-preview .preview-deck-hex').allTextContents(), randomised);
  await assertAnimatedPreview(desktop, '#preset-preview');
  const initialCustomAccent = await websiteAccent(desktop);
  // Invalid colours and a duplicate Default name must never produce a ZIP.
  await first.locator('.hex-input[data-deck="A"]').fill('#xyz');
  assert.equal(await desktop.locator('#download').isDisabled(), true);
  assert.equal(await websiteAccent(desktop), initialCustomAccent, 'Invalid colour input must retain the last valid accent');
  await first.getByRole('button', { name: 'Random', exact: true }).click();
  const repairedPalette = await first.locator('.hex-input').evaluateAll(inputs => inputs.map(input => input.value));
  assert.ok(repairedPalette.every(color => /^#[0-9A-F]{6}$/.test(color)), 'Random replaces invalid input with a valid new quartet');
  assert.equal(new Set(repairedPalette).size, 4);
  assert.equal(await desktop.locator('#download').isEnabled(), true);
  for (const [index, letter] of ['A', 'B', 'C', 'D'].entries()) {
    await first.locator(`.hex-input[data-deck="${letter}"]`).fill(colours[index]);
  }
  await first.locator('.custom-name').fill('Default');
  assert.equal(await desktop.locator('#download').isDisabled(), true);
  await first.locator('.custom-name').fill(customName);
  assert.equal(await desktop.locator('#download').isEnabled(), true);
  assert.deepEqual(await desktop.locator('#preset-preview .preview-deck-hex').allTextContents(), colours);
  assert.equal(await firstTile.locator('.preset-name').innerText(), customName);
  const customAccent = await websiteAccent(desktop);
  assert.notEqual(customAccent, redAccent, 'Editing the selected custom colours must update website accents');
  await assertBlackSurfaces(desktop);
  assert.deepEqual(await firstTile.locator('.palette-swatches i').evaluateAll(items => items.map(item => item.style.getPropertyValue('--swatch'))), colours);
  await firstTile.locator('input').uncheck();
  assert.equal(await first.locator('.custom-include').isChecked(), false, 'Top palette inclusion must update the editor');
  assert.equal(await websiteAccent(desktop), customAccent, 'Excluding a custom must not change its preview appearance');
  await firstTile.locator('.preset-preview').click();
  assert.equal(await desktop.locator('#preview-title').innerText(), customName);
  assert.deepEqual(await desktop.locator('#preset-preview .preview-deck-hex').allTextContents(), colours);
  assert.equal(await first.locator('.custom-include').isChecked(), false, 'Preview must not include an excluded custom');
  await first.locator('.custom-include').check();
  assert.equal(await firstTile.locator('input').isChecked(), true, 'Editor inclusion must update the top palette');
  await desktop.getByRole('button', { name: 'Preview Pastel Blue', exact: true }).click();
  assert.equal(await websiteAccent(desktop), blueAccent);
  await first.locator('.custom-preview-button').click();
  assert.equal(await websiteAccent(desktop), customAccent, 'Custom editor Preview must also update website appearance');
  assert.equal(await desktop.locator('#preview-title').innerText(), customName);
  await first.locator('.hex-input[data-deck="A"]').fill('#649BE8');
  assert.notEqual(await websiteAccent(desktop), customAccent, 'Subsequent custom edits must immediately refresh the accent');
  await first.locator('.hex-input[data-deck="A"]').fill(colours[0]);
  assert.equal(await websiteAccent(desktop), customAccent);
  await assertBlackSurfaces(desktop);

  await desktop.locator('#add-custom').click();
  const second = desktop.locator('.custom-card[data-custom-id="custom-2"]');
  assert.deepEqual(await second.locator('.hex-input').evaluateAll(inputs => inputs.map(input => input.value)), customStart,
    'A new custom must not copy the previous custom palette');
  await second.locator('.custom-name').fill(secondName);
  for (const [index, letter] of ['A', 'B', 'C', 'D'].entries()) {
    await second.locator(`.hex-input[data-deck="${letter}"]`).fill(secondColours[index]);
  }
  assert.deepEqual(await desktop.locator('#preset-preview .preview-deck-hex').allTextContents(), secondColours);
  await first.locator('.custom-preview-button').click();
  assert.deepEqual(await desktop.locator('#preset-preview .preview-deck-hex').allTextContents(), colours);
  await second.locator('.custom-name').fill(customName);
  assert.equal(await desktop.locator('#download').isDisabled(), true, 'Duplicate custom names must be rejected');
  await second.locator('.custom-include').uncheck();
  assert.equal(await desktop.locator('#download').isEnabled(), true, 'Excluded invalid palettes must not block export');
  await second.locator('.custom-name').fill(secondName);
  await second.locator('.custom-include').check();
  await desktop.locator('#add-custom').click();
  await desktop.locator('.custom-card[data-custom-id="custom-3"] .custom-remove').click();
  assert.equal(await desktop.locator('#custom-presets .custom-card').count(), 2);
  assert.equal(await desktop.locator('#presets .preset-card[data-slug="custom-3"]').count(), 0, 'Deleting a custom removes its top palette tile');
  await first.locator('.custom-preview-button').click();
  for (const key of ['sandbox', 'shoutout', 'scheduler', 'account']) {
    await desktop.locator(`#toolbar-${key}`).check();
    assert.equal(await desktop.locator(`#toolbar-preview [data-toolbar-control="${key}"]`).count(), 1);
  }
  assert.equal(await desktop.locator('#download-summary').innerText(), '4 palettes · 4 optional controls');
  assert.equal(await desktop.locator('#toolbar-count').innerText(), '6 visible');
  const beforeDisplayChanges = await toolbarConfiguration(desktop);
  await desktop.locator('#toolbar-notch-preview').check();
  const controlWidth = await desktop.locator('#toolbar-preview [data-toolbar-control="settings"]').evaluate(item => item.getBoundingClientRect().width);
  for (const profile of ['13', '14', '15', '16']) {
    await desktop.locator('#toolbar-display-profile').selectOption(profile);
    const autoHidden = profile === '13';
    const visibleOrder = defaultToolbarOrder.filter(key => !autoHidden || key !== 'account');
    await assertToolbarPreview(desktop, { notch: true, profile, colors: colours, order: visibleOrder });
    const renderedWidth = await desktop.locator('#toolbar-preview [data-toolbar-control="settings"]').evaluate(item => item.getBoundingClientRect().width);
    assert.ok(Math.abs(renderedWidth - controlWidth) < .1, 'Profile changes must preserve displayed control size');
    assert.equal(await desktop.locator('#download').isEnabled(), true);
    assert.equal(await desktop.locator('#toolbar-account').isChecked(), !autoHidden);
    assert.equal(await desktop.locator('#toolbar-account').isDisabled(), autoHidden);
    assert.equal(await desktop.locator('#toolbar-order [data-toolbar-key="account"]').evaluate(row => row.classList.contains('is-auto-hidden')), autoHidden);
    assert.equal(await desktop.locator('#toolbar-order input:checked').count(), autoHidden ? 3 : 4);
    assert.match(await desktop.locator('#toolbar-fit-status').innerText(), autoHidden ? /Account hidden for 13″ Air/ : /fit/i);
  }
  assert.deepEqual(await toolbarConfiguration(desktop), beforeDisplayChanges, 'Larger displays restore the requested Account control');
  await desktop.locator('#toolbar-display-profile').selectOption('13');
  await desktop.locator('#toolbar-notch-preview').uncheck();
  assert.equal(await desktop.locator('#toolbar-account').isChecked(), false, '13-inch Air account rule also applies without the notch preview');
  await desktop.locator('#toolbar-shoutout').uncheck();
  assert.equal(await desktop.locator('#toolbar-account').isChecked(), true, 'Removing another optional control restores Account');
  assert.equal(await desktop.locator('#toolbar-account').isEnabled(), true);
  await desktop.locator('#toolbar-shoutout').check();
  assert.equal(await desktop.locator('#toolbar-account').isChecked(), false);
  await desktop.locator('#toolbar-notch-preview').check();
  await assertToolbarPreview(desktop, { notch: true, profile: '13', colors: colours, order: defaultToolbarOrder.filter(key => key !== 'account') });
  await assertToolbarScrolling(desktop);
  const narrowArchive = join(artifacts, 'pro-pure-black-13-air.zip');
  await download(desktop, narrowArchive);
  verifyDownloadedZip(narrowArchive, defaultToolbarOrder.filter(key => key !== 'account'));
  await desktop.locator('.toolbar-panel').screenshot({ path: join(artifacts, 'toolbar-notch-13-controls.png'), animations: 'disabled' });
  await desktop.locator('#toolbar-display-profile').selectOption('16');
  assert.equal(await desktop.locator('#toolbar-account').isChecked(), true);
  await desktop.locator('#toolbar-preview .toolbar-preview-viewport').evaluate(viewport => { viewport.scrollLeft = 70; });
  const settingsEarlier = desktop.locator('#toolbar-order [data-toolbar-key="settings"] [data-move="-1"]');
  await settingsEarlier.click();
  await settingsEarlier.press('Enter');
  let requestedOrder = ['account', 'shoutout', 'scheduler', 'settings', 'sandbox', 'layout'];
  assert.deepEqual(await desktop.locator('#toolbar-order > [data-toolbar-key]').evaluateAll(items => items.map(item => item.dataset.toolbarKey)), requestedOrder);
  assert.equal(await settingsEarlier.evaluate(element => element === document.activeElement), true, 'Keyboard reorder must keep focus');
  await desktop.locator('#toolbar-order [data-toolbar-key="layout"] .toolbar-drag-handle').dragTo(
    desktop.locator('#toolbar-order [data-toolbar-key="account"]'), { targetPosition: { x: 20, y: 5 } });
  requestedOrder = ['layout', 'account', 'shoutout', 'scheduler', 'settings', 'sandbox'];
  assert.deepEqual(await desktop.locator('#toolbar-order > [data-toolbar-key]').evaluateAll(items => items.map(item => item.dataset.toolbarKey)), requestedOrder);
  assert.deepEqual(await desktop.locator('#toolbar-preview [data-toolbar-control]').evaluateAll(items => items.map(item => item.dataset.toolbarControl)), requestedOrder);
  for (const key of ['sandbox', 'shoutout', 'scheduler', 'account']) assert.equal(await desktop.locator(`#toolbar-${key}`).isChecked(), true);
  // Hidden controls retain their order when switched back on.
  await desktop.locator('#toolbar-account').uncheck();
  assert.deepEqual(await desktop.locator('#toolbar-preview [data-toolbar-control]').evaluateAll(items => items.map(item => item.dataset.toolbarControl)), requestedOrder.filter(key => key !== 'account'));
  await desktop.locator('#toolbar-account').check();
  assert.deepEqual(await desktop.locator('#toolbar-preview [data-toolbar-control]').evaluateAll(items => items.map(item => item.dataset.toolbarControl)), requestedOrder);
  await desktop.locator('#toolbar-display-profile').selectOption('16');
  assert.equal(await desktop.locator('#toolbar-preview .toolbar-preview-viewport').evaluate(viewport => viewport.scrollLeft), 70, 'Toolbar scrolling persists through reordering and toggles');
  await assertToolbarPreview(desktop, { notch: true, profile: '16', colors: colours, order: requestedOrder });
  await desktop.locator('.toolbar-panel').screenshot({ path: join(artifacts, 'toolbar-notch-16-reordered.png'), animations: 'disabled' });
  await noHorizontalOverflow(desktop);
  await desktop.screenshot({ path: join(artifacts, 'desktop-custom.png'), fullPage: true, animations: 'disabled' });
  const archive = join(artifacts, 'pro-pure-black-custom.zip');
  await download(desktop, archive);
  verifyDownloadedZip(archive, requestedOrder);
  // Profiles with the same effective controls and notch preview preserve the export.
  const beforePreviewOnlyChanges = await toolbarConfiguration(desktop);
  await desktop.locator('#toolbar-notch-preview').uncheck();
  await desktop.locator('#toolbar-display-profile').selectOption('14');
  await assertToolbarPreview(desktop, { notch: false, profile: '14', colors: colours, order: requestedOrder });
  assert.deepEqual(await toolbarConfiguration(desktop), beforePreviewOnlyChanges);
  const unnotchedArchive = join(artifacts, 'pro-pure-black-no-notch-preview.zip');
  await download(desktop, unnotchedArchive);
  assert.deepEqual(await readFile(unnotchedArchive), await readFile(archive), 'Preview settings must not change the downloaded skin');

  // Logos are decoded as PNG pixels, with transparency and safe text metadata.
  const logos = await logoFixtures(desktop);
  for (const [name, buffer] of [
    ['broken.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
    ['disguised.png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['opaque.png', logos.opaque], ['invisible.png', logos.empty],
  ]) {
    await uploadLogo(desktop, name, buffer);
    assert.equal(await desktop.locator('#custom-logo-status').evaluate(status => status.classList.contains('is-error')), true);
    assert.equal(await desktop.locator('#toolbar-preview [data-custom-logo]').count(), 0);
    assert.equal(await desktop.locator('#download').isEnabled(), true, 'Rejected logo must not block an otherwise valid skin');
  }
  const logoName = '<img src=x onerror="window.injectedLogo=true">.png';
  await uploadLogo(desktop, logoName, logos.transparent);
  assert.equal(await desktop.locator('#custom-logo-status').innerText(), 'Logo ready.');
  assert.equal(await desktop.locator('#custom-logo-details').innerText(), `${logoName} · 144 × 34`);
  assert.equal(await desktop.locator('#custom-logo-details img').count(), 0);
  assert.equal(await desktop.evaluate(() => Boolean(window.injectedLogo)), false);
  const logoImage = desktop.locator('#toolbar-preview image[data-custom-logo]');
  assert.equal(await logoImage.count(), 1);
  assert.deepEqual(await logoImage.evaluate(image => ['x', 'y', 'width', 'height'].map(name => Number(image.getAttribute(name)))), [182, 13, 72, 17]);
  assert.equal(await desktop.locator('#toolbar-preview .toolbar-sim-logo').getAttribute('x'), '100', 'Native VirtualDJ logo must remain');
  assert.equal(await desktop.locator('#toolbar-preview .toolbar-sim-status').getAttribute('data-native-x'), '276');
  const validLogoUrl = await logoImage.getAttribute('href');
  assert.match(validLogoUrl, /^data:image\/png;base64,/);
  await uploadLogo(desktop, 'opaque-replacement.png', logos.opaque);
  assert.match(await desktop.locator('#custom-logo-status').innerText(), /Previous logo kept\./);
  assert.equal(await logoImage.getAttribute('href'), validLogoUrl);
  assert.equal(await desktop.locator('#custom-logo-details').innerText(), `${logoName} · 144 × 34`);
  assert.equal(await desktop.locator('#download').isEnabled(), true);
  await desktop.locator('#toolbar-notch-preview').check();
  await desktop.locator('#toolbar-preview .toolbar-preview-viewport').evaluate(viewport => { viewport.scrollLeft = 0; });
  await desktop.locator('.toolbar-panel').screenshot({ path: join(artifacts, 'toolbar-custom-logo.png'), animations: 'disabled' });
  const logoArchive = join(artifacts, 'pro-pure-black-with-logo.zip');
  await download(desktop, logoArchive);
  verifyLogoZip(logoArchive, unnotchedArchive);

  // A late failed upload cannot undo Remove or leave Download disabled.
  await desktop.evaluate(() => {
    const file = new File(['invalid PNG payload'], 'pending.png', { type: 'image/png' });
    file.arrayBuffer = () => new Promise(resolve => { window.finishPendingLogo = resolve; });
    const input = document.querySelector('#custom-logo-upload');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await desktop.locator('#download').isDisabled(), true, 'Logo validation gates Download');
  await desktop.locator('#custom-logo-remove').click();
  await desktop.evaluate(async () => {
    window.finishPendingLogo(new TextEncoder().encode('invalid PNG payload').buffer);
    await new Promise(resolve => setTimeout(resolve, 0));
    delete document.querySelector('#custom-logo-upload').files;
  });
  assert.equal(await desktop.locator('#custom-logo-status').innerText(), 'Custom logo removed.');
  assert.equal(await desktop.locator('#toolbar-preview [data-custom-logo]').count(), 0);
  assert.equal(await desktop.locator('#toolbar-preview .toolbar-sim-status').getAttribute('data-native-x'), '195');
  assert.equal(await desktop.locator('#custom-logo-details').isVisible(), false);
  assert.equal(await desktop.locator('#download').isEnabled(), true);
  const removedLogoArchive = join(artifacts, 'pro-pure-black-logo-removed.zip');
  await download(desktop, removedLogoArchive);
  assert.deepEqual(await readFile(removedLogoArchive), await readFile(unnotchedArchive), 'Removing the logo restores the exact original export');
  await desktop.waitForFunction(() => document.querySelector('#preset-preview').dataset.motion === 'paused');

  const mobile = await openPage(base, { width: 390, height: 844 }, true);
  await assertDefaultLocked(mobile);
  await mobile.locator('#select-default').click();
  await mobile.locator('#toolbar-sandbox').check();
  await mobile.locator('#add-custom').click();
  // Clearing the last custom must not leave a stale preview cache on re-add.
  await mobile.locator('.custom-card .custom-remove').click();
  assert.equal(await mobile.locator('#custom-preview').count(), 0);
  assert.deepEqual(await mobile.locator('#preset-preview .preview-deck-hex').allTextContents(), defaults);
  await mobile.locator('#add-custom').click();
  assert.equal(await mobile.locator('#preset-preview .preview-deck').count(), 4);
  assert.equal(await mobile.locator('.palette-preview').count(), 1);
  assert.equal(await mobile.locator('#presets .preset-card[data-slug="custom-1"]').count(), 0);
  assert.equal(await mobile.locator('#presets .preset-card[data-slug="custom-2"]').count(), 1);
  await mobile.locator('#select-default').click();
  assert.equal(await mobile.locator('.custom-card .custom-include').isChecked(), false);
  assert.equal(await mobile.locator('#presets .preset-card input:checked').count(), 1);
  await mobile.locator('#select-all').click();
  assert.equal(await mobile.locator('.custom-card .custom-include').isChecked(), true);
  assert.equal(await mobile.locator('#presets .preset-card input:checked').count(), 16);
  await mobile.locator('#toolbar-order [data-toolbar-key="sandbox"] [data-move="-1"]').click();
  assert.deepEqual(await mobile.locator('#toolbar-order > [data-toolbar-key]').evaluateAll(items => items.map(item => item.dataset.toolbarKey)), ['account', 'shoutout', 'sandbox', 'scheduler', 'layout', 'settings']);
  assert.equal(await mobile.locator('#toolbar-sandbox').isChecked(), true);
  await mobile.locator('.custom-card .hex-input[data-deck="A"]').fill(colours[0]);
  assert.equal(await mobile.locator('#download').isEnabled(), true);
  for (const key of ['account', 'shoutout', 'scheduler']) await mobile.locator(`#toolbar-${key}`).check();
  await mobile.locator('#toolbar-notch-preview').check();
  await mobile.locator('#toolbar-display-profile').selectOption('13');
  const mobileColors = await mobile.locator('#preset-preview .preview-deck-hex').allTextContents();
  await assertToolbarPreview(mobile, { notch: true, profile: '13', colors: mobileColors,
    order: ['shoutout', 'sandbox', 'scheduler', 'layout', 'settings'] });
  assert.equal(await mobile.locator('#toolbar-account').isChecked(), false);
  assert.equal(await mobile.locator('#toolbar-account').isDisabled(), true);
  assert.equal(await mobile.locator('#download').isEnabled(), true);
  await assertToolbarScrolling(mobile);
  await assertToolbarPreview(mobile, { notch: true, profile: '13', colors: mobileColors,
    order: ['shoutout', 'sandbox', 'scheduler', 'layout', 'settings'] });
  await mobile.locator('.toolbar-panel').screenshot({ path: join(artifacts, 'toolbar-notch-13-mobile.png'), animations: 'disabled' });
  await noHorizontalOverflow(mobile);
  await assertLogoControlLayout(mobile, true);
  await assertBlackSurfaces(mobile);
  await mobile.screenshot({ path: join(artifacts, 'mobile.png'), fullPage: true, animations: 'disabled' });
  await recordAnimatedPreview(base);
  assert.deepEqual(errors, [], 'Browser errors were emitted.');
  console.log('Passed: locked Default, mixed Pastel/Bold group selection, one shared animated preview, multiple custom presets, independent selection/preview, custom validation, synchronized custom palette tiles, toolbar toggles and button ordering, palette-linked website accents with black surfaces, fixed-size scrolling toolbar previews with automatic Account handling on 13-inch Air, fixed custom starts and new random palettes, clipboard fallback, validated transparent logos with safe removal, identical exports across preview settings, real ZIP download, desktop/mobile layout, no browser errors.');
} catch (error) {
  for (const { page, label } of pages) {
    await page.screenshot({ path: join(artifacts, `${label}-failure.png`), fullPage: true, animations: 'disabled' }).catch(() => {});
  }
  throw error;
} finally {
  await writeFile(join(artifacts, 'console-errors.json'), JSON.stringify(errors, null, 2) + '\n');
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
}

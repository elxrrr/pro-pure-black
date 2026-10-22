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
const colours = ['#E89CBE', '#89BFF0', '#84D6B5', '#F2C48F'];
const customName = 'Studio <&> Mix';
const secondColours = ['#CA8CD3', '#82D8D1', '#EDB274', '#C7CFEF'];
const secondName = 'Second preset';
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

function verifyDownloadedZip(filename) {
  const result = spawnSync('python3', ['-c', String.raw`
from html.parser import HTMLParser
from pathlib import Path
import json, re, sys, zipfile

root = Path(sys.argv[1])
colours = json.loads(sys.argv[3])
second_colours = json.loads(sys.argv[4])
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
    assert re.findall(r'<item text="([^"]+)"', menu) == ['Default', 'Pastel Pink', 'Studio &lt;&amp;&gt; Mix', 'Second preset']
assert 'pureblack-theme-pastel-pink' in xml
assert 'pureblack-theme-custom-1' in xml
assert 'pureblack-theme-custom-2' in xml
assert 'pureblack-theme-custom-3' not in xml
assert 'pureblack-theme-violet' not in xml
for action, count in [('connect', 2), ('shoutout', 2), ('eventscheduler', 2), ('sandbox', 6)]:
    assert xml.count('<button action="' + action + '"') == count, action
for index, palette in enumerate([colours, second_colours], 1):
    block = re.search(r'<group name="pureblack-theme-custom-' + str(index) + r'".*?</group>', xml, re.S).group(0)
    for deck, colour in enumerate(palette, 1):
        for role in ['deckcolor', 'scratch1', 'scratch2', 'pureblack_waveinstru']:
            assert f'<define color="{role}" value="{colour}" deck="{deck}"/>' in block
        for role in [f'waveform_active{deck}', f'pureblack_meter{deck}']:
            assert f'<define color="{role}" value="{colour}"/>' in block

# The untouched source preceding the generated palettes contains the native
# Atomix colours, original skin controls and fixed black surfaces.
source = (root / 'skin' / 'Pro.xml').read_text()
normal = xml.replace('\r\n', '\n').replace('name="Pro Pure Black Custom"', 'name="Pro Pure Black"', 1)
assert normal.split('<!-- BEGIN PURE BLACK DECK THEMES -->')[0] == source.split('<!-- BEGIN PURE BLACK DECK THEMES -->')[0]
print('Browser-exported ZIP: valid CRC, exact sprites, two independent custom palettes, all four native toolbar controls, custom deck/waveform/VU colours, unchanged Atomix definitions.')
`, root, filename, JSON.stringify(colours), JSON.stringify(secondColours)], { encoding: 'utf8', cwd: root });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  console.log(result.stdout.trim());
}

await mkdir(artifacts, { recursive: true });
try {
  const base = process.env.BASE_URL || await localServer();
  browser = await chromium.launch({ headless: true });
  const desktop = await openPage(base, { width: 1440, height: 1050 });
  await assertDefaultLocked(desktop);
  assert.equal(await desktop.locator('#presets input:checked').count(), 11);
  assert.equal(await desktop.locator('#custom-presets .custom-card').count(), 0);
  assert.equal(await desktop.locator('header').count(), 0);
  for (const removed of ['VIRTUALDJ · PRO LAYOUT', 'Black base. Your colours.', 'Pure black, always',
    'Keep what you use', 'Your own four', 'Build your palette menu', 'Made for VirtualDJ', 'Ready to build your skin']) {
    assert.ok(!(await desktop.locator('body').innerText()).includes(removed), `Removed copy remains: ${removed}`);
  }
  assert.equal(await desktop.locator('footer a[href="https://github.com/elxrrr/pro-pure-black"]').count(), 1);
  assert.equal(await desktop.locator('footer a[href="https://github.com/elxrrr/pro-pure-black/releases/latest"]').count(), 1);
  assert.match(await desktop.locator('footer').innerText(), /Made with AI/i);
  assert.deepEqual(await desktop.locator('#preset-preview .preview-deck-hex').allTextContents(), defaults);
  assert.equal(await desktop.locator('#preset-preview .preview-deck').count(), 4);
  assert.equal(await desktop.locator('#preset-preview .preview-wave').count(), 4);
  assert.equal(await desktop.locator('#preset-preview .preview-meter').count(), 4);
  assert.equal(await desktop.locator('#toolbar-preview [data-toolbar-control]').count(), 0);
  await desktop.locator('#preset-preview').scrollIntoViewIfNeeded();
  await desktop.waitForFunction(() => document.querySelector('#preset-preview').dataset.motion === 'running');
  // Compositor animations stop when the system asks for reduced motion.
  await desktop.emulateMedia({ reducedMotion: 'reduce' });
  await desktop.waitForFunction(() => document.querySelector('#preset-preview').dataset.motion === 'paused');
  assert.ok(await desktop.locator('#preset-preview .preview-motion').evaluateAll(elements =>
    elements.length > 0 && elements.every(element => {
      const style = getComputedStyle(element);
      return style.animationName === 'none' || style.animationPlayState === 'paused';
    })));
  await desktop.emulateMedia({ reducedMotion: 'no-preference' });
  await noHorizontalOverflow(desktop);
  await desktop.screenshot({ path: join(artifacts, 'desktop-default.png'), fullPage: true, animations: 'disabled' });

  // Previewing is independent of including a preset in the downloaded skin.
  await desktop.locator('#select-default').click();
  await desktop.getByRole('button', { name: 'Preview Pastel Pink', exact: true }).click();
  assert.equal(await desktop.locator('#preview-title').innerText(), 'Pastel Pink');
  assert.equal(await desktop.locator('#presets input:checked').count(), 1);
  await desktop.getByRole('checkbox', { name: 'Include Pastel Pink', exact: true }).check();
  await assertDefaultLocked(desktop);

  // Custom presets are independent and can be added, excluded and removed.
  await desktop.locator('#add-custom').click();
  const first = desktop.locator('.custom-card[data-custom-id="custom-1"]');
  assert.equal(await first.locator('.custom-include').isChecked(), true);
  // Invalid colours and a duplicate Default name must never produce a ZIP.
  await first.locator('.hex-input[data-deck="A"]').fill('#xyz');
  assert.equal(await desktop.locator('#download').isDisabled(), true);
  for (const [index, letter] of ['A', 'B', 'C', 'D'].entries()) {
    await first.locator(`.hex-input[data-deck="${letter}"]`).fill(colours[index]);
  }
  await first.locator('.custom-name').fill('Default');
  assert.equal(await desktop.locator('#download').isDisabled(), true);
  await first.locator('.custom-name').fill(customName);
  assert.equal(await desktop.locator('#download').isEnabled(), true);
  assert.deepEqual(await desktop.locator('#custom-preview .preview-deck-hex').allTextContents(), colours);

  await desktop.locator('#add-custom').click();
  const second = desktop.locator('.custom-card[data-custom-id="custom-2"]');
  await second.locator('.custom-name').fill(secondName);
  for (const [index, letter] of ['A', 'B', 'C', 'D'].entries()) {
    await second.locator(`.hex-input[data-deck="${letter}"]`).fill(secondColours[index]);
  }
  assert.deepEqual(await desktop.locator('#custom-preview .preview-deck-hex').allTextContents(), secondColours);
  await first.locator('.custom-preview-button').click();
  assert.deepEqual(await desktop.locator('#custom-preview .preview-deck-hex').allTextContents(), colours);
  await second.locator('.custom-name').fill(customName);
  assert.equal(await desktop.locator('#download').isDisabled(), true, 'Duplicate custom names must be rejected');
  await second.locator('.custom-include').uncheck();
  assert.equal(await desktop.locator('#download').isEnabled(), true, 'Excluded invalid palettes must not block export');
  await second.locator('.custom-name').fill(secondName);
  await second.locator('.custom-include').check();
  await desktop.locator('#add-custom').click();
  await desktop.locator('.custom-card[data-custom-id="custom-3"] .custom-remove').click();
  assert.equal(await desktop.locator('#custom-presets .custom-card').count(), 2);
  await first.locator('.custom-preview-button').click();
  for (const key of ['sandbox', 'shoutout', 'scheduler', 'account']) {
    await desktop.locator(`#toolbar-${key}`).check();
    assert.equal(await desktop.locator(`#toolbar-preview [data-toolbar-control="${key}"]`).count(), 1);
  }
  assert.equal(await desktop.locator('#download-summary').innerText(), '4 palettes · 4 optional controls');
  await noHorizontalOverflow(desktop);
  await desktop.screenshot({ path: join(artifacts, 'desktop-custom.png'), fullPage: true, animations: 'disabled' });
  const archive = join(artifacts, 'pro-pure-black-custom.zip');
  await download(desktop, archive);
  verifyDownloadedZip(archive);
  await desktop.waitForFunction(() => document.querySelector('#preset-preview').dataset.motion === 'paused');

  const mobile = await openPage(base, { width: 390, height: 844 }, true);
  await assertDefaultLocked(mobile);
  await mobile.locator('#select-default').click();
  await mobile.locator('#toolbar-sandbox').check();
  await mobile.locator('#add-custom').click();
  // Clearing the last custom must not leave a stale preview cache on re-add.
  await mobile.locator('.custom-card .custom-remove').click();
  assert.equal(await mobile.locator('#custom-preview').isVisible(), false);
  await mobile.locator('#add-custom').click();
  assert.equal(await mobile.locator('#custom-preview .preview-deck').count(), 4);
  await mobile.locator('.custom-card .hex-input[data-deck="A"]').fill(colours[0]);
  assert.equal(await mobile.locator('#download').isEnabled(), true);
  await noHorizontalOverflow(mobile);
  await mobile.screenshot({ path: join(artifacts, 'mobile.png'), fullPage: true, animations: 'disabled' });
  assert.deepEqual(errors, [], 'Browser errors were emitted.');
  console.log('Passed: locked Default, multiple custom presets, independent selection/preview, custom validation, toolbar toggles, real ZIP download, desktop/mobile layout, no browser errors.');
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

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium, webkit } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docs = join(root, 'docs');
const artifacts = join(root, 'browser-checks');
const defaults = ['#156C89', '#AC2F37', '#0D7264', '#A54D30'];
const customStart = ['#E98DB6', '#89BFF0', '#B69BE4', '#F2C48F'];
const colours = ['#E89CBE', '#89BFF0', '#84D6B5', '#F2C48F'];
const customName = 'Studio <&> Mix';
const secondColours = ['#CA8CD3', '#82D8D1', '#EDB274', '#C7CFEF'];
const secondName = 'Second preset';
const paletteNames = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink'];
const aestheticNames = ['Daydream', 'Ghost in the Shell', 'Outrun', 'Cozycore', 'Cottagecore', 'Afterglow', 'Moon Garden'];
const statusKeys = ['master', 'cpu', 'battery', 'clock'];
const defaultToolbarOrder = ['account', 'shoutout', 'scheduler', 'sandbox', 'layout', 'settings'];
const errors = [];
let server;
let browser;
let safari;
const iphone17 = { width: 402, height: 874 };
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

async function openPage(base, viewport, mobile = false, engine = browser) {
  const context = await engine.newContext({ viewport, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const label = mobile ? `iphone17-${engine.browserType().name()}` : 'desktop';
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

async function assertAnimatedPreview(page, selector, parts = ['.preview-rotor', '.preview-knob-needle',
  ['.preview-knob-highlight', 'strokeDashoffset'], '.preview-wave-strip', ['.preview-meter-cell', 'opacity']]) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.waitForFunction(selector => document.querySelector(selector).dataset.motion === 'running', selector);
  parts = parts.map(part => typeof part === 'string' ? [part, 'transform'] : part);
  const before = await page.locator(selector).evaluate((preview, parts) =>
    parts.map(([part, property]) => [...preview.querySelectorAll(part)].map(element => getComputedStyle(element)[property])), parts);
  assert.ok(before.every(values => values.length), 'Every requested animation must exist');
  await page.waitForFunction(({ selector, parts, before }) => parts.every(([part, property], index) =>
    JSON.stringify([...document.querySelector(selector).querySelectorAll(part)].map(element => getComputedStyle(element)[property])) !== JSON.stringify(before[index])),
  { selector, parts, before });
}

async function assertKnobRange(page) {
  const ranges = await page.locator('#preset-preview .preview-knob-highlight').evaluateAll(async highlights => {
    const records = highlights.map(highlight => ({ highlight, animation: highlight.getAnimations()[0] }));
    const reset = highlights.flatMap(highlight => [highlight, highlight.closest('.preview-knob').querySelector('.preview-knob-needle')])
      .map(element => ({ element, inlineName: element.style.getPropertyValue('animation-name') }));
    records.forEach(({ animation }) => animation.pause());
    await Promise.all(records.map(({ animation }) => animation.ready));
    try {
      return records.map(({ highlight, animation }) => {
        const timing = animation.effect.getTiming();
        return [.1, .6, .95].map(phase => {
          animation.currentTime = Number(timing.delay) + Number(timing.duration) * (1 + phase);
          return parseFloat(getComputedStyle(highlight).strokeDashoffset);
        });
      });
    } finally {
      // Restart the matching needle together with its arc, retaining their phase.
      reset.forEach(({ element }) => { element.style.animationName = 'none'; });
      reset.forEach(({ element }) => getComputedStyle(element).animationName);
      reset.forEach(({ element, inlineName }) => {
        if (inlineName) element.style.animationName = inlineName;
        else element.style.removeProperty('animation-name');
      });
    }
  });
  assert.equal(ranges.length, 4);
  ranges.forEach(range => assert.deepEqual(range, [100, 0, 100], 'Each effect knob starts unlit, fills with colour, then returns to grey'));
}

async function assertWholeSquareMeters(page) {
  // Seek the actual CSS animations around every keyframe and between changes,
  // so fractional fills or skipped squares cannot hide between wall-clock samples.
  const meters = await page.locator('.preview-meter-fill, .toolbar-master-fill').evaluateAll(async fills => {
    const records = fills.map(fill => {
      const animation = fill.getAnimations()[0];
      if (!animation) throw new Error('Each meter needs an animated level sequence');
      const cells = [...fill.querySelectorAll('.meter-cell-lit')];
      const timing = animation.effect.getTiming();
      return { fill, cells, animation, timing, inlineName: fill.style.getPropertyValue('animation-name') };
    });
    records.forEach(({ animation }) => animation.pause());
    await Promise.all(records.map(({ animation }) => animation.ready));
    try {
      return records.map(({ fill, cells, animation, timing }) => {
        const horizontal = fill.classList.contains('toolbar-master-fill');
        const geometry = () => cells.map(cell => {
          const box = cell.getBoundingClientRect(), style = getComputedStyle(cell);
          return { x: box.x, y: box.y, width: box.width, height: box.height,
            transform: style.transform, clip: style.clipPath };
        });
        const initialGeometry = geometry();
        const offsets = [...new Set([0, 1, ...animation.effect.getKeyframes().map(frame => frame.computedOffset)])].sort((a, b) => a - b);
        const points = [...new Set(offsets.flatMap((offset, index) => [
          Math.max(0, offset - .00001), offset, Math.min(1, offset + .00001),
          ...(index ? [(offset + offsets[index - 1]) / 2] : []),
        ]))].sort((a, b) => a - b);
        let fixed = true;
        const samples = points.map(point => {
          // The extra cycle keeps negative deck phase delays in the active interval.
          animation.currentTime = Number(timing.delay) + Number(timing.duration) * (1 + point);
          const values = cells.map(cell => Number(getComputedStyle(cell).opacity));
          fixed &&= JSON.stringify(geometry()) === JSON.stringify(initialGeometry);
          return values;
        });
        const surface = horizontal
          ? fill.closest('.toolbar-sim-status').querySelector(':scope > rect').getAttribute('fill')
          : getComputedStyle(fill.closest('.preview-meter')).backgroundColor;
        return { horizontal, geometry: initialGeometry, fixed, samples, surface,
          stableSampleIndices: points.flatMap((point, index) => offsets.includes(point) ? [] : [index]),
          levels: cells.map(cell => Number(cell.dataset.level)),
          transform: getComputedStyle(fill).transform, clip: getComputedStyle(fill).clipPath };
      });
    } finally {
      // Recreate CSS-owned animations so seeking cannot override later reduced-
      // motion or off-screen pause rules through the Web Animations API.
      records.forEach(({ fill }) => { fill.style.animationName = 'none'; });
      records.forEach(({ fill }) => getComputedStyle(fill).animationName);
      records.forEach(({ fill, inlineName }) => {
        if (inlineName) fill.style.animationName = inlineName;
        else fill.style.removeProperty('animation-name');
      });
    }
  });
  assert.equal(meters.length, 6, 'Four deck meters and both master channels use whole-square levels');
  let sharedCounts;
  for (const meter of meters) {
    assert.deepEqual(meter.levels, Array.from({ length: 11 }, (_, index) => index + 1));
    assert.equal(meter.fixed, true, 'Meter cells and black gaps must stay fixed throughout the animation');
    assert.equal(meter.transform, 'none');
    assert.equal(meter.clip, 'none');
    assert.match(meter.surface, /^(#000|rgb\(0,\s*0,\s*0\))$/);
    meter.geometry.forEach((cell, index, cells) => {
      assert.ok(Math.abs(cell.width - cell.height) < .05 && cell.width > 0, 'Every illuminated cell is a complete square');
      assert.equal(cell.transform, 'none');
      assert.equal(cell.clip, 'none');
      if (index) {
        const previous = cells[index - 1];
        const gap = meter.horizontal ? cell.x - previous.x - previous.width : previous.y - cell.y - cell.height;
        assert.ok(gap > .1, 'Squares remain separated by black gaps');
      }
    });
    const counts = meter.samples.map(values => {
      assert.ok(values.every(value => value === 0 || value === 1), 'A square must be completely lit or completely off');
      const count = values.reduce((sum, value) => sum + value, 0);
      assert.deepEqual(values, values.map((_, index) => Number(index < count)), 'Lit squares must be contiguous from the base');
      return count;
    });
    const changes = counts.slice(1).map((count, index) => count - counts[index]);
    assert.ok(changes.some(change => change > 0) && changes.some(change => change < 0), 'Meter levels must rise and fall');
    assert.ok(changes.every(change => Math.abs(change) <= 1), 'Levels must switch squares sequentially, one at a time');
    // Different phase delays can round an exact boundary to opposite sides of
    // the same step. Compare shared timing just before/after it and in between.
    const stableCounts = meter.stableSampleIndices.map(index => counts[index]);
    if (sharedCounts) assert.deepEqual(stableCounts, sharedCounts, 'Deck and master meters must share the same level sequence after their phase delays are removed');
    else sharedCounts = stableCounts;
  }
}

async function assertPhraseBeats(page) {
  const samples = await page.locator('.toolbar-phrase-clock').evaluate(async clock => {
    const animation = clock.getAnimations()[0];
    if (!animation) throw new Error('Phrase counters need a beat animation');
    const timing = animation.effect.getTiming();
    const inlineName = clock.style.getPropertyValue('animation-name');
    animation.pause(); await animation.ready;
    try {
      return Array.from({ length: 17 }, (_, step) => {
        animation.currentTime = Number(timing.delay) + Number(timing.duration) * (1 + (step + .5) / 16);
        return {
          circles: [...clock.querySelectorAll('.toolbar-sim-phrase')].map(circle => ({
            rings: [...circle.querySelectorAll('circle.toolbar-phrase-progress')].map(element => ({
              offset: parseFloat(getComputedStyle(element).strokeDashoffset), length: element.getAttribute('pathLength'),
            })),
            trackDashes: getComputedStyle(circle.querySelector('.toolbar-phrase-track')).strokeDasharray,
            segments: circle.querySelectorAll('.toolbar-phrase-segment').length,
            count: [...circle.querySelectorAll('.toolbar-phrase-count')].map(element => Number(getComputedStyle(element).opacity)),
          })),
          bars: [...clock.querySelectorAll('.toolbar-beat-row')].map(row =>
            [...row.querySelectorAll('.toolbar-beat-progress')].map(element => Number(getComputedStyle(element).opacity))),
        };
      });
    } finally {
      clock.style.animationName = 'none'; getComputedStyle(clock).animationName;
      if (inlineName) clock.style.animationName = inlineName; else clock.style.removeProperty('animation-name');
    }
  });
  samples.forEach((sample, step) => {
    const beat = step % 16 + 1;
    assert.equal(sample.circles.length, 4);
    sample.circles.forEach(circle => {
      assert.equal(circle.segments, 0, 'The ring must be continuous, without separate gapped segments');
      assert.equal(circle.trackDashes, 'none');
      assert.deepEqual(circle.rings, [{ offset: 16 - beat, length: '16' }],
        'One continuous ring fills by one sixteenth per beat, then resets after 16');
      assert.deepEqual(circle.count, Array.from({ length: 16 }, (_, index) => Number(index + 1 === beat)),
        'Exactly one counter number is visible and matches the ring fill');
    });
    sample.bars.forEach(row => assert.deepEqual(row, Array.from({ length: 4 }, (_, index) => Number(index === step % 4)),
      'Phrase bar lights move left to right, one complete light per beat'));
  });
}

async function assertStatusSelection(page, enabled) {
  for (const key of statusKeys) {
    assert.equal(await page.locator(`#toolbar-${key}`).isChecked(), enabled.includes(key));
    assert.equal(await page.locator(`#toolbar-preview .toolbar-sim-${key}`).count(), Number(enabled.includes(key)),
      `Status switch ${key} must control its preview`);
  }
  assert.equal(await page.locator('#toolbar-preview .toolbar-sim-status').count(), Number(enabled.length > 0));
}

async function assertStatusControls(page) {
  const reduced = join(artifacts, 'status-master-clock.zip');
  await download(page, reduced); verifyStatusZip(reduced, ['master', 'clock']);
  for (const key of ['master', 'clock']) await page.locator(`#toolbar-${key}`).uncheck();
  await assertStatusSelection(page, []);
  const empty = join(artifacts, 'status-hidden.zip');
  await download(page, empty); verifyStatusZip(empty, []);
  for (const [index, key] of statusKeys.entries()) {
    await page.locator(`#toolbar-${key}`).check();
    await assertStatusSelection(page, statusKeys.slice(0, index + 1));
  }
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

async function assertToolbarPreview(page, { notch, colors, order, accountLeft = false }) {
  await page.waitForFunction(({ notch, order, accountLeft }) => {
    const preview = document.querySelector('#toolbar-preview');
    return preview.dataset.notch === String(notch)
      && JSON.stringify([...preview.querySelectorAll('.toolbar-sim-right [data-toolbar-control]')].map(item => item.dataset.toolbarControl)) === JSON.stringify(order)
      && Boolean(preview.querySelector('.toolbar-sim-left [data-toolbar-control="account"]')) === accountLeft;
  }, { notch, order, accountLeft });
  const preview = await page.locator('#toolbar-preview').evaluate(container => ({
    renderWidth: Number(container.dataset.renderWidth),
    notch: container.dataset.notch,
    width: container.querySelector('.toolbar-sim-svg').viewBox.baseVal.width,
    notchCount: container.querySelectorAll('.toolbar-sim-notch').length,
    barsCount: container.querySelectorAll('.toolbar-sim-beat-bars').length,
    controls: [...container.querySelectorAll('.toolbar-sim-right [data-toolbar-control]')].map(item => ({
      key: item.dataset.toolbarControl, x: Number(item.dataset.nativeX), y: Number(item.dataset.nativeY),
      width: Number(item.dataset.nativeWidth), height: Number(item.dataset.nativeHeight),
    })),
    circles: [...container.querySelectorAll('[data-phrase-deck]')].map(item => ({
      deck: item.dataset.phraseDeck, x: Number(item.dataset.nativeX), y: Number(item.dataset.nativeY),
      width: Number(item.dataset.nativeWidth), color: item.dataset.color,
    })),
  }));
  const canvasWidth = preview.renderWidth / .75;
  const phraseOffset = (canvasWidth - 1920) / 2;
  assert.ok(Math.abs(preview.width - canvasWidth) < .001, 'Display size must change available width rather than shrink the controls');
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
  assert.equal(preview.controls[0].x >= (notch ? 1160 : 1102) + phraseOffset + 10, true,
    'Fit result must agree with the actual gap beside the phrase counters');
  assert.ok(Math.abs(preview.controls.at(-1).x + preview.controls.at(-1).width - (canvasWidth - 10)) < .001);
  assert.equal(await page.locator('#toolbar-preview .toolbar-sim-status').getAttribute('data-native-x'), accountLeft ? '327' : '195');
  if (accountLeft) assert.equal(await page.locator('#toolbar-preview .toolbar-sim-left [data-toolbar-control="account"]').getAttribute('data-native-x'), '182');
  assert.equal(await page.locator('#toolbar-fit-status').isVisible(), false, 'Normal responsive toolbar behaviour must not add a status message');
}

async function assertToolbarScrolling(page) {
  assert.equal(await page.locator('#toolbar-preview .toolbar-preview-zoom').count(), 0, 'The toolbar needs no Zoom/Fit switch');
  const geometry = await page.locator('#toolbar-preview').evaluate(container => {
    const viewport = container.querySelector('.toolbar-preview-viewport');
    return { width: container.querySelector('.toolbar-sim-svg').getBoundingClientRect().width,
      renderWidth: Number(container.dataset.renderWidth), viewport: viewport.clientWidth, scrollWidth: viewport.scrollWidth, tabIndex: viewport.tabIndex, overflow: getComputedStyle(viewport).overflowX,
      label: viewport.getAttribute('aria-label') || viewport.getAttribute('aria-labelledby') };
  });
  assert.ok(geometry.tabIndex >= 0 && geometry.label, 'Toolbar viewport must be named and keyboard focusable');
  assert.ok(Math.abs(geometry.width - geometry.renderWidth) < 1,
    'The toolbar must remain readable at its fixed display scale');
  assert.match(geometry.overflow, /^(auto|scroll)$/);
  assert.equal(geometry.scrollWidth > geometry.viewport, geometry.width > geometry.viewport + 1,
    'The toolbar scrolls locally only when its fixed-size frame exceeds the available page width');
  await noHorizontalOverflow(page);
}

async function assertLogoControlLayout(page, mobile = false) {
  const main = await page.locator('main').boundingBox();
  const viewport = page.viewportSize().width;
  assert.ok(main.width >= viewport - 48 && main.width < viewport, 'The builder uses the available viewport width');
  const display = await page.locator('.toolbar-notch-toggle').boundingBox();
  const logo = await page.locator('.custom-logo-controls').boundingBox();
  assert.ok(display && logo);
  if (mobile) assert.ok(logo.x >= display.x + display.width || logo.y >= display.y + display.height, 'Logo controls remain separate from Notch on mobile');
  else {
    assert.ok(logo.x > display.x + display.width, 'Logo controls sit to the right of display controls');
    assert.ok(Math.abs(logo.y + logo.height / 2 - display.y - display.height / 2) < 2,
      'Logo and display controls share one desktop line');
  }
  assert.equal(await page.locator('.custom-logo-label').count(), 0);
  assert.equal(await page.locator('.custom-logo-controls').evaluate(element => getComputedStyle(element).borderLeftWidth), '0px');
  assert.equal(await page.locator('.custom-logo-picker > span').innerText(), 'Add Logo...');
  const upload = await page.locator('.custom-logo-picker').boundingBox();
  for (const selector of ['#toolbar-notch-preview', '#logo-tint']) {
    const toggle = await page.locator(selector).boundingBox();
    assert.ok(Math.abs(toggle.height - upload.height) <= 1, 'Preview toggle buttons match the upload control height');
  }
  assert.equal(await page.locator('#custom-logo-upload').getAttribute('accept'), '.png');
  assert.equal(await page.locator('.custom-logo-picker').evaluate(picker =>
    picker.querySelector('input').getAttribute('title') || picker.getAttribute('title')), 'Transparent PNG · 5 MB max · 144 × 34 px');
  assert.equal(await page.locator('#custom-logo-hint').evaluate(hint => hint.classList.contains('sr-only')), true);
  assert.match(await page.locator('#custom-logo-hint').innerText(), /144 × 34 px/);
  assert.match(await page.locator('#custom-logo-hint').innerText(), /5 MB max/);
  assert.equal(await page.locator('#toolbar-preview-note, #toolbar-order-hint, #custom-logo-details, #toolbar-display-profile').count(), 0);
}

async function assertPaletteGroup(page, group, checked, indeterminate = false) {
  assert.deepEqual(await page.locator(`#select-${group}`).evaluate(input => [input.checked, input.indeterminate]), [checked, indeterminate]);
}

async function setPressed(page, selector, pressed) {
  const button = page.locator(selector);
  if (await button.getAttribute('aria-pressed') !== String(pressed)) await button.click();
  assert.equal(await button.getAttribute('aria-pressed'), String(pressed));
}

async function assertCustomBorders(page) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.mouse.move(0, 0);
  await page.waitForFunction(() => {
    const colour = getComputedStyle(document.querySelector('.toolbar-order-row')).borderTopColor;
    return [...document.querySelectorAll('.custom-name, .custom-randomise, #add-custom, .hex-input')].every(element => {
      const style = getComputedStyle(element);
      return (element.matches('.hex-input') ? style.borderBottomColor : style.borderTopColor) === colour;
    });
  });
}

async function assertConfigurationLayout(page, wide) {
  const custom = await page.locator('.custom-panel').boundingBox();
  const toolbar = await page.locator('.toolbar-panel').boundingBox();
  if (wide) {
    assert.ok(Math.abs(custom.y - toolbar.y) <= 1 && custom.x + custom.width <= toolbar.x,
      'Custom presets and toolbar controls share one desktop row');
    assert.ok(Math.abs(custom.height - toolbar.height) <= 1, 'Desktop configuration panels have matching outer heights');
  } else {
    assert.ok(toolbar.y >= custom.y + custom.height, 'Configuration panels stack on narrow screens');
  }
  assert.equal(await page.locator('.toolbar-always').count(), 0);
  assert.equal(await page.locator('#toolbar-order [data-toolbar-key="account"] .toggle-row').innerText(), 'Account');
  assert.equal(await page.getByRole('button', { name: 'Move Account earlier', exact: true }).count(), 1);
  assert.deepEqual(await page.locator('#custom-presets .colour-field-label').evaluateAll(labels =>
    labels.map(label => getComputedStyle(label).textAlign)), Array(4).fill('center'), 'Deck colour labels are centred over their selectors');
  const add = page.getByRole('button', { name: 'Add preset', exact: true });
  assert.equal(await add.getAttribute('id'), 'add-custom');
  assert.equal(await add.innerText(), '+');
  assert.equal(await page.locator('.custom-panel > .panel-heading #add-custom').count(), 0);
  const actions = await page.locator('.custom-actions').evaluate(element => {
    const random = element.querySelector('.custom-randomise').getBoundingClientRect();
    const add = element.querySelector('#add-custom').getBoundingClientRect();
    return { left: add.left >= random.right, aligned: Math.abs(add.top + add.height / 2 - random.top - random.height / 2) <= 1 };
  });
  assert.ok(actions.left && actions.aligned, 'The add button sits beside Random');
}

async function assertSharedPreview(page) {
  assert.equal(await page.locator('.overall-preview > .panel-heading > h1#preview-title').innerText(), 'Preview');
  assert.equal(await page.locator('h2#presets-title').innerText(), 'Colour presets');
  assert.deepEqual(await page.locator('#preview-title').evaluate(title => {
    const style = getComputedStyle(title); return [style.fontSize, style.fontWeight];
  }), await page.locator('#presets-title').evaluate(title => {
    const style = getComputedStyle(title); return [style.fontSize, style.fontWeight];
  }), 'The shared Preview heading must match the Colour presets heading');
  assert.equal(await page.locator('.overall-preview #toolbar-preview + #preset-preview').count(), 1);
  const sharedFrame = await page.locator('.overall-preview .preview-window').evaluate(window => {
    const toolbar = window.querySelector('#toolbar-preview').getBoundingClientRect();
    const palette = window.querySelector('#preset-preview'), deckBounds = palette.getBoundingClientRect();
    const style = getComputedStyle(palette);
    return { widths: Math.abs(toolbar.width - deckBounds.width), gap: deckBounds.top - toolbar.bottom,
      borders: ['Top', 'Right', 'Bottom', 'Left'].map(edge => style[`border${edge}Width`]),
      outline: window.querySelector('.toolbar-screen-outline').getAttribute('d') };
  });
  assert.ok(sharedFrame.widths <= 1 && Math.abs(sharedFrame.gap) <= 1, 'Toolbar and decks join into one frame');
  assert.deepEqual(sharedFrame.borders, ['0px', '1px', '1px', '1px']);
  assert.doesNotMatch(sharedFrame.outline, /z/i, 'The toolbar outline stays open where the deck frame continues');
  assert.equal(await page.locator('.palette-preview').count(), 1);
  assert.equal(await page.locator('.toolbar-sim-svg').count(), 1);
  assert.equal(await page.locator('.toolbar-sim-svg > rect, .toolbar-sim-svg > path').count(), 0,
    'No scrolling frame or second line creates an empty outlined strip below the controls');
  const frame = page.locator('.toolbar-preview-viewport + .toolbar-screen-frame');
  assert.equal(await frame.count(), 1);
  assert.equal(await frame.getAttribute('aria-hidden'), 'true');
  assert.equal(await frame.evaluate(element => getComputedStyle(element).pointerEvents), 'none', 'The frame must not intercept toolbar scrolling');
  const alignment = await page.locator('#toolbar-preview').evaluate(container => {
    const viewport = container.querySelector('.toolbar-preview-viewport');
    const frame = container.querySelector('.toolbar-screen-frame');
    const viewportBounds = viewport.getBoundingClientRect(), frameBounds = frame.getBoundingClientRect();
    const notch = frame.querySelector('.toolbar-screen-notch > path')?.getBoundingClientRect();
    const camera = viewport.querySelector('.toolbar-sim-notch > circle')?.getBoundingClientRect();
    const top = viewport.getBoundingClientRect().top + viewport.clientTop;
    const centre = top + viewport.clientHeight / 2;
    return {
      frameOffsets: ['x', 'y', 'width', 'height'].map(key => Math.abs(frameBounds[key] - viewportBounds[key])),
      offsets: [...viewport.querySelectorAll('.toolbar-sim-control > rect, .toolbar-sim-status > rect, .toolbar-sim-phrase > circle:first-of-type')].map(element => {
        const bounds = element.getBoundingClientRect();
        return Math.abs(bounds.top + bounds.height / 2 - centre);
      }),
      notchTop: notch?.top,
      cameraOffset: notch && camera ? Math.abs(notch.x + notch.width / 2 - camera.x - camera.width / 2) : null,
      mask: frame.querySelector('.toolbar-screen-outline').getAttribute('mask'),
      notchClip: frame.querySelector('.toolbar-screen-notch')?.parentElement.getAttribute('clip-path'),
      fillStroke: viewport.querySelector('.toolbar-sim-notch > path') ? getComputedStyle(viewport.querySelector('.toolbar-sim-notch > path')).stroke : null,
      top,
    };
  });
  assert.ok(alignment.frameOffsets.every(offset => offset <= 1), 'The screen frame stays pinned to the visible viewport bounds');
  assert.ok(alignment.offsets.length > 0 && alignment.offsets.every(offset => offset <= 1),
    'Visible toolbar controls must be vertically centred inside the boundary');
  if (alignment.notchTop !== undefined) {
    assert.ok(Math.abs(alignment.notchTop - alignment.top - .5) <= 1, 'The notch contour joins the top screen edge');
    assert.ok(alignment.cameraOffset <= 1, 'The camera remains centred in the notch while panning');
    assert.match(alignment.mask, /^url\(#/);
    assert.match(alignment.notchClip, /^url\(#/);
    assert.equal(alignment.fillStroke, 'none', 'Only the fixed screen overlay draws the notch outline');
  }
  assert.equal(await page.locator('#toolbar-preview').evaluate(element => getComputedStyle(element).borderBottomWidth), '0px');
  assert.ok(await page.evaluate(() => Boolean(document.querySelector('.overall-preview').compareDocumentPosition(document.querySelector('.presets-panel')) & Node.DOCUMENT_POSITION_FOLLOWING)));
  const rows = await page.locator('#preset-preview .preview-wave').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect(); return { y: rect.y, width: rect.width, height: rect.height };
  }));
  assert.equal(rows.length, 4);
  assert.ok(rows.every(row => row.width > 0 && row.height > 0));
  assert.ok(Math.max(...rows.map(row => row.y)) - Math.min(...rows.map(row => row.y)) <= 1,
    'All four deck waveforms must share the same horizontal row');
  const knobs = await page.locator('#preset-preview .preview-deck').evaluateAll(decks => decks.map(deck => {
    const bounds = deck.getBoundingClientRect(), wave = deck.querySelector('.preview-wave').getBoundingClientRect();
    const meter = deck.querySelector('.preview-meter').getBoundingClientRect();
    return {
      colour: getComputedStyle(deck.querySelector('.preview-deck-heading')).color,
      controls: [...deck.querySelectorAll('.preview-knob')].map(knob => {
        const box = knob.getBoundingClientRect(), needle = knob.querySelector('.preview-motion.preview-knob-needle');
        return { band: knob.dataset.knob, width: box.width, height: box.height,
          contained: box.left >= meter.right && box.right <= bounds.right && box.bottom <= wave.top,
          followsMeter: knob.previousElementSibling.classList.contains('preview-meter'),
          colour: getComputedStyle(knob.querySelector('.preview-knob-highlight')).stroke,
          needleColour: needle && getComputedStyle(needle.querySelector('path')).stroke };
      }),
    };
  }));
  for (const deck of knobs) {
    assert.deepEqual(deck.controls.map(knob => knob.band), ['effect'], 'Every deck has one effect knob');
    for (const knob of deck.controls) {
      assert.equal(knob.colour, deck.colour, 'Effect highlights follow the selected deck palette');
      const channels = knob.needleColour.match(/\d+/g).map(Number);
      assert.ok(channels.length === 3 && channels.every(channel => channel === channels[0]), 'The knob needle stays neutral grey');
      assert.ok(knob.followsMeter && knob.contained && knob.width > 0 && Math.abs(knob.width - knob.height) < 1,
        'Effect knobs stay square, beside the level meter and within their deck above the waveform');
    }
  }
}

async function checkIphone17(base, engine) {
  const page = await openPage(base, iphone17, true, engine);
  const label = engine.browserType().name();
  assert.equal(await page.evaluate(() => window.devicePixelRatio), 3);
  // WebKit's emulated touch input does not update navigator.maxTouchPoints.
  // Verify the dispatched touch event and its actual UI result instead.
  await page.evaluate(() => {
    document.addEventListener('touchstart', () => {
      document.documentElement.dataset.touchObserved = 'true';
    }, { once: true, passive: true });
  });
  await assertDefaultLocked(page);
  assert.equal(await page.locator('#presets .preset-card input:checked').count(), 1, 'Only Default starts included on mobile');
  assert.equal(await page.locator('#toolbar-notch-preview').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#logo-tint').getAttribute('aria-pressed'), 'true');
  await assertToolbarPreview(page, { notch: true, colors: defaults, order: ['layout', 'settings'] });
  await assertSharedPreview(page);
  await assertConfigurationLayout(page, false);
  await assertStatusSelection(page, ['master', 'clock']);
  await assertPhraseBeats(page);
  await page.locator('#select-default').tap();
  assert.equal(await page.locator('html').getAttribute('data-touch-observed'), 'true');
  await page.locator('.toolbar-notch-toggle').tap();
  await assertPhraseBeats(page);
  await page.locator('#select-bold').tap();
  assert.equal(await page.locator('#presets .preset-card input:checked').count(), 8);
  await page.getByRole('checkbox', { name: 'Include Bold Pink', exact: true }).tap();
  await assertPaletteGroup(page, 'bold', false, true);
  await page.locator('#select-default').tap();
  const draft = page.locator('#custom-presets .custom-card');
  await draft.locator('.custom-name').fill(`iPhone ${label}`);
  await draft.getByRole('button', { name: 'Random', exact: true }).tap();
  const palette = await draft.locator('.hex-input').evaluateAll(inputs => inputs.map(input => input.value));
  await assertAnimatedPreview(page, '#preset-preview');
  await assertWholeSquareMeters(page);
  await assertKnobRange(page);
  await page.locator('#add-custom').tap();
  const saved = page.locator('#presets .preset-card[data-slug="custom-1"]');
  assert.equal(await saved.locator('input').isChecked(), true);
  assert.deepEqual(await draft.locator('.hex-input').evaluateAll(inputs => inputs.map(input => input.value)), customStart);
  await page.locator('#select-default').tap();
  assert.equal(await saved.locator('input').isChecked(), false);
  await saved.locator('.preset-preview').tap();
  assert.deepEqual(await page.locator('#preset-preview .preview-deck-hex').allTextContents(), palette);
  await saved.locator('input').tap();
  await page.locator('#select-all').tap();
  assert.equal(await page.locator('#presets .preset-card input:checked').count(), 24);
  await page.locator('#select-default').tap();
  await saved.locator('input').tap();
  for (const key of ['account', 'shoutout', 'scheduler', 'sandbox']) {
    await page.locator(`#toolbar-order [data-toolbar-key="${key}"] .toggle-row`).tap();
  }
  await page.locator('#toolbar-order [data-toolbar-key="sandbox"] [data-move="-1"]').tap();
  const order = ['account', 'shoutout', 'sandbox', 'scheduler', 'layout', 'settings'];
  await assertToolbarPreview(page, { notch: false, colors: palette, order: order.filter(key => key !== 'account'), accountLeft: true });
  await page.locator('.toolbar-notch-toggle').tap();
  await assertToolbarPreview(page, { notch: true, colors: palette, order: order.filter(key => key !== 'account') });
  await assertPhraseBeats(page);
  assert.equal(await page.locator('#toolbar-account').isChecked(), true);
  assert.equal(await page.locator('#toolbar-account').isEnabled(), true);
  assert.equal(await page.locator('#download').isEnabled(), true);
  await assertToolbarScrolling(page);
  await page.locator('#toolbar-preview .toolbar-preview-viewport').evaluate(viewport => { viewport.scrollLeft = 70; });
  await page.locator('#toolbar-order [data-toolbar-key="settings"] [data-move="-1"]').tap();
  assert.equal(await page.locator('#toolbar-preview .toolbar-preview-viewport').evaluate(viewport => viewport.scrollLeft), 70);
  await assertSharedPreview(page);
  await assertLogoControlLayout(page, true);
  await assertBlackSurfaces(page);
  await noHorizontalOverflow(page);
  await page.locator('.overall-preview').screenshot({ path: join(artifacts, `iphone17-${label}-preview.png`), animations: 'disabled' });
  await page.screenshot({ path: join(artifacts, `iphone17-${label}.png`), fullPage: true, animations: 'disabled' });
  await page.locator('.overall-preview').scrollIntoViewIfNeeded();
  const viewport = page.locator('.toolbar-preview-viewport');
  const savedScroll = await viewport.evaluate(element => element.scrollLeft);
  const pinnedFrame = await page.locator('.toolbar-screen-frame').boundingBox();
  try {
    for (const position of ['centred', 'panned']) {
      await viewport.evaluate((element, position) => {
        element.scrollLeft = position === 'centred'
          ? (element.scrollWidth - element.clientWidth) / 2 : element.scrollWidth / 2 - 8;
      }, position);
      await page.waitForFunction(() => {
        const notch = document.querySelector('.toolbar-screen-notch > path').getBoundingClientRect();
        const camera = document.querySelector('.toolbar-sim-notch > circle').getBoundingClientRect();
        return Math.abs(notch.x + notch.width / 2 - camera.x - camera.width / 2) <= 1;
      });
      await assertSharedPreview(page);
      const movedFrame = await page.locator('.toolbar-screen-frame').boundingBox();
      for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(movedFrame[key] - pinnedFrame[key]) <= 1,
        'Panning the notch must not move or resize the outer screen frame');
      await page.locator('.overall-preview').screenshot({ path: join(artifacts, `iphone17-${label}-toolbar-${position}.png`), animations: 'disabled' });
    }
  } finally {
    await viewport.evaluate((element, savedScroll) => { element.scrollLeft = savedScroll; }, savedScroll);
  }
  await download(page, join(artifacts, `iphone17-${label}.zip`));
  await page.setViewportSize({ width: 320, height: iphone17.height });
  await page.waitForFunction(() => {
    const preview = document.querySelector('#toolbar-preview');
    const style = getComputedStyle(preview);
    const width = preview.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    return Math.abs(Number(preview.dataset.availableWidth) - width) <= 1;
  });
  await assertToolbarScrolling(page);
  await assertSharedPreview(page);
  await assertLogoControlLayout(page, true);
  await noHorizontalOverflow(page);
  await assertConfigurationLayout(page, false);
}

async function toolbarConfiguration(page) {
  return page.evaluate(() => ({
    order: [...document.querySelectorAll('#toolbar-order > [data-toolbar-key]')].map(item => item.dataset.toolbarKey),
    toggles: [...document.querySelectorAll('#toolbar-order input, #toolbar-status input')].map(input => [input.id, input.checked]),
    presets: [...document.querySelectorAll('#presets input')].map(input => [input.getAttribute('aria-label'), input.checked]),
    customInputs: [...document.querySelectorAll('#custom-presets input')].map(input => [input.type, input.value, input.checked]),
    preview: document.querySelector('#preset-preview').getAttribute('aria-label'),
  }));
}

async function logoFixtures(page) {
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 144; canvas.height = 34;
    const context = canvas.getContext('2d');
    const empty = canvas.toDataURL('image/png');
    context.fillStyle = '#FFFFFF'; context.fillRect(14, 6, 116, 22);
    context.clearRect(40, 10, 18, 7);
    context.fillStyle = 'rgba(255,255,255,.5)'; context.fillRect(40, 10, 18, 7);
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

async function assertLogoTint(page, colour, originalUrl) {
  const tint = await page.locator('#toolbar-preview image[data-custom-logo]').evaluate(image => {
    const id = /^url\(#([^)]*)\)$/.exec(image.getAttribute('filter') || '')?.[1];
    const filter = id && image.ownerSVGElement.querySelector(`filter[id="${id}"]`);
    const flood = filter?.querySelector('feFlood'), composite = filter?.querySelector('feComposite');
    return { colour: flood && getComputedStyle(flood).floodColor, alpha: composite?.getAttribute('in2'),
      filter: image.getAttribute('filter'), filters: image.ownerSVGElement.querySelectorAll('.toolbar-logo-tint').length,
      operator: composite?.getAttribute('operator'), url: image.getAttribute('href') };
  });
  assert.equal(tint.url, originalUrl, 'Changing palettes or tint settings must retain the uploaded artwork');
  if (colour === null) {
    assert.equal(tint.filter, null, 'Disabled tint leaves the uploaded PNG unfiltered');
    assert.equal(tint.filters, 0);
    return;
  }
  const rgb = [1, 3, 5].map(offset => parseInt(colour.slice(offset, offset + 2), 16));
  assert.equal(tint.colour, `rgb(${rgb.join(', ')})`, 'The logo follows the active palette tint');
  assert.match(tint.alpha, /^Source(?:Alpha|Graphic)$/, 'Tinting must use the uploaded logo alpha mask');
  assert.equal(tint.operator, 'in');
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
  assert.equal(await page.locator('#status').isVisible(), false, 'Successful downloads must not add a status message');
}

function verifyStatusZip(filename, enabled, logoPositions = null) {
  const result = spawnSync('python3', ['-c', String.raw`
import json, re, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    xml = archive.read('Pro.xml').decode()
enabled = json.loads(sys.argv[2])
for platform in ['mac', 'pc']:
    start = xml.index('<group name="pureblack_toolbar_' + platform + '"')
    depth = 0
    for token in re.finditer(r'<group\b[^>]*>|</group>', xml[start:]):
        if token.group() == '</group>': depth -= 1
        elif not token.group().endswith('/>'): depth += 1
        if depth == 0:
            toolbar = xml[start:start + token.end()]
            break
    for key, source in [('master', "get_vu_meter_left 'master'"), ('cpu', 'get_cpu'), ('battery', 'get_battery'), ('clock', 'get_clock')]:
        assert (source in toolbar) == (key in enabled), (platform, key)
positions = json.loads(sys.argv[3])
if positions is not None:
    visuals = re.findall(r'<visual name="pureblack_custom_logo[^"]*"[^>]*>(.*?)</visual>', xml, re.S)
    assert sorted({int(re.search(r'<pos x="(\d+)"', visual).group(1)) for visual in visuals}) == sorted(positions)
`, filename, JSON.stringify(enabled), JSON.stringify(logoPositions)], { encoding: 'utf8', cwd: root });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
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
themes = json.loads((pathlib.Path(sys.argv[3]) / 'themes.json').read_text())
slugs = {theme['name']: theme['slug'] for theme in themes}
assert re.findall(r'<group name="pureblack-theme-([^"]+)"', xml) == [slugs[name] for name in expected[1:]]
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
    assert archive.namelist() == ['Pro.xml', 'gfx-pro.png', 'icons_daylight.png', 'README.txt']
    readme = archive.read('README.txt').decode('utf-8')
    assert 'Copy this ZIP, still zipped' in readme
    assert '~/Library/Application Support/VirtualDJ/Skins' in readme
    assert r'%LOCALAPPDATA%\VirtualDJ\Skins' in readme
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
assert len(menus) == 4
for menu in menus:
    assert re.findall(r'<item text="([^"]+)"', menu) == ['Default', 'Pastel Red', 'Studio &lt;&amp;&gt; Mix', 'Second preset']
assert 'pureblack-theme-pastel-red' in xml
assert 'pureblack-theme-custom-1' in xml
assert 'pureblack-theme-custom-2' in xml
assert 'pureblack-theme-custom-3' not in xml
assert 'pureblack-theme-bold-red' not in xml
for action, count in [('connect', 3), ('shoutout', 4), ('eventscheduler', 4), ('sandbox', 12)]:
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

# Requested order reaches both platforms and the optional notched Mac branch.
widths = dict(account=135, shoutout=35, scheduler=35, sandbox=235, layout=123, settings=35)
def verify_positions(toolbar, order, left, right):
    positions = {}
    for key in order:
        if key in ['account', 'sandbox', 'layout']:
            name = {'account': 'login', 'layout': 'layout_options', 'sandbox': 'sandbox'}[key]
            positions[key] = int(re.search(r'<group name="' + name + r'" x="(\d+)"', toolbar).group(1))
        else:
            action = 'eventscheduler' if key == 'scheduler' else key
            positions[key] = int(re.search(r'<button action="' + action + r'">\s*<pos x="(\d+)"', toolbar).group(1))
    assert sorted(positions, key=positions.get) == order
    assert positions[order[0]] > left
    assert positions[order[-1]] + widths[order[-1]] == right
    for before, after in zip(order, order[1:]):
        assert positions[before] + widths[before] + 10 <= positions[after]

for platform, left, right, status_x in [('mac', 1160, 1910, 195), ('pc', 1102, 1789, 100)]:
    toolbar = skin_group(xml, 'pureblack_toolbar_' + platform)
    assert f'<group name="topbar_status" x="{status_x}" y="8">' in toolbar
    if platform == 'mac':
        full = skin_group(toolbar, 'pureblack_toolbar_full')
        compact = skin_group(toolbar, 'pureblack_toolbar_compact')
        moved = skin_group(toolbar, 'pureblack_toolbar_account_left')
        assert full.startswith("<group name=\"pureblack_toolbar_full\" visibility=\"has_notch ? skin_width && param_bigger 1500 : maximize 'fullscreen' ? true : skin_width && param_bigger 1500\">")
        assert moved.startswith("<group name=\"pureblack_toolbar_account_left\" visibility=\"has_notch ? false : maximize 'fullscreen' ? false : skin_width && param_smaller 1501\">")
        assert compact.startswith('<group name="pureblack_toolbar_compact" visibility="has_notch ? skin_width && param_smaller 1501 : false">')
        assert '<group name="login" x="182" y="8">' in moved
        assert '<group name="topbar_status" x="327" y="8">' in toolbar
        assert all('topbar_status' not in branch for branch in [full, moved, compact])
        assert '<button action="connect">' in full
        assert '<button action="connect">' not in compact
        verify_positions(full, toolbar_order, left, right)
        verify_positions(compact, [key for key in toolbar_order if key != 'account'], left, right)
        verify_positions(moved, [key for key in toolbar_order if key != 'account'], left, right)
    else:
        assert 'pureblack_toolbar_full' not in toolbar and 'pureblack_toolbar_compact' not in toolbar
        verify_positions(toolbar, toolbar_order, left, right)

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

function verifyLogoZip(filename, originalFilename, expectedColours, expectedAlpha, tinted = true) {
  const result = spawnSync('python3', ['-c', String.raw`
import html, json, math, re, struct, sys, zipfile, zlib
colours = json.loads(sys.argv[3])
expected_alpha = json.loads(sys.argv[4])
tinted = json.loads(sys.argv[5])
def png_rows(png):
    chunks, offset = [], 8
    while offset < len(png):
        length = struct.unpack('>I', png[offset:offset+4])[0]
        if png[offset+4:offset+8] == b'IDAT': chunks.append(png[offset+8:offset+8+length])
        offset += length + 12
    return zlib.decompress(b''.join(chunks))
with zipfile.ZipFile(sys.argv[1]) as added, zipfile.ZipFile(sys.argv[2]) as original:
    assert added.testzip() is None
    assert added.namelist() == original.namelist() == ['Pro.xml', 'gfx-pro.png', 'icons_daylight.png', 'README.txt']
    assert added.read('icons_daylight.png') == original.read('icons_daylight.png')
    assert added.read('README.txt') == original.read('README.txt')
    source_png = original.read('gfx-pro.png')
    logo_png = added.read('gfx-pro.png')
    assert logo_png[:8] == source_png[:8] == b'\x89PNG\r\n\x1a\n'
    width, height = struct.unpack('>II', source_png[16:24])
    columns = width // 144
    assert struct.unpack('>II', logo_png[16:24]) == (width, height + math.ceil(len(colours) / columns) * 34)
    assert logo_png[24:26] == bytes([8, 6]), 'Appended sprite must remain lossless 8-bit RGBA'
    source_xml = original.read('Pro.xml').decode()
    logo_xml = added.read('Pro.xml').decode()
    assert re.findall(r'<logo>.*?</logo>', logo_xml, re.S) == re.findall(r'<logo>.*?</logo>', source_xml, re.S)
    visuals = re.findall(r'<visual\b[^>]*>.*?</visual>', logo_xml, re.S)
    logo_visuals = [visual for visual in visuals if 'name="pureblack_custom_logo' in visual]
    assert len(logo_visuals) == len(colours) * 3
    assert all('<size width="72" height="17"' in visual for visual in logo_visuals)
    assert '<group name="topbar_status" x="195" y="8">' in logo_xml
    assert '<group name="topbar_status" x="100" y="8">' in logo_xml
    assert '<group name="topbar_status" x="327" y="8">' in logo_xml
    rows = png_rows(logo_png)
    stride = width * 4 + 1
    assert rows[:height*stride] == png_rows(source_png), 'All original sprite scanlines remain byte-identical'
    assert len(expected_alpha) == 144 * 34 and any(0 < alpha < 255 for alpha in expected_alpha)
    for index, colour in enumerate(colours):
        x_offset, y_offset = (index % columns) * 144, height + (index // columns) * 34
        suffix = '_theme_' + str(index) if tinted else ''
        theme_visuals = [visual for visual in logo_visuals if re.search(r'name="pureblack_custom_logo(?:_account_left)?' + suffix + r'"', visual)]
        assert len(theme_visuals) == 3
        assert all(f'<off x="{x_offset}" y="{y_offset}" width="144" height="34"' in visual for visual in theme_visuals)
        assert sorted(int(re.search(r'<pos x="(\d+)"', visual).group(1)) for visual in theme_visuals) == [443, 538, 670]
        for visual in theme_visuals:
            if not tinted:
                assert re.search(r'\bcondition="', visual) is None, 'Untinted artwork remains the same in every palette'
                continue
            condition = html.unescape(re.search(r'\bcondition="([^"]*)"', visual).group(1))
            if index:
                assert condition == f"var_equal '@$pureblackdecktheme' {index}"
            else:
                assert all(f"var_equal '@$pureblackdecktheme' {other} ? false : " in condition for other in range(1, len(colours)))
                assert condition.endswith('true')
        rgb = tuple(bytes.fromhex(colour.removeprefix('#')))
        visible = []
        for y in range(34):
            row = rows[(y_offset+y)*stride:(y_offset+y+1)*stride]
            assert row[0] == 0
            for x in range(144):
                pixel = tuple(row[1+(x_offset+x)*4:1+(x_offset+x)*4+4])
                assert pixel[3] == expected_alpha[y*144+x], 'Tinting must preserve every alpha byte'
                if pixel[3]:
                    assert pixel[:3] == rgb, (index, colour, pixel)
                    visible.append((x, y))
        assert max(x for x, y in visible) - min(x for x, y in visible) + 1 == 144, 'Transparent margins must not shrink exported artwork'
        assert 26 <= max(y for x, y in visible) - min(y for x, y in visible) + 1 <= 29
print('Logo ZIP: validated ' + ('palette tints' if tinted else 'original artwork colours') + ', preserved alpha and original sprites, correct source tiles and responsive positions.')
`, filename, originalFilename, JSON.stringify(expectedColours), JSON.stringify(expectedAlpha), JSON.stringify(tinted)], { encoding: 'utf8', cwd: root });
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
  assert.equal(await desktop.locator('#presets .preset-card').count(), 23);
  assert.deepEqual(await desktop.locator('#presets .preset-card input:checked').evaluateAll(inputs => inputs.map(input => input.closest('.preset-card').dataset.slug)), ['default']);
  for (const group of ['aesthetic', 'pastel', 'bold']) await assertPaletteGroup(desktop, group, false);
  assert.equal(await desktop.locator('#status').isVisible(), false);
  assert.deepEqual(await desktop.locator('#personal-presets > .preset-card').evaluateAll(cards => cards.map(card => card.dataset.slug)), ['default', 'grayscale']);
  const grayscale = desktop.getByRole('checkbox', { name: 'Include Grayscale', exact: true });
  assert.equal(await grayscale.isEnabled(), true);
  assert.equal(await desktop.locator('[data-slug$="greyscale"], [data-slug$="grayscale"]').count(), 1);
  assert.equal(await grayscale.isChecked(), false);
  await grayscale.check();
  await assertDefaultLocked(desktop);
  await grayscale.uncheck();
  assert.deepEqual(await desktop.locator('[data-palette-group="aesthetic"] .preset-name').allTextContents(), aestheticNames);
  for (const group of ['pastel', 'bold']) {
    assert.deepEqual(await desktop.locator(`#presets .preset-card[data-slug^="${group}-"] .preset-name`).allTextContents(), paletteNames,
      'Group headings supply the palette family; card names stay concise');
  }
  assert.equal(await desktop.locator('#custom-preview').count(), 0);
  assert.equal(await desktop.locator('.palette-preview').count(), 1, 'All palettes share one animated preview');
  assert.equal(await desktop.locator('#custom-presets .custom-card').count(), 1);
  assert.equal(await desktop.locator('header').count(), 0);
  for (const removed of ['VIRTUALDJ · PRO LAYOUT', 'Black base. Your colours.', 'Pure black, always',
    'Keep what you use', 'Your own four', 'Build your palette menu', 'Made for VirtualDJ', 'Ready to build your skin']) {
    assert.ok(!(await desktop.locator('body').innerText()).includes(removed), `Removed copy remains: ${removed}`);
  }
  assert.equal(await desktop.locator('footer a[href="https://github.com/elxrrr/pro-pure-black"]').count(), 1);
  assert.equal(await desktop.locator('footer a[href="https://github.com/elxrrr/pro-pure-black/tree/main/skin"]').count(), 0);
  assert.equal(await desktop.locator('footer a[href*="releases/latest"]').count(), 0);
  assert.match(await desktop.locator('footer').innerText(), /Made with AI/i);
  assert.equal(await desktop.locator('#skin-folder-paths, [data-copy-path], #skin-path-macos, #skin-path-windows').count(), 0);
  assert.deepEqual(await desktop.locator('#preset-preview .preview-deck-hex').allTextContents(), defaults);
  assert.equal(await desktop.locator('#preset-preview .preview-deck').count(), 4);
  assert.equal(await desktop.locator('#preset-preview .preview-wave').count(), 4);
  assert.equal(await desktop.locator('#preset-preview .preview-meter').count(), 4);
  assert.deepEqual(await desktop.locator('#toolbar-preview [data-toolbar-control]').evaluateAll(items => items.map(item => item.dataset.toolbarControl)), ['layout', 'settings']);
  assert.deepEqual(await desktop.locator('#toolbar-order > [data-toolbar-key]').evaluateAll(items => items.map(item => item.dataset.toolbarKey)), defaultToolbarOrder);
  assert.equal(await desktop.locator('#toolbar-preview .toolbar-sim-left > .toolbar-sim-window + .toolbar-sim-status').count(), 1,
    'Status must sit beside the VDJ logo on the left');
  await assertStatusSelection(desktop, ['master', 'clock']);
  assert.equal(await desktop.locator('#toolbar-preview .toolbar-sim-right [data-toolbar-control]').count(), 2);
  assert.equal(await desktop.locator('#toolbar-count').innerText(), '4 included');
  for (const [id, name] of [['toolbar-notch-preview', 'Notch'], ['logo-tint', 'Tint']]) {
    const button = desktop.getByRole('button', { name, exact: true });
    assert.equal(await button.getAttribute('id'), id);
    assert.equal(await button.getAttribute('type'), 'button');
    assert.equal(await button.getAttribute('aria-pressed'), 'true');
    assert.equal(await button.locator('svg, input, .switch').count(), 0, 'Preview toggles are plain text buttons');
  }
  assert.equal(await desktop.locator('#toolbar-display-profile').count(), 0);
  const pressedBackground = await desktop.locator('#toolbar-notch-preview').evaluate(button => getComputedStyle(button).backgroundColor);
  await desktop.locator('#toolbar-notch-preview').press('Space');
  assert.equal(await desktop.locator('#toolbar-notch-preview').getAttribute('aria-pressed'), 'false');
  const offBackground = await desktop.locator('#toolbar-notch-preview').evaluate(button => getComputedStyle(button).backgroundColor);
  assert.notEqual(offBackground, pressedBackground, 'Pressed buttons use a highlighted background');
  assert.equal(offBackground, await desktop.locator('#custom-logo-remove').evaluate(button => getComputedStyle(button).backgroundColor),
    'Unpressed preview buttons share the Remove button background');
  await assertToolbarPreview(desktop, { notch: false, colors: defaults, order: ['layout', 'settings'] });
  await desktop.locator('#toolbar-notch-preview').press('Enter');
  assert.equal(await desktop.locator('#toolbar-notch-preview').getAttribute('aria-pressed'), 'true');
  assert.equal(await desktop.locator('#toolbar-notch-preview').evaluate(button => getComputedStyle(button).backgroundColor), pressedBackground);
  await assertToolbarPreview(desktop, { notch: true, colors: defaults, order: ['layout', 'settings'] });
  await assertSharedPreview(desktop);
  await assertConfigurationLayout(desktop, true);
  await assertCustomBorders(desktop);
  await assertToolbarScrolling(desktop);
  await assertLogoControlLayout(desktop);
  await assertAnimatedPreview(desktop, '#toolbar-preview', [['.toolbar-phrase-progress', 'strokeDashoffset'], ['.toolbar-master-cell', 'opacity']]);
  await assertPhraseBeats(desktop);
  assert.ok(await desktop.evaluate(() => Boolean(document.querySelector('.custom-panel').compareDocumentPosition(document.querySelector('.toolbar-panel')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'Custom preset editor must precede toolbar controls');
  await desktop.locator('#preset-preview').scrollIntoViewIfNeeded();
  await desktop.waitForFunction(() => document.querySelector('#preset-preview').dataset.motion === 'running');
  await assertAnimatedPreview(desktop, '#preset-preview');
  await assertWholeSquareMeters(desktop);
  await assertKnobRange(desktop);
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
  await assertStatusControls(desktop);
  await assertAnimatedPreview(desktop, '#toolbar-preview', ['.toolbar-cpu-fill']);
  await setPressed(desktop, '#toolbar-notch-preview', false);
  await assertToolbarPreview(desktop, { notch: false, colors: defaults, order: ['layout', 'settings'] });
  await assertPhraseBeats(desktop);

  // Aesthetic palettes can be selected as a group or mixed individually.
  await desktop.locator('#select-aesthetic').check();
  await assertPaletteGroup(desktop, 'aesthetic', true);
  assert.equal(await desktop.locator('#presets .preset-card input:checked').count(), 8);
  await desktop.getByRole('checkbox', { name: 'Include Outrun', exact: true }).uncheck();
  await assertPaletteGroup(desktop, 'aesthetic', false, true);
  await desktop.getByRole('checkbox', { name: 'Include Pastel Red', exact: true }).check();
  const aestheticArchive = join(artifacts, 'pro-pure-black-aesthetic-mix.zip');
  await download(desktop, aestheticArchive);
  verifyPaletteSelectionZip(aestheticArchive, ['Default', 'Pastel Red', ...aestheticNames.filter(name => name !== 'Outrun')]);
  await desktop.getByRole('button', { name: 'Preview Daydream', exact: true }).click();
  assert.notEqual(await websiteAccent(desktop), defaultAccent);
  await desktop.locator('#select-default').click();
  await assertPaletteGroup(desktop, 'aesthetic', false);
  await desktop.getByRole('button', { name: 'Preview Default', exact: true }).click();

  // A whole family and individual entries from the other family can be mixed.
  await grayscale.check();
  await desktop.locator('#select-pastel').check();
  assert.equal(await desktop.locator('#presets .preset-card input:checked').count(), 9);
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
  verifyPaletteSelectionZip(groupedArchive, ['Default', 'Grayscale', ...paletteNames.map(name => `Pastel ${name}`), 'Bold Blue']);
  await desktop.locator('#select-pastel').uncheck();
  assert.deepEqual(await desktop.locator('#presets .preset-card input:checked').evaluateAll(inputs => inputs.map(input => input.closest('.preset-card').dataset.slug)),
    ['default', 'grayscale', 'bold-blue'], 'Removing a whole group must preserve selections from the other group and ungrouped Grayscale');

  // Previewing is independent of including a preset in the downloaded skin.
  await desktop.locator('#select-default').click();
  await desktop.getByRole('button', { name: 'Preview Pastel Red', exact: true }).click();
  assert.equal(await desktop.locator('#preview-title').innerText(), 'Preview');
  assert.equal(await desktop.getByRole('button', { name: 'Preview Pastel Red', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.match(await desktop.locator('#preset-preview').getAttribute('aria-label'), /^Pastel Red:/);
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

  // One persistent draft creates immutable presets in the top palette list.
  const draft = desktop.locator('#custom-presets .custom-card');
  assert.equal(await draft.count(), 1);
  assert.equal(await draft.locator('.custom-include, .custom-remove, .custom-preview-button').count(), 0);
  assert.deepEqual(await draft.locator('.hex-input').evaluateAll(inputs => inputs.map(input => input.value)), customStart);
  assert.ok(await draft.getByRole('button', { name: 'Random', exact: true }).evaluate(button => parseFloat(getComputedStyle(button).borderTopWidth) > 0),
    'Random is a visibly bordered button');
  await draft.getByRole('button', { name: 'Random', exact: true }).click();
  const randomised = await draft.locator('.hex-input').evaluateAll(inputs => inputs.map(input => input.value));
  assert.notEqual(randomised[0], customStart[0], 'Random starts with a new deck A colour');
  assert.equal(new Set(randomised).size, 4);
  assert.ok(randomised.every(color => /^#[0-9A-F]{6}$/.test(color)));
  assert.deepEqual(await draft.locator('.colour-picker').evaluateAll(inputs => inputs.map(input => input.value.toUpperCase())), randomised);
  assert.deepEqual(await desktop.locator('#preset-preview .preview-deck-hex').allTextContents(), randomised);
  assert.equal(await desktop.locator('#preview-title').innerText(), 'Preview', 'Draft colours must not replace the static panel heading');
  assert.equal(await desktop.locator('#presets .preset-card[data-slug^="custom-"]').count(), 0, 'Editing a draft does not save or include it');
  await assertAnimatedPreview(desktop, '#preset-preview');
  await assertWholeSquareMeters(desktop);
  const initialCustomAccent = await websiteAccent(desktop);
  await draft.locator('.hex-input[data-deck="A"]').fill('#xyz');
  assert.equal(await desktop.locator('#add-custom').isDisabled(), true);
  assert.equal(await desktop.locator('#download').isEnabled(), true, 'An unsaved invalid draft must not block existing palettes');
  assert.equal(await websiteAccent(desktop), initialCustomAccent);
  await draft.getByRole('button', { name: 'Random', exact: true }).click();
  assert.equal(await desktop.locator('#add-custom').isEnabled(), true, 'Random repairs invalid draft colours');
  for (const [index, letter] of ['A', 'B', 'C', 'D'].entries()) await draft.locator(`.hex-input[data-deck="${letter}"]`).fill(colours[index]);
  await draft.locator('.custom-name').fill('Default');
  assert.equal(await desktop.locator('#add-custom').isDisabled(), true);
  assert.equal(await desktop.locator('#download').isEnabled(), true);
  await draft.locator('.custom-name').fill(customName);
  const customAccent = await websiteAccent(desktop);
  assert.notEqual(customAccent, redAccent);
  await desktop.locator('#add-custom').click();
  const firstTile = desktop.locator('#presets .preset-card[data-slug="custom-1"]');
  assert.equal(await firstTile.locator('.preset-name').innerText(), customName);
  assert.equal(await firstTile.locator('input').isChecked(), true);
  assert.deepEqual(await firstTile.locator('.palette-swatches i').evaluateAll(items => items.map(item => item.style.getPropertyValue('--swatch'))), colours);
  assert.equal(await draft.count(), 1, 'Saving a preset resets the same single editor');
  assert.deepEqual(await draft.locator('.hex-input').evaluateAll(inputs => inputs.map(input => input.value)), customStart);
  await firstTile.locator('.preset-preview').click();
  assert.equal(await websiteAccent(desktop), customAccent);
  assert.deepEqual(await desktop.locator('#preset-preview .preview-deck-hex').allTextContents(), colours);
  await firstTile.locator('input').uncheck();
  assert.equal(await websiteAccent(desktop), customAccent, 'Inclusion alone does not change the preview');
  await firstTile.locator('.preset-preview').click();
  assert.equal(await firstTile.locator('input').isChecked(), false);
  await firstTile.locator('input').check();
  await desktop.getByRole('button', { name: 'Preview Pastel Blue', exact: true }).click();
  assert.equal(await websiteAccent(desktop), blueAccent);
  await draft.locator('.hex-input[data-deck="A"]').fill('#649BE8');
  assert.notEqual(await websiteAccent(desktop), blueAccent, 'Draft editing updates the shared preview');
  assert.deepEqual(await firstTile.locator('.palette-swatches i').evaluateAll(items => items.map(item => item.style.getPropertyValue('--swatch'))), colours,
    'Editing the new draft does not mutate a saved preset');
  await draft.locator('.custom-name').fill(customName);
  assert.equal(await desktop.locator('#add-custom').isDisabled(), true, 'Saved names cannot be reused');
  await draft.locator('.custom-name').fill(secondName);
  for (const [index, letter] of ['A', 'B', 'C', 'D'].entries()) await draft.locator(`.hex-input[data-deck="${letter}"]`).fill(secondColours[index]);
  await desktop.locator('#add-custom').click();
  const secondTile = desktop.locator('#presets .preset-card[data-slug="custom-2"]');
  assert.equal(await secondTile.locator('.preset-name').innerText(), secondName);
  assert.deepEqual(await secondTile.locator('.palette-swatches i').evaluateAll(items => items.map(item => item.style.getPropertyValue('--swatch'))), secondColours);
  assert.equal(await desktop.locator('#presets .preset-card[data-slug^="custom-"]').count(), 2);
  assert.equal(await desktop.locator('.palette-preview').count(), 1);
  await draft.locator('.custom-name').fill('Unsaved draft');
  await draft.locator('.hex-input[data-deck="A"]').fill('#xyz');
  assert.equal(await desktop.locator('#add-custom').isDisabled(), true);
  assert.equal(await desktop.locator('#download').isEnabled(), true);
  assert.equal(await desktop.locator('#presets .preset-card[data-slug="custom-3"]').count(), 0);
  await firstTile.locator('.preset-preview').click();
  await assertBlackSurfaces(desktop);
  for (const key of ['sandbox', 'shoutout', 'scheduler', 'account']) {
    await desktop.locator(`#toolbar-${key}`).check();
    assert.equal(await desktop.locator(`#toolbar-preview [data-toolbar-control="${key}"]`).count(), 1);
  }
  assert.equal(await desktop.locator('#download-summary').innerText(), '4 palettes · 10 controls');
  assert.equal(await desktop.locator('#toolbar-count').innerText(), '10 included');
  const beforeDisplayChanges = await toolbarConfiguration(desktop);
  await assertToolbarPreview(desktop, { notch: false, colors: colours, order: defaultToolbarOrder.filter(key => key !== 'account'), accountLeft: true });
  const controlWidth = await desktop.locator('#toolbar-preview [data-toolbar-control="settings"]').evaluate(item => item.getBoundingClientRect().width);
  await setPressed(desktop, '#toolbar-notch-preview', true);
  await assertToolbarPreview(desktop, { notch: true, colors: colours, order: defaultToolbarOrder.filter(key => key !== 'account') });
  assert.equal(await desktop.locator('#toolbar-account').isChecked(), true);
  assert.equal(await desktop.locator('#toolbar-account').isEnabled(), true);
  await desktop.locator('#toolbar-shoutout').uncheck();
  await assertToolbarPreview(desktop, { notch: true, colors: colours, order: defaultToolbarOrder.filter(key => key !== 'shoutout') });
  await desktop.locator('#toolbar-shoutout').check();
  await assertToolbarPreview(desktop, { notch: true, colors: colours, order: defaultToolbarOrder.filter(key => key !== 'account') });
  await desktop.locator('.overall-preview').screenshot({ path: join(artifacts, 'toolbar-narrow-notch.png'), animations: 'disabled' });
  await desktop.setViewportSize({ width: 1920, height: 1050 });
  await assertToolbarPreview(desktop, { notch: true, colors: colours, order: defaultToolbarOrder });
  const resizedWidth = await desktop.locator('#toolbar-preview [data-toolbar-control="settings"]').evaluate(item => item.getBoundingClientRect().width);
  assert.ok(Math.abs(resizedWidth - controlWidth) < .1, 'Window resizing preserves control size');
  assert.deepEqual(await toolbarConfiguration(desktop), beforeDisplayChanges, 'Window and notch previews never change requested controls');
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
  await assertToolbarPreview(desktop, { notch: true, colors: colours, order: requestedOrder });
  await desktop.locator('.overall-preview').screenshot({ path: join(artifacts, 'toolbar-notch-16-reordered.png'), animations: 'disabled' });
  await noHorizontalOverflow(desktop);
  await desktop.screenshot({ path: join(artifacts, 'desktop-custom.png'), fullPage: true, animations: 'disabled' });
  const archive = join(artifacts, 'pro-pure-black-custom.zip');
  await download(desktop, archive);
  verifyDownloadedZip(archive, requestedOrder);
  // Window size and Notch only illustrate the runtime branches, never alter the ZIP.
  const beforePreviewOnlyChanges = await toolbarConfiguration(desktop);
  await desktop.setViewportSize({ width: 1440, height: 1050 });
  await assertToolbarPreview(desktop, { notch: true, colors: colours, order: requestedOrder.filter(key => key !== 'account') });
  const narrowArchive = join(artifacts, 'pro-pure-black-narrow-notch.zip');
  await download(desktop, narrowArchive);
  assert.deepEqual(await readFile(narrowArchive), await readFile(archive));
  await setPressed(desktop, '#toolbar-notch-preview', false);
  await assertToolbarPreview(desktop, { notch: false, colors: colours, order: requestedOrder.filter(key => key !== 'account'), accountLeft: true });
  assert.deepEqual(await toolbarConfiguration(desktop), beforePreviewOnlyChanges);
  const unnotchedArchive = join(artifacts, 'pro-pure-black-no-notch-preview.zip');
  await download(desktop, unnotchedArchive);
  assert.deepEqual(await readFile(unnotchedArchive), await readFile(archive), 'Window size and notch preview must not change the downloaded skin');

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
  assert.equal(await desktop.locator('#custom-logo-status').isVisible(), false);
  assert.equal(await desktop.locator('#custom-logo-details').count(), 0);
  assert.ok(!(await desktop.locator('body').innerText()).includes(logoName), 'Logo filenames are not displayed');
  assert.equal(await desktop.evaluate(() => Boolean(window.injectedLogo)), false);
  const logoImage = desktop.locator('#toolbar-preview image[data-custom-logo]');
  assert.equal(await logoImage.count(), 1);
  assert.deepEqual(await logoImage.evaluate(image => ['x', 'y', 'width', 'height'].map(name => Number(image.getAttribute(name)))), [670, 13, 72, 17]);
  assert.equal(await desktop.locator('#toolbar-preview .toolbar-sim-logo').getAttribute('x'), '100', 'Native VirtualDJ logo must remain');
  assert.equal(await desktop.locator('#toolbar-preview .toolbar-sim-status').getAttribute('data-native-x'), '327');
  const validLogoUrl = await logoImage.getAttribute('href');
  assert.match(validLogoUrl, /^data:image\/png;base64,/);
  const blueLogoColour = await desktop.locator('#presets [data-slug="pastel-blue"] .palette-swatches i').first()
    .evaluate(swatch => swatch.style.getPropertyValue('--swatch'));
  for (const [name, colour] of [['Default', '#959595'], ['Pastel Blue', blueLogoColour],
    [customName, colours[0]], [secondName, secondColours[0]], [customName, colours[0]]]) {
    await desktop.getByRole('button', { name: `Preview ${name}`, exact: true }).click();
    await assertLogoTint(desktop, colour, validLogoUrl);
  }
  const expectedLogoColours = await desktop.evaluate(slugs => slugs.map(slug => {
    const card = document.querySelector(`#presets .preset-card[data-slug="${slug}"]`);
    if (!card.querySelector('input').checked) throw new Error(`Expected included logo palette: ${slug}`);
    return slug === 'default' ? '#959595' : card.querySelector('.palette-swatches i').style.getPropertyValue('--swatch');
  }), ['default', 'pastel-red', 'custom-1', 'custom-2']);
  const expectedLogoAlpha = await desktop.evaluate(async bytes => {
    const { prepareLogo } = await import('./logo-image.js');
    const prepared = await prepareLogo(new File([new Uint8Array(bytes)], 'white-logo.png', { type: 'image/png' }));
    return [...prepared.tilePixels].filter((_, index) => index % 4 === 3);
  }, [...logos.transparent]);
  for (const key of ['cpu', 'battery']) await desktop.locator(`#toolbar-${key}`).uncheck();
  await assertStatusSelection(desktop, ['master', 'clock']);
  assert.equal(await logoImage.getAttribute('x'), '570', 'The custom logo closes the gap left by hidden status items');
  const compactLogoArchive = join(artifacts, 'pro-pure-black-compact-status-logo.zip');
  await download(desktop, compactLogoArchive);
  verifyStatusZip(compactLogoArchive, ['master', 'clock'], [438, 343, 570]);
  for (const key of ['cpu', 'battery']) await desktop.locator(`#toolbar-${key}`).check();
  assert.equal(await logoImage.getAttribute('x'), '670');

  const artwork = await desktop.evaluate(async url => {
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width, right = -1, top = canvas.height, bottom = -1;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (pixels[(y * canvas.width + x) * 4 + 3]) {
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    return { width: canvas.width, height: canvas.height, left, right, top, bottom };
  }, validLogoUrl);
  assert.equal(artwork.width, 432); assert.equal(artwork.height, 102);
  assert.equal(artwork.right - artwork.left + 1, 432, 'Transparent source padding must not shrink the visible logo');
  assert.ok(artwork.bottom - artwork.top + 1 >= 80 && artwork.bottom - artwork.top + 1 <= 84, 'Cropping preserves the artwork aspect ratio');
  assert.ok(Math.abs((artwork.top + artwork.bottom) / 2 - 50.5) <= 1, 'Artwork remains vertically centered');
  await uploadLogo(desktop, 'opaque-replacement.png', logos.opaque);
  assert.match(await desktop.locator('#custom-logo-status').innerText(), /Previous logo kept\./);
  assert.equal(await logoImage.getAttribute('href'), validLogoUrl);
  assert.equal(await desktop.locator('#download').isEnabled(), true);
  await setPressed(desktop, '#toolbar-notch-preview', true);
  await assertToolbarPreview(desktop, { notch: true, colors: colours, order: requestedOrder.filter(key => key !== 'account') });
  assert.equal(await logoImage.getAttribute('x'), '538');
  await desktop.locator('#toolbar-preview .toolbar-preview-viewport').evaluate(viewport => { viewport.scrollLeft = 0; });
  await desktop.locator('.overall-preview').screenshot({ path: join(artifacts, 'toolbar-custom-logo.png'), animations: 'disabled' });
  const logoArchive = join(artifacts, 'pro-pure-black-with-logo.zip');
  await download(desktop, logoArchive);
  verifyLogoZip(logoArchive, unnotchedArchive, expectedLogoColours, expectedLogoAlpha);
  await desktop.locator('#logo-tint').press('Space');
  assert.equal(await desktop.locator('#logo-tint').getAttribute('aria-pressed'), 'false');
  await assertLogoTint(desktop, null, validLogoUrl);
  await desktop.getByRole('button', { name: 'Preview Default', exact: true }).click();
  await assertLogoTint(desktop, null, validLogoUrl);
  const originalLogoArchive = join(artifacts, 'pro-pure-black-original-logo-colours.zip');
  await download(desktop, originalLogoArchive);
  verifyLogoZip(originalLogoArchive, unnotchedArchive, ['#FFFFFF'], expectedLogoAlpha, false);
  await desktop.locator('#logo-tint').press('Enter');
  assert.equal(await desktop.locator('#logo-tint').getAttribute('aria-pressed'), 'true');
  await assertLogoTint(desktop, '#959595', validLogoUrl);
  await firstTile.locator('.preset-preview').click();
  await assertLogoTint(desktop, colours[0], validLogoUrl);

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
  assert.equal(await desktop.locator('#custom-logo-status').isVisible(), false);
  assert.equal(await desktop.locator('#toolbar-preview [data-custom-logo]').count(), 0);
  assert.equal(await desktop.locator('#toolbar-preview .toolbar-sim-status').getAttribute('data-native-x'), '195');
  assert.equal(await desktop.locator('#custom-logo-details').count(), 0);
  assert.equal(await desktop.locator('#download').isEnabled(), true);
  const removedLogoArchive = join(artifacts, 'pro-pure-black-logo-removed.zip');
  await download(desktop, removedLogoArchive);
  assert.deepEqual(await readFile(removedLogoArchive), await readFile(unnotchedArchive), 'Removing the logo restores the exact original export');
  // A compact page may keep the preview visible even after scrolling to Download.
  await desktop.setViewportSize({ width: 1440, height: 420 });
  await desktop.locator('footer').scrollIntoViewIfNeeded();
  await desktop.waitForFunction(() => {
    const preview = document.querySelector('#preset-preview');
    return preview.getBoundingClientRect().bottom <= 0 && preview.dataset.motion === 'paused';
  });
  assert.ok(await desktop.locator('#preset-preview .preview-motion').evaluateAll(elements =>
    elements.length > 0 && elements.every(element => getComputedStyle(element).animationPlayState === 'paused')),
  'All deck animations pause when the preview is outside the viewport');

  await checkIphone17(base, browser);
  safari = await webkit.launch({ headless: true });
  await checkIphone17(base, safari);
  await recordAnimatedPreview(base);
  assert.deepEqual(errors, [], 'Browser errors were emitted.');
  console.log('Passed: Default-only initial selection, one selectable Grayscale, mixed Aesthetic/Pastel/Bold groups, quiet successful downloads, one shared animated preview, multiple custom presets, independent selection/preview, custom validation, synchronized custom palette tiles, optional compact status controls in preview and exports, continuous sixteen-beat phrase rings and left-to-right lights, toolbar toggles and button ordering, palette-linked website accents with black surfaces, responsive toolbar placement in narrow, wide and notched windows, fixed custom starts and new random palettes, installation README in the ZIP, validated transparent logos with safe removal, preview-independent exports with native window-state runtime layouts, real ZIP download, desktop and iPhone 17-sized Chromium/WebKit layout, no browser errors.');
} catch (error) {
  for (const { page, label } of pages) {
    await page.screenshot({ path: join(artifacts, `${label}-failure.png`), fullPage: true, animations: 'disabled' }).catch(() => {});
  }
  throw error;
} finally {
  await writeFile(join(artifacts, 'console-errors.json'), JSON.stringify(errors, null, 2) + '\n');
  await safari?.close();
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
}

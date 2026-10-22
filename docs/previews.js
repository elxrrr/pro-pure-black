import { DEFAULT_TOOLBAR_ORDER } from './toolbar.js';
import { toolbarFit } from './display.js';
import { statusLayout } from './status.js';
import { DEFAULT_LOGO_COLOUR } from './logo-colour.js';

const LETTERS = ['A', 'B', 'C', 'D'];
const DEFAULT_WAVES = ['#0085F4', '#FF0013', '#00FFBA', '#F94C00'];
const DEFAULT_DARKS = ['#0D5269', '#8E1E25', '#0B544A', '#84341A'];
const DEFAULT_METERS = [1792, 1776, 1469, 1453];
const watched = new Map();
const rendered = new WeakMap();
const toolbarViews = new WeakMap();
let nextToolbarView = 0;
let motionReady = false;
let observer;
let reduceMotion;

function updateMotion() {
  for (const [container, visible] of watched) {
    if (!container.isConnected) {
      observer?.unobserve(container);
      watched.delete(container);
      continue;
    }
    container.dataset.motion = !document.hidden && !reduceMotion.matches && visible && !container.hidden
      ? 'running' : 'paused';
  }
}

/** One observer and two event listeners; animation itself never runs in JS. */
export function setupPreviewMotion() {
  if (motionReady) return updateMotion;
  motionReady = true;
  reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  reduceMotion.addEventListener('change', updateMotion);
  document.addEventListener('visibilitychange', updateMotion);
  if ('IntersectionObserver' in window) {
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) watched.set(entry.target, entry.isIntersecting);
      updateMotion();
    }, { threshold: 0 });
  }
  return updateMotion;
}

function watch(container) {
  setupPreviewMotion();
  if (!watched.has(container)) {
    watched.set(container, !observer);
    observer?.observe(container);
  }
  updateMotion();
}

function tint(hex, amount, target = 0) {
  return '#' + [1, 3, 5].map(index => {
    const value = parseInt(hex.slice(index, index + 2), 16) * (1 - amount) + target * amount;
    const floor = Math.floor(value);
    const rounded = value - floor === .5 ? floor + floor % 2 : Math.round(value);
    return rounded.toString(16).padStart(2, '0');
  }).join('').toUpperCase();
}

function wavePath(deck, strength) {
  const points = [];
  for (let copy = 0; copy < 2; copy++) {
    for (let i = 0; i < 64; i++) {
      const pulse = i % 16 < 3 ? 8 : 0;
      const height = Math.max(2, Math.round((5 + Math.abs(Math.sin(i * .71 + deck)) * 9 + Math.abs(Math.sin(i * .19 + deck)) * 6 + pulse) * strength));
      const x = copy * 256 + i * 4;
      points.push(`M${x} ${26 - height}h2v${height * 2}h-2z`);
    }
  }
  return points.join('');
}

function jog() {
  const marks = Array.from({ length: 36 }, (_, i) => {
    const angle = i * Math.PI / 18;
    const inner = i % 3 === 0 ? 62 : 66;
    return `M${(80 + Math.sin(angle) * inner).toFixed(2)} ${(80 - Math.cos(angle) * inner).toFixed(2)}L${(80 + Math.sin(angle) * 70).toFixed(2)} ${(80 - Math.cos(angle) * 70).toFixed(2)}`;
  }).join('');
  return `<div class="preview-jog" aria-hidden="true">
    <svg viewBox="0 0 160 160"><circle cx="80" cy="80" r="75" fill="#000" stroke="#484848"/><path d="${marks}" fill="none" stroke="#484848"/><circle cx="80" cy="80" r="56" fill="#000" stroke="var(--deck-color)" stroke-width="3"/><circle cx="80" cy="80" r="49" fill="#000" stroke="#29292E"/><circle cx="80" cy="80" r="25" fill="#000" stroke="#343438"/><circle cx="80" cy="80" r="3" fill="var(--deck-color)"/></svg>
    <svg class="preview-motion preview-rotor" viewBox="0 0 160 160"><path d="M80 20v17" stroke="var(--deck-color)" stroke-width="3" stroke-linecap="round"/><path d="M80 123v7" stroke="#A6A6A6" stroke-width="2"/></svg>
  </div>`;
}

function knob(deckIndex) {
  // The native 42px control uses a black 34px body and -140°…140° travel.
  const arc = 'M8.787 35.555A19 19 0 1 1 33.213 35.555';
  return `<div class="preview-knob" data-knob="effect" aria-hidden="true" style="--knob-delay:${-deckIndex * .43}s">
    <svg viewBox="0 0 42 42"><title>Control preview: off to on</title><path class="preview-knob-track" d="${arc}" fill="none" stroke="#303030" stroke-width="4"/><path class="preview-motion preview-knob-highlight" d="${arc}" pathLength="100" fill="none" stroke="var(--deck-color)" stroke-width="4" stroke-dasharray="100"/><circle cx="21" cy="21" r="16.5" fill="#000" stroke="#303030"/></svg>
    <svg class="preview-motion preview-knob-needle" viewBox="0 0 42 42"><path d="M21 8v12" stroke="#848484" stroke-width="2" stroke-linecap="round"/></svg>
  </div>`;
}

function level(defaultPalette, index) {
  const cells = Array.from({ length: 11 }, (_, cell) => {
    // Sample solid interiors of the native sprite, retaining its exact colours
    // and grey peak without importing the sprite's transparent row dividers.
    const fill = defaultPalette
      ? `<svg class="preview-native-level" viewBox="${DEFAULT_METERS[index] + 1} ${cell === 10 ? 1 : 13} 1 1" preserveAspectRatio="none"><image href="./assets/gfx-pro.png" width="1920" height="428"/></svg>`
      : `<span class="preview-colour-level${cell === 10 ? ' preview-level-peak' : ''}"></span>`;
    return `<span class="preview-meter-track"><span class="meter-cell-lit preview-meter-cell" data-level="${cell + 1}" style="--meter-index:${cell}">${fill}</span></span>`;
  }).join('');
  return `<div class="preview-meter" aria-hidden="true"><div class="preview-motion preview-meter-fill meter-sequence" style="--meter-delay:${-index * .37}s">${cells}</div></div>`;
}

/** Illustrative jog, waveform and level preview using the skin's palette rules. */
export function renderPalettePreview(container, theme) {
  if (!container || !theme || !Array.isArray(theme.colors) || theme.colors.length !== 4 ||
      !theme.colors.every(colour => typeof colour === 'string' && /^#[0-9a-f]{6}$/i.test(colour))) {
    throw new Error('A palette preview needs four hex colours.');
  }
  const colours = theme.colors.map(colour => colour.toUpperCase());
  const original = theme.slug === 'default';
  const signature = `${original}:${colours.join(',')}`;
  container.classList.add('palette-preview');
  container.setAttribute('role', 'img');
  container.setAttribute('aria-label', `${theme.name || 'Custom'}: simulated decks, control knobs, waveforms and levels. ${colours.map((colour, i) => `${LETTERS[i]} ${colour}`).join(', ')}.`);
  if (rendered.get(container) !== signature || container.childElementCount !== 4) {
    container.replaceChildren(...colours.map((colour, index) => {
      const deck = document.createElement('div');
      deck.className = 'preview-deck';
      deck.dataset.deck = LETTERS[index];
      deck.style.setProperty('--deck-color', colour);
      deck.style.setProperty('--motion-delay', `${-index * .37}s`);
      const base = original ? DEFAULT_WAVES[index] : colour;
      const dark = original ? DEFAULT_DARKS[index] : tint(colour, .32);
      const bright = original ? base : tint(colour, .35, 255);
      deck.innerHTML = `<div class="preview-deck-heading"><span>${LETTERS[index]}</span><span class="preview-deck-hex">${colour}</span></div>
        <div class="preview-deck-instruments">${jog()}${level(original, index)}${knob(index)}</div>
        <div class="preview-wave" aria-hidden="true"><div class="preview-motion preview-wave-strip"><svg viewBox="0 0 512 52" preserveAspectRatio="none"><path d="${wavePath(index, 1)}" fill="${dark}"/><path d="${wavePath(index, .7)}" fill="${base}"/><path d="${wavePath(index, .28)}" fill="${bright}"/></svg></div><span class="preview-wave-needle"></span></div>`;
      return deck;
    }));
    rendered.set(container, signature);
  }
  watch(container);
}

const ICONS = {
  account: '<circle cx="12" cy="8" r="3"/><path d="M6 20v-3a6 6 0 0 1 12 0v3"/>',
  shoutout: '<path d="M4 10h4l10-5v14L8 14H4zM8 14l2 6h3l-2-5M21 9v6"/>',
  scheduler: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v5m8-5v5M4 10h16m-11 4h2m2 0h2m-6 3h2"/>',
  sandbox: '<path d="M5 4h14M5 20h14M7 4v4l5 4-5 4v4m10-16v4l-5 4 5 4v4"/>',
  settings: '<path d="m9 4 1-2h4l1 2 3 1 2 3-1 3 1 3-2 3-3 1-1 2h-4l-1-2-3-1-2-3 1-3-1-3 2-3z"/><circle cx="12" cy="11" r="3"/>',
};
const LABELS = { account: 'Account', shoutout: 'Shoutout', scheduler: 'Event Scheduler', sandbox: 'Sandbox', layout: 'Layout', settings: 'Settings' };

const DEFAULT_TOOLBAR_COLOURS = ['#156C89', '#AC2F37', '#0D7264', '#A54D30'];

function toolbarIcon(key, x = 8, y = 4, size = 19) {
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[key]}</svg>`;
}

function nativeBounds(x, y, width, height) {
  return `data-native-x="${x}" data-native-y="${y}" data-native-width="${width}" data-native-height="${height}"`;
}

function toolbarControl({ key, x, y, width, height }) {
  let content;
  if (key === 'layout') {
    content = '<text x="10" y="18" font-size="11">PRO</text><path d="m100 11 5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.4"/>';
  } else if (key === 'account') {
    content = `${toolbarIcon(key, 5, 5, 16)}<text x="26" y="18" font-size="11">ACCOUNT</text>`;
  } else if (key === 'sandbox') {
    const wave = Array.from({ length: 128 }, (_, i) => {
      const height = 3 + Math.round(Math.abs(Math.sin((i % 64) * .61)) * 14);
      return `<rect x="${1 + i * 3.125}" y="${(27 - height) / 2}" width="2" height="${height}" fill="#484848"/>`;
    }).join('');
    content = `${toolbarIcon(key)}<path d="M35 0v27" stroke="#303030"/><svg class="toolbar-sim-sandbox-wave" data-native-width="200" x="35" y="0" width="200" height="27" viewBox="0 0 200 27" overflow="hidden"><g class="toolbar-motion toolbar-sandbox-strip">${wave}</g><path d="M58 1v25" stroke="#a6a6a6"/></svg>`;
  } else {
    content = toolbarIcon(key, key === 'settings' ? 5 : 8, key === 'settings' ? 1 : 4, key === 'settings' ? 25 : 19);
  }
  return `<g class="toolbar-sim-control toolbar-sim-${key}" data-toolbar-control="${key}" ${nativeBounds(x, y, width, height)} transform="translate(${x} ${y})"><title>${LABELS[key]}${key === 'sandbox' ? ' with active waveform' : ''}</title><rect width="${width}" height="${height}" rx="3" fill="#000" stroke="#303030"/>${content}</g>`;
}

function toolbarStatus(x = 195, options = {}) {
  const layout = statusLayout(options);
  if (!layout.width) return '';
  const { positions } = layout;
  const meters = [8, 15].map((y, channel) => {
    const segments = Array.from({ length: 11 }, (_, cell) => {
      const bounds = `x="${55 + cell * 6.5}" y="${y}" width="5" height="5"`;
      return `<rect class="toolbar-master-track" ${bounds} fill="#242424"/><rect class="meter-cell-lit toolbar-master-cell" data-level="${cell + 1}" style="--meter-index:${cell}" ${bounds} fill="#828282"/>`;
    }).join('');
    return `<g class="toolbar-motion toolbar-master-fill meter-sequence" style="--meter-delay:${-channel * .37}s">${segments}</g>`;
  }).join('');
  return `<g class="toolbar-sim-status" ${nativeBounds(x, 8, layout.width, 27)} transform="translate(${x} 8)">
    <rect width="${layout.items.length === 4 ? layout.width - 3 : layout.width}" height="27" rx="4" fill="#000" stroke="#282828"/>
    ${positions.master === null ? '' : `<g class="toolbar-sim-master" transform="translate(${positions.master} 0)"><text x="0" y="18" font-size="11">MASTER</text><g class="toolbar-sim-master-bars">${meters}</g><circle cx="134.5" cy="14.5" r="5" fill="none" stroke="#484848"/></g>`}
    ${layout.separators.map(left => `<path d="M${left} 4v19" stroke="#282828"/>`).join('')}
    ${positions.cpu === null ? '' : `<g class="toolbar-sim-cpu" transform="translate(${positions.cpu} 0)"><text x="0" y="18" font-size="11">CPU</text><rect x="30" y="6" width="4" height="15" fill="#242424"/><rect class="toolbar-motion toolbar-cpu-fill" x="30" y="6" width="4" height="15" fill="#828282"/></g>`}
    ${positions.battery === null ? '' : `<g class="toolbar-sim-battery" transform="translate(${positions.battery} 0)"><rect x="2" y="9" width="18" height="9" rx="1" fill="none" stroke="#a6a6a6"/><path d="M22 12v3" stroke="#a6a6a6"/><rect x="4" y="11" width="12" height="5" fill="#828282"/><rect x="30" y="6" width="4" height="15" fill="#242424"/><rect x="30" y="9" width="4" height="12" fill="#828282"/></g>`}
    ${positions.clock === null ? '' : `<text class="toolbar-sim-clock" x="${positions.clock + 38}" y="18" text-anchor="middle" font-size="13" fill="#bbb">12:34</text>`}
  </g>`;
}

function phraseCircle(deck, x, colour) {
  const counts = Array.from({ length: 16 }, (_, beat) => `<text class="toolbar-phrase-count" data-count="${beat + 1}" style="--phrase-number:${beat + 1}" x="15" y="19" text-anchor="middle" fill="#b8b8b8" font-size="11">${beat + 1}</text>`).join('');
  return `<g class="toolbar-sim-phrase" data-phrase-deck="${deck}" data-color="${colour}" ${nativeBounds(x, 6, 30, 30)} transform="translate(${x} 6)"><title>Deck ${deck}: 16-beat phrase counter</title><circle cx="15" cy="15" r="15" fill="#000"/><circle class="toolbar-phrase-track" cx="15" cy="15" r="12.5" fill="none" stroke="#484848" stroke-width="5"/><circle class="toolbar-phrase-progress" cx="15" cy="15" r="12.5" pathLength="16" fill="none" stroke="${colour}" stroke-width="5" stroke-dasharray="16" transform="rotate(-90 15 15)"/><circle cx="15" cy="15" r="10" fill="#000"/>${counts}</g>`;
}

function phrasePreview(notch, colours, offset = 0) {
  const positions = notch ? { A: 760, C: 795, B: 1095, D: 1130 } : { C: 823, A: 858, B: 1037, D: 1072 };
  const circles = Object.entries(positions).map(([deck, x]) => phraseCircle(deck, x + offset, colours[LETTERS.indexOf(deck)])).join('');
  const clock = contents => `<g class="toolbar-motion toolbar-phrase-clock">${contents}</g>`;
  if (notch) return clock(circles);
  // Native goto_bar 1…4 indicators are the four beats within each measure.
  const bars = colours.map((colour, deck) => `<g class="toolbar-beat-row" data-beat-deck="${LETTERS[deck]}">${Array.from({ length: 4 }, (_, beat) => {
    const bounds = `x="${898 + offset + beat * 33}" y="${8 + deck * 7}" width="28" height="5" rx="2"`;
    return `<rect ${bounds} fill="#484848"/><rect class="toolbar-beat-progress" data-beat="${beat + 1}" ${bounds} fill="${colour}" style="--bar-number:${beat + 1}"/>`;
  }).join('')}</g>`).join('');
  return clock(`${circles}<g class="toolbar-sim-beat-bars" ${nativeBounds(898 + offset, 8, 127, 26)}>${bars}</g>`);
}

function toolbarAvailableWidth(container) {
  const style = window.getComputedStyle(container);
  return Math.max(0, Math.round(container.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0)));
}

/** The display edge stays in view; its cutout follows the toolbar while panning. */
function renderScreenFrame(frame, viewport, fit, notch, id) {
  const { width, height } = viewport.getBoundingClientRect();
  const right = width - .5;
  const bottom = height - .5;
  const radius = 16;
  const edge = `M.5 ${bottom}V${radius + .5}Q.5 .5 ${radius + .5} .5H${right - radius}Q${right} .5 ${right} ${radius + .5}V${bottom}Z`;
  // The shared window continues these sides around the decks. Keep only the
  // top and side strokes here, so no extra line separates toolbar and controls.
  const outline = viewport.closest('.preview-window')
    ? `M.5 ${height}V${radius + .5}Q.5 .5 ${radius + .5} .5H${right - radius}Q${right} .5 ${right} ${radius + .5}V${height}`
    : edge;
  const scale = fit.scale;
  const notchWidth = 230 * scale;
  const notchBottom = (30 + 7.5) * scale;
  const corner = 8 * scale;
  const shoulder = 6 * scale;
  const contour = `M${-shoulder} .5Q0 .5 0 ${shoulder + .5}V${notchBottom - corner}Q0 ${notchBottom} ${corner} ${notchBottom}H${notchWidth - corner}Q${notchWidth} ${notchBottom} ${notchWidth} ${notchBottom - corner}V${shoulder + .5}Q${notchWidth} .5 ${notchWidth + shoulder} .5`;
  frame.setAttribute('viewBox', `0 0 ${width} ${height}`);
  frame.innerHTML = `<defs>
    <clipPath id="${id}-screen"><path d="${edge}"/></clipPath>
    ${notch ? `<mask id="${id}-cutout" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">
      <rect width="${width}" height="${height}" fill="white"/>
      <g class="toolbar-screen-cutout"><path d="${contour}V-2H${-shoulder}Z" fill="black" stroke="black" stroke-width="1"/></g>
    </mask>` : ''}
  </defs>
  <path class="toolbar-screen-outline" d="${outline}" ${notch ? `mask="url(#${id}-cutout)"` : ''}/>
  ${notch ? `<g clip-path="url(#${id}-screen)"><g class="toolbar-screen-notch"><path d="${contour}"/></g></g>` : ''}`;
  const movingParts = frame.querySelectorAll('.toolbar-screen-cutout, .toolbar-screen-notch');
  const update = () => {
    const left = (845 + fit.phraseOffset) * scale - viewport.scrollLeft;
    for (const part of movingParts) part.setAttribute('transform', `translate(${left} 0)`);
  };
  update();
  return update;
}

/** Fixed-size controls, centered phrases and right-anchored tools; preview choices never change the skin. */
export function renderToolbarPreview(container, options = {}, order = DEFAULT_TOOLBAR_ORDER, display = {}) {
  if (!container) throw new Error('The toolbar preview container is missing.');
  const { notch = false, fullscreen = notch, colors = DEFAULT_TOOLBAR_COLOURS, logo = null, logoColour = DEFAULT_LOGO_COLOUR } = display;
  if (typeof notch !== 'boolean') throw new TypeError('Notch preview must be on or off.');
  if (logo !== null && (typeof logo !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(logo))) {
    throw new TypeError('The toolbar logo must be a PNG data URL.');
  }
  if (typeof logoColour !== 'string' || !/^#[0-9a-f]{6}$/i.test(logoColour)) {
    throw new TypeError('The toolbar logo needs a six-digit hex colour.');
  }
  if (!Array.isArray(colors) || colors.length !== 4 || !colors.every(colour => typeof colour === 'string' && /^#[0-9a-f]{6}$/i.test(colour))) {
    throw new Error('The toolbar preview needs four hex colours.');
  }
  const colours = colors.map(colour => colour.toUpperCase());
  container.classList.add('toolbar-simulation');
  let view = toolbarViews.get(container);
  if (!view) {
    view = { scrollLeft: null, id: `toolbar-detail-${++nextToolbarView}` };
    toolbarViews.set(container, view);
  }
  view.args = { options, order, display };
  const width = toolbarAvailableWidth(container) || view.width || 1440;
  const fit = toolbarFit(options, order, { notch, fullscreen, width });
  const { items, leftItem, canvasWidth, phraseOffset, renderWidth, statusX, logoX } = fit;
  view.width = width;
  container.dataset.notch = String(notch);
  container.dataset.availableWidth = width;
  container.dataset.renderWidth = renderWidth;
  container.dataset.canvasWidth = canvasWidth;
  container.dataset.accountLeft = String(fit.accountLeft);
  container.dataset.autoHiddenAccount = String(fit.autoHiddenAccount);
  const oldViewport = container.querySelector('.toolbar-preview-viewport');
  const retainFocus = oldViewport === document.activeElement;
  if (oldViewport) view.scrollLeft = oldViewport.scrollLeft;
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Toolbar preview');
  const statusNames = { master: 'master level', cpu: 'CPU', battery: 'battery', clock: 'clock' };
  const statusDescription = statusLayout(options).items.map(item => `, ${statusNames[item.key]}`).join('');
  const description = `Approximate toolbar at a fixed control size. Left, from left to right: VirtualDJ logo${leftItem ? ', Account' : ''}${statusDescription}${logo ? ', uploaded logo' : ''}. ${notch ? 'A and C phrase counters left of the notch, B and D right; top beat bars hidden.' : 'Normal phrase counters and top beat bars visible.'} Right, from left to right: ${items.map(item => LABELS[item.key]).join(', ')}.${fit.autoHiddenAccount ? ' Account is hidden to leave space for the notch layout.' : ''}`;
  // Frame the native control row around y=21.5 with equal space above and below.
  // At the fixed preview scale, 58 units retain the existing 43.5px outer height.
  const cutout = notch ? `<g class="toolbar-sim-notch" data-native-x="${845 + phraseOffset}" data-native-width="230" transform="translate(${phraseOffset} 0)"><path d="M845 -7.5V22a8 8 0 0 0 8 8h214a8 8 0 0 0 8-8V-7.5" fill="#000"/><circle cx="960" cy="13" r="4" fill="#141418" stroke="#343438"/></g>` : '';
  container.innerHTML = `<div class="toolbar-preview-viewport" id="${view.id}" role="region" tabindex="0" aria-label="Toolbar detail; scroll horizontally to inspect the toolbar">
    <div class="toolbar-display-frame" style="--canvas-width:${canvasWidth}px;--toolbar-render-width:${renderWidth}px">
    <svg class="toolbar-sim-svg" viewBox="0 -7.5 ${canvasWidth} 58" xmlns="http://www.w3.org/2000/svg" role="img">
      ${logo ? `<defs><filter id="${view.id}-logo-tint" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feFlood class="toolbar-logo-tint" flood-color="${logoColour}"/><feComposite in2="SourceGraphic" operator="in"/></filter></defs>` : ''}
      <g class="toolbar-sim-left">
        <g class="toolbar-sim-window"><g class="toolbar-sim-lights"><circle cx="22.5" cy="20.5" r="7.5" fill="#bf4744"/><circle cx="47.5" cy="20.5" r="7.5" fill="#be8d2f"/><circle cx="72.5" cy="20.5" r="7.5" fill="#279637"/></g><text class="toolbar-sim-logo" x="100" y="27" textLength="72" lengthAdjust="spacingAndGlyphs" font-size="17" font-style="italic" font-weight="700" fill="${DEFAULT_LOGO_COLOUR}">VirtualDJ</text></g>
        ${leftItem ? toolbarControl(leftItem) : ''}
        ${toolbarStatus(statusX, options)}
        ${logo ? `<image class="toolbar-sim-custom-logo" data-custom-logo="" ${nativeBounds(logoX, 13, 72, 17)} x="${logoX}" y="13" width="72" height="17" preserveAspectRatio="xMidYMid meet" filter="url(#${view.id}-logo-tint)"/>` : ''}
      </g>
      <g class="toolbar-sim-phrases">${phrasePreview(notch, colours, phraseOffset)}</g>
      <g class="toolbar-sim-right">${items.map(toolbarControl).join('')}</g>
      ${cutout}
    </svg>
    </div>
  </div><svg class="toolbar-screen-frame" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"></svg>`;
  container.querySelector('.toolbar-sim-svg').setAttribute('aria-label', description);
  if (logo) container.querySelector('[data-custom-logo]').setAttribute('href', logo);
  const viewport = container.querySelector('.toolbar-preview-viewport');
  // Keep controls readable at one fixed scale. Panning stays local to the preview
  // and retains the user's chosen position through palette and toolbar changes.
  viewport.scrollLeft = view.scrollLeft ?? Math.max(0, (renderWidth - viewport.clientWidth) / 2);
  view.scrollLeft = viewport.scrollLeft;
  const updateFrame = renderScreenFrame(container.querySelector('.toolbar-screen-frame'), viewport, fit, notch, view.id);
  viewport.addEventListener('scroll', () => { view.scrollLeft = viewport.scrollLeft; updateFrame(); }, { passive: true });
  if (retainFocus) viewport.focus({ preventScroll: true });
  watch(container);
  if (!view.resizeObserver && 'ResizeObserver' in window) {
    view.resizeObserver = new window.ResizeObserver(entries => {
      const nextWidth = Math.round(entries[0].contentRect.width);
      if (nextWidth <= 0 || nextWidth === view.width) return;
      view.width = nextWidth;
      renderToolbarPreview(container, view.args.options, view.args.order, view.args.display);
    });
    view.resizeObserver.observe(container);
  }
  container.dispatchEvent(new window.CustomEvent('toolbarlayoutchange', { detail: fit }));
}

import { DEFAULT_TOOLBAR_ORDER } from './toolbar.js';
import { getDisplayProfile, toolbarFit } from './display.js';

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

function level(defaultPalette, index) {
  // Default uses the exact native meter pixels, not the custom colour rule.
  const fill = defaultPalette
    ? `<svg class="preview-native-level" viewBox="${DEFAULT_METERS[index]} 0 3 160" preserveAspectRatio="none"><image href="./assets/gfx-pro.png" width="1920" height="428"/></svg>`
    : '<span class="preview-colour-level"></span>';
  return `<div class="preview-meter" aria-hidden="true"><div class="preview-meter-track"></div><div class="preview-motion preview-meter-fill">${fill}</div><span class="preview-meter-lines"></span></div>`;
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
  container.setAttribute('aria-label', `${theme.name || 'Custom'}: simulated decks, waveforms and levels. ${colours.map((colour, i) => `${LETTERS[i]} ${colour}`).join(', ')}.`);
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
        <div class="preview-deck-instruments">${jog()}${level(original, index)}</div>
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

function toolbarStatus(x = 195) {
  const meters = [9, 15].map((y, channel) => {
    const segments = Array.from({ length: 13 }, (_, i) => `<rect x="${65 + i * 5.4}" y="${y}" width="4" height="4"/>`).join('');
    return `<g fill="#242424">${segments}</g><g class="toolbar-motion toolbar-master-fill" fill="#828282" style="--toolbar-delay:${-channel * .37}s">${segments}</g>`;
  }).join('');
  return `<g class="toolbar-sim-status" ${nativeBounds(x, 8, 336, 27)} transform="translate(${x} 8)">
    <rect width="333" height="27" rx="4" fill="#000" stroke="#282828"/>
    <g class="toolbar-sim-master"><text x="10" y="18" font-size="11">MASTER</text><g class="toolbar-sim-master-bars">${meters}</g><circle cx="144.5" cy="14.5" r="5" fill="none" stroke="#484848"/></g>
    <path d="M160 4v19m50-19v19m50-19v19" stroke="#282828"/>
    <g class="toolbar-sim-cpu"><text x="170" y="18" font-size="11">CPU</text><rect x="200" y="6" width="4" height="15" fill="#242424"/><rect class="toolbar-motion toolbar-cpu-fill" x="200" y="6" width="4" height="15" fill="#828282"/></g>
    <g class="toolbar-sim-battery"><rect x="222" y="9" width="18" height="9" rx="1" fill="none" stroke="#a6a6a6"/><path d="M242 12v3" stroke="#a6a6a6"/><rect x="224" y="11" width="12" height="5" fill="#828282"/><rect x="250" y="6" width="4" height="15" fill="#242424"/><rect x="250" y="9" width="4" height="12" fill="#828282"/></g>
    <text class="toolbar-sim-clock" x="298" y="18" text-anchor="middle" font-size="13" fill="#bbb">12:34</text>
  </g>`;
}

function phraseCircle(deck, x, colour) {
  return `<g class="toolbar-sim-phrase" data-phrase-deck="${deck}" data-color="${colour}" ${nativeBounds(x, 6, 30, 30)} transform="translate(${x} 6)"><title>Deck ${deck} phrase counter</title><circle cx="15" cy="15" r="15" fill="#484848"/><circle class="toolbar-motion toolbar-phrase-progress" cx="15" cy="15" r="12.5" fill="none" stroke="${colour}" stroke-width="5" stroke-dasharray="27 52" style="--toolbar-delay:${-LETTERS.indexOf(deck) * .4}s"/><circle cx="15" cy="15" r="10" fill="#000"/><text x="15" y="19" text-anchor="middle" fill="#a6a6a6" font-size="11">${deck}</text></g>`;
}

function phrasePreview(notch, colours, offset = 0) {
  const positions = notch ? { A: 760, C: 795, B: 1095, D: 1130 } : { C: 823, A: 858, B: 1037, D: 1072 };
  const circles = Object.entries(positions).map(([deck, x]) => phraseCircle(deck, x + offset, colours[LETTERS.indexOf(deck)])).join('');
  if (notch) return circles;
  const bars = colours.map((colour, deck) => Array.from({ length: 4 }, (_, beat) => {
    const bounds = `x="${898 + offset + beat * 33}" y="${8 + deck * 7}" width="28" height="5" rx="2"`;
    return `<rect ${bounds} fill="#484848"/><rect class="toolbar-motion toolbar-beat-progress" ${bounds} fill="${colour}" style="--toolbar-delay:${-beat * .5 - deck * .125}s"/>`;
  }).join('')).join('');
  return `${circles}<g class="toolbar-sim-beat-bars" ${nativeBounds(898 + offset, 8, 127, 26)}>${bars}</g>`;
}

/** Fixed-size controls, centered phrases and right-anchored tools; preview choices never change the skin. */
export function renderToolbarPreview(container, options = {}, order = DEFAULT_TOOLBAR_ORDER, display = {}) {
  if (!container) throw new Error('The toolbar preview container is missing.');
  const { notch = false, profile = '14', colors = DEFAULT_TOOLBAR_COLOURS, logo = null } = display;
  if (typeof notch !== 'boolean') throw new TypeError('Notch preview must be on or off.');
  if (logo !== null && (typeof logo !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(logo))) {
    throw new TypeError('The toolbar logo must be a PNG data URL.');
  }
  if (!Array.isArray(colors) || colors.length !== 4 || !colors.every(colour => typeof colour === 'string' && /^#[0-9a-f]{6}$/i.test(colour))) {
    throw new Error('The toolbar preview needs four hex colours.');
  }
  const colours = colors.map(colour => colour.toUpperCase());
  const device = getDisplayProfile(profile);
  const fit = toolbarFit(options, order, { notch, profile });
  const { items, canvasWidth, phraseOffset } = fit;
  container.classList.add('toolbar-simulation');
  container.dataset.profile = device.id;
  container.dataset.notch = String(notch);
  container.dataset.displayWidth = device.width;
  container.dataset.displayHeight = device.height;
  container.dataset.canvasWidth = canvasWidth;
  let view = toolbarViews.get(container);
  if (!view) {
    view = { scrollLeft: null, id: `toolbar-detail-${++nextToolbarView}` };
    toolbarViews.set(container, view);
  }
  const oldViewport = container.querySelector('.toolbar-preview-viewport');
  if (oldViewport) view.scrollLeft = oldViewport.scrollLeft;
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Toolbar preview');
  const description = `Approximate ${device.label} toolbar at a fixed control size. Left: VirtualDJ logo${logo ? ', uploaded logo' : ''}, master level, CPU, battery and clock. ${notch ? 'A and C phrase counters left of the notch, B and D right; top beat bars hidden.' : 'Normal phrase counters and top beat bars visible.'} Right, from left to right: ${items.map(item => LABELS[item.key]).join(', ')}.`;
  const cutout = notch ? `<g class="toolbar-sim-notch" data-native-x="${845 + phraseOffset}" data-native-width="230" transform="translate(${phraseOffset} 0)"><path d="M845 0v22a8 8 0 0 0 8 8h214a8 8 0 0 0 8-8V0" fill="#000" stroke="#343438"/><circle cx="960" cy="13" r="4" fill="#141418" stroke="#343438"/></g>` : '';
  container.innerHTML = `<div class="toolbar-preview-viewport" id="${view.id}" role="region" tabindex="0" aria-label="Toolbar detail; scroll horizontally to inspect the toolbar">
    <div class="toolbar-display-frame" style="--canvas-width:${canvasWidth}px;--toolbar-render-width:${canvasWidth * fit.scale}px">
    <svg class="toolbar-sim-svg" viewBox="0 0 ${canvasWidth} 84" xmlns="http://www.w3.org/2000/svg" role="img">
      <rect x=".5" y=".5" width="${canvasWidth - 1}" height="83" rx="10" fill="#000" stroke="var(--line)"/>
      <path d="M1 43h${canvasWidth - 2}" stroke="#282828"/>
      <g class="toolbar-sim-left">
        <g class="toolbar-sim-window"><g class="toolbar-sim-lights"><circle cx="22.5" cy="20.5" r="7.5" fill="#bf4744"/><circle cx="47.5" cy="20.5" r="7.5" fill="#be8d2f"/><circle cx="72.5" cy="20.5" r="7.5" fill="#279637"/></g><text class="toolbar-sim-logo" x="100" y="27" textLength="72" lengthAdjust="spacingAndGlyphs" font-size="17" font-style="italic" font-weight="700" fill="#959595">VirtualDJ</text>${logo ? `<image class="toolbar-sim-custom-logo" data-custom-logo="" ${nativeBounds(182, 13, 72, 17)} x="182" y="13" width="72" height="17" preserveAspectRatio="xMidYMid meet"/>` : ''}</g>
        ${toolbarStatus(logo ? 276 : 195)}
      </g>
      <g class="toolbar-sim-phrases">${phrasePreview(notch, colours, phraseOffset)}</g>
      <g class="toolbar-sim-right">${items.map(toolbarControl).join('')}</g>
      ${cutout}
    </svg>
    </div>
  </div>`;
  container.querySelector('.toolbar-sim-svg').setAttribute('aria-label', description);
  if (logo) container.querySelector('[data-custom-logo]').setAttribute('href', logo);
  const viewport = container.querySelector('.toolbar-preview-viewport');
  // Keep controls readable at one fixed scale. Panning stays local to the preview
  // and retains the user's chosen position through palette and toolbar changes.
  viewport.scrollLeft = view.scrollLeft ?? Math.max(0, (canvasWidth * fit.scale - viewport.clientWidth) / 2);
  view.scrollLeft = viewport.scrollLeft;
  viewport.addEventListener('scroll', () => { view.scrollLeft = viewport.scrollLeft; }, { passive: true });
  watch(container);
}

const LETTERS = ['A', 'B', 'C', 'D'];
const DEFAULT_WAVES = ['#0085F4', '#FF0013', '#00FFBA', '#F94C00'];
const DEFAULT_DARKS = ['#0D5269', '#8E1E25', '#0B544A', '#84341A'];
const DEFAULT_METERS = [1792, 1776, 1469, 1453];
const watched = new Map();
const rendered = new WeakMap();
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
const LABELS = { account: 'Account', shoutout: 'Shoutout', scheduler: 'Event Scheduler', sandbox: 'Sandbox' };

function icon(key) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[key]}</svg>`;
}

/** Non-interactive toolbar mockup; its optional controls mirror the toggles. */
export function renderToolbarPreview(container, options = {}) {
  if (!container) throw new Error('The toolbar preview container is missing.');
  container.classList.add('toolbar-simulation');
  const enabled = Object.keys(LABELS).filter(key => options[key]);
  container.setAttribute('role', 'img');
  container.setAttribute('aria-label', `Simulated toolbar. ${enabled.length ? enabled.map(key => LABELS[key]).join(', ') : 'Optional controls hidden'}. Layout, status and Settings remain visible.`);
  container.innerHTML = `<div class="toolbar-sim-window" aria-hidden="true"><span class="toolbar-sim-lights"><i></i><i></i><i></i></span><span class="toolbar-sim-logo">VDJ</span></div>
    <div class="toolbar-sim-optional">${enabled.map(key => `<span class="toolbar-sim-control" data-toolbar-control="${key}" title="${LABELS[key]}">${icon(key)}<span>${LABELS[key]}</span></span>`).join('')}</div>
    <div class="toolbar-sim-permanent" aria-hidden="true"><span class="toolbar-sim-layout">PRO <span>⌄</span></span><span class="toolbar-sim-status"><i></i><i></i><i></i><i></i><i></i><i></i></span><span class="toolbar-sim-settings">${icon('settings')}</span></div>`;
}

export const CUSTOM_START_COLORS = Object.freeze(['#E98DB6', '#89BFF0', '#B69BE4', '#F2C48F']);

// Offsets combine neighbouring, split-complementary and triadic hues. Each
// palette has a darker, medium and lighter pastel to keep the decks distinct.
const HARMONIES = [[32, 160, 204], [150, 210, 328], [28, 116, 242], [55, 176, 292]];
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function toHsl(hex) {
  const [r, g, b] = hex.slice(1).match(/../g).map(part => parseInt(part, 16) / 255);
  const high = Math.max(r, g, b), low = Math.min(r, g, b);
  const range = high - low, lightness = (high + low) / 2;
  if (!range) return [0, 0, lightness];
  const hue = high === r ? (g - b) / range + (g < b ? 6 : 0)
    : high === g ? (b - r) / range + 2 : (r - g) / range + 4;
  return [hue * 60, range / (1 - Math.abs(2 * lightness - 1)), lightness];
}

function fromHsl(hue, saturation, lightness) {
  const h = ((hue % 360) + 360) % 360 / 60;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(h % 2 - 1));
  const channels = h < 1 ? [chroma, x, 0] : h < 2 ? [x, chroma, 0]
    : h < 3 ? [0, chroma, x] : h < 4 ? [0, x, chroma]
      : h < 5 ? [x, 0, chroma] : [chroma, 0, x];
  const offset = lightness - chroma / 2;
  return '#' + channels.map(channel => Math.round((channel + offset) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function randomSource(random) {
  if (typeof random !== 'function') throw new TypeError('Random must be a function.');
  return () => {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError('Random must return a number from 0 up to, but not including, 1.');
    }
    return value;
  };
}

/** Derive three related, visibly different pastels from an anchor colour. */
export function relatedPalette(baseHex, random = Math.random) {
  if (typeof baseHex !== 'string' || !/^#[0-9a-f]{6}$/i.test(baseHex.trim())) {
    throw new TypeError('Deck A must be a six-digit hex colour, such as #E98DB6.');
  }
  const draw = randomSource(random);
  const base = baseHex.trim().toUpperCase();
  const [sourceHue, sourceSaturation] = toHsl(base);
  // Neutral anchors have no useful hue; choose one for their accompanying trio.
  const neutral = sourceSaturation < .08;
  const hue = neutral ? draw() * 360 : sourceHue;
  const saturation = neutral ? .52 : clamp(sourceSaturation * .6 + .18, .42, .72);
  const harmony = HARMONIES[Math.floor(draw() * HARMONIES.length)];
  return [base, ...harmony.map((offset, index) => fromHsl(
    hue + offset + (draw() - .5) * 10,
    saturation + (draw() - .5) * .06,
    [.65, .73, .81][index] + (draw() - .5) * .04,
  ))];
}

/** Pick a new pastel for deck A, then build its harmonious companion colours. */
export function randomPalette(random = Math.random) {
  const draw = randomSource(random);
  const anchor = fromHsl(draw() * 360, .50 + draw() * .22, .60 + draw() * .12);
  return relatedPalette(anchor, draw);
}

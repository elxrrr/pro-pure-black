/** The uploaded logo is an alpha mask coloured by the selected deck palette. */
export const DEFAULT_LOGO_COLOUR = '#959595';
const HEX = /^#[0-9a-f]{6}$/i;

export function logoColour(theme) {
  if (!theme || theme.slug === 'default') return DEFAULT_LOGO_COLOUR;
  const colour = theme.colors?.[0];
  if (typeof colour !== 'string' || !HEX.test(colour)) {
    throw new TypeError('The logo palette must contain a six-digit deck A colour.');
  }
  return colour.toUpperCase();
}

/** Keep every alpha byte, including antialiased edges, without mutating input. */
export function tintLogoPixels(pixels, colour) {
  if (!(pixels instanceof Uint8Array) || pixels.length % 4 !== 0) {
    throw new TypeError('Logo pixels must contain complete RGBA pixels.');
  }
  if (typeof colour !== 'string' || !HEX.test(colour)) {
    throw new TypeError('The logo colour must be a six-digit hex value.');
  }
  const rgb = [1, 3, 5].map(index => Number.parseInt(colour.slice(index, index + 2), 16));
  const tinted = Uint8Array.from(pixels);
  for (let offset = 0; offset < tinted.length; offset += 4) {
    tinted[offset] = rgb[0];
    tinted[offset + 1] = rgb[1];
    tinted[offset + 2] = rgb[2];
  }
  return tinted;
}

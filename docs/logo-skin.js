import { inspectPng, pngCrc32, LOGO_LIMITS } from './logo-image.js';
import { ACCOUNT_LEFT_VISIBILITY, ACCOUNT_NORMAL_VISIBILITY } from './toolbar.js';
import { statusLogoOffset } from './status.js';
import { normaliseThemes } from './generator.js';
import { logoColour, tintLogoPixels } from './logo-colour.js';

export const LOGO_PLACEMENT = Object.freeze({
  mac: Object.freeze({ x: 538, y: 13, statusX: 195 }),
  pc: Object.freeze({ x: 443, y: 13, statusX: 100 }),
});
const MARKER = 'BEGIN PURE BLACK CUSTOM LOGO';

function concatenate(parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function chunk(type, data) {
  const output = new Uint8Array(data.length + 12);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.length);
  output.set([...type].map(letter => letter.charCodeAt(0)), 4);
  output.set(data, 8);
  view.setUint32(output.length - 4, pngCrc32(output, 4, output.length - 4));
  return output;
}

async function transform(bytes, compress) {
  const Stream = compress ? globalThis.CompressionStream : globalThis.DecompressionStream;
  if (!Stream) throw new Error('This browser cannot build a skin with a custom logo. Try a current browser or remove the logo.');
  const stream = new Blob([bytes]).stream().pipeThrough(new Stream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Pack tiles across appended rows without redrawing any original pixel. */
export async function appendLogoSprites(baseImage, tiles) {
  const metadata = inspectPng(baseImage);
  if (metadata.colorType !== 6 || metadata.bitDepth !== 8 || metadata.interlace !== 0 || metadata.width < LOGO_LIMITS.tileWidth) {
    throw new Error('The skin sprite format does not support a custom logo.');
  }
  if (!Array.isArray(tiles) || !tiles.length || tiles.some(tilePixels =>
    !(tilePixels instanceof Uint8Array) || tilePixels.length !== LOGO_LIMITS.tileWidth * LOGO_LIMITS.tileHeight * 4)) {
    throw new TypeError('The logo must contain a prepared 144 × 34 RGBA tile.');
  }
  const bytes = baseImage instanceof Uint8Array ? baseImage : new Uint8Array(baseImage);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    chunks.push({ type, raw: bytes.subarray(offset, offset + length + 12), data: bytes.subarray(offset + 8, offset + 8 + length) });
    offset += length + 12;
  }
  const scanlines = await transform(concatenate(chunks.filter(item => item.type === 'IDAT').map(item => item.data)), false);
  const stride = metadata.width * 4 + 1;
  if (scanlines.length !== metadata.height * stride) throw new Error('The skin sprite image data is incomplete.');
  const columns = Math.floor(metadata.width / LOGO_LIMITS.tileWidth);
  const height = metadata.height + Math.ceil(tiles.length / columns) * LOGO_LIMITS.tileHeight;
  const positions = tiles.map((_, index) => ({
    x: (index % columns) * LOGO_LIMITS.tileWidth,
    y: metadata.height + Math.floor(index / columns) * LOGO_LIMITS.tileHeight,
  }));
  const appended = new Uint8Array(height * stride);
  appended.set(scanlines);
  for (const [index, tilePixels] of tiles.entries()) {
    const { x, y } = positions[index];
    for (let row = 0; row < LOGO_LIMITS.tileHeight; row++) {
      // Zero is the PNG None filter. Each appended row is independent of the
      // old rows, and unused areas remain transparent after zero-initialisation.
      appended.set(tilePixels.subarray(row * LOGO_LIMITS.tileWidth * 4, (row + 1) * LOGO_LIMITS.tileWidth * 4),
        (y + row) * stride + 1 + x * 4);
    }
  }
  const compressed = await transform(appended, true);
  const output = [bytes.subarray(0, 8)];
  let wroteData = false;
  for (const item of chunks) {
    if (item.type === 'IHDR') {
      const header = Uint8Array.from(item.data);
      new DataView(header.buffer).setUint32(4, height);
      output.push(chunk('IHDR', header));
    } else if (item.type === 'IDAT') {
      if (!wroteData) output.push(chunk('IDAT', compressed));
      wroteData = true;
    } else output.push(item.raw);
  }
  return { image: concatenate(output), spriteY: metadata.height, positions };
}

/** Backwards-compatible single-tile export retains the supplied RGB pixels. */
export async function appendLogoSprite(baseImage, tilePixels) {
  const { image, spriteY } = await appendLogoSprites(baseImage, [tilePixels]);
  return { image, spriteY };
}

function applyLogoVariants(xml, spriteY, options = {}, variants = null) {
  if (typeof xml !== 'string' || !Number.isSafeInteger(spriteY) || spriteY < 1) throw new TypeError('A valid skin and logo sprite position are required.');
  if (xml.includes(MARKER)) throw new Error('This skin already contains a custom logo.');
  const newline = xml.includes('\r\n') ? '\r\n' : '\n';
  const responsiveAccount = xml.includes('<group name="pureblack_toolbar_account_left"');
  const offset = statusLogoOffset(options);
  const seen = new Set();
  xml = xml.replace(/<group name="applicationbuttons" condition="is_(mac|pc)">[\s\S]*?<\/logo>/g, (native, platform) => {
    if (seen.has(platform)) throw new Error('The native logo group is duplicated.');
    seen.add(platform);
    const { statusX, y } = LOGO_PLACEMENT[platform];
    const x = statusX + offset;
    const visual = (name, left, visibility = '') => (variants || [{ x: 0, y: spriteY }]).map(variant => [
      `<visual name="${name}${variants ? `_theme_${variant.id}` : ''}"${variant.condition ? ` condition="${variant.condition}"` : ''}${visibility ? ` visibility="${visibility}"` : ''}>`,
      `  <pos x="${left}" y="${y}"/>`,
      `  <size width="${LOGO_LIMITS.displayWidth}" height="${LOGO_LIMITS.displayHeight}"/>`,
      `  <off x="${variant.x}" y="${variant.y}" width="${LOGO_LIMITS.tileWidth}" height="${LOGO_LIMITS.tileHeight}"/>`,
      '</visual>',
    ].join(newline)).join(newline);
    const markup = [
      `<!-- ${MARKER} -->`,
      visual('pureblack_custom_logo', x,
        platform === 'mac' && responsiveAccount ? ACCOUNT_NORMAL_VISIBILITY : ''),
      ...(platform === 'mac' && responsiveAccount ? [
        visual('pureblack_custom_logo_account_left', 327 + offset, ACCOUNT_LEFT_VISIBILITY),
      ] : []),
      '<!-- END PURE BLACK CUSTOM LOGO -->',
    ].join(newline);
    return native + newline + markup;
  });
  if (seen.size !== 2) throw new Error('The skin must contain both native logo groups.');
  for (const { statusX } of Object.values(LOGO_PLACEMENT)) {
    const status = `<group name="topbar_status" x="${statusX}" y="8">`;
    if (xml.split(status).length !== 2) throw new Error('The skin status position could not be identified.');
  }
  if (responsiveAccount && xml.split('<group name="topbar_status" x="327" y="8">').length !== 2) {
    throw new Error('The relocated skin status position could not be identified.');
  }
  return xml;
}

/** Backwards-compatible low-level insertion of one untinted sprite tile. */
export function applyLogoXml(xml, spriteY, options = {}) {
  return applyLogoVariants(xml, spriteY, options);
}

export async function addLogoToSkin(xml, baseImage, logo, options = {}, chosenThemes) {
  if (!logo) return { xml, image: baseImage };
  if (chosenThemes === undefined) {
    const { image, spriteY } = await appendLogoSprite(baseImage, logo.tilePixels);
    return { xml: applyLogoXml(xml, spriteY, options), image };
  }
  const themes = normaliseThemes(chosenThemes);
  const tiles = themes.map(theme => tintLogoPixels(logo.tilePixels, logoColour(theme)));
  const { image, spriteY, positions } = await appendLogoSprites(baseImage, tiles);
  // Match the generator's fallback: unknown or stale palette IDs use Default.
  const defaultCondition = themes.slice(1).map(theme =>
    `var_equal '@$pureblackdecktheme' ${theme.id} ? false : `).join('') + 'true';
  const variants = themes.map((theme, index) => ({ ...positions[index], id: theme.id,
    condition: theme.id === 0 ? defaultCondition : `var_equal '@$pureblackdecktheme' ${theme.id}` }));
  return { xml: applyLogoVariants(xml, spriteY, options, variants), image };
}

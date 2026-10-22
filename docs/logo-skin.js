import { inspectPng, pngCrc32, LOGO_LIMITS } from './logo-image.js';
import { ACCOUNT_LEFT_VISIBILITY, ACCOUNT_NORMAL_VISIBILITY } from './toolbar.js';

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

/** Append a tile without decoding/redrawing any original pixel or colour profile. */
export async function appendLogoSprite(baseImage, tilePixels) {
  const metadata = inspectPng(baseImage);
  if (metadata.colorType !== 6 || metadata.bitDepth !== 8 || metadata.interlace !== 0 || metadata.width < LOGO_LIMITS.tileWidth) {
    throw new Error('The skin sprite format does not support a custom logo.');
  }
  if (!(tilePixels instanceof Uint8Array) || tilePixels.length !== LOGO_LIMITS.tileWidth * LOGO_LIMITS.tileHeight * 4) {
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
  const appended = new Uint8Array((metadata.height + LOGO_LIMITS.tileHeight) * stride);
  appended.set(scanlines);
  for (let row = 0; row < LOGO_LIMITS.tileHeight; row++) {
    // Zero is the PNG None filter. Every new row is independent of the old rows.
    appended.set(tilePixels.subarray(row * LOGO_LIMITS.tileWidth * 4, (row + 1) * LOGO_LIMITS.tileWidth * 4),
      (metadata.height + row) * stride + 1);
  }
  const compressed = await transform(appended, true);
  const output = [bytes.subarray(0, 8)];
  let wroteData = false;
  for (const item of chunks) {
    if (item.type === 'IHDR') {
      const header = Uint8Array.from(item.data);
      new DataView(header.buffer).setUint32(4, metadata.height + LOGO_LIMITS.tileHeight);
      output.push(chunk('IHDR', header));
    } else if (item.type === 'IDAT') {
      if (!wroteData) output.push(chunk('IDAT', compressed));
      wroteData = true;
    } else output.push(item.raw);
  }
  return { image: concatenate(output), spriteY: metadata.height };
}

export function applyLogoXml(xml, spriteY) {
  if (typeof xml !== 'string' || !Number.isSafeInteger(spriteY) || spriteY < 1) throw new TypeError('A valid skin and logo sprite position are required.');
  if (xml.includes(MARKER)) throw new Error('This skin already contains a custom logo.');
  const newline = xml.includes('\r\n') ? '\r\n' : '\n';
  const responsiveAccount = xml.includes('<group name="pureblack_toolbar_account_left"');
  const seen = new Set();
  xml = xml.replace(/<group name="applicationbuttons" condition="is_(mac|pc)">[\s\S]*?<\/logo>/g, (native, platform) => {
    if (seen.has(platform)) throw new Error('The native logo group is duplicated.');
    seen.add(platform);
    const { x, y } = LOGO_PLACEMENT[platform];
    const visual = (name, left, visibility = '') => [
      `<visual name="${name}"${visibility ? ` visibility="${visibility}"` : ''}>`,
      `  <pos x="${left}" y="${y}"/>`,
      `  <size width="${LOGO_LIMITS.displayWidth}" height="${LOGO_LIMITS.displayHeight}"/>`,
      `  <off x="0" y="${spriteY}" width="${LOGO_LIMITS.tileWidth}" height="${LOGO_LIMITS.tileHeight}"/>`,
      '</visual>',
    ].join(newline);
    const markup = [
      `<!-- ${MARKER} -->`,
      visual('pureblack_custom_logo', x,
        platform === 'mac' && responsiveAccount ? ACCOUNT_NORMAL_VISIBILITY : ''),
      ...(platform === 'mac' && responsiveAccount ? [
        visual('pureblack_custom_logo_account_left', 670, ACCOUNT_LEFT_VISIBILITY),
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

export async function addLogoToSkin(xml, baseImage, logo) {
  if (!logo) return { xml, image: baseImage };
  const { image, spriteY } = await appendLogoSprite(baseImage, logo.tilePixels);
  return { xml: applyLogoXml(xml, spriteY), image };
}

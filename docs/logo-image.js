export const LOGO_LIMITS = Object.freeze({
  maxBytes: 5 * 1024 * 1024,
  maxDimension: 4096,
  maxPixels: 16_000_000,
  outputWidth: 432,
  outputHeight: 102,
  tileWidth: 72,
  tileHeight: 17,
});

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const DEPTHS = {0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16]};
const CRC_TABLE = Uint32Array.from({length: 256}, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

export function pngCrc32(bytes, start = 0, end = bytes.length) {
  let crc = 0xFFFFFFFF;
  for (let index = start; index < end; index++) crc = CRC_TABLE[(crc ^ bytes[index]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function invalid(detail) {
  throw new Error(`Invalid PNG: ${detail}.`);
}

/** Validate the PNG container; the browser decoder validates compressed pixels. */
export function inspectPng(input) {
  const bytes = input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input) : null;
  if (!bytes) throw new TypeError('PNG data must be a Uint8Array or ArrayBuffer.');
  if (bytes.byteLength > LOGO_LIMITS.maxBytes) throw new Error('Choose a PNG no larger than 5 MiB.');
  if (bytes.length < 8 || SIGNATURE.some((byte, index) => bytes[index] !== byte)) invalid('the file is not a PNG image');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8, header = null, paletteEntries = 0, transparency = false;
  let seenData = false, endedData = false, dataLength = 0, ended = false;
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) invalid('a chunk is truncated');
    const length = view.getUint32(offset);
    if (length > 0x7FFFFFFF || length > bytes.length - offset - 12) invalid('a chunk length is invalid');
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) invalid('a chunk type is invalid');
    const start = offset + 8, end = start + length;
    if (pngCrc32(bytes, offset + 4, end) !== view.getUint32(end)) invalid('a chunk checksum does not match');
    if (!header && type !== 'IHDR') invalid('the image header must be first');
    if (['acTL', 'fcTL', 'fdAT'].includes(type)) throw new Error('Animated PNGs are not supported. Choose a static PNG.');
    if (type === 'IHDR') {
      if (header || length !== 13) invalid('the image header is malformed');
      const width = view.getUint32(start), height = view.getUint32(start + 4);
      const bitDepth = bytes[start + 8], colorType = bytes[start + 9];
      const compression = bytes[start + 10], filter = bytes[start + 11], interlace = bytes[start + 12];
      if (!width || !height) invalid('image dimensions must be greater than zero');
      if (width > LOGO_LIMITS.maxDimension || height > LOGO_LIMITS.maxDimension || width * height > LOGO_LIMITS.maxPixels) {
        throw new Error('Choose a PNG up to 4096 pixels per side and 16 megapixels in total.');
      }
      if (!DEPTHS[colorType]?.includes(bitDepth) || compression !== 0 || filter !== 0 || interlace > 1) {
        invalid('the image header uses unsupported or invalid values');
      }
      header = {width, height, bitDepth, colorType, interlace};
    } else if (type === 'PLTE') {
      if (paletteEntries || seenData || transparency || !length || length % 3 || length > 768 || [0, 4].includes(header.colorType)) {
        invalid('the colour palette is malformed or out of order');
      }
      paletteEntries = length / 3;
      if (header.colorType === 3 && paletteEntries > 2 ** header.bitDepth) invalid('the colour palette exceeds the bit depth');
    } else if (type === 'tRNS') {
      if (transparency || seenData || [4, 6].includes(header.colorType)) invalid('transparency is malformed or out of order');
      if (header.colorType === 3) {
        if (!paletteEntries || !length || length > paletteEntries) invalid('palette transparency is malformed');
      } else {
        const expected = header.colorType === 0 ? 2 : 6;
        if (length !== expected) invalid('transparency is malformed');
        for (let index = start; index < end; index += 2) {
          if (view.getUint16(index) >= 2 ** header.bitDepth) invalid('a transparent sample exceeds the bit depth');
        }
      }
      transparency = true;
    } else if (type === 'IDAT') {
      if (endedData || (header.colorType === 3 && !paletteEntries)) invalid('image data is out of order or lacks its palette');
      seenData = true; dataLength += length;
    } else if (type === 'IEND') {
      if (length || !seenData || !dataLength || end + 4 !== bytes.length) invalid('the image ending is malformed');
      ended = true;
    } else if (type[0] === type[0].toUpperCase()) {
      invalid('an unsupported critical chunk is present');
    }
    if (seenData && type !== 'IDAT') endedData = true;
    offset = end + 4;
  }
  if (!header || !ended) invalid('the image is incomplete');
  return {...header, hasTransparencyChannel: [4, 6].includes(header.colorType) || transparency};
}

async function decodePng(bytes) {
  const blob = new Blob([bytes], {type: 'image/png'});
  try {
    if (typeof createImageBitmap === 'function') return await createImageBitmap(blob, {imageOrientation: 'none'});
    const url = URL.createObjectURL(blob);
    try {
      return await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    throw new Error('The PNG image could not be decoded. Choose a valid PNG.');
  }
}

function canvas(width, height, readPixels = false) {
  const element = document.createElement('canvas');
  element.width = width; element.height = height;
  const context = element.getContext('2d', {willReadFrequently: readPixels});
  if (!context) throw new Error('This browser could not prepare the logo image.');
  return {element, context};
}

function fittedCanvas(source, width, height, readPixels = false) {
  const output = canvas(width, height, readPixels);
  const scale = Math.min(width / source.width, height / source.height);
  const drawWidth = source.width * scale, drawHeight = source.height * scale;
  output.context.imageSmoothingEnabled = true;
  output.context.imageSmoothingQuality = 'high';
  output.context.drawImage(source, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  return output;
}

/** Decode and re-encode locally, fitting a transparent PNG into the native box. */
export async function prepareLogo(file) {
  if (!file || typeof file.arrayBuffer !== 'function' || !Number.isFinite(file.size) || file.size <= 0) {
    throw new Error('Choose a PNG image file.');
  }
  if (file.size > LOGO_LIMITS.maxBytes) throw new Error('Choose a PNG no larger than 5 MiB.');
  const input = new Uint8Array(await file.arrayBuffer());
  const info = inspectPng(input);
  const decoded = await decodePng(input);
  try {
    if ((decoded.naturalWidth ?? decoded.width) !== info.width || (decoded.naturalHeight ?? decoded.height) !== info.height) {
      throw new Error('The decoded PNG dimensions do not match its header.');
    }
    const source = canvas(info.width, info.height, true);
    source.context.drawImage(decoded, 0, 0);
    const pixels = source.context.getImageData(0, 0, info.width, info.height).data;
    let visible = false, transparent = false;
    for (let index = 3; index < pixels.length && !(visible && transparent); index += 4) {
      visible ||= pixels[index] > 0;
      transparent ||= pixels[index] < 255;
    }
    if (!visible) throw new Error('This PNG is fully transparent. Choose an image with a visible logo.');
    if (!transparent) throw new Error('This PNG has no transparent background. Choose a PNG with transparency.');

    const width = LOGO_LIMITS.outputWidth, height = LOGO_LIMITS.outputHeight;
    const output = fittedCanvas(source.element, width, height);
    const tile = fittedCanvas(source.element, LOGO_LIMITS.tileWidth, LOGO_LIMITS.tileHeight, true);
    const tilePixels = new Uint8Array(tile.context.getImageData(0, 0, LOGO_LIMITS.tileWidth, LOGO_LIMITS.tileHeight).data);
    if (!tilePixels.some((value, index) => index % 4 === 3 && value > 0)) {
      throw new Error('This logo becomes invisible at toolbar size. Choose a less narrow or more visible image.');
    }
    const dataUrl = output.element.toDataURL('image/png');
    if (!dataUrl.startsWith('data:image/png;base64,')) throw new Error('This browser could not encode the logo as PNG.');
    const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), character => character.charCodeAt(0));
    inspectPng(bytes);
    return {bytes, dataUrl, tilePixels, width, height, originalWidth: info.width, originalHeight: info.height,
      fileName: typeof file.name === 'string' ? file.name : 'logo.png'};
  } finally {
    decoded.close?.();
  }
}

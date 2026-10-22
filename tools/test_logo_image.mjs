import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { inspectPng, prepareLogo, pngCrc32, LOGO_LIMITS } from '../docs/logo-image.js';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(type, data = Buffer.alloc(0)) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xFFFFFFFF;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1;
  }
  const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xFFFFFFFF) >>> 0);
  return Buffer.concat([size, body, checksum]);
}
function header({width = 2, height = 1, bitDepth = 8, colorType = 6, compression = 0, filter = 0, interlace = 0} = {}) {
  const bytes = Buffer.alloc(13);
  bytes.writeUInt32BE(width, 0); bytes.writeUInt32BE(height, 4);
  bytes.set([bitDepth, colorType, compression, filter, interlace], 8);
  return chunk('IHDR', bytes);
}
const rgba = deflateSync(Buffer.from([0, 255, 0, 0, 255, 0, 0, 0, 0]));
const png = (options = {}, before = [], after = []) => Buffer.concat([
  signature, header(options), ...before, chunk('IDAT', rgba), ...after, chunk('IEND'),
]);

test('shared PNG CRC helper matches the standard test vector and slice bounds', () => {
  assert.equal(pngCrc32(Buffer.from('123456789')), 0xCBF43926);
  assert.equal(pngCrc32(Buffer.from('xx123456789yy'), 2, 11), 0xCBF43926);
});

test('PNG structure accepts actual RGBA and indexed transparency, including offset views', () => {
  const bytes = png();
  assert.deepEqual(inspectPng(bytes), {width: 2, height: 1, bitDepth: 8, colorType: 6, interlace: 0, hasTransparencyChannel: true});
  const padded = Buffer.concat([Buffer.from('prefix'), bytes, Buffer.from('suffix')]);
  assert.equal(inspectPng(padded.subarray(6, 6 + bytes.length)).width, 2);
  assert.equal(inspectPng(Uint8Array.from(bytes).buffer).height, 1);
  const indexed = Buffer.concat([signature, header({colorType: 3, bitDepth: 1}),
    chunk('PLTE', Buffer.from([255, 0, 0, 0, 0, 0])), chunk('tRNS', Buffer.from([255, 0])),
    chunk('IDAT', deflateSync(Buffer.from([0, 0b01000000]))), chunk('IEND')]);
  assert.equal(inspectPng(indexed).hasTransparencyChannel, true);
  assert.equal(inspectPng(png({colorType: 2})).hasTransparencyChannel, false);
});

test('PNG parser rejects disguised, oversized, truncated and checksum-corrupt files', () => {
  for (const bytes of [Buffer.from('<svg/>'), Buffer.from('not a PNG'), png().subarray(0, 7)]) {
    assert.throws(() => inspectPng(bytes), /not a PNG/);
  }
  assert.throws(() => inspectPng('image.png'), /Uint8Array/);
  assert.throws(() => inspectPng(Buffer.alloc(LOGO_LIMITS.maxBytes + 1)), /5 MiB/);
  for (const length of [8, 12, 30, png().length - 1]) assert.throws(() => inspectPng(png().subarray(0, length)), /Invalid PNG/);
  const corrupt = png(); corrupt[corrupt.length - 1] ^= 1;
  assert.throws(() => inspectPng(corrupt), /checksum/);
  const badLength = png(); badLength.writeUInt32BE(0xFFFFFFFF, 8);
  assert.throws(() => inspectPng(badLength), /chunk length/);
  assert.throws(() => inspectPng(Buffer.concat([png(), Buffer.from('extra')])), /ending/);
});

test('PNG dimensions and IHDR combinations are bounded and valid', () => {
  for (const dimensions of [{width: 0}, {height: 0}, {width: 4097}, {height: 4097}, {width: 4096, height: 4096}]) {
    assert.throws(() => inspectPng(png(dimensions)), /dimensions|4096/);
  }
  assert.equal(inspectPng(png({width: 4000, height: 4000})).width, 4000);
  for (const options of [{bitDepth: 7}, {colorType: 1}, {colorType: 2, bitDepth: 4}, {colorType: 3, bitDepth: 16},
    {compression: 1}, {filter: 1}, {interlace: 2}]) {
    assert.throws(() => inspectPng(png(options)), /image header/);
  }
  assert.equal(inspectPng(png({interlace: 1})).interlace, 1);
  assert.throws(() => inspectPng(png({}, [header()])), /image header/);
  assert.throws(() => inspectPng(Buffer.concat([signature, chunk('IHDR', Buffer.alloc(12)), chunk('IEND')])), /image header/);
});

test('PNG ordering, required data and animation chunks are checked', () => {
  for (const type of ['acTL', 'fcTL', 'fdAT']) assert.throws(() => inspectPng(png({}, [chunk(type)])), /Animated PNG/);
  assert.throws(() => inspectPng(Buffer.concat([signature, chunk('tEXt'), header(), chunk('IEND')])), /header must be first/);
  assert.throws(() => inspectPng(png({}, [chunk('ABCD')])), /critical chunk/);
  assert.throws(() => inspectPng(png({}, [chunk('abca')])), /chunk type/);
  assert.throws(() => inspectPng(Buffer.concat([signature, header(), chunk('IEND')])), /ending/);
  assert.throws(() => inspectPng(Buffer.concat([signature, header(), chunk('IDAT'), chunk('IEND')])), /ending/);
  assert.throws(() => inspectPng(png({}, [], [chunk('tEXt'), chunk('IDAT', rgba)])), /image data is out of order/);
  assert.throws(() => inspectPng(png().subarray(0, png().length - 12)), /incomplete/);
  assert.equal(inspectPng(png({}, [chunk('tEXt', Buffer.from('Comment\0test'))])).width, 2);
});

test('PNG palette and transparency chunks must match their colour type and depth', () => {
  const palette = chunk('PLTE', Buffer.from([255, 0, 0, 0, 0, 0]));
  assert.throws(() => inspectPng(png({colorType: 3})), /lacks its palette/);
  assert.throws(() => inspectPng(png({colorType: 0}, [palette])), /colour palette/);
  assert.throws(() => inspectPng(png({colorType: 3}, [chunk('PLTE', Buffer.alloc(4))])), /colour palette/);
  assert.throws(() => inspectPng(png({colorType: 3, bitDepth: 1}, [chunk('PLTE', Buffer.alloc(9))])), /bit depth/);
  assert.throws(() => inspectPng(png({colorType: 3}, [chunk('tRNS', Buffer.from([0]))])), /palette transparency/);
  assert.throws(() => inspectPng(png({colorType: 3}, [palette, chunk('tRNS', Buffer.alloc(3))])), /palette transparency/);
  assert.throws(() => inspectPng(png({}, [chunk('tRNS', Buffer.alloc(6))])), /transparency/);
  assert.throws(() => inspectPng(png({colorType: 0}, [chunk('tRNS', Buffer.from([1, 0]))])), /transparent sample/);
  assert.throws(() => inspectPng(png({colorType: 2}, [], [chunk('tRNS', Buffer.alloc(6))])), /transparency/);
  assert.equal(inspectPng(png({colorType: 0}, [chunk('tRNS', Buffer.from([0, 0]))])).hasTransparencyChannel, true);
});

test('file limits are enforced before reading or decoding', async () => {
  let read = false;
  await assert.rejects(prepareLogo({size: LOGO_LIMITS.maxBytes + 1, arrayBuffer() { read = true; }}), /5 MiB/);
  assert.equal(read, false);
  await assert.rejects(prepareLogo({size: 0, arrayBuffer() { read = true; }}), /PNG image file/);
  await assert.rejects(prepareLogo({name: 'fake.png', type: 'image/png', size: 6, async arrayBuffer() { return Buffer.from('<svg/>'); }}), /not a PNG/);
  assert.equal(read, false);
});

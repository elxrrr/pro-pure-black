import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { deflateSync, inflateSync } from 'node:zlib';
import { addLogoToSkin, appendLogoSprite, applyLogoXml } from '../docs/logo-skin.js';

const sprite = new Uint8Array(await readFile(new URL('../docs/assets/gfx-pro.png', import.meta.url)));
const sourceXml = await readFile(new URL('../docs/assets/Pro.xml', import.meta.url), 'utf8');
const tile = Uint8Array.from({length: 72 * 17 * 4}, (_, index) => {
  const channel = index % 4, pixel = Math.floor(index / 4);
  return channel === 3 ? (pixel % 3 === 0 ? 0 : 255) : (pixel * (channel + 1) + 37) % 256;
});

// Independent PNG chunk/CRC and zlib checks avoid testing the writer with its
// own parser or checksum implementation.
function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length); output.write(type, 4, 4, 'ascii');
  output.set(data, 8); output.writeUInt32BE(crc32(output.subarray(4, -4)), output.length - 4);
  return output;
}

function parsePng(input) {
  const bytes = Buffer.from(input);
  assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const chunks = [];
  let offset = 8;
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length);
    const length = bytes.readUInt32BE(offset), end = offset + length + 12;
    assert.ok(end <= bytes.length);
    const raw = bytes.subarray(offset, end), type = raw.toString('ascii', 4, 8);
    assert.equal(crc32(raw.subarray(4, -4)), raw.readUInt32BE(raw.length - 4), `${type} CRC`);
    chunks.push({type, data: raw.subarray(8, -4), raw});
    offset = end;
  }
  assert.equal(chunks.at(-1).type, 'IEND');
  assert.equal(chunks.at(-1).data.length, 0);
  const header = chunks[0].data;
  return {chunks, width: header.readUInt32BE(0), height: header.readUInt32BE(4),
    scanlines: () => inflateSync(Buffer.concat(chunks.filter(item => item.type === 'IDAT').map(item => item.data)))};
}

function replaceChunk(type, replacement) {
  const source = parsePng(sprite);
  return Buffer.concat([Buffer.from(sprite.subarray(0, 8)), ...source.chunks.map(item => item.type === type ? replacement(item.data) : item.raw)]);
}

test('without a custom logo export preserves the exact XML and sprite object', async () => {
  for (const logo of [null, undefined]) {
    const result = await addLogoToSkin(sourceXml, sprite, logo);
    assert.equal(result.xml, sourceXml);
    assert.equal(result.image, sprite);
  }
});

test('appended logo preserves every original scanline and ancillary chunk', async () => {
  // Buffer.slice aliases memory; this input also catches accidental IHDR writes
  // through a view while ordinary Uint8Array inputs are covered below.
  const input = Buffer.from(sprite), originalBytes = Buffer.from(input), originalTile = tile.slice();
  const original = parsePng(sprite);
  assert.equal(original.height, 428);
  const result = await appendLogoSprite(input, tile);
  const output = parsePng(result.image);
  assert.equal(result.spriteY, 428);
  assert.equal(output.width, original.width);
  assert.equal(output.height, 445);
  assert.deepEqual(output.chunks[0].data.subarray(8), original.chunks[0].data.subarray(8), 'Pixel format is unchanged');
  const ancillary = png => png.chunks.filter(item => item.type[0] === item.type[0].toLowerCase()).map(item => item.raw);
  assert.ok(ancillary(original).length > 0, 'The real sprite contains metadata to preserve');
  assert.deepEqual(ancillary(output), ancillary(original));
  assert.deepEqual(output.chunks.map(item => item.type), original.chunks.map(item => item.type));
  const before = original.scanlines(), after = output.scanlines();
  const stride = output.width * 4 + 1;
  assert.equal(after.length, output.height * stride);
  assert.deepEqual(after.subarray(0, before.length), before, 'Original filtered scanlines remain byte-for-byte intact');
  for (let row = 0; row < 17; row++) {
    const start = before.length + row * stride;
    assert.equal(after[start], 0, 'New rows use the independent None filter');
    assert.deepEqual(after.subarray(start + 1, start + 1 + 72 * 4), Buffer.from(tile.subarray(row * 72 * 4, (row + 1) * 72 * 4)));
    assert.ok(after.subarray(start + 1 + 72 * 4, start + stride).every(byte => byte === 0), 'Rest of each new row stays transparent');
  }
  assert.deepEqual(input, originalBytes);
  assert.deepEqual(tile, originalTile);
});

test('logo XML retains native logos, CRLF and all unrelated skin content', () => {
  const result = applyLogoXml(sourceXml, 428);
  const nativeLogos = xml => [...xml.matchAll(/<logo>[\s\S]*?<\/logo>/g)].map(match => match[0]);
  assert.equal(nativeLogos(sourceXml).length, 2);
  assert.deepEqual(nativeLogos(result), nativeLogos(sourceXml));
  assert.ok(sourceXml.includes('\r\n'));
  assert.ok(!/(?<!\r)\n/.test(result), 'No bare LF inserted into CRLF source');
  const additions = [...result.matchAll(/<!-- BEGIN PURE BLACK CUSTOM LOGO -->[\s\S]*?<!-- END PURE BLACK CUSTOM LOGO -->/g)].map(match => match[0]);
  assert.equal(additions.length, 2);
  for (const [index, x] of [182, 92].entries()) {
    assert.match(additions[index], /<visual name="pureblack_custom_logo">/);
    assert.ok(additions[index].includes(`<pos x="${x}" y="13"/>`));
    assert.match(additions[index], /<size width="72" height="17"\/>/);
    assert.match(additions[index], /<off x="0" y="428"\/>/);
  }
  assert.equal(result.split('<group name="topbar_status" x="276" y="8">').length - 1, 1);
  assert.equal(result.split('<group name="topbar_status" x="181" y="8">').length - 1, 1);
  const restored = result.replace(/\r\n<!-- BEGIN PURE BLACK CUSTOM LOGO -->[\s\S]*?<!-- END PURE BLACK CUSTOM LOGO -->/g, '')
    .replace('<group name="topbar_status" x="276" y="8">', '<group name="topbar_status" x="195" y="8">')
    .replace('<group name="topbar_status" x="181" y="8">', '<group name="topbar_status" x="100" y="8">');
  assert.equal(restored, sourceXml);
  const lf = applyLogoXml(sourceXml.replaceAll('\r\n', '\n'), 428);
  assert.ok(!lf.includes('\r'));
});

test('combined logo export points both native visuals at the appended tile', async () => {
  const result = await addLogoToSkin(sourceXml, sprite, {tilePixels: tile});
  assert.equal(parsePng(result.image).height, 445);
  assert.equal(result.xml.match(/<off x="0" y="428"\/>/g).length, 2);
  assert.equal(result.xml.match(/BEGIN PURE BLACK CUSTOM LOGO/g).length, 2);
});

test('sprite writer rejects invalid, unsupported and incomplete input', async () => {
  await assert.rejects(appendLogoSprite(Buffer.from('not PNG'), tile), /not a PNG/);
  for (const invalid of [null, [], new Uint8Array(72 * 17 * 4 - 1)]) {
    await assert.rejects(appendLogoSprite(sprite, invalid), /prepared 72 × 17 RGBA tile/);
  }
  for (const [offset, value] of [[8, 16], [9, 2], [12, 1]]) {
    const unsupported = replaceChunk('IHDR', data => { const header = Buffer.from(data); header[offset] = value; return chunk('IHDR', header); });
    await assert.rejects(appendLogoSprite(unsupported, tile), /sprite format/);
  }
  const narrow = replaceChunk('IHDR', data => { const header = Buffer.from(data); header.writeUInt32BE(71); return chunk('IHDR', header); });
  await assert.rejects(appendLogoSprite(narrow, tile), /sprite format/);
  const incomplete = replaceChunk('IDAT', () => chunk('IDAT', deflateSync(Buffer.from([0, 1, 2]))));
  await assert.rejects(appendLogoSprite(incomplete, tile), /image data is incomplete/);
  const damaged = sprite.slice(); damaged[damaged.length - 1] ^= 1;
  await assert.rejects(appendLogoSprite(damaged, tile), /checksum/);
});

test('logo XML rejects duplicate, missing and invalid inputs', () => {
  const configured = applyLogoXml(sourceXml, 428);
  assert.throws(() => applyLogoXml(configured, 428), /already contains a custom logo/);
  for (const invalid of [0, -1, 2.5, Infinity, NaN, '428']) assert.throws(() => applyLogoXml(sourceXml, invalid), /valid skin/);
  assert.throws(() => applyLogoXml(null, 428), /valid skin/);
  assert.throws(() => applyLogoXml(sourceXml.replace('condition="is_pc"', 'condition="is_other"'), 428), /both native logo groups/);
  const nativeMac = sourceXml.match(/<group name="applicationbuttons" condition="is_mac">[\s\S]*?<\/logo>/)[0];
  assert.throws(() => applyLogoXml(sourceXml + nativeMac, 428), /native logo group is duplicated/);
  assert.throws(() => applyLogoXml(sourceXml.replace('name="topbar_status" x="195"', 'name="topbar_status" x="196"'), 428), /status position/);
  assert.throws(() => applyLogoXml(sourceXml + '<group name="topbar_status" x="100" y="8">', 428), /status position/);
});

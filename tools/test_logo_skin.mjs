import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { deflateSync, inflateSync } from 'node:zlib';
import { addLogoToSkin, appendLogoSprite, appendLogoSprites, applyLogoXml } from '../docs/logo-skin.js';
import { applyToolbar } from '../docs/toolbar.js';
import { generateSkinXml } from '../docs/generator.js';
import { DEFAULT_LOGO_COLOUR, logoColour, tintLogoPixels } from '../docs/logo-colour.js';

const sprite = new Uint8Array(await readFile(new URL('../docs/assets/gfx-pro.png', import.meta.url)));
const sourceXml = await readFile(new URL('../docs/assets/Pro.xml', import.meta.url), 'utf8');
const themes = JSON.parse(await readFile(new URL('../themes.json', import.meta.url), 'utf8'));
const tile = Uint8Array.from({length: 144 * 34 * 4}, (_, index) => {
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
  assert.equal(output.height, 462);
  assert.deepEqual(output.chunks[0].data.subarray(8), original.chunks[0].data.subarray(8), 'Pixel format is unchanged');
  const ancillary = png => png.chunks.filter(item => item.type[0] === item.type[0].toLowerCase()).map(item => item.raw);
  assert.ok(ancillary(original).length > 0, 'The real sprite contains metadata to preserve');
  assert.deepEqual(ancillary(output), ancillary(original));
  assert.deepEqual(output.chunks.map(item => item.type), original.chunks.map(item => item.type));
  const before = original.scanlines(), after = output.scanlines();
  const stride = output.width * 4 + 1;
  assert.equal(after.length, output.height * stride);
  assert.deepEqual(after.subarray(0, before.length), before, 'Original filtered scanlines remain byte-for-byte intact');
  for (let row = 0; row < 34; row++) {
    const start = before.length + row * stride;
    assert.equal(after[start], 0, 'New rows use the independent None filter');
    assert.deepEqual(after.subarray(start + 1, start + 1 + 144 * 4), Buffer.from(tile.subarray(row * 144 * 4, (row + 1) * 144 * 4)));
    assert.ok(after.subarray(start + 1 + 144 * 4, start + stride).every(byte => byte === 0), 'Rest of each new row stays transparent');
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
  for (const [index, x] of [554, 459].entries()) {
    assert.match(additions[index], /<visual name="pureblack_custom_logo">/);
    assert.ok(additions[index].includes(`<pos x="${x}" y="13"/>`));
    assert.match(additions[index], /<size width="72" height="17"\/>/);
    assert.match(additions[index], /<off x="0" y="428" width="144" height="34"\/>/);
  }
  assert.equal(result.split('<group name="topbar_status" x="195" y="8">').length - 1, 1);
  assert.equal(result.split('<group name="topbar_status" x="100" y="8">').length - 1, 1);
  const restored = result.replace(/\r\n<!-- BEGIN PURE BLACK CUSTOM LOGO -->[\s\S]*?<!-- END PURE BLACK CUSTOM LOGO -->/g, '');
  assert.equal(restored, sourceXml);
  const lf = applyLogoXml(sourceXml.replaceAll('\r\n', '\n'), 428);
  assert.ok(!lf.includes('\r'));
});

test('combined logo export scales the 2× tile to the native logo bounds on both platforms', async () => {
  const result = await addLogoToSkin(sourceXml, sprite, {tilePixels: tile});
  assert.equal(parsePng(result.image).height, 462);
  assert.equal(result.xml.match(/<off x="0" y="428" width="144" height="34"\/>/g).length, 2);
  assert.equal(result.xml.match(/BEGIN PURE BLACK CUSTOM LOGO/g).length, 2);
  for (const platform of ['mac', 'pc']) {
    const group = result.xml.match(new RegExp(`<group name="applicationbuttons" condition="is_${platform}">[\\s\\S]*?<!-- END PURE BLACK CUSTOM LOGO -->`))[0];
    const nativeSize = group.match(/<logo>[\s\S]*?(<size[^>]*\/>)/)[1];
    const customSize = group.match(/<visual name="pureblack_custom_logo">[\s\S]*?(<size[^>]*\/>)/)[1];
    assert.equal(customSize, nativeSize, `${platform}: custom and native logo display bounds must match`);
  }
});

test('custom logo follows the responsive Mac status block without moving the Windows logo', () => {
  for (const options of [{account: true}, {account: true, sandbox: true, scheduler: true, shoutout: true}]) {
    const toolbar = applyToolbar(sourceXml, options);
    const result = applyLogoXml(toolbar, 428);
    assert.ok(!/(?<!\r)\n/.test(result), 'Responsive markup preserves CRLF');
    const additions = [...result.matchAll(/<!-- BEGIN PURE BLACK CUSTOM LOGO -->[\s\S]*?<!-- END PURE BLACK CUSTOM LOGO -->/g)].map(match => match[0]);
    assert.equal(additions.length, 2);
    const macVisuals = [...additions[0].matchAll(/<visual[^>]*>[\s\S]*?<\/visual>/g)].map(match => match[0]);
    assert.equal(macVisuals.length, 2);
    assert.ok(macVisuals[0].includes(`visibility="has_notch ? true : maximize 'fullscreen' ? true : skin_width && param_bigger 1500"`));
    assert.ok(macVisuals[0].includes('<pos x="554" y="13"/>'));
    assert.ok(macVisuals[1].includes(`visibility="has_notch ? false : maximize 'fullscreen' ? false : skin_width && param_smaller 1501"`));
    assert.ok(macVisuals[1].includes('<pos x="686" y="13"/>'));
    for (const visual of macVisuals) {
      assert.ok(visual.includes('<size width="72" height="17"/>'));
      assert.ok(visual.includes('<off x="0" y="428" width="144" height="34"/>'));
    }
    assert.equal((additions[1].match(/<visual/g) || []).length, 1);
    assert.ok(additions[1].includes('<pos x="459" y="13"/>'));
    assert.ok(!additions[1].includes('visibility='));
    for (const x of [195, 327, 100]) {
      assert.equal(result.split(`<group name="topbar_status" x="${x}" y="8">`).length - 1, 1);
    }
    const restored = result.replace(/\r\n<!-- BEGIN PURE BLACK CUSTOM LOGO -->[\s\S]*?<!-- END PURE BLACK CUSTOM LOGO -->/g, '');
    assert.equal(restored, toolbar, 'Logo insertion leaves all toolbar branches and native logos intact');
  }
  const noAccount = applyLogoXml(applyToolbar(sourceXml, {account: false, sandbox: true}), 428);
  assert.ok(!noAccount.includes('name="pureblack_custom_logo_account_left"'));
  assert.equal((noAccount.match(/<off x="0" y="428" width="144" height="34"\/>/g) || []).length, 2);
});

test('sprite writer rejects invalid, unsupported and incomplete input', async () => {
  await assert.rejects(appendLogoSprite(Buffer.from('not PNG'), tile), /not a PNG/);
  for (const invalid of [null, [], new Uint8Array(144 * 34 * 4 - 1)]) {
    await assert.rejects(appendLogoSprite(sprite, invalid), /prepared 144 × 34 RGBA tile/);
  }
  for (const [offset, value] of [[8, 16], [9, 2], [12, 1]]) {
    const unsupported = replaceChunk('IHDR', data => { const header = Buffer.from(data); header[offset] = value; return chunk('IHDR', header); });
    await assert.rejects(appendLogoSprite(unsupported, tile), /sprite format/);
  }
  const narrow = replaceChunk('IHDR', data => { const header = Buffer.from(data); header.writeUInt32BE(143); return chunk('IHDR', header); });
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
  const responsive = applyToolbar(sourceXml, {account: true});
  assert.throws(() => applyLogoXml(responsive.replace('name="topbar_status" x="327"', 'name="topbar_status" x="328"'), 428), /relocated skin status position/);
  assert.throws(() => applyLogoXml(responsive + '<group name="topbar_status" x="327" y="8">', 428), /relocated skin status position/);
});

test('logo tint uses Default grey or deck A and retains every alpha byte without mutation', () => {
  assert.equal(DEFAULT_LOGO_COLOUR, '#959595');
  assert.equal(logoColour(themes[0]), '#959595');
  assert.equal(logoColour(), '#959595');
  assert.equal(logoColour({ slug: 'custom', colors: ['#e98db6'] }), '#E98DB6');
  assert.equal(logoColour(themes.at(-1)), themes.at(-1).colors[0]);
  const pixels = Buffer.from(Array.from({ length: 256 }, (_, alpha) => [255, 127, 32, alpha]).flat());
  const before = Buffer.from(pixels);
  const tinted = tintLogoPixels(pixels, '#95a5b5');
  assert.ok(tinted instanceof Uint8Array);
  assert.notEqual(tinted.buffer, pixels.buffer);
  for (let alpha = 0; alpha < 256; alpha++) {
    assert.deepEqual([...tinted.subarray(alpha * 4, alpha * 4 + 4)], [149, 165, 181, alpha]);
  }
  assert.deepEqual(pixels, before);
  for (const invalid of [null, [], new Uint8Array(3)]) assert.throws(() => tintLogoPixels(invalid, '#959595'), /RGBA/);
  for (const invalid of ['red', '#fff', '#GGGGGG', null]) {
    assert.throws(() => tintLogoPixels(pixels, invalid), /six-digit/);
    assert.throws(() => logoColour({ slug: 'custom', colors: [invalid] }), /six-digit/);
  }
});

test('multiple logo tiles wrap after thirteen columns and preserve original pixels and metadata', async () => {
  const original = parsePng(sprite);
  assert.equal(original.width, 1920);
  const tiles = Array.from({ length: 14 }, (_, index) => Uint8Array.from(tile,
    (value, channel) => channel % 4 === 3 ? (channel + index) % 256 : (value + index * 17) % 256));
  const input = Buffer.from(sprite), originalBytes = Buffer.from(input);
  const result = await appendLogoSprites(input, tiles);
  const output = parsePng(result.image);
  assert.equal(output.height, 496);
  assert.equal(output.width, original.width);
  assert.deepEqual(result.positions, Array.from({ length: 14 }, (_, index) => ({ x: index % 13 * 144, y: 428 + Math.floor(index / 13) * 34 })));
  const before = original.scanlines(), after = output.scanlines(), stride = 1920 * 4 + 1;
  assert.deepEqual(after.subarray(0, before.length), before);
  const ancillary = png => png.chunks.filter(item => !['IHDR', 'IDAT'].includes(item.type)).map(item => item.raw);
  assert.deepEqual(ancillary(output), ancillary(original));
  assert.deepEqual(input, originalBytes);
  for (const [index, expected] of tiles.entries()) {
    const { x, y } = result.positions[index];
    for (let row = 0; row < 34; row++) {
      const start = (y + row) * stride + 1 + x * 4;
      assert.deepEqual(after.subarray(start, start + 144 * 4), Buffer.from(expected.subarray(row * 144 * 4, (row + 1) * 144 * 4)));
    }
  }
  for (let y = 428; y < 496; y++) {
    assert.equal(after[y * stride], 0, 'Appended scanlines use the None filter');
    const used = y < 462 ? 13 * 144 : 144;
    assert.ok(after.subarray(y * stride + 1 + used * 4, (y + 1) * stride).every(value => value === 0));
  }
  await assert.rejects(appendLogoSprites(sprite, []), /prepared 144/);
  await assert.rejects(appendLogoSprites(sprite, [tile, new Uint8Array(3)]), /prepared 144/);
});

function paletteQuery(query, selected) {
  if (query === 'true' || query === 'false') return query === 'true';
  const match = query.match(/^var_equal '@\$pureblackdecktheme' (\d+)(?: \? (true|false) : (.*))?$/);
  assert.ok(match, `Unexpected palette query: ${query}`);
  const matches = Number(match[1]) === selected;
  return match[2] ? (matches ? match[2] === 'true' : paletteQuery(match[3], selected)) : matches;
}

test('selected palettes and custom colours get reindexed tinted logo tiles with an exclusive Default fallback', async () => {
  const selected = [themes[0], themes.at(-1), { id: 999, name: 'My Custom', slug: 'custom', colors: ['#f2c48f', '#AABBCC', '#C090D0', '#80C0A0'] }];
  const options = { account: true, master: true, cpu: false, battery: false, clock: true };
  const prepared = applyToolbar(generateSkinXml(sourceXml, selected), options);
  const alphaTile = Uint8Array.from(tile, (value, index) => index % 4 === 3 ? Math.floor(index / 4) % 256 : 255);
  const originalTile = alphaTile.slice();
  const result = await addLogoToSkin(prepared, sprite, { tilePixels: alphaTile }, options, selected);
  const output = parsePng(result.image), pixels = output.scanlines(), stride = output.width * 4 + 1;
  const expectedColours = ['#959595', themes.at(-1).colors[0], '#F2C48F'];
  assert.equal(output.height, 462);
  for (const [index, colour] of expectedColours.entries()) {
    const rgb = [1, 3, 5].map(offset => Number.parseInt(colour.slice(offset, offset + 2), 16));
    for (let pixel = 0; pixel < 144 * 34; pixel++) {
      const x = index * 144 + pixel % 144, y = 428 + Math.floor(pixel / 144);
      assert.deepEqual([...pixels.subarray(y * stride + 1 + x * 4, y * stride + 1 + x * 4 + 4)], [...rgb, alphaTile[pixel * 4 + 3]]);
    }
  }
  assert.deepEqual(alphaTile, originalTile);
  assert.deepEqual(pixels.subarray(0, 428 * stride), parsePng(sprite).scanlines());
  assert.ok(!/(?<!\r)\n/.test(result.xml));
  const additions = [...result.xml.matchAll(/<!-- BEGIN PURE BLACK CUSTOM LOGO -->[\s\S]*?<!-- END PURE BLACK CUSTOM LOGO -->/g)].map(match => match[0]);
  assert.equal(additions.length, 2);
  for (const [index, markup] of additions.entries()) {
    const visuals = [...markup.matchAll(/<visual name="([^"]+)" condition="([^"]+)"[^>]*>[\s\S]*?<\/visual>/g)];
    assert.equal(visuals.length, index === 0 ? 6 : 3);
    const names = index === 0 ? ['pureblack_custom_logo', 'pureblack_custom_logo_account_left'] : ['pureblack_custom_logo'];
    for (const name of names) {
      const branch = visuals.filter(visual => visual[1].startsWith(`${name}_theme_`));
      assert.equal(branch.length, 3);
      for (const [id, visual] of branch.entries()) {
        assert.equal(visual[1], `${name}_theme_${id}`);
        assert.ok(visual[0].includes(`<off x="${id * 144}" y="428" width="144" height="34"/>`));
        const x = index === 1 ? 359 : name.endsWith('account_left') ? 586 : 454;
        assert.ok(visual[0].includes(`<pos x="${x}" y="13"/>`));
        if (index === 0) assert.ok(visual[0].includes('visibility="has_notch ?'), 'Responsive placement remains independent of palette selection');
      }
      for (const chosen of [undefined, -1, 0, 1, 2, themes.at(-1).id, 999]) {
        const active = branch.filter(visual => paletteQuery(visual[2], chosen));
        assert.equal(active.length, 1, 'Exactly one tint is visible even for stale palette state');
        assert.equal(active[0][1], `${name}_theme_${chosen === 1 || chosen === 2 ? chosen : 0}`);
      }
    }
  }
  const restored = result.xml.replace(/\r\n<!-- BEGIN PURE BLACK CUSTOM LOGO -->[\s\S]*?<!-- END PURE BLACK CUSTOM LOGO -->/g, '');
  assert.equal(restored, prepared, 'Tinting leaves existing palette definitions, controls, native logos and status branches unchanged');
  assert.deepEqual(selected.map(theme => theme.id), [0, themes.at(-1).id, 999], 'Caller palette identities are not mutated');
});

test('Default-only exports remain grey and the full preset set uses additional sprite rows', async () => {
  const grey = await addLogoToSkin(generateSkinXml(sourceXml, [themes[0]]), sprite, { tilePixels: tile }, {}, [themes[0]]);
  assert.equal((grey.xml.match(/name="pureblack_custom_logo_theme_0" condition="true"/g) || []).length, 2);
  const first = parsePng(grey.image), stride = first.width * 4 + 1;
  assert.deepEqual([...first.scanlines().subarray(428 * stride + 1, 428 * stride + 5)], [149, 149, 149, tile[3]]);
  const all = await addLogoToSkin(sourceXml, sprite, { tilePixels: tile }, {}, themes);
  const image = parsePng(all.image);
  assert.equal(image.height, 428 + Math.ceil(themes.length / 13) * 34);
  assert.equal((all.xml.match(/name="pureblack_custom_logo_theme_\d+"/g) || []).length, themes.length * 2);
  const last = themes.length - 1, x = last % 13 * 144, y = 428 + Math.floor(last / 13) * 34;
  assert.equal((all.xml.match(new RegExp(`<off x="${x}" y="${y}" width="144" height="34"/>`, 'g')) || []).length, 2);
  await assert.rejects(addLogoToSkin(sourceXml, sprite, { tilePixels: tile }, {}, themes.slice(1)), /Default/);
});

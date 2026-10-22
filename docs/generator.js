// Keep palette roles in sync with tools/build_themes.py. VirtualDJ skin XML uses
// its own relaxed dialect, so preserve native markup instead of serialising DOM.
export const ATOMIX_DEFAULT = Object.freeze(['#156C89', '#AC2F37', '#0D7264', '#A54D30']);

const BEGIN = '\t\t<!-- BEGIN PURE BLACK DECK THEMES -->';
const END = '\t\t<!-- END PURE BLACK DECK THEMES -->';
const encoder = new TextEncoder();

export function normaliseThemes(themes) {
  if (!Array.isArray(themes) || !themes.length || themes.length > 64) {
    throw new Error('Include Default and up to 63 additional palettes.');
  }
  const first = themes[0];
  if (!first || first.id !== 0 || first.name !== 'Default' || first.slug !== 'default' ||
      !Array.isArray(first.colors) || first.colors.length !== 4 ||
      first.colors.some((value, index) => value !== ATOMIX_DEFAULT[index])) {
    throw new Error('Default must retain the original Atomix colours unchanged.');
  }
  const names = new Set();
  const slugs = new Set();
  return themes.map((theme, id) => {
    if (!theme || typeof theme.name !== 'string' || !theme.name.trim() ||
        theme.name.trim().length > 64 || /[\u0000-\u001f\u007f]/.test(theme.name)) {
      throw new Error('Give each palette a name of 1–64 characters.');
    }
    if (!Array.isArray(theme.colors) || theme.colors.length !== 4 ||
        !theme.colors.every(value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value))) {
      throw new Error(`Choose four six-digit hex colours for ${theme.name}.`);
    }
    const name = theme.name.trim();
    const slug = typeof theme.slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(theme.slug)
      ? theme.slug : name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `palette-${id}`;
    if (names.has(name.toLowerCase()) || slugs.has(slug)) {
      throw new Error('Give each palette a different name.');
    }
    names.add(name.toLowerCase());
    slugs.add(slug);
    return {id, name, slug, colors: theme.colors.map(value => value.toUpperCase())};
  });
}

const escapeAttribute = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&apos;');

// Python's round uses ties-to-even; match the existing builder exactly.
function roundEven(value) {
  const floor = Math.floor(value);
  return value - floor === 0.5 ? floor + (floor % 2) : Math.round(value);
}

function mix(value, amount, target = 0) {
  return '#' + [1, 3, 5].map(index => roundEven(
    parseInt(value.slice(index, index + 2), 16) * (1 - amount) + target * amount
  ).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function definition(name, value, deck) {
  return `\t\t\t<define color="${name}" value="${value}"${deck === undefined ? '' : ` deck="${deck}"`}/>`;
}

function paletteGroup(theme) {
  const lines = [`\t\t<group name="pureblack-theme-${theme.slug}" condition="var_equal '@$pureblackdecktheme' ${theme.id}">`];
  theme.colors.forEach((base, index) => {
    const deck = index + 1;
    const bright = mix(base, .12, 255);
    const dark = mix(base, .32);
    const roles = {
      deckcolor: base, deckcolorbright: bright, deckcolordark: dark,
      deckcolor_invert: bright, padbuttonselected: mix(base, .82),
      buttonon: base, buttonover: mix(base, .76),
      buttonselected: mix(base, .82), pureblack_buttonfill: mix(base, .66),
      pureblack_deck_selected: mix(base, .66), textdeck: bright,
      faderinon: base, knobfillon: base, colorbass: mix(base, .66),
      colormed: dark, colorhigh: base, scratch1: base, scratch2: base,
      pureblack_wavevocal: dark, pureblack_waveinstru: base,
      pureblack_wavebeat: mix(base, .35, 255),
    };
    Object.entries(roles).forEach(([name, value]) => lines.push(definition(name, value, deck)));
    lines.push(definition(`waveform_active${deck}`, base),
      definition(`waveform_passive${deck}`, dark), definition(`pureblack_meter${deck}`, base));
  });
  ['left', 'right'].forEach((side, index) => {
    const base = theme.colors[index];
    ['deckcolor', 'faderinon', 'knobfillon'].forEach(name => lines.push(definition(name, base, side)));
    if (side === 'right') {
      lines.push(definition('buttonon', base, side), definition('pureblack_buttonfill', mix(base, .66), side));
    }
    lines.push(definition(`faderin${side}`, base));
  });
  [1, 2].forEach(deck => {
    const base = theme.colors[deck - 1];
    const roles = {over: mix(base, .76), selected: mix(base, .66),
      down: mix(base, .72), slider: base, disabled: mix(base, .66)};
    Object.entries(roles).forEach(([role, value]) => lines.push(definition(`pureblack_plugin_${role}${deck}`, value)));
  });
  lines.push('\t\t</group>');
  return lines.join('\n');
}

function themeCondition(themes, active) {
  return themes.slice(1).map(theme =>
    `var_equal '@$pureblackdecktheme' ${theme.id} ? ${active} : `
  ).join('') + String(!active);
}

function updateVariants(xml, themes, label, expected) {
  const pattern = new RegExp(`^([\\t ]*)<!-- BEGIN PURE BLACK ${label} -->\\n([\\s\\S]*?)^\\1<!-- END PURE BLACK ${label} -->`, 'gm');
  let count = 0;
  const result = xml.replace(pattern, (whole, indent, body) => {
    let groups = 0;
    const updated = body.replace(new RegExp(`^${indent}<group condition="[^"]*">`, 'gm'), () => {
      const condition = themeCondition(themes, groups++ === 1);
      return `${indent}<group condition="${condition}">`;
    });
    if (groups !== 2) throw new Error(`The skin's ${label.toLowerCase()} template has changed.`);
    count++;
    return `${indent}<!-- BEGIN PURE BLACK ${label} -->\n${updated}${indent}<!-- END PURE BLACK ${label} -->`;
  });
  if (count !== expected) throw new Error(`The skin's ${label.toLowerCase()} template is incomplete.`);
  return result;
}

export function generateSkinXml(baseXml, chosenThemes) {
  const themes = normaliseThemes(chosenThemes);
  if (typeof baseXml !== 'string') throw new Error('The skin template could not be read.');
  const newline = baseXml.includes('\r\n') ? '\r\n' : '\n';
  let xml = baseXml.replace(/\r\n/g, '\n');
  const start = xml.indexOf(BEGIN);
  const end = xml.indexOf(END, start);
  if (start < 0 || end < 0 || xml.indexOf(BEGIN, start + BEGIN.length) !== -1) {
    throw new Error('The skin palette template is missing or incomplete.');
  }
  const block = xml.slice(start, end);
  const firstPalette = block.search(/^\t\t<group name="pureblack-theme-/m);
  // These original definitions contain Default's native fills and meter classes.
  const originalDefinitions = firstPalette === -1 ? block : block.slice(0, firstPalette);
  const customDefinitions = themes.slice(1).map(paletteGroup).join('\n');
  xml = xml.slice(0, start) + originalDefinitions +
    (customDefinitions ? customDefinitions + '\n' : '') + xml.slice(end);

  const menu = '<submenu text="Deck Colours" localize="false">\n' + themes.map(theme =>
    `\t\t\t\t\t\t<item text="${escapeAttribute(theme.name)}" localize="false" action="set '@$pureblackdecktheme' ${theme.id} & load_skin" check="var_equal '@$pureblackdecktheme' ${theme.id}"/>\n`
  ).join('') + '\t\t\t\t\t</submenu>';
  let menus = 0;
  xml = xml.replace(/<submenu text="Deck Colours"[^>]*>[\s\S]*?<\/submenu>/g, () => { menus++; return menu; });
  if (menus !== 2) throw new Error('The skin colour menus are missing or incomplete.');
  xml = updateVariants(xml, themes, 'WAVEFORM', 16);
  xml = updateVariants(xml, themes, 'METER', 40);
  return newline === '\r\n' ? xml.replace(/\n/g, '\r\n') : xml;
}

const crcTable = Uint32Array.from({length: 256}, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** A dependency-free ZIP (stored entries), readable directly by VirtualDJ. */
export function createSkinZip(files) {
  if (!Array.isArray(files) || !files.length || files.length > 65535) throw new Error('The ZIP has an invalid file list.');
  const names = new Set();
  let localLength = 0;
  let centralLength = 0;
  const entries = files.map(file => {
    const name = file.name;
    if (typeof name !== 'string' || !name || /[\\\u0000-\u001f]/.test(name) ||
        name.startsWith('/') || /^[A-Za-z]:/.test(name) ||
        name.split('/').some(part => !part || part === '.' || part === '..') || names.has(name)) {
      throw new Error('The ZIP contains an invalid or duplicate filename.');
    }
    names.add(name);
    const filename = encoder.encode(name);
    const data = typeof file.data === 'string' ? encoder.encode(file.data)
      : file.data instanceof Uint8Array ? file.data
      : file.data instanceof ArrayBuffer ? new Uint8Array(file.data) : null;
    if (!data || filename.length > 65535 || data.length > 0xFFFFFFFF) throw new Error('A ZIP file is invalid or too large.');
    const entry = {filename, data, crc: crc32(data), offset: localLength};
    localLength += 30 + filename.length + data.length;
    centralLength += 46 + filename.length;
    return entry;
  });
  if (localLength + centralLength + 22 > 0xFFFFFFFF) throw new Error('The ZIP is too large.');
  const bytes = new Uint8Array(localLength + centralLength + 22);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  const u16 = value => { view.setUint16(offset, value, true); offset += 2; };
  const u32 = value => { view.setUint32(offset, value, true); offset += 4; };
  const append = value => { bytes.set(value, offset); offset += value.length; };
  for (const entry of entries) {
    u32(0x04034B50); u16(20); u16(0x0800); u16(0); u16(0); u16(0x0021);
    u32(entry.crc); u32(entry.data.length); u32(entry.data.length);
    u16(entry.filename.length); u16(0); append(entry.filename); append(entry.data);
  }
  for (const entry of entries) {
    u32(0x02014B50); u16(20); u16(20); u16(0x0800); u16(0); u16(0); u16(0x0021);
    u32(entry.crc); u32(entry.data.length); u32(entry.data.length);
    u16(entry.filename.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(entry.offset);
    append(entry.filename);
  }
  u32(0x06054B50); u16(0); u16(0); u16(entries.length); u16(entries.length);
  u32(centralLength); u32(localLength); u16(0);
  return bytes;
}

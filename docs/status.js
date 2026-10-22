/** Native status segments, shared by skin generation and the toolbar preview. */
export const STATUS_KEYS = Object.freeze(['master', 'cpu', 'battery', 'clock']);
// Match the 23px space from the native Mac logo's right edge (172) to status (195).
export const STATUS_LOGO_GAP = 23;
const WIDTHS = Object.freeze({ master: 160, cpu: 50, battery: 50, clock: 76 });

export function normaliseStatusOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Status options must be an object.');
  }
  return Object.fromEntries(STATUS_KEYS.map(key => {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') {
      throw new TypeError(`Status option ${key} must be on or off.`);
    }
    return [key, options[key] ?? true];
  }));
}

/** Positions are native subgroup coordinates; item.x is its allocated slot. */
export function statusLayout(options = {}, { batteryAvailable = true } = {}) {
  if (typeof batteryAvailable !== 'boolean') throw new TypeError('Battery availability must be on or off.');
  const selected = normaliseStatusOptions(options);
  const positions = Object.fromEntries(STATUS_KEYS.map(key => [key, null]));
  const items = [];
  const separators = [];
  let width = 0;
  for (const key of STATUS_KEYS) {
    if (!selected[key] || key === 'battery' && !batteryAvailable) continue;
    if (items.length) separators.push(width);
    positions[key] = width + (key === 'clock' ? 0 : 10);
    items.push({ key, x: width, width: WIDTHS[key] });
    width += WIDTHS[key];
  }
  return { positions, items, separators, width };
}

/** Equal spacing after the full status controls; no gap for an empty status. */
export function statusLogoOffset(options = {}) {
  const width = statusLayout(options).width;
  return width ? width + STATUS_LOGO_GAP : 0;
}

function nativeBlock(group, tag, name, visibility) {
  const matches = [...group.matchAll(new RegExp(`<${tag} name="${name}"[^>]*>[\\s\\S]*?<\\/${tag}>`, 'g'))];
  const match = visibility === undefined ? matches[0] : matches.find(item => item[0].split('>')[0].includes(`visibility="${visibility}"`));
  if (!match) throw new Error(`The native ${name} status control is missing.`);
  return match[0];
}

function position(block, x, removeVisibility = false) {
  const end = block.indexOf('>');
  let opening = block.slice(0, end).replace(/\bx="[^"]*"/, `x="+${x}"`);
  if (removeVisibility) opening = opening.replace(/ visibility="[^"]*"/, '');
  return opening + block.slice(end);
}

/** Rebuild only the native status wrapper, keeping each surviving control. */
export function configureStatusGroup(group, options = {}) {
  const selected = normaliseStatusOptions(options);
  // Existing callers and all-enabled exports retain the native block exactly.
  if (STATUS_KEYS.every(key => selected[key])) return group;
  const opening = group.match(/^<group name="topbar_status"[^>]*>/)?.[0];
  if (!opening || !group.endsWith('</group>')) throw new Error('The skin status group is incomplete.');
  const newline = group.includes('\r\n') ? '\r\n' : '\n';
  const withBattery = statusLayout(selected);
  const withoutBattery = statusLayout(selected, { batteryAvailable: false });
  const content = [];
  const background = (width, visibility = '') => width ? [
    `<visual${visibility ? ` visibility="${visibility}"` : ''}>`,
    `  <size width="${width}" height="27"/>`,
    '  <off shape="square" color="topmenu" radius="4" border_size="1" border="bordercolor2"/>',
    '</visual>',
  ].join(newline) : '';
  if (selected.battery) {
    content.push(background(withBattery.width, 'is_battery'), background(withoutBattery.width, 'not is_battery'));
  } else content.push(background(withBattery.width));
  if (selected.master) content.push(position(nativeBlock(group, 'group', 'mastervu'), withBattery.positions.master));
  if (selected.cpu) content.push(position(nativeBlock(group, 'panel', 'cpu'), withBattery.positions.cpu));
  if (selected.battery) content.push(position(nativeBlock(group, 'panel', 'battery'), withBattery.positions.battery));
  if (selected.clock) {
    if (selected.battery) {
      content.push(position(nativeBlock(group, 'group', 'clock', 'is_battery'), withBattery.positions.clock));
      content.push(position(nativeBlock(group, 'group', 'clock', 'not is_battery'), withoutBattery.positions.clock));
    } else content.push(position(nativeBlock(group, 'group', 'clock', 'is_battery'), withBattery.positions.clock, true));
  }
  // A shared divider can separate different adjacent items on battery-powered
  // and desktop machines. Conditional dividers avoid gaps and orphan lines.
  const withPositions = new Set(withBattery.separators);
  const withoutPositions = new Set(withoutBattery.separators);
  for (const x of [...new Set([...withPositions, ...withoutPositions])].sort((a, b) => a - b)) {
    const visibility = withPositions.has(x) && withoutPositions.has(x) ? '' :
      withPositions.has(x) ? ' visibility="is_battery"' : ' visibility="not is_battery"';
    content.push(`<line name="divider" color="dark" x="+${x}" y="+4" width="1" height="27-8"${visibility}/>`);
  }
  return [opening, ...content.filter(Boolean), '</group>'].join(newline);
}

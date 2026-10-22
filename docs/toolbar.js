/**
 * Ordered native VirtualDJ toolbar controls.
 * Actions, sprites and Sandbox states come from Atomix's default Pro skin.
 * Only placement and the account button's hit area differ. Shoutout is shown
 * unconditionally when included, so its configurator toggle is predictable.
 */

const FEATURES = ['account', 'shoutout', 'scheduler', 'sandbox'];
export const DEFAULT_TOOLBAR_ORDER = Object.freeze([...FEATURES, 'layout', 'settings']);
const WIDTHS = { account: 135, shoutout: 35, scheduler: 35, sandbox: 235, layout: 123, settings: 35 };

export function normaliseToolbarOrder(order = DEFAULT_TOOLBAR_ORDER) {
  if (!Array.isArray(order) || order.length !== DEFAULT_TOOLBAR_ORDER.length ||
      new Set(order).size !== DEFAULT_TOOLBAR_ORDER.length ||
      !DEFAULT_TOOLBAR_ORDER.every(key => order.includes(key))) {
    throw new TypeError('Toolbar order must contain each of the six controls exactly once.');
  }
  return [...order];
}

function validateOptions(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Toolbar options must be an object.');
  }
  for (const key of FEATURES) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') {
      throw new TypeError(`Toolbar option ${key} must be on or off.`);
    }
  }
}

const account = (x) => `<group name="login" x="${x}" y="8">
  <visual>
    <pos x="+0" y="+0"/>
    <size width="135" height="27"/>
    <off shape="square" color="topmenu" radius="4" border_size="1" border="bordercolor2"/>
  </visual>
  <visual>
    <pos x="+5" y="+5"/>
    <size width="16" height="16"/>
    <off x="284" y="127"/>
  </visual>
  <button action="connect">
    <pos x="+26" y="+0"/>
    <size width="135-26" height="27"/>
    <text width="135-26-5" fontsize="11" weight="" color="textoff3" align="left" action="get_username & param_uppercase" important="true"/>
  </button>
</group>`;

const shoutout = (x) => `<button action="shoutout">
  <pos x="${x}" y="8"/>
  <size width="35" height="27"/>
  <off border_size="1" border="bordercolor" color="topmenu"/>
  <over border_size="1" border="bordercolor" color="background"/>
  <selected border_size="1" border="bordercolor" color="background2"/>
  <icon x="301" y="149" width="18" height="15" colorup="textoff3" colorselected="texton" colorover="texton"/>
</button>`;

const scheduler = (x) => `<button action="eventscheduler">
  <pos x="${x}" y="8"/>
  <size width="35" height="27"/>
  <off border_size="1" border="bordercolor" color="topmenu"/>
  <over border_size="1" border="bordercolor" color="background"/>
  <selected border_size="1" border="bordercolor" color="background2"/>
  <icon x="199" y="127" width="15" height="18" colorup="textoff3" colorselected="texton" colorover="texton"/>
</button>`;

const sandbox = (x) => `<group name="sandbox" x="${x}" y="8">
  <button action="sandbox" visibility="can_sandbox">
    <pos x="+0" y="+0"/>
    <size width="35" height="27"/>
    <off border_size="1" border="bordercolor" color="topmenu"/>
    <over border_size="1" border="bordercolor" color="background"/>
    <selected border_size="1" border="bordercolor" color="background2"/>
    <icon x="278" y="149" colorup="textoff3" colorselected="texton" colorover="texton" width="15" height="15"/>
  </button>
  <button action="sandbox" visibility="not can_sandbox">
    <pos x="+0" y="+0"/>
    <size width="35" height="27"/>
    <off border_size="1" border="bordercolor" color="topmenu"/>
    <icon x="278" y="149" colorup="textdarker" width="15" height="15"/>
  </button>
  <group visibility="sandbox">
    <button action="sandbox">
      <pos x="+0" y="+0"/>
      <size width="35" height="27"/>
      <off border_size="1" border="bordercolor" color="topmenu"/>
      <over border_size="1" border="bordercolor" color="background"/>
      <selected border_size="1" border="bordercolor" color="#896526"/>
      <on border_size="1" border="bordercolor" color="#896526"/>
      <icon x="278" y="149" colorup="black" width="15" height="15"/>
    </button>
    <visual>
      <pos x="+35" y="+0"/>
      <size width="200" height="27"/>
      <off shape="square" color="display" border_size="1" border="bordercolor"/>
    </visual>
    <songpos class="songpos" deck="sandbox">
      <pos x="+35+1" y="+1"/>
      <size width="200-2" height="27-2"/>
    </songpos>
  </group>
</group>`;

const render = { account, shoutout, scheduler, sandbox };

/** Reserved widths include the entire active Sandbox waveform and hit areas. */
export function toolbarLayout(options = {}, platform = 'mac', order = DEFAULT_TOOLBAR_ORDER) {
  if (!['mac', 'pc'].includes(platform)) throw new Error('Unknown toolbar platform.');
  validateOptions(options);
  const enabled = normaliseToolbarOrder(order).filter(key => !FEATURES.includes(key) || options[key]);
  const totalWidth = enabled.reduce((width, key) => width + WIDTHS[key], 0) + (enabled.length - 1) * 10;
  // Leave 10px before Windows' window controls. Even with every control enabled,
  // this starts at 1141 (PC) or 1262 (Mac), beyond the respective phrase counters.
  let x = (platform === 'mac' ? 1910 : 1789) - totalWidth;
  return enabled.map(key => {
    const width = WIDTHS[key];
    const element = { key, x, y: 8, width, height: 27 };
    x += width + 10;
    return element;
  });
}

/** Measure space in native 1920-wide skin coordinates, including active Sandbox. */
export function measureToolbarFit(items, platform = 'mac', notch = platform === 'mac') {
  if (!['mac', 'pc'].includes(platform)) throw new Error('Unknown toolbar platform.');
  if (typeof notch !== 'boolean') throw new TypeError('Notch preview must be on or off.');
  if (!Array.isArray(items) || !items.length || items.some(item =>
    !Number.isFinite(item.x) || !Number.isFinite(item.width) || item.width <= 0)) {
    throw new TypeError('Toolbar bounds must contain valid control positions and widths.');
  }
  const phraseEnd = platform === 'mac' && notch ? 1160 : 1102;
  const rightBoundary = platform === 'mac' ? 1910 : 1789;
  const minGap = 10;
  const left = Math.min(...items.map(item => item.x));
  const right = Math.max(...items.map(item => item.x + item.width));
  const gap = left - phraseEnd;
  return {
    fits: gap >= minGap && right <= rightBoundary,
    gap, requiredWidth: right - left,
    availableWidth: rightBoundary - phraseEnd - minGap,
    phraseEnd, rightBoundary, minGap, items,
  };
}

// VirtualDJ accepts a relaxed XML dialect. Insert at a matching group boundary
// without parsing/reserializing its script attributes or existing source.
function groupBounds(xml, name) {
  const start = xml.indexOf(`<group name="${name}"`);
  if (start < 0) throw new Error(`Skin toolbar group is missing: ${name}.`);
  const tags = /<group\b(?:"[^"]*"|'[^']*'|[^'">])*?>|<\/group>/g;
  tags.lastIndex = start;
  let depth = 0;
  let bodyStart;
  for (let match; (match = tags.exec(xml));) {
    if (match[0] === '</group>') {
      depth -= 1;
      if (depth === 0) return { start, bodyStart, close: match.index, end: tags.lastIndex };
    } else if (!match[0].endsWith('/>')) {
      if (depth === 0) bodyStart = tags.lastIndex;
      depth += 1;
    }
  }
  throw new Error(`Skin toolbar group is incomplete: ${name}.`);
}

/** Arrange selected controls without rewriting native menus or VDJScript. */
export function applyToolbar(xml, options = {}, order = DEFAULT_TOOLBAR_ORDER, { compactNotch = false } = {}) {
  if (typeof xml !== 'string') throw new TypeError('Skin template must be text.');
  if (typeof compactNotch !== 'boolean') throw new TypeError('Compact notch toolbar must be on or off.');
  validateOptions(options);
  order = normaliseToolbarOrder(order);
  if (xml.includes('BEGIN PURE BLACK TOOLBAR') || xml.includes('BEGIN PURE BLACK OPTIONAL TOOLBAR')) {
    throw new Error('Toolbar controls have already been configured.');
  }
  const layouts = Object.fromEntries(['mac', 'pc'].map(platform => {
    const items = toolbarLayout(options, platform, order);
    // The ZIP supports either platform and retains automatic notch detection.
    // Always check the larger Mac notch layout, regardless of the website preview.
    if (!measureToolbarFit(items, platform).fits) {
      throw new Error('Toolbar controls would overlap the phrase counters. Remove an optional control.');
    }
    return [platform, items];
  }));
  const newline = xml.includes('\r\n') ? '\r\n' : '\n';
  for (const platform of ['mac', 'pc']) {
    const outer = groupBounds(xml, `pureblack_toolbar_${platform}`);
    let body = xml.slice(outer.bodyStart, outer.close);
    const layout = groupBounds(body, 'layout_options');
    const nativeLayout = body.slice(layout.start, layout.end);
    const settings = [...body.matchAll(/<button action="settings">[\s\S]*?<\/button>/g)];
    if (settings.length !== 1) throw new Error('Skin toolbar must contain one Settings button per platform.');
    const nativeSettings = settings[0][0];
    const removals = [layout, { start: settings[0].index, end: settings[0].index + nativeSettings.length }];
    for (const { start, end } of removals.sort((a, b) => b.start - a.start)) {
      body = body.slice(0, start) + body.slice(end);
    }
    const renderLayout = items => items.map(({ key, x }) => {
      if (key === 'layout') return nativeLayout.replace(/^(<group name="layout_options" x=")[^"]*(")/, (_, before, after) => before + x + after);
      if (key === 'settings') return nativeSettings.replace(/(<pos x=")[^"]*(" y="8"\/>)/, (_, before, after) => before + x + after);
      return render[key](x);
    }).join(newline).replace(/\r?\n/g, newline);
    let markup = renderLayout(layouts[platform]);
    // The selected 13-inch layout keeps Account in the ZIP. VirtualDJ chooses
    // the appropriate branch live, using the same native notch query as the
    // phrase counters. Reflow every control so arbitrary ordering leaves no gap.
    if (platform === 'mac' && compactNotch && FEATURES.every(key => options[key] === true)) {
      const compact = renderLayout(toolbarLayout({ ...options, account: false }, platform, order));
      markup = `<group name="pureblack_toolbar_full" visibility="not has_notch">${newline}${markup}${newline}</group>${newline}` +
        `<group name="pureblack_toolbar_compact" visibility="has_notch">${newline}${compact}${newline}</group>`;
    }
    const insertion = `${newline}<!-- BEGIN PURE BLACK TOOLBAR -->${newline}${markup}${newline}<!-- END PURE BLACK TOOLBAR -->${newline}`;
    xml = xml.slice(0, outer.bodyStart) + body + insertion + xml.slice(outer.close);
  }
  return xml;
}

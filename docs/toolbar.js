/**
 * Optional native VirtualDJ toolbar controls.
 * Actions, sprites and Sandbox states come from Atomix's default Pro skin.
 * Only placement and the account button's hit area differ. Shoutout is shown
 * unconditionally when included, so its configurator toggle is predictable.
 */

const FEATURES = ['account', 'shoutout', 'scheduler', 'sandbox'];

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
export function toolbarLayout(options = {}, platform = 'mac') {
  if (!['mac', 'pc'].includes(platform)) throw new Error('Unknown toolbar platform.');
  let x = platform === 'mac' ? 195 : 100;
  const elements = [];
  for (const key of FEATURES) {
    if (!options[key]) continue;
    const width = key === 'account' ? 135 : key === 'sandbox' ? 235 : 35;
    // Windows keeps its original Layout menu between the optional buttons and
    // Sandbox. On macOS all four fit before the left notch counters.
    if (key === 'sandbox' && platform === 'pc') x = 573;
    elements.push({ key, x, y: 8, width, height: 27 });
    x += width + 10;
  }
  return elements;
}

// VirtualDJ accepts a relaxed XML dialect. Insert at a matching group boundary
// without parsing/reserializing its script attributes or existing source.
function groupEnd(xml, name) {
  const start = xml.indexOf(`<group name="${name}"`);
  if (start < 0) throw new Error(`Skin toolbar group is missing: ${name}.`);
  const tags = /<group\b[^>]*>|<\/group>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let match; (match = tags.exec(xml));) {
    if (match[0] === '</group>') {
      depth -= 1;
      if (depth === 0) return match.index;
    } else if (!match[0].endsWith('/>')) {
      depth += 1;
    }
  }
  throw new Error(`Skin toolbar group is incomplete: ${name}.`);
}

/** Add selected controls to an untouched Pro Pure Black XML template. */
export function applyToolbar(xml, options = {}) {
  if (typeof xml !== 'string') throw new TypeError('Skin template must be text.');
  for (const key of FEATURES) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') {
      throw new TypeError(`Toolbar option ${key} must be on or off.`);
    }
  }
  if (!FEATURES.some((key) => options[key])) return xml;
  if (xml.includes('BEGIN PURE BLACK OPTIONAL TOOLBAR')) {
    throw new Error('Toolbar controls have already been configured.');
  }
  const newline = xml.includes('\r\n') ? '\r\n' : '\n';
  for (const platform of ['mac', 'pc']) {
    const markup = toolbarLayout(options, platform).map(({ key, x }) => render[key](x)).join('\n');
    const insertion = `\n<!-- BEGIN PURE BLACK OPTIONAL TOOLBAR -->\n${markup}\n<!-- END PURE BLACK OPTIONAL TOOLBAR -->\n`.replaceAll('\n', newline);
    const end = groupEnd(xml, `pureblack_toolbar_${platform}`);
    xml = xml.slice(0, end) + insertion + xml.slice(end);
  }
  return xml;
}

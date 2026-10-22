import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { STATUS_KEYS, STATUS_LOGO_GAP, normaliseStatusOptions, statusLayout, statusLogoOffset, configureStatusGroup } from '../docs/status.js';
import { applyToolbar, resolveToolbarState } from '../docs/toolbar.js';
import { toolbarFit } from '../docs/display.js';
import { applyLogoXml } from '../docs/logo-skin.js';

const source = readFileSync(new URL('../skin/Pro.xml', import.meta.url), 'utf8');
const nativeWidths = { master: 160, cpu: 50, battery: 50, clock: 76 };

function group(text, name) {
  const start = text.indexOf(`<group name="${name}"`);
  assert.ok(start >= 0, `Missing ${name}`);
  const tokens = /<group\b(?:"[^"]*"|'[^']*'|[^'">])*?>|<\/group>/g;
  tokens.lastIndex = start;
  let depth = 0;
  for (let match; (match = tokens.exec(text));) {
    if (match[0] === '</group>') depth--;
    else if (!match[0].endsWith('/>')) depth++;
    if (!depth) return text.slice(start, tokens.lastIndex);
  }
  assert.fail(`Incomplete ${name}`);
}

const cases = Array.from({ length: 16 }, (_, mask) => Object.fromEntries(STATUS_KEYS.map((key, bit) => [key, Boolean(mask & (1 << bit))])));

test('status options preserve old defaults, validate booleans and share exact native geometry', () => {
  assert.deepEqual(normaliseStatusOptions(), { master: true, cpu: true, battery: true, clock: true });
  assert.deepEqual(normaliseStatusOptions({ cpu: false, account: true }), { master: true, cpu: false, battery: true, clock: true });
  for (const invalid of [null, [], 'none']) assert.throws(() => normaliseStatusOptions(invalid), /object/);
  for (const key of STATUS_KEYS) assert.throws(() => normaliseStatusOptions({ [key]: 0 }), /on or off/);
  assert.throws(() => statusLayout({}, { batteryAvailable: 1 }), /on or off/);
  assert.deepEqual(statusLayout().positions, { master: 10, cpu: 170, battery: 220, clock: 260 });
  assert.equal(statusLayout().width, 336);
  const minimal = { master: true, cpu: false, battery: false, clock: true };
  assert.deepEqual(statusLayout(minimal).positions, { master: 10, cpu: null, battery: null, clock: 160 });
  assert.equal(statusLayout(minimal).width, 236);
  assert.equal(statusLayout({}, { batteryAvailable: false }).width, 286);
});

test('all status subsets retain native behavior while removing hidden controls on both platforms', () => {
  for (const options of cases) {
    for (const account of [false, true]) {
      const output = applyToolbar(source, { ...options, account });
      for (const platform of ['mac', 'pc']) {
        const toolbar = group(output, `pureblack_toolbar_${platform}`);
        const native = group(group(source, `pureblack_toolbar_${platform}`), 'topbar_status');
        const status = group(toolbar, 'topbar_status');
        for (const [key, needle] of [
          ['master', 'source="get_vu_meter_left \'master\'"'],
          ['cpu', 'source="get_cpu"'],
          ['battery', 'source="get_battery"'],
          ['clock', 'action="get_clock"'],
        ]) assert.equal(status.includes(needle), options[key], `${platform}: ${key} visibility`);
        if (options.master) {
          assert.ok(status.includes('source="get_vu_meter_right \'master\'"'));
          assert.ok(status.includes('source="get_limiter"'));
          assert.equal(group(status, 'mastervu'), group(native, 'mastervu'), 'Master native sprites/actions stay exact');
        }
        if (options.battery) {
          assert.ok(status.includes('visibility="is_battery"'));
          assert.ok(status.includes('source="get_battery & param_smaller 20% ? blink : off"'));
          assert.ok(status.includes('<off x="227" y="152"/>'));
        } else assert.ok(!status.includes('is_battery'), 'Disabled battery leaves no hidden battery branch');
        if (options.clock) {
          assert.ok(status.includes('format="%counter"'), 'Native timer fallback stays intact');
          assert.equal((status.match(/action="get_clock"/g) || []).length, options.battery ? 2 : 1);
        }
        if (STATUS_KEYS.every(key => options[key])) assert.equal(status, native);
        if (STATUS_KEYS.every(key => !options[key])) {
          assert.equal(status, `<group name="topbar_status" x="${platform === 'mac' ? 195 : 100}" y="8">\r\n</group>`);
        }
        assert.ok(!/(?<!\r)\n/.test(status));
      }
      assert.equal(group(output, 'beat_matcher'), group(source, 'beat_matcher'));
      assert.equal(group(output, 'beat_matcher_notch'), group(source, 'beat_matcher_notch'));
    }
  }
  const original = group(source, 'topbar_status');
  assert.equal(configureStatusGroup(original), original, 'Existing callers preserve the status byte-for-byte');
});

test('status layouts compact controls and dividers with and without a battery', () => {
  for (const options of cases) {
    for (const batteryAvailable of [false, true]) {
      const layout = statusLayout(options, { batteryAvailable });
      const enabled = STATUS_KEYS.filter(key => options[key] && (key !== 'battery' || batteryAvailable));
      assert.deepEqual(layout.items.map(item => item.key), enabled);
      assert.equal(layout.width, enabled.reduce((sum, key) => sum + nativeWidths[key], 0));
      assert.equal(layout.separators.length, Math.max(0, enabled.length - 1));
      for (let index = 0; index < layout.items.length; index++) {
        const item = layout.items[index];
        assert.equal(item.width, nativeWidths[item.key]);
        assert.ok(layout.positions[item.key] >= item.x);
        assert.ok(layout.positions[item.key] < item.x + item.width);
        if (index) {
          assert.equal(item.x, layout.items[index - 1].x + layout.items[index - 1].width);
          assert.equal(layout.separators[index - 1], item.x);
        } else assert.equal(item.x, 0);
      }
    }
  }
});

test('custom logos follow every status subset in ordinary and Account-left layouts', () => {
  for (const options of cases) {
    const width = statusLayout(options).width;
    const offset = width ? width + 23 : 0;
    for (const account of [false, true]) {
      const requested = { ...options, account };
      const output = applyLogoXml(applyToolbar(source, requested), 428, requested);
      for (const [platform, statusX] of [['mac', 195], ['pc', 100]]) {
        const native = group(output, 'topbar').match(new RegExp(`<group name="applicationbuttons" condition="is_${platform}">[\\s\\S]*?<!-- END PURE BLACK CUSTOM LOGO -->`))[0];
        assert.ok(native.includes(`<pos x="${statusX + offset}" y="13"/>`));
        if (platform === 'mac' && account) assert.ok(native.includes(`<pos x="${327 + offset}" y="13"/>`));
        assert.ok(native.includes('<size width="72" height="17"/>'));
      }
      for (const fullscreen of [false, true]) {
        const state = resolveToolbarState(requested, { width: 1440, fullscreen });
        assert.equal(state.statusWidth, width);
        assert.deepEqual(state.statusLayout, statusLayout(options));
        assert.equal(state.statusX, account && !fullscreen ? 327 : 195);
        assert.equal(state.logoX, state.statusX + offset);
        const fit = toolbarFit(requested, undefined, { width: 1440, fullscreen });
        assert.equal(fit.logoX, state.logoX);
        assert.equal(fit.statusWidth, width);
      }
    }
  }
});

test('uploaded logo gap matches the native Mac logo-to-status gap for every nonempty status selection', () => {
  const nativeLogo = source.match(/<group name="applicationbuttons" condition="is_mac">\s*<logo>[\s\S]*?<\/logo>/)[0];
  const left = Number(nativeLogo.match(/<pos x="(\d+)"/)[1]);
  const width = Number(nativeLogo.match(/<size width="(\d+)"/)[1]);
  const statusX = Number(group(source, 'topbar_status').match(/^<group name="topbar_status" x="(\d+)"/)[1]);
  const nativeGap = statusX - (left + width);
  assert.equal(nativeGap, 23);
  assert.equal(STATUS_LOGO_GAP, nativeGap);
  for (const options of cases) {
    const statusWidth = statusLayout(options).width;
    assert.equal(statusLogoOffset(options), statusWidth ? statusWidth + nativeGap : 0);
    for (const account of [false, true]) {
      const state = resolveToolbarState({ ...options, account }, { width: 1440 });
      assert.equal(state.logoX - state.statusX - statusWidth, statusWidth ? nativeGap : 0);
    }
  }
});

test('all sixteen status combinations remain valid relaxed XML with responsive Account and logo branches', () => {
  const documents = cases.map(options => {
    const selected = { ...options, account: true, sandbox: true, shoutout: true, scheduler: true };
    return applyLogoXml(applyToolbar(source, selected), 428, selected);
  });
  const result = spawnSync('python3', ['-c', `import json, sys
from html.parser import HTMLParser
class Check(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.stack=[]
    def handle_starttag(self, tag, attrs): self.stack.append(tag)
    def handle_endtag(self, tag): assert self.stack.pop() == tag
for xml in json.load(sys.stdin):
    parser=Check()
    parser.feed(xml)
    assert not parser.stack
`], { encoding: 'utf8', input: JSON.stringify(documents) });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});

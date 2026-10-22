import { DEFAULT_TOOLBAR_ORDER, toolbarLayout } from './toolbar.js';

// Approximate preview profiles at half the panel's native resolution. macOS
// display scaling and VirtualDJ's window size can differ; these aren't detected
// hardware measurements. Native panel dimensions are documented by Apple:
// 13: https://support.apple.com/en-us/111867
// 14: https://support.apple.com/en-us/111902
// 15: https://support.apple.com/en-us/111346
// 16: https://support.apple.com/en-us/111838
export const DISPLAY_PROFILES = Object.freeze([
  { id: '13', label: '13″ Air', width: 1280, height: 832 },
  { id: '14', label: '14″ Pro', width: 1512, height: 982 },
  { id: '15', label: '15″ Air', width: 1440, height: 932 },
  { id: '16', label: '16″ Pro', width: 1728, height: 1117 },
].map(profile => Object.freeze(profile)));

export function getDisplayProfile(id = '14') {
  const profile = DISPLAY_PROFILES.find(item => item.id === id);
  if (!profile) throw new Error('Choose a supported display size.');
  return profile;
}

// Hold the controls at the same preview scale while changing available width.
// This uses the 1920-wide source at a 1440-point reference width. The exported
// skin retains VirtualDJ's own scaling; this is a conservative manual preview.
export const PREVIEW_SCALE = .75;

export function resolveToolbarOptions(options = {}, { profile = '14' } = {}) {
  getDisplayProfile(profile);
  const autoHiddenAccount = profile === '13' && ['account', 'sandbox', 'shoutout', 'scheduler'].every(key => options[key] === true);
  return { options: { ...options, ...(autoHiddenAccount ? { account: false } : {}) }, autoHiddenAccount };
}

export function toolbarFit(options = {}, order = DEFAULT_TOOLBAR_ORDER, { notch = false, profile = '14' } = {}) {
  const display = getDisplayProfile(profile);
  if (typeof notch !== 'boolean') throw new TypeError('Notch preview must be on or off.');
  const resolved = resolveToolbarOptions(options, { profile });
  const canvasWidth = display.width / PREVIEW_SCALE;
  const phraseOffset = (canvasWidth - 1920) / 2;
  const items = toolbarLayout(resolved.options, 'mac', order).map(item => ({ ...item, x: item.x + canvasWidth - 1920 }));
  const phraseEnd = (notch ? 1160 : 1102) + phraseOffset;
  const rightBoundary = canvasWidth - 10;
  const gap = items[0].x - phraseEnd;
  const minGap = 10;
  const requiredWidth = items.at(-1).x + items.at(-1).width - items[0].x;
  return {
    ...resolved,
    fits: gap >= minGap,
    items, gap, requiredWidth, availableWidth: rightBoundary - phraseEnd - minGap,
    phraseEnd, rightBoundary, minGap, canvasWidth, phraseOffset,
    profile: display, scale: PREVIEW_SCALE,
  };
}

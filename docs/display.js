import { DEFAULT_TOOLBAR_ORDER, toolbarLayout, measureToolbarFit } from './toolbar.js';

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

/** Relative skin geometry scales together; display size alone cannot cause overlap. */
export function toolbarFit(options = {}, order = DEFAULT_TOOLBAR_ORDER, { notch = false, profile = '14' } = {}) {
  const display = getDisplayProfile(profile);
  return {
    ...measureToolbarFit(toolbarLayout(options, 'mac', order), 'mac', notch),
    profile: display, scale: display.width / 1920,
  };
}

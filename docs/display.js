import { DEFAULT_TOOLBAR_ORDER, toolbarLayout, resolveToolbarState } from './toolbar.js';

// Keep controls legible while the available preview width changes. On phones
// the toolbar pans locally; the four deck previews remain visible together.
export const PREVIEW_SCALE = .75;
export const MIN_PREVIEW_WIDTH = 1344;

export function toolbarFit(options = {}, order = DEFAULT_TOOLBAR_ORDER, { notch = false, width = 1440, fullscreen = notch } = {}) {
  if (typeof notch !== 'boolean' || typeof fullscreen !== 'boolean') throw new TypeError('Window states must be on or off.');
  if (!Number.isFinite(width) || width <= 0) throw new TypeError('Preview width must be positive.');
  const renderWidth = Math.max(MIN_PREVIEW_WIDTH, width);
  const state = resolveToolbarState(options, { width: renderWidth, notch, fullscreen });
  const canvasWidth = renderWidth / PREVIEW_SCALE;
  const phraseOffset = (canvasWidth - 1920) / 2;
  const items = toolbarLayout(state.rightOptions, 'mac', order).map(item => ({ ...item, x: item.x + canvasWidth - 1920 }));
  const leftItem = state.accountLeft ? { key: 'account', x: 182, y: 8, width: 135, height: 27 } : null;
  const phraseEnd = (notch ? 1160 : 1102) + phraseOffset;
  const rightBoundary = canvasWidth - 10;
  const gap = items[0].x - phraseEnd;
  const minGap = 10;
  const requiredWidth = items.at(-1).x + items.at(-1).width - items[0].x;
  return {
    ...state, leftItem, items, renderWidth,
    fits: gap >= minGap,
    gap, requiredWidth, availableWidth: rightBoundary - phraseEnd - minGap,
    phraseEnd, rightBoundary, minGap, canvasWidth, phraseOffset, scale: PREVIEW_SCALE,
  };
}

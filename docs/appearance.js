/** Website accents follow Deck A; skin colours are never changed here. */
function mix(hex, amount, target = 255) {
  return '#' + [1, 3, 5].map(index => Math.round(
    parseInt(hex.slice(index, index + 2), 16) * (1 - amount) + target * amount,
  ).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function websiteThemeProperties(theme) {
  if (!theme || !Array.isArray(theme.colors) || theme.colors.length !== 4 ||
      !theme.colors.every(colour => typeof colour === 'string' && /^#[0-9a-f]{6}$/i.test(colour))) {
    throw new Error('A website theme needs four hex colours.');
  }
  const base = theme.colors[0];
  return {
    '--accent': mix(base, .64),
    '--accent-hover': mix(base, .82),
    '--accent-ink': '#000000',
    '--accent-text': mix(base, .68),
    '--accent-text-strong': mix(base, .9),
    '--accent-muted': mix(base, .42),
    '--accent-line': mix(base, .28),
    '--accent-line-strong': mix(base, .5),
    '--line': mix(mix(base, .18), .65, 0),
    '--muted': mix(base, .6),
    '--text': mix(base, .94),
  };
}

export function applyWebsiteTheme(theme, root = document.documentElement) {
  for (const [property, value] of Object.entries(websiteThemeProperties(theme))) {
    if (root.style.getPropertyValue(property) !== value) root.style.setProperty(property, value);
  }
  root.dataset.palette = theme.slug || 'custom';
}

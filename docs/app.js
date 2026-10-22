import { generateSkinXml, createSkinZip } from './generator.js';
import { applyToolbar } from './toolbar.js';

const $ = (selector) => document.querySelector(selector);
const letters = ['A', 'B', 'C', 'D'];
const toolbarKeys = ['sandbox', 'shoutout', 'scheduler', 'account'];
const originalDefault = { id: 0, name: 'Default', slug: 'default', colors: ['#156C89', '#AC2F37', '#0D7264', '#A54D30'] };
const state = {
  themes: [originalDefault], selected: new Set(['default']), preview: 'default',
  custom: ['#E98DB6', '#89BFF0', '#B69BE4', '#F2C48F'], assets: null, busy: false,
};
const hexPattern = /^#[0-9a-f]{6}$/i;

function setStatus(message, error = false) {
  $('#status').textContent = message;
  $('#status').classList.toggle('is-error', error);
}

function customTheme() {
  return { id: state.themes.length, name: $('#custom-name').value.trim() || 'Custom', slug: 'custom', colors: [...state.custom] };
}

function currentTheme() {
  return state.preview === 'custom' ? customTheme() : state.themes.find(theme => theme.slug === state.preview) || originalDefault;
}

function renderPreview() {
  const theme = currentTheme();
  $('#preview-title').textContent = theme.name;
  $('#preview-kind').textContent = theme.slug === 'default' ? 'Original Atomix colours' : theme.slug === 'custom' ? 'Your custom palette' : 'Decks · waveforms · meters';
  $('#deck-preview').replaceChildren(...theme.colors.map((colour, index) => {
    const deck = document.createElement('div');
    deck.className = 'deck';
    deck.style.setProperty('--deck-color', colour);
    const ticks = Array.from({ length: 60 }, (_, tick) => {
      const angle = tick * 6 * Math.PI / 180;
      const inner = tick % 5 === 0 ? 61 : 64;
      const x1 = 80 + Math.sin(angle) * inner, y1 = 80 - Math.cos(angle) * inner;
      const x2 = 80 + Math.sin(angle) * 68, y2 = 80 - Math.cos(angle) * 68;
      return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${colour}" stroke-opacity="${tick % 5 === 0 ? '.9' : '.35'}" stroke-width="${tick % 5 === 0 ? '1.3' : '.7'}"/>`;
    }).join('');
    // Colours are validated six-digit hex values; palette names are only set as text.
    deck.innerHTML = `<svg class="jog" viewBox="0 0 160 160" role="img" aria-label="Deck ${letters[index]}, ${colour}"><circle cx="80" cy="80" r="72" fill="#09090b" stroke="#26232b"/><circle cx="80" cy="80" r="56" fill="#050506" stroke="${colour}" stroke-width="2.5"/><circle cx="80" cy="80" r="52" fill="none" stroke="${colour}" stroke-opacity=".17" stroke-width="1"/><circle cx="80" cy="80" r="44" fill="none" stroke="#202025" stroke-width=".8"/><circle cx="80" cy="80" r="34" fill="#0b0b0e" stroke="#212126" stroke-width=".8"/>${ticks}<path d="M80 25v14" stroke="${colour}" stroke-width="3" stroke-linecap="round"/><circle cx="80" cy="80" r="3" fill="${colour}"/><text x="80" y="67" text-anchor="middle" font-size="10" font-family="Arial,sans-serif" fill="${colour}" font-weight="600">${letters[index]}</text><text x="80" y="99" text-anchor="middle" font-size="5.5" font-family="Arial,sans-serif" letter-spacing="1.4" fill="#77717f">PURE BLACK</text><path d="M65 122h30" stroke="${colour}" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/></svg><div class="deck-meta"><span class="deck-letter">DECK ${letters[index]}</span><span class="deck-hex">${colour}</span></div>`;
    return deck;
  }));
  document.querySelectorAll('.preset-card').forEach(card => {
    const active = card.dataset.slug === state.preview;
    card.classList.toggle('is-preview', active);
    card.querySelector('.preset-preview').setAttribute('aria-pressed', String(active));
  });
  $('#preview-custom').setAttribute('aria-pressed', String(state.preview === 'custom'));
}

function renderPresets() {
  $('#presets').replaceChildren(...state.themes.map(theme => {
    const card = document.createElement('div');
    card.className = 'preset-card';
    card.dataset.slug = theme.slug;
    const preview = document.createElement('button');
    preview.type = 'button'; preview.className = 'preset-preview';
    preview.setAttribute('aria-label', `Preview ${theme.name}`);
    const nameRow = document.createElement('span'); nameRow.className = 'preset-name-row';
    const name = document.createElement('span'); name.className = 'preset-name'; name.textContent = theme.name;
    nameRow.append(name);
    if (theme.slug === 'default') {
      const locked = document.createElement('span'); locked.className = 'locked-label'; locked.textContent = 'LOCKED'; nameRow.append(locked);
    }
    const swatches = document.createElement('span'); swatches.className = 'palette-swatches'; swatches.setAttribute('aria-hidden', 'true');
    theme.colors.forEach(colour => { const swatch = document.createElement('i'); swatch.style.setProperty('--swatch', colour); swatches.append(swatch); });
    preview.append(nameRow, swatches);
    preview.addEventListener('click', () => { state.preview = theme.slug; renderPreview(); });
    const label = document.createElement('label'); label.className = 'preset-checkbox';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = state.selected.has(theme.slug); checkbox.disabled = theme.slug === 'default';
    checkbox.setAttribute('aria-label', theme.slug === 'default' ? 'Default is always included' : `Include ${theme.name}`);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selected.add(theme.slug); else state.selected.delete(theme.slug);
      updateSummary();
    });
    const face = document.createElement('span'); face.className = 'checkbox-face'; face.setAttribute('aria-hidden', 'true');
    label.append(checkbox, face); card.append(preview, label); return card;
  }));
  renderPreview();
}

function validateCustom() {
  const invalid = [...document.querySelectorAll('.hex-input')].filter(input => !hexPattern.test(input.value.trim()));
  document.querySelectorAll('.hex-input').forEach(input => input.setAttribute('aria-invalid', String(!hexPattern.test(input.value.trim()))));
  const included = $('#include-custom').checked;
  const duplicate = state.themes.some(theme => state.selected.has(theme.slug) && theme.name.toLowerCase() === customTheme().name.toLowerCase());
  let error = '';
  if (included && invalid.length) error = 'Use a six-digit hex colour for each deck, for example #E98DB6.';
  else if (included && duplicate) error = 'Give your custom palette a different name from the included presets.';
  $('#custom-error').textContent = error;
  $('#custom-error').hidden = !error;
  $('#custom-name').setAttribute('aria-invalid', String(included && duplicate));
  return !error;
}

function updateSummary() {
  const valid = validateCustom();
  const count = state.selected.size + Number($('#include-custom').checked);
  const toolbarCount = toolbarKeys.filter(key => $(`#toolbar-${key}`).checked).length;
  $('#preset-count').textContent = `${state.selected.size} included`;
  $('#toolbar-count').textContent = `${toolbarCount} visible`;
  $('#download-summary').textContent = `${count} palette${count === 1 ? '' : 's'} · ${toolbarCount} optional control${toolbarCount === 1 ? '' : 's'}`;
  $('#download').disabled = !state.assets || state.busy || !valid;
}

function renderCustomInputs() {
  $('#custom-colours').replaceChildren(...letters.map((letter, index) => {
    const field = document.createElement('div'); field.className = 'colour-field';
    const label = document.createElement('label'); label.className = 'colour-field-label'; label.htmlFor = `colour-${letter}`; label.textContent = `Deck ${letter}`;
    const wrap = document.createElement('div'); wrap.className = 'colour-swatch-wrap';
    const picker = document.createElement('input'); picker.type = 'color'; picker.id = `colour-${letter}`; picker.className = 'colour-picker'; picker.value = state.custom[index];
    const hex = document.createElement('input'); hex.type = 'text'; hex.className = 'hex-input'; hex.value = state.custom[index]; hex.maxLength = 7; hex.spellcheck = false; hex.autocomplete = 'off';
    hex.setAttribute('aria-label', `Deck ${letter} hex colour`);
    hex.setAttribute('aria-describedby', 'custom-error');
    const changed = value => {
      $('#include-custom').checked = true;
      if (hexPattern.test(value.trim())) { state.custom[index] = value.trim().toUpperCase(); picker.value = state.custom[index]; }
      state.preview = 'custom'; renderPreview(); updateSummary();
    };
    picker.addEventListener('input', () => { hex.value = picker.value.toUpperCase(); changed(picker.value); });
    hex.addEventListener('input', () => changed(hex.value));
    hex.addEventListener('blur', () => { if (hexPattern.test(hex.value.trim())) hex.value = hex.value.trim().toUpperCase(); });
    wrap.append(picker); field.append(label, wrap, hex); return field;
  }));
}

async function fetchAsset(name, binary = false) {
  const response = await fetch(new URL(`./assets/${name}`, import.meta.url));
  if (!response.ok) throw new Error(`Could not load ${name} (${response.status}).`);
  return binary ? new Uint8Array(await response.arrayBuffer()) : response.text();
}

async function loadAssets() {
  $('#retry').hidden = true;
  setStatus('Loading skin assets…');
  try {
    const [themesText, xml, image, icons] = await Promise.all([
      fetchAsset('themes.json'), fetchAsset('Pro.xml'), fetchAsset('gfx-pro.png', true), fetchAsset('icons_daylight.png', true),
    ]);
    const themes = JSON.parse(themesText);
    if (!Array.isArray(themes) || !themes.length || themes.some(theme => !Array.isArray(theme.colors) || theme.colors.length !== 4 || theme.colors.some(colour => !hexPattern.test(colour)))) throw new Error('The palette data could not be loaded.');
    if (themes[0].slug !== 'default' || JSON.stringify(themes[0].colors) !== JSON.stringify(originalDefault.colors)) throw new Error('The original Default palette could not be verified.');
    state.themes = themes;
    state.selected = new Set(themes.map(theme => theme.slug));
    state.assets = { xml, image, icons };
    renderPresets(); updateSummary(); setStatus('Ready to build your skin.');
  } catch (error) {
    state.assets = null; updateSummary();
    setStatus(`${error.message} Try loading the skin assets again.`, true);
    $('#retry').hidden = false;
  }
}

async function downloadSkin() {
  if (!state.assets || !validateCustom() || state.busy) return;
  state.busy = true; updateSummary();
  $('#download span').textContent = 'Building skin…';
  setStatus('Building your skin…');
  try {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const themes = state.themes.filter(theme => theme.slug === 'default' || state.selected.has(theme.slug));
    if ($('#include-custom').checked) themes.push(customTheme());
    let xml = generateSkinXml(state.assets.xml, themes);
    const toolbar = Object.fromEntries(toolbarKeys.map(key => [key, $(`#toolbar-${key}`).checked]));
    xml = applyToolbar(xml, toolbar);
    xml = xml.replace(/(<skin\s[^>]*\bname=")[^"]*(")/, '$1Pro Pure Black Custom$2');
    const bytes = createSkinZip([
      { name: 'Pro.xml', data: xml },
      { name: 'gfx-pro.png', data: state.assets.image },
      { name: 'icons_daylight.png', data: state.assets.icons },
    ]);
    const blob = new Blob([bytes], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'pro-pure-black-custom.zip'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    setStatus('Skin built — your ZIP download is ready.');
  } catch (error) {
    setStatus(`Could not build the skin. ${error.message}`, true);
  } finally {
    state.busy = false; $('#download span').textContent = 'Download skin'; updateSummary();
  }
}

toolbarKeys.forEach(key => $(`#toolbar-${key}`).addEventListener('change', updateSummary));
$('#include-custom').addEventListener('change', updateSummary);
$('#custom-name').addEventListener('input', () => { updateSummary(); if (state.preview === 'custom') renderPreview(); });
$('#preview-custom').addEventListener('click', () => { state.preview = 'custom'; renderPreview(); });
$('#select-all').addEventListener('click', () => { state.selected = new Set(state.themes.map(theme => theme.slug)); renderPresets(); updateSummary(); });
$('#select-default').addEventListener('click', () => { state.selected = new Set(['default']); renderPresets(); updateSummary(); });
$('#download').addEventListener('click', downloadSkin);
$('#retry').addEventListener('click', loadAssets);
renderCustomInputs(); renderPresets(); updateSummary();
loadAssets();

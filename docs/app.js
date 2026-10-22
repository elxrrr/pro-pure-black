import { generateSkinXml, createSkinZip, normaliseThemes } from './generator.js';
import { applyToolbar, DEFAULT_TOOLBAR_ORDER } from './toolbar.js';
import { applyWebsiteTheme } from './appearance.js';
import { renderPalettePreview, renderToolbarPreview, setupPreviewMotion } from './previews.js';

const $ = selector => document.querySelector(selector);
const letters = ['A', 'B', 'C', 'D'];
const toolbarKeys = ['sandbox', 'shoutout', 'scheduler', 'account'];
const toolbarLabels = { account: 'Account box', shoutout: 'Shoutout', scheduler: 'Event Scheduler', sandbox: 'Sandbox', layout: 'Layout', settings: 'Settings' };
const originalDefault = { id: 0, name: 'Default', slug: 'default', colors: ['#156C89', '#AC2F37', '#0D7264', '#A54D30'] };
const state = {
  themes: [originalDefault], selected: new Set(['default']), preview: 'default',
  customs: [], activeCustom: null, nextCustom: 1, assets: null, busy: false,
  toolbarOrder: [...DEFAULT_TOOLBAR_ORDER],
};
const hexPattern = /^#[0-9a-f]{6}$/i;

function setStatus(message, error = false) {
  const status = $('#status');
  status.textContent = message;
  status.classList.toggle('is-error', error);
  status.hidden = !message;
  status.parentElement.hidden = !message && $('#retry').hidden;
}

function toolbarOptions() {
  return Object.fromEntries(toolbarKeys.map(key => [key, $(`#toolbar-${key}`).checked]));
}

function renderToolbar() {
  renderToolbarPreview($('#toolbar-preview'), toolbarOptions(), state.toolbarOrder);
}

function setupToolbarOrder() {
  const list = $('#toolbar-order');
  const rows = new Map();
  let dragging = null;
  for (const key of state.toolbarOrder) {
    const row = document.createElement('li');
    row.className = 'toolbar-order-row'; row.dataset.toolbarKey = key;
    const label = toolbarLabels[key];
    const optional = toolbarKeys.includes(key);
    row.innerHTML = `<span class="toolbar-drag-handle" draggable="true" aria-hidden="true" title="Drag to reorder">⠿</span>${optional
      ? `<label class="toggle-row"><span>${label}</span><input type="checkbox" id="toolbar-${key}" role="switch"><span class="switch" aria-hidden="true"></span></label>`
      : `<span class="toolbar-fixed-name">${label}</span><span class="toolbar-always">Always visible</span>`}<span class="toolbar-move-buttons"><button type="button" data-move="-1" aria-label="Move ${label} earlier" title="Move earlier">↑</button><button type="button" data-move="1" aria-label="Move ${label} later" title="Move later">↓</button></span>`;
    rows.set(key, row); list.append(row);
  }
  function refreshOrder() {
    const focused = list.contains(document.activeElement) ? document.activeElement : null;
    state.toolbarOrder.forEach((key, index) => {
      const row = rows.get(key);
      row.querySelector('[data-move="-1"]').setAttribute('aria-disabled', String(index === 0));
      row.querySelector('[data-move="1"]').setAttribute('aria-disabled', String(index === state.toolbarOrder.length - 1));
      list.append(row);
    });
    focused?.focus({ preventScroll: true });
  }
  function moveTo(key, to) {
    const from = state.toolbarOrder.indexOf(key);
    if (from < 0 || to < 0 || to >= state.toolbarOrder.length || from === to) return;
    state.toolbarOrder.splice(from, 1); state.toolbarOrder.splice(to, 0, key);
    refreshOrder(); renderToolbar();
    $('#toolbar-order-status').textContent = `${toolbarLabels[key]} moved to position ${to + 1} of ${state.toolbarOrder.length}.`;
  }
  function clearDrag() {
    dragging = null;
    rows.forEach(row => row.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after'));
  }
  list.addEventListener('click', event => {
    const button = event.target.closest('button[data-move]');
    if (!button || button.getAttribute('aria-disabled') === 'true') return;
    const key = button.closest('[data-toolbar-key]').dataset.toolbarKey;
    moveTo(key, state.toolbarOrder.indexOf(key) + Number(button.dataset.move));
  });
  list.addEventListener('dragstart', event => {
    const handle = event.target.closest('.toolbar-drag-handle');
    if (!handle) { event.preventDefault(); return; }
    const row = handle.closest('[data-toolbar-key]');
    dragging = row.dataset.toolbarKey;
    event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', dragging);
    event.dataTransfer.setDragImage(row, 20, row.offsetHeight / 2);
    row.classList.add('is-dragging');
  });
  list.addEventListener('dragover', event => {
    const row = event.target.closest('[data-toolbar-key]');
    if (!dragging || !row) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move';
    rows.forEach(item => item.classList.remove('is-drop-before', 'is-drop-after'));
    if (row.dataset.toolbarKey !== dragging) {
      const box = row.getBoundingClientRect();
      row.classList.add(event.clientY < box.top + box.height / 2 ? 'is-drop-before' : 'is-drop-after');
    }
  });
  list.addEventListener('drop', event => {
    const row = event.target.closest('[data-toolbar-key]');
    if (!dragging || !row) return;
    event.preventDefault();
    const from = state.toolbarOrder.indexOf(dragging);
    let to = state.toolbarOrder.indexOf(row.dataset.toolbarKey);
    const box = row.getBoundingClientRect();
    if (event.clientY >= box.top + box.height / 2) to++;
    if (from < to) to--;
    moveTo(dragging, to); clearDrag();
  });
  list.addEventListener('dragend', clearDrag);
  refreshOrder();
}

function renderPresetPreview() {
  const custom = state.customs.find(item => item.key === state.preview);
  const theme = custom ? customTheme(custom) : state.themes.find(theme => theme.slug === state.preview) || originalDefault;
  applyWebsiteTheme(theme);
  $('#preview-title').textContent = theme.name || 'Custom';
  renderPalettePreview($('#preset-preview'), theme);
  document.querySelectorAll('.preset-card').forEach(card => {
    const active = card.dataset.slug === state.preview;
    card.classList.toggle('is-preview', active);
    card.querySelector('.preset-preview').setAttribute('aria-pressed', String(active));
  });
}

function createPresetCard(theme, custom = null) {
  const card = document.createElement('div');
  card.className = 'preset-card'; card.dataset.slug = theme.slug;
  const preview = document.createElement('button');
  preview.type = 'button'; preview.className = 'preset-preview';
  preview.setAttribute('aria-label', `Preview ${theme.name || 'Custom'}`);
  const nameRow = document.createElement('span'); nameRow.className = 'preset-name-row';
  const name = document.createElement('span'); name.className = 'preset-name'; name.textContent = theme.name || 'Custom';
  nameRow.append(name);
  if (theme.slug === 'default') {
    const locked = document.createElement('span'); locked.className = 'locked-label'; locked.textContent = 'LOCKED'; nameRow.append(locked);
  }
  const swatches = document.createElement('span'); swatches.className = 'palette-swatches'; swatches.setAttribute('aria-hidden', 'true');
  theme.colors.forEach(colour => { const swatch = document.createElement('i'); swatch.style.setProperty('--swatch', colour); swatches.append(swatch); });
  preview.append(nameRow, swatches);
  preview.addEventListener('click', () => {
    if (custom) selectCustom(custom.key);
    else { state.preview = theme.slug; renderPresetPreview(); }
  });
  const label = document.createElement('label'); label.className = 'preset-checkbox';
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = custom ? custom.included : state.selected.has(theme.slug); checkbox.disabled = theme.slug === 'default';
  checkbox.setAttribute('aria-label', theme.slug === 'default' ? 'Default is always included' : `Include ${theme.name || 'Custom'}`);
  checkbox.addEventListener('change', () => {
    if (custom) {
      custom.included = checkbox.checked;
      custom.element.querySelector('.custom-include').checked = custom.included;
    } else if (checkbox.checked) state.selected.add(theme.slug); else state.selected.delete(theme.slug);
    updateSummary();
  });
  const face = document.createElement('span'); face.className = 'checkbox-face'; face.setAttribute('aria-hidden', 'true');
  label.append(checkbox, face); card.append(preview, label);
  if (custom) custom.tile = card;
  return card;
}

function renderPresets() {
  $('#presets').replaceChildren(
    ...state.themes.map(theme => createPresetCard(theme)),
    ...state.customs.map(custom => createPresetCard(customTheme(custom), custom)),
  );
  renderPresetPreview();
}

function syncCustomPreset(custom) {
  if (!custom.tile) return;
  const name = custom.name.trim() || 'Custom';
  custom.tile.querySelector('.preset-name').textContent = name;
  custom.tile.querySelector('.preset-preview').setAttribute('aria-label', `Preview ${name}`);
  const checkbox = custom.tile.querySelector('input');
  checkbox.checked = custom.included; checkbox.setAttribute('aria-label', `Include ${name}`);
  custom.tile.querySelectorAll('.palette-swatches i').forEach((swatch, index) => swatch.style.setProperty('--swatch', custom.colors[index]));
}

function customTheme(custom) {
  return { name: custom.name.trim(), slug: custom.key, colors: [...custom.colors] };
}

function selectCustom(key) {
  state.activeCustom = key;
  const custom = state.customs.find(item => item.key === key);
  $('#custom-preview').hidden = !custom;
  $('#custom-preview-heading').hidden = !custom;
  $('#custom-preview-title').textContent = custom ? custom.name.trim() || 'Custom' : '';
  if (custom) {
    state.preview = custom.key;
    renderPalettePreview($('#custom-preview'), customTheme(custom));
    renderPresetPreview();
  } else {
    $('#custom-preview').replaceChildren();
    if (!state.themes.some(theme => theme.slug === state.preview)) {
      state.preview = 'default'; renderPresetPreview();
    }
  }
  state.customs.forEach(item => {
    item.element.classList.toggle('is-preview', item.key === key);
    item.element.querySelector('.custom-preview-button').setAttribute('aria-pressed', String(item.key === key));
  });
}

function validateCustoms() {
  const names = new Map();
  const addName = name => { const key = name.trim().toLowerCase(); names.set(key, (names.get(key) || 0) + 1); };
  state.themes.filter(theme => state.selected.has(theme.slug)).forEach(theme => addName(theme.name));
  state.customs.filter(custom => custom.included).forEach(custom => addName(custom.name));
  let valid = true;
  for (const custom of state.customs) {
    const nameInvalid = !custom.name.trim() || custom.name.trim().length > 64 || /[\u0000-\u001f\u007f]/.test(custom.name);
    const duplicate = names.get(custom.name.trim().toLowerCase()) > 1;
    const invalidColours = custom.rawColors.some(colour => !hexPattern.test(colour.trim()));
    let error = '';
    if (custom.included) {
      if (nameInvalid) error = 'Enter a palette name.';
      else if (duplicate) error = 'Use a different name from the other included palettes.';
      else if (invalidColours) error = 'Use a six-digit hex colour for each deck.';
    }
    custom.element.querySelector('.custom-name').setAttribute('aria-invalid', String(custom.included && (nameInvalid || duplicate)));
    custom.element.querySelectorAll('.hex-input').forEach((input, index) => {
      input.setAttribute('aria-invalid', String(custom.included && !hexPattern.test(custom.rawColors[index].trim())));
    });
    const message = custom.element.querySelector('.custom-error');
    message.textContent = error; message.hidden = !error;
    if (error) valid = false;
  }
  return valid;
}

function updateSummary() {
  const valid = validateCustoms();
  const count = state.selected.size + state.customs.filter(custom => custom.included).length;
  const toolbarCount = Object.values(toolbarOptions()).filter(Boolean).length;
  $('#preset-count').textContent = `${count} included`;
  state.customs.forEach(syncCustomPreset);
  $('#toolbar-count').textContent = `${toolbarCount + 2} visible`;
  $('#download-summary').textContent = `${count} palette${count === 1 ? '' : 's'} · ${toolbarCount} optional control${toolbarCount === 1 ? '' : 's'}`;
  $('#download').disabled = !state.assets || state.busy || !valid;
}

function createCustomCard(custom) {
  const card = document.createElement('article');
  card.className = 'custom-card'; card.dataset.customId = custom.key;
  // Only generated keys enter this template; user-provided names use text/value.
  card.innerHTML = `<div class="custom-card-head"><label class="custom-name-label"><span class="sr-only">Preset name</span><input class="custom-name" type="text" maxlength="40" autocomplete="off" spellcheck="false" aria-describedby="${custom.key}-error"></label><div class="custom-actions"><label class="custom-enable"><input type="checkbox" class="custom-include" checked><span class="checkbox-face" aria-hidden="true"></span><span>Include</span></label><button type="button" class="custom-preview-button" aria-pressed="false">Preview</button><button type="button" class="custom-remove">Remove</button></div></div><div class="custom-colours"></div><p class="custom-error field-error" id="${custom.key}-error" role="alert" hidden></p>`;
  custom.element = card;
  const name = card.querySelector('.custom-name');
  name.value = custom.name;
  name.addEventListener('input', () => {
    custom.name = name.value; selectCustom(custom.key); updateSummary();
  });
  const include = card.querySelector('.custom-include');
  include.addEventListener('change', () => { custom.included = include.checked; updateSummary(); });
  card.querySelector('.custom-preview-button').addEventListener('click', () => selectCustom(custom.key));
  card.querySelector('.custom-remove').addEventListener('click', () => {
    const index = state.customs.indexOf(custom);
    state.customs.splice(index, 1); card.remove(); custom.tile?.remove();
    if (state.preview === custom.key) { state.preview = 'default'; renderPresetPreview(); }
    if (state.activeCustom === custom.key) selectCustom(state.customs[Math.min(index, state.customs.length - 1)]?.key || null);
    updateSummary();
    if (!state.customs.length) $('#add-custom').focus();
  });
  card.querySelector('.custom-colours').append(...letters.map((letter, index) => {
    const field = document.createElement('div'); field.className = 'colour-field';
    const label = document.createElement('label'); label.className = 'colour-field-label'; label.htmlFor = `${custom.key}-colour-${letter}`; label.textContent = `Deck ${letter}`;
    const wrap = document.createElement('div'); wrap.className = 'colour-swatch-wrap';
    const picker = document.createElement('input'); picker.type = 'color'; picker.id = label.htmlFor; picker.className = 'colour-picker'; picker.value = custom.colors[index]; picker.dataset.deck = letter;
    const hex = document.createElement('input'); hex.type = 'text'; hex.className = 'hex-input'; hex.value = custom.rawColors[index]; hex.maxLength = 7; hex.spellcheck = false; hex.autocomplete = 'off'; hex.dataset.deck = letter;
    hex.setAttribute('aria-label', `Deck ${letter} hex colour`); hex.setAttribute('aria-describedby', `${custom.key}-error`);
    const changed = value => {
      custom.rawColors[index] = value;
      custom.included = true; include.checked = true;
      if (hexPattern.test(value.trim())) { custom.colors[index] = value.trim().toUpperCase(); picker.value = custom.colors[index]; }
      selectCustom(custom.key); updateSummary();
    };
    picker.addEventListener('input', () => { hex.value = picker.value.toUpperCase(); changed(hex.value); });
    hex.addEventListener('input', () => changed(hex.value));
    hex.addEventListener('blur', () => {
      if (hexPattern.test(hex.value.trim())) { hex.value = hex.value.trim().toUpperCase(); custom.rawColors[index] = hex.value; }
    });
    wrap.append(picker); field.append(label, wrap, hex); return field;
  }));
  return card;
}

function addCustom() {
  const existingNames = new Set([...state.themes, ...state.customs].map(item => item.name.trim().toLowerCase()));
  let number = state.nextCustom++;
  while (existingNames.has(`custom ${number}`)) number = state.nextCustom++;
  const active = state.customs.find(custom => custom.key === state.activeCustom);
  const preset = state.themes.find(theme => theme.slug === state.preview && theme.slug !== 'default');
  const colors = [...(active?.colors || preset?.colors || ['#E98DB6', '#89BFF0', '#B69BE4', '#F2C48F'])];
  const custom = { key: `custom-${number}`, name: `Custom ${number}`, colors, rawColors: [...colors], included: true };
  state.customs.push(custom);
  $('#custom-presets').append(createCustomCard(custom));
  $('#presets').append(createPresetCard(customTheme(custom), custom));
  selectCustom(custom.key); updateSummary();
  custom.element.querySelector('.custom-name').focus();
}

async function fetchAsset(name, binary = false) {
  const response = await fetch(new URL(`./assets/${name}`, import.meta.url));
  if (!response.ok) throw new Error(`Could not load ${name} (${response.status}).`);
  return binary ? new Uint8Array(await response.arrayBuffer()) : response.text();
}

async function loadAssets() {
  $('#retry').hidden = true;
  setStatus('Loading…');
  try {
    const [themesText, xml, image, icons] = await Promise.all([
      fetchAsset('themes.json'), fetchAsset('Pro.xml'), fetchAsset('gfx-pro.png', true), fetchAsset('icons_daylight.png', true),
    ]);
    state.themes = normaliseThemes(JSON.parse(themesText));
    state.selected = new Set(state.themes.map(theme => theme.slug));
    state.assets = { xml, image, icons };
    renderPresets(); updateSummary(); setStatus('');
  } catch (error) {
    state.assets = null; updateSummary();
    $('#retry').hidden = false;
    setStatus(`${error.message} Try again.`, true);
  }
}

async function downloadSkin() {
  if (!state.assets || !validateCustoms() || state.busy) return;
  state.busy = true; updateSummary();
  $('#download span').textContent = 'Building…';
  setStatus('Building ZIP…');
  try {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const themes = state.themes.filter(theme => theme.slug === 'default' || state.selected.has(theme.slug));
    themes.push(...state.customs.filter(custom => custom.included).map(customTheme));
    let xml = generateSkinXml(state.assets.xml, themes);
    xml = applyToolbar(xml, toolbarOptions(), state.toolbarOrder);
    xml = xml.replace(/(<skin\s[^>]*\bname=")[^"]*(")/, '$1Pro Pure Black Custom$2');
    const bytes = createSkinZip([
      { name: 'Pro.xml', data: xml },
      { name: 'gfx-pro.png', data: state.assets.image },
      { name: 'icons_daylight.png', data: state.assets.icons },
    ]);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const link = document.createElement('a'); link.href = url; link.download = 'pro-pure-black-custom.zip'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    setStatus('ZIP downloaded.');
  } catch (error) {
    setStatus(`Could not build the skin. ${error.message}`, true);
  } finally {
    state.busy = false; $('#download span').textContent = 'Download skin'; updateSummary();
  }
}

setupPreviewMotion();
setupToolbarOrder();
toolbarKeys.forEach(key => $(`#toolbar-${key}`).addEventListener('change', () => {
  renderToolbar(); updateSummary();
}));
$('#add-custom').addEventListener('click', addCustom);
$('#select-all').addEventListener('click', () => {
  state.selected = new Set(state.themes.map(theme => theme.slug));
  state.customs.forEach(custom => { custom.included = true; custom.element.querySelector('.custom-include').checked = true; });
  renderPresets(); updateSummary();
});
$('#select-default').addEventListener('click', () => {
  state.selected = new Set(['default']);
  state.customs.forEach(custom => { custom.included = false; custom.element.querySelector('.custom-include').checked = false; });
  renderPresets(); updateSummary();
});
$('#download').addEventListener('click', downloadSkin);
$('#retry').addEventListener('click', loadAssets);
renderPresets();
renderToolbar();
updateSummary();
loadAssets();

import { generateSkinXml, createSkinZip, normaliseThemes, SKIN_README } from './generator.js';
import { applyToolbar, DEFAULT_TOOLBAR_ORDER } from './toolbar.js';
import { STATUS_KEYS } from './status.js';
import { applyWebsiteTheme } from './appearance.js';
import { CUSTOM_START_COLORS, randomPalette } from './custom-palettes.js';
import { prepareLogo } from './logo-image.js';
import { addLogoToSkin } from './logo-skin.js';
import { logoColour } from './logo-colour.js';
import { renderPalettePreview, renderToolbarPreview, setupPreviewMotion } from './previews.js';

const $ = selector => document.querySelector(selector);
const letters = ['A', 'B', 'C', 'D'];
const toolbarKeys = ['sandbox', 'shoutout', 'scheduler', 'account'];
const toolbarToggleKeys = [...toolbarKeys, ...STATUS_KEYS];
const toolbarLabels = { account: 'Account', shoutout: 'Shoutout', scheduler: 'Event Scheduler', sandbox: 'Sandbox', layout: 'Layout', settings: 'Settings' };
const paletteGroups = [{ id: 'aesthetic', name: 'Aesthetic' }, { id: 'pastel', name: 'Pastel' }, { id: 'bold', name: 'Bold' }];
const originalDefault = { id: 0, name: 'Default', slug: 'default', colors: ['#156C89', '#AC2F37', '#0D7264', '#A54D30'] };
const state = {
  themes: [originalDefault], selected: new Set(['default']), preview: 'default',
  customs: [], draft: null, nextCustom: 1, assets: null, busy: false,
  toolbarOrder: [...DEFAULT_TOOLBAR_ORDER], notchPreview: true,
  logo: null, logoBusy: false, logoTint: true,
};
const hexPattern = /^#[0-9a-f]{6}$/i;
let toolbarPreviewSignature = '';
let logoRequest = 0;

function setStatus(message, error = false) {
  const status = $('#status');
  const visible = error && Boolean(message);
  status.textContent = visible ? message : '';
  status.classList.toggle('is-error', visible);
  status.hidden = !visible;
  status.parentElement.hidden = !visible && $('#retry').hidden;
}

function toolbarOptions() {
  return Object.fromEntries(toolbarToggleKeys.map(key => [key, $(`#toolbar-${key}`).checked]));
}

function activePreviewTheme() {
  if (state.draft && state.preview === state.draft.key) return customTheme(state.draft);
  const custom = state.customs.find(item => item.key === state.preview);
  return custom ? customTheme(custom) : state.themes.find(theme => theme.slug === state.preview) || originalDefault;
}

function renderToolbar() {
  const container = $('#toolbar-preview');
  const options = toolbarOptions();
  const theme = activePreviewTheme();
  const display = { notch: state.notchPreview, colors: theme.colors, logo: state.logo?.dataUrl || null, logoColour: logoColour(theme), logoTint: state.logoTint };
  const signature = JSON.stringify([options, state.toolbarOrder, display]);
  if (signature === toolbarPreviewSignature && container.childElementCount) return;
  renderToolbarPreview(container, options, state.toolbarOrder, display);
  toolbarPreviewSignature = signature;
}

function updateToolbarFit(fit) {
  const status = $('#toolbar-fit-status');
  const message = !fit.fits ? 'Controls overlap in this preview.' : '';
  if (status.textContent !== message) status.textContent = message;
  status.hidden = !message;
  status.classList.toggle('is-error', !fit.fits);
  return fit;
}

function setupDisplayPreview() {
  $('#toolbar-preview').addEventListener('toolbarlayoutchange', event => updateToolbarFit(event.detail));
  $('#toolbar-notch-preview').addEventListener('click', event => {
    state.notchPreview = !state.notchPreview;
    event.currentTarget.setAttribute('aria-pressed', String(state.notchPreview));
    renderToolbar(); updateSummary();
  });
}

function setLogoStatus(message, error = false) {
  const status = $('#custom-logo-status');
  status.textContent = error ? message : ''; status.hidden = !error || !message;
  status.classList.toggle('is-error', error);
}

function updateLogoControls() {
  $('#custom-logo-remove').disabled = !state.logo && !state.logoBusy;
  $('#custom-logo-upload').setAttribute('aria-busy', String(state.logoBusy));
}

function setupLogoUpload() {
  const input = $('#custom-logo-upload');
  $('#logo-tint').addEventListener('click', event => {
    state.logoTint = !state.logoTint;
    event.currentTarget.setAttribute('aria-pressed', String(state.logoTint));
    renderToolbar();
  });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    input.value = '';
    const request = ++logoRequest;
    state.logoBusy = true;
    setLogoStatus('');
    updateLogoControls(); updateSummary();
    try {
      const logo = await prepareLogo(file);
      if (request !== logoRequest) return;
      state.logo = logo;
      setLogoStatus('');
      renderToolbar();
    } catch (error) {
      if (request !== logoRequest) return;
      setLogoStatus(`${error.message}${state.logo ? ' Previous logo kept.' : ''}`, true);
    } finally {
      if (request === logoRequest) {
        state.logoBusy = false;
        updateLogoControls(); updateSummary();
      }
    }
  });
  $('#custom-logo-remove').addEventListener('click', () => {
    logoRequest++;
    state.logo = null; state.logoBusy = false; input.value = '';
    setLogoStatus('');
    updateLogoControls(); renderToolbar(); updateSummary();
  });
  updateLogoControls();
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
      : `<span class="toolbar-fixed-name">${label}</span>`}<span class="toolbar-move-buttons"><button type="button" data-move="-1" aria-label="Move ${label} earlier" title="Move earlier">↑</button><button type="button" data-move="1" aria-label="Move ${label} later" title="Move later">↓</button></span>`;
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
    refreshOrder(); renderToolbar(); updateSummary();
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
  const theme = activePreviewTheme();
  applyWebsiteTheme(theme);
  renderPalettePreview($('#preset-preview'), theme);
  document.querySelectorAll('.preset-card').forEach(card => {
    const active = card.dataset.slug === state.preview;
    card.classList.toggle('is-preview', active);
    card.querySelector('.preset-preview').setAttribute('aria-pressed', String(active));
  });
  state.draft?.element.classList.toggle('is-preview', state.preview === state.draft.key);
  renderToolbar();
}

function createPresetCard(theme, custom = null) {
  const card = document.createElement('div');
  card.className = 'preset-card'; card.dataset.slug = theme.slug;
  const preview = document.createElement('button');
  preview.type = 'button'; preview.className = 'preset-preview';
  preview.setAttribute('aria-label', `Preview ${theme.name || 'Custom'}`);
  const nameRow = document.createElement('span'); nameRow.className = 'preset-name-row';
  const name = document.createElement('span'); name.className = 'preset-name';
  const groupName = paletteGroups.find(group => group.id === theme.group)?.name;
  name.textContent = groupName && theme.name.startsWith(`${groupName} `) ? theme.name.slice(groupName.length + 1) : theme.name || 'Custom';
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
    } else if (checkbox.checked) state.selected.add(theme.slug); else state.selected.delete(theme.slug);
    updateSummary();
  });
  const face = document.createElement('span'); face.className = 'checkbox-face'; face.setAttribute('aria-hidden', 'true');
  label.append(checkbox, face); card.append(preview, label);
  if (custom) custom.tile = card;
  return card;
}

function renderPresets() {
  const personal = document.createElement('div'); personal.id = 'personal-presets'; personal.className = 'preset-grid';
  personal.append(...state.themes.filter(theme => !theme.group).map(theme => createPresetCard(theme)),
    ...state.customs.map(custom => createPresetCard(customTheme(custom), custom)));
  const groups = paletteGroups.flatMap(group => {
    const themes = state.themes.filter(theme => theme.group === group.id);
    if (!themes.length) return [];
    const section = document.createElement('section'); section.className = 'palette-group'; section.dataset.paletteGroup = group.id;
    section.setAttribute('aria-labelledby', `palette-group-${group.id}`);
    const heading = document.createElement('div'); heading.className = 'palette-group-heading';
    const title = document.createElement('h2'); title.id = `palette-group-${group.id}`; title.className = 'palette-group-title'; title.textContent = group.name;
    const label = document.createElement('label'); label.className = 'palette-group-select';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.id = `select-${group.id}`; checkbox.dataset.selectGroup = group.id;
    checkbox.setAttribute('aria-label', `Include all ${group.name} palettes`);
    checkbox.addEventListener('change', () => {
      themes.forEach(theme => checkbox.checked ? state.selected.add(theme.slug) : state.selected.delete(theme.slug));
      updateSummary();
    });
    label.append(checkbox, document.createTextNode('All'));
    heading.append(title, label);
    const grid = document.createElement('div'); grid.className = 'preset-grid';
    grid.append(...themes.map(theme => createPresetCard(theme)));
    section.append(heading, grid); return section;
  });
  $('#presets').replaceChildren(personal, ...groups);
  syncPaletteSelection();
  renderPresetPreview();
}

function syncPaletteSelection() {
  for (const theme of state.themes) {
    const input = document.querySelector(`#presets [data-slug="${theme.slug}"] input`);
    if (input) input.checked = state.selected.has(theme.slug);
  }
  for (const group of paletteGroups) {
    const input = $(`#select-${group.id}`);
    if (!input) continue;
    const themes = state.themes.filter(theme => theme.group === group.id);
    const selected = themes.filter(theme => state.selected.has(theme.slug)).length;
    input.checked = selected === themes.length;
    input.indeterminate = selected > 0 && selected < themes.length;
  }
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
  if (!state.customs.some(custom => custom.key === key)) return;
  state.preview = key; renderPresetPreview();
}

function previewDraft() {
  state.preview = state.draft.key; renderPresetPreview();
}

function validateDraft() {
  const draft = state.draft;
  if (!draft) return false;
  const name = draft.name.trim();
  const nameInvalid = !name || name.length > 64 || /[\u0000-\u001f\u007f]/.test(name);
  const duplicate = [...state.themes, ...state.customs].some(theme => theme.name.trim().toLowerCase() === name.toLowerCase());
  const invalidColours = draft.rawColors.some(colour => !hexPattern.test(colour.trim()));
  const error = nameInvalid ? 'Enter a palette name.' : duplicate
    ? 'Use a different name from the other palettes.' : invalidColours
      ? 'Use a six-digit hex colour for each deck.' : '';
  draft.element.querySelector('.custom-name').setAttribute('aria-invalid', String(nameInvalid || duplicate));
  draft.element.querySelectorAll('.hex-input').forEach((input, index) => {
    input.setAttribute('aria-invalid', String(!hexPattern.test(draft.rawColors[index].trim())));
  });
  const message = draft.element.querySelector('.custom-error');
  message.textContent = error; message.hidden = !error;
  $('#add-custom').disabled = !state.assets || Boolean(error);
  return !error;
}

function updateSummary() {
  validateDraft();
  const count = state.selected.size + state.customs.filter(custom => custom.included).length;
  const toolbarCount = Object.values(toolbarOptions()).filter(Boolean).length;
  $('#preset-count').textContent = `${count} included`;
  state.customs.forEach(syncCustomPreset);
  syncPaletteSelection();
  $('#toolbar-count').textContent = `${toolbarCount + 2} included`;
  $('#download-summary').textContent = `${count} palette${count === 1 ? '' : 's'} · ${toolbarCount + 2} controls`;
  $('#download').disabled = !state.assets || state.busy || state.logoBusy;
}

function createDraftCard(draft) {
  const card = document.createElement('article');
  card.className = 'custom-card'; card.dataset.customId = 'draft';
  card.innerHTML = `<div class="custom-card-head"><label class="custom-name-label"><span class="sr-only">Preset name</span><input class="custom-name" type="text" maxlength="64" autocomplete="off" spellcheck="false" aria-describedby="custom-draft-error"></label><div class="custom-actions"><button type="button" class="custom-randomise">Random</button><button id="add-custom" class="add-button" type="button" aria-label="Add preset" title="Add preset" disabled>+</button></div></div><div class="custom-colours"></div><p class="custom-error field-error" id="custom-draft-error" role="alert" hidden></p>`;
  draft.element = card;
  const name = card.querySelector('.custom-name');
  name.addEventListener('input', () => {
    draft.name = name.value; previewDraft(); updateSummary();
  });
  card.querySelector('.custom-randomise').addEventListener('click', () => {
    const colors = randomPalette();
    draft.colors = [...colors]; draft.rawColors = [...colors];
    letters.forEach((letter, index) => {
      card.querySelector(`.colour-picker[data-deck="${letter}"]`).value = colors[index];
      card.querySelector(`.hex-input[data-deck="${letter}"]`).value = colors[index];
    });
    previewDraft(); updateSummary();
  });
  card.querySelector('.custom-colours').append(...letters.map((letter, index) => {
    const field = document.createElement('div'); field.className = 'colour-field';
    const label = document.createElement('label'); label.className = 'colour-field-label'; label.htmlFor = `custom-draft-colour-${letter}`; label.textContent = `Deck ${letter}`;
    const wrap = document.createElement('div'); wrap.className = 'colour-swatch-wrap';
    const picker = document.createElement('input'); picker.type = 'color'; picker.id = label.htmlFor; picker.className = 'colour-picker'; picker.dataset.deck = letter;
    const hex = document.createElement('input'); hex.type = 'text'; hex.className = 'hex-input'; hex.maxLength = 7; hex.spellcheck = false; hex.autocomplete = 'off'; hex.dataset.deck = letter;
    hex.setAttribute('aria-label', `Deck ${letter} hex colour`); hex.setAttribute('aria-describedby', 'custom-draft-error');
    const changed = value => {
      draft.rawColors[index] = value;
      if (hexPattern.test(value.trim())) { draft.colors[index] = value.trim().toUpperCase(); picker.value = draft.colors[index]; }
      previewDraft(); updateSummary();
    };
    picker.addEventListener('input', () => { hex.value = picker.value.toUpperCase(); changed(hex.value); });
    hex.addEventListener('input', () => changed(hex.value));
    hex.addEventListener('blur', () => {
      if (hexPattern.test(hex.value.trim())) { hex.value = hex.value.trim().toUpperCase(); draft.rawColors[index] = hex.value; }
    });
    wrap.append(picker); field.append(label, wrap, hex); return field;
  }));
  return card;
}

function resetDraft() {
  const names = new Set([...state.themes, ...state.customs].map(theme => theme.name.trim().toLowerCase()));
  let number = state.nextCustom++;
  while (names.has(`custom ${number}`)) number = state.nextCustom++;
  const draft = state.draft || { key: 'custom-draft' };
  Object.assign(draft, { number, name: `Custom ${number}`, colors: [...CUSTOM_START_COLORS], rawColors: [...CUSTOM_START_COLORS] });
  state.draft = draft;
  if (!draft.element) $('#custom-presets').append(createDraftCard(draft));
  draft.element.querySelector('.custom-name').value = draft.name;
  letters.forEach((letter, index) => {
    draft.element.querySelector(`.colour-picker[data-deck="${letter}"]`).value = draft.colors[index];
    draft.element.querySelector(`.hex-input[data-deck="${letter}"]`).value = draft.rawColors[index];
  });
  validateDraft();
}

function addCustom() {
  if (!state.assets || !validateDraft()) return;
  const draft = state.draft;
  const custom = { key: `custom-${draft.number}`, name: draft.name.trim(), colors: draft.rawColors.map(colour => colour.trim().toUpperCase()), included: true };
  state.customs.push(custom);
  $('#personal-presets').append(createPresetCard(customTheme(custom), custom));
  state.preview = custom.key;
  resetDraft(); renderPresetPreview(); updateSummary();
  state.draft.element.querySelector('.custom-name').focus();
}

async function fetchAsset(name, binary = false) {
  const response = await fetch(new URL(`./assets/${name}`, import.meta.url), { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Could not load ${name} (${response.status}).`);
  return binary ? new Uint8Array(await response.arrayBuffer()) : response.text();
}

async function loadAssets() {
  $('#retry').hidden = true;
  setStatus('');
  try {
    const [themesText, xml, image, icons] = await Promise.all([
      fetchAsset('themes.json'), fetchAsset('Pro.xml'), fetchAsset('gfx-pro.png', true), fetchAsset('icons_daylight.png', true),
    ]);
    state.themes = normaliseThemes(JSON.parse(themesText));
    state.selected = new Set(['default']);
    state.assets = { xml, image, icons };
    renderPresets(); updateSummary(); setStatus('');
  } catch (error) {
    state.assets = null; updateSummary();
    $('#retry').hidden = false;
    setStatus(`${error.message} Try again.`, true);
  }
}

async function downloadSkin() {
  if (!state.assets || state.busy || state.logoBusy) return;
  const configuration = {
    assets: state.assets, logo: state.logo, logoTint: state.logoTint, toolbar: toolbarOptions(), order: [...state.toolbarOrder],
    themes: [...state.themes.filter(theme => theme.slug === 'default' || state.selected.has(theme.slug)),
      ...state.customs.filter(custom => custom.included).map(customTheme)],
  };
  state.busy = true; updateSummary();
  $('#download span').textContent = 'Building…';
  setStatus('');
  try {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    let xml = generateSkinXml(configuration.assets.xml, configuration.themes);
    xml = applyToolbar(xml, configuration.toolbar, configuration.order);
    let image = configuration.assets.image;
    if (configuration.logo) ({ xml, image } = await addLogoToSkin(xml, image, configuration.logo, configuration.toolbar, configuration.logoTint ? configuration.themes : undefined));
    xml = xml.replace(/(<skin\s[^>]*\bname=")[^"]*(")/, '$1Pro Pure Black Custom$2');
    const bytes = createSkinZip([
      { name: 'Pro.xml', data: xml },
      { name: 'gfx-pro.png', data: image },
      { name: 'icons_daylight.png', data: configuration.assets.icons },
      { name: 'README.txt', data: SKIN_README },
    ]);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const link = document.createElement('a'); link.href = url; link.download = 'pro-pure-black-custom.zip'; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) {
    setStatus(`Could not build the skin. ${error.message}`, true);
  } finally {
    state.busy = false; $('#download span').textContent = 'Download skin'; updateSummary();
  }
}

setupPreviewMotion();
setupToolbarOrder();
setupDisplayPreview();
setupLogoUpload();
resetDraft();
toolbarToggleKeys.forEach(key => $(`#toolbar-${key}`).addEventListener('change', () => {
  renderToolbar(); updateSummary();
}));
$('#add-custom').addEventListener('click', addCustom);
$('#select-all').addEventListener('click', () => {
  state.selected = new Set(state.themes.map(theme => theme.slug));
  state.customs.forEach(custom => { custom.included = true; });
  renderPresets(); updateSummary();
});
$('#select-default').addEventListener('click', () => {
  state.selected = new Set(['default']);
  state.customs.forEach(custom => { custom.included = false; });
  renderPresets(); updateSummary();
});
$('#download').addEventListener('click', downloadSkin);
$('#retry').addEventListener('click', loadAssets);
renderPresets();
renderToolbar();
updateSummary();
loadAssets();

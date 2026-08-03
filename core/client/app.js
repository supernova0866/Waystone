import { checkSession, login, logout, fetchCategories, createCategory, saveCategory, deleteCategory, fetchItems, createItem, saveItem, deleteItem, createInvite, listUsers, changePassword } from '/core/client/api.js';
import { unlockVault, lockVault, isUnlocked, encryptItemData, decryptItemData } from '/core/client/crypto.js';
import { createItemCard, renderFieldRow } from '/core/client/items.js';
import { renderSidebarList, newCategoryId, newFieldId, FIELD_TYPES, SECRET_SUBTYPES, pickTitleFields } from '/core/client/categories.js';
import { buildIsel } from '/core/client/isel.js';
import { parseBackupCodes, consumeCode } from '/core/client/backup-codes.js';
import { initParticles, setParticlesEnabled, refreshParticlesForTheme } from '/core/client/particles.js';

const state = {
  username: null,
  role: null,
  categories: [],
  activeCategoryId: null,
  items: [],
  disposers: [],
};

const el = {
  loginGate: document.getElementById('login-gate'),
  loginForm: document.getElementById('login-form'),
  loginError: document.getElementById('login-error'),
  loginUsername: document.getElementById('login-username'),
  loginPassword: document.getElementById('login-password'),
  loginSubmit: document.getElementById('login-submit'),

  unlockGate: document.getElementById('unlock-gate'),
  unlockForm: document.getElementById('unlock-form'),
  unlockError: document.getElementById('unlock-error'),
  unlockUsernameLabel: document.getElementById('unlock-username-label'),
  unlockPassword: document.getElementById('unlock-password'),
  unlockSubmit: document.getElementById('unlock-submit'),

  app: document.getElementById('app-shell'),
  sidebar: document.getElementById('app-sidebar'),
  sidebarToggleBtn: document.getElementById('sidebar-toggle-btn'),
  topbarSidebarToggle: document.getElementById('topbar-sidebar-toggle'),
  sidebarList: document.getElementById('sidebar-list'),
  topbarTitle: document.getElementById('topbar-title'),
  cardGrid: document.getElementById('card-grid'),
  addItemBtn: document.getElementById('add-item-btn'),
  editSchemaBtn: document.getElementById('edit-schema-btn'),
  addCategoryBtn: document.getElementById('add-category-btn'),
  lockBtn: document.getElementById('lock-btn'),
  logoutBtn: document.getElementById('logout-btn'),
  modalBackdrop: document.getElementById('item-modal-backdrop'),
  modalBody: document.getElementById('item-modal-body'),
  schemaModalBackdrop: document.getElementById('schema-modal-backdrop'),
  schemaModalBody: document.getElementById('schema-modal-body'),
  schemaModalTitle: document.getElementById('schema-modal-title'),
  schemaModalClose: document.getElementById('schema-modal-close'),
  settingsBtn: document.getElementById('settings-btn'),
  settingsModalBackdrop: document.getElementById('settings-modal-backdrop'),
  settingsModalBody: document.getElementById('settings-modal-body'),
  settingsModalClose: document.getElementById('settings-modal-close'),
  categoryModalBackdrop: document.getElementById('category-modal-backdrop'),
  categoryModalBody: document.getElementById('category-modal-body'),
  categoryModalClose: document.getElementById('category-modal-close'),
  viewModalBackdrop: document.getElementById('view-modal-backdrop'),
  viewModalBody: document.getElementById('view-modal-body'),
  viewModalClose: document.getElementById('view-modal-close'),
};

function hideAllGates() {
  el.loginGate.style.display = 'none';
  el.unlockGate.style.display = 'none';
  el.app.style.display = 'none';
}

function clearItemDisposers() {
  state.disposers.forEach(fn => fn());
  state.disposers = [];
}

function resetState() {
  clearItemDisposers();
  state.categories = [];
  state.activeCategoryId = null;
  state.items = [];
}

async function showApp() {
  hideAllGates();
  el.app.style.display = '';
  await loadCategories();

  if (window.location.pathname === '/settings') {
    history.replaceState(null, '', '/');
    openSettingsModal();
  }
}

function showLoginGate() {
  hideAllGates();
  el.loginGate.style.display = '';
  el.loginUsername.value = '';
  el.loginPassword.value = '';
  el.loginUsername.focus();
}

function showUnlockGate(username) {
  hideAllGates();
  el.unlockGate.style.display = '';
  el.unlockUsernameLabel.textContent = username;
  el.unlockPassword.value = '';
  el.unlockPassword.focus();
}

function handleSessionExpired() {
  lockVault();
  resetState();
  showLoginGate();
}

async function withSessionGuard(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.status === 401) {
      handleSessionExpired();
      return null;
    }
    throw err;
  }
}

async function loadCategories() {
  const result = await withSessionGuard(() => fetchCategories());
  if (result === null) return;
  state.categories = result;

  if (!state.activeCategoryId && state.categories.length) {
    state.activeCategoryId = state.categories[0].id;
  }
  if (state.activeCategoryId && !state.categories.find(c => c.id === state.activeCategoryId)) {
    state.activeCategoryId = state.categories[0]?.id || null;
  }

  renderSidebarList(el.sidebarList, state.categories, state.activeCategoryId, selectCategory);
  updateTopbar();
  updateAddItemAvailability();

  if (state.categories.length === 0) {
    el.cardGrid.innerHTML = '<div class="empty-state"><div class="es-icon">📁</div>No categories yet — create one to get started.</div>';
    return;
  }

  if (state.activeCategoryId) await loadItems();
}

function updateTopbar() {
  const category = activeCategory();
  el.topbarTitle.textContent = category ? category.name : 'WayStone';
}

function updateAddItemAvailability() {
  el.addItemBtn.disabled = !state.activeCategoryId;
  el.editSchemaBtn.disabled = !state.activeCategoryId;
}

async function selectCategory(id) {
  state.activeCategoryId = id;
  renderSidebarList(el.sidebarList, state.categories, state.activeCategoryId, selectCategory);
  updateTopbar();
  updateAddItemAvailability();
  await loadItems();
}

function activeCategory() {
  return state.categories.find(c => c.id === state.activeCategoryId) || null;
}

async function loadItems() {
  clearItemDisposers();
  const categoryId = state.activeCategoryId;
  const category = activeCategory();

  const knownCount = category?.itemCount ?? state.items.length;
  renderSkeletons(knownCount > 0 ? knownCount : 1);

  const rows = await withSessionGuard(() => fetchItems(categoryId));
  if (rows === null) return;
  if (state.activeCategoryId !== categoryId) return; // user already switched tabs again

  if (rows.length === 0) {
    state.items = [];
    renderGrid(category, []);
    return;
  }

  if (rows.length !== knownCount) renderSkeletons(rows.length);
  state.items = new Array(rows.length);

  await Promise.all(rows.map(async (row, idx) => {
    let data;
    try {
      data = await decryptItemData(row);
    } catch (e) {
      data = { title: '⚠ Could not decrypt', fields: {} };
    }
    if (state.activeCategoryId !== categoryId) return; // stale — a newer tab is active now
    state.items[idx] = { item: row, data };
    swapSkeletonForCard(idx, category, row, data);
  }));
}

function renderSkeletons(count) {
  el.cardGrid.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const skeleton = document.createElement('div');
    skeleton.className = 'item-card item-card-skeleton';
    skeleton.innerHTML = `
      <div class="skeleton-line skeleton-title"></div>
      <div class="skeleton-line skeleton-sub"></div>
      <div class="skeleton-block"></div>
      <div class="skeleton-line"></div>
      <div class="skeleton-line short"></div>
    `;
    el.cardGrid.appendChild(skeleton);
  }
}

function swapSkeletonForCard(idx, category, item, data) {
  const { card, dispose } = createItemCard(item, category, data, {
    onOpen: (item) => openEditor(item, data),
    onView: (item, category, data) => openViewModal(item, category, data),
    onConsumeBackupCode: (item, field, codes) => consumeBackupCode(item, data, field, codes),
  });
  state.disposers.push(dispose);

  const slot = el.cardGrid.children[idx];
  if (slot) slot.replaceWith(card);
  else el.cardGrid.appendChild(card);
}

function renderGrid(category, decryptedItems) {
  el.cardGrid.innerHTML = '';

  if (decryptedItems.length === 0) {
    el.cardGrid.innerHTML = `<div class="empty-state"><div class="es-icon">${category?.icon || '📄'}</div>No items in ${category?.name || 'this category'} yet.</div>`;
    return;
  }

  decryptedItems.forEach(({ item, data }, idx) => swapSkeletonForCard(idx, category, item, data));
}

async function consumeBackupCode(item, data, field, codes) {
  const { code, remaining } = consumeCode(codes || []);
  if (code) navigator.clipboard?.writeText(code).catch(() => {});
  data.fields[field.id] = remaining;
  const enc = await encryptItemData(data);
  await withSessionGuard(() => saveItem({ id: item.id, categoryId: item.categoryId, ...enc }));
  return remaining;
}

function fieldInput(field, value) {
  if (field.type === 'integer') {
    const i = document.createElement('input');
    i.className = 'input'; i.type = 'number'; i.value = value ?? '';
    return { el: i, get: () => i.value };
  }
  if (field.type === 'rich-text') {
    const t = document.createElement('textarea');
    t.className = 'textarea'; t.value = value ?? '';
    return { el: t, get: () => t.value };
  }
  if (field.type === 'secret' && field.subtype === 'backup-codes') {
    const t = document.createElement('textarea');
    t.className = 'textarea';
    t.placeholder = 'Paste comma-separated codes';
    t.value = Array.isArray(value) ? value.join(', ') : '';
    return { el: t, get: () => parseBackupCodes(t.value) };
  }
  const i = document.createElement('input');
  i.className = 'input'; i.type = 'text'; i.value = value ?? '';
  if (field.type === 'secret' && field.subtype === 'totp') i.placeholder = 'Base32 secret';
  return { el: i, get: () => i.value };
}

function openEditor(item, data) {
  const category = activeCategory();
  el.modalBody.innerHTML = '';

  const { titleField: titleFieldDef, subtitleField: subtitleFieldDef } = pickTitleFields(category?.fields);

  if (!category?.fields?.length) {
    const note = document.createElement('p');
    note.className = 'hint';
    note.innerHTML = `This category has no custom fields yet — <a href="#" id="modal-edit-schema-link">edit its schema</a>.`;
    el.modalBody.appendChild(note);
    note.querySelector('#modal-edit-schema-link').addEventListener('click', (e) => {
      e.preventDefault();
      closeEditor();
      openSchemaEditor(category);
    });
  } else if (titleFieldDef) {
    const note = document.createElement('p');
    note.className = 'hint';
    note.style.marginBottom = '16px';
    note.textContent = subtitleFieldDef
      ? `"${titleFieldDef.name}" is this card's title, "${subtitleFieldDef.name}" is its subtitle.`
      : `"${titleFieldDef.name}" is this card's title.`;
    el.modalBody.appendChild(note);
  }

  const getters = {};
  for (const field of category?.fields || []) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const label = document.createElement('label');
    label.className = 'field-label';
    label.textContent = field.name;
    wrap.appendChild(label);
    const { el: inputEl, get } = fieldInput(field, data.fields?.[field.id]);
    wrap.appendChild(inputEl);
    el.modalBody.appendChild(wrap);
    getters[field.id] = get;
  }

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  actions.innerHTML = `
    ${item.id ? '<button class="btn btn-danger" id="modal-delete">Delete</button>' : ''}
    <div class="modal-spacer"></div>
    <button class="btn btn-ghost" id="modal-cancel">Cancel</button>
    <button class="btn btn-primary" id="modal-save">Save</button>
  `;
  el.modalBody.appendChild(actions);

  actions.querySelector('#modal-cancel').addEventListener('click', closeEditor);
  actions.querySelector('#modal-delete')?.addEventListener('click', async () => {
    if (!confirm('Delete this item? This cannot be undone.')) return;
    await withSessionGuard(() => deleteItem(item.id));
    bumpCategoryCount(state.activeCategoryId, -1);
    closeEditor();
    await loadItems();
  });
  actions.querySelector('#modal-save').addEventListener('click', async () => {
    const saveBtn = actions.querySelector('#modal-save');
    saveBtn.disabled = true;
    try {
      const fieldValues = Object.fromEntries(Object.entries(getters).map(([id, get]) => [id, get()]));
      const newData = {
        title: (titleFieldDef && fieldValues[titleFieldDef.id]) || data.title || 'Untitled',
        subtitle: (subtitleFieldDef && fieldValues[subtitleFieldDef.id]) || '',
        fields: fieldValues,
      };
      const enc = await encryptItemData(newData);
      if (item.id) {
        await withSessionGuard(() => saveItem({ id: item.id, categoryId: state.activeCategoryId, ...enc }));
      } else {
        await withSessionGuard(() => createItem({ id: crypto.randomUUID(), categoryId: state.activeCategoryId, ...enc }));
        bumpCategoryCount(state.activeCategoryId, 1);
      }
      closeEditor();
      await loadItems();
    } finally {
      saveBtn.disabled = false;
    }
  });

  el.modalBackdrop.style.display = 'flex';
}

function bumpCategoryCount(categoryId, delta) {
  const category = state.categories.find(c => c.id === categoryId);
  if (!category) return;
  category.itemCount = Math.max(0, (category.itemCount || 0) + delta);
  renderSidebarList(el.sidebarList, state.categories, state.activeCategoryId, selectCategory);
}

function closeEditor() {
  el.modalBackdrop.style.display = 'none';
}

/* ── View modal — read-only, shows every field on the item (not just the
   truncated top-3 the compact card shows). Reuses renderFieldRow so TOTP
   still ticks live, backup codes are still copyable/consumable, etc. Any
   backup code consumed from here also needs the compact card's own hero
   count refreshed, so on close we just reload the grid if anything changed
   rather than trying to keep two live renders of the same field in sync. */

let viewModalDisposers = [];
let viewModalChanged = false;

function openViewModal(item, category, data) {
  el.viewModalBody.innerHTML = '';
  viewModalDisposers = [];
  viewModalChanged = false;

  const head = document.createElement('div');
  head.style.marginBottom = '18px';
  head.innerHTML = `
    <div class="item-card-title" style="font-size:18px"></div>
    <div class="item-card-sub" style="margin-top:4px"></div>
  `;
  head.querySelector('.item-card-title').textContent = data.title || 'Untitled';
  head.querySelector('.item-card-sub').textContent = data.subtitle || '';
  el.viewModalBody.appendChild(head);

  const rows = document.createElement('div');
  rows.className = 'item-card-rows view-modal-rows';
  for (const field of category?.fields || []) {
    const value = data.fields ? data.fields[field.id] : undefined;
    rows.appendChild(renderFieldRow(field, value, viewModalDisposers, async () => {
      const remaining = await consumeBackupCode(item, data, field, value);
      viewModalChanged = true;
      return remaining;
    }));
  }
  if (rows.children.length) el.viewModalBody.appendChild(rows);
  else {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'This item has no fields.';
    el.viewModalBody.appendChild(empty);
  }

  el.viewModalBackdrop.style.display = 'flex';
}

function closeViewModal() {
  viewModalDisposers.forEach(fn => fn());
  viewModalDisposers = [];
  el.viewModalBackdrop.style.display = 'none';
  if (viewModalChanged) {
    viewModalChanged = false;
    loadItems();
  }
}

el.viewModalClose.addEventListener('click', closeViewModal);

/* ── Schema editor — reachable directly from the topbar, one field-row-per-field,
   mirrors the compact editor from Settings but scoped to a single category so
   the flow is "click Edit Schema on the category you're looking at" rather than
   "navigate to Settings, scroll to find the category, expand it." ────────── */

function openSchemaEditor(category) {
  const working = { ...category, fields: category.fields.map(f => ({ ...f })) };
  el.schemaModalTitle.textContent = `Edit Schema — ${category.name}`;
  el.schemaModalBody.innerHTML = '';

  const nameField = document.createElement('div');
  nameField.className = 'field';
  nameField.innerHTML = `<label class="field-label">Tab name</label>`;
  const nameRow = document.createElement('div');
  nameRow.className = 'input-row';
  const iconInput = document.createElement('input');
  iconInput.className = 'input icon-input';
  iconInput.maxLength = 4;
  iconInput.title = 'Emoji icon for this category';
  iconInput.value = working.icon || '📁';
  iconInput.addEventListener('input', () => { working.icon = iconInput.value; });
  const nameInput = document.createElement('input');
  nameInput.className = 'input';
  nameInput.value = working.name;
  nameRow.appendChild(iconInput);
  nameRow.appendChild(nameInput);
  nameField.appendChild(nameRow);
  el.schemaModalBody.appendChild(nameField);

  const fieldsLabel = document.createElement('label');
  fieldsLabel.className = 'field-label';
  fieldsLabel.textContent = 'Fields';
  fieldsLabel.style.display = 'block';
  fieldsLabel.style.marginBottom = '2px';
  el.schemaModalBody.appendChild(fieldsLabel);

  const fieldsHint = document.createElement('p');
  fieldsHint.className = 'hint';
  fieldsHint.style.marginTop = '0';
  fieldsHint.style.marginBottom = '10px';
  fieldsHint.textContent = 'Right-click a field to reorder it.';
  el.schemaModalBody.appendChild(fieldsHint);

  const fieldRows = document.createElement('div');
  fieldRows.className = 'schema-fields';
  el.schemaModalBody.appendChild(fieldRows);

  function renderFields() {
    fieldRows.innerHTML = '';
    for (const field of working.fields) {
      const row = document.createElement('div');
      row.className = 'schema-field-row';

      const fieldNameInput = document.createElement('input');
      fieldNameInput.className = 'input';
      fieldNameInput.value = field.name;
      fieldNameInput.addEventListener('input', () => { field.name = fieldNameInput.value; });
      row.appendChild(fieldNameInput);

      const typeWrap = document.createElement('div');
      typeWrap.className = 'isel';
      typeWrap.style.minWidth = '120px';
      buildIsel(typeWrap, FIELD_TYPES, field.type, (v) => {
        field.type = v;
        if (v === 'secret') { field.copyable = false; if (!field.subtype) field.subtype = 'password'; }
        renderFields();
      });
      row.appendChild(typeWrap);

      if (field.type === 'secret') {
        const subtypeWrap = document.createElement('div');
        subtypeWrap.className = 'isel';
        subtypeWrap.style.minWidth = '140px';
        buildIsel(subtypeWrap, SECRET_SUBTYPES, field.subtype || 'password', (v) => { field.subtype = v; });
        row.appendChild(subtypeWrap);
      } else {
        const copyToggle = document.createElement('button');
        copyToggle.className = 'btn-copyable-toggle' + (field.copyable ? ' active' : '');
        copyToggle.textContent = '⧉';
        copyToggle.title = field.copyable
          ? 'Shows a copy button on the card (click to unset)'
          : 'Mark as copyable — shows a copy button on the card. Only one field per category can be copyable.';
        copyToggle.addEventListener('click', () => {
          const turningOn = !field.copyable;
          working.fields.forEach(f => { f.copyable = false; });
          field.copyable = turningOn;
          renderFields();
        });
        row.appendChild(copyToggle);
      }

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-remove-field';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => {
        working.fields = working.fields.filter(f => f !== field);
        renderFields();
      });
      row.appendChild(removeBtn);

      row.addEventListener('contextmenu', (e) => {
        const idx = working.fields.indexOf(field);
        showFieldContextMenu(e, {
          atTop: idx === 0,
          atBottom: idx === working.fields.length - 1,
          onMoveTop: () => moveField(working.fields, idx, 0, renderFields),
          onMoveUp: () => moveField(working.fields, idx, idx - 1, renderFields),
          onMoveDown: () => moveField(working.fields, idx, idx + 1, renderFields),
          onMoveBottom: () => moveField(working.fields, idx, working.fields.length - 1, renderFields),
        });
      });

      fieldRows.appendChild(row);
    }
  }
  renderFields();

  const addFieldBtn = document.createElement('button');
  addFieldBtn.className = 'btn-add-field';
  addFieldBtn.style.marginTop = '10px';
  addFieldBtn.textContent = '+ Add Field';
  addFieldBtn.addEventListener('click', () => {
    working.fields.push({ id: newFieldId(), name: 'New field', type: 'text' });
    renderFields();
  });
  el.schemaModalBody.appendChild(addFieldBtn);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  actions.innerHTML = `
    <button class="btn btn-danger" id="schema-delete-tab">Delete Tab</button>
    <div class="modal-spacer"></div>
    <button class="btn btn-ghost" id="schema-cancel">Cancel</button>
    <button class="btn btn-primary" id="schema-save">Save Changes</button>
  `;
  actions.style.marginTop = '20px';
  actions.style.paddingTop = '16px';
  actions.style.borderTop = '1px solid var(--border)';
  el.schemaModalBody.appendChild(actions);

  actions.querySelector('#schema-cancel').addEventListener('click', closeSchemaEditor);
  actions.querySelector('#schema-delete-tab').addEventListener('click', async () => {
    if (!confirm(`Delete "${working.name}" and everything in it? This cannot be undone.`)) return;
    await withSessionGuard(() => deleteCategory(working.id));
    closeSchemaEditor();
    if (state.activeCategoryId === working.id) state.activeCategoryId = null;
    await loadCategories();
  });
  actions.querySelector('#schema-save').addEventListener('click', async () => {
    const saveBtn = actions.querySelector('#schema-save');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      working.name = nameInput.value;
      const saved = await withSessionGuard(() => saveCategory(working));
      if (saved === null) return;
      closeSchemaEditor();
      await loadCategories();
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  });

  el.schemaModalBackdrop.style.display = 'flex';
}

function closeSchemaEditor() {
  el.schemaModalBackdrop.style.display = 'none';
}

/* ── Field reorder context menu — right-click a field row in the schema
   editor for Move to Top / Move Up / Move Down / Move to Bottom. ───────── */

function moveField(fields, fromIdx, toIdx, rerender) {
  const clamped = Math.max(0, Math.min(toIdx, fields.length - 1));
  if (clamped === fromIdx) return;
  const [field] = fields.splice(fromIdx, 1);
  fields.splice(clamped, 0, field);
  rerender();
}

let activeFieldContextMenu = null;

function closeFieldContextMenu() {
  if (activeFieldContextMenu) {
    activeFieldContextMenu.remove();
    activeFieldContextMenu = null;
  }
}

document.addEventListener('click', closeFieldContextMenu);
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('.schema-field-row')) closeFieldContextMenu();
});
document.addEventListener('scroll', closeFieldContextMenu, true);
window.addEventListener('resize', closeFieldContextMenu);
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFieldContextMenu(); });

function showFieldContextMenu(e, { atTop, atBottom, onMoveTop, onMoveUp, onMoveDown, onMoveBottom }) {
  e.preventDefault();
  e.stopPropagation();
  closeFieldContextMenu();

  const menu = document.createElement('div');
  menu.className = 'field-context-menu';
  menu.style.position = 'fixed';
  menu.style.visibility = 'hidden';

  const options = [
    { label: 'Move to Top', action: onMoveTop, disabled: atTop },
    { label: 'Move Up', action: onMoveUp, disabled: atTop },
    { label: 'Move Down', action: onMoveDown, disabled: atBottom },
    { label: 'Move to Bottom', action: onMoveBottom, disabled: atBottom },
  ];

  for (const opt of options) {
    const item = document.createElement('div');
    item.className = 'field-context-menu-opt' + (opt.disabled ? ' disabled' : '');
    item.textContent = opt.label;
    if (!opt.disabled) {
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        opt.action();
        closeFieldContextMenu();
      });
    }
    menu.appendChild(item);
  }

  document.body.appendChild(menu);
  activeFieldContextMenu = menu;

  const rect = menu.getBoundingClientRect();
  let x = e.clientX, y = e.clientY;
  if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 8;
  if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 8;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.style.visibility = 'visible';
}

/* ── Settings — now a modal instead of a page navigation. Settings used to
   live at /settings, a full page load; that reset the JS module state,
   which meant the in-memory unlocked vault key (crypto.js's module-level
   `unlockedKey`) was gone and you had to re-enter your master password
   every single time. As a modal, the page never reloads, so the vault
   stays unlocked and everything below just reuses it directly. ────────── */

async function openSettingsModal() {
  el.settingsModalBody.innerHTML = '';

  const appearance = document.createElement('div');
  appearance.className = 'settings-section';
  appearance.innerHTML = `
    <div class="settings-section-title">Appearance</div>
    <div class="theme-grid" id="settings-theme-cards"></div>
    <div class="toggle-row" style="margin-top:16px">
      <div>
        <div style="font-size:13.5px">Background effects</div>
        <div class="hint" style="margin-top:2px">Particles/atmosphere behind the app, if the theme has any.</div>
      </div>
      <label class="checkbox-row">
        <input type="checkbox" id="settings-particles-toggle" /> On
      </label>
    </div>
  `;
  el.settingsModalBody.appendChild(appearance);

  const securitySection = document.createElement('div');
  securitySection.className = 'settings-section';
  securitySection.innerHTML = `
    <div class="settings-section-title">Security</div>
    <form id="settings-password-form">
      <div class="field">
        <label class="field-label">Current password</label>
        <input class="input" type="password" id="settings-old-password" autocomplete="current-password" />
      </div>
      <div class="field">
        <label class="field-label">New password</label>
        <input class="input" type="password" id="settings-new-password" autocomplete="new-password" />
      </div>
      <p class="hint" style="margin-bottom:14px">Changing this re-encrypts every item in your vault. It can take a moment if you have a lot of items.</p>
      <div id="settings-password-error" class="error-text" style="display:none"></div>
      <div id="settings-password-success" style="display:none;color:var(--success);font-size:13px;margin-top:10px">Password changed and vault re-encrypted.</div>
      <button class="btn btn-primary" type="submit" id="settings-password-submit">Change password</button>
    </form>
  `;
  el.settingsModalBody.appendChild(securitySection);

  const dataSection = document.createElement('div');
  dataSection.className = 'settings-section';
  dataSection.innerHTML = `
    <div class="settings-section-title">Data</div>
    <div class="row-demo">
      <button class="btn btn-ghost" id="settings-export-btn">Export vault (decrypted JSON)</button>
      <label class="btn btn-ghost" style="cursor:pointer">
        Import
        <input type="file" id="settings-import-file" accept="application/json" style="display:none" />
      </label>
    </div>
    <div class="danger-zone" style="margin-top:20px">
      <h3 style="margin-bottom:8px">Danger zone</h3>
      <p class="hint" style="margin-bottom:12px">Deletes every category and every item. Cannot be undone.</p>
      <button class="btn btn-danger" id="settings-wipe-btn">Delete all data</button>
    </div>
  `;
  el.settingsModalBody.appendChild(dataSection);

  let adminSection = null;
  if (state.role === 'admin') {
    adminSection = document.createElement('div');
    adminSection.className = 'settings-section';
    adminSection.innerHTML = `
      <div class="settings-section-title">Users</div>
      <div class="field">
        <label class="checkbox-row" style="margin-bottom:10px">
          <input type="checkbox" id="settings-custom-code-toggle" /> Have a custom code?
        </label>
        <div id="settings-custom-code-field" style="display:none;margin-bottom:10px">
          <input class="input mono" id="settings-custom-code-input" placeholder="e.g. GAMER1" style="text-transform:uppercase" />
        </div>
        <button class="btn btn-primary btn-sm" id="settings-create-invite-btn">Generate invite</button>
        <div class="invite-result" id="settings-invite-result" style="display:none"></div>
      </div>
      <table class="users-table" id="settings-users-table" style="margin-top:20px">
        <thead>
          <tr><th>Username</th><th>Role</th><th>Status</th><th>Invite code</th><th>Last login</th></tr>
        </thead>
        <tbody id="settings-users-tbody"></tbody>
      </table>
    `;
    el.settingsModalBody.appendChild(adminSection);
  }

  await wireSettingsAppearance();
  wireSettingsSecurity();
  wireSettingsData();
  if (adminSection) await wireSettingsAdmin();

  el.settingsModalBackdrop.style.display = 'flex';
}

function closeSettingsModal() {
  el.settingsModalBackdrop.style.display = 'none';
}

async function wireSettingsAppearance() {
  const themes = await fetch('/style/style.json').then(r => r.json());
  const wrap = document.getElementById('settings-theme-cards');
  const current = (() => { try { return localStorage.getItem('waystone-preview-theme') || 'default'; } catch (e) { return 'default'; } })();

  wrap.innerHTML = themes.map(t => `
    <div class="theme-card ${t.id === current ? 'active' : ''}" data-id="${t.id}">
      <div class="theme-swatches">${t.swatches.map(c => `<div class="theme-swatch" style="background:${c}"></div>`).join('')}</div>
      <div class="theme-card-name">${t.name}</div>
    </div>
  `).join('');

  wrap.querySelectorAll('.theme-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      try { localStorage.setItem('waystone-preview-theme', id); } catch (e) {}
      document.getElementById('theme-css').setAttribute('href', `/style/${id}.css`);
      wrap.querySelectorAll('.theme-card').forEach(c => c.classList.toggle('active', c === card));
      refreshParticlesForTheme();
    });
  });

  const toggle = document.getElementById('settings-particles-toggle');
  let stored = true;
  try { stored = localStorage.getItem('waystone-particles-enabled') !== '0'; } catch (e) {}
  toggle.checked = stored;
  toggle.addEventListener('change', () => setParticlesEnabled(toggle.checked));
}

function wireSettingsSecurity() {
  document.getElementById('settings-password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const oldPassword = document.getElementById('settings-old-password').value;
    const newPassword = document.getElementById('settings-new-password').value;
    const errorEl = document.getElementById('settings-password-error');
    const successEl = document.getElementById('settings-password-success');
    const submitBtn = document.getElementById('settings-password-submit');
    errorEl.style.display = 'none';
    successEl.style.display = 'none';
    if (!oldPassword || !newPassword) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Re-encrypting…';
    try {
      // Vault's already unlocked with the current password from login/unlock —
      // decrypt everything with it, then re-derive+re-encrypt with the new one.
      const allItems = await fetchItems();
      const decrypted = [];
      for (const item of allItems) {
        decrypted.push({ item, data: await decryptItemData(item) });
      }

      const result = await changePassword(oldPassword, newPassword);
      await unlockVault(newPassword, result.salt);

      for (const { item, data } of decrypted) {
        const enc = await encryptItemData(data);
        await saveItem({ id: item.id, categoryId: item.categoryId, ...enc });
      }

      successEl.style.display = 'block';
      document.getElementById('settings-old-password').value = '';
      document.getElementById('settings-new-password').value = '';
    } catch (err) {
      errorEl.textContent = err.message || 'Could not change password — check your current password.';
      errorEl.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Change password';
    }
  });
}

function wireSettingsData() {
  document.getElementById('settings-export-btn').addEventListener('click', async () => {
    try {
      const allItems = await fetchItems();
      const bundle = { exportedAt: new Date().toISOString(), categories: state.categories, items: [] };
      for (const item of allItems) {
        const data = await decryptItemData(item);
        bundle.items.push({ id: item.id, categoryId: item.categoryId, data });
      }

      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `waystone-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Export failed. ' + (e.message || ''));
    }
  });

  document.getElementById('settings-import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      if (!Array.isArray(bundle.items)) throw new Error('File does not look like a WayStone export');

      let imported = 0;
      for (const entry of bundle.items) {
        if (!entry.categoryId || !state.categories.find(c => c.id === entry.categoryId)) continue;
        const enc = await encryptItemData(entry.data);
        await createItem({ id: crypto.randomUUID(), categoryId: entry.categoryId, ...enc });
        imported++;
      }
      alert(`Imported ${imported} item(s). Categories referenced by the file that no longer exist were skipped.`);
      await loadCategories();
    } catch (err) {
      alert('Import failed: ' + err.message);
    } finally {
      e.target.value = '';
    }
  });

  document.getElementById('settings-wipe-btn').addEventListener('click', async () => {
    if (!confirm('This deletes every category and item permanently. There is no undo. Continue?')) return;
    for (const category of state.categories) {
      await withSessionGuard(() => deleteCategory(category.id));
    }
    state.activeCategoryId = null;
    await loadCategories();
    alert('All data deleted.');
  });
}

async function wireSettingsAdmin() {
  async function refreshUsers() {
    const users = await listUsers();
    const tbody = document.getElementById('settings-users-tbody');
    tbody.innerHTML = users.map(u => `
      <tr>
        <td>${u.username || '(pending)'}</td>
        <td>${u.role}</td>
        <td>${u.status}</td>
        <td class="mono">${u.invite_code}${Number(u.invite_used) ? ' (used)' : ''}</td>
        <td>${u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '—'}</td>
      </tr>
    `).join('');
  }

  document.getElementById('settings-custom-code-toggle').addEventListener('change', (e) => {
    document.getElementById('settings-custom-code-field').style.display = e.target.checked ? 'block' : 'none';
  });

  document.getElementById('settings-create-invite-btn').addEventListener('click', async () => {
    const useCustom = document.getElementById('settings-custom-code-toggle').checked;
    const customCode = useCustom ? document.getElementById('settings-custom-code-input').value.trim().toUpperCase() : null;
    try {
      const result = await createInvite(customCode || null);
      const resultEl = document.getElementById('settings-invite-result');
      resultEl.style.display = 'flex';
      resultEl.innerHTML = `<span>Code: <strong>${result.code}</strong></span>`;
      await refreshUsers();
    } catch (e) {
      alert('Could not create invite: ' + e.message);
    }
  });

  await refreshUsers();
}

el.schemaModalClose.addEventListener('click', closeSchemaEditor);
el.editSchemaBtn?.addEventListener('click', () => {
  const category = activeCategory();
  if (category) openSchemaEditor(category);
});

el.settingsModalClose.addEventListener('click', closeSettingsModal);
el.settingsBtn?.addEventListener('click', () => openSettingsModal());

el.addItemBtn?.addEventListener('click', () => {
  if (!state.activeCategoryId) return;
  openEditor({ id: null }, { title: '', subtitle: '', fields: {} });
});

el.addCategoryBtn?.addEventListener('click', () => openCategoryModal());

function openCategoryModal() {
  el.categoryModalBody.innerHTML = '';

  const nameField = document.createElement('div');
  nameField.className = 'field';
  nameField.innerHTML = `<label class="field-label">Icon &amp; name</label>`;
  const nameRow = document.createElement('div');
  nameRow.className = 'input-row';
  const iconInput = document.createElement('input');
  iconInput.className = 'input icon-input';
  iconInput.maxLength = 4;
  iconInput.title = 'Emoji icon for this category';
  iconInput.value = '📁';
  const nameInput = document.createElement('input');
  nameInput.className = 'input';
  nameInput.placeholder = 'e.g. Characters';
  nameRow.appendChild(iconInput);
  nameRow.appendChild(nameInput);
  nameField.appendChild(nameRow);
  el.categoryModalBody.appendChild(nameField);

  const errorEl = document.createElement('div');
  errorEl.className = 'error-text';
  errorEl.style.display = 'none';
  el.categoryModalBody.appendChild(errorEl);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  actions.innerHTML = `
    <div class="modal-spacer"></div>
    <button class="btn btn-ghost" id="category-cancel">Cancel</button>
    <button class="btn btn-primary" id="category-create">Create</button>
  `;
  el.categoryModalBody.appendChild(actions);

  actions.querySelector('#category-cancel').addEventListener('click', closeCategoryModal);
  actions.querySelector('#category-create').addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      errorEl.textContent = 'Give the category a name.';
      errorEl.style.display = 'block';
      return;
    }
    const createBtn = actions.querySelector('#category-create');
    createBtn.disabled = true;
    try {
      const category = await withSessionGuard(() =>
        createCategory({ id: newCategoryId(), name, icon: iconInput.value.trim() || '📁', sortOrder: state.categories.length, fields: [] })
      );
      if (category === null) return;
      state.categories.push(category);
      state.activeCategoryId = category.id;
      renderSidebarList(el.sidebarList, state.categories, state.activeCategoryId, selectCategory);
      updateTopbar();
      updateAddItemAvailability();
      closeCategoryModal();
      await loadItems();
    } finally {
      createBtn.disabled = false;
    }
  });

  el.categoryModalBackdrop.style.display = 'flex';
  nameInput.focus();
}

function closeCategoryModal() {
  el.categoryModalBackdrop.style.display = 'none';
}

el.categoryModalClose.addEventListener('click', closeCategoryModal);

/* ── Sidebar collapse — the toggle used to live only inside the sidebar
   itself, so collapsing it also hid the only control that could bring it
   back (nothing short of a page refresh recovered it). The topbar toggle
   is always visible regardless of collapsed state; both call the same
   function, and the preference persists across reloads. ────────────── */

function setSidebarCollapsed(collapsed) {
  el.sidebar?.classList.toggle('collapsed', collapsed);
  try { localStorage.setItem('waystone-sidebar-collapsed', collapsed ? '1' : '0'); } catch (e) {}
}

function toggleSidebar() {
  setSidebarCollapsed(!el.sidebar?.classList.contains('collapsed'));
}

(function applyStoredSidebarState() {
  try {
    if (localStorage.getItem('waystone-sidebar-collapsed') === '1') setSidebarCollapsed(true);
  } catch (e) {}
})();

el.sidebarToggleBtn?.addEventListener('click', toggleSidebar);
el.topbarSidebarToggle?.addEventListener('click', toggleSidebar);

el.lockBtn?.addEventListener('click', () => {
  lockVault();
  resetState();
  showUnlockGate(state.username || '');
});

el.logoutBtn?.addEventListener('click', async () => {
  await logout().catch(() => {});
  lockVault();
  state.username = null;
  state.role = null;
  resetState();
  showLoginGate();
});

const LOADING_DOT_CYCLE = ['.', '..', '...', '..', '.', '...', '..'];

function startButtonLoading(btn, label) {
  btn.disabled = true;
  let i = 0;
  btn.textContent = `${label} ${LOADING_DOT_CYCLE[i]}`;
  const interval = setInterval(() => {
    i = (i + 1) % LOADING_DOT_CYCLE.length;
    btn.textContent = `${label} ${LOADING_DOT_CYCLE[i]}`;
  }, 380);
  return () => clearInterval(interval);
}

function stopButtonLoading(btn, stopInterval, originalText) {
  stopInterval();
  btn.disabled = false;
  btn.textContent = originalText;
}

el.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = el.loginUsername.value.trim();
  const password = el.loginPassword.value;
  if (!username || !password) return;

  el.loginError.textContent = '';
  const originalText = el.loginSubmit.textContent;
  const stopLoading = startButtonLoading(el.loginSubmit, 'Logging in');
  try {
    const result = await login(username, password);
    await unlockVault(password, result.salt);
    state.username = result.username;
    state.role = result.role;
    await showApp();
  } catch (err) {
    el.loginError.textContent = 'Incorrect username or password.';
  } finally {
    stopButtonLoading(el.loginSubmit, stopLoading, originalText);
  }
});

el.unlockForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = el.unlockPassword.value;
  if (!password) return;
  el.unlockError.textContent = '';
  const originalText = el.unlockSubmit.textContent;
  const stopLoading = startButtonLoading(el.unlockSubmit, 'Unlocking');
  try {
    const session = await checkSession();
    if (!session.authenticated) { handleSessionExpired(); return; }
    await unlockVault(password, session.salt);
    state.username = session.username;
    state.role = session.role;
    await showApp();
  } catch (err) {
    el.unlockError.textContent = 'Could not unlock with that password.';
  } finally {
    stopButtonLoading(el.unlockSubmit, stopLoading, originalText);
  }
});

async function boot() {
  initParticles();

  const session = await checkSession();
  if (!session.authenticated) {
    showLoginGate();
    return;
  }

  state.username = session.username;
  state.role = session.role;

  if (isUnlocked()) {
    await showApp();
  } else {
    showUnlockGate(session.username);
  }
}

boot();

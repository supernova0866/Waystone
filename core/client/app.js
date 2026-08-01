import { checkSession, login, logout, fetchCategories, createCategory, saveCategory, deleteCategory, fetchItems, createItem, saveItem, deleteItem } from '/core/client/api.js';
import { unlockVault, lockVault, isUnlocked, encryptItemData, decryptItemData } from '/core/client/crypto.js';
import { createItemCard } from '/core/client/items.js';
import { renderSidebarList, newCategoryId, newFieldId, FIELD_TYPES, SECRET_SUBTYPES } from '/core/client/categories.js';
import { buildIsel } from '/core/client/isel.js';
import { parseBackupCodes, consumeCode } from '/core/client/backup-codes.js';
import { initParticles } from '/core/client/particles.js';

const state = {
  username: null,
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

  unlockGate: document.getElementById('unlock-gate'),
  unlockForm: document.getElementById('unlock-form'),
  unlockError: document.getElementById('unlock-error'),
  unlockUsernameLabel: document.getElementById('unlock-username-label'),
  unlockPassword: document.getElementById('unlock-password'),

  app: document.getElementById('app-shell'),
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
  const rows = await withSessionGuard(() => fetchItems(state.activeCategoryId));
  if (rows === null) return;

  const category = activeCategory();
  const decrypted = [];
  for (const row of rows) {
    try {
      const data = await decryptItemData(row);
      decrypted.push({ item: row, data });
    } catch (e) {
      decrypted.push({ item: row, data: { title: '⚠ Could not decrypt', fields: {} } });
    }
  }
  state.items = decrypted;
  renderGrid(category, decrypted);
}

function renderGrid(category, decryptedItems) {
  el.cardGrid.innerHTML = '';

  if (decryptedItems.length === 0) {
    el.cardGrid.innerHTML = `<div class="empty-state"><div class="es-icon">${category?.icon || '📄'}</div>No items in ${category?.name || 'this category'} yet.</div>`;
    return;
  }

  for (const { item, data } of decryptedItems) {
    const { card, dispose } = createItemCard(item, category, data, {
      onOpen: (item) => openEditor(item, data),
      onConsumeBackupCode: (item, field, codes) => consumeBackupCode(item, data, field, codes),
    });
    state.disposers.push(dispose);
    el.cardGrid.appendChild(card);
  }
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

  const titleField = document.createElement('div');
  titleField.className = 'field';
  titleField.innerHTML = `<label class="field-label">Title</label>`;
  const titleInput = document.createElement('input');
  titleInput.className = 'input'; titleInput.value = data.title || '';
  titleField.appendChild(titleInput);
  el.modalBody.appendChild(titleField);

  const subtitleField = document.createElement('div');
  subtitleField.className = 'field';
  subtitleField.innerHTML = `<label class="field-label">Subtitle</label>`;
  const subtitleInput = document.createElement('input');
  subtitleInput.className = 'input'; subtitleInput.value = data.subtitle || '';
  subtitleField.appendChild(subtitleInput);
  el.modalBody.appendChild(subtitleField);

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
    closeEditor();
    await loadItems();
  });
  actions.querySelector('#modal-save').addEventListener('click', async () => {
    const saveBtn = actions.querySelector('#modal-save');
    saveBtn.disabled = true;
    try {
      const newData = {
        title: titleInput.value,
        subtitle: subtitleInput.value,
        fields: Object.fromEntries(Object.entries(getters).map(([id, get]) => [id, get()])),
      };
      const enc = await encryptItemData(newData);
      if (item.id) {
        await withSessionGuard(() => saveItem({ id: item.id, categoryId: state.activeCategoryId, ...enc }));
      } else {
        await withSessionGuard(() => createItem({ id: crypto.randomUUID(), categoryId: state.activeCategoryId, ...enc }));
      }
      closeEditor();
      await loadItems();
    } finally {
      saveBtn.disabled = false;
    }
  });

  el.modalBackdrop.style.display = 'flex';
}

function closeEditor() {
  el.modalBackdrop.style.display = 'none';
}

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
  const nameInput = document.createElement('input');
  nameInput.className = 'input';
  nameInput.value = working.name;
  nameField.appendChild(nameInput);
  el.schemaModalBody.appendChild(nameField);

  const fieldsLabel = document.createElement('label');
  fieldsLabel.className = 'field-label';
  fieldsLabel.textContent = 'Fields';
  fieldsLabel.style.display = 'block';
  fieldsLabel.style.marginBottom = '8px';
  el.schemaModalBody.appendChild(fieldsLabel);

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
        if (v === 'secret' && !field.subtype) field.subtype = 'password';
        renderFields();
      });
      row.appendChild(typeWrap);

      if (field.type === 'secret') {
        const subtypeWrap = document.createElement('div');
        subtypeWrap.className = 'isel';
        subtypeWrap.style.minWidth = '140px';
        buildIsel(subtypeWrap, SECRET_SUBTYPES, field.subtype || 'password', (v) => { field.subtype = v; });
        row.appendChild(subtypeWrap);
      }

      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn-remove-field';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => {
        working.fields = working.fields.filter(f => f !== field);
        renderFields();
      });
      row.appendChild(removeBtn);

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

el.schemaModalClose.addEventListener('click', closeSchemaEditor);
el.editSchemaBtn?.addEventListener('click', () => {
  const category = activeCategory();
  if (category) openSchemaEditor(category);
});

el.addItemBtn?.addEventListener('click', () => {
  if (!state.activeCategoryId) return;
  openEditor({ id: null }, { title: '', subtitle: '', fields: {} });
});

el.addCategoryBtn?.addEventListener('click', async () => {
  const name = prompt('Category name');
  if (!name) return;
  const category = await withSessionGuard(() =>
    createCategory({ id: newCategoryId(), name, icon: '📁', sortOrder: state.categories.length, fields: [] })
  );
  if (category === null) return;
  state.categories.push(category);
  state.activeCategoryId = category.id;
  renderSidebarList(el.sidebarList, state.categories, state.activeCategoryId, selectCategory);
  updateTopbar();
  updateAddItemAvailability();
  await loadItems();
});

el.lockBtn?.addEventListener('click', () => {
  lockVault();
  resetState();
  showUnlockGate(state.username || '');
});

el.logoutBtn?.addEventListener('click', async () => {
  await logout().catch(() => {});
  lockVault();
  state.username = null;
  resetState();
  showLoginGate();
});

el.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = el.loginUsername.value.trim();
  const password = el.loginPassword.value;
  if (!username || !password) return;

  el.loginError.textContent = '';
  try {
    const result = await login(username, password);
    await unlockVault(password, result.salt);
    state.username = result.username;
    await showApp();
  } catch (err) {
    el.loginError.textContent = 'Incorrect username or password.';
  }
});

el.unlockForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = el.unlockPassword.value;
  if (!password) return;
  el.unlockError.textContent = '';
  try {
    const session = await checkSession();
    if (!session.authenticated) { handleSessionExpired(); return; }
    await unlockVault(password, session.salt);
    state.username = session.username;
    await showApp();
  } catch (err) {
    el.unlockError.textContent = 'Could not unlock with that password.';
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

  if (isUnlocked()) {
    await showApp();
  } else {
    showUnlockGate(session.username);
  }
}

boot();

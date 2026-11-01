import { checkSession, login, logout, fetchCategories, createCategory, saveCategory, reorderCategories, deleteCategory, fetchItems, createItem, saveItem, deleteItem, fetchTags, createTag, renameTag, deleteTag, fetchOptions, createOption, deleteOption, createInvite, listUsers, changePassword, getAuthSalt } from '/core/client/api.js';
import { unlockVault, deriveVaultKey, installVaultKey, lockVault, isUnlocked, encryptItemData, encryptItemDataWithKey, decryptItemData, deriveAuthProof } from '/core/client/crypto.js';
import { createItemCard, renderFieldRow } from '/core/client/items.js';
import { renderSidebarList, setReorderHandler, attachEmojiInput, newCategoryId, newTagId, newOptionId, newFieldId, FIELD_TYPES, SECRET_SUBTYPES, pickTitleFields } from '/core/client/categories.js';
import { renderPinnedList, renderHomeView, renderFavoriteGroups, renderSearchResults, attachFavoriteButton } from '/core/client/views.js';
import { TAG_SORTS, closePopover, attachTagArea, openTagPicker, openTagList, renderTagList, renderTagDetailShell, renderCardGrid } from '/core/client/tags-ui.js';
import { attachAutofill, closeAutofill } from '/core/client/autofill.js';
import { DEFAULT_SERVICES, DEFAULT_EMAIL_PROVIDERS, normalizeProvider, normalizeService, mergeProviders, mergeServices, canonicalService, suggestKnown, suggestServices, suggestEmails } from '/core/client/options.js';
import { buildEntry, replaceIndex, upsertIndex, removeFromIndex, removeCategoryFromIndex, clearIndex, isIndexReady, secretStats, favoriteEntries, searchIndex, tagCounts, entriesWithTag, knownEmails, knownServices } from '/core/client/vault-index.js';
import { buildIsel } from '/core/client/isel.js';
import { parseBackupCodes, consumeCode } from '/core/client/backup-codes.js';
import { initParticles, setParticlesEnabled, refreshParticlesForTheme } from '/core/client/particles.js';

const state = {
  username: null,
  role: null,
  loginCount: 0,
  commit: '',
  searchQuery: '',
  searchFilters: [],
  options: [],
  tags: [],
  tagsLoaded: false,
  tagId: null,
  tagSort: TAG_SORTS[0],
  categories: [],
  view: 'home',
  activeCategoryId: null,
  items: [],
  disposers: [],
};

let indexRun = 0;
let homeRun = 0;
let tagsRun = 0;

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
  unlockLogout: document.getElementById('unlock-logout'),

  app: document.getElementById('app-shell'),
  sidebar: document.getElementById('app-sidebar'),
  topbarSidebarToggle: document.getElementById('topbar-sidebar-toggle'),
  sidebarList: document.getElementById('sidebar-list'),
  pinnedList: document.getElementById('sidebar-pinned'),
  topbarTitle: document.getElementById('topbar-title'),
  cardGrid: document.getElementById('card-grid'),
  addItemBtn: document.getElementById('add-item-btn'),
  editSchemaBtn: document.getElementById('edit-schema-btn'),
  addCategoryBtn: document.getElementById('add-category-btn'),
  addTagBtn: document.getElementById('add-tag-btn'),
  tagModalBackdrop: document.getElementById('tag-modal-backdrop'),
  tagModalBody: document.getElementById('tag-modal-body'),
  tagModalTitle: document.getElementById('tag-modal-title'),
  tagModalClose: document.getElementById('tag-modal-close'),
  lockBtn: document.getElementById('lock-btn'),
  logoutBtn: document.getElementById('logout-btn'),
  modalBackdrop: document.getElementById('item-modal-backdrop'),
  modalBody: document.getElementById('item-modal-body'),
  itemModalClose: document.getElementById('item-modal-close'),
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
  indexRun++;
  homeRun++;
  tagsRun++;
  state.searchQuery = '';
  state.searchFilters = [];
  state.options = [];
  state.tags = [];
  state.tagsLoaded = false;
  state.tagId = null;
  clearIndex();
  state.categories = [];
  state.view = 'home';
  state.activeCategoryId = null;
  state.items = [];
}

async function showApp() {
  hideAllGates();
  el.app.style.display = '';
  await Promise.all([loadTags(), loadOptions()]);
  await loadCategories();
  refreshIndex();

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

  if (state.activeCategoryId && !state.categories.some(c => c.id === state.activeCategoryId)) {
    state.activeCategoryId = null;
    state.view = 'home';
  }

  renderNav();
  await renderView();
}

async function loadVaultIndex() {
  const run = ++indexRun;
  const rows = await withSessionGuard(() => fetchItems());
  if (rows === null || run !== indexRun) return;

  const categoryById = new Map(state.categories.map(c => [c.id, c]));
  const built = await Promise.all(rows.map(async (row) => {
    const category = categoryById.get(row.categoryId);
    if (!category) return null;
    try {
      return buildEntry(row, await decryptItemData(row), category);
    } catch (e) {
      console.error('Skipped undecryptable item', row.id);
      return null;
    }
  }));
  if (run !== indexRun) return;

  replaceIndex(built.filter(Boolean));
  if (state.view === 'home') renderHome();
  else if (state.view === 'tags') renderTags();
}

function refreshIndex() {
  loadVaultIndex().catch(err => console.error('Index load failed:', err.message));
}

function renderNav() {
  renderPinnedList(el.pinnedList, state.view, selectView);
  renderSidebarList(el.sidebarList, state.categories, state.activeCategoryId, selectCategory);
  updateTopbar();
  updateAddItemAvailability();
}

async function renderView() {
  clearItemDisposers();
  closePopover();
  if (state.view === 'category' && !activeCategory()) {
    state.view = 'home';
    state.activeCategoryId = null;
    renderNav();
  }
  if (state.view === 'home') return renderHome();
  if (state.view === 'tags') return renderTags();
  await loadItems();
}

async function renderHome() {
  if (state.view !== 'home') return;
  const run = ++homeRun;
  clearItemDisposers();

  let refs;
  refs = renderHomeView(el.cardGrid, {
    categories: state.categories,
    loginCount: state.loginCount,
    commit: state.commit,
    stats: isIndexReady() ? secretStats() : null,
    query: state.searchQuery,
    filters: state.searchFilters,
    onSearch: (query) => {
      state.searchQuery = query;
      applySearch(refs);
    },
    onRemoveFilter: (index) => {
      state.searchFilters.splice(index, 1);
      applySearch(refs);
      refs.searchInput.focus();
    },
  });
  wireSearchBox(refs);
  applySearch(refs);

  if (!isIndexReady()) {
    renderFavoriteGroups(refs.favoritesEl, { loading: true });
    return;
  }

  const decrypted = await Promise.all(favoriteEntries().map(async (entry) => {
    try {
      return { entry, data: await decryptItemData(entry.row) };
    } catch (e) {
      return null;
    }
  }));
  if (run !== homeRun || state.view !== 'home') return;

  const groups = [];
  for (const category of state.categories) {
    const cards = [];
    for (const found of decrypted) {
      if (!found || found.entry.categoryId !== category.id) continue;
      const { card, dispose } = buildCard(found.entry.row, category, found.data);
      state.disposers.push(dispose);
      cards.push(card);
    }
    if (cards.length) groups.push({ category, cards });
  }
  renderFavoriteGroups(refs.favoritesEl, { groups, hasCategories: state.categories.length > 0 });
}

function parsePending(text) {
  const match = String(text || '').match(/^\s*(service|email|tag):\s*(.*)$/i);
  return match ? { kind: match[1].toLowerCase(), value: match[2].trim() } : null;
}

function customValues(kind) {
  return state.options.filter(o => o.kind === kind).map(o => o.value);
}

function allServices() {
  return mergeServices({ known: knownServices(), custom: customValues('service') });
}

function allProviders() {
  return mergeProviders({ custom: customValues('email-provider') });
}

function filterChoices(kind) {
  if (kind === 'service') return allServices();
  if (kind === 'email') return knownEmails();
  return state.tags.map(t => t.name);
}

function searchSuggestions(value) {
  const pending = parsePending(value);
  return pending ? suggestKnown(pending.value, filterChoices(pending.kind), { allowEmpty: true }) : [];
}

function resolveFilterValue(kind, typed) {
  const clean = typed.trim();
  const choices = filterChoices(kind);
  const exact = choices.find(choice => choice.toLowerCase() === clean.toLowerCase());
  return exact || suggestKnown(clean, choices)[0] || clean;
}

function commitFilter(refs, kind, value) {
  const clean = String(value || '').trim();
  if (!clean) return false;

  let filter;
  if (kind === 'tag') {
    const tag = state.tags.find(t => t.name.toLowerCase() === clean.toLowerCase());
    if (!tag) return false;
    filter = { kind, value: tag.name, tagId: tag.id };
  } else if (kind === 'service') {
    filter = { kind, value: canonicalService(clean, allServices()) };
  } else {
    filter = { kind, value: clean };
  }

  const exists = state.searchFilters.some(f => f.kind === filter.kind && f.value.toLowerCase() === filter.value.toLowerCase());
  if (!exists) state.searchFilters.push(filter);
  state.searchQuery = '';
  refs.searchInput.value = '';
  closeAutofill();
  applySearch(refs);
  return true;
}

function wireSearchBox(refs) {
  const input = refs.searchInput;

  attachAutofill(input, {
    anchor: refs.searchBox,
    getSuggestions: searchSuggestions,
    onPick: (suggestion) => {
      const pending = parsePending(input.value);
      if (pending) commitFilter(refs, pending.kind, suggestion);
    },
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const pending = parsePending(input.value);
      if (pending && commitFilter(refs, pending.kind, resolveFilterValue(pending.kind, pending.value))) e.preventDefault();
    } else if (e.key === 'Backspace' && input.value === '' && state.searchFilters.length) {
      state.searchFilters.pop();
      applySearch(refs);
    } else if (e.key === 'Escape' && (input.value || state.searchFilters.length)) {
      input.value = '';
      state.searchQuery = '';
      state.searchFilters.length = 0;
      applySearch(refs);
    }
  });
}

function applySearch(refs) {
  refs.refreshChips();

  const pending = parsePending(state.searchQuery);
  const text = pending ? '' : state.searchQuery.trim();
  const filters = state.searchFilters.map(f => ({ ...f, exact: true }));
  if (pending && pending.value) filters.push({ kind: pending.kind, value: pending.value, exact: false });

  const searching = !!(text || filters.length);
  refs.bodyEl.classList.toggle('hidden', searching);
  refs.resultsEl.classList.toggle('hidden', !searching);
  if (!searching) return;

  const ready = isIndexReady();
  const tagNames = new Map(state.tags.map(t => [t.id, t.name]));
  const { results, total } = ready ? searchIndex(text, { filters, tagNames }) : { results: [], total: 0 };
  const label = [...filters.map(f => `${f.kind}:${f.value}`), text].filter(Boolean).join(' ');
  renderSearchResults(refs.resultsEl, {
    query: label,
    ready,
    results,
    total,
    categoriesById: new Map(state.categories.map(c => [c.id, c])),
    onView: (entry) => openIndexedItem(entry, 'view'),
    onEdit: (entry) => openIndexedItem(entry, 'edit'),
  });
}

async function openIndexedItem(entry, mode) {
  const category = state.categories.find(c => c.id === entry.categoryId);
  if (!category) return;
  let data;
  try {
    data = await decryptItemData(entry.row);
  } catch (e) {
    alert('Could not decrypt this item.');
    return;
  }
  if (mode === 'edit') openEditor(entry.row, data, category);
  else openViewModal(entry.row, category, data);
}

async function reloadCurrentView() {
  if (state.view === 'home') return renderHome();
  if (state.view === 'category') return loadItems();
  if (state.view === 'tags') return renderTags();
}

async function loadTags() {
  const result = await withSessionGuard(() => fetchTags());
  if (result === null) return;
  state.tags = result;
  state.tagsLoaded = true;
}

function sortTags() {
  state.tags.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function tagsById() {
  return new Map(state.tags.map(t => [t.id, t]));
}

function liveTagIds(ids) {
  const list = Array.isArray(ids) ? ids : [];
  if (!state.tagsLoaded) return list;
  const known = tagsById();
  return list.filter(id => known.has(id));
}

function resolveTags(data) {
  const known = tagsById();
  return (Array.isArray(data.tags) ? data.tags : []).map(id => known.get(id)).filter(Boolean);
}

async function ensureTag(name) {
  const clean = name.trim();
  if (!clean || clean.length > 32) throw new Error('Tag names must be 1-32 characters.');
  const existing = state.tags.find(t => t.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  const created = await withSessionGuard(() => createTag({ id: newTagId(), name: clean }));
  if (created === null) throw new Error('Your session expired.');
  state.tags.push(created);
  sortTags();
  return created;
}

async function openTag(id) {
  state.searchQuery = '';
  state.searchFilters = [];
  state.view = 'tags';
  state.activeCategoryId = null;
  state.tagId = id;
  renderNav();
  await renderView();
}

function cardFor(found, category) {
  const { card, dispose } = buildCard(found.entry.row, category, found.data);
  state.disposers.push(dispose);
  return card;
}

async function renderTags() {
  if (state.view !== 'tags') return;
  const run = ++tagsRun;
  clearItemDisposers();
  if (state.tagId && !state.tags.some(t => t.id === state.tagId)) state.tagId = null;
  updateTopbar();

  if (!state.tagId) {
    renderTagList(el.cardGrid, {
      tags: state.tags,
      counts: isIndexReady() ? tagCounts() : null,
      onOpen: (tag) => openTag(tag.id),
      onRename: (tag) => openTagModal(tag),
      onDelete: (tag) => deleteTagFlow(tag),
    });
    return;
  }

  const tag = state.tags.find(t => t.id === state.tagId);
  const content = renderTagDetailShell(el.cardGrid, {
    tag,
    sort: state.tagSort,
    onBack: () => selectView('tags'),
    onSort: (value) => {
      state.tagSort = value;
      renderTags();
    },
  });
  if (!isIndexReady()) {
    renderCardGrid(content, [], 'Loading…');
    return;
  }

  const decrypted = await Promise.all(entriesWithTag(tag.id).map(async (entry) => {
    try {
      return { entry, data: await decryptItemData(entry.row) };
    } catch (e) {
      return null;
    }
  }));
  if (run !== tagsRun || state.view !== 'tags' || state.tagId !== tag.id) return;

  const categoryById = new Map(state.categories.map(c => [c.id, c]));
  const found = decrypted.filter(f => f && categoryById.has(f.entry.categoryId));
  const emptyText = 'No items have this tag yet.';
  const byTitle = (a, b) => a.entry.title.localeCompare(b.entry.title);

  if (state.tagSort === 'By category') {
    const groups = [];
    for (const category of state.categories) {
      const cards = found
        .filter(f => f.entry.categoryId === category.id)
        .sort(byTitle)
        .map(f => cardFor(f, category));
      if (cards.length) groups.push({ category, cards });
    }
    renderFavoriteGroups(content, { groups, hasCategories: true, emptyText });
    return;
  }

  const byUpdated = (a, b) => (b.entry.updatedAt || '').localeCompare(a.entry.updatedAt || '');
  const sorted = [...found].sort(state.tagSort === 'Recently updated' ? byUpdated : byTitle);
  renderCardGrid(content, sorted.map(f => cardFor(f, categoryById.get(f.entry.categoryId))), emptyText);
}

function closeTagModal() {
  el.tagModalBackdrop.style.display = 'none';
}

function openTagModal(tag = null) {
  el.tagModalTitle.textContent = tag ? 'Rename tag' : 'New tag';
  el.tagModalBody.innerHTML = '';

  const field = document.createElement('div');
  field.className = 'field';
  const label = document.createElement('label');
  label.className = 'field-label';
  label.textContent = 'Name';
  const input = document.createElement('input');
  input.className = 'input';
  input.maxLength = 32;
  input.value = tag ? tag.name : '';
  input.placeholder = 'e.g. Work';
  field.appendChild(label);
  field.appendChild(input);
  el.tagModalBody.appendChild(field);

  const errorEl = document.createElement('div');
  errorEl.className = 'error-text';
  errorEl.style.display = 'none';
  el.tagModalBody.appendChild(errorEl);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  actions.innerHTML = `
    <div class="modal-spacer"></div>
    <button class="btn btn-ghost" id="tag-cancel">Cancel</button>
    <button class="btn btn-primary" id="tag-save"></button>
  `;
  el.tagModalBody.appendChild(actions);
  const saveBtn = actions.querySelector('#tag-save');
  saveBtn.textContent = tag ? 'Save' : 'Create';

  const showError = (message) => {
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  };

  const save = async () => {
    const name = input.value.trim();
    if (!name) return showError('Give the tag a name.');
    const clash = state.tags.find(t => t.id !== tag?.id && t.name.toLowerCase() === name.toLowerCase());
    if (clash) return showError('A tag with that name already exists.');

    saveBtn.disabled = true;
    try {
      if (tag) {
        const updated = await withSessionGuard(() => renameTag({ id: tag.id, name }));
        if (updated === null) return;
        tag.name = updated.name;
      } else {
        const created = await withSessionGuard(() => createTag({ id: newTagId(), name }));
        if (created === null) return;
        state.tags.push(created);
      }
      sortTags();
      closeTagModal();
      await renderTags();
    } catch (err) {
      showError(err.status === 409 ? 'A tag with that name already exists.' : err.message);
    } finally {
      saveBtn.disabled = false;
    }
  };

  actions.querySelector('#tag-cancel').addEventListener('click', closeTagModal);
  saveBtn.addEventListener('click', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });

  el.tagModalBackdrop.style.display = 'flex';
  input.focus();
}

async function deleteTagFlow(tag) {
  if (!confirm(`Delete the tag "${tag.name}"? It will be removed from every item that has it.`)) return;
  const done = await withSessionGuard(() => deleteTag(tag.id));
  if (done === null) return;
  state.tags = state.tags.filter(t => t.id !== tag.id);
  if (state.tagId === tag.id) state.tagId = null;
  await renderTags();
}

function openTagPickerFor(item, data, anchor, onChange) {
  let changed = false;
  const notify = () => {
    changed = true;
    onChange();
  };

  openTagPicker(anchor, {
    tags: state.tags,
    selectedIds: new Set(liveTagIds(data.tags)),
    onToggle: async (tagId, on) => {
      const current = liveTagIds(data.tags).filter(id => id !== tagId);
      const next = on ? [...current, tagId] : current;
      if (!(await setItemTags(item, data, next))) throw new Error('Could not save this change.');
      notify();
    },
    onCreate: async (name) => {
      const tag = await ensureTag(name);
      const current = liveTagIds(data.tags);
      if (!current.includes(tag.id)) {
        if (!(await setItemTags(item, data, [...current, tag.id]))) throw new Error('Could not save this change.');
        notify();
      }
      return tag;
    },
    onClose: () => {
      if (changed && state.view === 'tags' && state.tagId) renderTags();
    },
  });
}

function openTagListFor(item, data, anchor, onChange) {
  let changed = false;

  openTagList(anchor, {
    tags: resolveTags(data),
    onOpenTag: (tag) => openTag(tag.id),
    onRemove: async (tag) => {
      const next = liveTagIds(data.tags).filter(id => id !== tag.id);
      if (!(await setItemTags(item, data, next))) throw new Error('Could not save this change.');
      changed = true;
      onChange();
    },
    onClose: () => {
      if (changed && state.view === 'tags' && state.tagId) renderTags();
    },
  });
}

function updateTopbar() {
  const category = activeCategory();
  if (state.view === 'home') {
    el.topbarTitle.textContent = 'Home';
  } else if (state.view === 'tags') {
    const tag = state.tags.find(t => t.id === state.tagId);
    el.topbarTitle.textContent = tag ? `Tags / ${tag.name}` : 'Tags';
  } else {
    el.topbarTitle.textContent = category ? category.name : 'WayStone';
  }
}

function updateAddItemAvailability() {
  const inCategory = state.view === 'category' && !!state.activeCategoryId;
  el.addItemBtn.classList.toggle('hidden', !inCategory);
  el.editSchemaBtn.classList.toggle('hidden', !inCategory);
  el.addTagBtn.classList.toggle('hidden', state.view !== 'tags');
}

async function selectView(view) {
  state.searchQuery = '';
  state.searchFilters = [];
  state.tagId = null;
  state.view = view;
  state.activeCategoryId = null;
  renderNav();
  await renderView();
}

async function selectCategory(id) {
  state.searchQuery = '';
  state.searchFilters = [];
  state.tagId = null;
  state.view = 'category';
  state.activeCategoryId = id;
  renderNav();
  await renderView();
}

function activeCategory() {
  return state.categories.find(c => c.id === state.activeCategoryId) || null;
}

setReorderHandler(async (ids) => {
  const previous = state.categories;
  state.categories = ids.map(id => previous.find(c => c.id === id)).filter(Boolean);
  state.categories.forEach((c, i) => { c.sortOrder = i; });
  try {
    await withSessionGuard(() => reorderCategories(ids));
  } catch (err) {
    state.categories = previous;
    renderSidebarList(el.sidebarList, state.categories, state.activeCategoryId, selectCategory);
    alert('Could not save the new order: ' + err.message);
  }
});

async function loadItems() {
  clearItemDisposers();
  const categoryId = state.activeCategoryId;
  const category = activeCategory();

  const knownCount = category?.itemCount ?? state.items.length;
  renderSkeletons(knownCount > 0 ? knownCount : 1);

  const rows = await withSessionGuard(() => fetchItems(categoryId));
  if (rows === null) return;
  if (state.activeCategoryId !== categoryId) return;

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
    if (state.activeCategoryId !== categoryId) return;
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

function buildCard(item, category, data) {
  const { card, dispose } = createItemCard(item, category, data, {
    onOpen: (row) => openEditor(row, data, category),
    onView: (row, owner, itemData) => openViewModal(row, owner, itemData),
    onConsumeBackupCode: (row, field, codes) => consumeBackupCode(row, data, field, codes),
  });
  attachFavoriteButton(card, data.favorite === true, () => toggleFavorite(item, data));
  const area = attachTagArea(card, {
    getTags: () => resolveTags(data),
    onOpenPicker: (anchor) => openTagPickerFor(item, data, anchor, () => area?.refresh()),
    onShowAll: (anchor) => openTagListFor(item, data, anchor, () => area?.refresh()),
    onChipClick: (tag) => openTag(tag.id),
  });
  return { card, dispose };
}

function swapSkeletonForCard(idx, category, item, data) {
  const { card, dispose } = buildCard(item, category, data);
  state.disposers.push(dispose);

  const slot = el.cardGrid.children[idx];
  if (slot) slot.replaceWith(card);
  else el.cardGrid.appendChild(card);
}

function renderGrid(category, decryptedItems) {
  el.cardGrid.innerHTML = '';

  if (decryptedItems.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const icon = document.createElement('div');
    icon.className = 'es-icon';
    icon.textContent = category?.icon || '📄';
    empty.appendChild(icon);
    empty.appendChild(document.createTextNode(`No items in ${category?.name || 'this category'} yet.`));
    el.cardGrid.appendChild(empty);
    return;
  }

  decryptedItems.forEach(({ item, data }, idx) => swapSkeletonForCard(idx, category, item, data));
}

function syncIndex(row, enc, data) {
  const category = state.categories.find(c => c.id === row.categoryId);
  if (category) upsertIndex(buildEntry({ ...row, dataEnc: enc.dataEnc, iv: enc.iv }, data, category));
}

async function consumeBackupCode(item, data, field, codes) {
  const { code, remaining } = consumeCode(codes || []);
  if (code) navigator.clipboard?.writeText(code).catch(() => {});
  data.fields[field.id] = remaining;
  try {
    const enc = await encryptItemData(data);
    const saved = await withSessionGuard(() => saveItem({ id: item.id, categoryId: item.categoryId, expectedUpdatedAt: item.updatedAt, ...enc }));
    if (saved) {
      item.updatedAt = saved.updatedAt;
      syncIndex(item, enc, data);
    }
  } catch (err) {
    data.fields[field.id] = codes;
    if (err.status !== 409) throw err;
    alert('This item was changed elsewhere and has been reloaded. Check your backup codes before using the one just copied.');
    await reloadCurrentView();
    refreshIndex();
    return codes || [];
  }
  return remaining;
}

async function saveItemData(item, data) {
  const enc = await encryptItemData(data);
  const saved = await withSessionGuard(() => saveItem({ id: item.id, categoryId: item.categoryId, expectedUpdatedAt: item.updatedAt, ...enc }));
  if (!saved) return false;
  item.updatedAt = saved.updatedAt;
  syncIndex(item, enc, data);
  return true;
}

async function handleSaveConflict(err, message) {
  if (err.status !== 409) throw err;
  alert(message);
  await reloadCurrentView();
  refreshIndex();
}

async function toggleFavorite(item, data) {
  const previous = data.favorite === true;
  data.favorite = !previous;
  try {
    if (!(await saveItemData(item, data))) {
      data.favorite = previous;
      return previous;
    }
  } catch (err) {
    data.favorite = previous;
    await handleSaveConflict(err, 'This item was changed elsewhere and has been reloaded.');
    return previous;
  }
  if (state.view === 'home') renderHome();
  return data.favorite;
}

async function setItemTags(item, data, ids) {
  const previous = data.tags;
  data.tags = ids;
  try {
    if (await saveItemData(item, data)) return true;
  } catch (err) {
    data.tags = previous;
    await handleSaveConflict(err, 'This item was changed elsewhere and has been reloaded.');
    return false;
  }
  data.tags = previous;
  return false;
}

async function loadOptions() {
  const result = await withSessionGuard(() => fetchOptions());
  if (result === null) return;
  state.options = result;
}

function renderOptionEditor(container, { kind, title, hint, placeholder, defaults, normalize, invalidMessage }) {
  container.innerHTML = '';

  const heading = document.createElement('h3');
  heading.textContent = title;
  const hintEl = document.createElement('p');
  hintEl.className = 'hint';
  hintEl.textContent = hint;
  const chips = document.createElement('div');
  chips.className = 'option-chips';

  const row = document.createElement('div');
  row.className = 'input-row';
  const input = document.createElement('input');
  input.className = 'input';
  input.placeholder = placeholder;
  input.maxLength = 100;
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-primary btn-sm';
  addBtn.textContent = 'Add';
  row.appendChild(input);
  row.appendChild(addBtn);

  const errorEl = document.createElement('div');
  errorEl.className = 'error-text';
  errorEl.style.display = 'none';
  const showError = (message) => {
    errorEl.textContent = message;
    errorEl.style.display = message ? 'block' : 'none';
  };

  function renderChips() {
    chips.innerHTML = '';
    const mine = state.options.filter(o => o.kind === kind);
    if (!mine.length) {
      const none = document.createElement('p');
      none.className = 'hint';
      none.textContent = 'Nothing added yet.';
      chips.appendChild(none);
      return;
    }
    for (const option of mine) {
      const chip = document.createElement('span');
      chip.className = 'option-chip';
      chip.appendChild(document.createTextNode(option.value));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.title = 'Remove';
      remove.textContent = '✕';
      remove.addEventListener('click', async () => {
        showError('');
        try {
          const done = await withSessionGuard(() => deleteOption(option.id));
          if (done === null) return;
          state.options = state.options.filter(o => o.id !== option.id);
          renderChips();
        } catch (err) {
          showError(err.message);
        }
      });
      chip.appendChild(remove);
      chips.appendChild(chip);
    }
  }

  async function add() {
    showError('');
    const value = normalize(input.value);
    if (!value) return showError(invalidMessage);
    const lower = value.toLowerCase();
    if (defaults.some(d => d.toLowerCase() === lower)) return showError('That one is already in the built-in list.');
    if (state.options.some(o => o.kind === kind && o.value.toLowerCase() === lower)) return showError('That one is already in your list.');

    addBtn.disabled = true;
    try {
      const created = await withSessionGuard(() => createOption({ id: newOptionId(), kind, value }));
      if (created === null) return;
      state.options.push(created);
      input.value = '';
      renderChips();
    } catch (err) {
      showError(err.status === 409 ? 'That one is already in your list.' : err.message);
    } finally {
      addBtn.disabled = false;
    }
  }

  addBtn.addEventListener('click', add);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  });

  container.appendChild(heading);
  container.appendChild(hintEl);
  container.appendChild(chips);
  container.appendChild(row);
  container.appendChild(errorEl);
  renderChips();
}

function wireEmailAutofill(input, fieldType) {
  attachAutofill(input, {
    getSuggestions: (value) => suggestEmails(value, { fieldType, known: knownEmails(), providers: allProviders() }),
    onPick: (value) => { input.value = value; },
  });
}

function wireServiceAutofill(input) {
  attachAutofill(input, {
    getSuggestions: (value) => suggestServices(value, allServices()),
    onPick: (value) => { input.value = value; },
  });
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
  if (field.type === 'secret' && field.subtype === 'multiline') {
    const t = document.createElement('textarea');
    t.className = 'textarea';
    t.placeholder = 'Paste text. Line breaks are kept';
    t.value = value ?? '';
    return { el: t, get: () => t.value };
  }

  const i = document.createElement('input');
  i.className = 'input'; i.type = 'text'; i.value = value ?? '';
  if (field.type === 'secret' && field.subtype === 'totp') i.placeholder = 'Base32 secret';

  if (field.type === 'email') {
    i.placeholder = 'name@example.com';
    wireEmailAutofill(i, 'email');
  } else if (field.type === 'service') {
    i.placeholder = 'e.g. Discord';
    wireServiceAutofill(i);
    return { el: i, get: () => canonicalService(i.value, allServices()) };
  } else if (field.type === 'text') {
    wireEmailAutofill(i, 'text');
  }
  return { el: i, get: () => i.value };
}

function openEditor(item, data, category = activeCategory()) {
  closeAutofill();
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

  const favoriteRow = document.createElement('label');
  favoriteRow.className = 'checkbox-row';
  favoriteRow.style.marginBottom = '16px';
  const favoriteInput = document.createElement('input');
  favoriteInput.type = 'checkbox';
  favoriteInput.checked = data.favorite === true;
  favoriteRow.appendChild(favoriteInput);
  favoriteRow.appendChild(document.createTextNode('Favorite'));
  el.modalBody.appendChild(favoriteRow);

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
    removeFromIndex(item.id);
    bumpCategoryCount(category.id, -1);
    closeEditor();
    await reloadCurrentView();
  });
  actions.querySelector('#modal-save').addEventListener('click', async () => {
    const saveBtn = actions.querySelector('#modal-save');
    saveBtn.disabled = true;
    try {
      const fieldValues = Object.fromEntries(Object.entries(getters).map(([id, get]) => [id, get()]));
      const newData = {
        ...data,
        title: (titleFieldDef && fieldValues[titleFieldDef.id]) || data.title || 'Untitled',
        subtitle: (subtitleFieldDef && fieldValues[subtitleFieldDef.id]) || '',
        fields: fieldValues,
        favorite: favoriteInput.checked,
        tags: liveTagIds(data.tags),
      };
      const enc = await encryptItemData(newData);
      let saved;
      if (item.id) {
        saved = await withSessionGuard(() => saveItem({ id: item.id, categoryId: category.id, expectedUpdatedAt: item.updatedAt, ...enc }));
      } else {
        saved = await withSessionGuard(() => createItem({ id: crypto.randomUUID(), categoryId: category.id, ...enc }));
        bumpCategoryCount(category.id, 1);
      }
      if (saved) syncIndex(saved, enc, newData);
      closeEditor();
      await reloadCurrentView();
    } catch (err) {
      if (err.status !== 409) throw err;
      alert('This item was changed elsewhere, so your edit was not saved. The latest version has been reloaded.');
      closeEditor();
      await reloadCurrentView();
      refreshIndex();
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
  closeAutofill();
  el.modalBackdrop.style.display = 'none';
}

el.itemModalClose.addEventListener('click', closeEditor);

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
    reloadCurrentView();
  }
}

el.viewModalClose.addEventListener('click', closeViewModal);

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
  attachEmojiInput(iconInput);
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
    removeCategoryFromIndex(working.id);
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
      refreshIndex();
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

  const listsSection = document.createElement('div');
  listsSection.className = 'settings-section';
  listsSection.innerHTML = `
    <div class="settings-section-title">Autofill lists</div>
    <div class="option-block" id="settings-services"></div>
    <div class="option-block" id="settings-providers"></div>
  `;
  el.settingsModalBody.appendChild(listsSection);
  renderOptionEditor(listsSection.querySelector('#settings-services'), {
    kind: 'service',
    title: 'Services',
    hint: 'Offered when filling a Service field and when searching with service:. Added to the built-in list.',
    placeholder: 'e.g. My Bank',
    defaults: DEFAULT_SERVICES,
    normalize: normalizeService,
    invalidMessage: 'Enter a name up to 40 characters.',
  });
  renderOptionEditor(listsSection.querySelector('#settings-providers'), {
    kind: 'email-provider',
    title: 'Email providers',
    hint: 'Domains offered after the @ in Email fields. Added to the built-in list.',
    placeholder: 'e.g. mycompany.com',
    defaults: DEFAULT_EMAIL_PROVIDERS,
    normalize: normalizeProvider,
    invalidMessage: 'Enter a domain such as mycompany.com.',
  });

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
      <p class="hint" style="margin-bottom:14px">Changing this re-encrypts every item in your vault. It can take a moment if you have a lot of items. Keep this tab open until it finishes.</p>
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
      <p class="hint" style="margin-bottom:12px">Deletes every category, item and tag. Cannot be undone.</p>
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
    if (newPassword.length < 8) {
      errorEl.textContent = 'New password must be at least 8 characters.';
      errorEl.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Re-encrypting…';
    try {
      const rows = await fetchItems();
      const decrypted = await Promise.all(rows.map(async (row) => {
        try {
          return { row, data: await decryptItemData(row) };
        } catch (e) {
          throw new Error('An item could not be decrypted, so the password was not changed.');
        }
      }));

      const session = await checkSession();
      const oldAuthProof = await deriveAuthProof(oldPassword, session.salt);
      const newAuthProof = await deriveAuthProof(newPassword, session.salt);
      const newKey = await deriveVaultKey(newPassword, session.salt);

      const reencrypted = [];
      for (const { row, data } of decrypted) {
        const enc = await encryptItemDataWithKey(newKey, data);
        reencrypted.push({ id: row.id, dataEnc: enc.dataEnc, iv: enc.iv, expectedUpdatedAt: row.updatedAt });
      }

      await changePassword(oldAuthProof, newAuthProof, reencrypted);
      installVaultKey(newKey);
      renderView().catch(() => {});
      refreshIndex();

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
      const bundle = { exportedAt: new Date().toISOString(), categories: state.categories, tags: state.tags, options: state.options, items: [] };
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

      const categoryIds = new Set(state.categories.map(c => c.id));
      for (const category of bundle.categories || []) {
        if (categoryIds.has(category.id)) continue;
        try {
          const created = await createCategory({ id: category.id, name: category.name, icon: category.icon || '', sortOrder: state.categories.length, fields: category.fields || [] });
          state.categories.push(created);
          categoryIds.add(created.id);
        } catch (e) {}
      }

      const tagIdMap = new Map();
      for (const tag of bundle.tags || []) {
        try {
          tagIdMap.set(tag.id, (await ensureTag(tag.name)).id);
        } catch (e) {}
      }

      for (const option of bundle.options || []) {
        const value = option.kind === 'service' ? normalizeService(option.value) : normalizeProvider(option.value);
        if (!value || !['service', 'email-provider'].includes(option.kind)) continue;
        if (state.options.some(o => o.kind === option.kind && o.value.toLowerCase() === value.toLowerCase())) continue;
        try {
          state.options.push(await createOption({ id: newOptionId(), kind: option.kind, value }));
        } catch (e) {}
      }

      let imported = 0;
      let skipped = 0;
      for (const entry of bundle.items) {
        if (!entry.categoryId || !categoryIds.has(entry.categoryId)) {
          skipped++;
          continue;
        }
        const data = { ...entry.data, tags: (entry.data.tags || []).map(id => tagIdMap.get(id)).filter(Boolean) };
        const enc = await encryptItemData(data);
        await createItem({ id: crypto.randomUUID(), categoryId: entry.categoryId, ...enc });
        imported++;
      }
      alert(`Imported ${imported} item(s).` + (skipped ? ` ${skipped} skipped because their category could not be restored.` : ''));
      await loadCategories();
      refreshIndex();
    } catch (err) {
      alert('Import failed: ' + err.message);
    } finally {
      e.target.value = '';
    }
  });

  document.getElementById('settings-wipe-btn').addEventListener('click', async () => {
    if (!confirm('This deletes every category, item and tag permanently. There is no undo. Continue?')) return;
    for (const category of state.categories) {
      await withSessionGuard(() => deleteCategory(category.id));
    }
    for (const tag of state.tags) await withSessionGuard(() => deleteTag(tag.id));
    state.tags = [];
    state.tagId = null;
    state.activeCategoryId = null;
    replaceIndex([]);
    await loadCategories();
    alert('All data deleted.');
  });
}

async function wireSettingsAdmin() {
  async function refreshUsers() {
    const users = await listUsers();
    const tbody = document.getElementById('settings-users-tbody');
    tbody.innerHTML = '';
    for (const u of users) {
      const tr = document.createElement('tr');
      const cells = [
        u.username || '(pending)',
        u.role,
        u.status,
        `${u.invite_code}${Number(u.invite_used) ? ' (used)' : ''}`,
        u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '—',
      ];
      cells.forEach((text, i) => {
        const td = document.createElement('td');
        if (i === 3) td.className = 'mono';
        td.textContent = text;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
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
      resultEl.textContent = `Code: ${result.code}`;
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
el.addTagBtn?.addEventListener('click', () => openTagModal());
el.tagModalClose.addEventListener('click', closeTagModal);

function openCategoryModal() {
  el.categoryModalBody.innerHTML = '';

  const nameField = document.createElement('div');
  nameField.className = 'field';
  nameField.innerHTML = `<label class="field-label">Icon &amp; name</label>`;
  const nameRow = document.createElement('div');
  nameRow.className = 'input-row';
  const iconInput = document.createElement('input');
  iconInput.className = 'input icon-input';
  attachEmojiInput(iconInput);
  iconInput.title = 'Emoji icon for this category';
  iconInput.value = '📁';
  const nameInput = document.createElement('input');
  nameInput.className = 'input';
  nameInput.placeholder = 'e.g. Email Accounts';
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
      state.view = 'category';
      state.activeCategoryId = category.id;
      renderNav();
      closeCategoryModal();
      await renderView();
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

el.topbarSidebarToggle?.addEventListener('click', toggleSidebar);

el.lockBtn?.addEventListener('click', () => {
  lockVault();
  resetState();
  showUnlockGate(state.username || '');
});

async function performLogout() {
  await logout().catch(() => {});
  lockVault();
  state.username = null;
  state.role = null;
  resetState();
  showLoginGate();
}

el.logoutBtn?.addEventListener('click', performLogout);
el.unlockLogout?.addEventListener('click', performLogout);

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
    const { salt } = await getAuthSalt(username);
    const authProof = await deriveAuthProof(password, salt);
    const result = await login(username, authProof);
    await unlockVault(password, result.salt);
    state.username = result.username;
    state.role = result.role;
    state.loginCount = result.loginCount || 0;
    state.commit = result.commit || '';
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
    state.loginCount = session.loginCount || 0;
    state.commit = session.commit || '';
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
  state.loginCount = session.loginCount || 0;
  state.commit = session.commit || '';

  if (isUnlocked()) {
    await showApp();
  } else {
    showUnlockGate(session.username);
  }
}

boot();

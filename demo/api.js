import { DEMO_USERNAME, DEMO_PASSWORD } from '/demo/config.js';

const bundle = await (await fetch('/demo/data.json')).json();

const rows = bundle.items.map(item => ({
  id: item.id,
  categoryId: item.categoryId,
  dataEnc: JSON.stringify(item.data),
  iv: 'demo',
  createdAt: bundle.exportedAt,
  updatedAt: bundle.exportedAt,
}));

let signedIn = false;
let loginCount = 11;

const clone = (value) => JSON.parse(JSON.stringify(value));

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function requireSession() {
  if (!signedIn) throw fail(401, 'Not authenticated');
}

async function refuse() {
  requireSession();
  throw fail(403, 'The demo is read-only');
}

function sessionInfo() {
  return { userId: 'demo', username: DEMO_USERNAME, role: 'demo', salt: 'demo', loginCount, commit: '' };
}

async function login(username, authProof) {
  if (username !== DEMO_USERNAME || authProof !== DEMO_PASSWORD) throw fail(401, 'Incorrect username or password');
  signedIn = true;
  loginCount += 1;
  return { ok: true, ...sessionInfo() };
}

async function logout() {
  signedIn = false;
  return { ok: true };
}

async function checkSession() {
  return signedIn ? { authenticated: true, ...sessionInfo() } : { authenticated: false };
}

async function getAuthSalt() {
  return { salt: 'demo' };
}

async function checkInviteCode() {
  throw fail(404, 'Invalid invite code');
}

async function acceptInvite() {
  throw fail(403, 'The demo is read-only');
}

async function fetchCategories() {
  requireSession();
  return bundle.categories.map(category => ({
    ...clone(category),
    itemCount: rows.filter(row => row.categoryId === category.id).length,
  }));
}

async function fetchItems(categoryId = null) {
  requireSession();
  return clone(rows.filter(row => !categoryId || row.categoryId === categoryId));
}

async function fetchTags() {
  requireSession();
  return clone(bundle.tags).sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchOptions() {
  requireSession();
  return clone(bundle.options || []);
}

const createCategory = refuse;
const saveCategory = refuse;
const reorderCategories = refuse;
const deleteCategory = refuse;
const createItem = refuse;
const saveItem = refuse;
const deleteItem = refuse;
const createTag = refuse;
const renameTag = refuse;
const deleteTag = refuse;
const createOption = refuse;
const deleteOption = refuse;
const createInvite = refuse;
const listUsers = refuse;
const changePassword = refuse;

export {
  login,
  logout,
  checkSession,
  getAuthSalt,
  checkInviteCode,
  acceptInvite,
  createInvite,
  listUsers,
  changePassword,
  fetchCategories,
  createCategory,
  saveCategory,
  reorderCategories,
  deleteCategory,
  fetchTags,
  createTag,
  renameTag,
  deleteTag,
  fetchOptions,
  createOption,
  deleteOption,
  fetchItems,
  createItem,
  saveItem,
  deleteItem,
};

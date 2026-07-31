async function request(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    credentials: 'same-origin',
  });

  let body = null;
  try { body = await res.json(); } catch (e) {}

  if (!res.ok) {
    const message = body?.error || `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  return body;
}

async function login(username, password) {
  return request('/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
}

async function logout() {
  return request('/api/logout', { method: 'POST' });
}

async function checkSession() {
  return request('/api/session', { method: 'GET' });
}

async function checkInviteCode(code) {
  return request(`/api/invite/${encodeURIComponent(code)}`, { method: 'GET' });
}

async function acceptInvite(code, username, password) {
  return request('/api/accept-invite', { method: 'POST', body: JSON.stringify({ code, username, password }) });
}

async function createInvite(customCode = null) {
  return request('/api/invite', { method: 'POST', body: JSON.stringify({ customCode }) });
}

async function listUsers() {
  return request('/api/users', { method: 'GET' });
}

async function changePassword(oldPassword, newPassword) {
  return request('/api/change-password', { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) });
}

async function fetchCategories() {
  return request('/api/categories', { method: 'GET' });
}

async function createCategory(category) {
  return request('/api/categories', { method: 'POST', body: JSON.stringify(category) });
}

async function saveCategory(category) {
  return request('/api/categories', { method: 'PUT', body: JSON.stringify(category) });
}

async function deleteCategory(categoryId) {
  return request(`/api/categories?id=${encodeURIComponent(categoryId)}`, { method: 'DELETE' });
}

async function fetchItems(categoryId = null) {
  const qs = categoryId ? `?categoryId=${encodeURIComponent(categoryId)}` : '';
  return request(`/api/items${qs}`, { method: 'GET' });
}

async function createItem(item) {
  return request('/api/items', { method: 'POST', body: JSON.stringify(item) });
}

async function saveItem(item) {
  return request('/api/items', { method: 'PUT', body: JSON.stringify(item) });
}

async function deleteItem(itemId) {
  return request(`/api/items?id=${encodeURIComponent(itemId)}`, { method: 'DELETE' });
}

export {
  login,
  logout,
  checkSession,
  checkInviteCode,
  acceptInvite,
  createInvite,
  listUsers,
  changePassword,
  fetchCategories,
  createCategory,
  saveCategory,
  deleteCategory,
  fetchItems,
  createItem,
  saveItem,
  deleteItem,
};

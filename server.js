import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getClient } from './core/db/turso-client.js';
import { ensureUsersTable } from './core/db/schema.js';
import { createCategory, saveCategory, deleteCategory, loadCategories } from './core/db/categories.js';
import { createItem, saveItem, deleteItem, loadItems } from './core/db/items.js';
import { createSessionCookie, getSessionUserId } from './core/auth/session.js';
import {
  createInvite,
  findByInviteCode,
  acceptInvite,
  verifyLogin,
  findById,
  listUsers,
  seedAdminIfMissing,
} from './core/db/users.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// Legacy .html paths -> clean equivalents. 301 so bookmarks/links age out gracefully.
const LEGACY_REDIRECTS = {
  '/index.html': '/',
  '/pages/login.html': '/invite',
  '/pages/settings.html': '/settings',
  '/pages/handbook.html': '/handbook',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

function redirect(res, location) {
  res.writeHead(301, { Location: location });
  res.end();
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

function setSessionCookie(res, userId) {
  const value = createSessionCookie(userId);
  res.setHeader('Set-Cookie', [
    `waystone_session=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24 * 14}`,
  ]);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', ['waystone_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0']);
}

async function serveFile(res, filePath) {
  try {
    const body = await fsp.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    send(res, 404, 'Not found');
  }
}

function isSafeStaticPath(reqPath) {
  const resolved = path.normalize(path.join(__dirname, reqPath));
  return resolved.startsWith(__dirname);
}

async function requireUser(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    sendJson(res, 401, { error: 'Not authenticated' });
    return null;
  }
  return userId;
}

async function requireAdmin(req, res) {
  const userId = await requireUser(req, res);
  if (!userId) return null;
  const user = await findById(getClient(), userId);
  if (!user || user.role !== 'admin') {
    sendJson(res, 403, { error: 'Admin only' });
    return null;
  }
  return userId;
}

async function handleLogin(req, res) {
  const { username, password } = await readJsonBody(req);
  if (!username || !password) return sendJson(res, 400, { error: 'Missing username or password' });

  const client = getClient();
  const user = await verifyLogin(client, username, password);
  if (!user) return sendJson(res, 401, { error: 'Incorrect username or password' });

  setSessionCookie(res, user.id);
  sendJson(res, 200, { ok: true, userId: user.id, username: user.username, role: user.role, salt: user.salt });
}

function handleLogout(req, res) {
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
}

async function handleSessionCheck(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) return sendJson(res, 200, { authenticated: false });
  const user = await findById(getClient(), userId);
  if (!user) return sendJson(res, 200, { authenticated: false });
  sendJson(res, 200, { authenticated: true, userId: user.id, username: user.username, role: user.role, salt: user.pbkdf2_salt });
}

async function handleInviteCheck(req, res, code) {
  const client = getClient();
  const user = await findByInviteCode(client, code);
  if (!user) return sendJson(res, 404, { error: 'Invalid invite code' });
  if (Number(user.invite_used) === 1) return sendJson(res, 410, { error: 'This invite code has already been used' });
  sendJson(res, 200, { valid: true });
}

async function handleAcceptInvite(req, res) {
  const { code, username, password } = await readJsonBody(req);
  if (!code || !username || !password) return sendJson(res, 400, { error: 'Missing fields' });
  if (password.length < 8) return sendJson(res, 400, { error: 'Password must be at least 8 characters' });

  const client = getClient();
  try {
    const result = await acceptInvite(client, { code, username, password });
    sendJson(res, 200, { ok: true, username: result.username });
  } catch (e) {
    sendJson(res, 400, { error: e.message });
  }
}

async function handleCreateInvite(req, res) {
  const userId = await requireAdmin(req, res);
  if (!userId) return;
  const { customCode } = await readJsonBody(req);
  try {
    const result = await createInvite(getClient(), { customCode });
    sendJson(res, 200, result);
  } catch (e) {
    sendJson(res, 400, { error: e.message });
  }
}

async function handleListUsers(req, res) {
  const userId = await requireAdmin(req, res);
  if (!userId) return;
  sendJson(res, 200, await listUsers(getClient()));
}

async function handleCategories(req, res, url) {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const client = getClient();

  if (req.method === 'GET') return sendJson(res, 200, await loadCategories(client, userId));
  if (req.method === 'POST') return sendJson(res, 200, await createCategory(client, userId, await readJsonBody(req)));
  if (req.method === 'PUT') return sendJson(res, 200, await saveCategory(client, userId, await readJsonBody(req)));
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return sendJson(res, 400, { error: 'Missing id' });
    await deleteCategory(client, userId, id);
    return sendJson(res, 200, { ok: true });
  }
  sendJson(res, 405, { error: 'Method not allowed' });
}

async function handleItems(req, res, url) {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const client = getClient();

  if (req.method === 'GET') return sendJson(res, 200, await loadItems(client, userId, url.searchParams.get('categoryId')));
  if (req.method === 'POST') return sendJson(res, 200, await createItem(client, userId, await readJsonBody(req)));
  if (req.method === 'PUT') return sendJson(res, 200, await saveItem(client, userId, await readJsonBody(req)));
  if (req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return sendJson(res, 400, { error: 'Missing id' });
    await deleteItem(client, userId, id);
    return sendJson(res, 200, { ok: true });
  }
  sendJson(res, 405, { error: 'Method not allowed' });
}

async function handleChangePassword(req, res) {
  const userId = await requireUser(req, res);
  if (!userId) return;
  const { oldPassword, newPassword } = await readJsonBody(req);
  if (!oldPassword || !newPassword) return sendJson(res, 400, { error: 'Missing fields' });
  if (newPassword.length < 8) return sendJson(res, 400, { error: 'New password must be at least 8 characters' });

  const client = getClient();
  const user = await findById(client, userId);
  if (!user) return sendJson(res, 404, { error: 'User not found' });

  const argon2 = (await import('argon2')).default;
  const ok = await argon2.verify(user.password_hash, oldPassword).catch(() => false);
  if (!ok) return sendJson(res, 401, { error: 'Incorrect current password' });

  const newHash = await argon2.hash(newPassword, {
    type: argon2.argon2id,
    memoryCost: 131072,
    timeCost: 3,
    parallelism: 1,
  });

  const { tursoExec } = await import('./core/db/turso-client.js');
  await tursoExec(client, `UPDATE waystone_users SET password_hash = ? WHERE id = ?`, [newHash, userId]);

  sendJson(res, 200, { ok: true, salt: user.pbkdf2_salt });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    if (pathname === '/api/login' && req.method === 'POST') return await handleLogin(req, res);
    if (pathname === '/api/logout' && req.method === 'POST') return handleLogout(req, res);
    if (pathname === '/api/session' && req.method === 'GET') return await handleSessionCheck(req, res);
    if (pathname.startsWith('/api/invite/') && req.method === 'GET') {
      return await handleInviteCheck(req, res, decodeURIComponent(pathname.slice('/api/invite/'.length)));
    }
    if (pathname === '/api/invite' && req.method === 'POST') return await handleCreateInvite(req, res);
    if (pathname === '/api/accept-invite' && req.method === 'POST') return await handleAcceptInvite(req, res);
    if (pathname === '/api/users' && req.method === 'GET') return await handleListUsers(req, res);
    if (pathname === '/api/change-password' && req.method === 'POST') return await handleChangePassword(req, res);
    if (pathname === '/api/categories') return await handleCategories(req, res, url);
    if (pathname === '/api/items') return await handleItems(req, res, url);

    // Legacy .html paths redirect to their clean equivalents.
    if (LEGACY_REDIRECTS[pathname]) return redirect(res, LEGACY_REDIRECTS[pathname]);

    if (pathname === '/') {
      return serveFile(res, path.join(__dirname, 'index.html'));
    }

    if (pathname === '/settings') {
      // No separate settings page anymore — same app shell as '/'. app.js
      // detects this path on boot and opens the settings modal itself,
      // then cleans the URL back to '/' so it isn't a "page" you can get stuck on.
      return serveFile(res, path.join(__dirname, 'index.html'));
    }

    if (pathname === '/handbook') {
      return serveFile(res, path.join(__dirname, 'pages', 'handbook.html'));
    }

    // /invite accepts an optional trailing code segment, e.g. /invite/GAMER1,
    // so invite links can be shared as a single clickable URL. The code
    // itself is read client-side from location.pathname and pre-filled.
    if (pathname === '/invite' || /^\/invite\/[^/]+$/.test(pathname)) {
      return serveFile(res, path.join(__dirname, 'pages', 'login.html'));
    }

    if (
      pathname.startsWith('/style/') ||
      pathname.startsWith('/assets/') ||
      pathname.startsWith('/core/client/')
    ) {
      if (!isSafeStaticPath(pathname)) return send(res, 403, 'Forbidden');
      return serveFile(res, path.join(__dirname, pathname));
    }

    return send(res, 404, 'Not found');
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { error: 'Server error' });
  }
});

async function boot() {
  try {
    await ensureUsersTable(getClient());
    console.log('waystone_users ready.');

    if (process.env.SEED_ADMIN_USERNAME && process.env.SEED_ADMIN_PASSWORD_HASH) {
      const created = await seedAdminIfMissing(getClient(), process.env.SEED_ADMIN_USERNAME, process.env.SEED_ADMIN_PASSWORD_HASH);
      if (created) console.log('Seeded admin user:', created.username);
    }
  } catch (e) {
    console.error('Failed to ensure Turso tables on boot:', e.message);
  }
  server.listen(PORT, () => console.log(`WayStone listening on :${PORT}`));
}

boot();

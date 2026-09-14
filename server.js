import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getClient } from './core/db/turso-client.js';
import { ensureUsersTable, ensureCategoriesTable, ensureItemsTable } from './core/db/schema.js';
import { createCategory, saveCategory, deleteCategory, loadCategories } from './core/db/categories.js';
import { createItem, saveItem, deleteItem, loadItems } from './core/db/items.js';
import { createSessionCookie, getSessionInfo } from './core/auth/session.js';
import { checkRateLimit } from './core/auth/rate-limit.js';
import {
  createInvite,
  findByInviteCode,
  acceptInvite,
  verifyLogin,
  findById,
  getAuthSalt,
  bumpSessionVersion,
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

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

function setSessionCookie(res, userId, sessionVersion) {
  const value = createSessionCookie(userId, sessionVersion);
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
  const info = getSessionInfo(req);
  if (!info) {
    sendJson(res, 401, { error: 'Not authenticated' });
    return null;
  }
  const user = await findById(getClient(), info.userId);
  if (!user || user.status !== 'active' || Number(user.session_version) !== info.sessionVersion) {
    sendJson(res, 401, { error: 'Not authenticated' });
    return null;
  }
  return user;
}

async function requireAdmin(req, res) {
  const user = await requireUser(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    sendJson(res, 403, { error: 'Admin only' });
    return null;
  }
  return user;
}

async function handleLogin(req, res) {
  const { username, authProof } = await readJsonBody(req);
  if (!username || !authProof) return sendJson(res, 400, { error: 'Missing username or password' });

  if (!checkRateLimit(`login:${getClientIp(req)}`, { max: 10, windowMs: 15 * 60 * 1000 })) {
    return sendJson(res, 429, { error: 'Too many attempts — try again later' });
  }

  const client = getClient();
  const user = await verifyLogin(client, username, authProof);
  if (!user) return sendJson(res, 401, { error: 'Incorrect username or password' });

  setSessionCookie(res, user.id, user.sessionVersion);
  sendJson(res, 200, { ok: true, userId: user.id, username: user.username, role: user.role, salt: user.salt });
}

async function handleLogout(req, res) {
  const info = getSessionInfo(req);
  if (info) {
    await bumpSessionVersion(getClient(), info.userId).catch(() => {});
  }
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
}

async function handleSessionCheck(req, res) {
  const info = getSessionInfo(req);
  if (!info) return sendJson(res, 200, { authenticated: false });
  const user = await findById(getClient(), info.userId);
  if (!user || Number(user.session_version) !== info.sessionVersion) return sendJson(res, 200, { authenticated: false });
  sendJson(res, 200, { authenticated: true, userId: user.id, username: user.username, role: user.role, salt: user.pbkdf2_salt });
}

async function handleAuthSalt(req, res, username) {
  if (!checkRateLimit(`auth-salt:${getClientIp(req)}`, { max: 20, windowMs: 15 * 60 * 1000 })) {
    return sendJson(res, 429, { error: 'Too many attempts — try again later' });
  }
  const salt = await getAuthSalt(getClient(), username);
  sendJson(res, 200, { salt });
}

async function handleInviteCheck(req, res, code) {
  const client = getClient();
  const user = await findByInviteCode(client, code);
  if (!user) return sendJson(res, 404, { error: 'Invalid invite code' });
  if (Number(user.invite_used) === 1) return sendJson(res, 410, { error: 'This invite code has already been used' });
  sendJson(res, 200, { valid: true, salt: user.pbkdf2_salt });
}

async function handleAcceptInvite(req, res) {
  const { code, username, authProof } = await readJsonBody(req);
  if (!code || !username || !authProof) return sendJson(res, 400, { error: 'Missing fields' });

  if (!checkRateLimit(`accept-invite:${getClientIp(req)}`, { max: 10, windowMs: 15 * 60 * 1000 })) {
    return sendJson(res, 429, { error: 'Too many attempts — try again later' });
  }

  const client = getClient();
  try {
    const result = await acceptInvite(client, { code, username, authProof });
    sendJson(res, 200, { ok: true, username: result.username });
  } catch (e) {
    sendJson(res, 400, { error: e.message });
  }
}

async function handleCreateInvite(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;
  const { customCode } = await readJsonBody(req);
  try {
    const result = await createInvite(getClient(), { customCode });
    sendJson(res, 200, result);
  } catch (e) {
    sendJson(res, 400, { error: e.message });
  }
}

async function handleListUsers(req, res) {
  const user = await requireAdmin(req, res);
  if (!user) return;
  sendJson(res, 200, await listUsers(getClient()));
}

async function handleCategories(req, res, url) {
  const user = await requireUser(req, res);
  if (!user) return;
  const userId = user.id;
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
  const user = await requireUser(req, res);
  if (!user) return;
  const userId = user.id;
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
  const user = await requireUser(req, res);
  if (!user) return;
  const { oldAuthProof, newAuthProof } = await readJsonBody(req);
  if (!oldAuthProof || !newAuthProof) return sendJson(res, 400, { error: 'Missing fields' });

  const client = getClient();
  const argon2 = (await import('argon2')).default;
  const ok = await argon2.verify(user.password_hash, oldAuthProof).catch(() => false);
  if (!ok) return sendJson(res, 401, { error: 'Incorrect current password' });

  const newHash = await argon2.hash(newAuthProof, {
    type: argon2.argon2id,
    memoryCost: 131072,
    timeCost: 3,
    parallelism: 1,
  });

  const newSessionVersion = Number(user.session_version || 0) + 1;
  const { tursoExec } = await import('./core/db/turso-client.js');
  await tursoExec(client, `UPDATE waystone_users SET password_hash = ?, session_version = ? WHERE id = ?`, [newHash, newSessionVersion, user.id]);

  setSessionCookie(res, user.id, newSessionVersion);
  sendJson(res, 200, { ok: true, salt: user.pbkdf2_salt });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    if (pathname === '/api/login' && req.method === 'POST') return await handleLogin(req, res);
    if (pathname === '/api/logout' && req.method === 'POST') return await handleLogout(req, res);
    if (pathname === '/api/session' && req.method === 'GET') return await handleSessionCheck(req, res);
    if (pathname.startsWith('/api/auth-salt/') && req.method === 'GET') {
      return await handleAuthSalt(req, res, decodeURIComponent(pathname.slice('/api/auth-salt/'.length)));
    }
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
    const client = getClient();
    await ensureUsersTable(client);
    await ensureCategoriesTable(client);
    await ensureItemsTable(client);
    console.log('Tables ready.');

    if (process.env.SEED_ADMIN_USERNAME && process.env.SEED_ADMIN_PASSWORD_HASH && process.env.SEED_ADMIN_SALT) {
      const created = await seedAdminIfMissing(client, process.env.SEED_ADMIN_USERNAME, process.env.SEED_ADMIN_PASSWORD_HASH, process.env.SEED_ADMIN_SALT);
      if (created) console.log('Seeded admin user:', created.username);
    }
  } catch (e) {
    console.error('Failed to ensure Turso tables on boot:', e.message);
  }
  server.listen(PORT, () => console.log(`WayStone listening on :${PORT}`));
}

boot();

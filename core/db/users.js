import crypto from 'node:crypto';
import argon2 from 'argon2';
import { tursoExec, tursoSelect } from './turso-client.js';
import { ensureUserTables } from './schema.js';

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function generateRandomCode(length = 6) {
  let code = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  return code;
}

function generateUserId() {
  return crypto.randomBytes(16).toString('hex');
}

function generateSalt() {
  return crypto.randomBytes(16).toString('base64');
}

function normalizeCode(code) {
  return (code || '').trim().toUpperCase();
}

async function createInvite(client, { customCode = null } = {}) {
  const id = generateUserId();
  const salt = generateSalt();
  let code = customCode ? normalizeCode(customCode) : generateRandomCode();

  if (customCode) {
    if (!/^[A-Z0-9]{4,32}$/.test(code)) {
      throw new Error('Custom code must be 4-32 uppercase letters/numbers');
    }
    const existing = await tursoSelect(client, `SELECT id FROM waystone_users WHERE invite_code = ?`, [code]);
    if (existing.length) throw new Error('That code is already in use');
  }

  const now = new Date().toISOString();
  await tursoExec(
    client,
    `INSERT INTO waystone_users (id, username, password_hash, pbkdf2_salt, role, status, invite_code, invite_used, created_at)
     VALUES (?, NULL, NULL, ?, 'member', 'pending', ?, 0, ?)`,
    [id, salt, code, now]
  );

  await ensureUserTables(client, id);

  return { id, code };
}

async function findByInviteCode(client, code) {
  const rows = await tursoSelect(client, `SELECT * FROM waystone_users WHERE invite_code = ?`, [normalizeCode(code)]);
  return rows[0] || null;
}

async function acceptInvite(client, { code, username, password }) {
  const user = await findByInviteCode(client, code);
  if (!user) throw new Error('Invalid invite code');
  if (Number(user.invite_used) === 1) throw new Error('This invite code has already been used');

  const existingUsername = await tursoSelect(client, `SELECT id FROM waystone_users WHERE username = ?`, [username]);
  if (existingUsername.length) throw new Error('That username is taken');

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 131072,
    timeCost: 3,
    parallelism: 1,
  });

  const now = new Date().toISOString();
  await tursoExec(
    client,
    `UPDATE waystone_users SET username = ?, password_hash = ?, status = 'active', invite_used = 1, accepted_at = ?
     WHERE id = ?`,
    [username, passwordHash, now, user.id]
  );

  return { id: user.id, username, salt: user.pbkdf2_salt };
}

async function findByUsername(client, username) {
  const rows = await tursoSelect(client, `SELECT * FROM waystone_users WHERE username = ?`, [username]);
  return rows[0] || null;
}

async function findById(client, userId) {
  const rows = await tursoSelect(client, `SELECT * FROM waystone_users WHERE id = ?`, [userId]);
  return rows[0] || null;
}

async function verifyLogin(client, username, password) {
  const user = await findByUsername(client, username);
  if (!user || user.status !== 'active' || !user.password_hash) return null;

  const ok = await argon2.verify(user.password_hash, password).catch(() => false);
  if (!ok) return null;

  await tursoExec(client, `UPDATE waystone_users SET last_login_at = ? WHERE id = ?`, [new Date().toISOString(), user.id]);

  return { id: user.id, username: user.username, role: user.role, salt: user.pbkdf2_salt };
}

async function listUsers(client) {
  const rows = await tursoSelect(client, `SELECT id, username, role, status, invite_code, invite_used, created_at, last_login_at FROM waystone_users ORDER BY created_at ASC`, []);
  return rows;
}

async function seedAdminIfMissing(client, adminUsername, adminPasswordHash) {
  const existing = await tursoSelect(client, `SELECT id FROM waystone_users WHERE role = 'admin'`, []);
  if (existing.length) return null;

  const id = generateUserId();
  const salt = generateSalt();
  const now = new Date().toISOString();
  await tursoExec(
    client,
    `INSERT INTO waystone_users (id, username, password_hash, pbkdf2_salt, role, status, invite_code, invite_used, created_at, accepted_at)
     VALUES (?, ?, ?, ?, 'admin', 'active', ?, 1, ?, ?)`,
    [id, adminUsername, adminPasswordHash, salt, generateRandomCode(10), now, now]
  );
  await ensureUserTables(client, id);
  return { id, username: adminUsername };
}

export {
  createInvite,
  findByInviteCode,
  acceptInvite,
  findByUsername,
  findById,
  verifyLogin,
  listUsers,
  seedAdminIfMissing,
  generateRandomCode,
};

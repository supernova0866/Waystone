import { tursoQuery } from './turso-client.js';

const SAFE_ID = /^[a-z0-9]{8,40}$/;

function assertSafeId(id) {
  if (!SAFE_ID.test(id)) throw new Error('Unsafe user id for table name: ' + id);
}

function categoriesTable(userId) {
  assertSafeId(userId);
  return `categories_${userId}`;
}

function itemsTable(userId) {
  assertSafeId(userId);
  return `items_${userId}`;
}

async function ensureUsersTable(client) {
  const { error } = await tursoQuery(client.url, client.token,
    `CREATE TABLE IF NOT EXISTS waystone_users (
       id TEXT PRIMARY KEY,
       username TEXT UNIQUE,
       password_hash TEXT,
       pbkdf2_salt TEXT NOT NULL,
       role TEXT DEFAULT 'member',
       status TEXT DEFAULT 'pending',
       invite_code TEXT UNIQUE NOT NULL,
       invite_used INTEGER DEFAULT 0,
       created_at TEXT,
       accepted_at TEXT,
       last_login_at TEXT
     )`, []);
  if (error) throw new Error(error);
}

async function ensureUserTables(client, userId) {
  const sqls = [
    `CREATE TABLE IF NOT EXISTS ${categoriesTable(userId)} (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       icon TEXT DEFAULT '',
       sort_order INTEGER DEFAULT 0,
       fields TEXT DEFAULT '[]'
     )`,
    `CREATE TABLE IF NOT EXISTS ${itemsTable(userId)} (
       id TEXT PRIMARY KEY,
       category_id TEXT,
       data_enc TEXT NOT NULL,
       iv TEXT NOT NULL,
       created_at TEXT,
       updated_at TEXT
     )`,
  ];
  for (const sql of sqls) {
    const { error } = await tursoQuery(client.url, client.token, sql, []);
    if (error) throw new Error(error);
  }
}

export { ensureUsersTable, ensureUserTables, categoriesTable, itemsTable, assertSafeId };

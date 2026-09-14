import { tursoQuery } from './turso-client.js';

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
       session_version INTEGER DEFAULT 0,
       created_at TEXT,
       accepted_at TEXT,
       last_login_at TEXT
     )`, []);
  if (error) throw new Error(error);

  // CREATE TABLE IF NOT EXISTS is a no-op on a table that already existed
  // before session_version was added, so it never gets the column. This
  // adds it if missing and is silently ignored if it's already there.
  await tursoQuery(client.url, client.token,
    `ALTER TABLE waystone_users ADD COLUMN session_version INTEGER DEFAULT 0`, []);
}

async function ensureCategoriesTable(client) {
  const sqls = [
    `CREATE TABLE IF NOT EXISTS categories (
       id TEXT PRIMARY KEY,
       user_id TEXT NOT NULL,
       name TEXT NOT NULL,
       icon TEXT DEFAULT '',
       sort_order INTEGER DEFAULT 0,
       fields TEXT DEFAULT '[]'
     )`,
    `CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id)`,
  ];
  for (const sql of sqls) {
    const { error } = await tursoQuery(client.url, client.token, sql, []);
    if (error) throw new Error(error);
  }
}

async function ensureItemsTable(client) {
  const sqls = [
    `CREATE TABLE IF NOT EXISTS items (
       id TEXT PRIMARY KEY,
       user_id TEXT NOT NULL,
       category_id TEXT,
       data_enc TEXT NOT NULL,
       iv TEXT NOT NULL,
       created_at TEXT,
       updated_at TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS idx_items_user_category ON items(user_id, category_id)`,
  ];
  for (const sql of sqls) {
    const { error } = await tursoQuery(client.url, client.token, sql, []);
    if (error) throw new Error(error);
  }
}

export { ensureUsersTable, ensureCategoriesTable, ensureItemsTable };

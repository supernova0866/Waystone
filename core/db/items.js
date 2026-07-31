import { tursoExec, tursoSelect } from './turso-client.js';
import { itemsTable } from './schema.js';

async function createItem(client, userId, item) {
  const table = itemsTable(userId);
  const now = new Date().toISOString();
  await tursoExec(
    client,
    `INSERT INTO ${table} (id, category_id, data_enc, iv, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [item.id, item.categoryId, item.dataEnc, item.iv, now, now]
  );
  return { ...item, createdAt: now, updatedAt: now };
}

async function saveItem(client, userId, item) {
  const table = itemsTable(userId);
  const now = new Date().toISOString();
  await tursoExec(
    client,
    `UPDATE ${table} SET data_enc = ?, iv = ?, updated_at = ? WHERE id = ?`,
    [item.dataEnc, item.iv, now, item.id]
  );
  return { ...item, updatedAt: now };
}

async function deleteItem(client, userId, itemId) {
  const table = itemsTable(userId);
  await tursoExec(client, `DELETE FROM ${table} WHERE id = ?`, [itemId]);
}

async function loadItems(client, userId, categoryId = null) {
  const table = itemsTable(userId);
  const rows = categoryId
    ? await tursoSelect(client, `SELECT * FROM ${table} WHERE category_id = ?`, [categoryId])
    : await tursoSelect(client, `SELECT * FROM ${table}`, []);
  return rows.map(r => ({
    id: r.id,
    categoryId: r.category_id,
    dataEnc: r.data_enc,
    iv: r.iv,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export { createItem, saveItem, deleteItem, loadItems };

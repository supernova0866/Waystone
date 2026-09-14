import { tursoExec, tursoSelect } from './turso-client.js';

async function createItem(client, userId, item) {
  const now = new Date().toISOString();
  await tursoExec(
    client,
    `INSERT INTO items (id, user_id, category_id, data_enc, iv, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [item.id, userId, item.categoryId, item.dataEnc, item.iv, now, now]
  );
  return { ...item, createdAt: now, updatedAt: now };
}

async function saveItem(client, userId, item) {
  const now = new Date().toISOString();
  await tursoExec(
    client,
    `UPDATE items SET data_enc = ?, iv = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
    [item.dataEnc, item.iv, now, item.id, userId]
  );
  return { ...item, updatedAt: now };
}

async function deleteItem(client, userId, itemId) {
  await tursoExec(client, `DELETE FROM items WHERE id = ? AND user_id = ?`, [itemId, userId]);
}

async function loadItems(client, userId, categoryId = null) {
  const rows = categoryId
    ? await tursoSelect(client, `SELECT * FROM items WHERE user_id = ? AND category_id = ?`, [userId, categoryId])
    : await tursoSelect(client, `SELECT * FROM items WHERE user_id = ?`, [userId]);
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

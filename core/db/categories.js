import { tursoExec, tursoSelect, tursoBatch } from './turso-client.js';

async function createCategory(client, userId, category) {
  await tursoExec(
    client,
    `INSERT INTO categories (id, user_id, name, icon, sort_order, fields) VALUES (?, ?, ?, ?, ?, ?)`,
    [category.id, userId, category.name, category.icon || '', category.sortOrder || 0, JSON.stringify(category.fields || [])]
  );
  return { ...category, itemCount: 0 };
}

async function saveCategory(client, userId, category) {
  await tursoExec(
    client,
    `INSERT INTO categories (id, user_id, name, icon, sort_order, fields)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name       = excluded.name,
       icon       = excluded.icon,
       sort_order = excluded.sort_order,
       fields     = excluded.fields
     WHERE categories.user_id = ?`,
    [category.id, userId, category.name, category.icon || '', category.sortOrder || 0, JSON.stringify(category.fields || []), userId]
  );
  return category;
}

async function reorderCategories(client, userId, orderedIds) {
  if (!Array.isArray(orderedIds) || orderedIds.some(id => typeof id !== 'string')) {
    throw new Error('Invalid order');
  }
  if (new Set(orderedIds).size !== orderedIds.length) throw new Error('Duplicate ids in order');

  const owned = await tursoSelect(client, `SELECT id FROM categories WHERE user_id = ?`, [userId]);
  const ownedIds = new Set(owned.map(r => r.id));
  if (ownedIds.size !== orderedIds.length || orderedIds.some(id => !ownedIds.has(id))) {
    throw new Error('Order must list every category exactly once');
  }

  await tursoBatch(
    client,
    orderedIds.map((id, i) => ({
      sql: `UPDATE categories SET sort_order = ? WHERE id = ? AND user_id = ?`,
      args: [i, id, userId],
    }))
  );
}

async function deleteCategory(client, userId, categoryId) {
  await tursoExec(client, `DELETE FROM items WHERE category_id = ? AND user_id = ?`, [categoryId, userId]);
  await tursoExec(client, `DELETE FROM categories WHERE id = ? AND user_id = ?`, [categoryId, userId]);
}

async function loadCategories(client, userId) {
  const rows = await tursoSelect(client, `SELECT * FROM categories WHERE user_id = ? ORDER BY sort_order ASC`, [userId]);

  let counts = {};
  try {
    const countRows = await tursoSelect(
      client,
      `SELECT category_id, COUNT(*) as cnt FROM items WHERE user_id = ? GROUP BY category_id`,
      [userId]
    );
    counts = Object.fromEntries(countRows.map(r => [r.category_id, Number(r.cnt) || 0]));
  } catch (e) {
    console.error('Failed to load item counts:', e.message);
  }

  return rows.map(c => ({
    id: c.id,
    name: c.name,
    icon: c.icon || '',
    sortOrder: Number(c.sort_order) || 0,
    fields: JSON.parse(c.fields || '[]'),
    itemCount: counts[c.id] || 0,
  }));
}

export { createCategory, saveCategory, reorderCategories, deleteCategory, loadCategories };

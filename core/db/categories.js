import { tursoExec, tursoSelect } from './turso-client.js';

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

async function deleteCategory(client, userId, categoryId) {
  await tursoExec(client, `DELETE FROM items WHERE category_id = ? AND user_id = ?`, [categoryId, userId]);
  await tursoExec(client, `DELETE FROM categories WHERE id = ? AND user_id = ?`, [categoryId, userId]);
}

async function loadCategories(client, userId) {
  const rows = await tursoSelect(client, `SELECT * FROM categories WHERE user_id = ? ORDER BY sort_order ASC`, [userId]);

  // One grouped query for every category's item count, rather than N queries
  // (or the sidebar just never showing counts, which is what was happening).
  // Tolerate this failing — a category list with blank counts beats one that
  // doesn't load at all if the items table is ever in an unexpected state.
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

export { createCategory, saveCategory, deleteCategory, loadCategories };

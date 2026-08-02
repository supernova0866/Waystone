import { tursoExec, tursoSelect } from './turso-client.js';
import { categoriesTable, itemsTable } from './schema.js';

async function createCategory(client, userId, category) {
  const table = categoriesTable(userId);
  await tursoExec(
    client,
    `INSERT INTO ${table} (id, name, icon, sort_order, fields) VALUES (?, ?, ?, ?, ?)`,
    [category.id, category.name, category.icon || '', category.sortOrder || 0, JSON.stringify(category.fields || [])]
  );
  return { ...category, itemCount: 0 };
}

async function saveCategory(client, userId, category) {
  const table = categoriesTable(userId);
  await tursoExec(
    client,
    `INSERT INTO ${table} (id, name, icon, sort_order, fields)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name       = excluded.name,
       icon       = excluded.icon,
       sort_order = excluded.sort_order,
       fields     = excluded.fields`,
    [category.id, category.name, category.icon || '', category.sortOrder || 0, JSON.stringify(category.fields || [])]
  );
  return category;
}

async function deleteCategory(client, userId, categoryId) {
  const catTable = categoriesTable(userId);
  await tursoExec(client, `DELETE FROM ${itemsTable(userId)} WHERE category_id = ?`, [categoryId]);
  await tursoExec(client, `DELETE FROM ${catTable} WHERE id = ?`, [categoryId]);
}

async function loadCategories(client, userId) {
  const table = categoriesTable(userId);
  const rows = await tursoSelect(client, `SELECT * FROM ${table} ORDER BY sort_order ASC`, []);

  // One grouped query for every category's item count, rather than N queries
  // (or the sidebar just never showing counts, which is what was happening).
  // Tolerate this failing — a category list with blank counts beats one that
  // doesn't load at all if the items table is ever in an unexpected state.
  let counts = {};
  try {
    const countRows = await tursoSelect(
      client,
      `SELECT category_id, COUNT(*) as cnt FROM ${itemsTable(userId)} GROUP BY category_id`,
      []
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

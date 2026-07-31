import { tursoExec, tursoSelect } from './turso-client.js';
import { categoriesTable } from './schema.js';

async function createCategory(client, userId, category) {
  const table = categoriesTable(userId);
  await tursoExec(
    client,
    `INSERT INTO ${table} (id, name, icon, sort_order, fields) VALUES (?, ?, ?, ?, ?)`,
    [category.id, category.name, category.icon || '', category.sortOrder || 0, JSON.stringify(category.fields || [])]
  );
  return category;
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
  const { itemsTable } = await import('./schema.js');
  await tursoExec(client, `DELETE FROM ${itemsTable(userId)} WHERE category_id = ?`, [categoryId]);
  await tursoExec(client, `DELETE FROM ${catTable} WHERE id = ?`, [categoryId]);
}

async function loadCategories(client, userId) {
  const table = categoriesTable(userId);
  const rows = await tursoSelect(client, `SELECT * FROM ${table} ORDER BY sort_order ASC`, []);
  return rows.map(c => ({
    id: c.id,
    name: c.name,
    icon: c.icon || '',
    sortOrder: Number(c.sort_order) || 0,
    fields: JSON.parse(c.fields || '[]'),
  }));
}

export { createCategory, saveCategory, deleteCategory, loadCategories };

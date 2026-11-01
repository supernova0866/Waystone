import { tursoExec, tursoSelect } from './turso-client.js';

class TagConflictError extends Error {
  constructor(message = 'A tag with that name already exists') {
    super(message);
    this.name = 'TagConflictError';
  }
}

class TagNotFoundError extends Error {
  constructor(message = 'Tag not found') {
    super(message);
    this.name = 'TagNotFoundError';
  }
}

function isUniqueViolation(e) {
  return /UNIQUE/i.test(e.message);
}

async function loadTags(client, userId) {
  const rows = await tursoSelect(client, `SELECT id, name, created_at FROM tags WHERE user_id = ? ORDER BY name ASC`, [userId]);
  return rows.map(r => ({ id: r.id, name: r.name, createdAt: r.created_at }));
}

async function createTag(client, userId, tag) {
  const now = new Date().toISOString();
  try {
    await tursoExec(
      client,
      `INSERT INTO tags (id, user_id, name, created_at) VALUES (?, ?, ?, ?)`,
      [tag.id, userId, tag.name, now]
    );
  } catch (e) {
    if (isUniqueViolation(e)) throw new TagConflictError();
    throw e;
  }
  return { id: tag.id, name: tag.name, createdAt: now };
}

async function renameTag(client, userId, tag) {
  let changed;
  try {
    changed = await tursoExec(client, `UPDATE tags SET name = ? WHERE id = ? AND user_id = ?`, [tag.name, tag.id, userId]);
  } catch (e) {
    if (isUniqueViolation(e)) throw new TagConflictError();
    throw e;
  }
  if (!changed) throw new TagNotFoundError();
  return { id: tag.id, name: tag.name };
}

async function deleteTag(client, userId, tagId) {
  await tursoExec(client, `DELETE FROM tags WHERE id = ? AND user_id = ?`, [tagId, userId]);
}

export { TagConflictError, TagNotFoundError, loadTags, createTag, renameTag, deleteTag };

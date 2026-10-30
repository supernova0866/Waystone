const entries = new Map();
let ready = false;

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function buildEntry(row, data, category) {
  const secrets = { password: 0, totp: 0, 'backup-codes': 0 };
  const text = [];

  for (const field of category?.fields || []) {
    const value = data.fields?.[field.id];
    if (!hasValue(value)) continue;
    if (field.type === 'secret') {
      const subtype = field.subtype in secrets ? field.subtype : 'password';
      secrets[subtype] += 1;
    } else {
      text.push(String(value));
    }
  }

  return {
    id: row.id,
    categoryId: row.categoryId,
    updatedAt: row.updatedAt,
    title: data.title || '',
    subtitle: data.subtitle || '',
    text,
    secrets,
    favorite: data.favorite === true,
    tags: Array.isArray(data.tags) ? data.tags : [],
  };
}

function replaceIndex(list) {
  entries.clear();
  for (const entry of list) entries.set(entry.id, entry);
  ready = true;
}

function upsertIndex(entry) {
  entries.set(entry.id, entry);
}

function removeFromIndex(id) {
  entries.delete(id);
}

function removeCategoryFromIndex(categoryId) {
  for (const [id, entry] of entries) {
    if (entry.categoryId === categoryId) entries.delete(id);
  }
}

function clearIndex() {
  entries.clear();
  ready = false;
}

function isIndexReady() {
  return ready;
}

function secretStats() {
  const counts = { password: 0, totp: 0, 'backup-codes': 0 };
  for (const entry of entries.values()) {
    for (const [subtype, n] of Object.entries(entry.secrets)) counts[subtype] += n;
  }
  return counts;
}

export { buildEntry, replaceIndex, upsertIndex, removeFromIndex, removeCategoryFromIndex, clearIndex, isIndexReady, secretStats };

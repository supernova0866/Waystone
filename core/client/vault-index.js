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
    row: {
      id: row.id,
      categoryId: row.categoryId,
      dataEnc: row.dataEnc,
      iv: row.iv,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
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

function favoriteEntries() {
  return [...entries.values()]
    .filter(entry => entry.favorite)
    .sort((a, b) => a.title.localeCompare(b.title));
}

function searchIndex(query, limit = 50) {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { results: [], total: 0 };

  const matches = [];
  for (const entry of entries.values()) {
    const title = entry.title.toLowerCase();
    const subtitle = entry.subtitle.toLowerCase();
    const haystack = `${title} ${subtitle} ${entry.text.join(' ').toLowerCase()}`;
    if (!tokens.every(token => haystack.includes(token))) continue;

    let score = 3;
    if (tokens.every(token => title.includes(token))) score = title.startsWith(tokens[0]) ? 0 : 1;
    else if (tokens.every(token => subtitle.includes(token))) score = 2;
    matches.push({ entry, score });
  }

  matches.sort((a, b) => a.score - b.score || a.entry.title.localeCompare(b.entry.title));
  return { results: matches.slice(0, limit).map(m => m.entry), total: matches.length };
}

export { buildEntry, replaceIndex, upsertIndex, removeFromIndex, removeCategoryFromIndex, clearIndex, isIndexReady, secretStats, favoriteEntries, searchIndex };

import { EMAIL_RE } from '/core/client/options.js';

const entries = new Map();
let ready = false;

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function addUnique(list, value) {
  const key = value.toLowerCase();
  if (!list.some(existing => existing.toLowerCase() === key)) list.push(value);
}

function buildEntry(row, data, category) {
  const secrets = { password: 0, multiline: 0, totp: 0, 'backup-codes': 0 };
  const text = [];
  const emails = [];
  const services = [];

  for (const field of category?.fields || []) {
    const value = data.fields?.[field.id];
    if (!hasValue(value)) continue;
    if (field.type === 'secret') {
      const subtype = field.subtype in secrets ? field.subtype : 'password';
      secrets[subtype] += 1;
      continue;
    }

    const str = String(value);
    text.push(str);
    const found = str.match(EMAIL_RE) || [];
    for (const email of found) addUnique(emails, email);
    if (field.type === 'email' && !found.length) addUnique(emails, str.trim());
    if (field.type === 'service') addUnique(services, str.trim());
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
    emails,
    services,
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
  const counts = { password: 0, multiline: 0, totp: 0, 'backup-codes': 0 };
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

function tagCounts() {
  const counts = new Map();
  for (const entry of entries.values()) {
    for (const id of entry.tags) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

function entriesWithTag(tagId) {
  return [...entries.values()].filter(entry => entry.tags.includes(tagId));
}

function rankedValues(pick) {
  const counts = new Map();
  for (const entry of entries.values()) {
    for (const value of pick(entry)) {
      const key = value.toLowerCase();
      const current = counts.get(key);
      if (current) current.count += 1;
      else counts.set(key, { value, count: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .map(item => item.value);
}

function knownEmails() {
  return rankedValues(entry => entry.emails);
}

function knownServices() {
  return rankedValues(entry => entry.services);
}

function matchesFilter(entry, filter, tagNames) {
  const needle = filter.value.toLowerCase();
  const test = (candidate) => (filter.exact ? candidate === needle : candidate.includes(needle));

  if (filter.kind === 'service') return entry.services.some(value => test(value.toLowerCase()));
  if (filter.kind === 'email') return entry.emails.some(value => test(value.toLowerCase()));
  if (filter.kind === 'tag') {
    if (filter.tagId) return entry.tags.includes(filter.tagId);
    return entry.tags.some(id => test((tagNames.get(id) || '').toLowerCase()));
  }
  return false;
}

function searchIndex(query, { filters = [], limit = 50, tagNames = new Map() } = {}) {
  const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length && !filters.length) return { results: [], total: 0 };

  const matches = [];
  for (const entry of entries.values()) {
    if (!filters.every(filter => matchesFilter(entry, filter, tagNames))) continue;

    const title = entry.title.toLowerCase();
    const subtitle = entry.subtitle.toLowerCase();
    const haystack = `${title} ${subtitle} ${entry.text.join(' ').toLowerCase()}`;
    if (!tokens.every(token => haystack.includes(token))) continue;

    let score = 3;
    if (tokens.length && tokens.every(token => title.includes(token))) score = title.startsWith(tokens[0]) ? 0 : 1;
    else if (tokens.length && tokens.every(token => subtitle.includes(token))) score = 2;
    matches.push({ entry, score });
  }

  matches.sort((a, b) => a.score - b.score || a.entry.title.localeCompare(b.entry.title));
  return { results: matches.slice(0, limit).map(m => m.entry), total: matches.length };
}

export {
  buildEntry,
  replaceIndex,
  upsertIndex,
  removeFromIndex,
  removeCategoryFromIndex,
  clearIndex,
  isIndexReady,
  secretStats,
  favoriteEntries,
  tagCounts,
  entriesWithTag,
  knownEmails,
  knownServices,
  searchIndex,
};

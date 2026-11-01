const DEFAULT_SERVICES = [
  'Discord', 'Google', 'Microsoft', 'Epic Games', 'Steam', 'Facebook', 'Instagram', 'Meta',
  'Activision', 'Amazon', 'Apple', 'Battle.net', 'EA', 'GitHub', 'Netflix', 'Nintendo',
  'PayPal', 'PlayStation', 'Reddit', 'Riot Games', 'Roblox', 'Spotify', 'TikTok', 'Twitch',
  'Ubisoft', 'X (Twitter)', 'Xbox', 'YouTube',
];

const DEFAULT_EMAIL_PROVIDERS = [
  'gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'proton.me',
  'protonmail.com', 'live.com', 'msn.com', 'aol.com', 'gmx.com', 'zoho.com', 'yandex.com',
  'mail.com', 'fastmail.com', 'tuta.com', 'me.com',
];

const PROVIDER_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const value of list) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function normalizeProvider(raw) {
  const value = String(raw || '').trim().toLowerCase().replace(/^@/, '');
  return value.length <= 100 && PROVIDER_RE.test(value) ? value : null;
}

function normalizeService(raw) {
  const value = String(raw || '').trim().replace(/\s+/g, ' ');
  return value && value.length <= 40 ? value : null;
}

function mergeProviders({ custom = [], defaults = DEFAULT_EMAIL_PROVIDERS } = {}) {
  return dedupe([...custom, ...defaults]);
}

function mergeServices({ known = [], custom = [], defaults = DEFAULT_SERVICES } = {}) {
  const spelling = new Map();
  for (const name of [...custom, ...defaults]) {
    if (!spelling.has(name.toLowerCase())) spelling.set(name.toLowerCase(), name);
  }
  return dedupe([...known, ...custom, ...defaults].map(name => spelling.get(name.toLowerCase()) || name));
}

function canonicalService(value, names) {
  const clean = String(value || '').trim();
  const match = names.find(name => name.toLowerCase() === clean.toLowerCase());
  return match || clean;
}

function suggestKnown(raw, list, { allowEmpty = false, limit = 8 } = {}) {
  const q = String(raw || '').trim().toLowerCase();
  if (!q) return allowEmpty ? list.slice(0, limit) : [];
  const starts = list.filter(item => item.toLowerCase().startsWith(q));
  const contains = list.filter(item => !item.toLowerCase().startsWith(q) && item.toLowerCase().includes(q));
  return [...starts, ...contains].filter(item => item.toLowerCase() !== q).slice(0, limit);
}

function suggestServices(raw, names, options = {}) {
  return suggestKnown(raw, names, options);
}

function suggestEmails(raw, { fieldType = 'text', known = [], providers = [], limit = 6 } = {}) {
  const typed = String(raw || '').trim();
  if (fieldType !== 'email' && !typed.includes('@')) return [];
  if (typed.length < 3) return [];

  const lower = typed.toLowerCase();
  const out = [];
  const push = (value) => {
    const key = value.toLowerCase();
    if (key !== lower && !out.some(existing => existing.toLowerCase() === key)) out.push(value);
  };

  for (const email of known) if (email.toLowerCase().startsWith(lower)) push(email);

  const at = typed.indexOf('@');
  if (at > 0) {
    const local = typed.slice(0, at);
    const domainPart = typed.slice(at + 1).toLowerCase();
    for (const domain of providers) if (domain.startsWith(domainPart)) push(`${local}@${domain}`);
  }

  for (const email of known) if (email.toLowerCase().includes(lower)) push(email);
  return out.slice(0, limit);
}

export {
  DEFAULT_SERVICES,
  DEFAULT_EMAIL_PROVIDERS,
  EMAIL_RE,
  normalizeProvider,
  normalizeService,
  mergeProviders,
  mergeServices,
  canonicalService,
  suggestKnown,
  suggestServices,
  suggestEmails,
};

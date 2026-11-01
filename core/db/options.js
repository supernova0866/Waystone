import { tursoExec, tursoSelect } from './turso-client.js';

const KINDS = ['service', 'email-provider'];
const PROVIDER_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

class OptionConflictError extends Error {
  constructor(message = 'That entry is already in your list') {
    super(message);
    this.name = 'OptionConflictError';
  }
}

function normalizeOption(kind, raw) {
  if (!KINDS.includes(kind)) return null;
  if (kind === 'service') {
    const value = String(raw || '').trim().replace(/\s+/g, ' ');
    return value && value.length <= 40 ? value : null;
  }
  const value = String(raw || '').trim().toLowerCase().replace(/^@/, '');
  return value.length <= 100 && PROVIDER_RE.test(value) ? value : null;
}

async function loadOptions(client, userId) {
  const rows = await tursoSelect(client, `SELECT id, kind, value FROM custom_options WHERE user_id = ? ORDER BY kind ASC, value ASC`, [userId]);
  return rows.map(r => ({ id: r.id, kind: r.kind, value: r.value }));
}

async function createOption(client, userId, option) {
  try {
    await tursoExec(
      client,
      `INSERT INTO custom_options (id, user_id, kind, value, created_at) VALUES (?, ?, ?, ?, ?)`,
      [option.id, userId, option.kind, option.value, new Date().toISOString()]
    );
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) throw new OptionConflictError();
    throw e;
  }
  return { id: option.id, kind: option.kind, value: option.value };
}

async function deleteOption(client, userId, optionId) {
  await tursoExec(client, `DELETE FROM custom_options WHERE id = ? AND user_id = ?`, [optionId, userId]);
}

export { OptionConflictError, normalizeOption, loadOptions, createOption, deleteOption };

import { pickTitleFields } from './categories.js';

function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = input.replace(/=+$/, '').toUpperCase().replace(/\s+/g, '');
  let bits = '';
  for (const c of clean) {
    const idx = alphabet.indexOf(c);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return new Uint8Array(bytes);
}

async function totpCode(secretBase32, timeStepSeconds = 30, digits = 6) {
  const keyBytes = base32Decode(secretBase32);
  if (keyBytes.length === 0) return null;
  const counter = Math.floor(Date.now() / 1000 / timeStepSeconds);
  const counterBuf = new ArrayBuffer(8);
  new DataView(counterBuf).setUint32(4, counter);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const hmac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBuf));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  const code = (binCode % 10 ** digits).toString().padStart(digits, '0');
  const secondsRemaining = timeStepSeconds - (Math.floor(Date.now() / 1000) % timeStepSeconds);
  return { code, secondsRemaining, period: timeStepSeconds };
}

function flashCopied(el) {
  const original = el.textContent;
  el.textContent = '✓';
  setTimeout(() => { el.textContent = original; }, 900);
}

function copyText(value) {
  navigator.clipboard?.writeText(value).catch(() => {});
}

function truncateStr(value, max = 12) {
  const s = String(value ?? '');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function fieldRow(label, valueEl) {
  const row = document.createElement('div');
  row.className = 'item-card-row';
  const labelEl = document.createElement('span');
  labelEl.className = 'item-card-row-label';
  labelEl.textContent = label;
  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

/**
 * Plain text/integer/rich-text field row. `truncateValue` is used for the
 * compact card body (12 chars + "…"); the View modal calls this with it
 * left off to show the full value. A field marked `copyable` in its schema
 * (see categories.js schema editor) gets a copy button regardless of which
 * mode this is rendered in — the button always copies the untruncated value.
 */
function renderTextRow(field, value, { truncateValue = false } = {}) {
  const displayValue = truncateValue ? truncateStr(value) : (value ?? '');

  if (field.copyable) {
    const wrap = document.createElement('span');
    wrap.className = 'secret-value';
    const valueEl = document.createElement('span');
    valueEl.className = 'item-card-row-value';
    valueEl.textContent = displayValue;
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-icon';
    copyBtn.title = 'Copy';
    copyBtn.textContent = '⧉';
    copyBtn.addEventListener('click', (e) => { e.stopPropagation(); copyText(value ?? ''); flashCopied(copyBtn); });
    wrap.appendChild(valueEl);
    wrap.appendChild(copyBtn);
    return fieldRow(field.name, wrap);
  }

  const valueEl = document.createElement('span');
  valueEl.className = 'item-card-row-value';
  valueEl.textContent = displayValue;
  return fieldRow(field.name, valueEl);
}

function renderSecretPasswordRow(field, value) {
  const wrap = document.createElement('span');
  wrap.className = 'secret-value';

  const dots = document.createElement('span');
  dots.className = 'secret-dots';
  dots.textContent = '••••••••••••';
  dots.dataset.revealed = '0';

  const actions = document.createElement('span');
  actions.className = 'secret-actions';

  const revealBtn = document.createElement('button');
  revealBtn.className = 'btn btn-icon';
  revealBtn.title = 'Reveal';
  revealBtn.textContent = '👁';
  revealBtn.addEventListener('click', () => {
    const revealed = dots.dataset.revealed === '1';
    dots.textContent = revealed ? '••••••••••••' : (value ?? '');
    dots.dataset.revealed = revealed ? '0' : '1';
    revealBtn.textContent = revealed ? '👁' : '🙈';
  });

  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn btn-icon';
  copyBtn.title = 'Copy';
  copyBtn.textContent = '⧉';
  copyBtn.addEventListener('click', () => { copyText(value ?? ''); flashCopied(copyBtn); });

  actions.appendChild(revealBtn);
  actions.appendChild(copyBtn);
  wrap.appendChild(dots);
  wrap.appendChild(actions);

  return fieldRow(field.name, wrap);
}

function renderTotpRow(field, secret, disposers) {
  const wrap = document.createElement('span');
  wrap.className = 'secret-value';
  wrap.style.cursor = 'pointer';

  const codeEl = document.createElement('span');
  codeEl.className = 'mono';
  codeEl.style.fontSize = '14px';
  codeEl.style.letterSpacing = '0.1em';
  codeEl.style.color = 'var(--text-strong)';
  codeEl.textContent = '······';

  wrap.appendChild(codeEl);
  wrap.addEventListener('click', (e) => {
    e.stopPropagation();
    copyText((codeEl.dataset.raw || '').trim());
    flashCopied(codeEl);
  });

  let cancelled = false;
  async function tick() {
    if (cancelled) return;
    const result = await totpCode(secret).catch(() => null);
    if (result && !cancelled) {
      codeEl.dataset.raw = result.code;
      codeEl.textContent = result.code.slice(0, 3) + ' ' + result.code.slice(3);
    }
  }
  tick();
  const interval = setInterval(tick, 1000);
  disposers.push(() => { cancelled = true; clearInterval(interval); });

  return fieldRow(field.name, wrap);
}

function renderBackupCodesRow(field, codes, onConsume) {
  const wrap = document.createElement('span');
  wrap.className = 'secret-value';

  const countEl = document.createElement('span');
  countEl.className = 'mono';
  countEl.style.fontSize = '13px';
  countEl.style.color = 'var(--text-muted)';

  function updateCount(list) {
    countEl.textContent = `${list.length} left`;
  }
  updateCount(codes || []);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn btn-icon';
  copyBtn.title = 'Copy next code';
  copyBtn.textContent = '⧉';
  copyBtn.addEventListener('click', async () => {
    const remaining = await onConsume();
    updateCount(remaining);
    flashCopied(copyBtn);
  });

  const actions = document.createElement('span');
  actions.className = 'secret-actions';
  actions.appendChild(copyBtn);

  wrap.appendChild(countEl);
  wrap.appendChild(actions);

  return fieldRow(field.name, wrap);
}

/**
 * Dispatches to the right row renderer for any field, regardless of type —
 * used by the View modal to show every field on an item, not just the
 * truncated top-3 the compact card shows.
 */
function renderFieldRow(field, value, disposers, onConsumeBackupCode) {
  if (field.type === 'secret') {
    if (field.subtype === 'totp') return renderTotpRow(field, value, disposers);
    if (field.subtype === 'backup-codes') return renderBackupCodesRow(field, value, onConsumeBackupCode);
    return renderSecretPasswordRow(field, value);
  }
  return renderTextRow(field, value);
}

/* ── Hero renderers ───────────────────────────────────────────────────────
   The card's FIRST secret field (in schema order) becomes the "featured"
   field and drives the card's whole visual treatment — a TOTP-first card
   reads like an authenticator entry, a backup-codes card leads with how
   many codes are left, a password-first card leads with a big reveal row.
   Every other field on the item still renders as a normal row underneath.
   ────────────────────────────────────────────────────────────────────── */

function renderTotpHero(field, secret, disposers) {
  const block = document.createElement('div');
  block.className = 'totp-block';
  block.style.cursor = 'pointer';
  block.title = 'Click to copy';

  const row = document.createElement('div');
  row.className = 'totp-code-row';

  const codeEl = document.createElement('span');
  codeEl.className = 'totp-code';
  codeEl.textContent = '······';

  const hint = document.createElement('span');
  hint.className = 'totp-copy-hint';
  hint.textContent = field.name;

  row.appendChild(codeEl);
  row.appendChild(hint);
  block.appendChild(row);

  const track = document.createElement('div');
  track.className = 'totp-bar-track';
  const fill = document.createElement('div');
  fill.className = 'totp-bar-fill';
  track.appendChild(fill);
  block.appendChild(track);

  block.addEventListener('click', (e) => {
    e.stopPropagation();
    copyText((codeEl.dataset.raw || '').trim());
    hint.textContent = 'Copied ✓';
    hint.classList.add('flash');
    setTimeout(() => { hint.textContent = field.name; hint.classList.remove('flash'); }, 900);
  });

  let cancelled = false;
  async function tick() {
    if (cancelled) return;
    const result = await totpCode(secret).catch(() => null);
    if (result && !cancelled) {
      codeEl.dataset.raw = result.code;
      codeEl.textContent = result.code.slice(0, 3) + ' ' + result.code.slice(3);
      fill.style.width = ((result.secondsRemaining / result.period) * 100) + '%';
      fill.classList.toggle('low', result.secondsRemaining <= 5);
    }
  }
  tick();
  const interval = setInterval(tick, 1000);
  disposers.push(() => { cancelled = true; clearInterval(interval); });

  return block;
}

function renderBackupHero(field, codes, onConsume) {
  const wrap = document.createElement('div');
  wrap.className = 'backup-hero';

  const countBlock = document.createElement('div');
  countBlock.className = 'backup-hero-count';
  const num = document.createElement('span');
  num.className = 'backup-hero-num';
  const label = document.createElement('span');
  label.className = 'backup-hero-label';
  label.textContent = (codes || []).length === 1 ? 'code left' : 'codes left';
  countBlock.appendChild(num);
  countBlock.appendChild(label);

  function update(list) {
    num.textContent = (list || []).length;
    label.textContent = (list || []).length === 1 ? 'code left' : 'codes left';
  }
  update(codes || []);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn btn-primary btn-sm';
  copyBtn.textContent = 'Copy next code';
  copyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const remaining = await onConsume();
    update(remaining);
    const original = copyBtn.textContent;
    copyBtn.textContent = 'Copied ✓';
    setTimeout(() => { copyBtn.textContent = original; }, 900);
  });

  wrap.appendChild(countBlock);
  wrap.appendChild(copyBtn);
  return wrap;
}

function renderPasswordHero(field, value) {
  const wrap = document.createElement('div');
  wrap.className = 'password-hero';

  const dots = document.createElement('span');
  dots.className = 'password-hero-dots';
  dots.textContent = '••••••••••••';
  dots.dataset.revealed = '0';

  const actions = document.createElement('span');
  actions.className = 'password-hero-actions';

  const revealBtn = document.createElement('button');
  revealBtn.className = 'btn btn-icon btn-ghost';
  revealBtn.title = 'Reveal';
  revealBtn.textContent = '👁';
  revealBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const revealed = dots.dataset.revealed === '1';
    dots.textContent = revealed ? '••••••••••••' : (value ?? '');
    dots.dataset.revealed = revealed ? '0' : '1';
    revealBtn.textContent = revealed ? '👁' : '🙈';
  });

  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn btn-icon btn-ghost';
  copyBtn.title = 'Copy';
  copyBtn.textContent = '⧉';
  copyBtn.addEventListener('click', (e) => { e.stopPropagation(); copyText(value ?? ''); flashCopied(copyBtn); });

  actions.appendChild(revealBtn);
  actions.appendChild(copyBtn);
  wrap.appendChild(dots);
  wrap.appendChild(actions);
  return wrap;
}

const TYPE_BADGE = {
  totp: { cls: 'badge-totp', label: '⏱ TOTP' },
  'backup-codes': { cls: 'badge-secret', label: '🔑 Backup' },
  password: { cls: 'badge-secret', label: '● Password' },
};

function createItemCard(item, category, data, callbacks = {}) {
  const disposers = [];
  const fields = category?.fields || [];
  const featured = fields.find(f => f.type === 'secret') || null;
  const featuredSubtype = featured?.subtype || 'password';

  // The compact card body shows at most 3 fields: non-secret, and not
  // whichever fields are already doing double duty as the title/subtitle
  // in the header above (see pickTitleFields in categories.js). Anything
  // beyond that — including every other secret field — is still on the
  // item, just only visible via the View modal now.
  const { titleField, subtitleField } = pickTitleFields(fields);
  const bodyFields = fields
    .filter(f => f.type !== 'secret' && f !== titleField && f !== subtitleField)
    .slice(0, 3);

  const card = document.createElement('div');
  card.className = 'item-card' + (featured ? ` item-card--${featuredSubtype}` : '');
  card.dataset.itemId = item.id;

  const head = document.createElement('div');
  head.className = 'item-card-head';
  const typeBadge = featured ? TYPE_BADGE[featuredSubtype] || TYPE_BADGE.password : null;
  head.innerHTML = `
    <div class="item-card-headings">
      <div class="item-card-title"></div>
      <div class="item-card-sub"></div>
    </div>
    <span class="item-card-badges">
      ${typeBadge ? `<span class="badge ${typeBadge.cls}">${typeBadge.label}</span>` : ''}
      <span class="badge">${category?.name || ''}</span>
    </span>
  `;
  head.querySelector('.item-card-title').textContent = data.title || 'Untitled';
  head.querySelector('.item-card-sub').textContent = data.subtitle || '';
  card.appendChild(head);

  if (featured) {
    const value = data.fields ? data.fields[featured.id] : undefined;
    if (featuredSubtype === 'totp') {
      card.appendChild(renderTotpHero(featured, value, disposers));
    } else if (featuredSubtype === 'backup-codes') {
      card.appendChild(renderBackupHero(featured, value, () => callbacks.onConsumeBackupCode?.(item, featured, value)));
    } else {
      card.appendChild(renderPasswordHero(featured, value));
    }
  }

  const rows = document.createElement('div');
  rows.className = 'item-card-rows';
  for (const field of bodyFields) {
    const value = data.fields ? data.fields[field.id] : undefined;
    rows.appendChild(renderTextRow(field, value, { truncateValue: true }));
  }
  if (rows.children.length) card.appendChild(rows);

  const footer = document.createElement('div');
  footer.className = 'item-card-footer';

  const viewBtn = document.createElement('button');
  viewBtn.className = 'btn btn-icon btn-ghost item-card-icon-btn';
  viewBtn.title = 'View all fields';
  viewBtn.textContent = '👁';
  viewBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    callbacks.onView?.(item, category, data);
  });

  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn-icon btn-ghost item-card-icon-btn';
  editBtn.title = 'Edit';
  editBtn.textContent = '✎';
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    callbacks.onOpen?.(item);
  });

  footer.appendChild(viewBtn);
  footer.appendChild(editBtn);
  card.appendChild(footer);

  return { card, dispose: () => disposers.forEach(fn => fn()) };
}

export { createItemCard, renderFieldRow, totpCode, base32Decode };

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

function renderTextRow(field, value) {
  const valueEl = document.createElement('span');
  valueEl.className = 'item-card-row-value';
  valueEl.textContent = value ?? '';
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
  wrap.addEventListener('click', () => {
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

function createItemCard(item, category, data, callbacks = {}) {
  const disposers = [];
  const card = document.createElement('div');
  card.className = 'item-card';
  card.dataset.itemId = item.id;

  const head = document.createElement('div');
  head.className = 'item-card-head';
  head.innerHTML = `
    <div>
      <div class="item-card-title"></div>
      <div class="item-card-sub"></div>
    </div>
    <span class="badge">${category?.name || ''}</span>
  `;
  head.querySelector('.item-card-title').textContent = data.title || 'Untitled';
  head.querySelector('.item-card-sub').textContent = data.subtitle || '';
  card.appendChild(head);

  const rows = document.createElement('div');
  rows.className = 'item-card-rows';

  for (const field of category?.fields || []) {
    const value = data.fields ? data.fields[field.id] : undefined;
    if (field.type === 'secret') {
      if (field.subtype === 'totp') {
        rows.appendChild(renderTotpRow(field, value, disposers));
      } else if (field.subtype === 'backup-codes') {
        rows.appendChild(renderBackupCodesRow(field, value, () => callbacks.onConsumeBackupCode?.(item, field, value)));
      } else {
        rows.appendChild(renderSecretPasswordRow(field, value));
      }
    } else {
      rows.appendChild(renderTextRow(field, value));
    }
  }

  card.appendChild(rows);

  card.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    callbacks.onOpen?.(item);
  });

  return { card, dispose: () => disposers.forEach(fn => fn()) };
}

export { createItemCard, totpCode, base32Decode };

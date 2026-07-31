import crypto from 'node:crypto';

const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;

function sign(value) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET not set');
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

function createSessionCookie(userId) {
  const issuedAt = Date.now().toString();
  const payload = `${userId}.${issuedAt}`;
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

function verifySessionCookie(cookieValue) {
  if (!cookieValue) return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 3) return null;
  const [userId, issuedAt, signature] = parts;
  if (!userId || !issuedAt || !signature) return null;

  const expected = sign(`${userId}.${issuedAt}`);
  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  const age = Date.now() - Number(issuedAt);
  if (Number.isNaN(age) || age < 0 || age > SESSION_MAX_AGE_MS) return null;

  return userId;
}

function parseCookies(cookieHeader = '') {
  const out = {};
  cookieHeader.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function getSessionUserId(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return verifySessionCookie(cookies.waystone_session);
}

export { createSessionCookie, verifySessionCookie, parseCookies, getSessionUserId };

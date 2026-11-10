const crypto = require('node:crypto');

const TOKEN_TTL_SECONDS = 12 * 60 * 60;
const TOKEN_ISSUER = 'costalog-central-notas-fiscais';

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ''), 'utf8');
  const b = Buffer.from(String(right ?? ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function getAuthConfig(env = process.env) {
  const username = String(env.ADMIN_USERNAME || '');
  const password = String(env.ADMIN_PASSWORD || '');
  const secret = String(env.ADMIN_AUTH_SECRET || '');
  return {
    username,
    password,
    secret,
    configured: Boolean(username && password && Buffer.byteLength(secret, 'utf8') >= 32)
  };
}

function createAdminToken(username, secret, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: username,
    iss: TOKEN_ISSUER,
    iat: issuedAt,
    exp: issuedAt + TOKEN_TTL_SECONDS
  })).toString('base64url');
  const unsigned = header + '.' + payload;
  const signature = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
  return { token: unsigned + '.' + signature, expiresAt: new Date((issuedAt + TOKEN_TTL_SECONDS) * 1000).toISOString() };
}

function verifyAdminToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || !secret || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, receivedSignature] = parts;
  const unsigned = encodedHeader + '.' + encodedPayload;
  const expectedSignature = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
  if (!safeEqual(receivedSignature, expectedSignature)) return null;

  try {
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    const nowSeconds = Math.floor(now / 1000);
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;
    if (payload.iss !== TOKEN_ISSUER || typeof payload.sub !== 'string' || !payload.sub) return null;
    if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) return null;
    if (payload.iat > nowSeconds + 60 || payload.exp <= nowSeconds || payload.exp <= payload.iat) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = { safeEqual, getAuthConfig, createAdminToken, verifyAdminToken, TOKEN_TTL_SECONDS };

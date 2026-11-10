const test = require('node:test');
const assert = require('node:assert/strict');
const {
  safeEqual,
  getAuthConfig,
  createAdminToken,
  verifyAdminToken,
  TOKEN_TTL_SECONDS
} = require('../src/auth');

const SECRET = 'teste-segredo-com-mais-de-trinta-e-dois-bytes';

test('configuração exige usuário, senha e segredo de pelo menos 32 bytes', () => {
  assert.equal(getAuthConfig({
    ADMIN_USERNAME: 'ADMINISTRATOR',
    ADMIN_PASSWORD: 'senha',
    ADMIN_AUTH_SECRET: SECRET
  }).configured, true);
  assert.equal(getAuthConfig({
    ADMIN_USERNAME: 'ADMINISTRATOR',
    ADMIN_PASSWORD: 'senha',
    ADMIN_AUTH_SECRET: 'curto'
  }).configured, false);
});

test('cria e valida token administrativo dentro da validade', () => {
  const now = Date.UTC(2026, 10, 10, 12, 0, 0);
  const session = createAdminToken('ADMINISTRATOR', SECRET, now);
  const claims = verifyAdminToken(session.token, SECRET, now + 1000);
  assert.equal(claims.sub, 'ADMINISTRATOR');
  assert.equal(claims.exp - claims.iat, TOKEN_TTL_SECONDS);
});

test('rejeita token alterado, segredo incorreto e token expirado', () => {
  const now = Date.UTC(2026, 10, 10, 12, 0, 0);
  const session = createAdminToken('ADMINISTRATOR', SECRET, now);
  assert.equal(verifyAdminToken(session.token + 'x', SECRET, now), null);
  assert.equal(verifyAdminToken(session.token, 'outro-segredo-com-mais-de-trinta-e-dois-bytes', now), null);
  assert.equal(verifyAdminToken(session.token, SECRET, now + (TOKEN_TTL_SECONDS + 1) * 1000), null);
});

test('comparação segura não aceita textos diferentes', () => {
  assert.equal(safeEqual('ADMINISTRATOR', 'ADMINISTRATOR'), true);
  assert.equal(safeEqual('ADMINISTRATOR', 'administrator'), false);
});

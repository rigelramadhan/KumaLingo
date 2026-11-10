import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { verifyGoogle, verifySession } from '../src/auth.ts';
import { createHandler } from '../src/index.ts';
import type { Env, Store } from '../src/types.ts';

const env: Env = { FIREBASE_PROJECT_ID: 'example-project', GOOGLE_WEB_CLIENT_ID: 'test-client', ALLOWED_ORIGIN: 'https://example.invalid', GEMINI_MODEL: 'test-model' };
const nonce = 'n'.repeat(40);
const identity = { uid: 'g_123', email: 'student@example.invalid' };

test('Google JWT requires signature, audience, verified email, nonce and expiry', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: 'test' }] });
  const sign = (overrides = {}) => new SignJWT({ email: 'Student@Example.invalid', email_verified: true, nonce, ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject('123').setIssuer('https://accounts.google.com').setAudience(env.GOOGLE_WEB_CLIENT_ID).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  const valid = await sign();
  assert.deepEqual(await verifyGoogle(valid, nonce, env, keys), identity);
  await assert.rejects(() => verifyGoogle(valid, 'x'.repeat(40), env, keys));
  await assert.rejects(() => verifyGoogle(valid, nonce, { ...env, GOOGLE_WEB_CLIENT_ID: 'wrong' }, keys));
  await assert.rejects(async () => verifyGoogle(await sign({ email_verified: false }), nonce, env, keys));
  await assert.rejects(() => verifyGoogle(`${valid.slice(0, -8)}tampered`, nonce, env, keys));
});

test('Firebase session requires broker claims, correct issuer/audience and custom provider', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: 'test' }] });
  const sign = (overrides = {}) => new SignJWT({ approved_email: identity.email, google_login: true, auth_time: Math.floor(Date.now() / 1000), firebase: { sign_in_provider: 'custom' }, ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(identity.uid).setIssuer(`https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`).setAudience(env.FIREBASE_PROJECT_ID).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  assert.deepEqual(await verifySession(await sign(), env, keys), identity);
  await assert.rejects(async () => verifySession(await sign({ google_login: false }), env, keys));
  await assert.rejects(async () => verifySession(await sign({ firebase: { sign_in_provider: 'google.com' } }), env, keys));
  await assert.rejects(async () => verifySession(await sign({ auth_time: Date.now() }), env, keys));
});

test('whitelist checked before minting and on every subsequent request', async () => {
  let enabled = false;
  let minted = 0;
  let lookups = 0;
  const store = { get: async () => { lookups++; return { enabled }; } } as unknown as Store;
  const handle = createHandler({ store: () => store, google: async () => identity, session: async () => identity, mint: async () => { minted++; return 'synthetic-response'; } });
  const request = (path: string, body?: unknown) => new Request(`https://worker.invalid${path}`, { method: body ? 'POST' : 'GET', headers: { Origin: env.ALLOWED_ORIGIN, 'Content-Type': 'application/json', 'X-KumaLingo-Client': 'web', Authorization: 'Bearer synthetic' }, body: body ? JSON.stringify(body) : undefined });
  assert.equal((await handle(request('/auth/google', { credential: 'synthetic', nonce }), env)).status, 403);
  assert.equal(minted, 0);
  enabled = true;
  assert.equal((await handle(request('/auth/google', { credential: 'synthetic', nonce }), env)).status, 200);
  assert.equal(minted, 1);
  assert.equal((await handle(request('/session'), env)).status, 200);
  enabled = false;
  assert.equal((await handle(request('/session'), env)).status, 403);
  assert.equal(lookups, 4);
});

test('wrong origins, oversized bodies and internal exceptions reveal no private values', async () => {
  const handle = createHandler({ store: () => ({ get: async () => { throw new Error('synthetic-private-provider-detail'); } } as unknown as Store), google: async () => identity });
  assert.equal((await handle(new Request('https://worker.invalid/session'), env)).status, 403);
  const request = (body: string) => new Request('https://worker.invalid/auth/google', { method: 'POST', headers: { Origin: env.ALLOWED_ORIGIN, 'Content-Type': 'application/json', 'X-KumaLingo-Client': 'web' }, body });
  assert.equal((await handle(request('x'.repeat(33000)), env)).status, 413);
  const failed = await handle(request(JSON.stringify({ credential: 'synthetic', nonce })), env);
  assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes('synthetic-private-provider-detail'));
});
test('inherited object properties are never treated as notebook API actions', async () => {
  const handle = createHandler({ store: () => ({ get: async () => ({ enabled: true }) } as unknown as Store), session: async () => identity });
  for (const action of ['constructor', 'toString', '__proto__']) {
    const response = await handle(new Request(`https://worker.invalid/notebook/${action}`, {
      method: 'POST', headers: { Origin: env.ALLOWED_ORIGIN, 'X-KumaLingo-Client': 'web', Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' }, body: '{}',
    }), env);
    assert.equal(response.status, 404);
  }
});

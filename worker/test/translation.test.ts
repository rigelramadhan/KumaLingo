import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCandidates, translate } from '../src/translation.ts';
import { MemoryStore } from './memory-store.ts';
import type { Env } from '../src/types.ts';

const identity = { uid: 'g_one', email: 'student@example.invalid' };
// Deliberately non-credential test strings; no provider requests are made.
const env: Env = { FIREBASE_PROJECT_ID: 'demo-kumalingo', GOOGLE_WEB_CLIENT_ID: 'test', ALLOWED_ORIGIN: 'https://example.invalid', GEMINI_MODEL: 'test-model', GEMINI_API_KEY: 'synthetic-only', AI_PROJECT_DAILY_LIMIT: '2' };
const suggestions = { candidates: [{ hanzi: '是', pinyin: 'shì', translation: 'Adalah', context: 'kata kerja' }, { hanzi: '时', pinyin: 'shí', translation: 'Waktu', context: 'waktu' }] };
function setup() { const store = new MemoryStore(); store.documents.set(`access/${identity.email}`, { enabled: true }); return store; }

test('distinct homophones retain tone marks and deduplicate identical candidates', () => {
  assert.equal(parseCandidates({ candidates: [...suggestions.candidates, suggestions.candidates[0]] }).length, 2);
  assert.throws(() => parseCandidates({ candidates: [{ hanzi: '是', pinyin: 'shi4', translation: 'Adalah' }] }));
});
test('quota is reserved before provider calls, survives requests and prevents excess calls', async () => {
  const store = setup(); let calls = 0;
  const fakeFetch = (async (url: any, options: any) => {
    calls++;
    assert.ok(!String(url).includes(env.GEMINI_API_KEY!));
    assert.equal(options.headers['x-goog-api-key'], env.GEMINI_API_KEY);
    const prompt = JSON.parse(options.body);
    assert.ok(!JSON.stringify(prompt).includes(identity.email));
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(suggestions) }] } }] });
  }) as typeof fetch;
  assert.equal((await translate({ rawPinyin: 'shi' }, identity, store, env, fakeFetch)).candidates.length, 2);
  await translate({ rawPinyin: 'shi' }, identity, store, env, fakeFetch);
  await assert.rejects(() => translate({ rawPinyin: 'shi' }, identity, store, env, fakeFetch));
  assert.equal(calls, 2);
});
test('missing secrets, provider failure and revocation fail closed without saving notes', async () => {
  const store = setup(); let calls = 0;
  const failure = (async () => { calls++; return new Response('synthetic-private-upstream', { status: 500 }); }) as typeof fetch;
  await assert.rejects(() => translate({ rawPinyin: 'shi' }, identity, store, { ...env, GEMINI_API_KEY: undefined }, failure));
  assert.equal(calls, 0);
  await assert.rejects(() => translate({ rawPinyin: 'shi' }, identity, store, env, failure), (error: any) => !error.message.includes('synthetic-private-upstream'));
  store.documents.set(`access/${identity.email}`, { enabled: false });
  await assert.rejects(() => translate({ rawPinyin: 'shi' }, identity, store, env, failure));
  assert.equal(calls, 1);
  assert.equal([...store.documents.keys()].filter((path) => path.includes('/notes/')).length, 0);
});

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

test('runtime waits for complete snapshots and never emits tokens or late data after logout', async () => {
  const events = [];
  const listeners = new Map();
  let authListener;
  let pendingTranslation;
  const auth = { currentUser: null };
  const app = { name: 'kumalingo', options: {} };
  const user = { uid: 'g_one', getIdToken: async () => 'synthetic-session-one' };
  const settings = { firebase: { apiKey: 'synthetic-only', authDomain: 'example.invalid', projectId: 'demo-kumalingo', appId: 'synthetic-id' }, googleClientId: '123-test.apps.googleusercontent.com', apiBaseUrl: 'https://worker.example.invalid' };
  mock.module('firebase/app', { namedExports: { getApps: () => [], getApp: () => app, initializeApp: (options) => { app.options = options; return app; } } });
  mock.module('firebase/auth', { namedExports: {
    getAuth: () => auth,
    onAuthStateChanged: (_, callback) => { authListener = callback; return () => {}; },
    signInWithCustomToken: async () => {},
    signOut: async () => { auth.currentUser = null; authListener(null); },
  } });
  mock.module('firebase/firestore', { namedExports: {
    getFirestore: () => ({}),
    collection: (_, ...parts) => parts.join('/'), doc: (_, ...parts) => parts.join('/'),
    onSnapshot: (path, ...args) => {
      const callback = typeof args[0] === 'function' ? args[0] : args[1];
      listeners.set(path, callback);
      return () => listeners.delete(path);
    },
  } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (url === '/config.json') return Response.json(settings);
    if (String(url).endsWith('/session')) return Response.json({ uid: user.uid, email: 'one@example.invalid' });
    if (String(url).endsWith('/translate')) return new Promise((resolve) => { pendingTranslation = resolve; });
    throw new Error('Unexpected test request.');
  };
  try {
    const runtime = await import('../src/runtime.mjs');
    await runtime.startRuntime((event) => events.push(JSON.parse(event)));
    authListener(null);
    assert.equal(events.at(-1).status, 'signedOut');
    auth.currentUser = user; authListener(user);
    for (let turn = 0; turn < 30 && listeners.size < 4; turn++) await new Promise(setImmediate);
    assert.equal(listeners.size, 4);
    const snapshot = (data, fromCache) => ({ metadata: { fromCache }, docs: data.map((item) => ({ id: item.id, data: () => item })) });
    const folders = [{ id: 'root', title: 'Root', parentId: null, depth: 1, ancestorIds: [], status: 'active', sortKey: 'a0' }];
    const notes = [{ id: 'note', folderId: 'root', hanzi: '你', pinyin: 'nǐ', translation: 'Kamu', sortKey: 'a0' }];
    listeners.get('users/g_one/folders')(snapshot(folders, true));
    listeners.get('users/g_one/notes')(snapshot(notes, false));
    assert.ok(!events.some((event) => event.status === 'ready'));
    listeners.get('users/g_one/folders')(snapshot(folders, false));
    assert.equal(events.at(-1).status, 'ready');
    assert.equal(events.find((event) => event.type === 'snapshot').notebook.notes.length, 1);
    const pending = runtime.dispatchCommand(JSON.stringify({ op: 'translate', rawPinyin: 'shi' }));
    for (let turn = 0; turn < 30 && !pendingTranslation; turn++) await new Promise(setImmediate);
    assert.ok(pendingTranslation);
    auth.currentUser = null; authListener(null);
    const logoutIndex = events.length;
    pendingTranslation(Response.json({ candidates: [{ hanzi: '是', pinyin: 'shì', translation: 'Only user one' }] }));
    await pending;
    assert.ok(!events.slice(logoutIndex).some((event) => event.type === 'candidates' || event.type === 'snapshot'));
    assert.ok(!JSON.stringify(events).includes('synthetic-session-one'));
    assert.equal(listeners.size, 0);
  } finally { globalThis.fetch = originalFetch; }
});

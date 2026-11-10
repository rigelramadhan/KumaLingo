import test from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreStore } from '../../worker/src/firestore.ts';
import { NotebookService } from '../../worker/src/notebook.ts';
import { ApiError } from '../../worker/src/types.ts';

test('real Firestore REST transport persists hierarchy, ordering and resumable deletion', async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!/^(localhost|127\.0\.0\.1):\d+$/.test(host ?? '')) throw new Error('This integration test requires a local demo emulator.');
  // The emulator's special owner token is ONLY used at the guarded loopback URL.
  // Production FirestoreStore always uses real service-account IAM authorization.
  class EmulatorStore extends FirestoreStore {
    async request(suffix, method = 'POST', body, notFound = false) {
      const response = await fetch(`http://${host}/v1/projects/demo-kumalingo/databases/(default)/${suffix}`, {
        method, signal: AbortSignal.timeout(15000), headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (notFound && response.status === 404) { await response.arrayBuffer(); return null; }
      if (!response.ok) {
        const result = await response.json();
        throw new ApiError(response.status, result.error?.status === 'ABORTED' ? 'conflict' : 'unavailable', 'Local emulator request failed.');
      }
      return response.json();
    }
  }
  const store = new EmulatorStore({ FIREBASE_PROJECT_ID: 'demo-kumalingo' });
  const identity = { uid: 'g_rest', email: 'backend@example.invalid' };
  await store.transaction(async (tx) => { tx.set(`access/${identity.email}`, { enabled: true }); });
  const service = new NotebookService(store, identity);
  await service.createFolder({ requestId: 'rest-root', title: 'REST root' });
  await service.createFolder({ requestId: 'rest-child', title: 'Child', parentId: 'rest-root' });
  await service.createFolder({ requestId: 'rest-leaf', title: 'Leaf', parentId: 'rest-child' });
  await assert.rejects(() => service.createFolder({ requestId: 'rest-four', title: 'No fourth level', parentId: 'rest-leaf' }));
  for (const requestId of ['rest-one', 'rest-two']) await service.createNote({ requestId, folderId: 'rest-leaf', hanzi: '你好', pinyin: 'nǐ hǎo', translation: 'Halo' });
  await service.moveNote({ id: 'rest-two', beforeId: 'rest-one', revision: 0 });
  const first = await store.get('users/g_rest/notes/rest-one');
  const moved = await store.get('users/g_rest/notes/rest-two');
  assert.ok(moved.sortKey < first.sortKey);
  await service.editNote({ id: 'rest-one', revision: 0, translation: 'Selamat datang' });
  assert.equal((await store.get('users/g_rest/notes/rest-one')).translation, 'Selamat datang');
  const root = await store.get('users/g_rest/folders/rest-root');
  const operation = await service.deleteFolder({ id: root.id, revision: root.revision });
  let result = operation;
  for (let step = 0; step < 10 && result.status !== 'complete'; step++) result = await service.deletionStep(operation);
  assert.equal(result.status, 'complete');
  assert.equal(await store.get('users/g_rest/folders/rest-root'), null);
  assert.equal(await store.get('users/g_rest/notes/rest-one'), null);
  assert.deepEqual(await store.get('users/g_rest/meta/notebook'), { folders: 0, notes: 0 });
});

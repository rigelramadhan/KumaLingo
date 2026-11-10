import test from 'node:test';
import assert from 'node:assert/strict';
import { NotebookService } from '../src/notebook.ts';
import { MemoryStore } from './memory-store.ts';

function setup() {
  const store = new MemoryStore();
  store.documents.set('access/student@example.invalid', { enabled: true });
  const service = new NotebookService(store, { uid: 'g_123', email: 'student@example.invalid' });
  return { store, service, base: 'users/g_123' };
}
test('hierarchy rejects level four and never accepts caller-derived ancestors', async () => {
  const { store, service, base } = setup();
  await service.createFolder({ requestId: 'one', title: 'One', ancestorIds: ['forged'] });
  await service.createFolder({ requestId: 'two', title: 'Two', parentId: 'one' });
  await service.createFolder({ requestId: 'three', title: 'Three', parentId: 'two' });
  await assert.rejects(() => service.createFolder({ requestId: 'four', title: 'Four', parentId: 'three' }));
  assert.deepEqual((await store.get(`${base}/folders/three`))?.ancestorIds, ['one', 'two']);
  assert.equal(await store.get(`${base}/folders/four`), null);
});
test('create retries are idempotent even after cascade deletion', async () => {
  const { store, service, base } = setup();
  const create = { requestId: 'one', title: 'One' };
  await service.createFolder(create); await service.createFolder(create);
  assert.equal((await store.get(`${base}/meta/notebook`))?.folders, 1);
  const operation = await service.deleteFolder({ id: 'one', revision: 0 });
  await service.deletionStep(operation);
  await service.createFolder(create);
  assert.equal(await store.get(`${base}/folders/one`), null);
  await assert.rejects(() => service.createFolder({ ...create, title: 'Changed' }));
});
test('updates preserve AI translation and reject stale competing revisions', async () => {
  const { store, service, base } = setup();
  await service.createFolder({ requestId: 'root', title: 'Root' });
  await service.createNote({ requestId: 'note', folderId: 'root', hanzi: '你', pinyin: 'nǐ', translation: 'Kamu' });
  const results = await Promise.allSettled([
    service.editNote({ id: 'note', revision: 0, translation: 'Anda' }),
    service.editNote({ id: 'note', revision: 0, translation: 'Engkau' }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const note = await store.get(`${base}/notes/note`);
  assert.equal(note?.aiTranslation, 'Kamu');
  assert.equal(note?.revision, 1);
});
test('notes reorder within one folder and reject cross-user/cross-folder targets', async () => {
  const { store, service, base } = setup();
  for (const name of ['root', 'other']) await service.createFolder({ requestId: name, title: name });
  for (const name of ['a', 'b', 'c']) await service.createNote({ requestId: name, folderId: 'root', hanzi: '你', pinyin: 'nǐ', translation: name });
  await service.createNote({ requestId: 'outside', folderId: 'other', hanzi: '你', pinyin: 'nǐ', translation: 'Other' });
  await service.moveNote({ id: 'c', beforeId: 'a', revision: 0 });
  assert.ok(String((await store.get(`${base}/notes/c`))?.sortKey) < String((await store.get(`${base}/notes/a`))?.sortKey));
  await assert.rejects(() => service.moveNote({ id: 'c', beforeId: 'outside', revision: 1 }));
  const otherUser = new NotebookService(store, { uid: 'g_other', email: 'student@example.invalid' });
  await assert.rejects(() => otherUser.editNote({ id: 'a', revision: 0, translation: 'Stolen' }));
  await assert.rejects(() => service.renameFolder({ id: '../other', revision: 0, title: 'Unsafe' }));
});
test('cascade deletes in bounded resumable steps and rejects new descendant writes', async () => {
  const { store, service, base } = setup();
  await service.createFolder({ requestId: 'root', title: 'Root' });
  await service.createFolder({ requestId: 'child', title: 'Child', parentId: 'root' });
  for (let i = 0; i < 23; i++) await service.createNote({ requestId: `note${i}`, folderId: 'child', hanzi: '你', pinyin: 'nǐ', translation: 'Kamu' });
  const operation = await service.deleteFolder({ id: 'root', revision: 0 });
  await assert.rejects(() => service.createNote({ requestId: 'late', folderId: 'child', hanzi: '你', pinyin: 'nǐ', translation: 'Late' }));
  let progress = await service.deletionStep(operation);
  assert.equal(progress.deleted, 20);
  assert.equal(progress.status, 'pending');
  for (let step = 0; step < 5 && progress.status !== 'complete'; step++) progress = await service.deletionStep(operation);
  assert.equal(progress.status, 'complete');
  assert.equal(progress.deleted, 25);
  assert.deepEqual(await store.get(`${base}/meta/notebook`), { folders: 0, notes: 0 });
  assert.deepEqual(await service.deletionStep(operation), progress);
});
test('revocation is checked inside every write transaction', async () => {
  const { store, service } = setup();
  store.documents.set('access/student@example.invalid', { enabled: false });
  await assert.rejects(() => service.createFolder({ requestId: 'blocked', title: 'Blocked' }));
});

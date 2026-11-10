import { after, before, beforeEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, setLogLevel } from 'firebase/firestore';

let environment;
setLogLevel('silent');
const email = 'student@example.invalid';
const claims = { google_login: true, approved_email: email, firebase: { sign_in_provider: 'custom' } };
before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Rules tests require the local Firestore emulator.');
  environment = await initializeTestEnvironment({ projectId: 'demo-kumalingo', firestore: { rules: await readFile(new URL('../../firebase/firestore.rules', import.meta.url), 'utf8') } });
});
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `access/${email}`), { enabled: true });
    await setDoc(doc(context.firestore(), 'users/g_one/notes/note'), { hanzi: '你', translation: 'Kamu' });
  });
});
after(async () => { await environment?.cleanup(); });

test('invited broker identity reads its own notes but cannot write directly', async () => {
  const db = environment.authenticatedContext('g_one', claims).firestore();
  await assertSucceeds(getDoc(doc(db, 'users/g_one/notes/note')));
  await assertFails(setDoc(doc(db, 'users/g_one/notes/injected'), { hanzi: '伪' }));
});
test('cross-UID, anonymous, and non-broker sessions are denied', async () => {
  await assertFails(getDoc(doc(environment.authenticatedContext('g_other', claims).firestore(), 'users/g_one/notes/note')));
  await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'users/g_one/notes/note')));
  await assertFails(getDoc(doc(environment.authenticatedContext('g_one', { ...claims, google_login: false }).firestore(), 'users/g_one/notes/note')));
  await assertFails(getDoc(doc(environment.authenticatedContext('g_one', { ...claims, firebase: { sign_in_provider: 'google.com' } }).firestore(), 'users/g_one/notes/note')));
});
test('whitelist is private and cannot be modified by a client', async () => {
  const db = environment.authenticatedContext('g_one', claims).firestore();
  await assertSucceeds(getDoc(doc(db, `access/${email}`)));
  await assertFails(getDocs(collection(db, 'access')));
  await assertFails(getDoc(doc(db, 'access/other@example.invalid')));
  await assertFails(setDoc(doc(db, `access/${email}`), { enabled: true }));
});
test('revocation immediately denies reads with an existing authenticated context', async () => {
  const db = environment.authenticatedContext('g_one', claims).firestore();
  await assertSucceeds(getDoc(doc(db, 'users/g_one/notes/note')));
  await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), `access/${email}`), { enabled: false }));
  await assertFails(getDoc(doc(db, 'users/g_one/notes/note')));
});

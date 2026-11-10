import { onAuthStateChanged, signInWithCustomToken, signOut } from 'firebase/auth';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { initializeFirebase } from './firebase.mjs';

let runtime;
let callback = () => {};
let subscriptions = [];
let epoch = 0;
let busy = false;
let operationToken = 0;
let notebook = { folders: [], notes: [] };
let operations = new Map();
let pumpingEpoch = -1;
let googleScript;
let loginOverlay;
const messages = {
  'not-invited': 'This account has not been invited. Try another Google account.',
  'session-expired': 'Please sign in again.',
  'conflict': 'This item changed in another session. Check the latest version and try again.',
  'deleting': 'This chapter is being deleted.',
  'depth-limit': 'Chapters support at most three levels.',
  'quota': 'The free notebook limit has been reached. Please try later.',
  'ai-quota': 'The free suggestion limit has been reached. Try later or enter a note manually.',
  'ai-unavailable': 'Suggestions are unavailable. You can enter a note manually.',
  'ai-timeout': 'Suggestions took too long. Try again or enter a note manually.',
  'translation-failed': 'No reliable suggestions were returned. Try another spelling or enter a note manually.',
  'invalid-input': 'Check the fields and try again.',
};
class ClientError extends Error {
  constructor(code) { super(messages[code] ?? 'The notebook is temporarily unavailable. Please try again.'); this.code = code; }
}
function emit(event) { callback(JSON.stringify(event)); }
function stopListeners() { subscriptions.forEach((dispose) => dispose()); subscriptions = []; }
async function api(path, body, user = runtime?.auth.currentUser) {
  const headers = { 'Content-Type': 'application/json', 'X-KumaLingo-Client': 'web' };
  if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
  const response = await fetch(`${runtime.apiBaseUrl}${path}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(30000) });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new ClientError(result?.error?.code ?? 'unavailable');
  return result;
}
async function block() {
  stopListeners(); operations = new Map(); notebook = { folders: [], notes: [] };
  await signOut(runtime.auth).catch(() => {});
  emit({ type: 'status', status: 'blocked', message: messages['not-invited'] });
}
async function listenerFailure(error, generation) {
  if (generation !== epoch) return;
  if (error?.code === 'permission-denied') await block();
  else emit({ type: 'error', message: 'Connection interrupted. Your last synchronized notes are shown. Reconnect to make changes.' });
}
async function resumeDeletions() {
  const generation = epoch;
  if (pumpingEpoch === generation || !runtime?.auth.currentUser) return;
  pumpingEpoch = generation;
  try {
    for (const operation of [...operations.values()]) {
      let progress = operation;
      while (progress.status !== 'complete' && generation === epoch) {
        progress = await api('/notebook/deletion-step', { operationId: operation.id });
        if (generation !== epoch) return;
      }
    }
  } catch (error) {
    if (generation === epoch) emit({ type: 'error', message: error instanceof ClientError ? error.message : 'Deletion paused. Reconnect and choose Retry to continue.' });
  } finally { if (pumpingEpoch === generation) pumpingEpoch = -1; }
}
async function sessionChanged(user) {
  const generation = ++epoch;
  operationToken++; busy = false; emit({ type: 'busy', busy: false });
  stopListeners(); operations = new Map(); notebook = { folders: [], notes: [] };
  if (!user) { emit({ type: 'status', status: 'signedOut' }); return; }
  emit({ type: 'status', status: 'loading' });
  try {
    const identity = await api('/session', undefined, user);
    if (generation !== epoch) return;
    if (identity.uid !== user.uid || typeof identity.email !== 'string') throw new ClientError('session-expired');
    const loaded = new Set();
    const synchronize = (kind, snapshot) => {
      if (generation !== epoch) return;
      if (snapshot.metadata.fromCache) return;
      notebook = { ...notebook, [kind]: snapshot.docs.map((document) => ({ ...document.data(), id: document.id })) };
      loaded.add(kind);
      if (loaded.size === 2) {
        emit({ type: 'snapshot', notebook });
        emit({ type: 'status', status: 'ready', email: identity.email });
      }
    };
    for (const kind of ['folders', 'notes']) subscriptions.push(onSnapshot(collection(runtime.db, 'users', user.uid, kind), { includeMetadataChanges: true }, (snapshot) => synchronize(kind, snapshot), (error) => listenerFailure(error, generation)));
    subscriptions.push(onSnapshot(doc(runtime.db, 'access', identity.email), (snapshot) => { if (generation === epoch && snapshot.data()?.enabled !== true) void block(); }, (error) => listenerFailure(error, generation)));
    subscriptions.push(onSnapshot(collection(runtime.db, 'users', user.uid, 'operations'), (snapshot) => {
      if (generation !== epoch || snapshot.metadata.fromCache) return;
      operations = new Map(snapshot.docs.filter((entry) => entry.data().status === 'pending').map((entry) => [entry.id, { ...entry.data(), id: entry.id }]));
      emit({ type: 'progress', pendingDeletes: operations.size });
      void resumeDeletions();
    }, (error) => listenerFailure(error, generation)));
  } catch (error) {
    if (generation !== epoch) return;
    if (error instanceof ClientError && error.code === 'not-invited') await block();
    else { await signOut(runtime.auth).catch(() => {}); emit({ type: 'error', message: error instanceof ClientError ? error.message : 'Sign-in is temporarily unavailable. Please try again.' }); }
  }
}

export async function startRuntime(onEvent) {
  callback = onEvent;
  try {
    const response = await fetch('/config.json', { cache: 'no-store' });
    if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json')) throw new Error();
    const config = await response.json();
    const base = new URL(config.apiBaseUrl);
    if (base.username || base.password || base.search || base.hash || base.pathname !== '/' || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname)))) throw new Error();
    if (typeof config.googleClientId !== 'string' || !config.googleClientId.endsWith('.apps.googleusercontent.com')) throw new Error();
    const firebase = initializeFirebase(config.firebase);
    runtime = { ...firebase, apiBaseUrl: base.origin, googleClientId: config.googleClientId };
    onAuthStateChanged(runtime.auth, (user) => { void sessionChanged(user); });
  } catch { emit({ type: 'status', status: 'unconfigured' }); }
}

async function googleLogin() {
  if (!runtime || typeof document === 'undefined') throw new ClientError('unavailable');
  if (!googleScript) googleScript = new Promise((resolve, reject) => {
    if (globalThis.google?.accounts?.id) { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    script.onload = resolve; script.onerror = () => { googleScript = undefined; reject(new ClientError('unavailable')); };
    document.head.append(script);
  });
  await googleScript;
  loginOverlay?.remove();
  const nonce = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  return new Promise((resolve, reject) => {
    const overlay = document.createElement('dialog');
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', 'Sign in with Google');
    Object.assign(overlay.style, { position: 'fixed', inset: '0', width: '100vw', maxWidth: 'none', height: '100vh', maxHeight: 'none', border: '0', margin: '0', zIndex: '10000', background: '#faf8f5', display: 'flex', flexDirection: 'column', gap: '24px', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' });
    const title = document.createElement('h2'); title.textContent = 'Your private Mandarin notebook';
    const target = document.createElement('div');
    const cancel = document.createElement('button'); cancel.textContent = 'Cancel';
    cancel.onclick = () => { overlay.remove(); resolve(); };
    overlay.addEventListener('cancel', (event) => { event.preventDefault(); overlay.remove(); resolve(); });
    overlay.append(title, target, cancel); document.body.append(overlay); loginOverlay = overlay;
    overlay.showModal();
    globalThis.google.accounts.id.initialize({ client_id: runtime.googleClientId, nonce, auto_select: false, callback: async ({ credential }) => {
      try {
        const result = await api('/auth/google', { credential, nonce }, null);
        if (typeof result.customToken !== 'string') throw new ClientError('unavailable');
        await signInWithCustomToken(runtime.auth, result.customToken);
        overlay.remove(); resolve();
      } catch (error) { overlay.remove(); reject(error); }
    } });
    globalThis.google.accounts.id.renderButton(target, { theme: 'outline', size: 'large', text: 'continue_with', width: 280 });
    cancel.focus();
  });
}

const mutations = new Set(['create-folder', 'rename-folder', 'delete-folder', 'create-note', 'edit-note', 'delete-note', 'move-note']);
export async function dispatchCommand(commandJson) {
  if (busy) return;
  const token = ++operationToken;
  const generation = epoch;
  busy = true; emit({ type: 'busy', busy: true });
  try {
    const command = JSON.parse(commandJson);
    if (command.op === 'sign-in') await googleLogin();
    else if (command.op === 'sign-out') { globalThis.google?.accounts?.id?.disableAutoSelect(); await signOut(runtime.auth); }
    else if (command.op === 'retry-deletions') await resumeDeletions();
    else if (command.op === 'translate') { emit({ type: 'candidates', candidates: [] }); const result = await api('/translate', command); if (generation === epoch) emit({ type: 'candidates', candidates: result.candidates }); }
    else if (command.op === 'export-json' || command.op === 'export-pdf') {
      const snapshot = notebook;
      const exports = await import('./exports.mjs');
      if (generation !== epoch) return;
      if (command.op === 'export-json') exports.downloadNotebookBackup(snapshot);
      else await exports.downloadNotebookPdf(snapshot, () => generation === epoch);
    } else if (mutations.has(command.op)) {
      await api(`/notebook/${command.op}`, command);
      if (generation === epoch) emit({ type: 'saved' });
    } else throw new ClientError('invalid-input');
  } catch (error) {
    if (generation !== epoch) return;
    if (error instanceof ClientError && ['not-invited', 'session-expired'].includes(error.code)) {
      if (error.code === 'not-invited') await block(); else await signOut(runtime.auth);
    }
    emit({ type: 'error', message: error instanceof ClientError ? error.message : 'That action could not be completed. Please try again.' });
  } finally { if (operationToken === token) { busy = false; emit({ type: 'busy', busy: false }); } }
}

import { checkAccess, mintCustomToken, verifyGoogle, verifySession } from './auth.ts';
import { FirestoreStore } from './firestore.ts';
import { ApiError } from './types.ts';
import type { Env, Identity, Store } from './types.ts';
import { NotebookService } from './notebook.ts';
import { translate } from './translation.ts';

export interface Dependencies {
  store?: (env: Env) => Store;
  google?: (credential: unknown, nonce: unknown, env: Env) => Promise<Identity>;
  session?: (token: string, env: Env) => Promise<Identity>;
  mint?: (identity: Identity, env: Env) => Promise<string>;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new ApiError(415, 'invalid-input', 'Send JSON data.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'invalid-input', 'Missing request data.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 32768) { await reader.cancel(); throw new ApiError(413, 'too-large', 'The request is too large.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new ApiError(400, 'invalid-input', 'Invalid request data.'); }
}

export function createHandler(dependencies: Dependencies = {}) {
  return async (request: Request, env: Env): Promise<Response> => {
    const origin = request.headers.get('Origin');
    const allowed = origin !== null && origin === env.ALLOWED_ORIGIN && origin !== 'null';
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
    if (allowed) headers['Access-Control-Allow-Origin'] = origin;
    const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
    try {
      if (!allowed) throw new ApiError(403, 'origin-denied', 'This request is not allowed.');
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-KumaLingo-Client', 'Access-Control-Max-Age': '600' } });
      }
      const path = new URL(request.url).pathname;
      if (request.method === 'GET' && path === '/health') return respond({ ok: true });
      if (request.headers.get('X-KumaLingo-Client') !== 'web') throw new ApiError(403, 'invalid-client', 'This request is not allowed.');
      const store = (dependencies.store ?? ((env) => new FirestoreStore(env)))(env);
      if (request.method === 'POST' && path === '/auth/google') {
        const body = await readBody(request);
        const identity = await (dependencies.google ?? verifyGoogle)(body.credential, body.nonce, env);
        await checkAccess(store, identity.email);
        const token = await (dependencies.mint ?? mintCustomToken)(identity, env);
        return respond({ customToken: token });
      }
      const authorization = request.headers.get('Authorization') ?? '';
      if (!authorization.startsWith('Bearer ') || authorization.length > 17000) throw new ApiError(401, 'session-expired', 'Please sign in again.');
      const identity = await (dependencies.session ?? verifySession)(authorization.slice(7), env);
      await checkAccess(store, identity.email);
      if (request.method === 'GET' && path === '/session') return respond({ uid: identity.uid, email: identity.email });
      if (request.method === 'POST' && path === '/translate') return respond(await translate(await readBody(request), identity, store, env));
      if (request.method === 'POST' && path.startsWith('/notebook/')) {
        const service = new NotebookService(store, identity);
        const actions: Record<string, (body: Record<string, unknown>) => Promise<unknown>> = {
          'create-folder': (body) => service.createFolder(body),
          'rename-folder': (body) => service.renameFolder(body),
          'delete-folder': (body) => service.deleteFolder(body),
          'deletion-step': (body) => service.deletionStep(body),
          'create-note': (body) => service.createNote(body),
          'edit-note': (body) => service.editNote(body),
          'delete-note': (body) => service.deleteNote(body),
          'move-note': (body) => service.moveNote(body),
        };
        const action = actions[path.slice('/notebook/'.length)];
        if (action) return respond(await action(await readBody(request)));
      }
      throw new ApiError(404, 'not-found', 'This action could not be found.');
    } catch (error) {
      if (error instanceof ApiError) return respond({ error: { code: error.code, message: error.message } }, error.status);
      // Never log/return raw provider exceptions, credentials or request bodies.
      return respond({ error: { code: 'unavailable', message: 'The notebook is temporarily unavailable.' } }, 503);
    }
  };
}
export default { fetch: createHandler() };

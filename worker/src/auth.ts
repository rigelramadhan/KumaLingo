import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import { ApiError } from './types.ts';
import type { Env, Identity, Store } from './types.ts';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const firebaseKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
type SigningKey = Awaited<ReturnType<typeof importPKCS8>>;
type ServiceIdentity = { email: string; key: SigningKey };
const serviceCache = new WeakMap<object, Promise<ServiceIdentity>>();

export function serviceIdentity(env: Env): Promise<ServiceIdentity> {
  const cached = serviceCache.get(env);
  if (cached) return cached;
  const promise = (async () => {
    try {
      const service = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
      if (service.project_id !== env.FIREBASE_PROJECT_ID || typeof service.client_email !== 'string' || typeof service.private_key !== 'string') throw new Error();
      return { email: service.client_email, key: await importPKCS8(service.private_key, 'RS256') };
    } catch { throw new ApiError(503, 'not-configured', 'Sign-in is temporarily unavailable.'); }
  })();
  serviceCache.set(env, promise);
  return promise;
}

export async function checkAccess(store: Store, email: string): Promise<void> {
  if (!email || email !== email.trim().toLowerCase() || email.includes('/') || email.length > 254) throw new ApiError(403, 'not-invited', 'This account has not been invited.');
  const access = await store.get(`access/${email}`);
  if (access?.enabled !== true) throw new ApiError(403, 'not-invited', 'This account has not been invited.');
}

export async function verifyGoogle(credential: unknown, nonce: unknown, env: Env, keys: JWTVerifyGetKey = googleKeys): Promise<Identity> {
  if (typeof credential !== 'string' || credential.length > 16000 || typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(nonce)) {
    throw new ApiError(401, 'invalid-login', 'Google sign-in could not be verified.');
  }
  try {
    const { payload } = await jwtVerify(credential, keys, { algorithms: ['RS256'], audience: env.GOOGLE_WEB_CLIENT_ID, issuer: ['https://accounts.google.com', 'accounts.google.com'], maxTokenAge: '2h', requiredClaims: ['sub', 'exp', 'iat', 'email', 'email_verified', 'nonce'] });
    if (payload.email_verified !== true || payload.nonce !== nonce || typeof payload.email !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(payload.sub ?? '')) throw new Error();
    return { uid: `g_${payload.sub}`, email: payload.email.trim().toLowerCase() };
  } catch { throw new ApiError(401, 'invalid-login', 'Google sign-in could not be verified.'); }
}

export async function verifySession(token: string, env: Env, keys: JWTVerifyGetKey = firebaseKeys): Promise<Identity> {
  try {
    const { payload } = await jwtVerify(token, keys, { algorithms: ['RS256'], audience: env.FIREBASE_PROJECT_ID, issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`, maxTokenAge: '2h', requiredClaims: ['sub', 'exp', 'iat', 'auth_time'] });
    const provider = payload.firebase as { sign_in_provider?: unknown } | undefined;
    if (provider?.sign_in_provider !== 'custom' || payload.google_login !== true || typeof payload.approved_email !== 'string' || !/^g_[A-Za-z0-9_-]{1,100}$/.test(payload.sub ?? '') || typeof payload.auth_time !== 'number' || payload.auth_time > Date.now() / 1000 + 30) throw new Error();
    return { uid: payload.sub!, email: payload.approved_email };
  } catch { throw new ApiError(401, 'session-expired', 'Please sign in again.'); }
}

export async function mintCustomToken(identity: Identity, env: Env): Promise<string> {
  const service = await serviceIdentity(env);
  return new SignJWT({ uid: identity.uid, claims: { google_login: true, approved_email: identity.email } })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).setIssuer(service.email).setSubject(service.email)
    .setAudience('https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit')
    .setIssuedAt().setExpirationTime('5m').sign(service.key);
}

const oauthCache = new WeakMap<object, { token: string; expires: number }>();
export async function serviceAccessToken(env: Env): Promise<string> {
  const cached = oauthCache.get(env);
  if (cached && cached.expires > Date.now() + 60000) return cached.token;
  const service = await serviceIdentity(env);
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/datastore' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' }).setIssuer(service.email)
    .setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('1h').sign(service.key);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!response.ok) throw new ApiError(503, 'unavailable', 'The notebook is temporarily unavailable.');
  const result = await response.json() as { access_token?: unknown; expires_in?: unknown };
  if (typeof result.access_token !== 'string') throw new ApiError(503, 'unavailable', 'The notebook is temporarily unavailable.');
  oauthCache.set(env, { token: result.access_token, expires: Date.now() + Number(result.expires_in ?? 3600) * 1000 });
  return result.access_token;
}

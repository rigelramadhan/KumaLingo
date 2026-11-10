import { serviceAccessToken } from './auth.ts';
import { ApiError } from './types.ts';
import type { Document, Env, Query, Store, Transaction } from './types.ts';

type Value = { nullValue?: null; stringValue?: string; booleanValue?: boolean; integerValue?: string; doubleValue?: number; arrayValue?: { values?: Value[] }; mapValue?: { fields?: Record<string, Value> }; timestampValue?: string };
function encode(value: unknown): Value {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  if (typeof value === 'object') return { mapValue: { fields: fields(value as Document) } };
  throw new ApiError(400, 'invalid-input', 'Unsupported notebook value.');
}
function fields(data: Document): Record<string, Value> { return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)])); }
function decode(value: Value): unknown {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue?.values ?? []).map(decode);
  if ('mapValue' in value) return unpack(value.mapValue?.fields ?? {});
  return null;
}
function unpack(data: Record<string, Value>): Document { return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, decode(value)])); }

export class FirestoreStore implements Store {
  env: Env;
  database: string;
  constructor(env: Env) {
    this.env = env;
    if (!/^[a-z][a-z0-9-]{4,62}$/.test(env.FIREBASE_PROJECT_ID)) throw new ApiError(503, 'not-configured', 'The notebook is temporarily unavailable.');
    this.database = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)`;
  }
  async request(suffix: string, method = 'POST', body?: unknown, notFound = false): Promise<any> {
    const response = await fetch(`${this.database}/${suffix}`, { method, headers: { Authorization: `Bearer ${await serviceAccessToken(this.env)}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (notFound && response.status === 404) { await response.arrayBuffer(); return null; }
    if (!response.ok) {
      // Never return upstream bodies (which may include project/private request data).
      const details = await response.json().catch(() => null) as { error?: { status?: string } } | null;
      if (details?.error?.status === 'ABORTED') throw new ApiError(409, 'conflict', 'The notebook changed. Please try again.');
      if (response.status === 429) throw new ApiError(429, 'quota', 'The free notebook limit has been reached. Please try later.');
      throw new ApiError(503, 'unavailable', 'The notebook is temporarily unavailable.');
    }
    return response.json();
  }
  async get(path: string): Promise<Document | null> {
    const result = await this.request(`documents/${path.split('/').map(encodeURIComponent).join('/')}`, 'GET', undefined, true);
    return result ? unpack(result.fields ?? {}) : null;
  }
  async transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { transaction } = await this.request('documents:beginTransaction', 'POST', { options: { readWrite: {} } });
      const writes: unknown[] = [];
      const tx: Transaction = {
        get: async (path) => {
          const name = `${this.database.replace('https://firestore.googleapis.com/v1/', '')}/documents/${path}`;
          // batchGet keeps transaction bytes in JSON (also supported by the emulator).
          const result = await this.request('documents:batchGet', 'POST', { documents: [name], transaction });
          const found = result.find((item: any) => item.found)?.found;
          return found ? unpack(found.fields ?? {}) : null;
        },
        query: async (query: Query) => {
          const parts = query.collection.split('/');
          const collectionId = parts.pop()!;
          const parent = parts.length ? `documents/${parts.map(encodeURIComponent).join('/')}` : 'documents';
          const filters = (query.filters ?? []).map((filter) => ({ fieldFilter: { field: { fieldPath: filter.field }, op: filter.op, value: encode(filter.value) } }));
          const structuredQuery = { from: [{ collectionId }], ...(filters.length ? { where: filters.length === 1 ? filters[0] : { compositeFilter: { op: 'AND', filters } } } : {}), ...(query.orderBy ? { orderBy: [{ field: { fieldPath: query.orderBy.field }, direction: query.orderBy.descending ? 'DESCENDING' : 'ASCENDING' }] } : {}), limit: Math.min(query.limit ?? 20, 20) };
          const result = await this.request(`${parent}:runQuery`, 'POST', { structuredQuery, transaction });
          return result.filter((item: any) => item.document).map((item: any) => unpack(item.document.fields ?? {}));
        },
        set: (path, data) => writes.push({ update: { name: `${this.database.replace('https://firestore.googleapis.com/v1/', '')}/documents/${path}`, fields: fields(data) } }),
        delete: (path) => writes.push({ delete: `${this.database.replace('https://firestore.googleapis.com/v1/', '')}/documents/${path}` }),
      };
      try {
        const result = await callback(tx);
        await this.request('documents:commit', 'POST', { transaction, writes });
        return result;
      } catch (error) {
        await this.request('documents:rollback', 'POST', { transaction }).catch(() => {});
        if (error instanceof ApiError && error.code === 'conflict' && attempt < 2) continue;
        throw error;
      }
    }
    throw new ApiError(409, 'conflict', 'The notebook changed. Please try again.');
  }
}

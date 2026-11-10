export interface Env {
  FIREBASE_PROJECT_ID: string;
  GOOGLE_WEB_CLIENT_ID: string;
  ALLOWED_ORIGIN: string;
  GEMINI_MODEL: string;
  GEMINI_API_KEY?: string;
  FIREBASE_SERVICE_ACCOUNT_JSON?: string;
  AI_PROJECT_DAILY_LIMIT?: string;
}
export interface Identity { uid: string; email: string }
export type Document = Record<string, unknown>;
export interface Filter { field: string; op: 'EQUAL' | 'ARRAY_CONTAINS' | 'LESS_THAN'; value: unknown }
export interface Query { collection: string; filters?: Filter[]; orderBy?: { field: string; descending?: boolean }; limit?: number }
export interface Transaction {
  get(path: string): Promise<Document | null>;
  query(query: Query): Promise<Document[]>;
  set(path: string, data: Document): void;
  delete(path: string): void;
}
export interface Store {
  get(path: string): Promise<Document | null>;
  transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T>;
}
export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
export function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new ApiError(400, 'invalid-input', 'Invalid identifier.');
  return value;
}
export function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ApiError(400, 'invalid-input', `Enter text between 1 and ${max} characters.`);
  return value.trim();
}

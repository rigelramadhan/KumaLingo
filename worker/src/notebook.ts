import { generateKeyBetween } from 'fractional-indexing';
import { ApiError, id, text } from './types.ts';
import type { Document, Identity, Store, Transaction } from './types.ts';

export class NotebookService {
  store: Store;
  identity: Identity;
  base: string;
  constructor(store: Store, identity: Identity) { this.store = store; this.identity = identity; this.base = `users/${id(identity.uid)}`; }
  async mutate<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.store.transaction(async (tx) => {
      // Reading access inside the write transaction closes the revocation race.
      if ((await tx.get(`access/${this.identity.email}`))?.enabled !== true) throw new ApiError(403, 'not-invited', 'This account has not been invited.');
      return fn(tx);
    });
  }
  async folder(tx: Transaction, folderId: unknown, allowDeleting = false): Promise<Document> {
    const folder = await tx.get(`${this.base}/folders/${id(folderId)}`);
    if (!folder) throw new ApiError(404, 'not-found', 'This chapter no longer exists.');
    for (const ancestorId of [...folder.ancestorIds as string[], folder.id as string]) {
      const ancestor = ancestorId === folder.id ? folder : await tx.get(`${this.base}/folders/${id(ancestorId)}`);
      if (!ancestor || (!allowDeleting && ancestor.status !== 'active')) throw new ApiError(409, 'deleting', 'This chapter is being deleted.');
    }
    return folder;
  }
  revision(document: Document, expected: unknown): void {
    if (!Number.isSafeInteger(expected) || expected !== document.revision) throw new ApiError(409, 'conflict', 'This item changed in another session. Refresh and try again.');
  }
  async receipt(tx: Transaction, requestId: string, kind: string, input: string): Promise<boolean> {
    const previous = await tx.get(`${this.base}/requests/${requestId}`);
    if (!previous) return false;
    if (previous.kind !== kind || previous.input !== input) throw new ApiError(409, 'conflict', 'This request identifier was already used.');
    return true;
  }
  async createFolder(body: Document): Promise<Document> {
    const folderId = id(body.requestId);
    const title = text(body.title, 120);
    const parentId = body.parentId === null || body.parentId === undefined ? null : id(body.parentId);
    const input = JSON.stringify([title, parentId]);
    return this.mutate(async (tx) => {
      if (await this.receipt(tx, folderId, 'folder', input)) return { id: folderId };
      const parent = parentId ? await this.folder(tx, parentId) : null;
      if (Number(parent?.depth ?? 0) >= 3) throw new ApiError(400, 'depth-limit', 'Chapters support at most three levels.');
      const meta = await tx.get(`${this.base}/meta/notebook`) ?? { folders: 0, notes: 0 };
      if (Number(meta.folders) >= 500) throw new ApiError(429, 'quota', 'The chapter limit has been reached.');
      const last = (await tx.query({ collection: `${this.base}/folders`, filters: [{ field: 'parentId', op: 'EQUAL', value: parentId }], orderBy: { field: 'sortKey', descending: true }, limit: 1 }))[0];
      const now = new Date().toISOString();
      tx.set(`${this.base}/folders/${folderId}`, { id: folderId, title, parentId, depth: Number(parent?.depth ?? 0) + 1, ancestorIds: parent ? [...parent.ancestorIds as string[], parent.id] : [], status: 'active', sortKey: generateKeyBetween(last?.sortKey as string ?? null, null), revision: 0, createdAt: now, updatedAt: now });
      tx.set(`${this.base}/meta/notebook`, { ...meta, folders: Number(meta.folders) + 1 });
      tx.set(`${this.base}/requests/${folderId}`, { kind: 'folder', input });
      return { id: folderId };
    });
  }
  async renameFolder(body: Document): Promise<Document> {
    const title = text(body.title, 120);
    return this.mutate(async (tx) => {
      const folder = await this.folder(tx, body.id);
      this.revision(folder, body.revision);
      tx.set(`${this.base}/folders/${folder.id}`, { ...folder, title, revision: Number(folder.revision) + 1, updatedAt: new Date().toISOString() });
      return { id: folder.id };
    });
  }
  async createNote(body: Document): Promise<Document> {
    const noteId = id(body.requestId);
    const folderId = id(body.folderId);
    const values = { hanzi: text(body.hanzi, 200), pinyin: text(body.pinyin, 500), translation: text(body.translation, 2000), rawPinyin: text(body.rawPinyin ?? body.pinyin, 500), aiTranslation: text(body.aiTranslation ?? body.translation, 2000) };
    const input = JSON.stringify([folderId, values]);
    return this.mutate(async (tx) => {
      if (await this.receipt(tx, noteId, 'note', input)) return { id: noteId };
      const folder = await this.folder(tx, folderId);
      const meta = await tx.get(`${this.base}/meta/notebook`) ?? { folders: 0, notes: 0 };
      if (Number(meta.notes) >= 5000) throw new ApiError(429, 'quota', 'The notebook limit has been reached.');
      const last = (await tx.query({ collection: `${this.base}/notes`, filters: [{ field: 'folderId', op: 'EQUAL', value: folderId }], orderBy: { field: 'sortKey', descending: true }, limit: 1 }))[0];
      const now = new Date().toISOString();
      tx.set(`${this.base}/notes/${noteId}`, { id: noteId, folderId, ...values, ancestorIds: [...folder.ancestorIds as string[], folderId], sortKey: generateKeyBetween(last?.sortKey as string ?? null, null), revision: 0, createdAt: now, updatedAt: now });
      tx.set(`${this.base}/meta/notebook`, { ...meta, notes: Number(meta.notes) + 1 });
      tx.set(`${this.base}/requests/${noteId}`, { kind: 'note', input });
      return { id: noteId };
    });
  }
  async note(tx: Transaction, noteId: unknown): Promise<Document> {
    const note = await tx.get(`${this.base}/notes/${id(noteId)}`);
    if (!note) throw new ApiError(404, 'not-found', 'This note no longer exists.');
    await this.folder(tx, note.folderId);
    return note;
  }
  async editNote(body: Document): Promise<Document> {
    const translation = text(body.translation, 2000);
    return this.mutate(async (tx) => {
      const note = await this.note(tx, body.id);
      this.revision(note, body.revision);
      tx.set(`${this.base}/notes/${note.id}`, { ...note, translation, revision: Number(note.revision) + 1, updatedAt: new Date().toISOString() });
      return { id: note.id };
    });
  }
  async deleteNote(body: Document): Promise<Document> {
    return this.mutate(async (tx) => {
      const note = await this.note(tx, body.id);
      this.revision(note, body.revision);
      const meta = await tx.get(`${this.base}/meta/notebook`) ?? { notes: 0, folders: 0 };
      tx.delete(`${this.base}/notes/${note.id}`);
      tx.set(`${this.base}/meta/notebook`, { ...meta, notes: Math.max(0, Number(meta.notes) - 1) });
      return { id: note.id };
    });
  }
  async moveNote(body: Document): Promise<Document> {
    const beforeId = body.beforeId ? id(body.beforeId) : null;
    return this.mutate(async (tx) => {
      const note = await this.note(tx, body.id);
      this.revision(note, body.revision);
      const folder = await this.folder(tx, note.folderId);
      if (beforeId === note.id) return { id: note.id };
      const before = beforeId ? await this.note(tx, beforeId) : null;
      if (before && before.folderId !== note.folderId) throw new ApiError(400, 'invalid-input', 'Move notes within the same chapter.');
      const previous = (await tx.query({ collection: `${this.base}/notes`, filters: [{ field: 'folderId', op: 'EQUAL', value: note.folderId }, ...(before ? [{ field: 'sortKey', op: 'LESS_THAN' as const, value: before.sortKey }] : [])], orderBy: { field: 'sortKey', descending: true }, limit: 2 })).find((candidate) => candidate.id !== note.id);
      tx.set(`${this.base}/notes/${note.id}`, { ...note, sortKey: generateKeyBetween(previous?.sortKey as string ?? null, before?.sortKey as string ?? null), revision: Number(note.revision) + 1, updatedAt: new Date().toISOString() });
      tx.set(`${this.base}/folders/${folder.id}`, { ...folder, revision: Number(folder.revision) + 1 });
      return { id: note.id };
    });
  }
  async deleteFolder(body: Document): Promise<Document> {
    const folderId = id(body.id);
    const operationId = folderId;
    return this.mutate(async (tx) => {
      const previous = await tx.get(`${this.base}/operations/${operationId}`);
      if (previous) return { operationId, status: previous.status };
      const folder = await this.folder(tx, folderId);
      this.revision(folder, body.revision);
      tx.set(`${this.base}/folders/${folderId}`, { ...folder, status: 'deleting', revision: Number(folder.revision) + 1 });
      tx.set(`${this.base}/operations/${operationId}`, { id: operationId, rootId: folderId, status: 'pending', deleted: 0 });
      return { operationId, status: 'pending' };
    });
  }
  async deletionStep(body: Document): Promise<Document> {
    const operationId = id(body.operationId);
    return this.mutate(async (tx) => {
      const operation = await tx.get(`${this.base}/operations/${operationId}`);
      if (!operation) throw new ApiError(404, 'not-found', 'This deletion no longer exists.');
      if (operation.status === 'complete') return operation;
      const rootId = id(operation.rootId);
      const root = await tx.get(`${this.base}/folders/${rootId}`);
      if (root && root.status !== 'deleting') throw new ApiError(409, 'conflict', 'This deletion cannot continue.');
      const meta = await tx.get(`${this.base}/meta/notebook`) ?? { notes: 0, folders: 0 };
      const notes = await tx.query({ collection: `${this.base}/notes`, filters: [{ field: 'ancestorIds', op: 'ARRAY_CONTAINS', value: rootId }], limit: 20 });
      let count = 0;
      let complete = false;
      if (notes.length) {
        for (const note of notes) tx.delete(`${this.base}/notes/${id(note.id)}`);
        count = notes.length;
        meta.notes = Math.max(0, Number(meta.notes) - count);
      } else {
        const folders = await tx.query({ collection: `${this.base}/folders`, filters: [{ field: 'ancestorIds', op: 'ARRAY_CONTAINS', value: rootId }], orderBy: { field: 'depth', descending: true }, limit: 20 });
        for (const folder of folders) tx.delete(`${this.base}/folders/${id(folder.id)}`);
        count = folders.length;
        if (!folders.length) { if (root) { tx.delete(`${this.base}/folders/${rootId}`); count = 1; } complete = true; }
        meta.folders = Math.max(0, Number(meta.folders) - count);
      }
      const updated = { ...operation, status: complete ? 'complete' : 'pending', deleted: Number(operation.deleted) + count };
      tx.set(`${this.base}/operations/${operationId}`, updated);
      tx.set(`${this.base}/meta/notebook`, meta);
      return updated;
    });
  }
}

import type { Document, Query, Store, Transaction } from '../src/types.ts';

export class MemoryStore implements Store {
  documents = new Map<string, Document>();
  pending = Promise.resolve();
  async get(path: string): Promise<Document | null> { return structuredClone(this.documents.get(path) ?? null); }
  async transaction<T>(callback: (tx: Transaction) => Promise<T>): Promise<T> {
    let unlock!: () => void;
    const previous = this.pending;
    this.pending = new Promise((resolve) => { unlock = resolve; });
    await previous;
    const snapshot = structuredClone(this.documents);
    const tx: Transaction = {
      get: async (path) => structuredClone(snapshot.get(path) ?? null),
      set: (path, value) => { snapshot.set(path, structuredClone(value)); },
      delete: (path) => { snapshot.delete(path); },
      query: async (query: Query) => {
        let values = [...snapshot.entries()].filter(([path]) => path.startsWith(`${query.collection}/`) && path.split('/').length === query.collection.split('/').length + 1).map(([, value]) => value);
        for (const filter of query.filters ?? []) values = values.filter((value) => filter.op === 'ARRAY_CONTAINS' ? (value[filter.field] as unknown[]).includes(filter.value) : filter.op === 'LESS_THAN' ? (value[filter.field] as any) < filter.value! : value[filter.field] === filter.value);
        if (query.orderBy) { const order = query.orderBy; values.sort((a, b) => { const left = a[order.field] as any; const right = b[order.field] as any; return (left < right ? -1 : left > right ? 1 : 0) * (order.descending ? -1 : 1); }); }
        return structuredClone(values.slice(0, query.limit ?? 20));
      },
    };
    try { const result = await callback(tx); this.documents = snapshot; return result; } finally { unlock(); }
  }
}

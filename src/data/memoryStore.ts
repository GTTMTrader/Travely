import { SERVER_TIME, type Data, type Doc, type DocStore, type Op, type SnapMeta, type Tx, type Unsub } from './store';

/**
 * 메모리 저장소 (미리보기·화면 테스트용). 경로 → 데이터 맵 + 변경 알림.
 * 쓰기는 비동기로 반영해 실제 서버와 비슷한 흐름(저장 중 → 완료)을 만든다.
 */
const clone = <T,>(v: T): T => (v instanceof Uint8Array ? (new Uint8Array(v) as unknown as T) : structuredClone(v));

function resolveTime(d: Data): Data {
  const out: Data = {};
  for (const [k, v] of Object.entries(d)) out[k] = v === SERVER_TIME ? Date.now() : v;
  return out;
}

const parent = (path: string) => path.split('/').slice(0, -1).join('/');
const idOf = (path: string) => path.split('/').pop()!;

export function createMemoryStore(opts: { latencyMs?: number } = {}): DocStore & { dump(): Map<string, Data> } {
  const docs = new Map<string, Data>();
  const listeners = new Set<() => void>();
  const latency = opts.latencyMs ?? 120;
  const meta: SnapMeta = { fromCache: false, pending: false };
  let seq = 0;
  const notify = () => queueMicrotask(() => listeners.forEach((f) => f()));

  const apply = (ops: Op[]) => {
    for (const op of ops) {
      if (op.type === 'set') docs.set(op.path, clone(resolveTime(op.data)));
      else if (op.type === 'update') {
        const cur = docs.get(op.path);
        if (!cur) throw Object.assign(new Error('문서가 없어요'), { code: 'not-found' });
        docs.set(op.path, { ...cur, ...clone(resolveTime(op.data)) });
      } else docs.delete(op.path);
    }
    notify();
  };
  const wait = () => new Promise((r) => setTimeout(r, latency));

  const colDocs = (path: string): Doc[] => {
    const depth = path.split('/').length + 1;
    const out: Doc[] = [];
    for (const [p, d] of docs) if (parent(p) === path && p.split('/').length === depth) out.push({ id: idOf(p), data: clone(d) });
    return out;
  };

  return {
    kind: 'memory',
    newId: () => `m${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    async get(path) {
      const d = docs.get(path);
      return d ? clone(d) : null;
    },
    async getCol(path) {
      return colDocs(path);
    },
    watchDoc(path, cb) {
      let last = '';
      const run = () => {
        const d = docs.get(path) ?? null;
        const key = d ? JSON.stringify(d, (_, v) => (v instanceof Uint8Array ? v.length : v)) : 'null';
        if (key === last) return;
        last = key;
        cb(d ? clone(d) : null, meta);
      };
      listeners.add(run);
      queueMicrotask(run);
      return () => listeners.delete(run);
    },
    watchCol(path, cb) {
      let last = '';
      const run = () => {
        const list = colDocs(path);
        const key = JSON.stringify(list, (_, v) => (v instanceof Uint8Array ? v.length : v));
        if (key === last) return;
        last = key;
        cb(list, meta);
      };
      listeners.add(run);
      queueMicrotask(run);
      return () => listeners.delete(run);
    },
    watchGroup(collectionId, field, value, cb): Unsub {
      let last = '';
      const run = () => {
        const out: Doc[] = [];
        for (const [p, d] of docs) {
          const parts = p.split('/');
          if (parts[parts.length - 2] === collectionId && d[field] === value) out.push({ id: p, data: clone(d) });
        }
        const key = JSON.stringify(out);
        if (key === last) return;
        last = key;
        cb(out);
      };
      listeners.add(run);
      queueMicrotask(run);
      return () => listeners.delete(run);
    },
    async batch(ops) {
      await wait();
      apply(ops);
    },
    async transaction(fn) {
      await wait();
      const ops: Op[] = [];
      const tx: Tx = {
        get: async (p) => {
          const d = docs.get(p);
          return d ? clone(d) : null;
        },
        set: (path, data) => ops.push({ type: 'set', path, data }),
        update: (path, data) => ops.push({ type: 'update', path, data }),
        delete: (path) => ops.push({ type: 'delete', path }),
      };
      const r = await fn(tx);
      apply(ops);
      return r;
    },
    bytes: (u8) => new Uint8Array(u8),
    readBytes: (v) => v as Uint8Array,
    dump: () => docs,
  };
}

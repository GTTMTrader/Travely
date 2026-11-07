import {
  Bytes,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { SERVER_TIME, type Data, type DocStore, type Tx } from './store';

/** Firestore Timestamp → ms, SERVER_TIME → serverTimestamp() */
function fromFs(d: Data): Data {
  const out: Data = {};
  for (const [k, v] of Object.entries(d)) out[k] = v instanceof Timestamp ? v.toMillis() : v;
  return out;
}
function toFs(d: Data): Data {
  const out: Data = {};
  for (const [k, v] of Object.entries(d)) out[k] = v === SERVER_TIME ? serverTimestamp() : v;
  return out;
}
/** 초대 만료처럼 규칙에서 timestamp 로 비교해야 하는 필드 */
const TS_FIELDS = new Set(['expiresAt']);
function withTimestamps(d: Data): Data {
  const out = toFs(d);
  for (const k of TS_FIELDS) if (typeof out[k] === 'number') out[k] = Timestamp.fromMillis(out[k] as number);
  return out;
}

export function createFirebaseStore(db: Firestore): DocStore {
  const ref = (path: string) => doc(db, path);
  return {
    kind: 'firebase',
    newId: () => doc(collection(db, '_')).id,
    async get(path) {
      const s = await getDoc(ref(path));
      return s.exists() ? fromFs(s.data()) : null;
    },
    async getCol(path) {
      const s = await getDocs(collection(db, path));
      return s.docs.map((d) => ({ id: d.id, data: fromFs(d.data()) }));
    },
    watchDoc(path, cb, onErr) {
      return onSnapshot(
        ref(path),
        { includeMetadataChanges: true },
        (s) => cb(s.exists() ? fromFs(s.data({ serverTimestamps: 'estimate' })) : null, { fromCache: s.metadata.fromCache, pending: s.metadata.hasPendingWrites }),
        onErr,
      );
    },
    watchCol(path, cb, onErr) {
      return onSnapshot(
        collection(db, path),
        { includeMetadataChanges: true },
        (s) =>
          cb(
            s.docs.map((d) => ({ id: d.id, data: fromFs(d.data({ serverTimestamps: 'estimate' })) })),
            { fromCache: s.metadata.fromCache, pending: s.metadata.hasPendingWrites },
          ),
        onErr,
      );
    },
    watchGroup(collectionId, field, value, cb, onErr) {
      return onSnapshot(
        query(collectionGroup(db, collectionId), where(field, '==', value)),
        (s) => cb(s.docs.map((d) => ({ id: d.ref.path, data: fromFs(d.data()) }))),
        onErr,
      );
    },
    async batch(ops) {
      // Firestore batch 는 500개 제한 → 나눠서 커밋 (한 묶음 안에서는 원자적)
      for (let i = 0; i < ops.length; i += 450) {
        const b = writeBatch(db);
        for (const op of ops.slice(i, i + 450)) {
          if (op.type === 'set') b.set(ref(op.path), withTimestamps(op.data));
          else if (op.type === 'update') b.update(ref(op.path), withTimestamps(op.data));
          else b.delete(ref(op.path));
        }
        await b.commit();
      }
    },
    transaction(fn) {
      return runTransaction(db, async (t) => {
        const tx: Tx = {
          get: async (p) => {
            const s = await t.get(ref(p));
            return s.exists() ? fromFs(s.data()) : null;
          },
          set: (p, d) => void t.set(ref(p), withTimestamps(d)),
          update: (p, d) => void t.update(ref(p), withTimestamps(d)),
          delete: (p) => void t.delete(ref(p)),
        };
        return fn(tx);
      });
    },
    bytes: (u8) => Bytes.fromUint8Array(u8),
    readBytes: (v) => (v as Bytes).toUint8Array(),
  };
}

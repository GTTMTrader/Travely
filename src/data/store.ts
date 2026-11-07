/**
 * 저장소 추상화. 앱의 모든 데이터 작업(repo.ts)은 이 인터페이스만 사용한다.
 *  - firebaseStore: 실제 앱 (Cloud Firestore, 실시간 동기화·오프라인 캐시)
 *  - memoryStore: 미리보기·화면 테스트 (서버 없이 같은 화면을 그대로 실행)
 */

export type Data = Record<string, unknown>;
export interface Doc {
  id: string;
  data: Data;
}
export interface SnapMeta {
  /** 서버와 연결되지 않은 캐시 값인지 */
  fromCache: boolean;
  /** 아직 서버에 반영되지 않은 내 변경이 있는지 */
  pending: boolean;
}
export type Unsub = () => void;
export type Op =
  | { type: 'set'; path: string; data: Data }
  | { type: 'update'; path: string; data: Data }
  | { type: 'delete'; path: string };

export interface Tx {
  get(path: string): Promise<Data | null>;
  set(path: string, data: Data): void;
  update(path: string, data: Data): void;
  delete(path: string): void;
}

/** 쓰기 데이터 안에서 '서버 시각'으로 바뀌는 표식 */
export const SERVER_TIME = Symbol('serverTime');

export interface DocStore {
  kind: 'firebase' | 'memory';
  newId(): string;
  get(path: string): Promise<Data | null>;
  getCol(path: string): Promise<Doc[]>;
  watchDoc(path: string, cb: (d: Data | null, meta: SnapMeta) => void, onErr: (e: unknown) => void): Unsub;
  watchCol(path: string, cb: (docs: Doc[], meta: SnapMeta) => void, onErr: (e: unknown) => void): Unsub;
  /** 컬렉션 그룹에서 field == value 인 문서 (내 여행 목록용). 결과 doc.id 는 전체 경로 */
  watchGroup(collectionId: string, field: string, value: string, cb: (docs: Doc[]) => void, onErr: (e: unknown) => void): Unsub;
  batch(ops: Op[]): Promise<void>;
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** 바이트 값 저장/읽기 (파일 청크) */
  bytes(u8: Uint8Array): unknown;
  readBytes(v: unknown): Uint8Array;
}

export class PermissionError extends Error {
  code = 'permission-denied';
}

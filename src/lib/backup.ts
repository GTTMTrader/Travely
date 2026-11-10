/**
 * 여행 백업 (끝난 여행을 통째로 보관).
 *
 * 백업 파일 = HTML 한 개. 안에 '백업 보기용 앱'과 여행 원본 데이터(JSON)가 같이 들어 있다.
 *  - 저장소(Firestore)에 있던 문서를 손대지 않은 그대로(raw) 담는다 → 나중에 앱이 바뀌어도 정보가 빠지지 않음
 *  - 첨부 파일(예약 캡처·PDF)은 원본 바이트를 base64 로 통째로 담는다
 *  - PC 에서 더블클릭 → 인터넷 없이도 앱처럼 열림(읽기 전용). 아이폰은 Travely 홈 → '백업 파일 열기'
 *  - '새 여행으로 되살리기' → 서버에 새 여행으로 다시 만든다(보안 규칙을 그대로 지키는 일반 쓰기만 사용)
 */
import { SERVER_TIME, type Data, type Op } from '../data/store';
import { getStore, createTrip, splitChunks, readFileBytes, type SessionUser, type TripInput } from '../data/repo';
import { track } from './saveStatus';
import { getFileBlob } from './files';
import type { FileMeta } from './types';

export const BACKUP_FORMAT = 'travely-backup';
export const BACKUP_VERSION = 1;
/** 백업 HTML 에서 데이터가 들어갈 자리 (보기용 앱 빌드가 남겨 둔 표식) */
export const BACKUP_SLOT = '<!--TRAVELY_BACKUP_SLOT-->';
export const BACKUP_SCRIPT_ID = 'travely-backup';

/** 여행 아래에서 백업하는 컬렉션 (초대 링크는 다시 쓸 일이 없고 주인만 볼 수 있어 제외) */
export const BACKUP_COLS = ['members', 'days', 'items', 'legs', 'bookings', 'files', 'expenses', 'packing'] as const;

export interface TravelyBackup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  exportedBy: { uid: string; displayName: string };
  app: string;
  tripId: string;
  /** 'trips/{id}' 문서 */
  trip: Data;
  /** 컬렉션 → 문서 목록 (문서 ID 포함, 저장소 값 그대로. 시각은 ms) */
  cols: Record<string, { id: string; data: Data }[]>;
  /** 첨부 파일 ID → 원본 바이트(base64) */
  files: Record<string, string>;
  /** 받지 못한 첨부 파일 (업로드가 끝나지 않았던 것 등) */
  missingFiles: { id: string; name: string; reason: string }[];
}

// ───────── base64 ─────────
export function toBase64(u8: Uint8Array): string {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < u8.length; i += step) s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + step)));
  return btoa(s);
}
export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

// ───────── 만들기 ─────────
export async function makeBackup(
  tripId: string,
  me: { uid: string; displayName: string },
  onProgress?: (msg: string) => void,
): Promise<TravelyBackup> {
  const store = getStore();
  onProgress?.('여행 정보 읽는 중…');
  const trip = await store.get(`trips/${tripId}`);
  if (!trip) throw new Error('여행 정보를 읽지 못했어요. 연결을 확인해 주세요');
  const cols: TravelyBackup['cols'] = {};
  for (const c of BACKUP_COLS) {
    onProgress?.(`${COL_LABEL[c]} 읽는 중…`);
    cols[c] = (await store.getCol(`trips/${tripId}/${c}`)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  const files: Record<string, string> = {};
  const missingFiles: TravelyBackup['missingFiles'] = [];
  const metas = cols.files.map((d) => ({ ...(d.data as unknown as FileMeta), id: d.id }));
  let i = 0;
  for (const meta of metas) {
    onProgress?.(`첨부 파일 담는 중… ${++i}/${metas.length}`);
    try {
      let u8: Uint8Array;
      try {
        u8 = new Uint8Array(await (await getFileBlob(tripId, meta)).blob.arrayBuffer());
      } catch {
        u8 = await readFileBytes(tripId, meta);
      }
      if (meta.size && u8.length !== meta.size) throw new Error(`크기가 달라요 (${u8.length}/${meta.size})`);
      files[meta.id] = toBase64(u8);
    } catch (e) {
      missingFiles.push({ id: meta.id, name: meta.name, reason: (e as Error).message || '읽기 실패' });
    }
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    exportedBy: { uid: me.uid, displayName: me.displayName },
    app: typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '',
    tripId,
    trip,
    cols,
    files,
    missingFiles,
  };
}

const COL_LABEL: Record<(typeof BACKUP_COLS)[number], string> = {
  members: '함께하는 사람', days: '날짜', items: '일정', legs: '이동 정보', bookings: '예약', files: '첨부 파일 목록', expenses: '가계부', packing: '준비물',
};

/** 백업 JSON → HTML 안에 넣어도 안전한 문자열 ('<' 를 < 로 → </script> 로 끊길 일이 없음) */
export const backupJson = (b: TravelyBackup) => JSON.stringify(b).replace(/</g, '\\u003c');

/** 보기용 앱 HTML + 데이터 → 백업 HTML 한 개 */
export function buildBackupHtml(viewerHtml: string, b: TravelyBackup): string {
  const tag = `<script type="application/json" id="${BACKUP_SCRIPT_ID}">${backupJson(b)}</script>`;
  const name = String(b.trip.name ?? '여행').replace(/[<>&"]/g, '');
  let html = viewerHtml.replace(/<title>[^<]*<\/title>/, () => `<title>${name} · Travely 백업</title>`);
  const at = html.indexOf(BACKUP_SLOT);
  if (at >= 0) return html.slice(0, at) + tag + html.slice(at + BACKUP_SLOT.length);
  const end = html.lastIndexOf('</body>');
  if (end < 0) throw new Error('보기용 앱 파일이 올바르지 않아요');
  return html.slice(0, end) + tag + html.slice(end);
}

export function backupFileName(b: TravelyBackup, ext: 'html' | 'json') {
  const base = String(b.trip.name ?? 'Travely').replace(/[\\/:*?"<>|]/g, '').trim() || 'Travely';
  const d = new Date(b.exportedAt);
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${base} 백업 ${ymd}.${ext}`;
}

// ───────── 읽기 ─────────
/** 백업 HTML 또는 JSON 텍스트 → 백업 데이터 (형식 검사) */
export function parseBackup(text: string): TravelyBackup {
  let json = text.trim();
  if (!json.startsWith('{')) {
    const open = json.indexOf(`id="${BACKUP_SCRIPT_ID}">`);
    if (open < 0) throw new Error('Travely 백업 파일이 아니에요');
    const from = open + `id="${BACKUP_SCRIPT_ID}">`.length;
    const to = json.indexOf('</script>', from);
    json = json.slice(from, to < 0 ? undefined : to);
  }
  let b: TravelyBackup;
  try {
    b = JSON.parse(json);
  } catch {
    throw new Error('백업 파일이 손상됐어요 (데이터를 읽을 수 없음)');
  }
  if (!b || b.format !== BACKUP_FORMAT || typeof b.tripId !== 'string' || !b.trip || !b.cols) throw new Error('Travely 백업 파일이 아니에요');
  if (b.version > BACKUP_VERSION) throw new Error('더 새 버전 앱에서 만든 백업이에요. 앱을 업데이트해 주세요');
  for (const c of BACKUP_COLS) b.cols[c] ??= [];
  b.files ??= {};
  b.missingFiles ??= [];
  return b;
}

/** 백업 요약 (열기 전 확인용) */
export function backupSummary(b: TravelyBackup) {
  const fileBytes = Object.values(b.files).reduce((s, x) => s + Math.floor((x.length * 3) / 4), 0);
  return {
    name: String(b.trip.name ?? ''),
    startDate: String(b.trip.startDate ?? ''),
    endDate: String(b.trip.endDate ?? ''),
    items: b.cols.items.length,
    bookings: b.cols.bookings.length,
    expenses: b.cols.expenses.length,
    packing: b.cols.packing.length,
    files: Object.keys(b.files).length,
    fileBytes,
    missing: b.missingFiles.length,
    members: b.cols.members.filter((m) => m.data.status === 'active').map((m) => String(m.data.displayName ?? '')),
  };
}

/** 메모리 저장소 쓰기 목록 (백업 보기 화면이 이 데이터를 그대로 띄움) */
export function backupDocs(b: TravelyBackup, bytes: (u8: Uint8Array) => unknown): { path: string; data: Data }[] {
  const t = `trips/${b.tripId}`;
  const out: { path: string; data: Data }[] = [{ path: t, data: b.trip }];
  for (const c of BACKUP_COLS) for (const d of b.cols[c]) out.push({ path: `${t}/${c}/${d.id}`, data: d.data });
  for (const [fid, b64] of Object.entries(b.files)) {
    splitChunks(fromBase64(b64)).forEach((part, n) => out.push({ path: `${t}/files/${fid}/chunks/${String(n).padStart(4, '0')}`, data: { n, data: bytes(part) } }));
  }
  // 받지 못한 파일은 '업로드 중'으로 보이게
  const have = new Set(Object.keys(b.files));
  for (const o of out) if (o.path.startsWith(`${t}/files/`) && o.path.split('/').length === 4 && !have.has(o.path.split('/')[3])) o.data = { ...o.data, complete: false };
  return out;
}

// ───────── 되살리기 (새 여행으로) ─────────
const pick = (d: Data, keys: readonly string[]): Data => {
  const o: Data = {};
  for (const k of keys) if (k in d) o[k] = d[k];
  return o;
};
const ITEM_KEYS = ['id', 'dayId', 'order', 'kind', 'category', 'tag', 'time', 'memo', 'place', 'bookingIds', 'checklist'] as const;
const LEG_KEYS = ['id', 'fromId', 'toId', 'mode', 'durationMin', 'distanceM', 'fareAmount', 'fareCurrency', 'memo', 'source', 'geometry', 'routedAt', 'routedFrom', 'routedTo'] as const;
const BOOKING_KEYS = ['id', 'type', 'title', 'startDate', 'startTime', 'endDate', 'endTime', 'reservationNo', 'memo', 'flight', 'fileIds'] as const;
const EXPENSE_KEYS = ['id', 'title', 'date', 'time', 'category', 'amount', 'currency', 'krwRate', 'krwRateDate', 'krwActual', 'method', 'cardName', 'platform', 'payers', 'split', 'memo'] as const;

/** 대략적인 문서 크기 (한 번에 보내는 양을 4MB 아래로) */
const sizeOf = (d: Data) => JSON.stringify(d).length;

/**
 * 여러 번에 나눠 보내기: 한 번에 200개·약 4MB 이하, 그리고 서로 다른 날짜 10개 이하
 * (일정 문서마다 규칙이 그 날짜 문서를 확인 → 한 묶음의 규칙 조회 한도 20 을 넘지 않게)
 */
async function sendInBatches(ops: Op[], onSent: (n: number) => void) {
  const store = getStore();
  let cur: Op[] = [];
  let bytes = 0;
  let dayIds = new Set<string>();
  const flush = async () => {
    if (!cur.length) return;
    await store.batch(cur);
    onSent(cur.length);
    cur = [];
    bytes = 0;
    dayIds = new Set();
  };
  for (const op of ops) {
    const s = op.type === 'delete' ? 100 : sizeOf(op.data);
    const day = op.type === 'set' && typeof op.data.dayId === 'string' ? op.data.dayId : null;
    if (cur.length >= 200 || bytes + s > 4_000_000 || (day && !dayIds.has(day) && dayIds.size >= 10)) await flush();
    cur.push(op);
    bytes += s;
    if (day) dayIds.add(day);
  }
  await flush();
}

/**
 * 백업 → 서버에 '새 여행'으로 다시 만들기. 되살린 사람이 여행 주인이 되고, 같이 갔던 사람은 다시 초대해야 한다
 * (같은 계정으로 초대에 들어오면 가계부의 결제자·분담이 그대로 그 사람에게 이어짐).
 * 일정·이동·예약·첨부·가계부·준비물의 내용과 문서 ID 는 그대로, 작성자/시각만 '나/지금'으로 바뀐다(보안 규칙상).
 */
export async function restoreBackup(user: SessionUser, b: TravelyBackup, onProgress?: (msg: string) => void): Promise<string> {
  const store = getStore();
  const t = b.trip;
  const input: TripInput = {
    name: String(t.name ?? '복원한 여행').slice(0, 60),
    countryCode: String(t.countryCode ?? ''),
    cities: Array.isArray(t.cities) ? (t.cities as TripInput['cities']) : [],
    startDate: String(t.startDate),
    endDate: String(t.endDate),
    timezone: String(t.timezone ?? 'Asia/Seoul'),
    baseCurrency: (t.baseCurrency as TripInput['baseCurrency']) ?? 'KRW',
    illustration: (t.illustration as TripInput['illustration']) ?? 'city',
  };
  const dayCities: Record<string, string> = {};
  for (const d of b.cols.days) dayCities[d.id] = String(d.data.city ?? '');
  onProgress?.('새 여행 만드는 중…');
  const tripId = await createTrip(user, input, { dayCities }, t.isSample === true);
  const base = `trips/${tripId}`;
  const me = user.uid;
  // 백업한 사람과 되살리는 계정이 다르면 그 사람 몫을 나에게로
  const mapUid = (u: string) => (u === b.exportedBy.uid ? me : u);
  const mapKeys = (m: unknown) => Object.fromEntries(Object.entries((m as Record<string, unknown>) ?? {}).map(([k, v]) => [mapUid(k), v]));
  const names = new Map(b.cols.members.map((m) => [m.id, String(m.data.displayName ?? '')]));
  const days = new Set(b.cols.days.map((d) => d.id));
  const created = { createdBy: me, createdAt: SERVER_TIME, updatedBy: me, updatedAt: SERVER_TIME, version: 1 };
  const stamped = { updatedBy: me, updatedAt: SERVER_TIME, version: 1 };

  return track('백업 되살리는 중', async () => {
    const total = b.cols.bookings.length + b.cols.items.length + b.cols.legs.length + b.cols.expenses.length + b.cols.packing.length + Object.keys(b.files).length;
    let done = 0;
    const tick = (n: number) => {
      done += n;
      onProgress?.(`되살리는 중… ${Math.min(done, total)}/${total}`);
    };

    // 1) 첨부 파일 (메타 → 조각 하나씩 → 완료 표시: 평소 업로드와 같은 순서)
    for (const f of b.cols.files) {
      const b64 = b.files[f.id];
      if (!b64) continue;
      const parts = splitChunks(fromBase64(b64));
      const meta = `${base}/files/${f.id}`;
      const d = f.data;
      await store.batch([{ type: 'set', path: meta, data: { id: f.id, name: String(d.name ?? '파일').slice(0, 120), mime: d.mime, size: d.size, pages: d.pages ?? 1, thumb: d.thumb ?? '', chunkCount: parts.length, complete: false, uploadedBy: me, uploadedAt: SERVER_TIME } }]);
      for (let n = 0; n < parts.length; n++) await store.batch([{ type: 'set', path: `${meta}/chunks/${String(n).padStart(4, '0')}`, data: { n, data: store.bytes(parts[n]) } }]);
      await store.batch([{ type: 'update', path: meta, data: { complete: true } }]);
      tick(1);
    }
    const restoredFiles = new Set(b.cols.files.filter((f) => b.files[f.id]).map((f) => f.id));

    // 2) 예약 → 일정 → 이동 → 가계부 → 준비물
    const ops: Op[] = [];
    for (const d of b.cols.bookings) {
      const fileIds = ((d.data.fileIds as string[]) ?? []).filter((x) => restoredFiles.has(x));
      ops.push({ type: 'set', path: `${base}/bookings/${d.id}`, data: { ...pick(d.data, BOOKING_KEYS), id: d.id, fileIds, ...created } });
    }
    const itemsByDay = [...b.cols.items].sort((x, y) => String(x.data.dayId ?? '').localeCompare(String(y.data.dayId ?? '')));
    for (const d of itemsByDay) {
      const dayId = d.data.dayId && days.has(String(d.data.dayId)) ? d.data.dayId : null;
      ops.push({ type: 'set', path: `${base}/items/${d.id}`, data: { ...pick(d.data, ITEM_KEYS), id: d.id, dayId, ...created } });
    }
    for (const d of b.cols.legs) ops.push({ type: 'set', path: `${base}/legs/${d.id}`, data: { ...pick(d.data, LEG_KEYS), id: d.id, ...stamped } });
    for (const d of b.cols.expenses) {
      const split = (d.data.split as Data) ?? { mode: 'equal', shares: {} };
      ops.push({
        type: 'set',
        path: `${base}/expenses/${d.id}`,
        data: { ...pick(d.data, EXPENSE_KEYS), id: d.id, payers: mapKeys(d.data.payers), split: { ...split, shares: mapKeys(split.shares) }, ...created },
      });
    }
    for (const d of b.cols.packing) {
      // 준비물 주인은 '함께' 또는 지금 멤버만 가능 → 다른 사람 것은 '함께'로 두고 이름을 앞에 붙여 보존
      const owner = String(d.data.owner ?? 'shared');
      const mine = owner === 'shared' || mapUid(owner) === me;
      const text = String(d.data.text ?? '').trim() || '준비물';
      ops.push({
        type: 'set',
        path: `${base}/packing/${d.id}`,
        data: { id: d.id, text: (mine ? text : `(${names.get(owner) || '같이 간 사람'}) ${text}`).slice(0, 100), owner: mine ? (owner === 'shared' ? 'shared' : me) : 'shared', done: d.data.done === true, order: typeof d.data.order === 'number' ? d.data.order : 0, ...stamped },
      });
    }
    await sendInBatches(ops, tick);
    return tripId;
  }, 600000);
}

// ───────── 아이폰: 앱 → 백업 보기 화면으로 넘겨주기 (같은 사이트의 IndexedDB) ─────────
const IDB = 'travely-archive';
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(IDB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function stashBackupText(text: string): Promise<void> {
  const db = await idb();
  await new Promise<void>((res, rej) => {
    const t = db.transaction('kv', 'readwrite');
    t.objectStore('kv').put(text, 'current');
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
  });
}
export async function loadStashedBackupText(): Promise<string | null> {
  try {
    const db = await idb();
    return await new Promise((res) => {
      const q = db.transaction('kv').objectStore('kv').get('current');
      q.onsuccess = () => res((q.result as string) ?? null);
      q.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}

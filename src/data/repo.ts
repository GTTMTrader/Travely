/**
 * Travely 데이터 작업 모음. 저장소(DocStore)만 알면 되므로 Firebase·메모리 양쪽에서 같은 코드가 돈다.
 * 모든 쓰기는 track() 으로 감싸 '저장 중 / 저장 완료 / 저장 실패 / 충돌' 상태를 화면에 알린다.
 * 동시 편집: 문서마다 version. 트랜잭션에서 내가 본 버전과 다르면 ConflictError (서버 규칙도 version+1 강제).
 */
import { SERVER_TIME, type Data, type Doc, type DocStore, type Op, type Unsub } from './store';
import { ConflictError, track } from '../lib/saveStatus';
import type {
  Booking, Currency, Day, Expense, FileMeta, FlightInfo, Illustration, Invite, Item, Leg, Member, PackingItem, Role, Trip, TripBundle, City,
} from '../lib/types';
import { legId } from '../lib/types';
import { dateRange } from '../lib/time';
import { orderAtEnd, orderBetween, renormalize, reorderWithinDay, sortItems } from '../lib/order';

let store: DocStore;
export function setStore(s: DocStore) {
  store = s;
}
export const getStore = () => store;

// ───────── 경로 ─────────
const P = {
  trip: (t: string) => `trips/${t}`,
  col: (t: string, c: string) => `trips/${t}/${c}`,
  doc: (t: string, c: string, id: string) => `trips/${t}/${c}/${id}`,
  chunk: (t: string, f: string, n: number) => `trips/${t}/files/${f}/chunks/${String(n).padStart(4, '0')}`,
};
const SUBS = ['members', 'invites', 'days', 'items', 'legs', 'bookings', 'files', 'expenses', 'packing'] as const;

// ───────── 정규화 (예전 문서·누락 필드 보정) ─────────
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null);

export function toTrip(id: string, d: Data): Trip {
  return {
    id,
    name: str(d.name),
    countryCode: str(d.countryCode, 'CN'),
    cities: Array.isArray(d.cities) ? (d.cities as City[]) : [],
    startDate: str(d.startDate),
    endDate: str(d.endDate),
    timezone: str(d.timezone, 'Asia/Seoul'),
    baseCurrency: (str(d.baseCurrency, 'KRW') as Currency),
    illustration: (str(d.illustration, 'city') as Illustration),
    ownerUid: str(d.ownerUid),
    isSample: d.isSample === true,
    updatedBy: str(d.updatedBy),
    updatedAt: numOrNull(d.updatedAt) ?? undefined,
  };
}
export function toItem(id: string, d: Data): Item {
  return {
    id,
    dayId: strOrNull(d.dayId),
    order: num(d.order),
    kind: (str(d.kind, 'place') as Item['kind']),
    category: (strOrNull(d.category) as Item['category']),
    tag: str(d.tag),
    time: strOrNull(d.time),
    memo: str(d.memo),
    place: (d.place as Item['place']) ?? null,
    bookingIds: Array.isArray(d.bookingIds) ? (d.bookingIds as string[]) : [],
    checklist: Array.isArray(d.checklist) ? (d.checklist as Item['checklist']) : [],
    createdBy: str(d.createdBy),
    updatedBy: str(d.updatedBy),
    updatedAt: numOrNull(d.updatedAt) ?? undefined,
    version: num(d.version, 1),
  };
}
const cast = <T,>(id: string, d: Data) => ({ ...(d as object), id } as T);

// ───────── 여행 ─────────
export interface TripInput {
  name: string;
  countryCode: string;
  cities: City[];
  startDate: string;
  endDate: string;
  timezone: string;
  baseCurrency: Currency;
  illustration: Illustration;
}

export interface Seed {
  items?: { dayId: string | null; item: Partial<Item> & Pick<Item, 'kind'>; key?: string }[];
  bookings?: { key: string; booking: Partial<Booking> & Pick<Booking, 'type' | 'title'>; files?: { blob: Blob; name: string; mime: string; thumb: string }[]; linkKeys?: string[] }[];
  expenses?: Partial<Expense>[];
  packing?: Partial<PackingItem>[];
  extraMembers?: Member[];
  dayCities?: Record<string, string>;
}

export interface SessionUser {
  uid: string;
  displayName: string;
}

export async function createTrip(user: SessionUser, t: TripInput, seed?: Seed, isSample = false): Promise<string> {
  return track('여행 만드는 중', async () => {
    const tripId = store.newId();
    await store.batch([
      { type: 'set', path: P.trip(tripId), data: { ...t, name: t.name.trim(), ownerUid: user.uid, isSample, createdAt: SERVER_TIME, updatedAt: SERVER_TIME, updatedBy: user.uid } },
      { type: 'set', path: P.doc(tripId, 'members', user.uid), data: { uid: user.uid, role: 'owner', status: 'active', displayName: user.displayName, joinedAt: SERVER_TIME } },
    ]);
    const ops: Op[] = [];
    const dates = dateRange(t.startDate, t.endDate);
    dates.forEach((date, index) => ops.push({ type: 'set', path: P.doc(tripId, 'days', date), data: { date, index, city: seed?.dayCities?.[date] ?? t.cities[0]?.name ?? '' } }));
    if (seed) ops.push(...(await seedOps(tripId, user.uid, seed)));
    await store.batch(ops);
    return tripId;
  });
}

async function seedOps(tripId: string, uid: string, seed: Seed): Promise<Op[]> {
  const ops: Op[] = [];
  const keyToItem = new Map<string, string>();
  const keyToBooking = new Map<string, string>();
  const perDay = new Map<string, number>();
  for (const m of seed.extraMembers ?? []) ops.push({ type: 'set', path: P.doc(tripId, 'members', m.uid), data: { ...m, joinedAt: SERVER_TIME } });
  for (const b of seed.bookings ?? []) keyToBooking.set(b.key, store.newId());
  for (const { dayId, item, key } of seed.items ?? []) {
    const id = store.newId();
    if (key) keyToItem.set(key, id);
    const k = dayId ?? '_cand';
    const n = (perDay.get(k) ?? 0) + 1;
    perDay.set(k, n);
    const bookingIds = (item.bookingIds ?? []).map((bk) => keyToBooking.get(bk) ?? bk);
    ops.push({ type: 'set', path: P.doc(tripId, 'items', id), data: { ...blankItem(uid), ...item, bookingIds, id, dayId, order: n * 1000 } });
  }
  for (const b of seed.bookings ?? []) {
    const id = keyToBooking.get(b.key)!;
    const fileIds: string[] = [];
    for (const f of b.files ?? []) {
      const fid = store.newId();
      fileIds.push(fid);
      ops.push(...(await fileOps(tripId, uid, fid, f.blob, f.name, f.mime, f.thumb, 1)));
    }
    ops.push({ type: 'set', path: P.doc(tripId, 'bookings', id), data: { ...blankBooking(uid), ...b.booking, fileIds, id } });
  }
  for (const e of seed.expenses ?? []) {
    const id = store.newId();
    ops.push({ type: 'set', path: P.doc(tripId, 'expenses', id), data: { ...e, id, createdBy: uid, updatedBy: uid, updatedAt: SERVER_TIME, createdAt: SERVER_TIME, version: 1 } });
  }
  (seed.packing ?? []).forEach((p, i) => {
    const id = store.newId();
    ops.push({ type: 'set', path: P.doc(tripId, 'packing', id), data: { done: false, owner: 'shared', ...p, id, order: (i + 1) * 1000, updatedBy: uid, updatedAt: SERVER_TIME, version: 1 } });
  });
  return ops;
}

const blankItem = (uid: string) => ({
  kind: 'place', category: null, tag: '', time: null, memo: '', place: null, bookingIds: [], checklist: [],
  createdBy: uid, createdAt: SERVER_TIME, updatedBy: uid, updatedAt: SERVER_TIME, version: 1,
});
const blankBooking = (uid: string) => ({
  startDate: null, startTime: null, endDate: null, endTime: null, reservationNo: '', memo: '', flight: null, fileIds: [],
  createdBy: uid, createdAt: SERVER_TIME, updatedBy: uid, updatedAt: SERVER_TIME, version: 1,
});

/**
 * 여행 정보 수정. 기간이 바뀌면 날짜 문서를 더하고 빼며,
 * 사라지는 날짜의 일정은 '후보 장소'로 옮긴다 (한 묶음으로 원자적 처리).
 */
export function planDateChange(oldDays: Day[], items: Item[], start: string, end: string, defaultCity: string) {
  const next = dateRange(start, end);
  const nextSet = new Set(next);
  const oldMap = new Map(oldDays.map((d) => [d.date, d]));
  const removed = oldDays.filter((d) => !nextSet.has(d.date)).map((d) => d.date);
  const removedSet = new Set(removed);
  const moved = sortItems(items.filter((i) => i.dayId && removedSet.has(i.dayId)));
  const candidates = sortItems(items.filter((i) => i.dayId === null));
  let tail = orderAtEnd(candidates);
  const itemMoves = moved.map((i) => {
    const o = tail;
    tail += 1000;
    return { id: i.id, version: i.version, order: o };
  });
  const days = next.map((date, index) => ({ date, index, city: oldMap.get(date)?.city ?? defaultCity, isNew: !oldMap.has(date) }));
  return { removed, itemMoves, days };
}

export async function updateTrip(tripId: string, uid: string, patch: Partial<TripInput>, bundle: TripBundle) {
  return track('여행 정보 저장 중', async () => {
    const ops: Op[] = [{ type: 'update', path: P.trip(tripId), data: { ...patch, updatedBy: uid, updatedAt: SERVER_TIME } }];
    const start = patch.startDate ?? bundle.trip.startDate;
    const end = patch.endDate ?? bundle.trip.endDate;
    if (start !== bundle.trip.startDate || end !== bundle.trip.endDate) {
      const plan = planDateChange(bundle.days, bundle.items, start, end, (patch.cities ?? bundle.trip.cities)[0]?.name ?? '');
      for (const d of plan.removed) ops.push({ type: 'delete', path: P.doc(tripId, 'days', d) });
      for (const d of plan.days) {
        if (d.isNew) ops.push({ type: 'set', path: P.doc(tripId, 'days', d.date), data: { date: d.date, index: d.index, city: d.city } });
        else ops.push({ type: 'update', path: P.doc(tripId, 'days', d.date), data: { index: d.index } });
      }
      for (const m of plan.itemMoves)
        ops.push({ type: 'update', path: P.doc(tripId, 'items', m.id), data: { dayId: null, order: m.order, version: m.version + 1, updatedBy: uid, updatedAt: SERVER_TIME } });
    }
    await store.batch(ops);
  });
}

export async function setDayCity(tripId: string, date: string, city: string) {
  return track('도시 저장 중', () => store.batch([{ type: 'update', path: P.doc(tripId, 'days', date), data: { city: city.trim().slice(0, 40) } }]));
}

export async function deleteTrip(tripId: string, uid: string) {
  return track('여행 삭제 중', async () => {
    const ops: Op[] = [];
    const files = await store.getCol(P.col(tripId, 'files'));
    for (const f of files) {
      const chunks = await store.getCol(`${P.col(tripId, 'files')}/${f.id}/chunks`);
      chunks.forEach((c) => ops.push({ type: 'delete', path: `${P.col(tripId, 'files')}/${f.id}/chunks/${c.id}` }));
    }
    for (const sub of SUBS) {
      if (sub === 'members') continue;
      const docs = await store.getCol(P.col(tripId, sub));
      docs.forEach((d) => ops.push({ type: 'delete', path: P.doc(tripId, sub, d.id) }));
    }
    const members = await store.getCol(P.col(tripId, 'members'));
    members.filter((m) => m.id !== uid).forEach((m) => ops.push({ type: 'delete', path: P.doc(tripId, 'members', m.id) }));
    await store.batch(ops);
    // 여행 문서 → 마지막으로 내 멤버 문서 (규칙이 멤버 여부로 판단하므로 순서 중요)
    await store.batch([{ type: 'delete', path: P.trip(tripId) }]);
    await store.batch([{ type: 'delete', path: P.doc(tripId, 'members', uid) }]);
  }, 60000);
}

// ───────── 초대·멤버 ─────────
export function makeToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function createInvite(tripId: string, uid: string, role: 'editor' | 'viewer', days: number, tripName: string, inviterName: string) {
  return track('초대 링크 만드는 중', async () => {
    const token = makeToken();
    await store.batch([{
      type: 'set', path: P.doc(tripId, 'invites', token),
      data: { role, revoked: false, createdBy: uid, createdAt: SERVER_TIME, expiresAt: Date.now() + days * 86400000, tripName, inviterName },
    }]);
    return token;
  });
}
export const revokeInvite = (tripId: string, token: string) =>
  track('링크 폐기 중', () => store.batch([{ type: 'update', path: P.doc(tripId, 'invites', token), data: { revoked: true, revokedAt: SERVER_TIME } }]));

export type InviteCheck =
  | { status: 'ok'; invite: Invite }
  | { status: 'member' }
  | { status: 'removed' }
  | { status: 'expired' | 'revoked'; invite: Invite }
  | { status: 'notfound' };

export async function checkInvite(tripId: string, token: string, uid: string): Promise<InviteCheck> {
  const mine = await store.get(P.doc(tripId, 'members', uid)).catch(() => null);
  if (mine) return mine.status === 'active' ? { status: 'member' } : { status: 'removed' };
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return { status: 'notfound' };
  const d = await store.get(P.doc(tripId, 'invites', token)).catch(() => null);
  if (!d) return { status: 'notfound' };
  const invite = { ...(d as unknown as Invite), token };
  if (invite.revoked) return { status: 'revoked', invite };
  if (invite.expiresAt <= Date.now()) return { status: 'expired', invite };
  return { status: 'ok', invite };
}

export const acceptInvite = (tripId: string, token: string, user: SessionUser, role: Role) =>
  track('여행에 참여하는 중', () =>
    store.batch([{
      type: 'set', path: P.doc(tripId, 'members', user.uid),
      data: { uid: user.uid, role, status: 'active', displayName: user.displayName, joinedAt: SERVER_TIME, inviteToken: token },
    }]),
  );
export const setMemberRole = (tripId: string, uid: string, role: 'editor' | 'viewer') =>
  track('권한 변경 중', () => store.batch([{ type: 'update', path: P.doc(tripId, 'members', uid), data: { role } }]));
export const removeMember = (tripId: string, uid: string) =>
  track('접근 해제 중', () => store.batch([{ type: 'update', path: P.doc(tripId, 'members', uid), data: { status: 'removed', removedAt: SERVER_TIME } }]));
export const restoreMember = (tripId: string, uid: string) =>
  track('접근 복구 중', () => store.batch([{ type: 'update', path: P.doc(tripId, 'members', uid), data: { status: 'active' } }]));
export const leaveTrip = removeMember;

// ───────── 일정 항목 ─────────
export type ItemInput = Pick<Item, 'kind' | 'category' | 'tag' | 'time' | 'memo' | 'place' | 'bookingIds' | 'checklist'>;

export async function addItem(tripId: string, uid: string, dayId: string | null, sortedTarget: Item[], data: ItemInput) {
  return track('추가하는 중', async () => {
    const id = store.newId();
    await store.batch([{ type: 'set', path: P.doc(tripId, 'items', id), data: { ...blankItem(uid), ...data, id, dayId, order: orderAtEnd(sortedTarget) } }]);
    return id;
  });
}

function check<T extends { version: number }>(cur: T | null | undefined, base: number, what = '항목'): T {
  if (!cur) throw new ConflictError(null, `다른 사람이 이미 삭제한 ${what}이에요`);
  if (cur.version !== base) throw new ConflictError(cur, '상대가 먼저 수정했어요. 최신 내용을 확인한 뒤 다시 저장해 주세요');
  return cur;
}

export async function updateItem(tripId: string, uid: string, id: string, baseVersion: number, patch: Partial<ItemInput>) {
  return track('저장 중', () =>
    store.transaction(async (tx) => {
      const path = P.doc(tripId, 'items', id);
      const cur = check(await tx.get(path) as unknown as Item | null, baseVersion);
      tx.update(path, { ...patch, version: cur.version + 1, updatedBy: uid, updatedAt: SERVER_TIME });
    }),
  );
}

export async function deleteItem(tripId: string, item: Item, legs: Leg[]) {
  return track('삭제하는 중', () =>
    store.transaction(async (tx) => {
      const path = P.doc(tripId, 'items', item.id);
      check(await tx.get(path) as unknown as Item | null, item.version);
      tx.delete(path);
      for (const l of legs) if (l.fromId === item.id || l.toId === item.id) tx.delete(P.doc(tripId, 'legs', l.id));
    }),
  );
}

/** 같은 날짜 안 순서 변경 — 옮기는 항목 1개 문서만 바뀌어 상대에게 중간 상태가 보이지 않음 */
export async function moveWithinDay(tripId: string, uid: string, sortedDay: Item[], itemId: string, toIndex: number) {
  const plan = reorderWithinDay(sortedDay, itemId, toIndex);
  if (!plan) return;
  const seen = new Map(sortedDay.map((i) => [i.id, i]));
  return track('순서 저장 중', () =>
    store.transaction(async (tx) => {
      if (plan.order === null) {
        const ids = sortedDay.map((i) => i.id).filter((id) => id !== itemId);
        ids.splice(Math.min(toIndex, ids.length), 0, itemId);
        const curs = await Promise.all(ids.map((id) => tx.get(P.doc(tripId, 'items', id))));
        curs.forEach((c, i) => check(c as unknown as Item | null, seen.get(ids[i])!.version));
        const orders = renormalize(ids);
        ids.forEach((id, i) =>
          tx.update(P.doc(tripId, 'items', id), { order: orders.get(id), version: (curs[i] as unknown as Item).version + 1, updatedBy: uid, updatedAt: SERVER_TIME }));
        return;
      }
      const path = P.doc(tripId, 'items', itemId);
      const nIds = [plan.prevId, plan.nextId].filter(Boolean) as string[];
      const [cur, ...ns] = await Promise.all([tx.get(path), ...nIds.map((id) => tx.get(P.doc(tripId, 'items', id)))]);
      const c = check(cur as unknown as Item | null, seen.get(itemId)!.version);
      ns.forEach((n, i) => {
        const s = seen.get(nIds[i])!;
        if (!n || n.order !== s.order || n.dayId !== s.dayId) throw new ConflictError(n, '상대가 방금 순서를 바꿨어요. 최신 순서를 보고 다시 옮겨 주세요');
      });
      tx.update(path, { order: plan.order, version: c.version + 1, updatedBy: uid, updatedAt: SERVER_TIME });
    }),
  );
}

/** 다른 날짜(또는 후보 장소 = null) 맨 끝으로. dayId·order 를 한 문서에서 함께 바꿔 원자적 */
export async function moveToDay(tripId: string, uid: string, item: Item, target: string | null, sortedTarget: Item[]) {
  return track(target ? '날짜 이동 중' : '후보로 옮기는 중', () =>
    store.transaction(async (tx) => {
      const path = P.doc(tripId, 'items', item.id);
      check(await tx.get(path) as unknown as Item | null, item.version);
      tx.update(path, { dayId: target, order: orderAtEnd(sortedTarget), version: item.version + 1, updatedBy: uid, updatedAt: SERVER_TIME });
    }),
  );
}

/** 체크 항목 하나만 뒤집기 — 서버 최신 목록 기준이라 둘이 동시에 다른 항목을 체크해도 덮어쓰지 않음 */
export async function toggleCheck(tripId: string, uid: string, itemId: string, entryId: string) {
  return track('체크 저장 중', () =>
    store.transaction(async (tx) => {
      const path = P.doc(tripId, 'items', itemId);
      const cur = (await tx.get(path)) as unknown as Item | null;
      if (!cur) throw new ConflictError(null, '다른 사람이 이미 삭제한 항목이에요');
      const list = (cur.checklist ?? []).map((c) => (c.id === entryId ? { ...c, done: !c.done } : c));
      tx.update(path, { checklist: list, version: cur.version + 1, updatedBy: uid, updatedAt: SERVER_TIME });
    }),
  );
}

// ───────── 이동 정보 ─────────
export type LegInput = Omit<Leg, 'id' | 'updatedBy' | 'updatedAt' | 'version'>;

export async function saveLeg(tripId: string, uid: string, data: LegInput, baseVersion: number | null) {
  return track('이동 정보 저장 중', () =>
    store.transaction(async (tx) => {
      const id = legId(data.fromId, data.toId);
      const path = P.doc(tripId, 'legs', id);
      const cur = (await tx.get(path)) as unknown as Leg | null;
      if (baseVersion === null) {
        if (cur) throw new ConflictError(cur, '상대가 방금 이 구간을 입력했어요. 확인 후 다시 저장해 주세요');
        tx.set(path, { ...data, id, version: 1, updatedBy: uid, updatedAt: SERVER_TIME });
      } else {
        check(cur, baseVersion, '이동 정보');
        tx.update(path, { ...data, version: baseVersion + 1, updatedBy: uid, updatedAt: SERVER_TIME });
      }
    }),
  );
}
export const deleteLeg = (tripId: string, id: string) => track('이동 정보 삭제 중', () => store.batch([{ type: 'delete', path: P.doc(tripId, 'legs', id) }]));

// ───────── 예약 ─────────
export type BookingInput = Omit<Booking, 'id' | 'createdBy' | 'updatedBy' | 'updatedAt' | 'version'>;

/**
 * 예약 저장. 항공 예약은 일정 타임라인의 항공편 카드(kind=flight)와 자동으로 연결된다(데이터는 예약 하나).
 * 출발 날짜가 여행 날짜에 있으면 그 날짜로, 없으면 후보로.
 */
export async function saveBooking(tripId: string, uid: string, data: BookingInput, existing: Booking | null, bundle: TripBundle) {
  return track('예약 저장 중', () =>
    store.transaction(async (tx) => {
      const id = existing?.id ?? store.newId();
      const path = P.doc(tripId, 'bookings', id);
      if (existing) {
        const cur = check((await tx.get(path)) as unknown as Booking | null, existing.version, '예약');
        tx.update(path, { ...data, version: cur.version + 1, updatedBy: uid, updatedAt: SERVER_TIME });
      } else {
        tx.set(path, { ...data, id, createdBy: uid, createdAt: SERVER_TIME, updatedBy: uid, updatedAt: SERVER_TIME, version: 1 });
      }
      const flightItems = bundle.items.filter((i) => i.kind === 'flight' && i.bookingIds[0] === id);
      const dayIds = new Set(bundle.days.map((d) => d.date));
      if (data.type === 'flight' && data.flight) {
        const target = dayIds.has(data.flight.depDate) ? data.flight.depDate : null;
        const targetItems = sortItems(bundle.items.filter((i) => i.dayId === target));
        if (flightItems.length === 0) {
          const iid = store.newId();
          // 같은 날 이미 있는 일정 중 출발 시각보다 늦은 첫 항목 앞에 끼워 넣음 (없으면 맨 끝)
          const idx = targetItems.findIndex((i) => i.time && data.flight!.depTime && i.time > data.flight!.depTime);
          const order = idx < 0 ? orderAtEnd(targetItems) : orderBetween(targetItems[idx - 1]?.order, targetItems[idx].order) ?? orderAtEnd(targetItems);
          tx.set(P.doc(tripId, 'items', iid), { ...blankItem(uid), id: iid, kind: 'flight', category: 'transport', dayId: target, order, time: data.flight.depTime || null, bookingIds: [id] });
        } else {
          for (const fi of flightItems) {
            const patch: Data = { time: data.flight.depTime || null, version: fi.version + 1, updatedBy: uid, updatedAt: SERVER_TIME };
            if (fi.dayId !== target) Object.assign(patch, { dayId: target, order: orderAtEnd(targetItems) });
            tx.update(P.doc(tripId, 'items', fi.id), patch);
          }
        }
      } else {
        for (const fi of flightItems) tx.delete(P.doc(tripId, 'items', fi.id));
      }
      return id;
    }),
  );
}

export async function deleteBooking(tripId: string, uid: string, booking: Booking, bundle: TripBundle) {
  return track('예약 삭제 중', async () => {
    const ops: Op[] = [{ type: 'delete', path: P.doc(tripId, 'bookings', booking.id) }];
    for (const it of bundle.items) {
      if (!it.bookingIds.includes(booking.id)) continue;
      if (it.kind === 'flight') ops.push({ type: 'delete', path: P.doc(tripId, 'items', it.id) });
      else ops.push({ type: 'update', path: P.doc(tripId, 'items', it.id), data: { bookingIds: it.bookingIds.filter((b) => b !== booking.id), version: it.version + 1, updatedBy: uid, updatedAt: SERVER_TIME } });
    }
    const usedElsewhere = new Set(bundle.bookings.filter((b) => b.id !== booking.id).flatMap((b) => b.fileIds));
    for (const fid of booking.fileIds) if (!usedElsewhere.has(fid)) ops.push(...(await fileDeleteOps(tripId, fid)));
    await store.batch(ops);
  });
}

/** 일정 ↔ 예약 연결/해제 */
export async function setItemBookings(tripId: string, uid: string, item: Item, bookingIds: string[]) {
  return updateItem(tripId, uid, item.id, item.version, { bookingIds });
}

// ───────── 파일 (Firestore 청크 저장) ─────────
export const CHUNK_SIZE = 700 * 1024;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function splitChunks(u8: Uint8Array, size = CHUNK_SIZE): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < u8.length; i += size) out.push(u8.subarray(i, Math.min(u8.length, i + size)));
  if (out.length === 0) out.push(new Uint8Array(0));
  return out;
}
export function joinChunks(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function fileOps(tripId: string, uid: string, fid: string, blob: Blob, name: string, mime: string, thumb: string, pages: number): Promise<Op[]> {
  const u8 = new Uint8Array(await blob.arrayBuffer());
  const parts = splitChunks(u8);
  const ops: Op[] = parts.map((p, n) => ({ type: 'set', path: P.chunk(tripId, fid, n), data: { n, data: store.bytes(p) } }));
  ops.push({
    type: 'set', path: P.doc(tripId, 'files', fid),
    data: { id: fid, name: name.slice(0, 120), mime, size: u8.length, pages, thumb, chunkCount: parts.length, complete: true, uploadedBy: uid, uploadedAt: SERVER_TIME },
  });
  return ops;
}

/**
 * 파일 업로드. 메타(미완성) → 청크를 하나씩 → 메타 완료 순서. 중간에 실패하면 만든 청크를 지운다.
 */
export async function uploadFile(tripId: string, uid: string, blob: Blob, name: string, mime: string, thumb: string, pages: number, onProgress?: (p: number) => void): Promise<string> {
  if (blob.size > MAX_FILE_BYTES) throw new Error(`파일이 너무 커요 (최대 ${MAX_FILE_BYTES / 1024 / 1024}MB)`);
  return track('파일 올리는 중', async () => {
    const fid = store.newId();
    const u8 = new Uint8Array(await blob.arrayBuffer());
    const parts = splitChunks(u8);
    const meta = P.doc(tripId, 'files', fid);
    await store.batch([{ type: 'set', path: meta, data: { id: fid, name: name.slice(0, 120), mime, size: u8.length, pages, thumb, chunkCount: parts.length, complete: false, uploadedBy: uid, uploadedAt: SERVER_TIME } }]);
    try {
      for (let n = 0; n < parts.length; n++) {
        await store.batch([{ type: 'set', path: P.chunk(tripId, fid, n), data: { n, data: store.bytes(parts[n]) } }]);
        onProgress?.((n + 1) / parts.length);
      }
      await store.batch([{ type: 'update', path: meta, data: { complete: true } }]);
      return fid;
    } catch (e) {
      await store.batch(await fileDeleteOps(tripId, fid, parts.length)).catch(() => undefined);
      throw e;
    }
  }, 180000);
}

async function fileDeleteOps(tripId: string, fid: string, knownCount?: number): Promise<Op[]> {
  const ops: Op[] = [];
  if (knownCount !== undefined) for (let n = 0; n < knownCount; n++) ops.push({ type: 'delete', path: P.chunk(tripId, fid, n) });
  else {
    const chunks = await store.getCol(`${P.col(tripId, 'files')}/${fid}/chunks`);
    chunks.forEach((c) => ops.push({ type: 'delete', path: `${P.col(tripId, 'files')}/${fid}/chunks/${c.id}` }));
  }
  ops.push({ type: 'delete', path: P.doc(tripId, 'files', fid) });
  return ops;
}

export async function readFileBytes(tripId: string, meta: FileMeta): Promise<Uint8Array> {
  const docs = await store.getCol(`${P.col(tripId, 'files')}/${meta.id}/chunks`);
  if (docs.length < meta.chunkCount) throw new Error('파일 일부를 받지 못했어요. 연결을 확인해 주세요');
  const sorted = docs.sort((a, b) => num(a.data.n) - num(b.data.n));
  return joinChunks(sorted.map((d) => store.readBytes(d.data.data)));
}

export async function deleteFile(tripId: string, fid: string) {
  return track('파일 삭제 중', async () => store.batch(await fileDeleteOps(tripId, fid)));
}

// ───────── 가계부 ─────────
export type ExpenseInput = Omit<Expense, 'id' | 'createdBy' | 'updatedBy' | 'updatedAt' | 'version'>;

export async function saveExpense(tripId: string, uid: string, data: ExpenseInput, existing: Expense | null) {
  return track('지출 저장 중', () =>
    store.transaction(async (tx) => {
      if (existing) {
        const path = P.doc(tripId, 'expenses', existing.id);
        const cur = check((await tx.get(path)) as unknown as Expense | null, existing.version, '지출');
        tx.update(path, { ...data, version: cur.version + 1, updatedBy: uid, updatedAt: SERVER_TIME });
        return existing.id;
      }
      const id = store.newId();
      tx.set(P.doc(tripId, 'expenses', id), { ...data, id, createdBy: uid, createdAt: SERVER_TIME, updatedBy: uid, updatedAt: SERVER_TIME, version: 1 });
      return id;
    }),
  );
}
export const deleteExpense = (tripId: string, id: string) => track('지출 삭제 중', () => store.batch([{ type: 'delete', path: P.doc(tripId, 'expenses', id) }]));

// ───────── 준비물 ─────────
export async function addPacking(tripId: string, uid: string, text: string, owner: string, sorted: PackingItem[]) {
  return track('준비물 추가 중', () =>
    store.batch([{
      type: 'set', path: P.doc(tripId, 'packing', store.newId()),
      data: { text: text.trim().slice(0, 100), owner, done: false, order: orderAtEnd(sorted), updatedBy: uid, updatedAt: SERVER_TIME, version: 1 },
    }]).then(() => undefined),
  );
}
export async function updatePacking(tripId: string, uid: string, p: PackingItem, patch: Partial<Pick<PackingItem, 'text' | 'owner'>>) {
  return track('준비물 저장 중', () =>
    store.transaction(async (tx) => {
      const path = P.doc(tripId, 'packing', p.id);
      const cur = check((await tx.get(path)) as unknown as PackingItem | null, p.version, '준비물');
      tx.update(path, { ...patch, version: cur.version + 1, updatedBy: uid, updatedAt: SERVER_TIME });
    }),
  );
}
/** 토글은 최신 값 기준으로 뒤집음(버전 무관) — 둘이 동시에 다른 항목을 눌러도 서로 영향 없음 */
export async function togglePacking(tripId: string, uid: string, id: string) {
  return track('체크 저장 중', () =>
    store.transaction(async (tx) => {
      const path = P.doc(tripId, 'packing', id);
      const cur = (await tx.get(path)) as unknown as PackingItem | null;
      if (!cur) throw new ConflictError(null, '이미 삭제된 준비물이에요');
      tx.update(path, { done: !cur.done, version: cur.version + 1, updatedBy: uid, updatedAt: SERVER_TIME });
    }),
  );
}
export const deletePacking = (tripId: string, id: string) => track('준비물 삭제 중', () => store.batch([{ type: 'delete', path: P.doc(tripId, 'packing', id) }]));

export async function movePacking(tripId: string, uid: string, sorted: PackingItem[], id: string, toIndex: number) {
  const plan = reorderWithinDay(sorted, id, toIndex);
  if (!plan) return;
  const cur = sorted.find((p) => p.id === id)!;
  if (plan.order === null) {
    const ids = sorted.map((p) => p.id).filter((x) => x !== id);
    ids.splice(toIndex, 0, id);
    const orders = renormalize(ids);
    const ver = new Map(sorted.map((p) => [p.id, p.version]));
    return track('순서 저장 중', () =>
      store.batch(ids.map((x) => ({ type: 'update' as const, path: P.doc(tripId, 'packing', x), data: { order: orders.get(x), version: (ver.get(x) ?? 1) + 1, updatedBy: uid, updatedAt: SERVER_TIME } }))));
  }
  return track('순서 저장 중', () =>
    store.batch([{ type: 'update', path: P.doc(tripId, 'packing', id), data: { order: plan.order, version: cur.version + 1, updatedBy: uid, updatedAt: SERVER_TIME } }]));
}

/** 지난 여행 준비물 복사 (완료 상태는 초기화, 담당자가 이 여행 멤버가 아니면 '공동') */
export async function copyPacking(fromTripId: string, toTripId: string, uid: string, memberUids: string[], existing: PackingItem[]) {
  return track('준비물 복사 중', async () => {
    const src = (await store.getCol(P.col(fromTripId, 'packing'))).map((d) => cast<PackingItem>(d.id, d.data));
    let tail = orderAtEnd(existing);
    const have = new Set(existing.map((p) => p.text.trim()));
    const ops: Op[] = [];
    for (const p of sortItems(src)) {
      if (have.has(p.text.trim())) continue;
      ops.push({
        type: 'set', path: P.doc(toTripId, 'packing', store.newId()),
        data: { text: p.text, owner: memberUids.includes(p.owner) ? p.owner : 'shared', done: false, order: tail, updatedBy: uid, updatedAt: SERVER_TIME, version: 1 },
      });
      tail += 1000;
    }
    await store.batch(ops);
    return ops.length;
  });
}

// ───────── 구독 ─────────
export type TripWatch =
  | { status: 'loading' }
  | { status: 'denied' }
  | { status: 'notfound' }
  | { status: 'ready'; bundle: TripBundle; live: boolean; pending: boolean };

export function watchTrip(tripId: string, cb: (w: TripWatch) => void): Unsub {
  let trip: Trip | null = null;
  let gone = false;
  let denied = false;
  const parts: Record<string, Doc[] | undefined> = {};
  const cache: Record<string, boolean> = {};
  const pend: Record<string, boolean> = {};
  const emit = () => {
    if (denied) return cb({ status: 'denied' });
    if (gone) return cb({ status: 'notfound' });
    if (!trip || SUBS.some((s) => !parts[s])) return cb({ status: 'loading' });
    const map = <T,>(s: string, f: (id: string, d: Data) => T) => (parts[s] ?? []).map((d) => f(d.id, d.data));
    cb({
      status: 'ready',
      live: !Object.values(cache).some(Boolean),
      pending: Object.values(pend).some(Boolean),
      bundle: {
        trip,
        members: map('members', (id, d) => cast<Member>(id, d)).map((m) => ({ ...m, uid: m.uid || (m as unknown as { id: string }).id })),
        days: map('days', (id, d) => ({ date: id, index: num(d.index), city: str(d.city) })).sort((a, b) => a.index - b.index),
        items: map('items', toItem),
        legs: map('legs', (id, d) => cast<Leg>(id, d)),
        bookings: map('bookings', (id, d) => ({ ...blankBookingShape, ...cast<Booking>(id, d) })),
        files: map('files', (id, d) => cast<FileMeta>(id, d)),
        expenses: map('expenses', (id, d) => cast<Expense>(id, d)),
        packing: map('packing', (id, d) => cast<PackingItem>(id, d)),
      },
    });
  };
  const onErr = (e: unknown) => {
    if ((e as { code?: string })?.code === 'permission-denied') {
      denied = true;
      emit();
    }
  };
  const unsubs: Unsub[] = [
    store.watchDoc(P.trip(tripId), (d, m) => {
      cache.trip = m.fromCache;
      pend.trip = m.pending;
      if (!d) {
        if (!m.fromCache) gone = true;
      } else {
        gone = false;
        trip = toTrip(tripId, d);
      }
      emit();
    }, onErr),
    ...SUBS.map((s) =>
      store.watchCol(P.col(tripId, s), (docs, m) => {
        parts[s] = docs;
        cache[s] = m.fromCache;
        pend[s] = m.pending;
        emit();
      }, onErr)),
  ];
  return () => unsubs.forEach((u) => u());
}
const blankBookingShape = { startDate: null, startTime: null, endDate: null, endTime: null, reservationNo: '', memo: '', flight: null, fileIds: [] };

export function watchMyTrips(uid: string, cb: (rows: { trip: Trip; role: Role; memberCount: number }[] | null, err?: string) => void): Unsub {
  let inner: Unsub[] = [];
  const outer = store.watchGroup('members', 'uid', uid, async (docs) => {
    inner.forEach((u) => u());
    inner = [];
    const active = docs.filter((d) => d.data.status === 'active');
    const rows = new Map<string, { trip: Trip; role: Role; memberCount: number }>();
    if (active.length === 0) return cb([]);
    const emit = () => cb([...rows.values()]);
    for (const d of active) {
      const tripId = d.id.split('/')[1];
      const role = d.data.role as Role;
      let trip: Trip | null = null;
      let count = 1;
      const push = () => {
        if (trip) rows.set(tripId, { trip, role, memberCount: count });
        if (rows.size === active.length || trip) emit();
      };
      inner.push(store.watchDoc(P.trip(tripId), (td) => {
        if (td) trip = toTrip(tripId, td);
        else rows.delete(tripId);
        push();
      }, () => undefined));
      inner.push(store.watchCol(P.col(tripId, 'members'), (ms) => {
        count = ms.filter((m) => m.data.status === 'active').length;
        push();
      }, () => undefined));
    }
  }, (e) => cb(null, (e as Error).message));
  return () => {
    outer();
    inner.forEach((u) => u());
  };
}

export function watchInvites(tripId: string, cb: (inv: Invite[]) => void): Unsub {
  return store.watchCol(P.col(tripId, 'invites'), (docs) => cb(docs.map((d) => ({ ...(d.data as unknown as Invite), token: d.id }))), () => cb([]));
}

export const tripPaths = P;
export type { FlightInfo };

// ───────── JSON 일정 가져오기 ─────────
/**
 * 가져온 일정을 날짜별로 기존 일정 뒤에 붙인다. 날짜마다 한 묶음(batch)으로 저장해
 * 상대 화면에는 한 날짜씩 통째로 나타난다. 이동 정보는 같은 날 앞뒤 '장소' 사이에만 만든다.
 */
/** 교체 모드에서 지워질 기존 일정 (JSON 에 들어 있는 날짜만, 항공편 카드는 예약과 연결돼 있어 남김) */
export function replaceTargets(plan: import('../lib/importPlan').ImportPlan, byDay: Map<string | null, Item[]>): Item[] {
  return plan.days.flatMap((d) => (byDay.get(d.dayId) ?? []).filter((i) => i.kind !== 'flight'));
}

export async function importPlanItems(
  tripId: string,
  uid: string,
  plan: import('../lib/importPlan').ImportPlan,
  byDay: Map<string | null, Item[]>,
  days: Day[],
  opts: { replace?: boolean; legs?: Map<string, Leg> } = {},
) {
  return track(opts.replace ? '일정 바꾸는 중' : '일정 가져오는 중', async () => {
    let added = 0;
    for (const d of plan.days) {
      const ops: Op[] = [];
      let existing = byDay.get(d.dayId) ?? [];
      if (opts.replace) {
        // 같은 묶음 안에서 지우고 새로 넣어 상대 화면에 '빈 날짜'가 잠깐도 보이지 않게
        const gone = new Set(existing.filter((i) => i.kind !== 'flight').map((i) => i.id));
        for (const id of gone) ops.push({ type: 'delete', path: P.doc(tripId, 'items', id) });
        for (const l of opts.legs?.values() ?? []) if (gone.has(l.fromId) || gone.has(l.toId)) ops.push({ type: 'delete', path: P.doc(tripId, 'legs', l.id) });
        existing = existing.filter((i) => !gone.has(i.id));
      }
      let order = orderAtEnd(existing);
      const placed: { id: string; it: (typeof d.items)[number] }[] = [];
      for (const it of d.items) {
        const id = store.newId();
        ops.push({
          type: 'set',
          path: P.doc(tripId, 'items', id),
          data: {
            ...blankItem(uid), id, dayId: d.dayId, order,
            kind: it.kind, category: it.category, tag: it.tag, time: it.time, memo: it.memo, place: it.place, bookingIds: [], checklist: it.checklist,
          },
        });
        order += 1000;
        placed.push({ id, it });
      }
      if (d.dayId) {
        const places = placed.filter((p) => p.it.kind === 'place');
        for (let i = 0; i < places.length - 1; i++) {
          const leg = places[i].it.legToNext ?? places[i + 1].it.legFromPrev;
          if (!leg) continue;
          const fromId = places[i].id;
          const toId = places[i + 1].id;
          ops.push({
            type: 'set',
            path: P.doc(tripId, 'legs', legId(fromId, toId)),
            data: {
              id: legId(fromId, toId), fromId, toId, mode: leg.mode, durationMin: leg.durationMin, distanceM: leg.distanceM,
              fareAmount: leg.fareAmount, fareCurrency: leg.fareCurrency, memo: leg.memo, source: 'manual',
              geometry: null, routedAt: null, routedFrom: null, routedTo: null, version: 1, updatedBy: uid, updatedAt: SERVER_TIME,
            },
          });
        }
        const day = days.find((x) => x.date === d.dayId);
        if (d.city && day && day.city !== d.city) ops.push({ type: 'update', path: P.doc(tripId, 'days', d.dayId), data: { city: d.city } });
      }
      await store.batch(ops);
      added += d.items.length;
    }
    return added;
  });
}

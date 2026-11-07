import type { Item, Leg } from './types';

/** 방문 순서 정렬: order 오름차순, 같으면 id (동시 편집으로 같은 값이 생겨도 두 기기에서 동일한 순서 보장) */
export function sortItems<T extends Pick<Item, 'order' | 'id'>>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** 날짜별로 1부터 다시 시작하는 방문 번호. 장소(kind=place)만 번호를 받는다. 메모·항공편은 번호 없음. */
export function numberPlaces(sortedDayItems: Pick<Item, 'id' | 'kind'>[]): Map<string, number> {
  const m = new Map<string, number>();
  let n = 0;
  for (const it of sortedDayItems) if (it.kind === 'place') m.set(it.id, ++n);
  return m;
}

const MIN_GAP = 1e-6;

/** 두 정렬값 사이의 새 값. 간격이 너무 좁으면 null(→ 그 날짜 전체 재정렬 필요) */
export function orderBetween(prev: number | undefined, next: number | undefined): number | null {
  if (prev === undefined && next === undefined) return 1000;
  if (prev === undefined) return (next as number) - 1000;
  if (next === undefined) return prev + 1000;
  if (next - prev < MIN_GAP * 2) return null;
  return (prev + next) / 2;
}

/**
 * 같은 날짜 안에서 itemId 를 toIndex 위치로 옮길 때의 새 정렬값.
 * 반환값의 neighbors 는 트랜잭션에서 "내가 본 이웃 순서가 그대로인지" 확인하는 데 쓴다.
 */
export function reorderWithinDay(
  sortedDayItems: Pick<Item, 'id' | 'order'>[],
  itemId: string,
  toIndex: number,
): { order: number | null; prevId?: string; nextId?: string } | undefined {
  const from = sortedDayItems.findIndex((i) => i.id === itemId);
  if (from < 0) return undefined;
  const rest = sortedDayItems.filter((i) => i.id !== itemId);
  const idx = Math.max(0, Math.min(toIndex, rest.length));
  if (idx === from) return undefined; // 변화 없음
  const prev = rest[idx - 1];
  const next = rest[idx];
  return { order: orderBetween(prev?.order, next?.order), prevId: prev?.id, nextId: next?.id };
}

/** 다른 날짜 맨 끝으로 이동할 때의 정렬값 */
export function orderAtEnd(sortedDayItems: Pick<Item, 'order'>[]): number {
  const last = sortedDayItems[sortedDayItems.length - 1];
  return last ? last.order + 1000 : 1000;
}

/** 간격이 바닥났을 때 사용할 균등 재배치 값 (원자적 batch 로 한 번에 기록) */
export function renormalize(sortedIds: string[]): Map<string, number> {
  return new Map(sortedIds.map((id, i) => [id, (i + 1) * 1000]));
}

// ───────── 거리 (직선거리만. 실제 경로 거리는 계산하지 않음) ─────────

export interface LatLng {
  lat: number;
  lng: number;
}

export function hasCoords(p: { lat: number | null; lng: number | null } | null | undefined): p is LatLng {
  return !!p && typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function formatStraightDistance(m: number): string {
  if (m < 1000) return `직선 ${Math.round(m)}m`;
  if (m < 100000) return `직선 ${(m / 1000).toFixed(1)}km`;
  return `직선 ${Math.round(m / 1000)}km`;
}

// ───────── 지도 모델 (Leaflet 지도와 대체 순서도가 같은 계산을 공유) ─────────

export interface MarkerEntry {
  itemId: string;
  dayId: string;
  num: number;
  name: string;
}
export interface MarkerGroup {
  key: string;
  lat: number;
  lng: number;
  entries: MarkerEntry[]; // 같은 좌표 재방문(예: 호텔 출발·복귀)은 한 핀에 번호를 모두 표시
}
export interface Segment {
  dayId: string;
  fromId: string;
  toId: string;
  fromNum: number;
  toNum: number;
  from: LatLng;
  to: LatLng;
  meters: number; // 직선거리
  leg: Leg | null;
}
export interface MapModel {
  groups: MarkerGroup[];
  segments: Segment[];
  missing: MarkerEntry[]; // 위치 미지정 장소
  gapNotes: string[];
}

const coordKey = (p: LatLng) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;

/**
 * days: 표시할 날짜들(각각 정렬된 항목). 날짜끼리는 절대 연결하지 않는다.
 * 연결선은 '번호 n → n+1' 둘 다 좌표가 있을 때만. 중간이 비면 건너뛰어 잇지 않는다.
 * 이동 정보(leg)는 앞뒤 장소 ID 쌍으로 찾아 붙인다.
 */
export function buildMapModel(days: { dayId: string; items: Item[] }[], legs: Map<string, Leg> = new Map()): MapModel {
  const groupMap = new Map<string, MarkerGroup>();
  const segments: Segment[] = [];
  const missing: MarkerEntry[] = [];
  const gapNotes: string[] = [];

  for (const day of days) {
    const nums = numberPlaces(day.items);
    const places = day.items.filter((i) => i.kind === 'place');
    places.forEach((it, idx) => {
      const entry: MarkerEntry = { itemId: it.id, dayId: day.dayId, num: nums.get(it.id)!, name: it.place?.nameKo ?? '' };
      if (hasCoords(it.place)) {
        const k = coordKey(it.place);
        const g = groupMap.get(k) ?? { key: k, lat: it.place.lat, lng: it.place.lng, entries: [] };
        g.entries.push(entry);
        groupMap.set(k, g);
      } else {
        missing.push(entry);
      }
      const next = places[idx + 1];
      if (!next) return;
      const a = it.place;
      const b = next.place;
      if (hasCoords(a) && hasCoords(b)) {
        if (coordKey(a) !== coordKey(b)) {
          segments.push({
            dayId: day.dayId,
            fromId: it.id,
            toId: next.id,
            fromNum: entry.num,
            toNum: nums.get(next.id)!,
            from: { lat: a.lat, lng: a.lng },
            to: { lat: b.lat, lng: b.lng },
            meters: haversineMeters(a, b),
            leg: legs.get(`${it.id}__${next.id}`) ?? null,
          });
        }
      } else {
        gapNotes.push(`${day.dayId}: ${entry.num}→${nums.get(next.id)} 연결 생략 (위치 미지정)`);
      }
    });
  }
  return { groups: [...groupMap.values()], segments, missing, gapNotes };
}

/** 연속된 두 '장소' 쌍 (이동 정보는 장소 사이에만. 메모·항공편 카드는 건너뜀) */
export function placePairs(sortedDay: Item[]): [Item, Item][] {
  const places = sortedDay.filter((i) => i.kind === 'place');
  const out: [Item, Item][] = [];
  for (let i = 0; i + 1 < places.length; i++) out.push([places[i], places[i + 1]]);
  return out;
}

import { describe, expect, it } from 'vitest';
import {
  buildMapModel,
  formatStraightDistance,
  haversineMeters,
  numberPlaces,
  orderAtEnd,
  orderBetween,
  reorderWithinDay,
  renormalize,
  sortItems,
} from '../../src/lib/order';
import { dateRange, flightMinutes, weekdayKo, zonedToUtc } from '../../src/lib/time';
import { sampleSeed, SAMPLE_TRIP } from '../../src/lib/sample';
import type { Item } from '../../src/lib/types';
import { emptyPlace } from '../../src/lib/types';

let seq = 0;
function place(name: string, order: number, lat: number | null = null, lng: number | null = null, dayId = 'd1'): Item {
  return {
    id: `id${++seq}`, dayId, order, kind: 'place', category: 'sight', tag: '', time: null, memo: '',
    place: { ...emptyPlace(), nameKo: name, lat, lng, coordSource: lat == null ? null : 'user' },
    bookingIds: [], checklist: [], createdBy: 'u', updatedBy: 'u', version: 1,
  };
}
const memo = (order: number, dayId = 'd1'): Item => ({ ...place('m', order, null, null, dayId), kind: 'memo', place: null, memo: '메모' });

describe('방문 순서·번호', () => {
  it('번호는 장소에만, 날짜마다 1부터 (메모·항공편 제외)', () => {
    const items = sortItems([memo(1), place('A', 2), place('B', 3), { ...memo(4), kind: 'flight' as const }, place('C', 5)]);
    const n = numberPlaces(items);
    expect([...n.values()]).toEqual([1, 2, 3]);
    expect(n.get(items[0].id)).toBeUndefined();
  });
  it('정렬값이 같으면 id 로 결정 → 두 기기에서 동일', () => {
    const a = { id: 'b', order: 5 };
    const b = { id: 'a', order: 5 };
    expect(sortItems([a, b]).map((x) => x.id)).toEqual(['a', 'b']);
    expect(sortItems([b, a]).map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('시간 값은 순서에 영향 없음 (order 만 사용)', () => {
    const x = { ...place('late', 1), time: '23:00' };
    const y = { ...place('early', 2), time: '08:00' };
    expect(sortItems([y, x]).map((i) => i.place!.nameKo)).toEqual(['late', 'early']);
  });
  it('중간 삽입·끝 삽입·간격 소진', () => {
    expect(orderBetween(1000, 2000)).toBe(1500);
    expect(orderBetween(undefined, 1000)).toBe(0);
    expect(orderBetween(1000, undefined)).toBe(2000);
    expect(orderBetween(1, 1 + 1e-7)).toBeNull();
    expect(orderAtEnd([{ order: 3000 }])).toBe(4000);
    expect([...renormalize(['x', 'y']).values()]).toEqual([1000, 2000]);
  });
  it('reorderWithinDay: 아래/위 이동 결과가 의도한 위치', () => {
    const list = [1, 2, 3, 4].map((o) => ({ id: `n${o}`, order: o * 1000 }));
    const down = reorderWithinDay(list, 'n1', 2)!; // n1 → index 2 (n2,n3,[n1],n4)
    expect(down.prevId).toBe('n3');
    expect(down.nextId).toBe('n4');
    expect(down.order).toBe(3500);
    const up = reorderWithinDay(list, 'n4', 0)!;
    expect(up.nextId).toBe('n1');
    expect(up.order).toBe(0);
    expect(reorderWithinDay(list, 'n2', 1)).toBeUndefined();
  });
});

describe('지도 모델', () => {
  it('같은 호텔 재방문은 한 핀에 번호 2개, 연결선은 순서대로', () => {
    const items = sortItems([place('호텔', 1, 36.06, 120.38), place('A', 2, 36.07, 120.39), place('호텔', 3, 36.06, 120.38)]);
    const m = buildMapModel([{ dayId: 'd1', items }]);
    expect(m.groups).toHaveLength(2);
    const hotel = m.groups.find((g) => g.entries.length === 2)!;
    expect(hotel.entries.map((e) => e.num)).toEqual([1, 3]);
    expect(m.segments.map((s) => `${s.fromNum}-${s.toNum}`)).toEqual(['1-2', '2-3']);
  });
  it('위치 미지정 장소: 핀 없음, 앞뒤 연결 생략(건너뛰어 잇지 않음)', () => {
    const items = sortItems([place('A', 1, 36, 120), place('B(없음)', 2), place('C', 3, 36.01, 120.01)]);
    const m = buildMapModel([{ dayId: 'd1', items }]);
    expect(m.missing.map((x) => x.num)).toEqual([2]);
    expect(m.segments).toHaveLength(0);
    expect(m.gapNotes).toHaveLength(2);
  });
  it('전체 보기: 날짜 사이는 연결하지 않음', () => {
    const d1 = sortItems([place('A', 1, 36, 120, 'd1'), place('B', 2, 36.01, 120, 'd1')]);
    const d2 = sortItems([place('C', 1, 37, 121, 'd2'), place('D', 2, 37.01, 121, 'd2')]);
    const m = buildMapModel([{ dayId: 'd1', items: d1 }, { dayId: 'd2', items: d2 }]);
    expect(m.segments.map((s) => `${s.dayId}:${s.fromNum}-${s.toNum}`)).toEqual(['d1:1-2', 'd2:1-2']);
  });
  it('여러 날짜에 같은 호텔이 있어도 번호가 사라지지 않음', () => {
    const d1 = [place('호텔', 1, 36, 120, 'd1')];
    const d2 = [place('호텔', 1, 36, 120, 'd2')];
    const m = buildMapModel([{ dayId: 'd1', items: d1 }, { dayId: 'd2', items: d2 }]);
    expect(m.groups).toHaveLength(1);
    expect(m.groups[0].entries.map((e) => e.dayId)).toEqual(['d1', 'd2']);
  });
  it('직선거리 표기', () => {
    const d = haversineMeters({ lat: 37.5665, lng: 126.978 }, { lat: 35.1796, lng: 129.0756 });
    expect(d / 1000).toBeGreaterThan(320);
    expect(d / 1000).toBeLessThan(330);
    expect(formatStraightDistance(193)).toBe('직선 193m');
    expect(formatStraightDistance(1100)).toBe('직선 1.1km');
  });
});

describe('시간대', () => {
  it('요일', () => {
    expect(weekdayKo('2026-11-08')).toBe('일');
    expect(weekdayKo('2026-11-10')).toBe('화');
    expect(dateRange('2026-11-08', '2026-11-10')).toEqual(['2026-11-08', '2026-11-09', '2026-11-10']);
  });
  it('현지시각 → UTC', () => {
    expect(new Date(zonedToUtc('2026-11-08', '07:20', 'Asia/Seoul')).toISOString()).toBe('2026-11-07T22:20:00.000Z');
    expect(new Date(zonedToUtc('2026-11-08', '08:15', 'Asia/Shanghai')).toISOString()).toBe('2026-11-08T00:15:00.000Z');
  });
  it('각 공항 시간대로 비행시간 계산', () => {
    expect(flightMinutes({ depDate: '2026-11-08', depTime: '07:20', depTz: 'Asia/Seoul', arrDate: '2026-11-08', arrTime: '08:15', arrTz: 'Asia/Shanghai' })).toBe(115);
    expect(flightMinutes({ depDate: '2026-11-10', depTime: '17:10', depTz: 'Asia/Shanghai', arrDate: '2026-11-10', arrTime: '19:40', arrTz: 'Asia/Seoul' })).toBe(90);
  });
});

describe('사진 기반 샘플', () => {
  it('좌표를 지어내지 않음 · 기간 내 날짜만 · 규칙 제약 충족', () => {
    const seed = sampleSeed();
    const days = new Set(dateRange(SAMPLE_TRIP.startDate, SAMPLE_TRIP.endDate));
    const bookingKeys = new Set(seed.bookings!.map((b) => b.key));
    for (const { dayId, item } of seed.items!) {
      expect(dayId && days.has(dayId)).toBe(true);
      if (item.place) {
        expect(item.place.lat).toBeNull();
        expect(item.place.nameKo.length).toBeGreaterThan(0);
      }
      if (item.time) expect(item.time).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      expect((item.memo ?? '').length).toBeLessThanOrEqual(2000);
      if (item.kind === 'memo') expect(item.memo!.length).toBeGreaterThan(0);
      if (item.kind === 'flight') expect(bookingKeys.has(item.bookingIds![0])).toBe(true);
    }
    const perDay = (d: string) => seed.items!.filter((x) => x.dayId === d && x.item.kind === 'place').length;
    expect([perDay('2026-11-08'), perDay('2026-11-09'), perDay('2026-11-10')]).toEqual([12, 11, 6]);
    expect(seed.expenses ?? []).toEqual([]); // 금액은 지어내지 않음
  });
});

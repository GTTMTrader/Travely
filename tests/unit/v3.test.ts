import { describe, expect, it } from 'vitest';
import { decodePolyline, encodePolyline, thinPoints } from '../../src/lib/geo';
import { joinChunks, planDateChange, splitChunks, CHUNK_SIZE } from '../../src/data/repo';
import { legSummary, routeFresh } from '../../src/lib/legs';
import { buildMapModel, sortItems } from '../../src/lib/order';
import type { Day, Item, Leg } from '../../src/lib/types';
import { emptyPlace } from '../../src/lib/types';
import { handle, parseCoord, parseOrs } from '../../worker/src/index';

const item = (id: string, dayId: string | null, order: number, lat: number | null = null, lng: number | null = null): Item => ({
  id, dayId, order, kind: 'place', category: 'sight', tag: '', time: null, memo: '',
  place: { ...emptyPlace(), nameKo: id, lat, lng, coordSource: lat == null ? null : 'pin' },
  bookingIds: [], checklist: [], createdBy: 'u', updatedBy: 'u', version: 3,
});
const leg = (from: string, to: string, o: Partial<Leg> = {}): Leg => ({
  id: `${from}__${to}`, fromId: from, toId: to, mode: 'taxi', durationMin: 18, distanceM: 5200, fareAmount: 25, fareCurrency: 'CNY', memo: '',
  source: 'manual', geometry: null, routedAt: null, routedFrom: null, routedTo: null, updatedBy: 'u', version: 1, ...o,
});

describe('경로 모양 (polyline)', () => {
  it('인코딩/디코딩 왕복 (소수 5자리)', () => {
    const pts: [number, number][] = [[36.06712, 120.38261], [36.0705, 120.3901], [36.06, 120.31]];
    expect(decodePolyline(encodePolyline(pts))).toEqual(pts);
    expect(encodePolyline([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]])).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  });
  it('점이 많으면 처음·끝 유지하며 줄임', () => {
    const pts = Array.from({ length: 1000 }, (_, i) => [i, i] as [number, number]);
    const t = thinPoints(pts, 100);
    expect(t).toHaveLength(100);
    expect(t[0]).toEqual([0, 0]);
    expect(t[99]).toEqual([999, 999]);
  });
});

describe('이동 정보', () => {
  const a = item('a', 'd1', 1000, 36.06, 120.38);
  const b = item('b', 'd1', 2000, 36.07, 120.39);
  it('조회 당시 좌표와 같을 때만 실제 경로선', () => {
    const l = leg('a', 'b', { source: 'route', geometry: encodePolyline([[36.06, 120.38], [36.07, 120.39]]), routedFrom: '36.06000,120.38000', routedTo: '36.07000,120.39000' });
    expect(routeFresh(l, a, b)).toBe(true);
    const moved = { ...b, place: { ...b.place!, lat: 36.08 } };
    expect(routeFresh(l, a, moved)).toBe(false); // 장소를 옮기면 점선(순서선)으로 돌아감
    expect(routeFresh({ ...l, geometry: null }, a, b)).toBe(false);
  });
  it('요약 문구', () => {
    expect(legSummary(leg('a', 'b'), a, b).text).toContain('🚕 택시 · 약 18분 · 5.2km · 약 ¥25');
    expect(legSummary(null, a, b).empty).toBe(true);
  });
  it('지도 모델에 앞뒤 장소 쌍으로 이동 정보가 붙음', () => {
    const m = buildMapModel([{ dayId: 'd1', items: sortItems([a, b]) }], new Map([['a__b', leg('a', 'b')]]));
    expect(m.segments[0].leg?.mode).toBe('taxi');
  });
});

describe('파일 조각 저장', () => {
  it('700KB 조각으로 나누고 다시 합치면 원본과 같음', () => {
    const u8 = new Uint8Array(CHUNK_SIZE * 2 + 123).map((_, i) => i % 251);
    const parts = splitChunks(u8);
    expect(parts.map((p) => p.length)).toEqual([CHUNK_SIZE, CHUNK_SIZE, 123]);
    expect(joinChunks(parts)).toEqual(u8);
    expect(CHUNK_SIZE).toBeLessThan(750000); // 보안 규칙 한도 아래
  });
});

describe('여행 기간 변경', () => {
  it('줄이면 사라지는 날짜의 일정은 후보 장소 끝으로, 도시는 유지', () => {
    const days: Day[] = [
      { date: '2026-11-08', index: 0, city: '칭다오' },
      { date: '2026-11-09', index: 1, city: '칭다오 → 옌타이' },
      { date: '2026-11-10', index: 2, city: '옌타이' },
    ];
    const items = [item('x', '2026-11-10', 1000), item('y', '2026-11-10', 2000), item('c', null, 1000), item('k', '2026-11-08', 1000)];
    const p = planDateChange(days, items, '2026-11-08', '2026-11-09', '칭다오');
    expect(p.removed).toEqual(['2026-11-10']);
    expect(p.itemMoves).toEqual([{ id: 'x', version: 3, order: 2000 }, { id: 'y', version: 3, order: 3000 }]);
    expect(p.days.map((d) => [d.date, d.city, d.isNew])).toEqual([['2026-11-08', '칭다오', false], ['2026-11-09', '칭다오 → 옌타이', false]]);
    const longer = planDateChange(days, items, '2026-11-07', '2026-11-10', '칭다오');
    expect(longer.days.map((d) => d.index)).toEqual([0, 1, 2, 3]);
    expect(longer.days[0]).toMatchObject({ date: '2026-11-07', isNew: true, city: '칭다오' });
  });
});

describe('중계 서버 /route', () => {
  const env = { ORS_API_KEY: 'ors-secret', FIREBASE_PROJECT_ID: 'p', ALLOWED_ORIGINS: 'https://me.github.io' };
  const ors = { features: [{ properties: { summary: { distance: 5234.5, duration: 1080 } }, geometry: { coordinates: [[120.38, 36.06], [120.385, 36.065], [120.39, 36.07]] } }] };
  it('좌표 검사', () => {
    expect(parseCoord('36.06,120.38')).toEqual([36.06, 120.38]);
    expect(parseCoord('91,0')).toBeNull();
    expect(parseCoord('abc')).toBeNull();
    expect(parseOrs(ors)?.coords[0]).toEqual([36.06, 120.38]);
  });
  it('로그인 필요, 키는 서버에서만 붙이고 [lat,lng]로 돌려줌', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const deps = {
      verify: async (t: string) => { if (t !== 'good') throw new Error('bad'); return 'u1'; },
      fetch: async (url: string, init?: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify(ors), { status: 200 }); },
      cache: undefined,
    };
    const url = 'https://w.dev/route?profile=driving-car&from=36.06,120.38&to=36.07,120.39';
    expect((await handle(new Request(url), env, deps)).status).toBe(401);
    expect(calls).toHaveLength(0);
    const r = await handle(new Request(url, { headers: { Authorization: 'Bearer good', Origin: 'https://me.github.io' } }), env, deps);
    expect(r.status).toBe(200);
    expect(r.headers.get('Access-Control-Allow-Origin')).toBe('https://me.github.io');
    const j = await r.json() as { distanceM: number; durationS: number; coords: [number, number][] };
    expect(j.distanceM).toBe(5234.5);
    expect(j.coords).toHaveLength(3);
    expect(calls[0].url).toContain('/v2/directions/driving-car?start=120.38%2C36.06&end=120.39%2C36.07');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('ors-secret');
    expect(calls[0].url).not.toContain('ors-secret');
    // 잘못된 수단 → 400, 키 없음 → 503
    expect((await handle(new Request(url.replace('driving-car', 'transit'), { headers: { Authorization: 'Bearer good' } }), env, deps)).status).toBe(400);
    expect((await handle(new Request(url, { headers: { Authorization: 'Bearer good' } }), { ...env, ORS_API_KEY: undefined }, deps)).status).toBe(503);
  });
});

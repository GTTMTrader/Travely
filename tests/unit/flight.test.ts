import { describe, expect, it, vi } from 'vitest';
import { normalizeFlightNo, parseAeroDataBox, splitLocal } from '../../src/lib/flightParse';
import { handle, type Env } from '../../worker/src/index';

/**
 * 응답 예시는 AeroDataBox 응답 구조를 본떠 손으로 만든 것(실제 조회 결과 아님).
 * 실제 응답 형식 검증은 키를 넣고 배포한 뒤 확인해야 함 (README '미검증' 참고).
 */
const sample = [
  {
    number: 'LJ 841',
    status: 'Expected',
    codeshareStatus: 'IsOperator',
    airline: { name: 'Jin Air', iata: 'LJ' },
    departure: { airport: { iata: 'ICN', shortName: 'Incheon', timeZone: 'Asia/Seoul' }, scheduledTime: { utc: '2026-11-07 22:20Z', local: '2026-11-08 07:20+09:00' }, terminal: '2' },
    arrival: { airport: { iata: 'TAO', shortName: 'Jiaodong', timeZone: 'Asia/Shanghai' }, scheduledTime: { utc: '2026-11-08 00:15Z', local: '2026-11-08 08:15+08:00' }, revisedTime: { local: '2026-11-08 08:35+08:00' } },
  },
  {
    number: 'XX 9001',
    codeshareStatus: 'IsCodeshared',
    airline: { name: 'Codeshare Air' },
    departure: { airport: { iata: 'ICN', timeZone: 'Asia/Seoul' }, scheduledTimeLocal: '2026-11-08 07:20+09:00' },
    arrival: { airport: { iata: 'TAO', timeZone: 'Asia/Shanghai' }, scheduledTimeLocal: '2026-11-08 08:15+08:00' },
  },
  {
    number: 'LJ 841',
    departure: { airport: { iata: 'ICN', timeZone: 'Asia/Seoul' }, scheduledTime: { local: '2026-11-09 07:20+09:00' } },
    arrival: { airport: { iata: 'TAO', timeZone: 'Asia/Shanghai' }, scheduledTime: { local: '2026-11-09 08:15+08:00' } },
  },
];

describe('편명 조회 파서', () => {
  it('편명 정규화', () => {
    expect(normalizeFlightNo('lj 841')).toBe('LJ841');
    expect(normalizeFlightNo('7C-1101')).toBe('7C1101');
    expect(normalizeFlightNo('841')).toBeNull();
    expect(normalizeFlightNo('LJ84123')).toBeNull();
  });
  it('현지 시각 문자열', () => {
    expect(splitLocal('2026-11-08 07:20+09:00')).toEqual({ date: '2026-11-08', time: '07:20' });
    expect(splitLocal('2026-11-08T17:10:00+08:00')).toEqual({ date: '2026-11-08', time: '17:10' });
    expect(splitLocal(null)).toBeNull();
  });
  it('요청 날짜 출발편만, 운항사 편 우선, 변경 시각 분리', () => {
    const r = parseAeroDataBox(sample, 'LJ841', '2026-11-08', 1);
    expect(r).toHaveLength(2);
    expect(r[0].flightNo).toBe('LJ841');
    expect(r[0].isOperator).toBe(true);
    expect(r[0].dep).toMatchObject({ code: 'ICN', tz: 'Asia/Seoul', date: '2026-11-08', time: '07:20', terminal: '2', revisedTime: null });
    expect(r[0].arr).toMatchObject({ code: 'TAO', tz: 'Asia/Shanghai', time: '08:15', revisedTime: '08:35' });
    expect(r[1].isOperator).toBe(false);
  });
  it('해당 날짜 편이 없으면 빈 결과', () => {
    expect(parseAeroDataBox(sample, 'LJ841', '2026-11-10')).toEqual([]);
    expect(parseAeroDataBox({ message: 'x' }, 'LJ841', '2026-11-08')).toEqual([]);
  });
});

describe('중계 서버', () => {
  const env: Env = { RAPIDAPI_KEY: 'k', FIREBASE_PROJECT_ID: 'p', ALLOWED_ORIGINS: 'https://app.test' };
  const req = (q: string, token?: string) =>
    new Request(`https://w.test/flight?${q}`, { headers: { Origin: 'https://app.test', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });

  it('토큰 없으면 401, 잘못된 토큰도 401, API 호출 안 함', async () => {
    const f = vi.fn();
    const deps = { verify: async () => { throw new Error('bad'); }, fetch: f, cache: undefined };
    expect((await handle(req('number=LJ841&date=2026-11-08'), env, deps)).status).toBe(401);
    expect((await handle(req('number=LJ841&date=2026-11-08', 'bad'), env, deps)).status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });
  it('로그인 사용자: 키를 헤더로 붙여 호출, 정규화된 결과 + CORS', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(sample), { status: 200 }));
    const res = await handle(req('number=lj841&date=2026-11-08', 't'), env, { verify: async () => 'uid', fetch: f, cache: undefined });
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.test');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/flights/number/LJ841/2026-11-08');
    expect((init.headers as Record<string, string>)['X-RapidAPI-Key']).toBe('k');
    const body = await res.json();
    expect(body[0].dep.time).toBe('07:20');
  });
  it('결과 없음(204) → 404, 형식 오류 → 400', async () => {
    const deps = { verify: async () => 'uid', fetch: async () => new Response(null, { status: 204 }), cache: undefined };
    expect((await handle(req('number=LJ841&date=2026-11-08', 't'), env, deps)).status).toBe(404);
    expect((await handle(req('number=841&date=2026-11-08', 't'), env, deps)).status).toBe(400);
  });
});

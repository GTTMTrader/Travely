/**
 * 항공편 조회 결과 정규화 (의존성 없음 — 앱과 중계 서버(worker)가 같이 씀).
 * 원본: AeroDataBox `GET /flights/number/{편명}/{현지날짜}` 응답(배열).
 * 시간 필드는 신형 { scheduledTime: { local, utc } } 과 구형 { scheduledTimeLocal } 둘 다 처리.
 */

export interface FlightEnd {
  code: string; // IATA (없으면 ICAO)
  name: string;
  tz: string; // IANA
  date: string; // YYYY-MM-DD (현지)
  time: string; // HH:mm (현지, 예정)
  revisedDate: string | null; // 변경된 예정 시각 (있을 때만)
  revisedTime: string | null;
  terminal: string | null;
}

export interface FlightLookup {
  flightNo: string; // 'LJ841'
  airline: string;
  status: string; // 원본 상태값 (Expected, Delayed, Canceled …)
  dep: FlightEnd;
  arr: FlightEnd;
  isOperator: boolean; // 공동운항이면 false
  source: string;
  fetchedAt: number;
}

/** 'lj 841' → 'LJ841'. 형식이 이상하면 null */
export function normalizeFlightNo(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[\s-]/g, '');
  return /^([A-Z]{2}|[A-Z][0-9]|[0-9][A-Z]|[A-Z]{3})[0-9]{1,4}[A-Z]?$/.test(s) ? s : null;
}

/** '2026-11-08 07:20+09:00' / '2026-11-08T07:20:00+09:00' → { date, time } (현지 표기 그대로) */
export function splitLocal(v: unknown): { date: string; time: string } | null {
  if (typeof v !== 'string') return null;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
  return m ? { date: m[1], time: `${m[2]}:${m[3]}` } : null;
}

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function end(raw: Raw | undefined): FlightEnd | null {
  if (!raw) return null;
  const ap: Raw = raw.airport ?? {};
  const sched = splitLocal(raw.scheduledTime?.local ?? raw.scheduledTimeLocal);
  if (!sched) return null;
  const rev = splitLocal(raw.revisedTime?.local ?? raw.revisedTimeLocal);
  const changed = rev && (rev.date !== sched.date || rev.time !== sched.time);
  return {
    code: String(ap.iata ?? ap.icao ?? ''),
    name: String(ap.shortName ?? ap.municipalityName ?? ap.name ?? ''),
    tz: String(ap.timeZone ?? ''),
    date: sched.date,
    time: sched.time,
    revisedDate: changed ? rev!.date : null,
    revisedTime: changed ? rev!.time : null,
    terminal: raw.terminal ? String(raw.terminal) : null,
  };
}

/**
 * 응답 배열에서 요청 날짜에 '출발'하는 편을 고른다. 운항사 편(IsOperator)을 우선.
 * 맞는 편이 없으면 빈 배열.
 */
export function parseAeroDataBox(body: unknown, flightNo: string, date: string, fetchedAt = Date.now()): FlightLookup[] {
  const list: Raw[] = Array.isArray(body) ? body : [];
  const out: FlightLookup[] = [];
  for (const f of list) {
    const dep = end(f.departure);
    const arr = end(f.arrival);
    if (!dep || !arr) continue;
    out.push({
      flightNo: normalizeFlightNo(String(f.number ?? flightNo)) ?? flightNo,
      airline: String(f.airline?.name ?? ''),
      status: String(f.status ?? ''),
      dep,
      arr,
      isOperator: f.codeshareStatus ? f.codeshareStatus !== 'IsCodeshared' : true,
      source: 'AeroDataBox',
      fetchedAt,
    });
  }
  const onDate = out.filter((x) => x.dep.date === date);
  const pool = onDate.length ? onDate : [];
  return pool.sort((a, b) => Number(b.isOperator) - Number(a.isOperator));
}

const STATUS_KO: Record<string, string> = {
  Expected: '예정', Scheduled: '예정', EnRoute: '비행 중', CheckIn: '체크인 중', Boarding: '탑승 중',
  GateClosed: '탑승 마감', Departed: '출발함', Delayed: '지연', Approaching: '도착 임박', Arrived: '도착함',
  Canceled: '결항', Cancelled: '결항', Diverted: '회항', CanceledUncertain: '결항 가능성', Unknown: '알 수 없음',
};
export const statusKo = (s: string) => STATUS_KO[s] ?? s;

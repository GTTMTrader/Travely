const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

/** 'YYYY-MM-DD' → 요일 (날짜 문자열 자체의 요일. 기기 시간대 영향 없음) */
export function weekdayKo(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function shortDate(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}.${d}`;
}

export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const [y, m, d] = start.split('-').map(Number);
  const cur = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < 60; i++) {
    const s = cur.toISOString().slice(0, 10);
    if (s > end) break;
    out.push(s);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function tripPeriodLabel(start: string, end: string): string {
  const [y1, m1, d1] = start.split('-').map(Number);
  const [y2, m2, d2] = end.split('-').map(Number);
  return y1 === y2 ? `${y1}.${m1}.${d1} – ${m2}.${d2}` : `${y1}.${m1}.${d1} – ${y2}.${m2}.${d2}`;
}

/** 특정 시간대에서 해당 시각의 UTC 오프셋(분) */
export function tzOffsetMinutes(timeZone: string, utcMs: number): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - utcMs) / 60000);
}

/** 현지 날짜·시각 + 시간대 → UTC ms */
export function zonedToUtc(date: string, time: string, timeZone: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off1 = tzOffsetMinutes(timeZone, guess - 0);
  const t1 = guess - off1 * 60000;
  const off2 = tzOffsetMinutes(timeZone, t1);
  return guess - off2 * 60000;
}

/** 출발·도착 각 현지시각과 시간대로 실제 비행 시간(분). 입력이 불완전하면 null */
export function flightMinutes(f: {
  depDate: string;
  depTime: string;
  depTz: string;
  arrDate: string;
  arrTime: string;
  arrTz: string;
}): number | null {
  if (!f.depDate || !f.depTime || !f.depTz || !f.arrDate || !f.arrTime || !f.arrTz) return null;
  try {
    const mins = Math.round((zonedToUtc(f.arrDate, f.arrTime, f.arrTz) - zonedToUtc(f.depDate, f.depTime, f.depTz)) / 60000);
    return mins > 0 && mins < 24 * 60 ? mins : null;
  } catch {
    return null;
  }
}

export function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? (r ? `${h}시간 ${r}분` : `${h}시간`) : `${r}분`;
}

export const TZ_LABEL: Record<string, string> = {
  'Asia/Seoul': '한국시간',
  'Asia/Shanghai': '중국시간',
  'Asia/Tokyo': '일본시간',
  'Asia/Taipei': '대만시간',
  'Asia/Hong_Kong': '홍콩시간',
  'Asia/Bangkok': '태국시간',
  'Asia/Ho_Chi_Minh': '베트남시간',
  'Asia/Singapore': '싱가포르시간',
  'UTC': 'UTC',
};
export const tzLabel = (tz: string) => TZ_LABEL[tz] ?? tz;

/** 자주 쓰는 공항 코드 → 시간대 (입력 편의용 기본값. 사용자가 바꿀 수 있음) */
export const AIRPORT_TZ: Record<string, string> = {
  ICN: 'Asia/Seoul', GMP: 'Asia/Seoul', PUS: 'Asia/Seoul', CJU: 'Asia/Seoul', TAE: 'Asia/Seoul', CJJ: 'Asia/Seoul',
  TAO: 'Asia/Shanghai', YNT: 'Asia/Shanghai', PVG: 'Asia/Shanghai', SHA: 'Asia/Shanghai', PEK: 'Asia/Shanghai',
  PKX: 'Asia/Shanghai', CAN: 'Asia/Shanghai', SZX: 'Asia/Shanghai', DLC: 'Asia/Shanghai', SHE: 'Asia/Shanghai',
  HKG: 'Asia/Hong_Kong', TPE: 'Asia/Taipei', NRT: 'Asia/Tokyo', HND: 'Asia/Tokyo', KIX: 'Asia/Tokyo', FUK: 'Asia/Tokyo',
  BKK: 'Asia/Bangkok', SGN: 'Asia/Ho_Chi_Minh', DAD: 'Asia/Ho_Chi_Minh', SIN: 'Asia/Singapore',
};
export const TZ_OPTIONS = Object.keys(TZ_LABEL).filter((t) => t !== 'UTC');

export function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** '11/13 (금)' */
export function shortDateDow(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d} (${weekdayKo(date)})`;
}
/** '11/13' */
export function mdSlash(date: string): string {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
}
/** 기기 기준 오늘 'YYYY-MM-DD' */
export function todayLocal(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
export function nowHHMM(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(now.getHours())}:${p(now.getMinutes())}`;
}

/** 여행지 시간대 기준 지금 날짜·시각 */
export function nowInZone(tz: string, now = new Date()): { date: string; hhmm: string } {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(now)
        .map((p) => [p.type, p.value]),
    );
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hhmm: `${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}` };
  } catch {
    return { date: todayLocal(now), hhmm: nowHHMM(now) };
  }
}

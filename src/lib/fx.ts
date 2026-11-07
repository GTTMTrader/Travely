import type { Currency } from './types';

/**
 * 원화 환율 (무료, 키·카드 불필요). 하루 1회 갱신되는 공개 기준 환율이라 '실시간'은 아니다.
 * 1순위 Frankfurter(유럽중앙은행 기준), 안 되면 open.er-api.com. 마지막 값은 기기에 보관해 오프라인에서도 계산.
 */
export interface FxRate {
  from: Currency;
  rate: number; // 1 from = rate KRW
  date: string; // 제공처 기준일
  fetchedAt: number;
  source: string;
}

const KEY = 'travely:fx:';
const TTL = 6 * 3600 * 1000;

function readCache(c: Currency): FxRate | null {
  try {
    const v = localStorage.getItem(KEY + c);
    return v ? (JSON.parse(v) as FxRate) : null;
  } catch {
    return null;
  }
}
function writeCache(r: FxRate) {
  try {
    localStorage.setItem(KEY + r.from, JSON.stringify(r));
  } catch {
    /* 저장 불가 환경 */
  }
}

async function getJson(url: string, ms = 6000): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const PROVIDERS: { name: string; fetch: (c: Currency) => Promise<{ rate: number; date: string }> }[] = [
  {
    name: 'Frankfurter(ECB)',
    fetch: async (c) => {
      const j = await getJson(`https://api.frankfurter.dev/v1/latest?base=${c}&symbols=KRW`);
      return { rate: Number(j.rates?.KRW), date: String(j.date ?? '') };
    },
  },
  {
    name: 'ExchangeRate-API',
    fetch: async (c) => {
      const j = await getJson(`https://open.er-api.com/v6/latest/${c}`);
      const d = j.time_last_update_unix ? new Date(j.time_last_update_unix * 1000).toISOString().slice(0, 10) : '';
      return { rate: Number(j.rates?.KRW), date: d };
    },
  },
];

/** 캐시가 신선하면 캐시, 아니면 조회. 모두 실패하면 오래된 캐시라도 반환, 없으면 null */
export async function getKrwRate(c: Currency, force = false): Promise<FxRate | null> {
  if (c === 'KRW') return { from: 'KRW', rate: 1, date: '', fetchedAt: Date.now(), source: '' };
  const cached = readCache(c);
  if (!force && cached && Date.now() - cached.fetchedAt < TTL) return cached;
  for (const p of PROVIDERS) {
    try {
      const { rate, date } = await p.fetch(c);
      if (rate > 0 && Number.isFinite(rate)) {
        const r: FxRate = { from: c, rate, date, fetchedAt: Date.now(), source: p.name };
        writeCache(r);
        return r;
      }
    } catch {
      /* 다음 제공처 */
    }
  }
  return cached;
}

export const cachedKrwRate = (c: Currency) => (c === 'KRW' ? null : readCache(c));

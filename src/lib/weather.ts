/**
 * 날씨: Open-Meteo (무료, 키 없음). 예보 가능 범위(오늘~16일 뒤) 안의 날짜만 표시.
 * 같은 도시·날짜는 3시간 동안 기기에 보관.
 */
export interface DayWeather {
  date: string;
  tMin: number;
  tMax: number;
  code: number;
}

const KEY = 'travely:wx:';
const TTL = 3 * 3600 * 1000;

export function weatherIcon(code: number): string {
  if (code === 0) return '☀️';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code <= 48) return '🌫️';
  if (code <= 67 || (code >= 80 && code <= 82)) return '🌧️';
  if (code <= 77 || code === 85 || code === 86) return '🌨️';
  return '⛈️';
}

export function inForecastRange(date: string, today = new Date()): boolean {
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const [y, m, d] = date.split('-').map(Number);
  const diff = (Date.UTC(y, m - 1, d) - t) / 86400000;
  return diff >= 0 && diff <= 15;
}

export async function fetchWeather(lat: number, lng: number, dates: string[]): Promise<Map<string, DayWeather>> {
  const want = dates.filter((d) => inForecastRange(d)).sort();
  const out = new Map<string, DayWeather>();
  if (want.length === 0) return out;
  const key = `${KEY}${lat.toFixed(2)},${lng.toFixed(2)}:${want[0]}:${want[want.length - 1]}`;
  try {
    const c = localStorage.getItem(key);
    if (c) {
      const j = JSON.parse(c) as { at: number; list: DayWeather[] };
      if (Date.now() - j.at < TTL) {
        j.list.forEach((w) => out.set(w.date, w));
        return out;
      }
    }
  } catch {
    /* 무시 */
  }
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lng), daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    timezone: 'auto', start_date: want[0], end_date: want[want.length - 1],
  });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal: ctrl.signal });
    if (!r.ok) return out;
    const j = await r.json();
    const d = j.daily ?? {};
    const list: DayWeather[] = (d.time ?? []).map((date: string, i: number) => ({
      date, tMin: Math.round(d.temperature_2m_min[i]), tMax: Math.round(d.temperature_2m_max[i]), code: Number(d.weather_code[i]),
    }));
    list.forEach((w) => out.set(w.date, w));
    try {
      localStorage.setItem(key, JSON.stringify({ at: Date.now(), list }));
    } catch {
      /* 무시 */
    }
  } catch {
    /* 날씨는 실패해도 조용히 숨김 */
  } finally {
    clearTimeout(t);
  }
  return out;
}

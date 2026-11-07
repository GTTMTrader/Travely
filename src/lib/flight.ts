import { getAuth } from '../data/backend';
import type { FlightLookup } from './flightParse';
import { normalizeFlightNo } from './flightParse';

/** 편명 조회(선택 기능). 중계 서버에 AeroDataBox 키가 등록돼 있을 때만 VITE_FLIGHT_LOOKUP=true 로 켠다. */
const API = import.meta.env.VITE_WORKER_URL as string | undefined;
export const flightLookupConfigured = Boolean(API) && import.meta.env.VITE_FLIGHT_LOOKUP === 'true';

export async function lookupFlight(rawNo: string, date: string): Promise<FlightLookup[]> {
  if (!API) throw new Error('편명 조회 서버가 설정되지 않았어요');
  const no = normalizeFlightNo(rawNo);
  if (!no) throw new Error('편명 형식을 확인해 주세요 (예: LJ841)');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('출발 날짜를 먼저 입력해 주세요');
  const token = await getAuth().idToken();
  if (!token) throw new Error('로그인이 필요해요');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(`${API.replace(/\/$/, '')}/flight?number=${encodeURIComponent(no)}&date=${date}`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
    if (r.status === 404) return [];
    if (r.status === 429) throw new Error('조회 한도를 넘었어요. 직접 입력해 주세요');
    if (!r.ok) throw new Error(`조회 실패 (${r.status}). 직접 입력해 주세요`);
    return (await r.json()) as FlightLookup[];
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('조회 서버 응답이 없어요. 직접 입력해 주세요');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

import { getAuth } from '../data/backend';
import type { TravelMode } from './types';
import { encodePolyline, thinPoints } from './geo';

/**
 * 실제 경로 조회 (OpenRouteService). API 키는 중계 서버(worker/)에만 있고, 앱은 로그인 토큰으로 중계 서버를 부른다.
 * 도보·택시(자동차)만 지원. 대중교통·비행기는 직접 입력.
 */
const API = import.meta.env.VITE_WORKER_URL as string | undefined;
export const routeConfigured = Boolean(API);
export const ROUTABLE: Partial<Record<TravelMode, 'foot-walking' | 'driving-car'>> = { walk: 'foot-walking', taxi: 'driving-car' };

export interface RouteResult {
  distanceM: number;
  durationMin: number;
  geometry: string;
}

export async function fetchRoute(mode: TravelMode, from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<RouteResult> {
  const profile = ROUTABLE[mode];
  if (!profile) throw new Error('이 이동수단은 자동 조회를 지원하지 않아요. 직접 입력해 주세요');
  if (!API) throw new Error('경로 조회 서버가 설정되지 않았어요');
  const token = await getAuth().idToken();
  if (!token) throw new Error('로그인이 필요해요');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const q = new URLSearchParams({ profile, from: `${from.lat},${from.lng}`, to: `${to.lat},${to.lng}` });
    const r = await fetch(`${API.replace(/\/$/, '')}/route?${q}`, { headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal });
    if (r.status === 429) throw new Error('오늘 경로 조회 한도를 넘었어요. 직접 입력해 주세요');
    if (r.status === 404) throw new Error('두 장소 사이 경로를 찾지 못했어요');
    if (!r.ok) throw new Error(`경로 조회 실패 (${r.status})`);
    const j = (await r.json()) as { distanceM: number; durationS: number; coords: [number, number][] };
    return { distanceM: Math.round(j.distanceM), durationMin: Math.max(1, Math.round(j.durationS / 60)), geometry: encodePolyline(thinPoints(j.coords)) };
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('경로 조회 서버 응답이 없어요. 직접 입력해 주세요');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

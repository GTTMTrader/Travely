/**
 * Travely 중계 서버 (Cloudflare Workers 무료 플랜).
 *  - 외부 API 키를 앱 대신 보관한다. 키는 `npx wrangler secret put <이름>` 으로만 등록 (저장소에 절대 넣지 않음).
 *      ORS_API_KEY   : OpenRouteService (경로 조회, 무료 키) — 필수
 *      RAPIDAPI_KEY  : AeroDataBox (편명 조회) — 선택. 없으면 /flight 는 503
 *  - Travely 에 로그인한 사람(Firebase ID 토큰 검증)만 호출 가능 → 키 남용 방지.
 *  - 같은 요청은 캐시 (경로 7일, 편명 10분) → 무료 한도 절약.
 *
 *  GET /route?profile=foot-walking|driving-car&from=lat,lng&to=lat,lng
 *      → { distanceM, durationS, coords: [lat, lng][] }
 *  GET /flight?number=LJ841&date=2026-11-08
 *      → FlightLookup[]
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { normalizeFlightNo, parseAeroDataBox } from '../../src/lib/flightParse';

export interface Env {
  ORS_API_KEY?: string;
  RAPIDAPI_KEY?: string;
  RAPIDAPI_HOST?: string;
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGINS: string;
}

const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

export async function verifyFirebaseToken(token: string, projectId: string): Promise<string> {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  });
  if (!payload.sub) throw new Error('no sub');
  return payload.sub;
}

function cors(origin: string | null, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  return origin && allowed.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization', 'Access-Control-Allow-Methods': 'GET', Vary: 'Origin' }
    : {};
}

const PROFILES = ['foot-walking', 'driving-car'] as const;

/** "lat,lng" → [lat, lng] (범위 검사, 소수 6자리로 반올림해 캐시 키 안정화) */
export function parseCoord(s: string | null): [number, number] | null {
  if (!s) return null;
  const m = s.split(',').map((x) => Number(x.trim()));
  if (m.length !== 2 || !m.every(Number.isFinite)) return null;
  const [lat, lng] = m;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6];
}

/** ORS GeoJSON 응답 → 앱 형식 (좌표는 [lat, lng]) */
export function parseOrs(j: unknown): { distanceM: number; durationS: number; coords: [number, number][] } | null {
  const f = (j as { features?: { properties?: { summary?: { distance?: number; duration?: number } }; geometry?: { coordinates?: [number, number][] } }[] })?.features?.[0];
  const coords = f?.geometry?.coordinates;
  if (!f || !Array.isArray(coords) || coords.length < 2) return null;
  const s = f.properties?.summary ?? {};
  return {
    distanceM: Number(s.distance ?? 0),
    durationS: Number(s.duration ?? 0),
    coords: coords.map(([lng, lat]) => [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]),
  };
}

type Deps = { verify: typeof verifyFirebaseToken; fetch: (u: string, i?: RequestInit) => Promise<Response>; cache: Cache | undefined };
const defaultDeps = (): Deps => ({ verify: verifyFirebaseToken, fetch: (u, i) => fetch(u, i), cache: (globalThis as { caches?: { default?: Cache } }).caches?.default });

export async function handle(req: Request, env: Env, deps: Deps = defaultDeps()): Promise<Response> {
  const origin = req.headers.get('Origin');
  const headers = { 'Content-Type': 'application/json; charset=utf-8', ...cors(origin, env) };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const url = new URL(req.url);
  if (req.method !== 'GET' || !['/route', '/flight'].includes(url.pathname)) return json(404, { error: 'not found' });

  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return json(401, { error: '로그인이 필요해요' });
  try {
    await deps.verify(token, env.FIREBASE_PROJECT_ID);
  } catch {
    return json(401, { error: '로그인 정보가 유효하지 않아요' });
  }

  const cached = async (key: string, maxAge: number, produce: () => Promise<Response>) => {
    const cacheKey = new Request(`https://cache.local/${key}`);
    const hit = await deps.cache?.match(cacheKey);
    if (hit) return new Response(hit.body, { status: hit.status, headers });
    const res = await produce();
    if (res.status === 200) {
      const body = await res.clone().text();
      await deps.cache?.put(cacheKey, new Response(body, { status: 200, headers: { 'Cache-Control': `max-age=${maxAge}` } }));
    }
    return res;
  };

  // ───── 경로 ─────
  if (url.pathname === '/route') {
    if (!env.ORS_API_KEY) return json(503, { error: '경로 조회 키가 설정되지 않았어요' });
    const profile = url.searchParams.get('profile') as (typeof PROFILES)[number];
    const from = parseCoord(url.searchParams.get('from'));
    const to = parseCoord(url.searchParams.get('to'));
    if (!PROFILES.includes(profile) || !from || !to) return json(400, { error: '요청 형식 오류' });
    return cached(`route/${profile}/${from.join(',')}/${to.join(',')}`, 7 * 86400, async () => {
      const q = new URLSearchParams({ start: `${from[1]},${from[0]}`, end: `${to[1]},${to[0]}` });
      const up = await deps.fetch(`https://api.openrouteservice.org/v2/directions/${profile}?${q}`, {
        headers: { Authorization: env.ORS_API_KEY!, Accept: 'application/geo+json' },
      });
      if (up.status === 429) return json(429, { error: 'rate limited' });
      if (up.status === 404 || up.status === 400) return json(404, { error: '경로 없음' }); // 도로에서 너무 먼 지점 등
      if (!up.ok) return json(502, { error: `upstream ${up.status}` });
      const r = parseOrs(await up.json());
      return r ? json(200, r) : json(404, { error: '경로 없음' });
    });
  }

  // ───── 편명 ─────
  if (!env.RAPIDAPI_KEY) return json(503, { error: '편명 조회 키가 설정되지 않았어요' });
  const no = normalizeFlightNo(url.searchParams.get('number') ?? '');
  const date = url.searchParams.get('date') ?? '';
  if (!no || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(400, { error: '편명 또는 날짜 형식 오류' });
  return cached(`flight/${no}/${date}`, 600, async () => {
    const host = env.RAPIDAPI_HOST || 'aerodatabox.p.rapidapi.com';
    const up = await deps.fetch(`https://${host}/flights/number/${no}/${date}?withAircraftImage=false&withLocation=false`, {
      headers: { 'X-RapidAPI-Key': env.RAPIDAPI_KEY!, 'X-RapidAPI-Host': host },
    });
    if (up.status === 204 || up.status === 404) return json(404, []);
    if (up.status === 429) return json(429, { error: 'rate limited' });
    if (!up.ok) return json(502, { error: `upstream ${up.status}` });
    const result = parseAeroDataBox(await up.json(), no, date);
    return result.length ? json(200, result) : json(404, []);
  });
}

export default { fetch: (req: Request, env: Env) => handle(req, env) };

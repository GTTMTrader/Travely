/**
 * 장소 이름 검색: OpenStreetMap Nominatim (무료, 키 없음).
 * 이용 정책: 초당 1회 이하, 자동완성 금지 → 버튼을 눌렀을 때만 호출하고 1초 간격을 강제한다.
 */
export interface GeoResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

let lastCall = 0;

export async function searchPlace(q: string, near?: { lat: number; lng: number } | null): Promise<GeoResult[]> {
  const wait = 1100 - (Date.now() - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const params = new URLSearchParams({ q, format: 'jsonv2', limit: '8', 'accept-language': 'ko,zh,en', addressdetails: '0' });
  if (near) {
    const d = 0.6;
    params.set('viewbox', `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`);
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(String(r.status));
    const list = (await r.json()) as { name?: string; display_name: string; lat: string; lon: string }[];
    return list.map((x) => ({ name: x.name || x.display_name.split(',')[0], address: x.display_name, lat: Number(x.lat), lng: Number(x.lon) }));
  } catch {
    throw new Error('장소 검색 서버에 연결할 수 없어요. 지도에 핀을 찍거나 좌표를 직접 입력해 주세요');
  } finally {
    clearTimeout(t);
  }
}

// ───────── Google 방식 polyline 인코딩 (경로 모양 저장용, 정밀도 1e-5) ─────────
export function encodePolyline(points: [number, number][]): string {
  let out = '';
  let pLat = 0;
  let pLng = 0;
  const enc = (v: number) => {
    let s = v < 0 ? ~(v << 1) : v << 1;
    let r = '';
    while (s >= 0x20) {
      r += String.fromCharCode((0x20 | (s & 0x1f)) + 63);
      s >>= 5;
    }
    return r + String.fromCharCode(s + 63);
  };
  for (const [lat, lng] of points) {
    const a = Math.round(lat * 1e5);
    const b = Math.round(lng * 1e5);
    out += enc(a - pLat) + enc(b - pLng);
    pLat = a;
    pLng = b;
  }
  return out;
}

export function decodePolyline(s: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const dec = () => {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = s.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) {
    lat += dec();
    lng += dec();
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}

/** 경로 좌표가 너무 많으면 간단히 솎아냄 (저장 용량 절약) */
export function thinPoints(pts: [number, number][], max = 400): [number, number][] {
  if (pts.length <= max) return pts;
  const step = (pts.length - 1) / (max - 1);
  const out: [number, number][] = [];
  for (let k = 0; k < max; k++) out.push(pts[Math.round(k * step)]);
  return out;
}

export const coordKey = (p: { lat: number | null; lng: number | null } | null | undefined) =>
  p && p.lat != null && p.lng != null ? `${p.lat.toFixed(5)},${p.lng.toFixed(5)}` : null;

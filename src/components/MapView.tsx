import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import type { Item } from '../lib/types';
import { buildMapModel, hasCoords, type MapModel, type Segment } from '../lib/order';
import { decodePolyline } from '../lib/geo';
import { routeFresh } from '../lib/legs';
import { addTiles } from './leafletUtil';
import { dayColor } from './ui';
import { useTripCtx } from '../pages/TripLayout';

type Colorer = (dayId: string) => string;
export interface MapSel {
  itemId: string | null;
  seg: { fromId: string; toId: string } | null;
}

/** 경로가 조회된 구간이면 실제 길 좌표, 아니면 null */
function routePoints(s: Segment, items: Map<string, Item>): [number, number][] | null {
  const a = items.get(s.fromId);
  const b = items.get(s.toId);
  if (!a || !b || !s.leg?.geometry || !routeFresh(s.leg, a, b)) return null;
  try {
    const pts = decodePolyline(s.leg.geometry);
    return pts.length >= 2 ? pts : null;
  } catch {
    return null;
  }
}

function pinHtml(nums: { num: number; color: string }[], sel: boolean) {
  return `<div class="map-pin${sel ? ' on' : ''}" data-testid="map-pin">${nums.map((n) => `<span style="background:${n.color}">${n.num}</span>`).join('')}</div>`;
}

function LeafletMap({ model, cands, colorOf, sel, onSelect, fitKey, onFail }: {
  model: MapModel; cands: Item[]; colorOf: Colorer; sel: MapSel; onSelect: (s: MapSel) => void; fitKey: string; onFail: () => void;
}) {
  const c = useTripCtx();
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const itemsById = useMemo(() => new Map(c.bundle.items.map((i) => [i.id, i])), [c.bundle.items]);

  useEffect(() => {
    if (!ref.current) return;
    const city = c.bundle.trip.cities.find((x) => x.lat != null);
    const map = L.map(ref.current, { zoomControl: false }).setView([city?.lat ?? 36.07, city?.lng ?? 120.38], 12);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    addTiles(map, onFail);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 데이터·선택이 바뀔 때마다 다시 그림 → 친구가 순서를 바꿔도 즉시 반영
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const s of model.segments) {
      const color = colorOf(s.dayId);
      const pts = routePoints(s, itemsById);
      const isSel = sel.seg?.fromId === s.fromId && sel.seg?.toId === s.toId;
      const line = pts
        ? L.polyline(pts, { color, weight: isSel ? 8 : 5, opacity: 0.95 })
        : L.polyline([[s.from.lat, s.from.lng], [s.to.lat, s.to.lng]], { color, weight: isSel ? 6 : 4, opacity: 0.85, dashArray: '8 9' });
      line.on('click', () => onSelect({ itemId: null, seg: { fromId: s.fromId, toId: s.toId } }));
      layer.addLayer(line);
      // 방향 화살표 (구간 중간)
      const path = pts ?? [[s.from.lat, s.from.lng], [s.to.lat, s.to.lng]];
      const mid = Math.floor((path.length - 1) / 2);
      const p1 = path[mid];
      const p2 = path[Math.min(path.length - 1, mid + 1)];
      const m = map().latLngToLayerPoint(p1);
      const n = map().latLngToLayerPoint(p2);
      const ang = (Math.atan2(n.y - m.y, n.x - m.x) * 180) / Math.PI + 90;
      const at: [number, number] = path.length === 2 ? [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2] : p1;
      layer.addLayer(L.marker(at, {
        interactive: false,
        icon: L.divIcon({ className: '', html: `<div class="map-arrow" style="border-bottom-color:${color};transform:translate(-50%,-50%) rotate(${ang}deg)"></div>`, iconSize: [0, 0] }),
      }));
    }
    for (const g of model.groups) {
      const on = g.entries.some((e) => e.itemId === sel.itemId);
      const mk = L.marker([g.lat, g.lng], {
        zIndexOffset: on ? 1000 : 0,
        icon: L.divIcon({ className: '', html: pinHtml(g.entries.map((e) => ({ num: e.num, color: colorOf(e.dayId) })), on), iconSize: [0, 0] }),
        title: g.entries.map((e) => `${e.num}. ${e.name}`).join(', '),
      });
      mk.on('click', () => {
        const i = g.entries.findIndex((e) => e.itemId === sel.itemId);
        onSelect({ itemId: g.entries[(i + 1) % g.entries.length].itemId, seg: null });
      });
      layer.addLayer(mk);
    }
    for (const it of cands) {
      if (!hasCoords(it.place)) continue;
      const mk = L.marker([it.place.lat, it.place.lng], {
        icon: L.divIcon({ className: '', html: `<div class="map-pin cand${sel.itemId === it.id ? ' on' : ''}" data-testid="cand-pin"></div>`, iconSize: [0, 0] }),
        title: `후보: ${it.place.nameKo}`,
      });
      mk.on('click', () => onSelect({ itemId: it.id, seg: null }));
      layer.addLayer(mk);
    }
    function map() {
      return mapRef.current!;
    }
  }, [model, cands, sel, colorOf, onSelect, itemsById]);

  // 날짜를 바꾸면 방문지가 모두 보이게
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pts: [number, number][] = model.groups.map((g) => [g.lat, g.lng]);
    if (pts.length === 0) cands.forEach((i) => hasCoords(i.place) && pts.push([i.place.lat, i.place.lng]));
    if (pts.length === 1) map.setView(pts[0], 15);
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [50, 50] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // 선택한 장소로 이동
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !sel.itemId) return;
    const it = itemsById.get(sel.itemId);
    if (it && hasCoords(it.place) && !map.getBounds().contains([it.place.lat, it.place.lng])) map.panTo([it.place.lat, it.place.lng]);
  }, [sel.itemId, itemsById]);

  return <div ref={ref} style={{ width: '100%', height: '100%' }} data-testid="leaflet" />;
}

/** 지도 서버를 못 쓸 때: 좌표 관계만 그리는 간이 순서도 (실제 지도 아님) */
function Schematic({ model, colorOf, sel, onSelect }: { model: MapModel; colorOf: Colorer; sel: MapSel; onSelect: (s: MapSel) => void }) {
  const W = 1000;
  const H = 1000;
  const pad = 130;
  if (model.groups.length === 0) return null;
  const lats = model.groups.map((g) => g.lat);
  const lngs = model.groups.map((g) => g.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const k = Math.cos((midLat * Math.PI) / 180);
  const xs = lngs.map((l) => l * k);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...lats), maxY = Math.max(...lats);
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const scale = (W - pad * 2) / span;
  const ox = (W - (maxX - minX) * scale) / 2;
  const oy = (H - (maxY - minY) * scale) / 2;
  const P = (lat: number, lng: number) => ({ x: ox + (lng * k - minX) * scale, y: oy + (maxY - lat) * scale });
  const placed = model.groups.map((g) => {
    const p = P(g.lat, g.lng);
    return { g, x: p.x, y: p.y, ox: p.x, oy: p.y, w: 92 + (g.entries.length - 1) * 84 };
  });
  for (let iter = 0; iter < 60; iter++) {
    let moved = false;
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i], b = placed[j];
        const overlapX = (a.w + b.w) / 2 + 8 - Math.abs(b.x - a.x);
        const overlapY = 100 - Math.abs(b.y - a.y);
        if (overlapX > 0 && overlapY > 0) {
          moved = true;
          if (overlapY < overlapX) {
            const s = (b.y - a.y >= 0 ? 1 : -1) * (overlapY / 2 + 1);
            a.y -= s; b.y += s;
          } else {
            const s = (b.x - a.x >= 0 ? 1 : -1) * (overlapX / 2 + 1);
            a.x -= s; b.x += s;
          }
        }
      }
    if (!moved) break;
  }
  return (
    <svg className="schematic" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" data-testid="schematic">
      {model.segments.map((s, i) => {
        const a = P(s.from.lat, s.from.lng);
        const b = P(s.to.lat, s.to.lng);
        const mx = a.x + (b.x - a.x) * 0.55;
        const my = a.y + (b.y - a.y) * 0.55;
        const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        return (
          <g key={i} data-testid="schematic-seg" data-seg={`${s.dayId}:${s.fromNum}-${s.toNum}`} style={{ cursor: 'pointer' }}
            onClick={() => onSelect({ itemId: null, seg: { fromId: s.fromId, toId: s.toId } })}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={colorOf(s.dayId)} strokeWidth={9} strokeDasharray={s.leg?.geometry ? undefined : '28 18'} opacity={0.85} />
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={40} />
            <polygon points="-26,-22 30,0 -26,22" fill={colorOf(s.dayId)} transform={`translate(${mx} ${my}) rotate(${ang})`} />
          </g>
        );
      })}
      {placed.map(({ g, x, y, ox: tx, oy: ty, w }) => {
        const on = g.entries.some((e) => e.itemId === sel.itemId);
        return (
          <g key={g.key}>
            {Math.hypot(x - tx, y - ty) > 4 && <line x1={tx} y1={ty} x2={x} y2={y} stroke="#0006" strokeWidth={3} />}
            <g transform={`translate(${x} ${y})`} style={{ cursor: 'pointer' }} data-testid="map-pin"
              onClick={() => {
                const i = g.entries.findIndex((e) => e.itemId === sel.itemId);
                onSelect({ itemId: g.entries[(i + 1) % g.entries.length].itemId, seg: null });
              }}>
              <rect x={-w / 2} y={-46} width={w} height={92} rx={46} fill="#fff" stroke={on ? '#8b5cf6' : '#0002'} strokeWidth={on ? 12 : 3} />
              {g.entries.map((e, i) => (
                <g key={e.itemId} transform={`translate(${-w / 2 + 46 + i * 84} 0)`}>
                  <circle r={38} fill={colorOf(e.dayId)} />
                  <text textAnchor="middle" dy="15" fontSize="42" fontWeight="800" fill="#fff">{e.num}</text>
                </g>
              ))}
            </g>
          </g>
        );
      })}
    </svg>
  );
}

export default function MapView({ view, sel, onSelect }: { view: string; sel: MapSel; onSelect: (s: MapSel) => void }) {
  const c = useTripCtx();
  const [failed, setFailed] = useState(false);
  const days = view === 'all' ? c.bundle.days : c.bundle.days.filter((d) => d.date === view);
  const model = useMemo(
    () => buildMapModel(days.map((d) => ({ dayId: d.date, items: c.byDay.get(d.date) ?? [] })), c.legs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, c.byDay, c.legs, c.bundle.days],
  );
  const cands = c.byDay.get(null)?.filter((i) => i.kind === 'place') ?? [];
  const colorOf = useMemo<Colorer>(() => (dayId) => dayColor(c.dayIndex(dayId)).main, [c]);
  const hasRoute = model.segments.some((s) => s.leg?.geometry);

  return (
    <>
      <div className="map-wrap">
        <div className="map-legend">
          {hasRoute && <span className="ln"><i className="solid" />확정 동선(실제 경로)</span>}
          <span className="ln"><i className="dash" />방문 순서{hasRoute ? '' : ' (실제 경로 아님)'}</span>
          {cands.length > 0 && <span className="ln"><i className="cand" />후보 장소</span>}
          {view === 'all' && <span className="ln faint">날짜별 색 · 날짜끼리는 잇지 않음</span>}
        </div>
        {failed ? (
          <>
            <Schematic model={model} colorOf={colorOf} sel={sel} onSelect={onSelect} />
            <div className="tiny muted" style={{ position: 'absolute', left: 12, bottom: 10, right: 12, zIndex: 500 }} data-testid="fallback-note">
              지도를 불러올 수 없어 위치 관계만 그렸어요 (오프라인·지도 서버 차단). 일정은 그대로 볼 수 있어요.
            </div>
          </>
        ) : (
          <LeafletMap model={model} cands={cands} colorOf={colorOf} sel={sel} onSelect={onSelect} fitKey={view} onFail={() => setFailed(true)} />
        )}
        {model.groups.length === 0 && (
          <div className="center-msg" style={{ position: 'absolute', inset: '60px 0 0', zIndex: 450, pointerEvents: 'none' }}>
            지도에 표시할 위치가 아직 없어요.<br />장소를 눌러 ‘지도에서 핀 찍기’로 위치를 넣어 주세요.
          </div>
        )}
      </div>
      {model.missing.length > 0 && (
        <div className="missing-box" data-testid="missing">
          위치 미지정 {model.missing.length}곳 · 지도에 표시하지 않고 연결선도 생략해요: {model.missing.slice(0, 8).map((m) => `${m.num} ${m.name}`).join(', ')}{model.missing.length > 8 ? ' …' : ''}
        </div>
      )}
    </>
  );
}

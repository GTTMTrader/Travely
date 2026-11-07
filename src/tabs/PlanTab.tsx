import { useEffect, useState } from 'react';
import { useTripCtx } from '../pages/TripLayout';
import { moveToDay, moveWithinDay, setDayCity, toggleCheck } from '../data/repo';
import type { Item } from '../lib/types';
import { CATEGORY_LABEL } from '../lib/types';
import { numberPlaces } from '../lib/order';
import { legSummary } from '../lib/legs';
import { fetchWeather, weatherIcon, type DayWeather } from '../lib/weather';
import { shortDateDow } from '../lib/time';
import { DayTimeline, type TimelineHandlers } from '../components/Timeline';
import MapView, { type MapSel } from '../components/MapView';
import { Icon, Sheet, dayColor } from '../components/ui';
import ItemSheet from '../sheets/ItemSheet';
import LegSheet from '../sheets/LegSheet';
import BookingViewer from '../sheets/BookingViewer';

type Open =
  | { t: 'item'; item?: Item; day: string | null }
  | { t: 'leg'; a: Item; b: Item }
  | { t: 'booking'; id: string }
  | { t: 'city'; date: string }
  | { t: 'cand'; item: Item }
  | null;

function readMode(): 'list' | 'map' {
  try {
    return sessionStorage.getItem('travely:planMode') === 'map' ? 'map' : 'list';
  } catch {
    return 'list';
  }
}

export default function PlanTab() {
  const c = useTripCtx();
  const [mode, setModeState] = useState<'list' | 'map'>(readMode);
  const [view, setView] = useState<string>(c.bundle.days[0]?.date ?? 'all');
  const [open, setOpen] = useState<Open>(null);
  const [sel, setSel] = useState<MapSel>({ itemId: null, seg: null });
  const [wx, setWx] = useState<Map<string, DayWeather>>(new Map());
  const setMode = (m: 'list' | 'map') => {
    setModeState(m);
    try {
      sessionStorage.setItem('travely:planMode', m);
    } catch {
      /* 무시 */
    }
  };

  // 날씨: 날짜별 도시 좌표 기준 (도시 좌표가 없으면 첫 도시)
  const cityKey = c.bundle.days.map((d) => d.city).join('|') + c.bundle.trip.cities.map((x) => x.name).join('|');
  useEffect(() => {
    let alive = true;
    const groups = new Map<string, { lat: number; lng: number; dates: string[] }>();
    for (const d of c.bundle.days) {
      const city = c.bundle.trip.cities.find((x) => d.city.includes(x.name) && x.lat != null) ?? c.bundle.trip.cities.find((x) => x.lat != null);
      if (!city) continue;
      const k = `${city.lat},${city.lng}`;
      if (!groups.has(k)) groups.set(k, { lat: city.lat!, lng: city.lng!, dates: [] });
      groups.get(k)!.dates.push(d.date);
    }
    (async () => {
      const out = new Map<string, DayWeather>();
      for (const g of groups.values()) {
        const r = await fetchWeather(g.lat, g.lng, g.dates);
        g.dates.forEach((d) => r.get(d) && out.set(d, r.get(d)!));
      }
      if (alive) setWx(out);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityKey]);

  const h: TimelineHandlers = {
    onOpenItem: (item) => {
      setSel({ itemId: item.id, seg: null });
      setOpen({ t: 'item', item, day: item.dayId });
    },
    onOpenLeg: (a, b) => setOpen({ t: 'leg', a, b }),
    onOpenBooking: (id) => setOpen({ t: 'booking', id }),
    onMove: (dayId, itemId, toIndex) => moveWithinDay(c.tripId, c.user.uid, c.byDay.get(dayId) ?? [], itemId, toIndex),
    onToggleCheck: (itemId, entryId) => void toggleCheck(c.tripId, c.user.uid, itemId, entryId).catch(() => undefined),
  };
  const cands = c.byDay.get(null) ?? [];
  const jump = (date: string) => document.getElementById(`day-${date}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // 지도 아래 카드: 선택한 장소 / 구간
  const selItem = sel.itemId ? c.bundle.items.find((i) => i.id === sel.itemId) : null;
  const selDayItems = selItem ? c.byDay.get(selItem.dayId) ?? [] : [];
  const selNum = selItem ? numberPlaces(selDayItems).get(selItem.id) : undefined;
  const places = selDayItems.filter((i) => i.kind === 'place');
  const nextPlace = selItem && selItem.dayId ? places[places.findIndex((i) => i.id === selItem.id) + 1] : undefined;
  const segA = sel.seg ? c.bundle.items.find((i) => i.id === sel.seg!.fromId) : undefined;
  const segB = sel.seg ? c.bundle.items.find((i) => i.id === sel.seg!.toId) : undefined;

  return (
    <div className="t-body">
      <div className="seg" style={{ margin: '6px 0 4px' }} role="tablist">
        <button role="tab" className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')} data-testid="mode-list"><Icon name="list" size={20} /> 일정표</button>
        <button role="tab" className={mode === 'map' ? 'on' : ''} onClick={() => setMode('map')} data-testid="mode-map"><Icon name="map" size={20} /> 지도 보기</button>
      </div>

      {mode === 'list' && (
        <>
          {c.bundle.days.length > 1 && (
            <div className="chips" style={{ margin: '10px 0 0' }}>
              {c.bundle.days.map((d) => (
                <button key={d.date} className="chip" style={{ minHeight: 34, padding: '4px 12px', background: dayColor(d.index).soft, color: dayColor(d.index).ink }} onClick={() => jump(d.date)}>
                  DAY {d.index + 1}
                </button>
              ))}
              {cands.length > 0 && <button className="chip" style={{ minHeight: 34, padding: '4px 12px' }} onClick={() => jump('cand')}>후보 {cands.length}</button>}
            </div>
          )}
          {c.bundle.days.map((d) => {
            const col = dayColor(d.index);
            const w = wx.get(d.date);
            return (
              <section key={d.date} id={`day-${d.date}`} style={{ scrollMarginTop: 120 }} data-testid={`day-${d.date}`}>
                <div className="day-head">
                  <span className="day-pill" style={{ background: col.soft, color: col.ink }}>DAY {d.index + 1}</span>
                  <button className="date grow" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }} onClick={() => c.editable && setOpen({ t: 'city', date: d.date })}>
                    {shortDateDow(d.date)}{d.city ? ` · ${d.city}` : ''}
                  </button>
                  {w && <span className="wx" title="Open-Meteo 예보">{weatherIcon(w.code)} {w.tMin}° / {w.tMax}°</span>}
                </div>
                <DayTimeline day={d} items={c.byDay.get(d.date) ?? []} selectedId={sel.itemId} h={h} />
              </section>
            );
          })}

          <section id="day-cand" style={{ scrollMarginTop: 120 }}>
            <div className="day-head">
              <span className="day-pill" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>후보 장소</span>
              <span className="faint small">아직 날짜를 정하지 않은 곳</span>
            </div>
            {cands.length === 0 ? (
              <div className="empty-day">가고 싶은 곳을 날짜 없이 담아 둘 수 있어요</div>
            ) : (
              <div className="card list" data-testid="cands">
                {cands.map((it) => (
                  <div key={it.id} className="cand-row">
                    <span className="cand-dot" />
                    <button className="grow" style={{ border: 0, background: 'none', textAlign: 'left', padding: 0 }} onClick={() => h.onOpenItem(it)}>
                      <b>{it.place?.nameKo ?? it.memo.slice(0, 30)}</b>
                      <div className="tiny muted">{it.category ? CATEGORY_LABEL[it.category] : '메모'}{it.memo && it.place ? ` · ${it.memo.slice(0, 40)}` : ''}</div>
                    </button>
                    {c.editable && <button className="btn sm soft" onClick={() => setOpen({ t: 'cand', item: it })} data-testid="cand-add">일정에 추가</button>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {mode === 'map' && (
        <>
          <div className="chips" style={{ margin: '10px 0' }}>
            {c.bundle.days.map((d) => (
              <button key={d.date} className={`chip ${view === d.date ? 'on' : ''}`} style={{ flex: 1, justifyContent: 'center' }} onClick={() => { setView(d.date); setSel({ itemId: null, seg: null }); }}>DAY {d.index + 1}</button>
            ))}
            <button className={`chip ${view === 'all' ? 'on' : ''}`} style={{ flex: 1, justifyContent: 'center' }} onClick={() => { setView('all'); setSel({ itemId: null, seg: null }); }}>전체</button>
          </div>
          <MapView view={view} sel={sel} onSelect={setSel} />
          <div className="map-sheet">
            {selItem && (
              <div className="card pad" data-testid="map-card">
                <div className="row">
                  {selItem.dayId ? (
                    <span className="tl-num" style={{ background: dayColor(c.dayIndex(selItem.dayId)).main, width: 44, height: 44, fontSize: 18, boxShadow: 'none', margin: 0 }}>{selNum ?? '·'}</span>
                  ) : <span className="cand-dot" style={{ width: 36, height: 36 }} />}
                  <div className="grow">
                    <div style={{ fontSize: 20, fontWeight: 800 }}>{selItem.place?.nameKo ?? '메모'}</div>
                    <div className="muted small">{selItem.dayId ? `DAY ${c.dayIndex(selItem.dayId) + 1} · ${selItem.time ?? '시간 미정'} 방문 예정` : '후보 장소'}</div>
                  </div>
                  <button className="icon-btn" style={{ color: 'var(--primary)' }} onClick={() => h.onOpenItem(selItem)} aria-label="수정"><Icon name="edit" /></button>
                </div>
                {selItem.memo && <div className="card soft" style={{ padding: '12px 14px', marginTop: 12, color: 'var(--primary)' }}>{selItem.memo}</div>}
                {nextPlace && (
                  <>
                    <div style={{ fontWeight: 800, margin: '14px 0 8px' }}>다음 장소 · {nextPlace.place?.nameKo}</div>
                    <button className={`leg ${legSummary(c.legs.get(`${selItem.id}__${nextPlace.id}`), selItem, nextPlace).empty ? 'empty' : ''}`} onClick={() => setOpen({ t: 'leg', a: selItem, b: nextPlace })}>
                      <span className="grow">{legSummary(c.legs.get(`${selItem.id}__${nextPlace.id}`), selItem, nextPlace).text}</span>
                      <Icon name="next" size={18} />
                    </button>
                  </>
                )}
              </div>
            )}
            {!selItem && segA && segB && (
              <div className="card pad" data-testid="map-seg">
                <div style={{ fontWeight: 800, marginBottom: 8 }}>{segA.place?.nameKo} → {segB.place?.nameKo}</div>
                <button className="leg" onClick={() => setOpen({ t: 'leg', a: segA, b: segB })}>
                  <span className="grow">{legSummary(c.legs.get(`${segA.id}__${segB.id}`), segA, segB).text}</span>
                  <Icon name="next" size={18} />
                </button>
              </div>
            )}
            {!selItem && !segA && <p className="hint" style={{ textAlign: 'center' }}>번호 핀이나 선을 누르면 장소·이동 정보가 보여요</p>}
          </div>
        </>
      )}

      {c.editable && (
        <button className="fab" onClick={() => setOpen({ t: 'item', day: mode === 'map' && view !== 'all' ? view : c.bundle.days[0]?.date ?? null })} data-testid="add-item">
          <Icon name="plus" /> 일정 추가
        </button>
      )}

      {open?.t === 'item' && <ItemSheet key={open.item?.id ?? 'new'} item={open.item} defaultDay={open.day} onClose={() => setOpen(null)} />}
      {open?.t === 'leg' && <LegSheet from={open.a} to={open.b} onClose={() => setOpen(null)} />}
      {open?.t === 'booking' && <BookingViewer bookingId={open.id} onClose={() => setOpen(null)} />}
      {open?.t === 'city' && <CitySheet date={open.date} onClose={() => setOpen(null)} />}
      {open?.t === 'cand' && (
        <Sheet onClose={() => setOpen(null)} label="일정에 추가">
          <h3>‘{open.item.place?.nameKo ?? '메모'}’ 어느 날에 갈까요?</h3>
          <div className="col">
            {c.bundle.days.map((d) => (
              <button key={d.date} className="btn block" onClick={() => moveToDay(c.tripId, c.user.uid, open.item, d.date, c.byDay.get(d.date) ?? []).then(() => setOpen(null), () => undefined)}>
                DAY {d.index + 1} · {shortDateDow(d.date)} (맨 끝에 추가)
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}

function CitySheet({ date, onClose }: { date: string; onClose: () => void }) {
  const c = useTripCtx();
  const d = c.bundle.days.find((x) => x.date === date);
  const [v, setV] = useState(d?.city ?? '');
  return (
    <Sheet onClose={onClose} label="도시">
      <h3>{shortDateDow(date)} 도시</h3>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        {c.bundle.trip.cities.map((x) => <button key={x.name} className="chip" onClick={() => setV(x.name)}>{x.name}</button>)}
      </div>
      <input className="input" id="day-city" value={v} maxLength={40} onChange={(e) => setV(e.target.value)} placeholder="예: 칭다오 → 옌타이" />
      <div className="actions" style={{ marginTop: 12 }}>
        <button className="btn" onClick={onClose}>취소</button>
        <button className="btn primary" onClick={() => setDayCity(c.tripId, date, v).then(onClose, () => undefined)}>저장</button>
      </div>
    </Sheet>
  );
}

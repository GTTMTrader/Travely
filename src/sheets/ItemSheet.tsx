import { useState, type FormEvent } from 'react';
import { useTripCtx } from '../pages/TripLayout';
import { addItem, deleteItem, moveToDay, moveWithinDay, updateItem, type ItemInput } from '../data/repo';
import type { Category, Item, PlaceInfo } from '../lib/types';
import { CATEGORY_LABEL, CATEGORY_ORDER, emptyPlace } from '../lib/types';
import { ConflictError, describeError } from '../lib/saveStatus';
import { hasCoords } from '../lib/order';
import { searchPlace, type GeoResult } from '../lib/geo';
import { formatDateTime, shortDateDow } from '../lib/time';
import { ChecklistEditor } from '../components/Checklist';
import { ConfirmButton, copyText, Sheet } from '../components/ui';
import PinPicker from './PinPicker';

function form(item?: Item) {
  return {
    kind: (item?.kind === 'memo' ? 'memo' : 'place') as 'place' | 'memo',
    category: (item?.category ?? 'sight') as Category,
    tag: item?.tag ?? '',
    time: item?.time ?? '',
    untimed: item ? !item.time : true,
    memo: item?.memo ?? '',
    place: item?.place ? { ...item.place } : emptyPlace(),
    checklist: item?.checklist ? item.checklist.map((c) => ({ ...c })) : [],
    bookingIds: item?.bookingIds ?? [],
  };
}

/** 일정 추가·수정 (장소 / 메모). 장소를 누르면 바로 이 시트가 열린다. */
export default function ItemSheet({ item, defaultDay, onClose }: { item?: Item; defaultDay: string | null; onClose: () => void }) {
  const c = useTripCtx();
  const live = item ? c.bundle.items.find((i) => i.id === item.id) : undefined;
  const [base, setBase] = useState<Item | undefined>(item);
  const [f, setF] = useState(() => form(item));
  const [dayId, setDayId] = useState<string | null>(item ? item.dayId : defaultDay);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Item | null>(null);
  const [pin, setPin] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeoResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [coordText, setCoordText] = useState('');
  const ro = !c.editable;
  const setPlace = (p: Partial<PlaceInfo>) => setF((s) => ({ ...s, place: { ...s.place, ...p } }));

  const dayItems = item ? c.byDay.get(item.dayId) ?? [] : [];
  const idx = item ? dayItems.findIndex((i) => i.id === item.id) : -1;
  const remoteChanged = !!item && !!live && !!base && live.version !== base.version;

  const cityNear = () => {
    const d = c.bundle.days.find((x) => x.date === dayId);
    const city = c.bundle.trip.cities.find((x) => x.name === d?.city) ?? c.bundle.trip.cities[0];
    return city && city.lat != null && city.lng != null ? { lat: city.lat, lng: city.lng } : null;
  };

  const doSearch = async () => {
    const text = q.trim() || f.place.nameLocal || f.place.nameKo;
    if (!text) return;
    setSearching(true);
    setResults(null);
    setErr(null);
    try {
      setResults(await searchPlace(text, cityNear()));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const payload = (): ItemInput => {
    const checklist = f.checklist.map((x) => ({ ...x, text: x.text.trim() })).filter((x) => x.text);
    if (f.kind === 'memo') return { kind: 'memo', category: null, tag: '', time: null, memo: f.memo.trim(), place: null, bookingIds: f.bookingIds, checklist };
    return {
      kind: item?.kind === 'flight' ? 'flight' : 'place',
      category: f.category,
      tag: f.tag.trim().slice(0, 30),
      time: f.untimed ? null : f.time || null,
      memo: f.memo.trim(),
      place: { ...f.place, nameKo: f.place.nameKo.trim(), nameLocal: f.place.nameLocal.trim(), address: f.place.address.trim(), addressLocal: f.place.addressLocal.trim() },
      bookingIds: f.bookingIds,
      checklist,
    };
  };

  const save = async (e?: FormEvent, override?: Item) => {
    e?.preventDefault();
    setErr(null);
    const data = payload();
    if (data.kind === 'place' && !data.place?.nameKo) return setErr('장소 이름을 입력해 주세요');
    if (data.kind === 'memo' && !data.memo) return setErr('메모 내용을 입력해 주세요');
    setBusy(true);
    try {
      if (!item) await addItem(c.tripId, c.user.uid, dayId, c.byDay.get(dayId) ?? [], data);
      else {
        const b = override ?? base!;
        await updateItem(c.tripId, c.user.uid, b.id, b.version, data);
        if (dayId !== item.dayId) {
          const fresh = { ...item, version: b.version + 1 };
          await moveToDay(c.tripId, c.user.uid, fresh, dayId, c.byDay.get(dayId) ?? []);
        }
      }
      onClose();
    } catch (e2) {
      if (e2 instanceof ConflictError) setConflict((e2.server as Item) ?? null);
      setErr(describeError(e2));
    } finally {
      setBusy(false);
    }
  };

  const loadServer = (srv: Item) => {
    setBase(srv);
    setF(form(srv));
    setConflict(null);
    setErr(null);
  };
  const run = async (fn: () => Promise<unknown>, close = false) => {
    setErr(null);
    try {
      await fn();
      if (close) onClose();
    } catch (e2) {
      setErr(describeError(e2));
    }
  };

  const extQuery = encodeURIComponent(hasCoords(f.place) ? `${f.place.lat},${f.place.lng}` : [f.place.nameLocal || f.place.nameKo, f.place.addressLocal || f.place.address].filter(Boolean).join(' '));
  const amap = encodeURIComponent(f.place.nameLocal || f.place.addressLocal || f.place.nameKo);

  return (
    <Sheet onClose={onClose} label={item ? '일정 수정' : '일정 추가'}>
      <h3>{item ? (ro ? '일정 보기' : '일정 수정') : '일정 추가'}</h3>
      {remoteChanged && !conflict && (
        <div className="card soft pad small" style={{ marginBottom: 12 }}>
          편집하는 동안 친구가 이 일정을 고쳤어요.
          <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => live && loadServer(live)}>친구 내용 불러오기</button>
        </div>
      )}
      {item && !live && <div className="card pad small" style={{ marginBottom: 12, background: 'var(--warn-soft)' }}>친구가 이 일정을 삭제했어요.</div>}
      {conflict && (
        <div className="card pad small" style={{ marginBottom: 12, background: 'var(--warn-soft)' }} data-testid="conflict">
          <b>친구가 먼저 수정했어요.</b>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={() => loadServer(conflict)}>친구 내용으로 다시 편집</button>
            <button className="btn sm danger" onClick={() => save(undefined, conflict)}>내 내용으로 덮어쓰기</button>
          </div>
        </div>
      )}

      <form onSubmit={save}>
        <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          {!item && (
            <div className="seg" style={{ marginBottom: 14 }}>
              <button type="button" className={f.kind === 'place' ? 'on' : ''} onClick={() => setF({ ...f, kind: 'place' })}>장소</button>
              <button type="button" className={f.kind === 'memo' ? 'on' : ''} onClick={() => setF({ ...f, kind: 'memo' })}>메모 (번호 없음)</button>
            </div>
          )}
          <label className="field">
            <span className="label">날짜</span>
            <select className="select" id="item-day" value={dayId ?? ''} onChange={(e) => setDayId(e.target.value || null)}>
              {c.bundle.days.map((d) => <option key={d.date} value={d.date}>DAY {d.index + 1} · {shortDateDow(d.date)}{d.city ? ` · ${d.city}` : ''}</option>)}
              <option value="">후보 장소 (날짜 미정)</option>
            </select>
          </label>

          {f.kind === 'place' && (
            <>
              <label className="field">
                <span className="label">장소 이름</span>
                <input className="input" id="item-name" required maxLength={120} value={f.place.nameKo} onChange={(e) => setPlace({ nameKo: e.target.value })} placeholder="예: 잔교" />
              </label>
              <label className="field">
                <span className="label">현지어 이름</span>
                <input className="input" id="item-local" maxLength={120} value={f.place.nameLocal} onChange={(e) => setPlace({ nameLocal: e.target.value })} placeholder="예: 栈桥" />
              </label>
              <div className="field">
                <span className="label">장소 유형</span>
                <div className="chips" style={{ flexWrap: 'wrap' }}>
                  {CATEGORY_ORDER.map((k) => (
                    <button type="button" key={k} className={`chip ${f.category === k ? 'on' : ''}`} style={{ minHeight: 36, padding: '6px 14px' }} onClick={() => setF({ ...f, category: k })}>{CATEGORY_LABEL[k]}</button>
                  ))}
                </div>
                <input className="input" id="item-tag" maxLength={30} value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} placeholder="세부 (선택) 예: 해안, 건축" />
              </div>
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <label className="field grow">
                  <span className="label">방문 시간</span>
                  <input className="input" type="time" id="item-time" value={f.untimed ? '' : f.time} disabled={f.untimed} onChange={(e) => setF({ ...f, time: e.target.value })} />
                </label>
                <label className="row small field" style={{ whiteSpace: 'nowrap' }}>
                  <input type="checkbox" id="item-untimed" checked={f.untimed} onChange={(e) => setF({ ...f, untimed: e.target.checked })} style={{ width: 20, height: 20, accentColor: 'var(--primary)' }} /> 시간 미정
                </label>
              </div>
              <p className="hint" style={{ marginTop: -8 }}>시간을 넣어도 방문 순서는 바뀌지 않아요. 순서는 카드를 길게 눌러 옮겨요.</p>
              <label className="field">
                <span className="label">주소</span>
                <input className="input" id="item-addr" maxLength={300} value={f.place.address} onChange={(e) => setPlace({ address: e.target.value })} />
              </label>
              <label className="field">
                <span className="label">현지어 주소 (택시 기사에게 보여주기)</span>
                <input className="input" id="item-addr-local" maxLength={300} value={f.place.addressLocal} onChange={(e) => setPlace({ addressLocal: e.target.value })} />
              </label>
              <div className="field">
                <span className="label">지도 위치</span>
                <div className="row wrap">
                  {hasCoords(f.place) ? (
                    <span className="tag num" data-testid="coords">{f.place.lat!.toFixed(5)}, {f.place.lng!.toFixed(5)}</span>
                  ) : (
                    <span className="tag warn">위치 미지정</span>
                  )}
                  <button type="button" className="btn sm soft" onClick={() => setPin(true)}>지도에서 핀 찍기</button>
                  {hasCoords(f.place) && <button type="button" className="btn sm ghost" onClick={() => setPlace({ lat: null, lng: null, coordSource: null })}>위치 지우기</button>}
                </div>
                <div className="row">
                  <input className="input grow" id="item-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름으로 찾기 (중국어·영어가 잘 찾아져요)"
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), doSearch())} />
                  <button type="button" className="btn" onClick={doSearch} disabled={searching}>{searching ? '찾는 중' : '찾기'}</button>
                </div>
                {results && results.length === 0 && <span className="hint">찾지 못했어요. 핀을 찍거나 좌표를 입력해 주세요.</span>}
                {results && results.length > 0 && (
                  <div className="results">
                    {results.map((r, i) => (
                      <button type="button" key={i} className="result"
                        onClick={() => { setPlace({ lat: r.lat, lng: r.lng, coordSource: 'search', address: f.place.address || r.address }); setResults(null); }}>
                        <b>{r.name}</b>
                        <div className="tiny muted">{r.address}</div>
                      </button>
                    ))}
                  </div>
                )}
                <div className="row">
                  <input className="input grow" id="item-coords" inputMode="decimal" value={coordText} onChange={(e) => setCoordText(e.target.value)} placeholder="좌표 직접: 36.0606, 120.3194" />
                  <button type="button" className="btn" onClick={() => {
                    const m = coordText.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
                    const lat = m ? Number(m[1]) : NaN;
                    const lng = m ? Number(m[2]) : NaN;
                    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) { setPlace({ lat, lng, coordSource: 'user' }); setCoordText(''); } else setErr('좌표 형식: 위도, 경도');
                  }}>적용</button>
                </div>
              </div>
            </>
          )}

          <label className="field">
            <span className="label">{f.kind === 'memo' ? '메모' : '메모 (카드에 그대로 보여요)'}</span>
            <textarea className="textarea" id="item-memo" maxLength={2000} value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })}
              placeholder={f.kind === 'memo' ? '예: 옌타이로 이동하는 날' : '예: 9시 15분까지 공항 밖으로 / B출구 왼쪽 매표소에서 표 수령'} />
          </label>
          <ChecklistEditor value={f.checklist} onChange={(checklist) => setF({ ...f, checklist })} />

          {c.bundle.bookings.length > 0 && item?.kind !== 'flight' && (
            <div className="field">
              <span className="label">예약 연결 (예약함의 티켓을 이 일정에서 바로 열기)</span>
              <div className="who-pick">
                {c.bundle.bookings.map((b) => (
                  <label key={b.id} className={f.bookingIds.includes(b.id) ? 'on' : ''}>
                    <input type="checkbox" id={`bk-${b.id}`} checked={f.bookingIds.includes(b.id)}
                      onChange={() => setF({ ...f, bookingIds: f.bookingIds.includes(b.id) ? f.bookingIds.filter((x) => x !== b.id) : [...f.bookingIds, b.id] })} />
                    {b.title}
                  </label>
                ))}
              </div>
            </div>
          )}
        </fieldset>

        {err && <p className="err">{err}</p>}
        {!ro && (
          <div className="actions">
            <button type="button" className="btn" onClick={onClose}>취소</button>
            <button className="btn primary" disabled={busy || (!!item && !live)} data-testid="save-item">{busy ? '저장 중…' : '저장'}</button>
          </div>
        )}
      </form>

      {item && f.kind === 'place' && (
        <div className="row wrap" style={{ marginTop: 14 }}>
          <button className="btn sm" onClick={() => copyText([f.place.nameKo, f.place.nameLocal].filter(Boolean).join(' / '), '이름 복사')}>이름 복사</button>
          {(f.place.address || f.place.addressLocal) && <button className="btn sm" onClick={() => copyText(f.place.addressLocal || f.place.address, '주소 복사')}>주소 복사</button>}
          <a className="btn sm" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${extQuery}`}>Google 지도</a>
          <a className="btn sm" target="_blank" rel="noreferrer" href={`https://uri.amap.com/search?keyword=${amap}`}>고덕지도</a>
        </div>
      )}

      {item && c.editable && live && (
        <div className="col" style={{ marginTop: 14 }}>
          {item.dayId && (
            <div className="row">
              <button className="btn grow" disabled={idx <= 0} onClick={() => run(() => moveWithinDay(c.tripId, c.user.uid, dayItems, item.id, idx - 1))}>위로</button>
              <button className="btn grow" disabled={idx < 0 || idx >= dayItems.length - 1} onClick={() => run(() => moveWithinDay(c.tripId, c.user.uid, dayItems, item.id, idx + 1))}>아래로</button>
              <button className="btn grow" onClick={() => run(() => moveToDay(c.tripId, c.user.uid, live, null, c.byDay.get(null) ?? []), true)}>후보로</button>
            </div>
          )}
          <ConfirmButton label="이 일정 삭제" confirmLabel="정말 삭제" onConfirm={() => run(() => deleteItem(c.tripId, live, c.bundle.legs), true)} />
        </div>
      )}
      {item && <p className="hint">마지막 수정: {c.nameOf(item.updatedBy)}{item.updatedAt ? ` · ${formatDateTime(item.updatedAt)}` : ''}</p>}

      {pin && (
        <PinPicker
          initial={hasCoords(f.place) ? { lat: f.place.lat!, lng: f.place.lng! } : cityNear()}
          onClose={() => setPin(false)}
          onPick={(p) => { setPlace({ ...p, coordSource: 'pin' }); setPin(false); }}
        />
      )}
    </Sheet>
  );
}

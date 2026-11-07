import { useState } from 'react';
import { useTripCtx } from '../pages/TripLayout';
import { deleteLeg, saveLeg, type LegInput } from '../data/repo';
import type { Currency, Item, TravelMode } from '../lib/types';
import { CURRENCIES, CURRENCY_SYMBOL, MODE_EMOJI, MODE_LABEL, MODE_ORDER, legId } from '../lib/types';
import { ConflictError, describeError } from '../lib/saveStatus';
import { fmtDistance, routeFresh, straightMeters } from '../lib/legs';
import { coordKey } from '../lib/geo';
import { ROUTABLE, fetchRoute, routeConfigured } from '../lib/route';
import { hasCoords } from '../lib/order';
import { formatDateTime } from '../lib/time';
import { ConfirmButton, Sheet } from '../components/ui';

/** 두 장소 사이 이동 정보: 수단·시간·거리·교통비·메모 (+ 경로 조회) */
export default function LegSheet({ from, to, onClose }: { from: Item; to: Item; onClose: () => void }) {
  const c = useTripCtx();
  const existing = c.legs.get(legId(from.id, to.id)) ?? null;
  const [mode, setMode] = useState<TravelMode>(existing?.mode ?? 'taxi');
  const [dur, setDur] = useState(existing?.durationMin != null ? String(existing.durationMin) : '');
  const [dist, setDist] = useState(existing?.distanceM != null ? String(+(existing.distanceM / 1000).toFixed(2)) : '');
  const [fare, setFare] = useState(existing?.fareAmount != null ? String(existing.fareAmount) : '');
  const [fareCur, setFareCur] = useState<Currency>(existing?.fareCurrency ?? c.bundle.trip.baseCurrency);
  const [memo, setMemo] = useState(existing?.memo ?? '');
  const [route, setRoute] = useState<{ geometry: string | null; routedAt: number | null; routedFrom: string | null; routedTo: string | null }>({
    geometry: existing?.geometry ?? null, routedAt: existing?.routedAt ?? null, routedFrom: existing?.routedFrom ?? null, routedTo: existing?.routedTo ?? null,
  });
  const [source, setSource] = useState<'route' | 'manual' | null>(existing?.source ?? null);
  const [busy, setBusy] = useState(false);
  const [routing, setRouting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const ro = !c.editable;
  const straight = straightMeters(from, to);
  const canRoute = routeConfigured && !!ROUTABLE[mode] && hasCoords(from.place) && hasCoords(to.place);

  const doRoute = async () => {
    setErr(null);
    setNote(null);
    setRouting(true);
    try {
      const r = await fetchRoute(mode, { lat: from.place!.lat!, lng: from.place!.lng! }, { lat: to.place!.lat!, lng: to.place!.lng! });
      setDur(String(r.durationMin));
      setDist(String(+(r.distanceM / 1000).toFixed(2)));
      setRoute({ geometry: r.geometry, routedAt: Date.now(), routedFrom: coordKey(from.place), routedTo: coordKey(to.place) });
      setSource('route');
      setNote(mode === 'taxi' ? '자동차 길 기준이에요. 교통 체증은 반영되지 않아요.' : '걷는 길 기준이에요.');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setRouting(false);
    }
  };

  const save = async () => {
    setErr(null);
    const d = dur.trim() ? Math.round(Number(dur)) : null;
    const km = dist.trim() ? Number(dist) : null;
    const fa = fare.trim() ? Number(fare) : null;
    if ((d != null && !(d >= 0)) || (km != null && !(km >= 0)) || (fa != null && !(fa >= 0))) return setErr('숫자를 확인해 주세요');
    const data: LegInput = {
      fromId: from.id, toId: to.id, mode, durationMin: d, distanceM: km != null ? Math.round(km * 1000) : null,
      fareAmount: fa, fareCurrency: fareCur, memo: memo.trim().slice(0, 300), source: d == null && km == null ? null : source ?? 'manual',
      geometry: route.geometry, routedAt: route.routedAt, routedFrom: route.routedFrom, routedTo: route.routedTo,
    };
    setBusy(true);
    try {
      await saveLeg(c.tripId, c.user.uid, data, existing?.version ?? null);
      onClose();
    } catch (e) {
      setErr(e instanceof ConflictError ? '친구가 방금 이 구간을 바꿨어요. 닫았다가 다시 열어 주세요' : describeError(e));
    } finally {
      setBusy(false);
    }
  };
  const manual = (fn: () => void) => () => {
    fn();
    setSource('manual');
  };

  return (
    <Sheet onClose={onClose} label="이동 정보">
      <h3>이동 정보</h3>
      <p className="muted small" style={{ marginTop: -8 }}>{from.place?.nameKo} → {to.place?.nameKo}</p>
      <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div className="field">
          <span className="label">이동수단</span>
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            {MODE_ORDER.map((m) => (
              <button type="button" key={m} className={`chip ${mode === m ? 'on' : ''}`} style={{ minHeight: 38 }} onClick={() => setMode(m)}>{MODE_EMOJI[m]} {MODE_LABEL[m]}</button>
            ))}
          </div>
        </div>
        <div className="row">
          <label className="field grow">
            <span className="label">예상 소요시간 (분)</span>
            <input className="input" id="leg-dur" inputMode="numeric" value={dur} onChange={(e) => manual(() => setDur(e.target.value.replace(/[^0-9]/g, '')))()} placeholder="18" />
          </label>
          <label className="field grow">
            <span className="label">이동거리 (km)</span>
            <input className="input" id="leg-dist" inputMode="decimal" value={dist} onChange={(e) => manual(() => setDist(e.target.value.replace(/[^0-9.]/g, '')))()} placeholder="5.2" />
          </label>
        </div>
        <div className="row" style={{ marginTop: -6, marginBottom: 12, flexWrap: 'wrap' }}>
          {straight != null ? <span className="tag grey">직선거리 {fmtDistance(straight)}</span> : <span className="tag warn">두 장소 위치가 있어야 직선거리·경로 조회 가능</span>}
          {source && <span className="tag">{source === 'route' ? '경로 기준 값' : '직접 입력 값'}</span>}
          {existing?.geometry && !routeFresh(existing, from, to) && <span className="tag warn">장소 위치가 바뀌어 다시 조회 필요</span>}
        </div>
        {canRoute ? (
          <button type="button" className="btn soft block" style={{ marginBottom: 14 }} onClick={doRoute} disabled={routing} data-testid="route">
            {routing ? '조회 중…' : `실제 ${mode === 'walk' ? '걷는 길' : '차 길'} 경로 조회`}
          </button>
        ) : (
          <p className="hint" style={{ marginTop: -4 }}>
            {!routeConfigured ? '경로 자동 조회 서버가 설정되지 않아 직접 입력해요.' : !ROUTABLE[mode] ? `${MODE_LABEL[mode]}은(는) 자동 조회가 안 돼서 직접 입력해요.` : '두 장소 모두 지도 위치가 있어야 조회할 수 있어요.'}
          </p>
        )}
        {note && <p className="hint" style={{ color: 'var(--primary)' }}>{note}</p>}
        <div className="row">
          <label className="field grow">
            <span className="label">예상 교통비</span>
            <input className="input" id="leg-fare" inputMode="decimal" value={fare} onChange={(e) => setFare(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="25" />
          </label>
          <label className="field" style={{ width: 120 }}>
            <span className="label">통화</span>
            <select className="select" id="leg-cur" value={fareCur} onChange={(e) => setFareCur(e.target.value as Currency)}>
              {CURRENCIES.map((x) => <option key={x} value={x}>{CURRENCY_SYMBOL[x]} {x}</option>)}
            </select>
          </label>
        </div>
        <label className="field">
          <span className="label">이동 메모</span>
          <input className="input" id="leg-memo" maxLength={300} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 디디로 호출, 정문 앞에서 타기" />
        </label>
      </fieldset>
      {err && <p className="err">{err}</p>}
      {!ro && (
        <div className="actions">
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn primary" onClick={save} disabled={busy} data-testid="save-leg">{busy ? '저장 중…' : '저장'}</button>
        </div>
      )}
      {existing && !ro && (
        <div style={{ marginTop: 10 }}>
          <ConfirmButton label="이동 정보 지우기" confirmLabel="정말 지우기" onConfirm={() => deleteLeg(c.tripId, existing.id).then(onClose, (e) => setErr(describeError(e)))} />
        </div>
      )}
      {existing && <p className="hint">마지막 수정: {c.nameOf(existing.updatedBy)}{existing.updatedAt ? ` · ${formatDateTime(existing.updatedAt)}` : ''}{existing.routedAt ? ` · 경로 조회 ${formatDateTime(existing.routedAt)}` : ''}</p>}
    </Sheet>
  );
}

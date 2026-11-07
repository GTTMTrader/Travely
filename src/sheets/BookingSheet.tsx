import { useRef, useState } from 'react';
import { useTripCtx } from '../pages/TripLayout';
import { deleteBooking, deleteFile, saveBooking, setItemBookings, uploadFile, MAX_FILE_BYTES, type BookingInput } from '../data/repo';
import type { Booking, BookingType, FlightInfo } from '../lib/types';
import { BOOKING_LABEL, BOOKING_ORDER } from '../lib/types';
import { formatBytes, prepareFile, type Prepared } from '../lib/files';
import { describeError } from '../lib/saveStatus';
import { AIRPORT_TZ, TZ_LABEL, shortDateDow } from '../lib/time';
import { flightLookupConfigured, lookupFlight } from '../lib/flight';
import { statusKo } from '../lib/flightParse';
import { ConfirmButton, Icon, Sheet } from '../components/ui';

const emptyFlight = (date: string): FlightInfo => ({
  airline: '', flightNo: '', depCode: '', depDate: date, depTime: '', depTz: 'Asia/Seoul', depTerminal: '',
  arrCode: '', arrDate: date, arrTime: '', arrTz: 'Asia/Shanghai', arrTerminal: '', lookupAt: null,
});

/** 예약 추가·수정: 분류, 이름, 날짜·시간, 예약번호, 메모, 항공 정보, 사진·PDF 여러 장, 관련 일정 연결 */
export default function BookingSheet({ booking, onClose }: { booking?: Booking; onClose: () => void }) {
  const c = useTripCtx();
  const first = c.bundle.trip.startDate;
  const [f, setF] = useState<BookingInput>(() =>
    booking
      ? { type: booking.type, title: booking.title, startDate: booking.startDate, startTime: booking.startTime, endDate: booking.endDate, endTime: booking.endTime, reservationNo: booking.reservationNo, memo: booking.memo, flight: booking.flight, fileIds: booking.fileIds }
      : { type: 'ticket', title: '', startDate: first, startTime: null, endDate: null, endTime: null, reservationNo: '', memo: '', flight: null, fileIds: [] },
  );
  const [pending, setPending] = useState<(Prepared & { key: string; url: string })[]>([]);
  const [uploaded, setUploaded] = useState<Record<string, string>>({}); // pending key → file id (재시도 시 중복 업로드 방지)
  const [progress, setProgress] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const linkedNow = c.bundle.items.filter((i) => booking && i.kind !== 'flight' && i.bookingIds.includes(booking.id)).map((i) => i.id);
  const [links, setLinks] = useState<string[]>(linkedNow);
  const pickRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const fl = f.flight ?? emptyFlight(f.startDate ?? first);
  const setFlight = (p: Partial<FlightInfo>) => setF((s) => ({ ...s, flight: { ...(s.flight ?? emptyFlight(s.startDate ?? first)), ...p } }));

  const onPick = async (list: FileList | null) => {
    if (!list) return;
    setErr(null);
    for (const file of Array.from(list)) {
      try {
        const p = await prepareFile(file);
        if (p.blob.size > MAX_FILE_BYTES) {
          setErr(`${file.name}: 파일이 너무 커요 (최대 ${formatBytes(MAX_FILE_BYTES)})`);
          continue;
        }
        setPending((s) => [...s, { ...p, key: `${Date.now()}-${Math.random()}`, url: p.thumb }]);
      } catch (e) {
        setErr(`${file.name}: ${(e as Error).message}`);
      }
    }
  };

  const save = async () => {
    setErr(null);
    if (!f.title.trim()) return setErr('예약 이름을 입력해 주세요');
    if (f.type === 'flight' && (!fl.depDate || !fl.depTime)) return setErr('항공은 출발 날짜·시각을 입력해 주세요');
    setBusy(true);
    try {
      const newIds: string[] = [];
      const done = { ...uploaded };
      for (let i = 0; i < pending.length; i++) {
        const p = pending[i];
        if (!done[p.key]) {
          setProgress(`파일 올리는 중 ${i + 1}/${pending.length}`);
          done[p.key] = await uploadFile(c.tripId, c.user.uid, p.blob, p.name, p.mime, p.thumb, p.pages, (r) => setProgress(`파일 올리는 중 ${i + 1}/${pending.length} · ${Math.round(r * 100)}%`));
          setUploaded({ ...done });
        }
        newIds.push(done[p.key]);
      }
      setProgress('저장 중');
      const flight = f.type === 'flight' ? { ...fl, depCode: fl.depCode.toUpperCase(), arrCode: fl.arrCode.toUpperCase() } : null;
      const startDate = f.type === 'flight' ? fl.depDate : f.startDate;
      const startTime = f.type === 'flight' ? fl.depTime : f.startTime;
      const data: BookingInput = { ...f, title: f.title.trim(), reservationNo: f.reservationNo.trim(), memo: f.memo.trim(), flight, startDate, startTime, fileIds: [...f.fileIds, ...newIds] };
      const id = await saveBooking(c.tripId, c.user.uid, data, booking ?? null, c.bundle);
      // 빠진 파일 정리
      const removed = (booking?.fileIds ?? []).filter((x) => !data.fileIds.includes(x));
      const usedElsewhere = new Set(c.bundle.bookings.filter((b) => b.id !== id).flatMap((b) => b.fileIds));
      for (const fid of removed) if (!usedElsewhere.has(fid)) await deleteFile(c.tripId, fid).catch(() => undefined);
      // 일정 연결 변경
      for (const it of c.bundle.items) {
        if (it.kind === 'flight') continue;
        const want = links.includes(it.id);
        const has = it.bookingIds.includes(id);
        if (want !== has) await setItemBookings(c.tripId, c.user.uid, it, want ? [...it.bookingIds, id] : it.bookingIds.filter((x) => x !== id));
      }
      onClose();
    } catch (e) {
      setErr(describeError(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const doLookup = async () => {
    setLookupMsg('조회 중…');
    try {
      const [r] = await lookupFlight(fl.flightNo, fl.depDate);
      if (!r) return setLookupMsg('그 날짜 편을 찾지 못했어요. 직접 입력해 주세요');
      setFlight({
        flightNo: r.flightNo, airline: fl.airline || r.airline, depCode: r.dep.code, depDate: r.dep.date, depTime: r.dep.time, depTz: r.dep.tz || fl.depTz, depTerminal: r.dep.terminal ?? '',
        arrCode: r.arr.code, arrDate: r.arr.date, arrTime: r.arr.time, arrTz: r.arr.tz || fl.arrTz, arrTerminal: r.arr.terminal ?? '', lookupAt: r.fetchedAt,
      });
      setLookupMsg(`불러왔어요 · ${statusKo(r.status)}${r.dep.revisedTime ? ` · 변경 출발 ${r.dep.revisedTime}` : ''} · 저장 전 확인`);
    } catch (e) {
      setLookupMsg((e as Error).message);
    }
  };

  const existingFiles = f.fileIds.map((id) => c.files.get(id)).filter(Boolean);
  const placeItems = c.bundle.items.filter((i) => i.kind === 'place');

  return (
    <Sheet onClose={onClose} label={booking ? '예약 수정' : '예약 추가'}>
      <h3>{booking ? '예약 수정' : '예약 추가'}</h3>
      <div className="chips" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        {BOOKING_ORDER.map((t) => (
          <button key={t} type="button" className={`chip ${f.type === t ? 'on' : ''}`} onClick={() => setF({ ...f, type: t as BookingType })}>{BOOKING_LABEL[t]}</button>
        ))}
      </div>
      <label className="field">
        <span className="label">예약 이름</span>
        <input className="input" id="bk-title" maxLength={80} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })}
          placeholder={f.type === 'flight' ? '예: 인천 → 칭다오' : f.type === 'stay' ? '예: 칭다오 숙소' : '예: 맥주박물관 입장권'} />
      </label>

      {f.type === 'flight' ? (
        <>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <label className="field" style={{ width: 120 }}><span className="label">편명</span>
              <input className="input" id="bk-fno" maxLength={8} value={fl.flightNo} onChange={(e) => setFlight({ flightNo: e.target.value.toUpperCase() })} placeholder="LJ841" />
            </label>
            <label className="field grow"><span className="label">항공사</span>
              <input className="input" id="bk-airline" maxLength={40} value={fl.airline} onChange={(e) => setFlight({ airline: e.target.value })} placeholder="진에어" />
            </label>
            {flightLookupConfigured && <button type="button" className="btn soft field" onClick={doLookup}>불러오기</button>}
          </div>
          {lookupMsg && <p className="hint" style={{ marginTop: -8 }}>{lookupMsg}</p>}
          {(['dep', 'arr'] as const).map((s) => (
            <div key={s} className="card pad" style={{ marginBottom: 12, boxShadow: 'none' }}>
              <b className="small">{s === 'dep' ? '출발 (출발지 현지 시각)' : '도착 (도착지 현지 시각)'}</b>
              <div className="row" style={{ marginTop: 8 }}>
                <label className="field" style={{ width: 84 }}><span className="label">공항</span>
                  <input className="input" id={`bk-${s}-code`} maxLength={4} value={fl[`${s}Code`]} placeholder={s === 'dep' ? 'ICN' : 'TAO'}
                    onChange={(e) => { const code = e.target.value.toUpperCase(); setFlight({ [`${s}Code`]: code, ...(AIRPORT_TZ[code] ? { [`${s}Tz`]: AIRPORT_TZ[code] } : {}) } as Partial<FlightInfo>); }} />
                </label>
                <label className="field grow"><span className="label">날짜</span>
                  <input className="input" type="date" id={`bk-${s}-date`} value={fl[`${s}Date`]} onChange={(e) => setFlight({ [`${s}Date`]: e.target.value } as Partial<FlightInfo>)} />
                </label>
                <label className="field" style={{ width: 108 }}><span className="label">시각</span>
                  <input className="input" type="time" id={`bk-${s}-time`} value={fl[`${s}Time`]} onChange={(e) => setFlight({ [`${s}Time`]: e.target.value } as Partial<FlightInfo>)} />
                </label>
              </div>
              <div className="row">
                <label className="field grow" style={{ marginBottom: 0 }}><span className="label">시간대</span>
                  <select className="select" id={`bk-${s}-tz`} value={fl[`${s}Tz`]} onChange={(e) => setFlight({ [`${s}Tz`]: e.target.value } as Partial<FlightInfo>)}>
                    {[...new Set([fl[`${s}Tz`], ...Object.keys(TZ_LABEL).filter((x) => x !== 'UTC')])].map((tz) => <option key={tz} value={tz}>{TZ_LABEL[tz] ?? tz}</option>)}
                  </select>
                </label>
                <label className="field" style={{ width: 90, marginBottom: 0 }}><span className="label">터미널</span>
                  <input className="input" id={`bk-${s}-term`} maxLength={4} value={fl[`${s}Terminal`]} onChange={(e) => setFlight({ [`${s}Terminal`]: e.target.value } as Partial<FlightInfo>)} />
                </label>
              </div>
            </div>
          ))}
          <p className="hint" style={{ marginTop: -4 }}>저장하면 일정의 그 날짜에 항공편 카드가 자동으로 생겨요.</p>
        </>
      ) : (
        <div className="row">
          <label className="field grow"><span className="label">{f.type === 'stay' ? '체크인' : '이용 날짜'}</span>
            <input className="input" type="date" id="bk-start" value={f.startDate ?? ''} onChange={(e) => setF({ ...f, startDate: e.target.value || null })} />
          </label>
          <label className="field" style={{ width: 112 }}><span className="label">시간</span>
            <input className="input" type="time" id="bk-start-time" value={f.startTime ?? ''} onChange={(e) => setF({ ...f, startTime: e.target.value || null })} />
          </label>
        </div>
      )}
      {f.type === 'stay' && (
        <label className="field"><span className="label">체크아웃</span>
          <input className="input" type="date" id="bk-end" value={f.endDate ?? ''} min={f.startDate ?? undefined} onChange={(e) => setF({ ...f, endDate: e.target.value || null })} />
        </label>
      )}
      <label className="field"><span className="label">예약번호</span>
        <input className="input num" id="bk-resno" maxLength={60} value={f.reservationNo} onChange={(e) => setF({ ...f, reservationNo: e.target.value })} placeholder="예: TRP1234567" />
      </label>
      <label className="field"><span className="label">메모</span>
        <textarea className="textarea" id="bk-memo" maxLength={1000} value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} placeholder="예: 매표소 2번 창구에서 실물 티켓 교환" />
      </label>

      <div className="field">
        <span className="label">예약 캡처 · e티켓 (여러 장 가능)</span>
        {(existingFiles.length > 0 || pending.length > 0) && (
          <div className="file-tiles">
            {existingFiles.map((m) => (
              <div key={m!.id} className="file-tile">
                {m!.thumb ? <img src={m!.thumb} alt={m!.name} /> : <span className="tiny muted">{m!.mime === 'application/pdf' ? 'PDF' : '파일'}</span>}
                <button type="button" className="x" aria-label="빼기" onClick={() => setF({ ...f, fileIds: f.fileIds.filter((x) => x !== m!.id) })}>✕</button>
              </div>
            ))}
            {pending.map((p) => (
              <div key={p.key} className="file-tile" data-testid="pending-file">
                {p.thumb ? <img src={p.thumb} alt={p.name} /> : <span className="tiny muted">PDF</span>}
                <button type="button" className="x" aria-label="빼기" onClick={() => setPending(pending.filter((x) => x.key !== p.key))}>✕</button>
              </div>
            ))}
          </div>
        )}
        <div className="row">
          <button type="button" className="btn soft grow" onClick={() => pickRef.current?.click()}><Icon name="file" size={18} /> 사진·PDF 올리기</button>
          <button type="button" className="btn grow" onClick={() => camRef.current?.click()}><Icon name="camera" size={18} /> 카메라</button>
        </div>
        <input ref={pickRef} type="file" accept="image/*,application/pdf" multiple hidden data-testid="file-input" onChange={(e) => { onPick(e.target.files); e.target.value = ''; }} />
        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onPick(e.target.files); e.target.value = ''; }} />
        <span className="hint">사진은 자동으로 줄여서 올려요(QR이 깨지지 않게). 파일 하나 최대 10MB · 친구도 원본을 볼 수 있어요.</span>
      </div>

      {placeItems.length > 0 && (
        <div className="field">
          <span className="label">관련 일정 연결</span>
          <div className="who-pick" style={{ maxHeight: 180, overflow: 'auto' }}>
            {placeItems.map((it) => (
              <label key={it.id} className={links.includes(it.id) ? 'on' : ''}>
                <input type="checkbox" id={`link-${it.id}`} checked={links.includes(it.id)} onChange={() => setLinks(links.includes(it.id) ? links.filter((x) => x !== it.id) : [...links, it.id])} />
                {it.dayId ? `D${c.dayIndex(it.dayId) + 1} ` : ''}{it.place?.nameKo}
              </label>
            ))}
          </div>
        </div>
      )}

      {err && <p className="err">{err}</p>}
      {progress && <p className="hint" style={{ color: 'var(--primary)' }}>{progress}</p>}
      <div className="actions">
        <button className="btn" onClick={onClose} disabled={busy}>취소</button>
        <button className="btn primary" onClick={save} disabled={busy || !c.editable} data-testid="save-booking">{busy ? '저장 중…' : '저장'}</button>
      </div>
      {booking && c.editable && (
        <div style={{ marginTop: 10 }}>
          <ConfirmButton label="예약 삭제" confirmLabel="정말 삭제 (파일도 지워져요)" onConfirm={() => deleteBooking(c.tripId, c.user.uid, booking, c.bundle).then(onClose, (e) => setErr(describeError(e)))} />
        </div>
      )}
      {booking?.startDate && <p className="hint">{shortDateDow(booking.startDate)} · 마지막 수정 {c.nameOf(booking.updatedBy)}</p>}
    </Sheet>
  );
}

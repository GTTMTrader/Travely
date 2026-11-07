import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAuth, isDemo } from '../data/backend';
import { useMyTrips, useUser } from '../data/hooks';
import { createTrip } from '../data/repo';
import { SAMPLE_DAY_CITIES, SAMPLE_TRIP, sampleSeed } from '../lib/sample';
import { describeError } from '../lib/saveStatus';
import { dateRange, shortDateDow, todayLocal } from '../lib/time';
import { Art, Icon, Logo, Sheet } from '../components/ui';
import TripFormSheet from '../sheets/TripFormSheet';
import type { Trip } from '../lib/types';

export function dDay(t: Trip, today = todayLocal()): { label: string; past: boolean } {
  if (t.endDate < today) return { label: '완료', past: true };
  if (t.startDate <= today) return { label: '여행 중', past: false };
  const n = dateRange(today, t.startDate).length - 1;
  return { label: `D-${n}`, past: false };
}

export default function HomePage() {
  const { user } = useUser();
  const { rows, err } = useMyTrips(user?.uid);
  const nav = useNavigate();
  const [tab, setTab] = useState<'up' | 'past'>('up');
  const [creating, setCreating] = useState(false);
  const [account, setAccount] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const today = todayLocal();
  const list = (rows ?? []).map((r) => ({ ...r, d: dDay(r.trip, today) }));
  const upcoming = list.filter((r) => !r.d.past).sort((a, b) => (a.trip.startDate < b.trip.startDate ? -1 : 1));
  const past = list.filter((r) => r.d.past).sort((a, b) => (a.trip.startDate > b.trip.startDate ? -1 : 1));
  const shown = tab === 'up' ? upcoming : past;

  const makeSample = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const id = await createTrip(user, SAMPLE_TRIP, { ...sampleSeed(), dayCities: SAMPLE_DAY_CITIES }, true);
      nav(`/trip/${id}/plan`);
    } catch (e) {
      setMsg(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="row between">
        <Logo />
        <button className="icon-btn round" style={{ width: 52, height: 52 }} onClick={() => setAccount(true)} aria-label="내 계정"><Icon name="users" /></button>
      </div>
      <h1 className="h-title">내 여행</h1>
      <p className="muted" style={{ marginTop: 0 }}>여행마다 일정과 기록을 한곳에서 관리해요</p>

      <div className="seg solid" style={{ margin: '18px 0 16px' }} role="tablist">
        <button role="tab" className={tab === 'up' ? 'on' : ''} onClick={() => setTab('up')}>다가오는 여행 {upcoming.length}</button>
        <button role="tab" className={tab === 'past' ? 'on' : ''} onClick={() => setTab('past')}>지난 여행 {past.length}</button>
      </div>

      {err && <p className="err">여행 목록을 불러오지 못했어요: {err}</p>}
      {rows === null && !err && <div className="center-msg">불러오는 중…</div>}
      {rows && shown.length === 0 && (
        <div className="card pad center-msg" style={{ padding: 28 }}>
          {tab === 'up' ? '다가오는 여행이 없어요. 새 여행을 만들거나 받은 초대 링크를 열어 보세요.' : '지난 여행이 없어요.'}
        </div>
      )}
      {shown.map(({ trip, memberCount, d }) => (
        <div key={trip.id} className="trip-card" role="link" tabIndex={0} data-testid="trip-card"
          onClick={() => nav(`/trip/${trip.id}/plan`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/trip/${trip.id}/plan`)}>
          <div className="art"><Art kind={trip.illustration} /></div>
          <div className="grow">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <h3 className="grow">{trip.name}</h3>
              <span className={`badge-d ${d.past ? 'done' : ''}`}>{d.label}</span>
            </div>
            <div className="meta"><Icon name="calendar" size={16} /> <span className="num">{shortDateDow(trip.startDate)} – {shortDateDow(trip.endDate)}</span> · {dateRange(trip.startDate, trip.endDate).length}일</div>
            <div className="meta" style={{ marginTop: 2 }}><Icon name="users" size={16} /> {memberCount}명 · {d.past ? '여행 기록' : memberCount > 1 ? '공동 편집 중' : '나만'}{trip.isSample && <span className="tag warn" style={{ marginLeft: 4 }}>샘플</span>}</div>
            <div className="shortcuts" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => nav(`/trip/${trip.id}/plan`)}>일정</button>
              <button onClick={() => nav(`/trip/${trip.id}/bookings`)}>예약함</button>
              <button onClick={() => nav(`/trip/${trip.id}/ledger`)}>가계부</button>
            </div>
          </div>
        </div>
      ))}

      {rows && rows.length === 0 && !isDemo && (
        <button className="btn soft block" style={{ marginTop: 16 }} onClick={makeSample} disabled={busy}>사진 속 일정으로 샘플 여행 만들기</button>
      )}
      {msg && <p className="err">{msg}</p>}

      <div className="bottom-cta">
        <button className="btn primary block xl" onClick={() => setCreating(true)} data-testid="new-trip"><Icon name="plus" /> 새 여행 만들기</button>
      </div>

      {creating && user && <TripFormSheet user={user} onClose={() => setCreating(false)} onSaved={(id) => nav(`/trip/${id}/plan`)} />}
      {account && user && (
        <Sheet onClose={() => setAccount(false)} label="내 계정">
          <h3>내 계정</h3>
          <dl className="kv"><dt>이름</dt><dd>{user.displayName}</dd><dt>이메일</dt><dd>{user.email || '-'}</dd></dl>
          {rows && rows.length > 0 && !isDemo && (
            <button className="btn soft block" style={{ marginTop: 16 }} onClick={makeSample} disabled={busy}>사진 속 일정으로 샘플 여행 만들기</button>
          )}
          <button className="btn block" style={{ marginTop: 10 }} onClick={() => getAuth().signOut()}>로그아웃</button>
        </Sheet>
      )}
    </div>
  );
}

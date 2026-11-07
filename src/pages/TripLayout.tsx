import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import type { AppUser } from '../data/auth';
import { useItemsByDay, useOnline, useTrip, useUser } from '../data/hooks';
import type { Booking, FileMeta, Item, Leg, Member, TripBundle } from '../lib/types';
import { mdSlash } from '../lib/time';
import { Icon } from '../components/ui';
import StatusLine from '../components/StatusBar';
import ShareSheet from '../sheets/ShareSheet';
import PlanTab from '../tabs/PlanTab';
import BookingsTab from '../tabs/BookingsTab';
import LedgerTab from '../tabs/LedgerTab';
import PackingTab from '../tabs/PackingTab';

export interface TripCtx {
  tripId: string;
  user: AppUser;
  bundle: TripBundle;
  me: Member;
  /** 편집 가능 상태: 편집 권한 + 온라인 + 서버 연결 */
  editable: boolean;
  canEditRole: boolean;
  live: boolean;
  online: boolean;
  byDay: Map<string | null, Item[]>;
  legs: Map<string, Leg>;
  bookings: Map<string, Booking>;
  files: Map<string, FileMeta>;
  activeMembers: Member[];
  nameOf: (uid: string) => string;
  dayIndex: (dayId: string | null) => number;
}
const Ctx = createContext<TripCtx | null>(null);
export const useTripCtx = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('TripCtx missing');
  return c;
};

const TABS = [
  { id: 'plan', label: '일정', icon: 'calendar' },
  { id: 'bookings', label: '예약함', icon: 'ticket' },
  { id: 'ledger', label: '가계부', icon: 'wallet' },
  { id: 'packing', label: '준비물', icon: 'bag' },
] as const;

export default function TripLayout() {
  const { tripId = '', tab = 'plan' } = useParams();
  const { user } = useUser();
  const w = useTrip(tripId, user?.uid);
  const online = useOnline();
  const nav = useNavigate();
  const [share, setShare] = useState(false);
  const bundle = w.status === 'ready' ? w.bundle : null;
  const byDay = useItemsByDay(bundle?.items ?? [], bundle?.days ?? []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  const ctx = useMemo<TripCtx | null>(() => {
    if (!bundle || !user || w.status !== 'ready') return null;
    const me = bundle.members.find((m) => m.uid === user.uid && m.status === 'active');
    if (!me) return null;
    const canEditRole = me.role === 'owner' || me.role === 'editor';
    const names = new Map(bundle.members.map((m) => [m.uid, m.uid === user.uid ? `${m.displayName}` : m.displayName]));
    const dayIdx = new Map(bundle.days.map((d) => [d.date, d.index]));
    return {
      tripId, user, bundle, me, canEditRole, live: w.live, online,
      editable: canEditRole && online && w.live,
      byDay,
      legs: new Map(bundle.legs.map((l) => [l.id, l])),
      bookings: new Map(bundle.bookings.map((b) => [b.id, b])),
      files: new Map(bundle.files.map((f) => [f.id, f])),
      activeMembers: bundle.members.filter((m) => m.status === 'active').sort((a, b) => (a.uid === user.uid ? -1 : b.uid === user.uid ? 1 : 0)),
      nameOf: (uid) => names.get(uid) ?? '알 수 없음',
      dayIndex: (d) => (d ? dayIdx.get(d) ?? 0 : -1),
    };
  }, [bundle, user, w, online, byDay, tripId]);

  if (!user) return null;
  if (w.status === 'denied' || (bundle && !ctx))
    return (
      <div className="center-msg">
        이 여행을 볼 권한이 없어요.<br />멤버가 아니거나 접근이 해제된 계정이에요.
        <p><Link to="/">내 여행으로</Link></p>
      </div>
    );
  if (w.status === 'notfound') return <div className="center-msg">여행을 찾을 수 없어요. <Link to="/">내 여행으로</Link></div>;
  if (!ctx) return <div className="center-msg">{online ? '불러오는 중…' : '오프라인이고, 이 기기에 저장된 여행 정보가 없어요.'}</div>;

  const t = ctx.bundle.trip;
  return (
    <Ctx.Provider value={ctx}>
      <header className="t-head">
        <div className="bar">
          <button className="icon-btn round" onClick={() => nav('/')} aria-label="내 여행으로"><Icon name="back" /></button>
          <div style={{ minWidth: 0 }}>
            <h1 className="ellipsis" data-testid="trip-title">{t.name}</h1>
            <div className="sub num">{mdSlash(t.startDate)} – {mdSlash(t.endDate)} · {ctx.activeMembers.length}명 공유</div>
          </div>
          <button className="icon-btn" onClick={() => setShare(true)} aria-label="공유·설정" data-testid="share-btn"><Icon name="users" size={26} /></button>
        </div>
        <StatusLine online={online} live={ctx.live} lastSync={w.lastSync} viewer={!ctx.canEditRole} />
      </header>

      {tab === 'plan' && <PlanTab />}
      {tab === 'bookings' && <BookingsTab />}
      {tab === 'ledger' && <LedgerTab />}
      {tab === 'packing' && <PackingTab />}

      <nav className="bnav" aria-label="여행 메뉴">
        <div className="in">
          {TABS.map((x) => (
            <NavLink key={x.id} to={`/trip/${tripId}/${x.id}`} replace className={() => (tab === x.id ? 'on' : '')} data-testid={`nav-${x.id}`}>
              <Icon name={x.icon} size={26} />
              {x.label}
            </NavLink>
          ))}
        </div>
      </nav>
      {share && <ShareSheet onClose={() => setShare(false)} />}
    </Ctx.Provider>
  );
}

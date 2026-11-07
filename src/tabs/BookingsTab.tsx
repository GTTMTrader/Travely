import { useEffect, useState } from 'react';
import { useTripCtx } from '../pages/TripLayout';
import type { Booking, BookingType } from '../lib/types';
import { BOOKING_LABEL, BOOKING_ORDER } from '../lib/types';
import { formatBytes, isOffline, saveAllOffline } from '../lib/files';
import { mdSlash } from '../lib/time';
import { isDemo } from '../data/backend';
import { Icon } from '../components/ui';
import BookingSheet from '../sheets/BookingSheet';
import BookingViewer from '../sheets/BookingViewer';

const TAG: Record<BookingType, string> = { flight: '', stay: 'pink', transport: 'blue', ticket: '', etc: 'grey' };

function when(b: Booking) {
  if (!b.startDate) return '날짜 미정';
  const s = `${mdSlash(b.startDate)}${b.startTime ? ` · ${b.startTime}` : ''}`;
  return b.endDate && b.endDate !== b.startDate ? `${mdSlash(b.startDate)} – ${mdSlash(b.endDate)}` : s;
}

export default function BookingsTab() {
  const c = useTripCtx();
  const [filter, setFilter] = useState<'all' | BookingType>('all');
  const [view, setView] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [offline, setOffline] = useState<{ done: number; total: number } | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  const list = [...c.bundle.bookings]
    .filter((b) => filter === 'all' || b.type === filter)
    .sort((a, b) => `${a.startDate ?? '9'}${a.startTime ?? ''}`.localeCompare(`${b.startDate ?? '9'}${b.startTime ?? ''}`));
  const files = c.bundle.files.filter((f) => f.complete);
  const totalBytes = c.bundle.files.reduce((s, f) => s + (f.size || 0), 0);

  useEffect(() => {
    let alive = true;
    (async () => {
      let n = 0;
      for (const f of files) if (await isOffline(c.tripId, f.id)) n++;
      if (alive) setSavedCount(n);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.length, c.tripId, offline]);

  return (
    <div className="t-body">
      <div className="row between" style={{ margin: '10px 0 14px' }}>
        <h2 style={{ fontSize: 28, margin: 0, letterSpacing: '-0.03em' }}>예약함</h2>
        <span className="tag" style={{ fontSize: 15, padding: '4px 12px' }}>{c.bundle.bookings.length}건</span>
      </div>
      <div className="chips">
        <button className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>전체</button>
        {BOOKING_ORDER.map((t) => <button key={t} className={`chip ${filter === t ? 'on' : ''}`} onClick={() => setFilter(t)}>{BOOKING_LABEL[t]}</button>)}
      </div>

      {files.length > 0 && (
        <button className="card soft pad row" style={{ width: '100%', margin: '16px 0 4px', textAlign: 'left', gap: 14 }}
          onClick={() => saveAllOffline(c.tripId, files, (done, total) => setOffline({ done, total })).then(() => setOffline(null))} data-testid="offline-all">
          <span className="icon-btn round" style={{ width: 52, height: 52, borderRadius: 16 }}><Icon name="download" /></span>
          <span className="grow">
            <b style={{ fontSize: 16 }}>이 여행 티켓 전부 오프라인 저장</b>
            <div className="tiny muted">
              {offline ? `저장 중 ${offline.done}/${offline.total}` : `인터넷 없이도 QR 열기 · ${savedCount ?? '?'}/${files.length}개 저장됨 · 전체 ${formatBytes(totalBytes)}`}
            </div>
          </span>
          <Icon name="next" />
        </button>
      )}

      <div className="row between" style={{ margin: '18px 2px 10px' }}>
        <b style={{ fontSize: 18 }}>{filter === 'all' ? '전체 예약' : BOOKING_LABEL[filter]}</b>
        <span className="faint small">이용 날짜순</span>
      </div>
      {list.length === 0 && <div className="empty-day">아직 예약이 없어요{c.editable ? ' · 아래 ‘+ 티켓 추가’로 캡처나 e티켓을 올려 보세요' : ''}</div>}
      {list.map((b) => {
        const first = b.fileIds.map((id) => c.files.get(id)).find(Boolean);
        return (
          <button key={b.id} className="bk-card" onClick={() => setView(b.id)} data-testid="booking">
            <div className={`bk-thumb ${first ? '' : 'empty'}`}>
              {first ? (
                first.thumb ? <img src={first.thumb} alt={`${b.title} 미리보기`} /> : <span className="tiny muted">{first.mime === 'application/pdf' ? 'PDF' : '파일'}</span>
              ) : (
                <>
                  <Icon name="plus" />
                  파일 추가
                </>
              )}
              {b.fileIds.length > 1 && <span className="count">{b.fileIds.length}</span>}
            </div>
            <div className="grow">
              <span className={`tag ${TAG[b.type]}`}>{BOOKING_LABEL[b.type]}</span>
              <h3>{b.title}</h3>
              <div className="small muted ellipsis">{b.reservationNo ? `예약번호 ${b.reservationNo}` : b.type === 'flight' && b.flight ? `${b.flight.airline} ${b.flight.flightNo}` : '예약번호 없음'}</div>
              <div className="small faint row" style={{ gap: 4, marginTop: 2 }}><Icon name="calendar" size={15} /> <span className="num">{when(b)}</span></div>
            </div>
            <Icon name="next" />
          </button>
        );
      })}
      <p className="hint" style={{ marginTop: 14 }}>
        이메일 연동·캡처 자동 인식은 아직 지원하지 않아요. 캡처·PDF를 올리면 친구와 같이 볼 수 있어요.{isDemo ? ' (미리보기에선 이 기기에만 보관)' : ''}
      </p>

      {c.editable && (
        <button className="fab" onClick={() => setAdding(true)} data-testid="add-booking"><Icon name="plus" /> 티켓 추가</button>
      )}
      {view && <BookingViewer bookingId={view} onClose={() => setView(null)} />}
      {adding && <BookingSheet onClose={() => setAdding(false)} />}
    </div>
  );
}

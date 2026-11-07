import { useEffect, useState } from 'react';
import { useTripCtx } from '../pages/TripLayout';
import type { FileMeta } from '../lib/types';
import { BOOKING_LABEL } from '../lib/types';
import { getFileBlob } from '../lib/files';
import { flightMinutes, formatMinutes, shortDateDow, tzLabel } from '../lib/time';
import { copyText, Icon, lockScroll, unlockScroll } from '../components/ui';
import ZoomView from '../components/ZoomView';
import BookingSheet from './BookingSheet';

type Page = { url: string; w: number; h: number } | { error: string };

/** 파일 한 개를 화면용 이미지 페이지들로 (PDF 는 페이지마다 렌더) */
async function toPages(tripId: string, meta: FileMeta): Promise<Page[]> {
  const { blob } = await getFileBlob(tripId, meta);
  if (meta.mime === 'application/pdf') {
    const { renderPdfPage } = await import('../lib/pdf');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const out: Page[] = [];
    for (let p = 1; p <= Math.min(meta.pages || 1, 20); p++) {
      const cv = await renderPdfPage(bytes, p, 2200);
      out.push({ url: cv.toDataURL('image/png'), w: cv.width, h: cv.height });
    }
    return out;
  }
  const url = URL.createObjectURL(blob);
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = url;
  });
  return [{ url, w: img.naturalWidth, h: img.naturalHeight }];
}

/** 예약 원본 크게 보기 — 여러 장 넘기기, 확대, 예약번호 복사, 관련 일정 */
export default function BookingViewer({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const c = useTripCtx();
  const b = c.bookings.get(bookingId);
  const files = (b?.fileIds ?? []).map((id) => c.files.get(id)).filter(Boolean) as FileMeta[];
  const [pages, setPages] = useState<Page[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [edit, setEdit] = useState(false);
  const fileKey = files.map((f) => `${f.id}:${f.complete}`).join(',');
  useEffect(() => {
    lockScroll();
    return () => unlockScroll();
  }, []);

  useEffect(() => {
    let alive = true;
    setPages(null);
    (async () => {
      const out: Page[] = [];
      for (const f of files) {
        if (!f.complete) {
          out.push({ error: `${f.name} · 아직 올리는 중이에요` });
          continue;
        }
        try {
          out.push(...(await toPages(c.tripId, f)));
        } catch (e) {
          out.push({ error: `${f.name} · ${(e as Error).message || '열 수 없어요 (연결 확인)'}` });
        }
      }
      if (alive) setPages(out);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey, c.tripId]);

  if (!b) return null;
  if (edit) return <BookingSheet booking={b} onClose={() => setEdit(false)} />;
  const cur = pages?.[idx];
  const linked = c.bundle.items.filter((i) => i.bookingIds.includes(b.id));
  const f = b.flight;

  return (
    <div className="viewer" role="dialog" aria-label="예약 보기" data-testid="viewer">
      <div className="top">
        <button className="icon-btn" onClick={onClose} aria-label="닫기"><Icon name="close" /></button>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="ellipsis" style={{ fontWeight: 800 }}>{b.title}</div>
          <div className="tiny" style={{ opacity: 0.7 }}>{BOOKING_LABEL[b.type]}{b.startDate ? ` · ${shortDateDow(b.startDate)}${b.startTime ? ` ${b.startTime}` : ''}` : ''}{b.endDate && b.endDate !== b.startDate ? ` – ${shortDateDow(b.endDate)}` : ''}</div>
        </div>
        {c.editable && <button className="icon-btn" onClick={() => setEdit(true)} aria-label="수정"><Icon name="edit" /></button>}
      </div>
      {files.length === 0 ? (
        <div className="stage" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666', flexDirection: 'column', gap: 12 }}>
          <span>올린 파일이 없어요</span>
          {c.editable && <button className="btn primary" onClick={() => setEdit(true)}><Icon name="plus" /> 파일 추가</button>}
        </div>
      ) : !pages ? (
        <div className="stage" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>불러오는 중…</div>
      ) : cur && 'url' in cur ? (
        <ZoomView key={idx} contentW={cur.w} contentH={cur.h}>
          <img src={cur.url} alt={`${b.title} ${idx + 1}`} style={{ width: cur.w, height: cur.h, display: 'block' }} draggable={false} data-testid="viewer-img" />
        </ZoomView>
      ) : (
        <div className="stage" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a33', padding: 20, textAlign: 'center' }}>{cur && 'error' in cur ? cur.error : ''}</div>
      )}
      <div className="bottom" style={{ flexWrap: 'wrap' }}>
        {pages && pages.length > 1 && (
          <div className="row" style={{ width: '100%', justifyContent: 'center' }}>
            <button className="btn sm" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>이전</button>
            <span className="small num">{idx + 1} / {pages.length}</span>
            <button className="btn sm" disabled={idx >= pages.length - 1} onClick={() => setIdx(idx + 1)}>다음</button>
          </div>
        )}
        {b.reservationNo && (
          <button className="btn soft grow" onClick={() => copyText(b.reservationNo, '예약번호 복사')} data-testid="copy-resno">
            <Icon name="copy" size={18} /> 예약번호 {b.reservationNo}
          </button>
        )}
        {f && (
          <div className="small" style={{ width: '100%', opacity: 0.85 }}>
            ✈ {f.airline} {f.flightNo} · {f.depCode} {f.depTime}({tzLabel(f.depTz)}) → {f.arrCode} {f.arrTime}({tzLabel(f.arrTz)})
            {(() => { const m = flightMinutes(f); return m ? ` · ${formatMinutes(m)}` : ''; })()}
            {f.depTerminal ? ` · 출발 T${f.depTerminal}` : ''}
          </div>
        )}
        {b.memo && <div className="small" style={{ width: '100%', opacity: 0.85, whiteSpace: 'pre-wrap' }}>{b.memo}</div>}
        {linked.length > 0 && <div className="tiny" style={{ width: '100%', opacity: 0.7 }}>연결된 일정: {linked.map((i) => i.place?.nameKo ?? (i.kind === 'flight' ? '항공편' : '메모')).join(', ')}</div>}
        <div className="tiny" style={{ width: '100%', opacity: 0.6 }}>QR을 찍을 땐 화면 밝기를 올려 주세요 · 두 번 탭하면 확대돼요</div>
      </div>
    </div>
  );
}

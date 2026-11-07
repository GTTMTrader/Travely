import { useEffect, useMemo, useRef, useState } from 'react';
import { useTripCtx } from '../pages/TripLayout';
import { buildAlbumImages, buildAlbumPdf, shareOrDownload, type AlbumInput } from '../lib/album';
import { shortDateDow } from '../lib/time';
import { Icon, Sheet, dayColor, toast } from '../components/ui';

const MAX_PER_DAY = 8;

/** 사진 미리보기 (작은 썸네일, 원본은 그대로 File 로 보관) */
function Thumb({ file, onRemove }: { file: File; onRemove: () => void }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="al-thumb">
      <img src={url} alt="" />
      <button aria-label="사진 빼기" onClick={onRemove}>×</button>
    </div>
  );
}

function PickButton({ label, onPick, multiple = true, testId }: { label: string; onPick: (f: File[]) => void; multiple?: boolean; testId?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className="al-add" onClick={() => ref.current?.click()}>
        <Icon name="plus" size={20} />
        <span>{label}</span>
      </button>
      <input ref={ref} type="file" accept="image/*" multiple={multiple} hidden data-testid={testId}
        onChange={(e) => { onPick([...(e.target.files ?? [])].filter((f) => f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name))); e.target.value = ''; }} />
    </>
  );
}

/** 추억 앨범: 일정 + 직접 고른 사진 → PDF 한 권 + 날짜별 이미지 카드 (사진은 이 폰에서만 사용, 서버 저장 없음) */
export default function AlbumSheet({ onClose }: { onClose: () => void }) {
  const c = useTripCtx();
  const days = c.bundle.days;
  const [cover, setCover] = useState<File | null>(null);
  const [photos, setPhotos] = useState<Record<string, File[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [pdf, setPdf] = useState<File | null>(null);
  const [images, setImages] = useState<File[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const input = (): AlbumInput => ({
    trip: c.bundle.trip,
    days: days.map((d) => ({ day: d, items: c.byDay.get(d.date) ?? [], photos: photos[d.date] ?? [] })),
    cover: cover ?? days.map((d) => photos[d.date]?.[0]).find(Boolean) ?? null,
    names: c.activeMembers.map((m) => m.displayName),
    legs: c.legs,
  });
  const reset = () => {
    setPdf(null);
    setImages(null);
  };
  const addPhotos = (date: string, files: File[]) => {
    const cur = photos[date] ?? [];
    const room = MAX_PER_DAY - cur.length;
    if (files.length > room) toast(`하루 ${MAX_PER_DAY}장까지 넣을 수 있어요`);
    setPhotos({ ...photos, [date]: [...cur, ...files.slice(0, Math.max(0, room))] });
    reset();
  };
  const total = Object.values(photos).reduce((s, l) => s + l.length, 0);
  const fileBase = c.bundle.trip.name.replace(/[\\/:*?"<>|]/g, '').trim() || 'Travely';

  const make = async () => {
    setErr(null);
    reset();
    try {
      setBusy('앨범 PDF 만드는 중…');
      const blob = await buildAlbumPdf(input(), (d, t) => setBusy(`앨범 PDF 만드는 중… ${d}/${t}`));
      setPdf(new File([blob], `${fileBase} 추억 앨범.pdf`, { type: 'application/pdf' }));
      setBusy('날짜별 이미지 만드는 중…');
      setImages(await buildAlbumImages(input(), (d, t) => setBusy(`날짜별 이미지 만드는 중… ${d}/${t}`)));
    } catch (e) {
      setErr(`만들지 못했어요: ${(e as Error).message}. 사진 수를 줄여서 다시 해 보세요.`);
    } finally {
      setBusy(null);
    }
  };
  const save = async (files: File[], what: string) => {
    const r = await shareOrDownload(files);
    if (r === 'downloaded') toast(`${what}을(를) 내려받았어요`);
  };
  const mb = (f: File[]) => (f.reduce((s, x) => s + x.size, 0) / 1024 / 1024).toFixed(1);

  return (
    <Sheet onClose={onClose} label="추억 앨범 만들기" wide>
      <h3>추억 앨범 만들기</h3>
      <p className="small muted" style={{ marginTop: -8 }}>
        일정표에 사진을 곁들여 앨범 PDF 한 권과 날짜별 이미지 카드를 만들어요. 사진은 이 폰 안에서만 쓰이고 서버에 올라가지 않아요.
      </p>

      <div className="al-sec">
        <div className="al-head"><b>표지 사진</b><span className="faint small">안 고르면 첫날 첫 사진</span></div>
        <div className="al-grid">
          {cover ? <Thumb file={cover} onRemove={() => { setCover(null); reset(); }} /> : <PickButton label="표지" multiple={false} onPick={(f) => { setCover(f[0] ?? null); reset(); }} testId="album-cover" />}
        </div>
      </div>

      {days.map((d) => {
        const list = photos[d.date] ?? [];
        const col = dayColor(d.index);
        return (
          <div className="al-sec" key={d.date}>
            <div className="al-head">
              <span className="day-pill" style={{ background: col.soft, color: col.ink }}>DAY {d.index + 1}</span>
              <b className="small">{shortDateDow(d.date)}{d.city ? ` · ${d.city}` : ''}</b>
              <span className="faint small" style={{ marginLeft: 'auto' }}>{list.length}/{MAX_PER_DAY}</span>
            </div>
            <div className="al-grid">
              {list.map((f, i) => <Thumb key={`${f.name}-${i}`} file={f} onRemove={() => { setPhotos({ ...photos, [d.date]: list.filter((_, j) => j !== i) }); reset(); }} />)}
              {list.length < MAX_PER_DAY && <PickButton label="사진" onPick={(f) => addPhotos(d.date, f)} testId={`album-photos-${d.date}`} />}
            </div>
          </div>
        );
      })}

      {err && <p className="err">{err}</p>}

      {!pdf && (
        <button className="btn primary block" style={{ marginTop: 6 }} disabled={!!busy} onClick={make} data-testid="album-make">
          {busy ?? `앨범 만들기${total ? ` (사진 ${total}장)` : ''}`}
        </button>
      )}
      {busy && pdf && <p className="small muted" style={{ textAlign: 'center' }}>{busy}</p>}

      {pdf && (
        <div className="card soft pad" style={{ marginTop: 8 }} data-testid="album-done">
          <b style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="check" size={18} /> 다 만들었어요</b>
          <div className="col" style={{ marginTop: 10, gap: 8 }}>
            <button className="btn primary block" onClick={() => save([pdf], '앨범 PDF')} data-testid="album-save-pdf">
              <Icon name="file" size={18} /> 앨범 PDF 저장 · 보내기 ({mb([pdf])}MB)
            </button>
            {images && (
              <button className="btn block" onClick={() => save(images, '이미지')} data-testid="album-save-images">
                <Icon name="camera" size={18} /> 사진첩에 이미지 {images.length}장 저장 ({mb(images)}MB)
              </button>
            )}
          </div>
          <p className="hint" style={{ marginBottom: 0 }}>
            PDF: 공유 화면에서 ‘파일에 저장’ → 원하는 폴더 / 카톡으로 보내기.<br />
            이미지: 공유 화면에서 ‘이미지 {images?.length ?? ''}개 저장’ → 사진첩.
          </p>
          <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={make} disabled={!!busy}>다시 만들기</button>
        </div>
      )}
    </Sheet>
  );
}

import { useState } from 'react';
import { useTripCtx } from '../pages/TripLayout';
import { backupFileName, backupJson, backupSummary, buildBackupHtml, makeBackup, type TravelyBackup } from '../lib/backup';
import { shareOrDownload } from '../lib/album';
import { formatBytes } from '../lib/files';
import { Icon, Sheet, toast } from '../components/ui';

/** 여행 전체 백업: 보기용 앱 + 원본 데이터 + 첨부 파일 → HTML 한 개 */
export default function BackupSheet({ onClose }: { onClose: () => void }) {
  const c = useTripCtx();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ b: TravelyBackup; html: File; json: File } | null>(null);

  const make = async () => {
    setErr(null);
    setDone(null);
    try {
      setBusy('백업 보기 화면 받는 중…');
      const res = await fetch(`./archive.html?v=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('백업 보기 화면을 받지 못했어요');
      const viewer = await res.text();
      const b = await makeBackup(c.tripId, { uid: c.user.uid, displayName: c.me.displayName || c.user.displayName }, setBusy);
      setBusy('파일로 묶는 중…');
      const html = new File([buildBackupHtml(viewer, b)], backupFileName(b, 'html'), { type: 'text/html' });
      const json = new File([backupJson(b)], backupFileName(b, 'json'), { type: 'application/json' });
      setDone({ b, html, json });
    } catch (e) {
      setErr(`백업을 만들지 못했어요: ${(e as Error).message}. 인터넷 연결을 확인하고 다시 해 보세요.`);
    } finally {
      setBusy(null);
    }
  };
  const save = async (f: File) => {
    const r = await shareOrDownload([f]);
    if (r === 'downloaded') toast('백업 파일을 내려받았어요');
  };
  const s = done ? backupSummary(done.b) : null;

  return (
    <Sheet onClose={onClose} label="여행 백업" wide>
      <h3>여행 백업 만들기</h3>
      <p className="small muted" style={{ marginTop: -8 }}>
        일정·이동·예약·첨부 파일(원본)·가계부·준비물을 <b>HTML 파일 한 개</b>에 그대로 담아요. 그 파일 안에 보기용 앱이 같이 들어 있어서, 나중에 서버나 인터넷이 없어도 지금처럼 눌러 보며 볼 수 있어요.
      </p>

      {!done && (
        <button className="btn primary block" disabled={!!busy || !c.online} onClick={make} data-testid="backup-make">
          {busy ?? '백업 만들기'}
        </button>
      )}
      {!c.online && !done && <p className="hint">인터넷이 연결돼 있어야 서버의 최신 데이터를 빠짐없이 담을 수 있어요.</p>}
      {err && <p className="err">{err}</p>}

      {done && s && (
        <div className="card soft pad" data-testid="backup-done">
          <b style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="check" size={18} /> 백업 준비 완료</b>
          <dl className="kv" style={{ marginTop: 8 }}>
            <dt>일정</dt><dd>{s.items}개</dd>
            <dt>예약</dt><dd>{s.bookings}개</dd>
            <dt>첨부 파일</dt><dd>{s.files}개 · {formatBytes(s.fileBytes)}</dd>
            <dt>가계부</dt><dd>{s.expenses}건</dd>
            <dt>준비물</dt><dd>{s.packing}개</dd>
            <dt>함께한 사람</dt><dd>{s.members.join(', ')}</dd>
          </dl>
          {s.missing > 0 && (
            <p className="err" data-testid="backup-missing">
              첨부 파일 {s.missing}개는 담지 못했어요: {done.b.missingFiles.map((m) => m.name).join(', ')}
            </p>
          )}
          <div className="col" style={{ marginTop: 10, gap: 8 }}>
            <button className="btn primary block" onClick={() => save(done.html)} data-testid="backup-save-html">
              <Icon name="file" size={18} /> 백업 파일 저장 (.html · {formatBytes(done.html.size)})
            </button>
            <button className="btn block" onClick={() => save(done.json)} data-testid="backup-save-json">
              데이터만 따로 저장 (.json · {formatBytes(done.json.size)})
            </button>
          </div>
          <p className="hint" style={{ marginBottom: 0 }}>
            아이폰: 공유 화면에서 ‘파일에 저장’ → 원하는 폴더(외장 저장장치도 가능).<br />
            다시 볼 때: PC 는 파일을 더블클릭, 아이폰은 Travely 첫 화면 → ‘백업 파일 열기’.<br />
            .json 은 같은 내용의 데이터만(보기 앱 없이) 한 번 더 남겨 두는 용도예요.
          </p>
        </div>
      )}
    </Sheet>
  );
}

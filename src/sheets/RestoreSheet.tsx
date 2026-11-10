import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { backupSummary, parseBackup, restoreBackup, stashBackupText, type TravelyBackup } from '../lib/backup';
import { describeError } from '../lib/saveStatus';
import { formatBytes } from '../lib/files';
import { formatDateTime, shortDateDow } from '../lib/time';
import { Icon, Sheet, toast } from '../components/ui';
import type { SessionUser } from '../data/repo';

/** 첫 화면 → 백업 파일 열기: 이 기기에서 둘러보기 / 새 여행으로 되살리기 */
export default function RestoreSheet({ user, onClose }: { user: SessionUser; onClose: () => void }) {
  const nav = useNavigate();
  const [file, setFile] = useState<{ text: string; b: TravelyBackup } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sure, setSure] = useState(false);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    setFile(null);
    setSure(false);
    setBusy('파일 읽는 중…');
    try {
      const text = await f.text();
      setFile({ text, b: parseBackup(text) });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const view = async () => {
    if (!file) return;
    setBusy('여는 중…');
    try {
      await stashBackupText(file.text);
      location.href = './archive.html';
    } catch (e) {
      setErr(`열지 못했어요: ${(e as Error).message}`);
      setBusy(null);
    }
  };
  const restore = async () => {
    if (!file) return;
    if (!sure) return setSure(true);
    setErr(null);
    setBusy('되살리는 중…');
    try {
      const id = await restoreBackup(user, file.b, setBusy);
      toast('새 여행으로 되살렸어요');
      nav(`/trip/${id}/plan`);
    } catch (e) {
      setErr(`되살리지 못했어요: ${describeError(e)}. 일부만 만들어졌다면 그 여행을 지우고 다시 해 주세요.`);
      setBusy(null);
    }
  };
  const s = file ? backupSummary(file.b) : null;

  return (
    <Sheet onClose={onClose} label="백업 파일 열기">
      <h3>백업 파일 열기</h3>
      <p className="small muted" style={{ marginTop: -8 }}>Travely 에서 만든 여행 백업(.html 또는 .json)을 골라 주세요.</p>
      <label className="btn block" style={{ marginBottom: 12 }}>
        <Icon name="file" size={18} /> {busy && !file ? busy : file ? '다른 파일 고르기' : '백업 파일 고르기'}
        <input type="file" accept=".html,.htm,.json,text/html,application/json" hidden onChange={(e) => onFile(e.target.files?.[0])} data-testid="restore-file" />
      </label>
      {err && <p className="err">{err}</p>}

      {file && s && (
        <div data-testid="restore-preview">
          <div className="card pad" style={{ marginBottom: 12 }}>
            <b style={{ fontSize: 17 }}>{s.name}</b>
            <div className="small muted num" style={{ marginTop: 2 }}>{shortDateDow(s.startDate)} – {shortDateDow(s.endDate)} · {s.members.join(', ')}</div>
            <div className="small" style={{ marginTop: 8 }}>
              일정 {s.items} · 예약 {s.bookings} · 첨부 {s.files}개({formatBytes(s.fileBytes)}) · 가계부 {s.expenses} · 준비물 {s.packing}
            </div>
            <div className="faint tiny" style={{ marginTop: 4 }}>{formatDateTime(file.b.exportedAt)} 에 {file.b.exportedBy.displayName} 님이 백업</div>
          </div>
          <div className="col" style={{ gap: 8 }}>
            <button className="btn primary block" onClick={view} disabled={!!busy} data-testid="restore-view">
              이 기기에서 열어 보기 (읽기 전용)
            </button>
            <button className={`btn block ${sure ? 'danger' : ''}`} onClick={restore} disabled={!!busy} data-testid="restore-run">
              {busy && file ? busy : sure ? '정말 되살릴까요? 한 번 더' : '새 여행으로 되살리기 (서버에 저장)'}
            </button>
          </div>
          <p className="hint">
            열어 보기: 서버에 아무것도 저장하지 않고 그때 모습 그대로 둘러봐요.<br />
            되살리기: 내 여행 목록에 같은 내용의 여행이 새로 생기고 다시 고칠 수 있어요. 같이 간 사람은 새 여행에 다시 초대해야 하고, 같은 계정으로 들어오면 가계부의 결제·분담이 그대로 이어져요.
          </p>
        </div>
      )}
    </Sheet>
  );
}

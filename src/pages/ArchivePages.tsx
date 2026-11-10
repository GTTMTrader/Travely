import { useState } from 'react';
import { archiveInfo } from '../data/backend';
import { BACKUP_SCRIPT_ID, parseBackup, stashBackupText } from '../lib/backup';
import { formatDateTime } from '../lib/time';
import { Icon, Logo } from '../components/ui';

/** 백업 파일 고르기 → 이 기기(같은 사이트 저장공간)에 넣고 다시 열기 */
function PickBackup({ label, className }: { label: string; className: string }) {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setErr(null);
    setBusy(true);
    try {
      const text = await f.text();
      parseBackup(text);
      await stashBackupText(text);
      location.hash = '';
      location.reload();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <>
      <label className={className} aria-disabled={busy}>
        <Icon name="file" size={18} /> {busy ? '여는 중…' : label}
        <input type="file" accept=".html,.htm,.json,text/html,application/json" hidden onChange={(e) => onFile(e.target.files?.[0])} data-testid="archive-pick" />
      </label>
      {err && <p className="err">{err}</p>}
    </>
  );
}

export function ArchivePicker({ error }: { error: string | null }) {
  return (
    <div className="page">
      <Logo />
      <div className="card pad" style={{ marginTop: 24 }}>
        <h3 style={{ marginTop: 0 }}>여행 백업 보기</h3>
        <p className="muted">Travely 에서 만든 백업 파일(.html)을 고르면 그때 그 여행을 앱처럼 둘러볼 수 있어요. 데이터는 이 기기에서만 열리고 서버로 가지 않아요.</p>
        {error && <p className="err">{error}</p>}
        <PickBackup label="백업 파일 고르기" className="btn primary block" />
      </div>
    </div>
  );
}

export function ArchiveRibbon() {
  if (!archiveInfo) return null;
  const embedded = !!document.getElementById(BACKUP_SCRIPT_ID);
  return (
    <div className="demo-ribbon archive-ribbon" data-testid="archive-ribbon">
      <span>📦 백업 보기 · 읽기 전용 · {formatDateTime(archiveInfo.exportedAt)} 저장</span>
      {archiveInfo.missing > 0 && <span> · 첨부 {archiveInfo.missing}개 빠짐</span>}
      {!embedded && <PickBackup label="다른 백업" className="ribbon-link" />}
    </div>
  );
}

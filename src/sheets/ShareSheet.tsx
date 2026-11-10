import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTripCtx } from '../pages/TripLayout';
import { useInvites } from '../data/hooks';
import { createInvite, deleteTrip, leaveTrip, removeMember, restoreMember, revokeInvite, setMemberRole } from '../data/repo';
import { describeError } from '../lib/saveStatus';
import { formatDateTime } from '../lib/time';
import { isArchive, isDemo } from '../data/backend';
import { ConfirmButton, copyText, Icon, Sheet } from '../components/ui';
import TripFormSheet from './TripFormSheet';
import AlbumSheet from './AlbumSheet';
import BackupSheet from './BackupSheet';

const ROLE = { owner: '만든 사람', editor: '같이 편집', viewer: '보기 전용' } as const;

/** 오른쪽 위 사람 아이콘: 멤버·초대 링크·여행 설정 */
export default function ShareSheet({ onClose }: { onClose: () => void }) {
  const c = useTripCtx();
  const isOwner = !isArchive && c.me.role === 'owner';
  const invites = useInvites(c.tripId, isOwner);
  const nav = useNavigate();
  const [role, setRole] = useState<'editor' | 'viewer'>('editor');
  const [days, setDays] = useState(7);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [album, setAlbum] = useState(false);
  const [backup, setBackup] = useState(false);
  const now = Date.now();
  const activeInv = invites.filter((i) => !i.revoked && i.expiresAt > now);

  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(describeError(e));
    }
  };
  const linkOf = (token: string) => `${location.origin}${location.pathname}#/join/${c.tripId}/${token}`;
  const send = async (link: string) => {
    if (navigator.share) {
      try {
        await navigator.share({ title: `${c.bundle.trip.name} 초대`, text: `‘${c.bundle.trip.name}’ 여행 같이 준비하자!`, url: link });
        return;
      } catch {
        /* 취소 → 복사 */
      }
    }
    await copyText(link, '링크 복사');
  };

  if (album) return <AlbumSheet onClose={() => setAlbum(false)} />;
  if (backup) return <BackupSheet onClose={() => setBackup(false)} />;
  if (edit) return <TripFormSheet user={c.user} bundle={c.bundle} onClose={() => setEdit(false)} />;

  return (
    <Sheet onClose={onClose} label="공유·설정">
      <h3>함께하는 사람</h3>
      <div className="card list" data-testid="members">
        {c.bundle.members.filter((m) => m.status === 'active').map((m) => (
          <div className="list-row" key={m.uid}>
            <span className="icon-btn round sm" style={{ fontWeight: 800 }}>{m.displayName.slice(0, 1)}</span>
            <div className="grow"><b>{m.displayName}</b>{m.uid === c.user.uid && <span className="faint small"> (나)</span>}</div>
            {isOwner && m.role !== 'owner' ? (
              <>
                <select className="select" style={{ width: 'auto', minHeight: 36, padding: '4px 8px' }} value={m.role} aria-label="권한" id={`role-${m.uid}`}
                  onChange={(e) => run(() => setMemberRole(c.tripId, m.uid, e.target.value as 'editor' | 'viewer'))}>
                  <option value="editor">같이 편집</option>
                  <option value="viewer">보기 전용</option>
                </select>
                <button className="btn sm danger" onClick={() => run(() => removeMember(c.tripId, m.uid))}>내보내기</button>
              </>
            ) : (
              <span className="tag grey">{ROLE[m.role]}</span>
            )}
          </div>
        ))}
        {isOwner && c.bundle.members.filter((m) => m.status === 'removed').map((m) => (
          <div className="list-row" key={m.uid} style={{ opacity: 0.6 }}>
            <div className="grow">{m.displayName} <span className="tag danger">접근 해제됨</span></div>
            <button className="btn sm" onClick={() => run(() => restoreMember(c.tripId, m.uid))}>복구</button>
          </div>
        ))}
      </div>

      {isOwner && (
        <>
          <h3 style={{ marginTop: 22 }}>친구 초대</h3>
          <div className="card pad">
            <div className="row">
              <label className="field grow">
                <span className="label">권한</span>
                <select className="select" id="inv-role" value={role} onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}>
                  <option value="editor">같이 편집 (기본)</option>
                  <option value="viewer">보기 전용</option>
                </select>
              </label>
              <label className="field grow">
                <span className="label">링크 만료</span>
                <select className="select" id="inv-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
                  <option value={1}>1일 후</option>
                  <option value={7}>7일 후</option>
                  <option value={30}>30일 후</option>
                </select>
              </label>
            </div>
            <button className="btn primary block" data-testid="make-invite"
              onClick={() => run(async () => setUrl(linkOf(await createInvite(c.tripId, c.user.uid, role, days, c.bundle.trip.name, c.user.displayName))))}>
              <Icon name="link" /> 초대 링크 만들기
            </button>
            {url && (
              <div style={{ marginTop: 10 }}>
                <input className="input small" readOnly value={url} data-testid="invite-url" id="invite-url" onFocus={(e) => e.target.select()} />
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn soft grow" onClick={() => send(url)}>카톡 등으로 보내기</button>
                  <button className="btn grow" onClick={() => copyText(url, '링크 복사')}>복사</button>
                </div>
                {isDemo && <p className="hint">미리보기에서 만든 링크는 실제로 열리지 않아요.</p>}
              </div>
            )}
          </div>
          {activeInv.length > 0 && (
            <div className="card list" style={{ marginTop: 10 }} data-testid="invites">
              {activeInv.map((i) => (
                <div className="list-row" key={i.token}>
                  <div className="grow small"><b>{i.role === 'editor' ? '같이 편집' : '보기 전용'}</b> 링크 …{i.token.slice(-5)}<div className="faint tiny">만료 {formatDateTime(i.expiresAt)}</div></div>
                  <button className="btn sm" onClick={() => copyText(linkOf(i.token), '링크 복사')}>복사</button>
                  <button className="btn sm danger" onClick={() => run(() => revokeInvite(c.tripId, i.token))}>폐기</button>
                </div>
              ))}
            </div>
          )}
          <p className="hint">링크 폐기는 새로 참여하는 것만 막아요. 이미 참여한 사람은 위에서 ‘내보내기’로 막을 수 있어요.</p>
        </>
      )}

      <h3 style={{ marginTop: 22 }}>여행 설정</h3>
      <div className="col">
        <button className="btn block album-btn" onClick={() => setAlbum(true)} data-testid="open-album"><Icon name="camera" /> 추억 앨범 만들기 (PDF · 사진첩)</button>
        {c.canEditRole && <button className="btn block" onClick={() => setEdit(true)} disabled={!c.editable} data-testid="edit-trip"><Icon name="settings" /> 여행 정보 수정 (이름·도시·기간·통화)</button>}
        {!isArchive && <button className="btn block" onClick={() => setBackup(true)} data-testid="open-backup"><Icon name="file" /> 여행 백업 만들기 (전체 보관용)</button>}
        {isArchive ? null : isOwner ? (
          <ConfirmButton label="여행 삭제" confirmLabel="정말 삭제 (모두에게서 사라져요)" onConfirm={() => run(async () => { await deleteTrip(c.tripId, c.user.uid); nav('/'); })} />
        ) : (
          <ConfirmButton label="이 여행에서 나가기" confirmLabel="정말 나가기" onConfirm={() => run(async () => { await leaveTrip(c.tripId, c.user.uid); nav('/'); })} />
        )}
      </div>
      {err && <p className="err">{err}</p>}
    </Sheet>
  );
}

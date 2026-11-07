import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useUser } from '../data/hooks';
import { acceptInvite, checkInvite, type InviteCheck } from '../data/repo';
import { describeError } from '../lib/saveStatus';
import { formatDateTime } from '../lib/time';
import { Logo } from '../components/ui';

export default function JoinPage() {
  const { tripId = '', token = '' } = useParams();
  const { user } = useUser();
  const nav = useNavigate();
  const [check, setCheck] = useState<InviteCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    checkInvite(tripId, token, user.uid)
      .then((r) => (r.status === 'member' ? nav(`/trip/${tripId}/plan`, { replace: true }) : setCheck(r)))
      .catch((e) => setErr(describeError(e)));
  }, [user, tripId, token, nav]);

  const join = async () => {
    if (!user || check?.status !== 'ok') return;
    setBusy(true);
    setErr(null);
    try {
      await acceptInvite(tripId, token, user, check.invite.role);
      nav(`/trip/${tripId}/plan`, { replace: true });
    } catch (e) {
      setErr((e as { code?: string }).code?.includes('permission') ? '초대가 더 이상 유효하지 않아 참여할 수 없어요 (서버 거부)' : describeError(e));
    } finally {
      setBusy(false);
    }
  };

  let body;
  if (err && !check) body = <p className="err">{err}</p>;
  else if (!check) body = <p className="muted">초대 확인 중…</p>;
  else if (check.status === 'ok')
    body = (
      <>
        <p style={{ fontSize: 18, margin: '0 0 8px', lineHeight: 1.5 }}>
          <b>{check.invite.inviterName}</b> 님이 <b>‘{check.invite.tripName}’</b> 여행에 초대했어요.
        </p>
        <p className="muted small" style={{ marginTop: 0 }}>
          참여하면 {check.invite.role === 'editor' ? '일정·예약·가계부·준비물을 같이 편집할 수 있어요.' : '내용을 볼 수 있어요(보기 전용).'}
          <br />링크 만료: {formatDateTime(check.invite.expiresAt)}
        </p>
        {err && <p className="err">{err}</p>}
        <button className="btn primary block xl" onClick={join} disabled={busy} data-testid="join">{busy ? '참여하는 중…' : '여행에 참여하기'}</button>
      </>
    );
  else
    body = (
      <p className="err" style={{ fontSize: 16 }}>
        {check.status === 'expired' && '만료된 초대 링크예요. 새 링크를 요청해 주세요.'}
        {check.status === 'revoked' && '폐기된 초대 링크예요. 새 링크를 요청해 주세요.'}
        {check.status === 'notfound' && '존재하지 않는 초대 링크예요. 주소를 다시 확인해 주세요.'}
        {check.status === 'removed' && '이 여행에서 접근이 해제된 계정이에요. 여행을 만든 사람에게 복구를 요청해 주세요.'}
      </p>
    );

  return (
    <div className="page" style={{ paddingTop: 48 }}>
      <Logo />
      <div className="card pad" style={{ marginTop: 24 }}>{body}</div>
      <p style={{ marginTop: 16 }}><Link to="/">내 여행으로</Link></p>
    </div>
  );
}

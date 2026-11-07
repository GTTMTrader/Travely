import { useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { getAuth } from '../data/backend';
import { useUser } from '../data/hooks';
import { Logo } from '../components/ui';

function authMessage(code: string): string {
  if (/invalid-credential|wrong-password|user-not-found/.test(code)) return '이메일 또는 비밀번호가 맞지 않아요';
  if (code.includes('email-already-in-use')) return '이미 가입된 이메일이에요. 로그인해 주세요';
  if (code.includes('weak-password')) return '비밀번호는 6자 이상이어야 해요';
  if (code.includes('invalid-email')) return '이메일 형식을 확인해 주세요';
  if (code.includes('network-request-failed')) return '인증 서버에 연결할 수 없어요 (네트워크 확인)';
  if (code.includes('popup')) return '팝업이 막혔어요. 다시 시도해 주세요';
  return `로그인에 실패했어요 (${code})`;
}

export default function LoginPage() {
  const { user, loading } = useUser();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  if (!loading && user) return <Navigate to={next} replace />;
  const auth = getAuth();
  const code = (e: unknown) => (e as { code?: string }).code ?? String(e);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === 'up') await auth.signUp(name.trim(), email.trim(), pw);
      else await auth.signIn(email.trim(), pw);
    } catch (err) {
      setMsg(authMessage(code(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ paddingTop: 48 }}>
      <Logo />
      <h1 className="h-title">함께 떠나는 여행</h1>
      <p className="muted" style={{ marginTop: 0 }}>친구와 일정·예약·가계부·준비물을 실시간으로 같이 관리해요</p>
      {next.startsWith('/join/') && (
        <div className="card soft pad" style={{ marginBottom: 14 }}>초대받은 여행에 참여하려면 먼저 로그인하거나 가입해 주세요. 끝나면 초대 화면으로 돌아가요.</div>
      )}
      <div className="card pad">
        <div className="seg" style={{ marginBottom: 16 }}>
          <button type="button" className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>로그인</button>
          <button type="button" className={mode === 'up' ? 'on' : ''} onClick={() => setMode('up')}>가입</button>
        </div>
        <form onSubmit={submit}>
          {mode === 'up' && (
            <label className="field">
              <span className="label">이름 (친구에게 보이는 이름)</span>
              <input className="input" id="name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
            </label>
          )}
          <label className="field">
            <span className="label">이메일</span>
            <input className="input" id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>
          <label className="field">
            <span className="label">비밀번호</span>
            <input className="input" id="password" type="password" required minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={mode === 'up' ? 'new-password' : 'current-password'} />
          </label>
          {msg && <p className="err">{msg}</p>}
          <button className="btn primary block" disabled={busy}>{busy ? '잠시만요…' : mode === 'up' ? '가입하고 시작' : '로그인'}</button>
        </form>
        {mode === 'in' && (
          <button type="button" className="btn ghost sm" style={{ marginTop: 6 }}
            onClick={() => (email ? auth.resetPassword(email.trim()).then(() => setMsg('재설정 메일을 보냈어요'), (e) => setMsg(authMessage(code(e)))) : setMsg('이메일을 먼저 입력해 주세요'))}>
            비밀번호를 잊었어요
          </button>
        )}
        <div className="hint" style={{ textAlign: 'center', margin: '12px 0 8px' }}>또는</div>
        <button type="button" className="btn block" onClick={() => auth.signInGoogle().catch((e) => setMsg(authMessage(code(e))))}>Google 계정으로 계속</button>
        <p className="hint" style={{ marginBottom: 0 }}>중국 현지 회선에서는 로그인이 막힐 수 있어요. 출국 전에 로그인해 두면 계속 유지돼요.</p>
      </div>
    </div>
  );
}

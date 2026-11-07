import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { initBackend, isDemo } from './data/backend';
import { useUser } from './data/hooks';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import JoinPage from './pages/JoinPage';
import TripLayout from './pages/TripLayout';
import { Logo, ToastHost } from './components/ui';

function SetupNeeded() {
  return (
    <div className="page">
      <Logo />
      <div className="card pad" style={{ marginTop: 24 }}>
        <h3 style={{ marginTop: 0 }}>Firebase 설정이 아직 없어요</h3>
        <p className="muted">
          GitHub 저장소 Settings → Secrets and variables → Actions 에 Firebase 웹 앱 설정값을 넣고 다시 배포해 주세요.
          자세한 순서는 README 의 「처음 설정」에 있어요.
        </p>
      </div>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useUser();
  const loc = useLocation();
  if (loading) return <div className="center-msg">불러오는 중…</div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return <>{children}</>;
}

export default function App() {
  const [state, setState] = useState<'loading' | 'ok' | 'config'>('loading');
  useEffect(() => {
    initBackend().then((r) => setState(r.ok ? 'ok' : 'config'));
  }, []);
  if (state === 'loading') return <div className="app"><div className="center-msg">불러오는 중…</div></div>;
  if (state === 'config') return <div className="app"><SetupNeeded /></div>;
  return (
    <div className="app">
      {isDemo && <div className="demo-ribbon">미리보기 · 서버에 저장되지 않아요 · ‘(예시)’ 항목은 설명용</div>}
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<RequireAuth><HomePage /></RequireAuth>} />
        <Route path="/join/:tripId/:token" element={<RequireAuth><JoinPage /></RequireAuth>} />
        <Route path="/trip/:tripId/:tab" element={<RequireAuth><TripLayout /></RequireAuth>} />
        <Route path="/trip/:tripId" element={<RequireAuth><TripLayout /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastHost />
    </div>
  );
}

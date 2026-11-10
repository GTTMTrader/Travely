import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { blockPageZoom } from './lib/noZoom';
import 'leaflet/dist/leaflet.css';
import './styles.css';

blockPageZoom();

// 서비스워커(PWA)는 실제 배포 빌드에서만 등록 + 새 버전 자동 감지
if (import.meta.env.PROD && !import.meta.env.VITE_DATA_MODE) {
  import('virtual:pwa-register')
    .then(({ registerSW }) =>
      registerSW({
        immediate: true,
        onRegisteredSW(_url, reg) {
          if (!reg) return;
          setInterval(() => reg.update().catch(() => undefined), 30 * 60 * 1000);
        },
      }),
    )
    .catch(() => undefined);
  import('./lib/updateCheck').then(({ startUpdateCheck }) => startUpdateCheck()).catch(() => undefined);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);

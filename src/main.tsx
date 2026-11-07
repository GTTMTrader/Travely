import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import 'leaflet/dist/leaflet.css';
import './styles.css';

// 서비스워커(PWA)는 실제 배포 빌드에서만 등록
if (import.meta.env.PROD && import.meta.env.VITE_DATA_MODE !== 'memory') {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => undefined);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);

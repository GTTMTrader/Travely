import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages 하위 경로(https://<계정>.github.io/<저장소>/)에서도 동작하도록 상대 경로(base './') + HashRouter 사용
// 빌드마다 고유 번호 → version.json 과 비교해 새 버전이면 자동 교체 (아이폰 홈 화면 앱은 스스로 잘 갱신하지 않음)
const BUILD_ID = new Date().toISOString();

export default defineConfig(({ mode }) => ({
  base: './',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    {
      name: 'travely-version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
      },
    },
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      disable: mode === 'memory',
      includeAssets: ['icons/*.png', 'icons/icon.svg'],
      manifest: {
        name: 'Travely — 함께 쓰는 여행 플래너',
        short_name: 'Travely',
        description: '친구와 일정·예약·가계부·준비물을 실시간으로 같이 관리하는 여행 플래너',
        lang: 'ko',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#fbfaff',
        theme_color: '#6d3df2',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 앱 화면 파일만 캐시. 일정 데이터는 Firestore 로컬 캐시, 예약 파일은 IndexedDB 가 담당. 지도 타일은 캐시하지 않음.
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,mjs}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  server: { host: '127.0.0.1', port: 5173 },
}));

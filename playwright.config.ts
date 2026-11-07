import { defineConfig, devices } from '@playwright/test';

// PW_CHANNEL=chromium 으로 Playwright 내장 브라우저 사용 가능 (기본: 시스템 Chrome)
const channel = process.env.PW_CHANNEL ?? 'chrome';

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  reporter: [['list']],
  use: { ...devices['iPhone 13'], browserName: 'chromium', channel, locale: 'ko-KR', timezoneId: 'Asia/Seoul' },
  webServer: [
    // ui.spec: 서버 없이 메모리 데이터로 실행
    { command: 'npx vite --mode memory --port 5174 --strictPort', url: 'http://127.0.0.1:5174', reuseExistingServer: true, timeout: 60_000 },
    // sync.spec: Firebase 에뮬레이터에 연결 (npm run test:e2e 는 에뮬레이터를 먼저 띄워야 함)
    { command: 'npx vite --mode emulator --port 5173 --strictPort', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 60_000 },
  ],
});

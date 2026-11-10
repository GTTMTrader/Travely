/**
 * 여행 백업: 만들기 → (인터넷 없이) 파일만으로 열어 보기 → 새 여행으로 되살리기.
 * 메모리 모드 앱 + 빌드된 백업 보기 앱(dist/archive.html) 사용.
 *   npm run build && node scripts/build-archive.mjs dist/archive.html && npx playwright test e2e/backup.spec.ts
 */
import { test, expect } from '@playwright/test';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = 'http://127.0.0.1:5174/';
const ARCHIVE = 'dist/archive.html';
const OUT = 'test-results/backup';

test.skip(!existsSync(ARCHIVE), '먼저 node scripts/build-archive.mjs dist/archive.html');

test('여행 백업: 만들기 → 파일로 열기(오프라인·읽기 전용) → 새 여행으로 되살리기', async ({ page, browser }) => {
  test.setTimeout(180_000);
  mkdirSync(OUT, { recursive: true });
  // 개발 서버에는 archive.html 이 없으므로 빌드본을 대신 돌려줌
  await page.route('**/archive.html*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(ARCHIVE, 'utf8') }));

  await page.goto(BASE);
  await page.getByTestId('trip-card').filter({ hasText: '칭다오 · 옌타이' }).click();
  await expect(page.getByTestId('trip-title')).toHaveText('칭다오 · 옌타이');
  await expect(page.getByTestId('tl-item').first()).toBeVisible();
  const items = await page.getByTestId('tl-item').count();
  await page.getByTestId('nav-bookings').click();
  await expect(page.getByTestId('booking').first()).toBeVisible();
  const bookings = await page.getByTestId('booking').count();
  expect(bookings).toBeGreaterThan(2);

  // 1) 만들기
  await page.getByTestId('share-btn').click();
  await page.getByTestId('open-backup').click();
  await page.getByTestId('backup-make').click();
  await expect(page.getByTestId('backup-done')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('backup-missing')).toHaveCount(0);
  await expect(page.getByTestId('backup-done')).toContainText('첨부 파일3개');
  const dl = page.waitForEvent('download');
  await page.getByTestId('backup-save-html').click();
  const file = resolve(`${OUT}/trip-backup.html`);
  await (await dl).saveAs(file);
  const dl2 = page.waitForEvent('download');
  await page.getByTestId('backup-save-json').click();
  await (await dl2).saveAs(resolve(`${OUT}/trip-backup.json`));
  const html = readFileSync(file, 'utf8');
  expect(html).toContain('id="travely-backup"');
  expect(html).not.toContain('<!--TRAVELY_BACKUP_SLOT-->'); // 자리에 데이터가 들어감

  // 2) 파일만으로 열기: 인터넷 끊고 file:// 로
  const off = await browser.newContext({ offline: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 390, height: 844 } });
  const v = await off.newPage();
  const errors: string[] = [];
  v.on('pageerror', (e) => errors.push(e.message));
  await v.goto(`file://${file}`);
  await expect(v.getByTestId('archive-ribbon')).toBeVisible({ timeout: 20_000 });
  await expect(v.getByTestId('trip-title')).toHaveText('칭다오 · 옌타이');
  await expect(v.getByTestId('tl-item')).toHaveCount(items);
  await expect(v.getByTestId('add-item')).toHaveCount(0); // 읽기 전용
  await v.getByTestId('nav-bookings').click();
  await expect(v.getByTestId('booking')).toHaveCount(bookings);
  await v.getByTestId('booking').filter({ hasText: '입장권' }).click();
  await expect(v.getByTestId('viewer-img')).toBeVisible({ timeout: 15_000 }); // 첨부 원본이 파일 안에서 열림
  await v.getByRole('button', { name: '닫기' }).click();
  await v.getByTestId('nav-ledger').click();
  await v.getByTestId('tab-stats').click();
  await expect(v.getByTestId('donut')).toBeVisible();
  await v.getByTestId('nav-packing').click();
  await v.screenshot({ path: `${OUT}/archive-packing.png` });
  await v.getByTestId('share-btn').click();
  await expect(v.getByTestId('open-backup')).toHaveCount(0);
  await expect(v.getByTestId('make-invite')).toHaveCount(0);
  expect(errors).toEqual([]);
  await off.close();

  // 3) 되살리기: 첫 화면 → 백업 파일 열기 → 새 여행
  await page.goto(BASE);
  const before = await page.getByTestId('trip-card').count();
  await page.getByTestId('open-restore').click();
  await page.getByTestId('restore-file').setInputFiles(file);
  await expect(page.getByTestId('restore-preview')).toContainText('칭다오 · 옌타이');
  await page.getByTestId('restore-run').click();
  await page.getByTestId('restore-run').click(); // 한 번 더 확인
  await expect(page.getByTestId('trip-title')).toHaveText('칭다오 · 옌타이', { timeout: 60_000 });
  expect(page.url()).not.toContain('demo');
  await expect(page.getByTestId('tl-item')).toHaveCount(items);
  await page.getByTestId('nav-bookings').click();
  await expect(page.getByTestId('booking')).toHaveCount(bookings);
  await page.getByTestId('booking').filter({ hasText: '입장권' }).click();
  await expect(page.getByTestId('viewer-img')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '닫기' }).click();
  await page.goto(BASE);
  await expect(page.getByTestId('trip-card')).toHaveCount(before + 1);

  // 4) 아이폰 흐름: 앱에서 '열어 보기' → archive.html 이 건네받은 백업을 띄움 (JSON 파일로)
  await page.getByTestId('open-restore').click();
  await page.getByTestId('restore-file').setInputFiles(resolve(`${OUT}/trip-backup.json`));
  await page.getByTestId('restore-view').click();
  await expect(page.getByTestId('archive-ribbon')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('trip-title')).toHaveText('칭다오 · 옌타이');
});

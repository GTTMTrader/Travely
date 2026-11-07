/**
 * 두 계정 실시간 공유 테스트 (Firebase 에뮬레이터 필요).
 *   터미널 1: npm run emulators
 *   터미널 2: npm run test:e2e
 * 나(A)와 여자친구(B)가 서로 다른 브라우저에서 같은 여행을 고치면 새로고침 없이 반영되는지,
 * 보기 권한의 쓰기가 서버에서 막히는지 확인한다.
 */
import { test, expect, type Browser, type Page } from '@playwright/test';

const BASE = 'http://127.0.0.1:5173/';
const stamp = Date.now().toString(36);

async function signUp(browser: Browser, name: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.getByRole('button', { name: '가입', exact: true }).click();
  await page.locator('#name').fill(name);
  await page.locator('#email').fill(`${name}-${stamp}@example.com`);
  await page.locator('#password').fill('travely-test-1234');
  await page.getByRole('button', { name: '가입하고 시작' }).click();
  await expect(page.getByTestId('new-trip')).toBeVisible({ timeout: 20_000 });
  return page;
}

test('초대 → 참여 → 양쪽 실시간 반영 → 보기 권한 쓰기 차단', async ({ browser }) => {
  const a = await signUp(browser, 'me');
  const b = await signUp(browser, 'gf');

  // A: 여행 만들기
  await a.getByTestId('new-trip').click();
  await a.locator('#trip-name').fill('공유 테스트');
  await a.locator('#trip-start').fill('2026-12-01');
  await a.locator('#trip-end').fill('2026-12-02');
  await a.getByTestId('save-trip').click();
  await expect(a.getByTestId('trip-title')).toHaveText('공유 테스트');

  // A: 초대 링크 (기본 '같이 편집')
  await a.getByTestId('share-btn').click();
  await a.getByTestId('make-invite').click();
  const url = await a.getByTestId('invite-url').inputValue();
  await a.keyboard.press('Escape');

  // B: 링크로 참여
  await b.goto(url);
  await b.getByTestId('join').click();
  await expect(b.getByTestId('trip-title')).toHaveText('공유 테스트', { timeout: 20_000 });

  // A 추가 → B 화면에 반영
  await a.getByTestId('add-item').click();
  await a.locator('#item-name').fill('잔교');
  await a.getByTestId('save-item').click();
  await expect(b.getByTestId('tl-2026-12-01')).toContainText('잔교', { timeout: 15_000 });

  // B 준비물 추가·체크 → A 반영
  await b.getByTestId('nav-packing').click();
  await b.locator('#pk-text').fill('보조배터리');
  await b.getByTestId('pk-add').click();
  await b.getByTestId('packing-toggle').first().click();
  await a.getByTestId('nav-packing').click();
  await expect(a.getByTestId('progress')).toContainText('1', { timeout: 15_000 });

  // A: B 를 보기 전용으로 → B 화면에서 편집 버튼 사라지고, 서버도 거부
  await a.getByTestId('share-btn').click();
  await a.getByTestId('members').locator('select').first().selectOption('viewer');
  await a.keyboard.press('Escape');
  await b.getByTestId('nav-plan').click();
  await expect(b.getByTestId('add-item')).toHaveCount(0, { timeout: 15_000 });
  const denied = await b.evaluate(async () => {
    // 화면 우회 시도: 저장소에 직접 쓰기 → 규칙에서 거부되어야 함
    const repo = await import('/src/data/repo.ts' as string);
    const { getAuth } = await import('/src/data/backend.ts' as string);
    const tripId = location.hash.split('/')[2];
    try {
      await repo.addPacking(tripId, getAuth().current().uid, '우회', 'shared', []);
      return false;
    } catch {
      return true;
    }
  });
  expect(denied).toBe(true);
});

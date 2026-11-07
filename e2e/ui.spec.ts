/**
 * 화면 전체 동작 테스트 (메모리 모드 — 서버 없이 같은 화면 코드를 실행).
 * 모든 탭·주요 버튼이 실제로 동작하는지, 정산 계산이 맞는지, 좁은 화면에서 깨지지 않는지 확인한다.
 * 실행: npm run test:ui
 */
import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://127.0.0.1:5174/';

async function openTrip(page: Page, name: string, past = false) {
  await page.goto(BASE);
  if (past) await page.getByRole('tab', { name: /지난 여행/ }).click();
  await page.getByTestId('trip-card').filter({ hasText: name }).click();
  await expect(page.getByTestId('trip-title')).toHaveText(name);
}
/** 가로 넘침 없음: 문서 폭 + (잘려서 안 보이는 것까지) 화면 오른쪽 밖으로 나간 요소 검사. 가로 스크롤 줄·지도는 제외 */
const noOverflow = async (page: Page) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const out = await page.evaluate(() => {
    const W = window.innerWidth;
    const skip = (el: Element) => !!el.closest('.chips, .leaflet-container, .h-scroll, .viewer .stage');
    return [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.right > W + 1 || r.left < -1) && !skip(el) && getComputedStyle(el).visibility !== 'hidden';
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${Math.round(el.getBoundingClientRect().left)}~${Math.round(el.getBoundingClientRect().right)}`);
  });
  expect(out, '화면 밖으로 나간 요소').toEqual([]);
};
const names = (page: Page, date: string) => page.getByTestId(`tl-${date}`).getByTestId('item-name').allTextContents();
const nums = (page: Page, date: string) => page.getByTestId(`tl-${date}`).getByTestId('num').allTextContents();

/** 1x1 PNG 대신 QR 비슷한 무늬의 PNG 를 브라우저에서 만들어 파일로 넘김 */
async function pngBuffer(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 600;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 400, 600);
    g.fillStyle = '#000';
    for (let i = 0; i < 200; i++) g.fillRect((i * 37) % 360, 100 + ((i * 53) % 360), 18, 18);
    return c.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}
const MINI_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 300]/Contents 4 0 R/Resources<<>>>>endobj\n4 0 obj<</Length 44>>stream\n0 0 0 rg 20 20 160 260 re f\nendstream\nendobj\ntrailer<</Root 1 0 R>>\n%%EOF',
);

test('홈: 여행 목록·탭·새 여행 만들기', async ({ page }) => {
  await page.goto(BASE);
  await expect(page.getByTestId('trip-card')).toHaveCount(1);
  await expect(page.getByTestId('trip-card').first()).toContainText('D-');
  await page.getByRole('tab', { name: /지난 여행/ }).click();
  await expect(page.getByTestId('trip-card')).toContainText('완료');
  await page.getByTestId('new-trip').click();
  await page.locator('#trip-name').fill('테스트 여행');
  await page.locator('#trip-country').selectOption('JP');
  await expect(page.locator('#trip-currency')).toHaveValue('JPY');
  await page.getByRole('button', { name: '+ 오사카' }).click();
  await page.locator('#trip-start').fill('2026-12-04');
  await page.locator('#trip-end').fill('2026-12-07');
  await page.getByTestId('save-trip').click();
  await expect(page.getByTestId('trip-title')).toHaveText('테스트 여행');
  await expect(page.getByText('DAY 4').first()).toBeVisible();
  await expect(page.getByText('12/4 (금) · 오사카')).toBeVisible();
  await noOverflow(page);
});

test('일정: 추가·메모·체크·이동 정보·순서·후보·삭제', async ({ page }) => {
  await page.goto(BASE);
  await page.getByTestId('new-trip').click();
  await page.locator('#trip-name').fill('일정 테스트');
  await page.locator('#trip-start').fill('2026-12-01');
  await page.locator('#trip-end').fill('2026-12-02');
  await page.getByTestId('save-trip').click();
  const D1 = '2026-12-01';

  const addPlace = async (name: string, time?: string, memo?: string) => {
    await page.getByTestId('add-item').click();
    await page.locator('#item-name').fill(name);
    if (time) {
      await page.locator('#item-untimed').uncheck();
      await page.locator('#item-time').fill(time);
    }
    if (memo) await page.locator('#item-memo').fill(memo);
    await page.getByTestId('save-item').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  };
  await addPlace('잔교', '09:30', '바다 전망 사진 찍기');
  // 체크 항목: 자주 쓰는 문구로 추가
  await page.getByTestId(`tl-${D1}`).getByText('잔교').click();
  await page.getByRole('button', { name: '+ 바우처 종이로 출력해서 지참' }).click();
  await page.getByRole('button', { name: '추가', exact: true }).click();
  await page.getByTestId('save-item').click();
  await expect(page.getByTestId(`tl-${D1}`).getByText('바우처 종이로 출력해서 지참')).toBeVisible();
  await expect(page.getByTestId(`tl-${D1}`).getByText('바다 전망 사진 찍기')).toBeVisible(); // '메모' 라벨 없이 내용 그대로
  await addPlace('성 미카엘 성당', '11:00');
  await addPlace('맥주박물관', '14:30');
  expect(await names(page, D1)).toEqual(['잔교', '성 미카엘 성당', '맥주박물관']);
  expect(await nums(page, D1)).toEqual(['1', '2', '3']);

  // 카드에서 체크 바로 토글
  await page.getByRole('button', { name: '바우처 종이로 출력해서 지참 완료', exact: true }).click();
  await expect(page.getByRole('button', { name: '바우처 종이로 출력해서 지참 완료 취소', exact: true })).toBeVisible();

  // 이동 정보 (직접 입력)
  await page.getByTestId('leg').first().click();
  await page.getByRole('button', { name: '🚕 택시' }).click();
  await page.locator('#leg-dur').fill('18');
  await page.locator('#leg-dist').fill('5.2');
  await page.locator('#leg-fare').fill('25');
  await page.getByTestId('save-leg').click();
  await expect(page.getByTestId('leg').first()).toContainText('🚕 택시 · 약 18분 · 5.2km · 약 ¥25');
  await expect(page.getByTestId('leg').first()).toContainText('직접 입력');

  // 메모(번호 없음)
  await page.getByTestId('add-item').click();
  await page.getByRole('button', { name: '메모 (번호 없음)' }).click();
  await page.locator('#item-memo').fill('점심은 근처에서');
  await page.getByTestId('save-item').click();
  expect(await nums(page, D1)).toEqual(['1', '2', '3']);

  // 순서: 시트의 '아래로'
  await page.getByTestId(`tl-${D1}`).getByText('잔교').click();
  await page.getByRole('button', { name: '아래로' }).click();
  await expect.poll(() => names(page, D1)).toEqual(['성 미카엘 성당', '잔교', '맥주박물관']);
  await page.keyboard.press('Escape');
  expect(await nums(page, D1)).toEqual(['1', '2', '3']);

  // 길게 눌러 드래그 (휴대폰 터치 이벤트로)
  const cards = page.getByTestId(`tl-${D1}`).locator('.tl-card');
  await cards.filter({ hasText: '성 미카엘 성당' }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 120));
  const from = await cards.filter({ hasText: '맥주박물관' }).boundingBox();
  const to = await cards.filter({ hasText: '성 미카엘 성당' }).boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, x = 0, y = 0) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] } as never);
  await touch('touchStart', from!.x + 60, from!.y + 20);
  await page.waitForTimeout(500);
  for (let i = 1; i <= 15; i++) {
    await touch('touchMove', from!.x + 60, from!.y + 20 + ((to!.y + 5 - from!.y - 20) * i) / 15);
    await page.waitForTimeout(16);
  }
  await touch('touchEnd');
  await expect.poll(() => names(page, D1)).toEqual(['맥주박물관', '성 미카엘 성당', '잔교']);
  await cdp.detach();
  await page.waitForTimeout(450); // 드래그 직후 클릭 무시 구간(400ms) 지나기

  // 후보 장소: 날짜 없이 추가 → 일정에 넣기
  await page.getByTestId('add-item').click();
  await page.locator('#item-day').selectOption('');
  await page.locator('#item-name').fill('가보고 싶은 카페');
  await page.getByTestId('save-item').click();
  await expect(page.getByTestId('cands')).toContainText('가보고 싶은 카페');
  await page.getByTestId('cand-add').click();
  await page.getByRole('dialog').getByRole('button', { name: /DAY 2/ }).click();
  await expect(page.getByTestId('tl-2026-12-02')).toContainText('가보고 싶은 카페');

  // 삭제 (두 번 눌러 확인)
  await page.getByTestId('tl-2026-12-02').getByText('가보고 싶은 카페').click();
  await page.getByRole('button', { name: '이 일정 삭제' }).click();
  await page.getByTestId('confirm').click();
  await expect(page.getByTestId('tl-2026-12-02')).toHaveCount(0);
  await noOverflow(page);
});

test('지도: 번호 핀·같은 장소 재방문·위치 미지정·선택 카드 (지도 서버 차단 시 대체 화면)', async ({ page }) => {
  await openTrip(page, '지도 기능 예시', true);
  await page.getByTestId('mode-map').click();
  // 이 환경은 OpenStreetMap 접속이 막혀 있어 6초 뒤 간이 순서도로 전환되어야 함
  await expect(page.getByTestId('fallback-note')).toBeVisible({ timeout: 12_000 });
  const pins = page.getByTestId('map-pin');
  await expect(pins).toHaveCount(3); // A(1·4), B, C — A 재방문은 한 핀
  await expect(pins.filter({ hasText: '14' })).toHaveCount(1);
  const segs = await page.getByTestId('schematic-seg').evaluateAll((els) => els.map((e) => e.getAttribute('data-seg')));
  expect(segs).toEqual(['2026-09-11:1-2', '2026-09-11:2-3', '2026-09-11:3-4']);
  await pins.filter({ hasText: '2' }).first().click();
  await expect(page.getByTestId('map-card')).toContainText('예시 장소 B');
  await expect(page.getByTestId('map-card')).toContainText('다음 장소 · 예시 장소 C');
  await expect(page.getByTestId('map-card')).toContainText('🚕 택시 · 약 12분');
  // DAY 2: 위치 미지정 안내
  await page.getByRole('button', { name: 'DAY 2', exact: true }).click();
  await expect(page.getByTestId('missing')).toContainText('예시 장소 E');
  // 전체: 날짜끼리는 연결하지 않음
  await page.getByRole('button', { name: '전체', exact: true }).click();
  const all = await page.getByTestId('schematic-seg').evaluateAll((els) => els.map((e) => e.getAttribute('data-seg')));
  expect(all.every((s) => s!.startsWith('2026-09-11'))).toBe(true);
  await noOverflow(page);
});

test('예약함: 사진·PDF 업로드, 썸네일, 원본 보기, 예약번호, 일정 연결, 항공편 자동 표시, 삭제', async ({ page }) => {
  await openTrip(page, '칭다오 · 옌타이');
  await page.getByTestId('nav-bookings').click();
  await expect(page.getByTestId('booking')).toHaveCount(5);
  await page.getByRole('button', { name: '입장권', exact: true }).click();
  await expect(page.getByTestId('booking')).toHaveCount(1);
  await page.getByRole('button', { name: '전체', exact: true }).click();

  await page.getByTestId('add-booking').click();
  await page.locator('#bk-title').fill('잔교 투어');
  await page.locator('#bk-resno').fill('ABC-123');
  await page.getByTestId('file-input').setInputFiles([
    { name: 'ticket.png', mimeType: 'image/png', buffer: await pngBuffer(page) },
    { name: 'voucher.pdf', mimeType: 'application/pdf', buffer: MINI_PDF },
  ]);
  await expect(page.getByTestId('pending-file')).toHaveCount(2);
  await page.locator('label').filter({ hasText: '잔교' }).first().click(); // 관련 일정 연결
  await page.getByTestId('save-booking').click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
  const card = page.getByTestId('booking').filter({ hasText: '잔교 투어' });
  await expect(card.locator('img')).toHaveCount(1); // 실제 업로드 썸네일
  await card.click();
  await expect(page.getByTestId('viewer-img')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('1 / 2')).toBeVisible(); // 사진 + PDF 1쪽
  await page.getByRole('button', { name: '다음' }).click();
  await expect(page.getByTestId('viewer-img')).toBeVisible({ timeout: 10_000 }); // PDF 렌더
  await page.getByTestId('copy-resno').click();
  await page.getByRole('button', { name: '닫기' }).click();

  // 일정 카드에서 같은 파일 바로 열기
  await page.getByTestId('nav-plan').click();
  await page.getByTestId('item-booking').filter({ hasText: '잔교 투어' }).click();
  await expect(page.getByTestId('viewer')).toBeVisible();
  await page.getByRole('button', { name: '닫기' }).click();

  // 항공 예약 → 일정 타임라인에 항공편 카드
  await page.getByTestId('nav-bookings').click();
  await page.getByTestId('add-booking').click();
  await page.getByRole('dialog').getByRole('button', { name: '항공', exact: true }).click();
  await page.locator('#bk-title').fill('테스트 항공');
  await page.locator('#bk-fno').fill('TS100');
  await page.locator('#bk-dep-code').fill('TAO');
  await page.locator('#bk-dep-date').fill('2026-11-09');
  await page.locator('#bk-dep-time').fill('12:00');
  await page.locator('#bk-arr-code').fill('YNT');
  await page.locator('#bk-arr-date').fill('2026-11-09');
  await page.locator('#bk-arr-time').fill('13:00');
  await page.getByTestId('save-booking').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByTestId('nav-plan').click();
  await expect(page.getByTestId('tl-2026-11-09')).toContainText('TAO 12:00 → YNT 13:00');

  // 예약 삭제 → 항공편 카드도 사라짐
  await page.getByTestId('nav-bookings').click();
  await page.getByTestId('booking').filter({ hasText: '테스트 항공' }).click();
  await page.getByRole('button', { name: '수정' }).click();
  await page.getByRole('button', { name: '예약 삭제' }).click();
  await page.getByTestId('confirm').click();
  await page.getByTestId('nav-plan').click();
  await expect(page.getByTestId('tl-2026-11-09')).not.toContainText('TAO 12:00');
  await noOverflow(page);
});

test('가계부: 결제자·결제수단·분담 방식, 최종 정산 계산, 환율 계산기', async ({ page }) => {
  await openTrip(page, '칭다오 · 옌타이');
  await page.getByTestId('nav-ledger').click();
  // 예시 지출 기준 정산: 나 +100,000 -39,900 +2,375 = 62,475
  await expect(page.getByTestId('settle-now')).toContainText('여자친구');
  await expect(page.getByTestId('settle-now')).toContainText('₩62,475');
  // 예시 지출 모두 삭제
  while ((await page.getByTestId('expense').count()) > 0) {
    await page.getByTestId('expense').first().click();
    await page.getByRole('button', { name: '지출 삭제' }).click();
    await page.getByTestId('confirm').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await expect(page.getByTestId('total')).toHaveText('₩0');

  const add = async (title: string, amount: string, payer: 'me' | 'gf', opts: { method?: string; preset?: string } = {}) => {
    await page.getByTestId('add-expense').click();
    await page.locator('#exp-title').fill(title);
    await page.locator('#exp-currency').selectOption('KRW');
    await page.locator('#exp-amount').fill(amount);
    if (opts.method) await page.getByRole('button', { name: opts.method, exact: true }).click();
    if (payer === 'gf') {
      await page.locator('#payer-me').uncheck();
      await page.locator('#payer-gf').check();
    }
    if (opts.preset) await page.getByTestId(`split-${opts.preset}`).click();
    await page.getByTestId('save-expense').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  };
  // 요청서 예시: 전체 360,000 / 나 240,000 / 친구 120,000 / 각자 180,000 → 친구 → 나 60,000
  await add('숙소 예약', '200000', 'me');
  await add('저녁 식사', '80000', 'gf', { method: '현금' });
  await add('택시 이동', '40000', 'me', { method: '알리페이' });
  await add('입장권', '40000', 'gf');
  await expect(page.getByTestId('total')).toHaveText('₩360,000');
  await expect(page.getByTestId('settle-now')).toContainText('₩60,000');
  await page.getByTestId('tab-settle').click();
  await expect(page.getByTestId('transfer')).toContainText('여자친구');
  await expect(page.getByTestId('transfer')).toContainText('₩60,000');
  await expect(page.getByTestId('settle').locator('tbody tr').first()).toContainText('₩240,000');
  await page.getByRole('button', { name: '지출 내역' }).click();
  // 개인 지출(나만 부담)은 정산에 영향 없음
  await add('내 기념품', '10000', 'me', { preset: 'onlyMe' });
  await expect(page.getByTestId('settle-now')).toContainText('₩60,000');
  // 비율 2:1 (내가 30,000 결제, 나 2 : 친구 1) → 친구 부담 10,000 추가 → 70,000
  await page.getByTestId('add-expense').click();
  await page.locator('#exp-title').fill('간식');
  await page.locator('#exp-currency').selectOption('KRW');
  await page.locator('#exp-amount').fill('30000');
  await page.getByTestId('split-ratio').click();
  await page.locator('#share-me').fill('2');
  await page.locator('#share-gf').fill('1');
  await page.getByTestId('save-expense').click();
  await expect(page.getByTestId('settle-now')).toContainText('₩70,000');
  // 금액 지정 합계가 다르면 저장 막힘
  await page.getByTestId('add-expense').click();
  await page.locator('#exp-title').fill('잘못된 분담');
  await page.locator('#exp-currency').selectOption('KRW');
  await page.locator('#exp-amount').fill('10000');
  await page.getByTestId('split-amount').click();
  await page.locator('#share-me').fill('3000');
  await page.locator('#share-gf').fill('3000');
  await page.getByTestId('save-expense').click();
  await expect(page.getByText(/부담 금액 합계/)).toBeVisible();
  await page.keyboard.press('Escape');
  // 외화: 환율을 못 불러오면 직접 입력 → 원화 환산
  await page.getByTestId('add-expense').click();
  await page.locator('#exp-title').fill('위안 지출');
  await page.locator('#exp-amount').fill('100');
  await expect(page.locator('#exp-currency')).toHaveValue('CNY');
  await page.locator('#exp-rate').fill('190');
  await expect(page.getByText('정산 기준 ₩19,000')).toBeVisible();
  await page.locator('#exp-actual').fill('19500');
  await expect(page.getByText('정산 기준 ₩19,500 (실제 결제액)')).toBeVisible();
  await page.getByTestId('save-expense').click();
  await expect(page.getByTestId('expense').filter({ hasText: '위안 지출' })).toContainText('≈ ₩19,500 실결제');
  // 필터: 여자친구 결제만
  await page.getByRole('button', { name: /전체|필터/ }).last().click();
  await page.getByLabel('결제자').selectOption({ label: '여자친구 결제' });
  await expect(page.getByTestId('expense')).toHaveCount(2);
  // 환율 계산기
  await page.getByTestId('fx').click();
  await page.locator('#fx-manual').fill('190');
  await page.locator('#fx-a').fill('50');
  await expect(page.locator('#fx-b')).toHaveValue('9500');
  await page.locator('#fx-b').fill('19000');
  await expect(page.locator('#fx-a')).toHaveValue('100');
  await page.keyboard.press('Escape');
  await noOverflow(page);
});

test('준비물: 추가·담당자·토글 진행률·필터·숨기기·수정·복사', async ({ page }) => {
  await openTrip(page, '칭다오 · 옌타이');
  await page.getByTestId('nav-packing').click();
  await expect(page.getByTestId('progress')).toContainText('4');
  await page.locator('#pk-text').fill('우산');
  await page.getByRole('button', { name: '여자친구', exact: true }).last().click();
  await page.getByTestId('pk-add').click();
  await expect(page.getByTestId('packing').filter({ hasText: '우산' })).toContainText('여자친구');
  await page.getByRole('switch', { name: '우산 준비 완료' }).click();
  await expect(page.getByTestId('progress')).toContainText('5');
  await page.locator('.seg button', { hasText: '여자친구' }).click();
  await expect(page.getByTestId('packing')).toHaveCount(3);
  await page.locator('.seg button', { hasText: /^전체/ }).click();
  await page.locator('#pk-hide').check();
  await expect(page.getByTestId('packing')).toHaveCount(4);
  await page.locator('#pk-hide').uncheck();
  await page.getByTestId('packing').filter({ hasText: '세면도구' }).getByText('세면도구').click();
  await page.locator('#pk-edit').fill('세면도구 파우치');
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByTestId('packing').filter({ hasText: '세면도구 파우치' })).toHaveCount(1);
  await page.getByRole('button', { name: '다른 여행에서 복사' }).click();
  await page.getByRole('button', { name: '지도 기능 예시' }).click();
  await expect(page.getByTestId('packing').filter({ hasText: '우산' })).toHaveCount(1); // 같은 이름은 건너뜀
  await expect(page.getByTestId('packing')).toHaveCount(9);
  await noOverflow(page);
});

test('공유·설정: 초대 링크(기본 같이 편집), 멤버, 기간 줄이면 후보로', async ({ page }) => {
  await openTrip(page, '칭다오 · 옌타이');
  await page.getByTestId('share-btn').click();
  await expect(page.getByTestId('members')).toContainText('여자친구');
  await expect(page.locator('#inv-role')).toHaveValue('editor');
  await page.getByTestId('make-invite').click();
  await expect(page.getByTestId('invite-url')).toHaveValue(/#\/join\/[^/]+\/[A-Za-z0-9_-]{43}$/);
  await expect(page.getByTestId('invites')).toContainText('같이 편집');
  await page.getByRole('button', { name: '폐기' }).click();
  await expect(page.getByTestId('invites')).toHaveCount(0);
  await page.getByTestId('edit-trip').click();
  await page.locator('#trip-end').fill('2026-11-09');
  await expect(page.getByText(/후보 장소’로 옮겨져요/)).toBeVisible();
  await page.getByTestId('save-trip').click();
  await expect(page.getByTestId('day-2026-11-10')).toHaveCount(0);
  await expect(page.getByTestId('cands')).toContainText('장유 와인 박물관');
});

for (const w of [320, 390]) {
  test(`좁은 화면 ${w}px: 모든 탭 가로 넘침 없음`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 800 });
    await openTrip(page, '칭다오 · 옌타이');
    for (const t of ['plan', 'bookings', 'ledger', 'packing']) {
      await page.getByTestId(`nav-${t}`).click();
      await page.waitForTimeout(300);
      await noOverflow(page);
      await page.screenshot({ path: `test-results/ui-${t}-${w}.png`, fullPage: true });
    }
    // 모든 입력 창(시트)도: 화면·시트 가로 넘침 없음 + 입력칸 글자 16px 이상(아이폰 자동 확대 방지)
    const sheetOk = async (name: string) => {
      await expect(page.getByRole('dialog').last()).toBeVisible();
      await page.waitForTimeout(250);
      await noOverflow(page);
      const r = await page.evaluate(() => {
        const sheets = [...document.querySelectorAll<HTMLElement>('.sheet')];
        const over = sheets.map((el) => el.scrollWidth - el.clientWidth);
        const small = [...document.querySelectorAll<HTMLElement>('input:not([type=checkbox]):not([type=file]):not([type=radio]), select, textarea')]
          .filter((el) => el.offsetParent !== null && parseFloat(getComputedStyle(el).fontSize) < 16).map((el) => el.id || el.className);
        return { over: Math.max(0, ...over), small };
      });
      expect(r.over, `${name} 시트 가로 넘침`).toBeLessThanOrEqual(0);
      expect(r.small, `${name} 16px 미만 입력칸`).toEqual([]);
      await page.screenshot({ path: `test-results/ui-sheet-${name}-${w}.png` });
    };
    const close = async () => {
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    };
    await page.getByTestId('nav-plan').click();
    await page.getByTestId('add-item').click();
    await sheetOk('item');
    await close();
    await page.getByTestId('open-import').click();
    await sheetOk('import');
    await close();
    await page.getByTestId('leg').first().click();
    await sheetOk('leg');
    await close();
    await page.getByTestId('nav-bookings').click();
    await page.getByTestId('add-booking').click();
    await sheetOk('booking');
    await close();
    await page.getByTestId('nav-ledger').click();
    await page.getByTestId('add-expense').click();
    await sheetOk('expense');
    await close();
    await page.getByTestId('share-btn').click();
    await sheetOk('share');
    await page.getByTestId('edit-trip').click();
    await sheetOk('trip');
  });
}

test('JSON 일정 가져오기: 붙여넣기 → 미리보기 → 날짜별 추가·이동 정보·후보', async ({ page }) => {
  await openTrip(page, '칭다오 · 옌타이');
  const before = await names(page, '2026-11-09');
  await page.getByTestId('open-import').click();
  await page.locator('#import-text').fill('{ "days": [ { "date": "2026-11-09", "items": [');
  await expect(page.getByTestId('import-error')).toContainText('JSON 형식이 아니에요');
  const json = {
    days: [
      { date: '2026-11-09', items: [
        { time: '20:00', name: '타이동 야시장', category: 'food', memo: '꼬치', checklist: ['현금'], moveToNext: { mode: 'taxi', minutes: 12, fare: 20, currency: 'CNY' } },
        { time: '21:30', name: '호텔 복귀', category: 'stay' },
      ] },
      { date: '2026-11-20', items: [{ name: '기간 밖 장소' }] },
    ],
  };
  await page.locator('#import-text').fill('```json\n' + JSON.stringify(json) + '\n```');
  await expect(page.getByTestId('import-preview')).toContainText('타이동 야시장');
  await expect(page.getByTestId('import-preview')).toContainText('후보');
  await page.getByTestId('import-run').click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(() => names(page, '2026-11-09')).toEqual([...before, '타이동 야시장', '호텔 복귀']);
  await expect(page.getByTestId('tl-2026-11-09')).toContainText('🚕 택시 · 약 12분');
  await expect(page.getByTestId('cands')).toContainText('기간 밖 장소');
});

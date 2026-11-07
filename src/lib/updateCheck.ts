/**
 * 새 버전 자동 교체. 아이폰 홈 화면 앱은 껐다 켜도 예전 화면을 계속 쓰는 경우가 있어서
 * 앱을 열 때·다시 볼 때 version.json 을 확인하고, 다르면 캐시를 비우고 새로 불러온다.
 * 입력 창이 열려 있을 땐(뒤 화면 고정 중) 기다렸다가 닫힌 뒤에 바꾼다.
 */
const KEY = 'travely:reloadedFor';

async function check() {
  try {
    const r = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const { build } = (await r.json()) as { build?: string };
    if (!build || build === __BUILD_ID__) return;
    if (sessionStorage.getItem(KEY) === build) return; // 같은 버전으로 한 번 시도했으면 반복하지 않음
    if (document.body.style.position === 'fixed') return; // 창 열려 있음 → 다음 기회에
    sessionStorage.setItem(KEY, build);
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((g) => g.unregister().catch(() => false)));
    if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    location.reload();
  } catch {
    /* 오프라인 등 — 다음에 다시 */
  }
}

export function startUpdateCheck() {
  void check();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void check());
  setInterval(() => document.visibilityState === 'visible' && void check(), 10 * 60 * 1000);
}

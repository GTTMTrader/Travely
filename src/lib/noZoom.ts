/**
 * 화면 확대·축소 막기. 아이폰은 viewport 의 user-scalable=no 를 무시하므로
 * 두 손가락 제스처를 직접 막는다. 지도와 예약 원본 보기(자체 확대 기능)는 예외.
 */
const ALLOW = '.leaflet-container, .viewer .stage';

export function blockPageZoom() {
  const inAllowed = (t: EventTarget | null) => !!(t as Element | null)?.closest?.(ALLOW);
  const stop = (e: Event) => {
    if (!inAllowed(e.target)) e.preventDefault();
  };
  // Safari 전용 핀치 이벤트
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  document.addEventListener('gestureend', stop, { passive: false });
  // 두 손가락 터치 이동
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1 && !inAllowed(e.target)) e.preventDefault();
    },
    { passive: false },
  );
  // 확대된 상태로 남아 있으면 원래대로
  const vv = window.visualViewport;
  if (vv) {
    vv.addEventListener('resize', () => {
      if (vv.scale > 1.01 && !(document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement)) {
        const m = document.querySelector('meta[name=viewport]');
        if (m) {
          const c = m.getAttribute('content') ?? '';
          m.setAttribute('content', c + ' ');
          requestAnimationFrame(() => m.setAttribute('content', c));
        }
      }
    });
  }
}

import type { Day, Item } from './types';

export interface NowTarget {
  dayId: string;
  /** 지금 하고 있을(또는 막 지난) 일정. 오늘 첫 일정 전이면 첫 일정, 시간 있는 일정이 없으면 null(날짜 머리로) */
  itemId: string | null;
  state: 'now' | 'next' | 'day';
}

/** 여행 중이면 '지금' 위치 계산. 여행 기간이 아니면 null */
export function findNowTarget(days: Day[], byDay: Map<string | null, Item[]>, date: string, hhmm: string): NowTarget | null {
  if (!days.some((d) => d.date === date)) return null;
  const items = byDay.get(date) ?? [];
  const timed = items.filter((i) => i.time);
  if (timed.length === 0) return { dayId: date, itemId: null, state: 'day' };
  let cur: Item | null = null;
  for (const it of items) if (it.time && it.time <= hhmm) cur = it; // 목록 순서상 마지막으로 시작 시각이 지난 일정
  if (cur) return { dayId: date, itemId: cur.id, state: 'now' };
  return { dayId: date, itemId: timed[0].id, state: 'next' };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** 아이폰처럼 부드럽게 스크롤. 손가락을 대면 즉시 멈춤 */
export function glideTo(y: number, ms = 900): () => void {
  const from = window.scrollY;
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const to = Math.max(0, Math.min(y, max));
  if (Math.abs(to - from) < 4) return () => undefined;
  let stop = false;
  const cancel = () => {
    stop = true;
    window.removeEventListener('touchstart', cancel);
    window.removeEventListener('wheel', cancel);
  };
  window.addEventListener('touchstart', cancel, { passive: true });
  window.addEventListener('wheel', cancel, { passive: true });
  const t0 = performance.now();
  const step = (t: number) => {
    if (stop) return;
    const k = Math.min(1, (t - t0) / ms);
    window.scrollTo(0, from + (to - from) * ease(k));
    if (k < 1) requestAnimationFrame(step);
    else cancel();
  };
  requestAnimationFrame(step);
  return cancel;
}

/** 일정 카드(또는 날짜 머리)가 고정 머리말 바로 아래 오도록 하는 스크롤 위치 */
export function targetY(t: NowTarget): number | null {
  const el = t.itemId ? document.querySelector(`[data-item-id="${t.itemId}"] .tl-row`) : document.getElementById(`day-${t.dayId}`);
  if (!el) return null;
  const head = (document.querySelector('.t-head') as HTMLElement | null)?.offsetHeight ?? 0;
  return el.getBoundingClientRect().top + window.scrollY - head - (t.itemId ? 56 : 8);
}

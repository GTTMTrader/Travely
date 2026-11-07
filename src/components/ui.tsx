import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Illustration } from '../lib/types';

// ───────── 날짜별 파스텔 보조색 ─────────
export const DAY_COLORS = [
  { main: '#7c4dff', soft: '#ede7fe', ink: '#5a2fd6' },
  { main: '#f0b429', soft: '#fff3d4', ink: '#9a6a00' },
  { main: '#22b39b', soft: '#daf5ef', ink: '#127a69' },
  { main: '#ec5d9a', soft: '#fde5ef', ink: '#b2386c' },
  { main: '#4c8df6', soft: '#e3edfe', ink: '#2c64c2' },
  { main: '#f07c3c', soft: '#fee9dc', ink: '#b3531c' },
  { main: '#8a9a2c', soft: '#f0f4d8', ink: '#5d6a14' },
];
export const dayColor = (index: number) => DAY_COLORS[((index % DAY_COLORS.length) + DAY_COLORS.length) % DAY_COLORS.length];

// ───────── 아이콘 (선 아이콘, 24 그리드) ─────────
const P: Record<string, string> = {
  back: 'M15 5l-7 7 7 7',
  next: 'M9 5l7 7-7 7',
  users: 'M16 20v-1.5a3.5 3.5 0 00-3.5-3.5h-5A3.5 3.5 0 004 18.5V20M10 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM20 20v-1.5a3.5 3.5 0 00-2.5-3.35M15.5 4.15a3.5 3.5 0 010 6.7',
  calendar: 'M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1zM4 10h16M8 3v4M16 3v4',
  ticket: 'M4 8V6.5A1.5 1.5 0 015.5 5h13A1.5 1.5 0 0120 6.5V8a2 2 0 000 4v0a2 2 0 000 4v1.5a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5V16a2 2 0 000-4 2 2 0 000-4zM10 5v14',
  wallet: 'M4 7a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V7zM4 9h16M15 14h2',
  bag: 'M6 8h12l-1 12H7L6 8zM9 8V6a3 3 0 016 0v2',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zm0 0v14m6-12v14',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  pin: 'M12 21s-7-6.3-7-11a7 7 0 1114 0c0 4.7-7 11-7 11zm0-8.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  filter: 'M4 5h16l-6 8v5l-4 2v-7L4 5z',
  swap: 'M7 7h13l-4-4M17 17H4l4 4',
  sparkle: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z',
  trash: 'M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4V8zm8 9a4 4 0 100-8 4 4 0 000 8z',
  file: 'M7 3h7l5 5v13H7V3zm7 0v5h5',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  share: 'M12 15V3m0 0L7.5 7.5M12 3l4.5 4.5M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7',
  refresh: 'M20 11a8 8 0 10-2.3 5.7M20 4v7h-7',
  download: 'M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 20h14',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.6 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.6-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  location: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3M12 19v3M2 12h3M19 12h3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 100-6 3 3 0 000 6z',
};
export type IconName = keyof typeof P | 'plane';
export function Icon({ name, size = 22, stroke = 1.9 }: { name: IconName; size?: number; stroke?: number }) {
  if (name === 'plane')
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
        <path d="M21 15.5l-8-5V5a1.5 1.5 0 00-3 0v5.5l-8 5v2l8-2.5V20l-2 1.5V23l3.5-1 3.5 1v-1.5L13 20v-5l8 2.5v-2z" />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={name === 'grip' ? 3.2 : stroke} strokeLinecap="round" strokeLinejoin="round">
      <path d={P[name]} />
    </svg>
  );
}

// ───────── 뒤 화면 스크롤 고정 (iOS 는 overflow:hidden 만으로는 뒤가 움직이고 옆으로 밀림) ─────────
let locks = 0;
let savedY = 0;
export function lockScroll() {
  if (locks++ > 0) return;
  savedY = window.scrollY;
  const b = document.body.style;
  b.position = 'fixed';
  b.top = `-${savedY}px`;
  b.left = '0';
  b.right = '0';
  b.overflow = 'hidden';
}
export function unlockScroll() {
  if (locks === 0 || --locks > 0) return;
  const b = document.body.style;
  b.position = b.top = b.left = b.right = b.overflow = '';
  window.scrollTo(0, savedY);
}

// ───────── 바텀시트 ─────────
/**
 * 아래에서 올라오는 창. 위에서 아래로 끌어내리거나(내용이 맨 위일 때) 바깥을 누르면
 * "창을 닫을까요?" 확인 후 닫힌다. 저장·취소 버튼은 바로 닫는다.
 */
export function Sheet({ onClose, children, label, wide }: { onClose: () => void; children: ReactNode; label: string; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [asking, setAsking] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    lockScroll();
    return () => {
      window.removeEventListener('keydown', onKey);
      unlockScroll();
    };
  }, []);

  // 끌어내리기
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startY: number | null = null;
    let startX = 0;
    let dy = 0;
    let dragging = false;
    const skip = (t: EventTarget | null) => !!(t as Element | null)?.closest?.('.leaflet-container, textarea, .chips, .confirm-back, [data-nodrag]');
    const reset = () => {
      el.style.transition = 'transform .22s ease';
      el.style.transform = '';
    };
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1 || skip(e.target)) return void (startY = null);
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      dy = 0;
      dragging = false;
    };
    const move = (e: TouchEvent) => {
      if (startY === null) return;
      const d = e.touches[0].clientY - startY;
      if (!dragging) {
        if (d < -4 || Math.abs(e.touches[0].clientX - startX) > Math.abs(d) + 4) return void (startY = null); // 위로 스크롤·가로 이동
        if (d < 8) return;
        if (el.scrollTop > 0) return void (startY = null); // 내용 중간이면 그냥 스크롤
        dragging = true;
        el.style.transition = 'none';
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
      e.preventDefault();
      dy = Math.max(0, d - 8);
      el.style.transform = `translateY(${dy}px)`;
    };
    const end = () => {
      if (dragging) {
        reset();
        if (dy > 90) setAsking(true);
      }
      startY = null;
      dragging = false;
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, []);

  return (
    <div className="sheet-bg" onClick={() => setAsking(true)}>
      <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()} style={wide ? { maxHeight: '96dvh' } : undefined}>
        <div className="grab-zone"><div className="grab" /></div>
        {children}
      </div>
      {asking && (
        <div className="confirm-back" onClick={(e) => { e.stopPropagation(); setAsking(false); }}>
          <div className="confirm-box" role="alertdialog" aria-label="닫기 확인" onClick={(e) => e.stopPropagation()}>
            <b>창을 닫을까요?</b>
            <p>저장하지 않은 내용은 사라져요.</p>
            <div className="row" style={{ gap: 10 }}>
              <button className="btn grow" onClick={() => setAsking(false)} data-testid="close-cancel">취소</button>
              <button className="btn primary grow" onClick={() => closeRef.current()} data-testid="close-ok">확인</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 두 번 눌러 확인하는 삭제 버튼 (브라우저 confirm 대신) */
export function ConfirmButton({ label, confirmLabel, onConfirm, className = 'btn danger block' }: { label: string; confirmLabel: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  if (!armed) return <button type="button" className={className} onClick={() => setArmed(true)}>{label}</button>;
  return (
    <div className="row">
      <button type="button" className="btn grow" onClick={() => setArmed(false)}>취소</button>
      <button type="button" className="btn danger grow" onClick={onConfirm} data-testid="confirm">{confirmLabel}</button>
    </div>
  );
}

// ───────── 토스트 ─────────
let toastSet: ((s: string | null) => void) | null = null;
export function toast(msg: string) {
  toastSet?.(msg);
  setTimeout(() => toastSet?.(null), 1800);
}
export function ToastHost() {
  const [m, setM] = useState<string | null>(null);
  useEffect(() => {
    toastSet = setM;
    return () => {
      toastSet = null;
    };
  }, []);
  return m ? <div className="toast" role="status">{m}</div> : null;
}

export async function copyText(text: string, label = '복사'): Promise<boolean> {
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
  }
  toast(ok ? `${label} 완료` : '복사하지 못했어요');
  return ok;
}

export function Logo() {
  return (
    <span className="logo" aria-label="travely">
      travely<span className="spark">✦</span>
    </span>
  );
}

// ───────── 여행 카드 일러스트 (자체 제작 파스텔 장면) ─────────
export const ILLUSTRATIONS: { id: Illustration; label: string }[] = [
  { id: 'temple', label: '도시·사찰' },
  { id: 'blossom', label: '벚꽃' },
  { id: 'coast', label: '바다' },
  { id: 'city', label: '도시' },
  { id: 'mountain', label: '산' },
  { id: 'island', label: '섬' },
];
export function Art({ kind }: { kind: Illustration }) {
  switch (kind) {
    case 'temple':
      return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <defs><linearGradient id="g-t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c7c6fb" /><stop offset="1" stopColor="#e9e2fb" /></linearGradient></defs>
          <rect width="100" height="100" fill="url(#g-t)" />
          <rect x="0" y="20" width="10" height="52" fill="#9a93cf" /><rect x="22" y="40" width="16" height="32" fill="#a39cd6" /><rect x="82" y="34" width="18" height="38" fill="#9a93cf" />
          <path d="M44 42h44l-8 10H52z" fill="#d05d6e" /><rect x="46" y="54" width="40" height="4" fill="#d05d6e" /><rect x="50" y="58" width="32" height="10" fill="#f5d6dc" />
          <rect x="0" y="68" width="100" height="32" fill="#9cbde3" /><rect x="36" y="74" width="60" height="5" fill="#6b6aa6" />
        </svg>
      );
    case 'blossom':
      return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <rect width="100" height="100" fill="#d9cdf0" /><circle cx="18" cy="22" r="18" fill="#fdf1d8" />
          <path d="M0 82q50-20 100 0v18H0z" fill="#bcaedb" />
          <rect x="44" y="40" width="40" height="40" fill="#f6f1ea" /><path d="M40 42l24-12 24 12z" fill="#6f78b0" /><path d="M48 56h32l-4 8H52z" fill="#6f78b0" />
          <rect x="62" y="22" width="5" height="10" fill="#e3a4b4" />
          <rect x="9" y="50" width="3" height="40" fill="#7e6f86" /><circle cx="6" cy="44" r="10" fill="#f3a9c8" /><circle cx="18" cy="40" r="9" fill="#f6b8d2" />
        </svg>
      );
    case 'coast':
      return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <rect width="100" height="100" fill="#b7dcf5" /><circle cx="76" cy="22" r="13" fill="#fff1d6" />
          <path d="M0 52q25-14 50-4t50-6v58H0z" fill="#90a8c8" /><path d="M0 64q25-10 50 0t50-2v38H0z" fill="#5f84ad" />
          <path d="M10 72q15-10 30 0t30 0" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M0 84q50-8 100 0v16H0z" fill="#dbe7f1" />
        </svg>
      );
    case 'city':
      return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <rect width="100" height="100" fill="#efe2fb" />
          <rect x="8" y="38" width="16" height="50" fill="#b6a6e3" /><rect x="28" y="22" width="14" height="66" fill="#9d8bdb" /><rect x="46" y="46" width="18" height="42" fill="#c5b7ea" />
          <rect x="68" y="30" width="12" height="58" fill="#a896df" /><rect x="82" y="50" width="14" height="38" fill="#cabdee" />
          <rect x="0" y="86" width="100" height="14" fill="#8f86b8" />
          {[30, 40, 50, 60].map((y) => <rect key={y} x="31" y={y} width="8" height="3" fill="#f5efff" />)}
        </svg>
      );
    case 'mountain':
      return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <rect width="100" height="100" fill="#d8ecf5" />
          <path d="M-5 80L30 30l25 32 15-18 35 36z" fill="#9bb7cf" /><path d="M22 41l8-11 9 12-6-2-5 4z" fill="#fff" />
          <path d="M0 100V78q30-10 60 0t40-2v24z" fill="#9fcdb4" />
        </svg>
      );
    case 'island':
      return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <rect width="100" height="100" fill="#ffe7cf" /><circle cx="70" cy="34" r="14" fill="#ffb98a" />
          <rect x="0" y="62" width="100" height="38" fill="#7fc4d6" /><ellipse cx="34" cy="64" rx="24" ry="6" fill="#f5d9a6" />
          <path d="M34 62q-2-18 4-28" stroke="#7a5a3a" strokeWidth="3" fill="none" /><path d="M38 34q-12-2-18 6M38 34q10-6 18 0M38 34q-4-8-12-8" stroke="#3e9a6c" strokeWidth="4" fill="none" strokeLinecap="round" />
        </svg>
      );
  }
}

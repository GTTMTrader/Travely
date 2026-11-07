import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * 손가락 두 개로 확대(핀치), 한 손가락으로 이동, 두 번 탭하면 2.5배/원래 크기.
 * QR·바코드를 크게 보기 위한 것. 내용은 화면 너비에 맞춰 시작.
 */
export default function ZoomView({ children, contentW, contentH }: { children: ReactNode; contentW: number; contentH: number }) {
  const stage = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ s: 1, x: 0, y: 0 });
  const base = useRef(1);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef<{ t: typeof t; d: number; cx: number; cy: number; px: number; py: number } | null>(null);
  const lastTap = useRef(0);

  const fit = () => {
    const el = stage.current;
    if (!el || !contentW || !contentH) return;
    const s = Math.min(el.clientWidth / contentW, el.clientHeight / contentH);
    base.current = s;
    setT({ s, x: (el.clientWidth - contentW * s) / 2, y: (el.clientHeight - contentH * s) / 2 });
  };
  useEffect(fit, [contentW, contentH]);

  const zoomAt = (cx: number, cy: number, ns: number) =>
    setT((p) => {
      const s = Math.max(base.current, Math.min(base.current * 8, ns));
      return { s, x: cx - ((cx - p.x) * s) / p.s, y: cy - ((cy - p.y) * s) / p.s };
    });

  const rel = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div
      ref={stage}
      className="stage"
      data-testid="zoom-stage"
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture?.(e.pointerId);
        pts.current.set(e.pointerId, rel(e));
        const arr = [...pts.current.values()];
        if (arr.length === 1) {
          const now = Date.now();
          if (now - lastTap.current < 300) {
            const p = arr[0];
            if (t.s > base.current * 1.2) fit();
            else zoomAt(p.x, p.y, base.current * 2.5);
          }
          lastTap.current = now;
          start.current = { t, d: 0, cx: arr[0].x, cy: arr[0].y, px: arr[0].x, py: arr[0].y };
        } else if (arr.length === 2) {
          const [a, b] = arr;
          start.current = { t, d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, px: 0, py: 0 };
        }
      }}
      onPointerMove={(e) => {
        if (!pts.current.has(e.pointerId) || !start.current) return;
        pts.current.set(e.pointerId, rel(e));
        const arr = [...pts.current.values()];
        const st = start.current;
        if (arr.length >= 2 && st.d > 0) {
          const [a, b] = arr;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          const s = Math.max(base.current, Math.min(base.current * 8, st.t.s * (d / st.d)));
          const cx = (a.x + b.x) / 2;
          const cy = (a.y + b.y) / 2;
          setT({ s, x: cx - ((st.cx - st.t.x) * s) / st.t.s, y: cy - ((st.cy - st.t.y) * s) / st.t.s });
        } else if (arr.length === 1) {
          setT({ ...st.t, x: st.t.x + arr[0].x - st.px, y: st.t.y + arr[0].y - st.py });
        }
      }}
      onPointerUp={(e) => {
        pts.current.delete(e.pointerId);
        const arr = [...pts.current.values()];
        start.current = arr.length === 1 ? { t, d: 0, cx: arr[0].x, cy: arr[0].y, px: arr[0].x, py: arr[0].y } : null;
      }}
      onPointerCancel={(e) => pts.current.delete(e.pointerId)}
      onWheel={(e) => {
        const p = rel(e);
        zoomAt(p.x, p.y, t.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
      }}
    >
      <div className="zoom" style={{ width: contentW, height: contentH, transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})` }}>{children}</div>
      <div style={{ position: 'absolute', right: 10, bottom: 10, display: 'flex', gap: 6 }}>
        <button className="btn sm" onClick={() => zoomAt(stage.current!.clientWidth / 2, stage.current!.clientHeight / 2, t.s * 1.5)} aria-label="확대">＋</button>
        <button className="btn sm" onClick={() => zoomAt(stage.current!.clientWidth / 2, stage.current!.clientHeight / 2, t.s / 1.5)} aria-label="축소">－</button>
        <button className="btn sm" onClick={fit}>맞춤</button>
      </div>
    </div>
  );
}

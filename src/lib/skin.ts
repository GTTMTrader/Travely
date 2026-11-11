/**
 * 화면 스킨 (기본 색조만, 그라데이션 없음). 이 기기에만 저장 — 함께 쓰는 사람 화면은 각자 고른 스킨.
 * 실제 색은 styles.css 의 :root[data-skin='…'] 에 있음. index.html 의 짧은 스크립트가 첫 화면 전에 미리 적용(깜빡임 방지).
 */
export const SKINS = [
  { id: 'violet', name: '보라', color: '#6d3df2' },
  { id: 'blue', name: '파랑', color: '#2563eb' },
  { id: 'teal', name: '청록', color: '#0f766e' },
  { id: 'green', name: '초록', color: '#15803d' },
  { id: 'orange', name: '주황', color: '#c2410c' },
  { id: 'pink', name: '핑크', color: '#d0306c' },
  { id: 'mono', name: '블랙', color: '#222222' },
] as const;
export type SkinId = (typeof SKINS)[number]['id'];

const KEY = 'travely-skin';

export function getSkin(): SkinId {
  try {
    const v = localStorage.getItem(KEY);
    if (SKINS.some((s) => s.id === v)) return v as SkinId;
  } catch {
    /* 저장공간을 못 쓰는 환경(파일로 연 백업 등) */
  }
  return 'violet';
}

export function applySkin(id: SkinId) {
  const root = document.documentElement;
  if (id === 'violet') delete root.dataset.skin;
  else root.dataset.skin = id;
  const color = SKINS.find((s) => s.id === id)!.color;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
}

export function setSkin(id: SkinId) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* 이번 화면에만 적용 */
  }
  applySkin(id);
}

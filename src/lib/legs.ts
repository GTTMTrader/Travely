import type { Item, Leg } from './types';
import { MODE_EMOJI, MODE_LABEL } from './types';
import { formatStraightDistance, hasCoords, haversineMeters } from './order';
import { coordKey } from './geo';
import { formatMoney } from './settle';

/** 경로 모양이 지금 두 장소 좌표와 맞는지 (장소 위치를 바꾸면 다시 조회해야 함) */
export function routeFresh(leg: Leg | null | undefined, a: Item, b: Item): boolean {
  if (!leg?.geometry) return false;
  return leg.routedFrom === coordKey(a.place) && leg.routedTo === coordKey(b.place);
}

export function fmtDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)}m` : m < 100000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m / 1000)}km`;
}

export function straightMeters(a: Item, b: Item): number | null {
  return hasCoords(a.place) && hasCoords(b.place) ? haversineMeters(a.place, b.place) : null;
}

/** 이동 정보 한 줄 요약. 예: 🚕 택시 · 약 18분 · 경로 5.2km · 약 ¥25 */
export function legSummary(leg: Leg | null | undefined, a: Item, b: Item): { text: string; badge: string | null; empty: boolean } {
  const straight = straightMeters(a, b);
  if (!leg) {
    return { text: straight != null ? `${formatStraightDistance(straight)} · 이동 정보 추가` : '이동 정보 추가', badge: null, empty: true };
  }
  const parts = [`${MODE_EMOJI[leg.mode]} ${MODE_LABEL[leg.mode]}`];
  if (leg.durationMin != null) parts.push(`약 ${leg.durationMin}분`);
  if (leg.distanceM != null) parts.push(`${leg.source === 'route' ? '경로' : ''} ${fmtDistance(leg.distanceM)}`.trim());
  else if (straight != null) parts.push(formatStraightDistance(straight));
  if (leg.fareAmount != null && leg.fareAmount > 0) parts.push(`약 ${formatMoney(leg.fareAmount, leg.fareCurrency)}`);
  let badge: string | null = leg.source === 'route' ? '경로 기준' : leg.source === 'manual' ? '직접 입력' : null;
  if (leg.geometry && !routeFresh(leg, a, b)) badge = '다시 조회 필요';
  return { text: parts.join(' · '), badge, empty: false };
}

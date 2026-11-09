/**
 * 보안 규칙 ↔ 앱 구독 일치 검사 (에뮬레이터 없이 돌아가는 정적 검사).
 * 2026-11-09 사고: 여행 화면이 '초대 목록'(주인만 읽기 가능)까지 구독해서 초대받은 사람 화면 전체가 '권한 없음'이 됨.
 * → 여행 화면이 구독하는 모든 컬렉션은 '멤버면 누구나 읽기'여야 한다.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SUBS } from '../../src/data/repo';

const rules = readFileSync('firestore.rules', 'utf8');
function blockOf(col: string): string {
  const start = rules.indexOf(`match /${col}/{`);
  expect(start, `${col} 규칙 없음`).toBeGreaterThan(0);
  let depth = 0;
  for (let i = rules.indexOf('{', rules.indexOf('}', start)); i < rules.length; i++) {
    if (rules[i] === '{') depth++;
    if (rules[i] === '}' && --depth === 0) return rules.slice(start, i);
  }
  return rules.slice(start);
}

describe('여행 화면 구독 ↔ 보안 규칙', () => {
  it.each([...SUBS])('%s: 멤버 누구나 목록 읽기 가능', (col) => {
    const b = blockOf(col);
    const own = b.split(/match \/\w+\/\{/)[1] ?? b; // 하위 match(조각 등) 제외
    expect(own).toMatch(/allow (read|list):\s*if isMember\(tripId\);/);
  });
  it('초대 목록은 주인만 → 여행 화면 구독에 들어가면 안 됨', () => {
    expect(blockOf('invites')).toMatch(/allow list: if isOwner\(tripId\);/);
    expect(SUBS as readonly string[]).not.toContain('invites');
  });
});

import { describe, expect, it } from 'vitest';
import { allocate, byMethod, expenseKrw, formatMoney, minimalTransfers, settle, validateExpense } from '../../src/lib/settle';
import type { Currency, Expense, SplitMode } from '../../src/lib/types';

let n = 0;
function ex(amount: number, payers: Record<string, number>, shares: Record<string, number>, o: { currency?: Currency; rate?: number; actual?: number | null; mode?: SplitMode } = {}): Expense {
  const currency = o.currency ?? 'KRW';
  return {
    id: `e${++n}`, title: 't', date: null, time: null, category: 'food', amount, currency,
    krwRate: o.rate ?? 1, krwRateDate: null, krwActual: o.actual ?? null, method: 'cash', cardName: '', platform: '',
    payers, split: { mode: o.mode ?? 'equal', shares }, memo: '', createdBy: 'me', updatedBy: 'me', version: 1,
  };
}
const ME = 'me';
const GF = 'gf';

describe('정산 (원화 정수)', () => {
  it('문서 예시: 친구 360,000 결제·둘이 반반 + 내가 240,000 결제·둘이 반반 → 나→친구 60,000', () => {
    const s = settle([ex(360000, { [GF]: 360000 }, { [ME]: 1, [GF]: 1 }), ex(240000, { [ME]: 240000 }, { [ME]: 1, [GF]: 1 })], [ME, GF]);
    expect(s.total).toBe(600000);
    expect(s.transfers).toEqual([{ from: ME, to: GF, amount: 60000 }]);
  });
  it('내가 결제, 나만 부담 → 정산 영향 없음', () => {
    expect(settle([ex(50000, { [ME]: 50000 }, { [ME]: 1 })], [ME, GF]).transfers).toEqual([]);
  });
  it('상대 몫만 대신 결제 → 전액 받음', () => {
    expect(settle([ex(30000, { [ME]: 30000 }, { [GF]: 1 })]).transfers).toEqual([{ from: GF, to: ME, amount: 30000 }]);
  });
  it('비율 7:3 → 100,000 중 상대 부담 30,000', () => {
    const s = settle([ex(100000, { [ME]: 100000 }, { [ME]: 7, [GF]: 3 }, { mode: 'ratio' })]);
    expect(s.transfers).toEqual([{ from: GF, to: ME, amount: 30000 }]);
  });
  it('금액 지정 분담', () => {
    const s = settle([ex(100, { [ME]: 100 }, { [ME]: 30, [GF]: 70 }, { mode: 'amount', currency: 'CNY', rate: 190 })]);
    expect(s.total).toBe(19000);
    expect(s.transfers).toEqual([{ from: GF, to: ME, amount: 13300 }]);
  });
  it('외화: 저장 환율 적용, 실제 원화 결제액이 있으면 그 값 우선', () => {
    expect(expenseKrw({ amount: 100, currency: 'CNY', krwRate: 190.5, krwActual: null })).toBe(19050);
    expect(expenseKrw({ amount: 100, currency: 'CNY', krwRate: 190.5, krwActual: 19321 })).toBe(19321);
    expect(expenseKrw({ amount: 15000, currency: 'KRW', krwRate: 1, krwActual: null })).toBe(15000);
  });
  it('나머지 1원은 고정 규칙으로 배분, 합계 보존', () => {
    const a = allocate(10001, { b: 1, a: 1 });
    expect(a.get('a')! + a.get('b')!).toBe(10001);
    expect(a.get('a')).toBe(5001);
    const three = allocate(100, { x: 1, y: 1, z: 1 });
    expect([...three.values()].reduce((s, v) => s + v, 0)).toBe(100);
  });
  it('둘이 나눠 결제(결제자 여러 명)', () => {
    const s = settle([ex(100000, { [ME]: 70000, [GF]: 30000 }, { [ME]: 1, [GF]: 1 })]);
    expect(s.transfers).toEqual([{ from: GF, to: ME, amount: 20000 }]);
  });
  it('최소 송금', () => {
    expect(minimalTransfers(new Map([['a', 500], ['b', -300], ['c', -200]]))).toEqual([
      { from: 'b', to: 'a', amount: 300 },
      { from: 'c', to: 'a', amount: 200 },
    ]);
  });
  it('입력 검증', () => {
    expect(validateExpense({ amount: 0, currency: 'KRW', payers: { me: 0 }, split: { mode: 'equal', shares: { me: 1 } } })).toMatch('금액');
    expect(validateExpense({ amount: 100, currency: 'CNY', payers: { me: 60 }, split: { mode: 'equal', shares: { me: 1 } } })).toMatch('결제자별');
    expect(validateExpense({ amount: 100, currency: 'CNY', payers: { me: 100 }, split: { mode: 'amount', shares: { me: 30, gf: 60 } } })).toMatch('부담 금액');
    expect(validateExpense({ amount: 0.3, currency: 'CNY', payers: { me: 0.1 + 0.2 }, split: { mode: 'equal', shares: { me: 1 } } })).toBeNull();
  });
  it('결제수단별 합계·표시', () => {
    const a = { ...ex(10000, { me: 10000 }, { me: 1 }), method: 'credit' as const };
    const b = { ...ex(5000, { me: 5000 }, { me: 1 }), method: 'credit' as const };
    expect(byMethod([a, b]).get('credit')).toBe(15000);
    expect(formatMoney(1234.5, 'CNY')).toBe('¥1,234.50');
    expect(formatMoney(15000, 'KRW')).toBe('₩15,000');
  });
});

import { describe, expect, it } from 'vitest';
import { buildExpenseImport, dupKey, resolvePayer, TITLE_TODO } from '../../src/lib/importExpenses';
import type { Day } from '../../src/lib/types';

const days: Day[] = [{ date: '2026-11-08', index: 0, city: '' }, { date: '2026-11-09', index: 1, city: '' }];
describe('지출 가져오기', () => {
  it('있는 정보만, 이름은 비워 둠, 결제수단·통화·실결제', () => {
    const r = buildExpenseImport(JSON.stringify({ defaults: { payer: '여자친구', split: '반반' }, expenses: [
      { date: '11/9', time: '오후 2:32', amount: '¥35.00', method: '支付宝', merchant: '瑞幸咖啡' },
      { date: '2026-11-09', time: '20:10', amount: 60, currency: 'CNY', method: '트래블월렛 체크', krwActual: '11,800원' },
      { date: '2026-11-20', amount: 10, currency: 'CNY' },
      { amount: 0 },
    ] }), days, 'CNY');
    expect(r.defaults).toEqual({ payer: '여자친구', split: 'equal' });
    expect(r.items).toHaveLength(3);
    expect(r.items[0]).toMatchObject({ date: '2026-11-09', time: '14:32', amount: 35, currency: 'CNY', method: 'alipay', title: TITLE_TODO, memo: '가맹점: 瑞幸咖啡' });
    expect(r.items[1]).toMatchObject({ method: 'debit', krwActual: 11800 });
    expect(r.items[2].date).toBeNull();
    expect(r.warnings.join()).toContain('1건');
  });
  it('캡처가 겹쳐 같은 거래가 두 번 들어오면 하나로', () => {
    const e = { date: '2026-11-09', time: '14:32', amount: 35, currency: 'CNY' };
    const r = buildExpenseImport(JSON.stringify({ expenses: [e, { ...e, time: '14:40' }, e] }), days, 'CNY');
    expect(r.items).toHaveLength(2);
    expect(r.warnings.join()).toContain('하나로');
  });
  it('결제자 해석·중복 키', () => {
    const ms = [{ uid: 'a', displayName: '세인' }, { uid: 'b', displayName: '지수' }];
    expect(resolvePayer('me', 'a', ms)).toBe('a');
    expect(resolvePayer('partner', 'a', ms)).toBe('b');
    expect(resolvePayer('지수', 'a', ms)).toBe('b');
    expect(dupKey({ date: '2026-11-09', time: '14:32', amount: 35, currency: 'CNY' })).toBe('2026-11-09|14:32|35|CNY');
  });
});

import type { Currency, Expense, ExpenseCategory, PayMethod } from './types';
import { CURRENCY_DECIMALS, CURRENCY_SYMBOL } from './types';

/**
 * 정산은 전부 '원(KRW) 정수'로 계산한다.
 *  - 지출 1건의 원화 금액 = 실제 원화 결제액(입력했으면) 또는 금액 × 저장 당시 환율(반올림)
 *  - 결제자 몫·부담자 몫은 그 원화 금액을 비율대로 '최대 나머지 방식'으로 나눠 1원 오차 없이 합계를 맞춘다
 */

export const toMinor = (amount: number, cur: Currency) => Math.round(amount * 10 ** CURRENCY_DECIMALS[cur]);

export function formatMoney(amount: number, cur: Currency): string {
  const d = CURRENCY_DECIMALS[cur];
  const rounded = Math.round(amount * 10 ** d) / 10 ** d;
  const s = Math.abs(rounded).toLocaleString('ko-KR', { minimumFractionDigits: rounded % 1 === 0 ? 0 : d, maximumFractionDigits: d });
  return `${rounded < 0 ? '-' : ''}${CURRENCY_SYMBOL[cur]}${s}`;
}
export const formatKrw = (won: number) => formatMoney(won, 'KRW');

export function expenseKrw(e: Pick<Expense, 'amount' | 'currency' | 'krwRate' | 'krwActual'>): number {
  if (typeof e.krwActual === 'number' && e.krwActual > 0) return Math.round(e.krwActual);
  if (e.currency === 'KRW') return Math.round(e.amount);
  return Math.round(e.amount * (e.krwRate || 0));
}

/**
 * total(정수)을 weights 비율로 나눔. 소수점 이하는 큰 순서대로 1씩 배분, 같으면 uid 정렬 순.
 * 합계가 항상 total 과 같다.
 */
export function allocate(total: number, weights: Record<string, number>): Map<string, number> {
  const ids = Object.keys(weights).filter((k) => weights[k] > 0).sort();
  const out = new Map<string, number>();
  const sum = ids.reduce((s, k) => s + weights[k], 0);
  if (ids.length === 0 || sum <= 0) return out;
  let used = 0;
  const rema: { id: string; r: number }[] = [];
  for (const id of ids) {
    const exact = (total * weights[id]) / sum;
    const base = Math.floor(exact);
    out.set(id, base);
    used += base;
    rema.push({ id, r: exact - base });
  }
  rema.sort((a, b) => b.r - a.r || (a.id < b.id ? -1 : 1));
  for (let i = 0; i < total - used; i++) {
    const k = rema[i % rema.length].id;
    out.set(k, out.get(k)! + 1);
  }
  return out;
}

export function splitWeights(e: Pick<Expense, 'split'>): Record<string, number> {
  const w: Record<string, number> = {};
  for (const [uid, v] of Object.entries(e.split.shares)) {
    if (!(v > 0)) continue;
    w[uid] = e.split.mode === 'equal' ? 1 : v;
  }
  return w;
}

export interface PersonSummary {
  uid: string;
  paid: number;
  share: number;
  balance: number; // + 받을 돈, - 보낼 돈
}
export interface Transfer {
  from: string;
  to: string;
  amount: number;
}
export interface Settlement {
  total: number;
  people: PersonSummary[];
  transfers: Transfer[];
}

export function minimalTransfers(balances: Map<string, number>): Transfer[] {
  const cred = [...balances].filter(([, v]) => v > 0).map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v || (a.id < b.id ? -1 : 1));
  const debt = [...balances].filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v })).sort((a, b) => b.v - a.v || (a.id < b.id ? -1 : 1));
  const out: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debt.length && j < cred.length) {
    const amt = Math.min(debt[i].v, cred[j].v);
    if (amt > 0) out.push({ from: debt[i].id, to: cred[j].id, amount: amt });
    debt[i].v -= amt;
    cred[j].v -= amt;
    if (debt[i].v === 0) i++;
    if (cred[j].v === 0) j++;
  }
  return out;
}

export function settle(expenses: Expense[], memberUids: string[] = []): Settlement {
  const paid = new Map<string, number>();
  const share = new Map<string, number>();
  let total = 0;
  for (const e of expenses) {
    const krw = expenseKrw(e);
    if (krw <= 0) continue;
    total += krw;
    for (const [id, v] of allocate(krw, e.payers)) paid.set(id, (paid.get(id) ?? 0) + v);
    for (const [id, v] of allocate(krw, splitWeights(e))) share.set(id, (share.get(id) ?? 0) + v);
  }
  const ids = [...new Set([...memberUids, ...paid.keys(), ...share.keys()])];
  const people = ids.map((uid) => {
    const p = paid.get(uid) ?? 0;
    const s = share.get(uid) ?? 0;
    return { uid, paid: p, share: s, balance: p - s };
  });
  return { total, people, transfers: minimalTransfers(new Map(people.map((x) => [x.uid, x.balance]))) };
}

/** 입력 검증. 문제 없으면 null */
export function validateExpense(e: Pick<Expense, 'amount' | 'currency' | 'payers' | 'split'>): string | null {
  if (!(e.amount > 0)) return '금액을 입력해 주세요';
  const eps = 10 ** -CURRENCY_DECIMALS[e.currency] / 2;
  const payers = Object.entries(e.payers).filter(([, v]) => v > 0);
  if (payers.length === 0) return '결제한 사람을 골라 주세요';
  const paySum = payers.reduce((s, [, v]) => s + v, 0);
  if (Math.abs(paySum - e.amount) > eps * payers.length) return `결제자별 금액 합계(${formatMoney(paySum, e.currency)})가 결제 금액과 달라요`;
  const shares = Object.entries(e.split.shares).filter(([, v]) => v > 0);
  if (shares.length === 0) return '비용을 부담할 사람을 골라 주세요';
  if (e.split.mode === 'amount') {
    const s = shares.reduce((a, [, v]) => a + v, 0);
    if (Math.abs(s - e.amount) > eps * shares.length) return `부담 금액 합계(${formatMoney(s, e.currency)})가 결제 금액과 달라요`;
  }
  return null;
}

export function sumBy<K extends string>(expenses: Expense[], key: (e: Expense) => K): Map<K, number> {
  const m = new Map<K, number>();
  for (const e of expenses) m.set(key(e), (m.get(key(e)) ?? 0) + expenseKrw(e));
  return m;
}
export const byCategory = (es: Expense[]) => sumBy<ExpenseCategory>(es, (e) => e.category);
export const byMethod = (es: Expense[]) => sumBy<PayMethod>(es, (e) => e.method);

/** 지출 한 건의 부담 방식 요약 문구 */
export function splitSummary(e: Expense, nameOf: (uid: string) => string, memberCount: number): string {
  const ids = Object.keys(e.split.shares).filter((k) => e.split.shares[k] > 0);
  if (ids.length === 1) return `${nameOf(ids[0])}만 부담`;
  if (e.split.mode === 'equal') return ids.length === memberCount ? `${ids.length}인 균등 부담` : `${ids.map(nameOf).join('·')} 균등 부담`;
  if (e.split.mode === 'ratio') return `비율 ${ids.map((k) => `${nameOf(k)} ${e.split.shares[k]}`).join(' : ')}`;
  return `금액 지정 ${ids.map((k) => `${nameOf(k)} ${formatMoney(e.split.shares[k], e.currency)}`).join(' · ')}`;
}

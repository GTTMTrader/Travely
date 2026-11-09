/**
 * 결제 캡처 → (Claude 가 만든) 가계부 JSON → 지출 여러 건 한 번에 추가.
 * 파일에 있는 정보(날짜·시간·금액·통화·결제수단·가맹점·실제 원화)만 넣고, 항목 이름은 '내용 입력 필요'로 둔다.
 *
 * 형식:
 * {
 *   "travelyExpenses": 1,
 *   "defaults": { "payer": "me" | "partner" | "<이름>", "split": "equal" | "payerOnly" | "otherOnly" },
 *   "expenses": [
 *     { "date": "2026-11-09", "time": "14:32", "amount": 35, "currency": "CNY",
 *       "method": "alipay", "cardName": "", "platform": "", "merchant": "瑞幸咖啡", "merchantKo": "루이싱 커피 (카페 체인)",
 *       "krwActual": null, "category": "cafe", "title": null, "memo": "",
 *       "payer": "me", "split": "equal" }      ← payer/split 는 건마다 덮어쓰기 (선택)
 *   ]
 * }
 */
import type { Currency, ExpenseCategory, PayMethod } from './types';
import { CURRENCIES } from './types';
import { parseJsonLoose, parseTime, parseDate, parseMoney } from './importPlan';
import type { Day } from './types';

export const TITLE_TODO = '내용 입력 필요';

export type PayerKey = string; // 'me' | 'partner' | 이름
export type SplitKey = 'equal' | 'payerOnly' | 'otherOnly';

export interface ImportedExpense {
  date: string | null;
  time: string | null;
  amount: number;
  currency: Currency;
  method: PayMethod;
  cardName: string;
  platform: string;
  merchant: string;
  /** 중국어 가맹점 이름의 대략적인 한국어 뜻 (항목 이름 추측용) */
  merchantKo: string;
  krwActual: number | null;
  category: ExpenseCategory;
  title: string;
  memo: string;
  payer: PayerKey | null; // null → 기본값
  split: SplitKey | null;
}
export interface ExpenseImport {
  items: ImportedExpense[];
  defaults: { payer: PayerKey; split: SplitKey };
  warnings: string[];
}

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

const METHOD: [PayMethod, RegExp][] = [
  ['alipay', /alipay|알리|支付宝/i],
  ['wechat', /wechat|weixin|위챗|微信/i],
  ['credit', /credit|신용/i],
  ['debit', /debit|체크|travel ?wallet|트래블|트레블/i],
  ['cash', /cash|현금|现金/i],
];
export function parseMethod(v: unknown): PayMethod {
  const s = str(v);
  if (['cash', 'credit', 'debit', 'alipay', 'wechat', 'etc'].includes(s)) return s as PayMethod;
  for (const [m, re] of METHOD) if (re.test(s)) return m;
  return 'etc';
}
const CATS: ExpenseCategory[] = ['stay', 'food', 'cafe', 'transport', 'ticket', 'shop', 'etc'];
export function parseSplit(v: unknown): SplitKey | null {
  const s = str(v).toLowerCase();
  if (!s) return null;
  if (/equal|half|반반|균등|나눠|둘이/.test(s)) return 'equal';
  if (/payeronly|payer only|결제자만|본인|개인/.test(s)) return 'payerOnly';
  if (/other|상대만|대신/.test(s)) return 'otherOnly';
  return null;
}

export function buildExpenseImport(text: string, days: Day[], baseCurrency: Currency): ExpenseImport {
  const data = parseJsonLoose(text);
  const root: J = Array.isArray(data) ? { expenses: data } : isObj(data) ? data : {};
  const list = (['expenses', 'payments', 'items', '지출', '결제'].map((k) => root[k]).find(Array.isArray) as unknown[] | undefined) ?? [];
  if (!list.length) throw new Error('지출 목록을 찾지 못했어요. "expenses": [ ... ] 형식인지 확인해 주세요.');
  const dft = isObj(root.defaults) ? root.defaults : {};
  const defaults = { payer: str(dft.payer) || 'me', split: parseSplit(dft.split) ?? 'equal' };
  const warnings: string[] = [];
  const items: ImportedExpense[] = [];
  let skipped = 0;
  for (const raw of list) {
    if (!isObj(raw)) {
      skipped++;
      continue;
    }
    const money = parseMoney(raw.amount ?? raw.price ?? raw.금액, baseCurrency);
    const curRaw = str(raw.currency ?? raw.통화).toUpperCase();
    const currency = (CURRENCIES as readonly string[]).includes(curRaw) ? (curRaw as Currency) : money.currency;
    const amount = money.amount ?? 0;
    if (!(amount > 0)) {
      skipped++;
      continue;
    }
    const krw = raw.krwActual ?? raw.krw ?? raw.원화;
    const krwActual = krw == null || krw === '' ? null : parseMoney(krw, 'KRW').amount;
    const merchant = str(raw.merchant ?? raw.store ?? raw.가맹점 ?? raw.상호).slice(0, 80);
    const merchantKo = str(raw.merchantKo ?? raw.merchant_ko ?? raw.번역 ?? raw.가맹점번역).slice(0, 60);
    const memoParts = [merchant ? `가맹점: ${merchant}${merchantKo ? ` → ${merchantKo}` : ''}` : merchantKo ? `가맹점: ${merchantKo}` : '', str(raw.memo ?? raw.메모)].filter(Boolean);
    const cat = str(raw.category);
    items.push({
      date: parseDate(raw.date ?? raw.날짜, days),
      time: parseTime(raw.time ?? raw.시간),
      amount,
      currency,
      method: parseMethod(raw.method ?? raw.결제수단),
      cardName: str(raw.cardName ?? raw.card ?? raw.카드).slice(0, 60),
      platform: str(raw.platform ?? raw.플랫폼).slice(0, 60),
      merchant,
      merchantKo,
      krwActual: currency === 'KRW' ? null : krwActual && krwActual > 0 ? Math.round(krwActual) : null,
      category: (CATS as string[]).includes(cat) ? (cat as ExpenseCategory) : 'etc',
      title: (str(raw.title ?? raw.항목) || TITLE_TODO).slice(0, 100),
      memo: memoParts.join('\n').slice(0, 1000),
      payer: str(raw.payer ?? raw.결제자) || null,
      split: parseSplit(raw.split ?? raw.정산 ?? raw.분담),
    });
  }
  // 캡처가 잘려 겹친 경우: 파일 안에서 같은 거래(날짜·시간·금액·통화 같음)는 하나만
  const seen = new Set<string>();
  const before = items.length;
  for (let i = items.length - 1; i >= 0; i--) {
    const k = dupKey(items[i]);
    if (items[i].time && seen.has(k)) items.splice(i, 1);
    else seen.add(k);
  }
  if (before > items.length) warnings.push(`파일 안에서 겹친 같은 거래 ${before - items.length}건은 하나로 합쳤어요.`);
  if (skipped) warnings.push(`금액이 없거나 형식이 다른 ${skipped}건은 건너뛰어요.`);
  const dates = new Set(days.map((d) => d.date));
  const outside = items.filter((i) => i.date && !dates.has(i.date)).length;
  if (outside) warnings.push(`여행 기간 밖 날짜 ${outside}건은 '여행 전/날짜 없음'으로 넣어요.`);
  for (const i of items) if (i.date && !dates.has(i.date)) i.date = null;
  return { items, defaults, warnings };
}

/** 'me' / 'partner' / 이름 → uid */
export function resolvePayer(key: string, me: string, members: { uid: string; displayName: string }[]): string | null {
  const k = key.trim().toLowerCase();
  if (k === 'me' || k === '나' || k === '내가') return me;
  const others = members.filter((m) => m.uid !== me);
  if (['partner', 'other', 'friend', 'gf', '상대', '여자친구', '여친', '친구'].includes(k)) return others[0]?.uid ?? null;
  return members.find((m) => m.displayName.trim().toLowerCase() === k)?.uid ?? null;
}

/** 이미 있는 지출과 같은지 (날짜·시간·금액·통화가 모두 같으면 중복으로 봄) */
export const dupKey = (e: { date: string | null; time: string | null; amount: number; currency: string }) => `${e.date ?? ''}|${e.time ?? ''}|${e.amount}|${e.currency}`;

/** 메모 첫 줄 '가맹점: 原文 → 한국어' 에서 한국어 뜻(없으면 원문)만 */
export function merchantHint(memo: string): string {
  const m = memo.split('\n')[0].match(/^가맹점:\s*(.+)$/);
  if (!m) return '';
  const [orig, ko] = m[1].split(/\s*→\s*/);
  return (ko || orig || '').trim();
}

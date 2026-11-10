import { useEffect, useMemo, useState } from 'react';
import { useTripCtx } from '../pages/TripLayout';
import { deleteExpense, saveExpense, type ExpenseInput } from '../data/repo';
import type { Currency, Expense, ExpenseCategory, PayMethod, SplitMode } from '../lib/types';
import { CURRENCIES, CURRENCY_DECIMALS, CURRENCY_LABEL, CURRENCY_SYMBOL, EXPENSE_CATEGORY_LABEL, EXPENSE_CATEGORY_ORDER, PAY_METHOD_LABEL, PAY_METHOD_ORDER } from '../lib/types';
import { allocate, expenseKrw, formatKrw, formatMoney, splitWeights, validateExpense } from '../lib/settle';
import { getKrwRate, type FxRate } from '../lib/fx';
import { ConflictError, describeError } from '../lib/saveStatus';
import { nowHHMM, shortDateDow, todayLocal } from '../lib/time';
import { ConfirmButton, Sheet } from '../components/ui';
import { TITLE_TODO, merchantHint } from '../lib/importExpenses';

export const EXPENSE_ICON: Record<ExpenseCategory, string> = { stay: '🛏️', food: '🍴', cafe: '☕', transport: '🚕', ticket: '🎫', shop: '🛍️', etc: '🧾' };
const PLATFORMS = ['현장 결제', '트립닷컴', '클룩', '마이리얼트립', '아고다', '네이버', '디디(택시)', '항공사'];

type Preset = 'equal' | 'onlyMe' | 'onlyFriend' | 'one' | 'amount' | 'ratio';
const round = (v: number, cur: Currency) => Math.round(v * 10 ** CURRENCY_DECIMALS[cur]) / 10 ** CURRENCY_DECIMALS[cur];
const numOr0 = (s: string) => (s.trim() === '' ? 0 : Number(s.replace(/,/g, '')));

/** 새 지출의 통화 = 이 여행에서 마지막으로 저장한 통화 (이 폰 기억 → 없으면 내가 넣은 가장 최근 지출) */
const curKey = (tripId: string) => `travely:lastCurrency:${tripId}`;
function lastCurrency(tripId: string, uid: string, list: Expense[]): Currency | null {
  try {
    const v = localStorage.getItem(curKey(tripId));
    if (v && (CURRENCIES as readonly string[]).includes(v)) return v as Currency;
  } catch {
    /* 저장소 못 쓰면 아래로 */
  }
  const mine = list.filter((e) => e.createdBy === uid).sort((a, b) => `${a.date ?? ''}${a.time ?? ''}`.localeCompare(`${b.date ?? ''}${b.time ?? ''}`));
  return mine.length ? mine[mine.length - 1].currency : null;
}
function rememberCurrency(tripId: string, cur: Currency) {
  try {
    localStorage.setItem(curKey(tripId), cur);
  } catch {
    /* 무시 */
  }
}

export default function ExpenseSheet({ expense, onClose }: { expense?: Expense; onClose: () => void }) {
  const c = useTripCtx();
  const people = c.bundle.members.filter((m) => m.status === 'active' || (expense && (expense.payers[m.uid] || expense.split.shares[m.uid])))
    .sort((a, b) => (a.uid === c.user.uid ? -1 : b.uid === c.user.uid ? 1 : 0));
  const me = c.user.uid;
  const friend = people.find((p) => p.uid !== me)?.uid;
  const today = todayLocal();
  const inTrip = c.bundle.days.some((d) => d.date === today);

  const [title, setTitle] = useState(expense?.title === TITLE_TODO ? '' : expense?.title ?? ''); // 가져온 지출은 이름 칸을 비워서 바로 입력
  const [date, setDate] = useState<string | null>(expense ? expense.date : inTrip ? today : c.bundle.days[0]?.date ?? null);
  const [time, setTime] = useState(expense?.time ?? (inTrip ? nowHHMM() : ''));
  const [category, setCategory] = useState<ExpenseCategory>(expense?.category ?? 'food');
  const [amountText, setAmountText] = useState(expense ? String(expense.amount) : '');
  const [currency, setCurrency] = useState<Currency>(() => expense?.currency ?? lastCurrency(c.tripId, c.user.uid, c.bundle.expenses) ?? c.bundle.trip.baseCurrency);
  const [rateText, setRateText] = useState(expense && expense.currency !== 'KRW' ? String(expense.krwRate) : '');
  const [rateInfo, setRateInfo] = useState<FxRate | null>(null);
  const [rateDate, setRateDate] = useState<string | null>(expense?.krwRateDate ?? null);
  const [actualText, setActualText] = useState(expense?.krwActual != null ? String(expense.krwActual) : '');
  const [method, setMethod] = useState<PayMethod>(expense?.method ?? 'credit');
  const [cardName, setCardName] = useState(expense?.cardName ?? '');
  const [platform, setPlatform] = useState(expense?.platform ?? '');
  const [payers, setPayers] = useState<string[]>(expense ? Object.keys(expense.payers).filter((k) => expense.payers[k] > 0) : [me]);
  const [payAmt, setPayAmt] = useState<Record<string, string>>(() => (expense ? Object.fromEntries(Object.entries(expense.payers).map(([k, v]) => [k, String(v)])) : {}));
  const initialPreset = (): Preset => {
    if (!expense) return 'equal';
    const ids = Object.keys(expense.split.shares).filter((k) => expense.split.shares[k] > 0);
    if (expense.split.mode === 'equal' && ids.length === 1) return people.length === 2 ? (ids[0] === me ? 'onlyMe' : 'onlyFriend') : 'one';
    return expense.split.mode;
  };
  const [preset, setPreset] = useState<Preset>(initialPreset);
  const [participants, setParticipants] = useState<string[]>(expense && expense.split.mode === 'equal' ? Object.keys(expense.split.shares).filter((k) => expense.split.shares[k] > 0) : people.filter((p) => p.status === 'active').map((p) => p.uid));
  const [oneWho, setOneWho] = useState<string>(me);
  const [shareText, setShareText] = useState<Record<string, string>>(() =>
    expense && expense.split.mode !== 'equal' ? Object.fromEntries(Object.entries(expense.split.shares).map(([k, v]) => [k, String(v)])) : Object.fromEntries(people.map((p) => [p.uid, '1'])));
  const [memo, setMemo] = useState(expense?.memo ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const amount = numOr0(amountText);

  const cards = useMemo(() => [...new Set(c.bundle.expenses.map((e) => e.cardName).filter(Boolean))], [c.bundle.expenses]);
  const platforms = useMemo(() => [...new Set([...c.bundle.expenses.map((e) => e.platform).filter(Boolean), ...PLATFORMS])], [c.bundle.expenses]);

  // 통화를 고르면 최근 환율로 채움 (사용자가 고칠 수 있음)
  useEffect(() => {
    if (currency === 'KRW') return;
    if (expense && expense.currency === currency) return;
    let alive = true;
    getKrwRate(currency).then((r) => {
      if (!alive) return;
      setRateInfo(r);
      if (r) {
        setRateText(String(+r.rate.toFixed(4)));
        setRateDate(r.date || null);
      } else setRateText('');
    });
    return () => {
      alive = false;
    };
  }, [currency, expense]);

  const payersMap = (): Record<string, number> => {
    if (payers.length === 1) return { [payers[0]]: amount };
    const typed = payers.some((p) => payAmt[p]?.trim());
    if (!typed) {
      const minor = Math.round(amount * 10 ** CURRENCY_DECIMALS[currency]);
      const al = allocate(minor, Object.fromEntries(payers.map((p) => [p, 1])));
      return Object.fromEntries(payers.map((p) => [p, (al.get(p) ?? 0) / 10 ** CURRENCY_DECIMALS[currency]]));
    }
    return Object.fromEntries(payers.map((p) => [p, round(numOr0(payAmt[p] ?? ''), currency)]));
  };
  const split = (): { mode: SplitMode; shares: Record<string, number> } => {
    if (preset === 'onlyMe') return { mode: 'equal', shares: { [me]: 1 } };
    if (preset === 'onlyFriend' && friend) return { mode: 'equal', shares: { [friend]: 1 } };
    if (preset === 'one') return { mode: 'equal', shares: { [oneWho]: 1 } };
    if (preset === 'equal') return { mode: 'equal', shares: Object.fromEntries(participants.map((p) => [p, 1])) };
    const shares = Object.fromEntries(people.map((p) => [p.uid, round(numOr0(shareText[p.uid] ?? ''), preset === 'amount' ? currency : 'USD')]).filter(([, v]) => (v as number) > 0));
    return { mode: preset === 'amount' ? 'amount' : 'ratio', shares };
  };

  const rate = currency === 'KRW' ? 1 : numOr0(rateText);
  const actual = actualText.trim() ? numOr0(actualText) : null;
  const draftForPreview = { amount, currency, krwRate: rate, krwActual: actual, payers: payersMap(), split: split() };
  const krw = amount > 0 && rate > 0 ? expenseKrw(draftForPreview) : 0;
  const shareKrw = krw > 0 ? allocate(krw, splitWeights(draftForPreview)) : new Map<string, number>();

  const save = async () => {
    setErr(null);
    // 가져온 지출('내용 입력 필요')은 이름을 비워 두고 저장하면 가맹점 뜻(흐린 글씨)을 그대로 이름으로
    const hint = expense?.title === TITLE_TODO ? merchantHint(expense.memo) : '';
    const finalTitle = title.trim() || hint;
    if (!finalTitle) return setErr('지출 이름을 입력해 주세요');
    const v = validateExpense({ amount, currency, payers: payersMap(), split: split() });
    if (v) return setErr(v);
    if (currency !== 'KRW' && !(rate > 0) && actual == null) return setErr('원화 환산을 위해 환율이나 실제 원화 결제액을 넣어 주세요');
    const data: ExpenseInput = {
      title: finalTitle.slice(0, 100), date, time: time || null, category, amount: round(amount, currency), currency,
      krwRate: currency === 'KRW' ? 1 : rate, krwRateDate: currency === 'KRW' ? null : rateDate, krwActual: actual && actual > 0 ? Math.round(actual) : null,
      method, cardName: method === 'credit' || method === 'debit' ? cardName.trim().slice(0, 60) : '', platform: platform.trim().slice(0, 60),
      payers: payersMap(), split: expense?.split.settled ? { ...split(), settled: true } : split(), memo: memo.trim().slice(0, 1000),
    };
    setBusy(true);
    try {
      await saveExpense(c.tripId, c.user.uid, data, expense ?? null);
      rememberCurrency(c.tripId, currency);
      onClose();
    } catch (e) {
      setErr(e instanceof ConflictError ? '친구가 먼저 이 지출을 고쳤어요. 닫았다가 다시 열어 주세요' : describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const presets: { id: Preset; label: string }[] = people.length === 2
    ? [{ id: 'equal', label: '균등' }, { id: 'onlyMe', label: '나만' }, { id: 'onlyFriend', label: `${c.nameOf(friend!)}만` }, { id: 'amount', label: '금액 지정' }, { id: 'ratio', label: '비율' }]
    : [{ id: 'equal', label: '균등' }, { id: 'one', label: '한 명만' }, { id: 'amount', label: '금액 지정' }, { id: 'ratio', label: '비율' }];

  return (
    <Sheet onClose={onClose} label={expense ? '지출 수정' : '지출 추가'}>
      <h3>{expense ? '지출 수정' : '지출 추가'}</h3>
      <fieldset disabled={!c.editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <label className="field">
          <span className="label">지출 이름</span>
          <input className="input" id="exp-title" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={expense?.title === TITLE_TODO && merchantHint(expense.memo) ? `가맹점: ${merchantHint(expense.memo)}` : '예: 저녁 식사'} />
        </label>
        <div className="chips" style={{ flexWrap: 'wrap', marginBottom: 14 }}>
          {EXPENSE_CATEGORY_ORDER.map((k) => (
            <button type="button" key={k} className={`chip ${category === k ? 'on' : ''}`} style={{ minHeight: 36, padding: '6px 12px' }} onClick={() => setCategory(k)}>{EXPENSE_ICON[k]} {EXPENSE_CATEGORY_LABEL[k]}</button>
          ))}
        </div>
        <div className="row">
          <label className="field grow">
            <span className="label">결제 금액</span>
            <input className="input num" id="exp-amount" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value.replace(/[^0-9.,]/g, ''))} placeholder="0" />
          </label>
          <label className="field" style={{ width: 128 }}>
            <span className="label">통화</span>
            <select className="select" id="exp-currency" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>
              {CURRENCIES.map((x) => <option key={x} value={x}>{CURRENCY_SYMBOL[x]} {CURRENCY_LABEL[x]}</option>)}
            </select>
          </label>
        </div>
        {currency !== 'KRW' && (
          <div className="card soft" style={{ padding: 12, marginTop: -4, marginBottom: 14 }}>
            <div className="row">
              <span className="small grow">1 {CURRENCY_LABEL[currency]} =</span>
              <input className="input num" id="exp-rate" inputMode="decimal" style={{ width: 120, minHeight: 40 }} value={rateText} onChange={(e) => { setRateText(e.target.value.replace(/[^0-9.]/g, '')); setRateDate(null); }} placeholder="환율" />
              <span className="small">원</span>
            </div>
            <div className="hint" style={{ marginTop: 4 }}>
              {rateInfo && rateDate ? `${rateInfo.source} ${rateInfo.date} 기준 (하루 1회 갱신 · 카드사 환율과 다를 수 있어요)` : '직접 입력한 환율'}
              {!rateInfo && !rateText && ' · 환율을 불러오지 못했어요. 직접 입력해 주세요'}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <span className="small grow">실제 원화 결제액 (카드 명세서, 선택)</span>
              <input className="input num" id="exp-actual" inputMode="numeric" style={{ width: 120, minHeight: 40 }} value={actualText} onChange={(e) => setActualText(e.target.value.replace(/[^0-9]/g, ''))} placeholder="₩" />
            </div>
            {krw > 0 && <div className="small" style={{ marginTop: 6, color: 'var(--primary)', fontWeight: 700 }}>정산 기준 {formatKrw(krw)}{actual ? ' (실제 결제액)' : ''}</div>}
          </div>
        )}

        <div className="row">
          <label className="field grow">
            <span className="label">날짜</span>
            <select className="select" id="exp-date" value={date ?? ''} onChange={(e) => setDate(e.target.value || null)}>
              <option value="">여행 전 / 날짜 없음</option>
              {c.bundle.days.map((d) => <option key={d.date} value={d.date}>DAY {d.index + 1} · {shortDateDow(d.date)}</option>)}
            </select>
          </label>
          <label className="field" style={{ width: 112 }}>
            <span className="label">시간</span>
            <input className="input" type="time" id="exp-time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>

        <div className="field">
          <span className="label">결제수단</span>
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            {PAY_METHOD_ORDER.map((m) => <button type="button" key={m} className={`chip ${method === m ? 'on' : ''}`} style={{ minHeight: 36, padding: '6px 12px' }} onClick={() => setMethod(m)}>{PAY_METHOD_LABEL[m]}</button>)}
          </div>
        </div>
        {(method === 'credit' || method === 'debit') && (
          <label className="field">
            <span className="label">어떤 카드</span>
            <input className="input" id="exp-card" list="exp-cards" maxLength={60} value={cardName} onChange={(e) => setCardName(e.target.value)} placeholder="예: 트래블월렛, 신한 SOL트래블" />
            <datalist id="exp-cards">{cards.map((x) => <option key={x} value={x} />)}</datalist>
          </label>
        )}
        <label className="field">
          <span className="label">결제 플랫폼 (어디서 결제했는지)</span>
          <input className="input" id="exp-platform" list="exp-platforms" maxLength={60} value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="예: 현장 결제, 트립닷컴" />
          <datalist id="exp-platforms">{platforms.map((x) => <option key={x} value={x} />)}</datalist>
        </label>

        <div className="field">
          <span className="label">결제한 사람</span>
          <div className="who-pick">
            {people.map((p) => (
              <label key={p.uid} className={payers.includes(p.uid) ? 'on' : ''}>
                <input type="checkbox" id={`payer-${p.uid}`} checked={payers.includes(p.uid)} onChange={() => setPayers(payers.includes(p.uid) ? payers.filter((x) => x !== p.uid) : [...payers, p.uid])} />
                {p.uid === me ? '나' : p.displayName}
              </label>
            ))}
          </div>
          {payers.length > 1 && (
            <div className="col" style={{ marginTop: 4 }}>
              {payers.map((p) => (
                <div className="row" key={p}>
                  <span className="small grow">{p === me ? '나' : c.nameOf(p)}가 낸 금액</span>
                  <input className="input num" id={`payamt-${p}`} inputMode="decimal" style={{ width: 130, minHeight: 40 }} value={payAmt[p] ?? ''} onChange={(e) => setPayAmt({ ...payAmt, [p]: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="비우면 똑같이" />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="field">
          <span className="label">비용 부담 (결제자와 따로 기록)</span>
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            {presets.map((p) => <button type="button" key={p.id} className={`chip ${preset === p.id ? 'on' : ''}`} style={{ minHeight: 36, padding: '6px 12px' }} onClick={() => setPreset(p.id)} data-testid={`split-${p.id}`}>{p.label}</button>)}
          </div>
          {preset === 'equal' && (
            <div className="who-pick">
              {people.map((p) => (
                <label key={p.uid} className={participants.includes(p.uid) ? 'on' : ''}>
                  <input type="checkbox" id={`part-${p.uid}`} checked={participants.includes(p.uid)} onChange={() => setParticipants(participants.includes(p.uid) ? participants.filter((x) => x !== p.uid) : [...participants, p.uid])} />
                  {p.uid === me ? '나' : p.displayName}
                </label>
              ))}
            </div>
          )}
          {preset === 'one' && (
            <select className="select" id="split-one" value={oneWho} onChange={(e) => setOneWho(e.target.value)}>
              {people.map((p) => <option key={p.uid} value={p.uid}>{p.uid === me ? '나' : p.displayName}</option>)}
            </select>
          )}
          {(preset === 'amount' || preset === 'ratio') && (
            <div className="col">
              {people.map((p) => (
                <div className="row" key={p.uid}>
                  <span className="small grow">{p.uid === me ? '나' : p.displayName} {preset === 'amount' ? `부담 금액 (${CURRENCY_SYMBOL[currency]})` : '비율'}</span>
                  <input className="input num" id={`share-${p.uid}`} inputMode="decimal" style={{ width: 120, minHeight: 40 }} value={shareText[p.uid] ?? ''} onChange={(e) => setShareText({ ...shareText, [p.uid]: e.target.value.replace(/[^0-9.]/g, '') })} />
                </div>
              ))}
            </div>
          )}
          {krw > 0 && shareKrw.size > 0 && (
            <span className="hint" style={{ color: 'var(--primary)' }}>
              부담: {[...shareKrw].map(([k, v]) => `${k === me ? '나' : c.nameOf(k)} ${formatKrw(v)}`).join(' · ')}
            </span>
          )}
        </div>

        <label className="field">
          <span className="label">메모</span>
          <input className="input" id="exp-memo" maxLength={1000} value={memo} onChange={(e) => setMemo(e.target.value)} />
        </label>
      </fieldset>
      {amount > 0 && currency !== 'KRW' && <p className="hint">결제 {formatMoney(amount, currency)}</p>}
      {err && <p className="err">{err}</p>}
      {c.editable && (
        <div className="actions">
          <button className="btn" onClick={onClose}>취소</button>
          <button className="btn primary" onClick={save} disabled={busy} data-testid="save-expense">{busy ? '저장 중…' : '저장'}</button>
        </div>
      )}
      {expense && c.editable && (
        <div style={{ marginTop: 10 }}>
          <ConfirmButton label="지출 삭제" confirmLabel="정말 삭제" onConfirm={() => deleteExpense(c.tripId, expense.id).then(onClose, (e) => setErr(describeError(e)))} />
        </div>
      )}
      {expense && <p className="hint">마지막 수정: {c.nameOf(expense.updatedBy)}</p>}
    </Sheet>
  );
}

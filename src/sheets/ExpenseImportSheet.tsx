import { useEffect, useMemo, useState } from 'react';
import { useTripCtx } from '../pages/TripLayout';
import { addExpenses, type ExpenseInput } from '../data/repo';
import { buildExpenseImport, dupKey, resolvePayer, type SplitKey } from '../lib/importExpenses';
import { getKrwRate } from '../lib/fx';
import type { Currency } from '../lib/types';
import { CURRENCY_LABEL, PAY_METHOD_LABEL } from '../lib/types';
import { formatKrw, formatMoney } from '../lib/settle';
import { shortDateDow } from '../lib/time';
import { describeError } from '../lib/saveStatus';
import { Icon, Sheet, toast } from '../components/ui';

const SPLIT_LABEL: Record<SplitKey, string> = { equal: '반반', payerOnly: '결제자만 부담', otherOnly: '상대만 부담' };

/** 결제 캡처 → (Claude 가 만든) JSON → 미리보기 → 지출 여러 건 추가 */
export default function ExpenseImportSheet({ onClose }: { onClose: () => void }) {
  const c = useTripCtx();
  const me = c.user.uid;
  const members = c.activeMembers;
  const [text, setText] = useState('');
  const [payer, setPayer] = useState<string | null>(null); // null = 파일 값 그대로
  const [split, setSplit] = useState<SplitKey | null>(null);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const parsed = useMemo(() => {
    if (!text.trim()) return { data: null, error: null };
    try {
      return { data: buildExpenseImport(text, c.bundle.days, c.bundle.trip.baseCurrency), error: null };
    } catch (e) {
      return { data: null, error: (e as Error).message };
    }
  }, [text, c.bundle.days, c.bundle.trip.baseCurrency]);
  const data = parsed.data;

  const existing = useMemo(() => new Set(c.bundle.expenses.map(dupKey)), [c.bundle.expenses]);
  const fresh = data ? data.items.filter((i) => !existing.has(dupKey(i))) : [];
  const dups = data ? data.items.length - fresh.length : 0;
  const currencies = [...new Set(fresh.map((i) => i.currency).filter((x) => x !== 'KRW'))] as Currency[];

  // 기본 결제자·분담 = 파일 값
  const filePayer = data ? resolvePayer(data.defaults.payer, me, members) ?? me : me;
  const payerUid = payer ?? filePayer;
  const splitKey: SplitKey = split ?? data?.defaults.split ?? 'equal';

  // 환율: 오늘 환율 자동 → 안 되면 이 여행에서 마지막으로 쓴 환율
  useEffect(() => {
    for (const cur of currencies) {
      if (rates[cur]) continue;
      const last = [...c.bundle.expenses].filter((e) => e.currency === cur && e.krwRate > 0).pop()?.krwRate;
      if (last) setRates((r) => ({ ...r, [cur]: r[cur] || String(last) }));
      getKrwRate(cur).then((fx) => fx && setRates((r) => ({ ...r, [cur]: String(+fx.rate.toFixed(4)) }))).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currencies.join(',')]);

  const run = async () => {
    if (!fresh.length) return;
    const missing = currencies.filter((cur) => !(Number(rates[cur]) > 0));
    if (missing.length && fresh.some((i) => missing.includes(i.currency) && i.krwActual == null))
      return setErr(`${missing.map((m) => CURRENCY_LABEL[m]).join(', ')} 환율을 넣어 주세요`);
    setBusy(true);
    setErr(null);
    const today = new Date().toISOString().slice(0, 10);
    const rows: ExpenseInput[] = fresh.map((i) => {
      const p = (i.payer ? resolvePayer(i.payer, me, members) : null) ?? payerUid;
      const sk = i.split ?? splitKey;
      const other = members.find((m) => m.uid !== p)?.uid;
      const shares =
        sk === 'payerOnly' ? { [p]: 1 } : sk === 'otherOnly' && other ? { [other]: 1 } : Object.fromEntries(members.map((m) => [m.uid, 1]));
      return {
        title: i.title, date: i.date, time: i.time, category: i.category, amount: i.amount, currency: i.currency,
        krwRate: i.currency === 'KRW' ? 1 : Number(rates[i.currency]) || 1, krwRateDate: i.currency === 'KRW' ? null : today, krwActual: i.krwActual,
        method: i.method, cardName: i.cardName, platform: i.platform,
        payers: { [p]: i.amount }, split: { mode: 'equal', shares }, memo: i.memo,
      } as ExpenseInput;
    });
    try {
      const n = await addExpenses(c.tripId, me, rows);
      try {
        localStorage.setItem(`travely:lastCurrency:${c.tripId}`, rows[rows.length - 1].currency);
      } catch {
        /* 무시 */
      }
      toast(`지출 ${n}건을 추가했어요 · 항목 이름은 눌러서 적어 주세요`);
      onClose();
    } catch (e) {
      setErr(describeError(e));
      setBusy(false);
    }
  };
  const name = (uid: string) => (uid === me ? '나' : c.nameOf(uid));

  return (
    <Sheet onClose={onClose} label="지출 한 번에 가져오기" wide>
      <h3>지출 한 번에 가져오기</h3>
      <p className="small muted" style={{ marginTop: -8 }}>
        결제 캡처를 Claude 에게 보내면 만들어 주는 파일을 넣으면 돼요. 날짜·시간·금액·통화·결제수단만 들어가고, 항목 이름은 ‘내용 입력 필요’로 비워 둬요.
      </p>
      <label className="btn block" style={{ marginBottom: 10 }}>
        <Icon name="file" size={18} /> 파일 선택
        <input type="file" accept=".json,.txt,application/json,text/plain" hidden data-testid="exp-import-file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
      </label>
      <div className="field">
        <label className="label" htmlFor="exp-import-text">또는 붙여넣기</label>
        <textarea className="textarea" id="exp-import-text" style={{ minHeight: 90, fontFamily: 'ui-monospace, Menlo, monospace' }} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off" placeholder='{ "expenses": [ ... ] }' />
      </div>
      {parsed.error && <p className="err" data-testid="exp-import-error">{parsed.error}</p>}

      {data && (
        <>
          <div className="card pad" style={{ marginBottom: 10 }}>
            <div className="small muted" style={{ marginBottom: 6 }}>결제한 사람 (전부)</div>
            <div className="row wrap">
              {members.map((m) => (
                <button key={m.uid} className={`chip ${payerUid === m.uid ? 'on' : ''}`} onClick={() => setPayer(m.uid)} data-testid={`exp-import-payer-${m.uid === me ? 'me' : 'other'}`}>{name(m.uid)}</button>
              ))}
            </div>
            <div className="small muted" style={{ margin: '10px 0 6px' }}>정산</div>
            <div className="row wrap">
              {(Object.keys(SPLIT_LABEL) as SplitKey[]).map((k) => (
                <button key={k} className={`chip ${splitKey === k ? 'on' : ''}`} onClick={() => setSplit(k)} data-testid={`exp-import-split-${k}`}>{SPLIT_LABEL[k]}</button>
              ))}
            </div>
            {currencies.map((cur) => (
              <div className="row" key={cur} style={{ marginTop: 10 }}>
                <span className="small grow">1 {CURRENCY_LABEL[cur]} =</span>
                <input className="input num" style={{ width: 120, minHeight: 40 }} inputMode="decimal" value={rates[cur] ?? ''} onChange={(e) => setRates({ ...rates, [cur]: e.target.value.replace(/[^0-9.]/g, '') })} aria-label={`${cur} 환율`} data-testid={`exp-import-rate-${cur}`} />
                <span className="small">원</span>
              </div>
            ))}
          </div>

          {[...data.warnings, ...(dups ? [`이미 있는 지출(같은 날짜·시간·금액) ${dups}건은 건너뛰어요.`] : [])].map((w) => <p key={w} className="hint" style={{ margin: '0 2px 6px' }}>⚠️ {w}</p>)}

          <div className="card list" data-testid="exp-import-preview">
            {fresh.map((i, k) => (
              <div key={k} className="row" style={{ padding: '10px 14px', gap: 10, borderTop: k ? '1px solid var(--line)' : undefined }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }} className="ellipsis">{i.merchantKo || i.merchant || i.title}</div>
                  {i.merchantKo && i.merchant && <div className="small faint ellipsis">{i.merchant}</div>}
                  <div className="small muted">{i.date ? shortDateDow(i.date) : '날짜 없음'}{i.time ? ` ${i.time}` : ''} · {PAY_METHOD_LABEL[i.method]}{i.cardName ? `(${i.cardName})` : ''}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <b className="num">{i.currency === 'KRW' ? formatKrw(i.amount) : formatMoney(i.amount, i.currency)}</b>
                  {i.krwActual ? <div className="small muted">실결제 {formatKrw(i.krwActual)}</div> : null}
                </div>
              </div>
            ))}
            {fresh.length === 0 && <div className="pad muted small">추가할 새 지출이 없어요</div>}
          </div>
        </>
      )}
      {err && <p className="err">{err}</p>}
      <div className="actions" style={{ marginTop: 14 }}>
        <button className="btn" onClick={onClose}>취소</button>
        <button className="btn primary" disabled={!fresh.length || busy || !c.editable} onClick={run} data-testid="exp-import-run">
          {busy ? '추가하는 중…' : `${fresh.length}건 추가`}
        </button>
      </div>
    </Sheet>
  );
}

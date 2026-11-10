import { useEffect, useRef, useState } from 'react';
import { useTripCtx } from '../pages/TripLayout';
import type { Currency, Expense, ExpenseCategory, PayMethod } from '../lib/types';
import { CURRENCIES, CURRENCY_LABEL, CURRENCY_SYMBOL, EXPENSE_CATEGORY_LABEL, PAY_METHOD_LABEL } from '../lib/types';
import { byCategory, expenseKrw, formatKrw, formatMoney, settle, splitSummary } from '../lib/settle';
import { getKrwRate, type FxRate } from '../lib/fx';
import { formatDateTime, shortDateDow } from '../lib/time';
import { ConfirmButton, Icon, Sheet, toast } from '../components/ui';
import { renameExpenses, setExpensesSettled } from '../data/repo';
import { describeError } from '../lib/saveStatus';
import ExpenseSheet, { EXPENSE_ICON } from '../sheets/ExpenseSheet';
import ExpenseImportSheet from '../sheets/ExpenseImportSheet';
import { TITLE_TODO, merchantHint } from '../lib/importExpenses';

/** 환율 계산기: 여행 기본 통화 ↔ 원 양방향 */
function FxSheet({ onClose }: { onClose: () => void }) {
  const c = useTripCtx();
  const [cur, setCur] = useState<Currency>(c.bundle.trip.baseCurrency === 'KRW' ? 'USD' : c.bundle.trip.baseCurrency);
  const [r, setR] = useState<FxRate | null>(null);
  const [loading, setLoading] = useState(false);
  const [manual, setManual] = useState('');
  const [a, setA] = useState('100');
  const [b, setB] = useState('');
  const rate = manual ? Number(manual) : r?.rate ?? 0;
  const load = (force = false) => {
    setLoading(true);
    getKrwRate(cur, force).then((x) => {
      setR(x);
      setLoading(false);
    });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
  }, [cur]);
  useEffect(() => {
    if (rate > 0 && a !== '') setB(String(Math.round(Number(a) * rate)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rate]);
  return (
    <Sheet onClose={onClose} label="환율 계산">
      <h3>환율 계산</h3>
      <label className="field">
        <span className="label">통화</span>
        <select className="select" id="fx-cur" value={cur} onChange={(e) => { setCur(e.target.value as Currency); setManual(''); }}>
          {CURRENCIES.filter((x) => x !== 'KRW').map((x) => <option key={x} value={x}>{CURRENCY_SYMBOL[x]} {CURRENCY_LABEL[x]} ({x})</option>)}
        </select>
      </label>
      <div className="card soft pad" style={{ marginBottom: 14 }}>
        <div className="row">
          <input className="input num grow" id="fx-a" inputMode="decimal" value={a} onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ''); setA(v); setB(v && rate ? String(Math.round(Number(v) * rate)) : ''); }} />
          <b>{CURRENCY_SYMBOL[cur]}</b>
        </div>
        <div style={{ textAlign: 'center', margin: '6px 0', color: 'var(--primary)' }}><Icon name="swap" /></div>
        <div className="row">
          <input className="input num grow" id="fx-b" inputMode="numeric" value={b} onChange={(e) => { const v = e.target.value.replace(/[^0-9]/g, ''); setB(v); setA(v && rate ? String(+(Number(v) / rate).toFixed(2)) : ''); }} />
          <b>₩</b>
        </div>
      </div>
      <p className="small" style={{ margin: '0 0 6px' }}>
        {rate > 0 ? <>1 {CURRENCY_LABEL[cur]} = <b>{rate.toFixed(2)}원</b></> : '환율 정보 없음'}
      </p>
      <p className="hint" style={{ marginTop: 0 }}>
        {manual ? '직접 입력한 환율' : r ? `${r.source} · ${r.date} 기준 · 조회 ${formatDateTime(r.fetchedAt)} (하루 1회 갱신, 실시간 아님)` : loading ? '불러오는 중…' : '환율을 불러오지 못했어요(오프라인·차단). 아래에 직접 입력해 주세요.'}
      </p>
      <div className="row">
        <input className="input num grow" id="fx-manual" inputMode="decimal" value={manual} onChange={(e) => setManual(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="환율 직접 입력 (예: 환전 영수증)" />
        <button className="btn" onClick={() => { setManual(''); load(true); }} disabled={loading}><Icon name="refresh" size={18} /> 새로고침</button>
      </div>
      <p className="hint">카드사·환전소 실제 환율과 차이가 있어요. 지출에는 저장할 때의 환율이 함께 저장돼요.</p>
    </Sheet>
  );
}

export default function LedgerTab() {
  const c = useTripCtx();
  const [tab, setTab] = useState<'list' | 'settle'>('list');
  const [edit, setEdit] = useState<Expense | 'new' | null>(null);
  const [fx, setFx] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [fDay, setFDay] = useState<string>('all');
  const [fPayer, setFPayer] = useState<string>('all');
  const [fMethod, setFMethod] = useState<'all' | PayMethod>('all');
  const [fCat, setFCat] = useState<'all' | ExpenseCategory>('all');
  const [filters, setFilters] = useState(false);
  const me = c.user.uid;
  const name = (uid: string) => (uid === me ? '나' : c.nameOf(uid));
  const memberUids = c.activeMembers.map((m) => m.uid);
  const isSettled = (e: Expense) => !!e.split.settled;
  const open = c.bundle.expenses.filter((e) => !isSettled(e));
  const done = c.bundle.expenses.filter(isSettled);
  const all = settle(c.bundle.expenses, memberUids); // 여행 전체 지출 (표시용)
  const s = settle(open, memberUids); // 정산 완료 표시한 건 빼고 남은 것만 정산
  const doneKrw = done.reduce((t, e) => t + expenseKrw(e), 0);
  const paidBy = new Map(all.people.map((p) => [p.uid, p.paid]));
  const toggleSettled = (e: Expense) =>
    setExpensesSettled(c.tripId, me, [e], !isSettled(e)).catch((er) => toast(describeError(er)));
  // 노란 '내용 입력' 지출: 두 번 톡 → 가맹점 뜻 그대로 이름 저장 / 한 번 → 수정 창
  const tap = useRef<{ id: string; t: number; timer: number } | null>(null);
  const todos = c.bundle.expenses.filter((e) => e.title === TITLE_TODO && merchantHint(e.memo));
  const quickName = (list: Expense[]) =>
    renameExpenses(c.tripId, me, list.map((e) => ({ e, title: merchantHint(e.memo) }))).then(
      () => toast(list.length === 1 ? `‘${merchantHint(list[0].memo)}’(으)로 저장했어요` : `${list.length}건 이름을 그대로 저장했어요`),
      (er) => toast(describeError(er)),
    );
  const onRow = (e: Expense) => {
    if (!c.editable || e.title !== TITLE_TODO || !merchantHint(e.memo)) return setEdit(e);
    const now = Date.now();
    const p = tap.current;
    if (p && p.id === e.id && now - p.t < 330) {
      clearTimeout(p.timer);
      tap.current = null;
      void quickName([e]);
      return;
    }
    if (p) clearTimeout(p.timer);
    tap.current = { id: e.id, t: now, timer: window.setTimeout(() => { tap.current = null; setEdit(e); }, 330) };
  };
  const settleAll = () =>
    setExpensesSettled(c.tripId, me, open, true).then(() => toast(`${open.length}건을 정산 완료로 표시했어요`), (er) => toast(describeError(er)));

  const list = c.bundle.expenses.filter((e) =>
    (fDay === 'all' || (fDay === 'none' ? e.date === null : e.date === fDay)) &&
    (fPayer === 'all' || (e.payers[fPayer] ?? 0) > 0) &&
    (fMethod === 'all' || e.method === fMethod) &&
    (fCat === 'all' || e.category === fCat));
  // 최신이 위로: 마지막 날짜부터, 같은 날은 늦은 시간부터, '여행 전/날짜 없음'은 맨 아래
  const groups = [...c.bundle.days.map((d) => d.date).reverse(), null]
    .map((d) => ({ d, items: list.filter((e) => (e.date ?? null) === d).sort((a, b) => (b.time ?? '').localeCompare(a.time ?? '')) }))
    .filter((g) => g.items.length);
  const filtered = fDay !== 'all' || fPayer !== 'all' || fMethod !== 'all' || fCat !== 'all';
  const cats = [...byCategory(c.bundle.expenses)].sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...cats.map((x) => x[1]));
  const main = s.transfers[0];

  return (
    <div className="t-body">
      <div className="row between" style={{ margin: '10px 0 14px' }}>
        <h2 style={{ fontSize: 28, margin: 0, letterSpacing: '-0.03em' }}>공동 가계부</h2>
        <div className="row" style={{ gap: 6 }}>
          {c.editable && <button className="btn soft sm" onClick={() => setBulk(true)} data-testid="exp-import"><Icon name="download" size={18} /> 한 번에</button>}
          <button className="btn soft sm" onClick={() => setFx(true)} data-testid="fx"><Icon name="swap" size={18} /> 환율</button>
        </div>
      </div>

      <div className="hero">
        <div style={{ opacity: 0.85 }}>여행 전체 지출</div>
        <div className="big" data-testid="total">{formatKrw(all.total)}</div>
        <div className="who">
          {memberUids.map((u) => <span key={u}>{name(u)} 결제 <b>{formatKrw(paidBy.get(u) ?? 0)}</b></span>)}
        </div>
      </div>

      <div className="settle-now" style={{ marginTop: 14 }} data-testid="settle-now">
        <div className="row" style={{ color: 'var(--primary)', fontWeight: 800, marginBottom: 10 }}><Icon name="check" /> 지금 정산한다면</div>
        {main ? (
          <div className="line">
            <span>{name(main.from)}</span><Icon name="next" /><span>{name(main.to)}</span>
            <span className="amt">{formatKrw(main.amount)}</span>
          </div>
        ) : (
          <div className="line"><span>정산할 금액이 없어요</span></div>
        )}
        <div className="hint" style={{ marginTop: 8 }}>
          {memberUids.map((u) => `${name(u)} 부담 ${formatKrw(s.people.find((p) => p.uid === u)?.share ?? 0)}`).join(' · ')} · 결제액 차이로 자동 계산
        </div>
        {done.length > 0 && (
          <div className="hint" style={{ marginTop: 4 }} data-testid="settled-note">✓ 정산 완료 {done.length}건({formatKrw(doneKrw)})은 빼고 남은 {open.length}건만 계산했어요</div>
        )}
      </div>

      <div className="seg" style={{ margin: '16px 0 12px' }}>
        <button className={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}>지출 내역</button>
        <button className={tab === 'settle' ? 'on' : ''} onClick={() => setTab('settle')} data-testid="tab-settle">최종 정산</button>
      </div>

      {tab === 'list' && (
        <>
          <div className="row between" style={{ margin: '4px 2px 10px' }}>
            <b style={{ fontSize: 18 }}>지출 내역 <span style={{ color: 'var(--primary-2)' }}>{list.length}건</span></b>
            <button className="btn ghost sm" onClick={() => setFilters(!filters)} style={{ color: filtered ? 'var(--primary)' : undefined }}><Icon name="filter" size={18} /> {filtered ? '필터 적용 중' : '전체'}</button>
          </div>
          {c.editable && todos.length > 0 && (
            <div className="todo-bar" data-testid="todo-bar">
              <span>✏️ 이름 비어 있는 지출 {todos.length}건 · 노란 칸을 <b>두 번 톡</b> 하면 그대로 저장</span>
              <ConfirmButton className="btn sm todo-all" label="모두 그대로 저장" confirmLabel={`${todos.length}건 저장할까요?`} onConfirm={() => quickName(todos)} />
            </div>
          )}
          {filters && (
            <div className="card pad" style={{ marginBottom: 12 }}>
              <div className="row wrap">
                <select className="select grow" aria-label="날짜" value={fDay} onChange={(e) => setFDay(e.target.value)} style={{ minWidth: 130 }}>
                  <option value="all">모든 날짜</option><option value="none">여행 전</option>
                  {c.bundle.days.map((d) => <option key={d.date} value={d.date}>DAY {d.index + 1}</option>)}
                </select>
                <select className="select grow" aria-label="결제자" value={fPayer} onChange={(e) => setFPayer(e.target.value)} style={{ minWidth: 130 }}>
                  <option value="all">모든 결제자</option>
                  {memberUids.map((u) => <option key={u} value={u}>{name(u)} 결제</option>)}
                </select>
                <select className="select grow" aria-label="결제수단" value={fMethod} onChange={(e) => setFMethod(e.target.value as 'all' | PayMethod)} style={{ minWidth: 130 }}>
                  <option value="all">모든 결제수단</option>
                  {Object.entries(PAY_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <select className="select grow" aria-label="카테고리" value={fCat} onChange={(e) => setFCat(e.target.value as 'all' | ExpenseCategory)} style={{ minWidth: 130 }}>
                  <option value="all">모든 카테고리</option>
                  {Object.entries(EXPENSE_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              {filtered && <p className="small" style={{ margin: '10px 0 0' }}>필터 합계 <b>{formatKrw(list.reduce((t, e) => t + expenseKrw(e), 0))}</b></p>}
            </div>
          )}
          {groups.length === 0 && <div className="empty-day">{filtered ? '조건에 맞는 지출이 없어요' : '아직 지출이 없어요'}</div>}
          {groups.map((g) => (
            <section key={g.d ?? 'none'} style={{ marginBottom: 14 }}>
              <div className="small faint" style={{ fontWeight: 700, margin: '0 4px 8px' }}>{g.d ? `DAY ${c.dayIndex(g.d) + 1} · ${shortDateDow(g.d)}` : '여행 전 / 날짜 없음'} · {formatKrw(g.items.reduce((t, e) => t + expenseKrw(e), 0))}</div>
              {g.items.map((e) => {
                const payerIds = Object.keys(e.payers).filter((k) => e.payers[k] > 0);
                const st = isSettled(e);
                return (
                  <div key={e.id} className={`exp-wrap ${st ? 'settled' : ''}`}>
                  <button className="exp-card" onClick={() => onRow(e)} data-testid="expense">
                    <span className="exp-ico">{EXPENSE_ICON[e.category]}</span>
                    <span className="t ellipsis">{e.title === TITLE_TODO ? <span className="todo-title">✏️ {merchantHint(e.memo) || '내용 입력 필요'}</span> : e.title}</span>
                    <span className="amt">{e.currency === 'KRW' ? formatKrw(e.amount) : formatMoney(e.amount, e.currency)}</span>
                    <span className="m">
                      {payerIds.map(name).join('·')} 결제 · {PAY_METHOD_LABEL[e.method]}{e.cardName ? `(${e.cardName})` : ''}{e.platform ? ` · ${e.platform}` : ''}
                      {e.currency !== 'KRW' && <> · ≈ {formatKrw(expenseKrw(e))}{e.krwActual ? ' 실결제' : ''}</>}
                      {e.time ? ` · ${e.time}` : ''}
                    </span>
                    <span className="s" style={{ gridColumn: '2 / 4', paddingRight: 92 }}>{splitSummary(e, name, memberUids.length)}</span>
                  </button>
                  <button className={`settle-chk ${st ? 'on' : ''}`} role="checkbox" aria-checked={st} aria-label={`${e.title} 정산 완료`} disabled={!c.editable} onClick={() => toggleSettled(e)} data-testid="settle-chk">
                    <span className="box">{st ? '✓' : ''}</span>정산 완료
                  </button>
                  </div>
                );
              })}
            </section>
          ))}
        </>
      )}

      {tab === 'settle' && (
        <div className="col" style={{ gap: 14 }} data-testid="settle">
          <div className="card pad">
            <div className="small muted" style={{ marginBottom: 6 }}>{done.length ? `남은 지출 ${open.length}건 기준 송금` : '최종 송금'}</div>
            {s.transfers.length === 0 ? <b style={{ fontSize: 20 }}>보낼 돈이 없어요 ✓</b> : s.transfers.map((t, i) => (
              <div key={i} className="row" style={{ fontSize: 22, fontWeight: 800, margin: '4px 0' }} data-testid="transfer">
                <span>{name(t.from)}</span><Icon name="next" /><span className="grow">{name(t.to)}</span>
                <span style={{ color: 'var(--primary)', fontSize: 28 }} className="num">{formatKrw(t.amount)}</span>
              </div>
            ))}
          </div>
          {c.editable && open.length > 0 && (
            <div className="card pad">
              <div className="small muted" style={{ marginBottom: 8 }}>위 금액대로 보냈다면, 지금까지 지출을 한 번에 정산 완료로 표시할 수 있어요. 이후 지출만 새로 계산돼요.</div>
              <ConfirmButton className="btn soft block" label={`남은 ${open.length}건 모두 정산 완료로 표시`} confirmLabel="정말 표시할까요?" onConfirm={settleAll} />
            </div>
          )}
          {done.length > 0 && <p className="hint" style={{ margin: '0 2px' }}>✓ 정산 완료 {done.length}건({formatKrw(doneKrw)})은 계산에서 빠져 있어요. 지출 내역에서 체크를 풀면 다시 들어가요.</p>}
          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead><tr><th>이름</th><th>실제 결제</th><th>부담액</th><th>차액</th></tr></thead>
              <tbody>
                {s.people.map((p) => (
                  <tr key={p.uid}>
                    <td>{name(p.uid)}</td><td>{formatKrw(p.paid)}</td><td>{formatKrw(p.share)}</td>
                    <td style={{ color: p.balance > 0 ? 'var(--ok)' : p.balance < 0 ? 'var(--danger)' : undefined, fontWeight: 700 }}>{p.balance > 0 ? '+' : ''}{formatKrw(p.balance)}</td>
                  </tr>
                ))}
                <tr><td><b>합계</b></td><td><b>{formatKrw(s.total)}</b></td><td><b>{formatKrw(s.total)}</b></td><td /></tr>
              </tbody>
            </table>
          </div>
          {cats.length > 0 && (
            <div className="card pad col">
              <b>카테고리별</b>
              {cats.map(([k, v]) => (
                <div className="bar-row" key={k}><span>{EXPENSE_ICON[k]} {EXPENSE_CATEGORY_LABEL[k]}</span><span className="meter"><i style={{ width: `${(v / maxCat) * 100}%` }} /></span><span className="num small">{formatKrw(v)}</span></div>
              ))}
            </div>
          )}
          <p className="hint">원화 기준으로 계산해요. 외화 지출은 저장할 때의 환율(또는 입력한 실제 원화 결제액)을 써요. 개인 지출·불균등 분담도 반영돼요.</p>
        </div>
      )}

      {c.editable && <button className="fab" onClick={() => setEdit('new')} data-testid="add-expense"><Icon name="plus" /> 지출 추가</button>}
      {edit && <ExpenseSheet expense={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} />}
      {fx && <FxSheet onClose={() => setFx(false)} />}
      {bulk && <ExpenseImportSheet onClose={() => setBulk(false)} />}
    </div>
  );
}

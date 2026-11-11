import { useMemo, useState } from 'react';
import { useTripCtx } from '../pages/TripLayout';
import type { Expense, ExpenseCategory } from '../lib/types';
import { EXPENSE_CATEGORY_LABEL } from '../lib/types';
import { expenseKrw, formatKrw, formatMoney, settle } from '../lib/settle';
import { shortDateDow } from '../lib/time';
import { EXPENSE_ICON } from '../sheets/ExpenseSheet';
import { TITLE_TODO, merchantHint } from '../lib/importExpenses';

/**
 * 가계부 분석: 사람별(결제한 돈 / 정산 기준 부담) + 분류별 원 그래프.
 * 분류 색은 분류마다 고정(순위가 바뀌어도 색은 그대로), 검증한 7색 순서.
 * 색만으로 구분하지 않도록 범례에 이름·금액·비율을 항상 같이 적는다.
 */
const CAT_ORDER: ExpenseCategory[] = ['stay', 'food', 'cafe', 'transport', 'ticket', 'shop', 'etc'];
const CAT_COLOR: Record<ExpenseCategory, string> = {
  stay: '#2a78d6',
  food: '#eb6834',
  cafe: '#1baf7a',
  transport: '#eda100',
  ticket: '#e87ba4',
  shop: '#008300',
  etc: '#6250d6',
};

const titleOf = (e: Expense) => (e.title === TITLE_TODO ? `✏️ ${merchantHint(e.memo) || '내용 입력 필요'}` : e.title);
const newestFirst = (a: Expense, b: Expense) => `${b.date ?? ''}${b.time ?? ''}`.localeCompare(`${a.date ?? ''}${a.time ?? ''}`);

function MiniList({ list, onOpen, note }: { list: Expense[]; onOpen: (e: Expense) => void; note?: (e: Expense) => string }) {
  if (!list.length) return <div className="small muted" style={{ padding: '8px 4px' }}>지출이 없어요</div>;
  return (
    <div className="mini-list">
      {[...list].sort(newestFirst).map((e) => (
        <button key={e.id} className="mini-row" onClick={() => onOpen(e)} data-testid="stat-row">
          <span className="ic">{EXPENSE_ICON[e.category]}</span>
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="t ellipsis">{titleOf(e)}</span>
            <span className="s">{e.date ? shortDateDow(e.date) : '여행 전'}{e.time ? ` ${e.time}` : ''}{note ? ` · ${note(e)}` : ''}</span>
          </span>
          <span className="a num">
            {e.currency === 'KRW' ? formatKrw(e.amount) : formatMoney(e.amount, e.currency)}
            {e.currency !== 'KRW' && <span className="s">≈ {formatKrw(expenseKrw(e))}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** 도넛 그래프 (조각 사이 2px 틈, 누르면 그 분류 선택) */
function Donut({ data, total, sel, onSel }: { data: { k: ExpenseCategory; v: number }[]; total: number; sel: ExpenseCategory | null; onSel: (k: ExpenseCategory | null) => void }) {
  const R = 86;
  const r = 54;
  const C = 100;
  let a0 = -Math.PI / 2;
  const arcs = data.map(({ k, v }) => {
    const ang = total ? (v / total) * Math.PI * 2 : 0;
    const a1 = a0 + ang;
    const big = ang > Math.PI ? 1 : 0;
    const p = (rad: number, a: number) => `${C + rad * Math.cos(a)} ${C + rad * Math.sin(a)}`;
    // 한 분류뿐이면 원 전체
    const d =
      data.length === 1
        ? `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - 0.01} ${C - R} L ${C - 0.01} ${C - r} A ${r} ${r} 0 1 0 ${C} ${C - r} Z`
        : `M ${p(R, a0)} A ${R} ${R} 0 ${big} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${big} 0 ${p(r, a0)} Z`;
    const mid = (a0 + a1) / 2;
    a0 = a1;
    return { k, v, d, mid };
  });
  const cur = sel ? data.find((x) => x.k === sel) : null;
  return (
    <svg viewBox="0 0 200 200" className="donut" role="img" aria-label="분류별 지출 원 그래프" data-testid="donut">
      {arcs.map(({ k, d, mid }) => (
        <path
          key={k}
          d={d}
          fill={CAT_COLOR[k]}
          stroke="var(--surface)"
          strokeWidth={2}
          strokeLinejoin="round"
          opacity={sel && sel !== k ? 0.28 : 1}
          transform={sel === k ? `translate(${Math.cos(mid) * 5} ${Math.sin(mid) * 5})` : undefined}
          style={{ cursor: 'pointer', transition: 'opacity .2s, transform .25s cubic-bezier(.22,1,.36,1)' }}
          onClick={() => onSel(sel === k ? null : k)}
        >
          <title>{`${EXPENSE_CATEGORY_LABEL[k]} ${formatKrw(data.find((x) => x.k === k)!.v)}`}</title>
        </path>
      ))}
      <text x={C} y={C - 8} textAnchor="middle" className="donut-l">{cur ? EXPENSE_CATEGORY_LABEL[cur.k] : '전체'}</text>
      <text x={C} y={C + 14} textAnchor="middle" className="donut-v">{formatKrw(cur ? cur.v : total)}</text>
      {cur && <text x={C} y={C + 32} textAnchor="middle" className="donut-l">{Math.round((cur.v / total) * 1000) / 10}%</text>}
    </svg>
  );
}

export default function LedgerStats({ onOpen }: { onOpen: (e: Expense) => void }) {
  const c = useTripCtx();
  const me = c.user.uid;
  const members = c.activeMembers;
  const name = (uid: string) => (uid === me ? '나' : c.nameOf(uid));
  const [day, setDay] = useState<string>('all');
  const [basis, setBasis] = useState<'paid' | 'share'>('paid');
  const [person, setPerson] = useState<string | null>(null);
  const [cat, setCat] = useState<ExpenseCategory | null>(null);

  const scoped = useMemo(
    () => c.bundle.expenses.filter((e) => (day === 'all' ? true : day === 'none' ? !e.date : e.date === day)),
    [c.bundle.expenses, day],
  );
  const s = settle(scoped, members.map((m) => m.uid));
  const people = members.map((m) => {
    const p = s.people.find((x) => x.uid === m.uid);
    const mine = scoped.filter((e) => (basis === 'paid' ? (e.payers[m.uid] ?? 0) > 0 : (e.split.shares[m.uid] ?? 0) > 0 || (e.split.mode === 'equal' && Object.keys(e.split.shares).length === 0)));
    return { uid: m.uid, paid: p?.paid ?? 0, share: p?.share ?? 0, list: mine };
  });
  const maxP = Math.max(1, ...people.map((p) => (basis === 'paid' ? p.paid : p.share)));

  const catData = CAT_ORDER.map((k) => ({ k, v: scoped.filter((e) => e.category === k).reduce((t, e) => t + expenseKrw(e), 0), n: scoped.filter((e) => e.category === k).length })).filter((x) => x.v > 0);
  const catTotal = catData.reduce((t, x) => t + x.v, 0);
  const days = c.bundle.days;

  return (
    <div data-testid="stats">
      <div className="chips" style={{ marginBottom: 14 }}>
        <button className={`chip ${day === 'all' ? 'on' : ''}`} onClick={() => setDay('all')}>전체 기간</button>
        {days.map((d) => (
          <button key={d.date} className={`chip ${day === d.date ? 'on' : ''}`} onClick={() => setDay(d.date)}>DAY {d.index + 1}</button>
        ))}
        {c.bundle.expenses.some((e) => !e.date) && <button className={`chip ${day === 'none' ? 'on' : ''}`} onClick={() => setDay('none')}>여행 전</button>}
      </div>

      {/* ── 사람별 ── */}
      <section className="card pad" style={{ marginBottom: 14 }}>
        <div className="row between" style={{ marginBottom: 10 }}>
          <b style={{ fontSize: 17 }}>사람별</b>
          <div className="seg" style={{ padding: 3, gridAutoColumns: 'auto' }}>
            <button className={basis === 'paid' ? 'on' : ''} style={{ minHeight: 32, padding: '0 10px', fontSize: 13 }} onClick={() => setBasis('paid')} data-testid="basis-paid">결제한 돈</button>
            <button className={basis === 'share' ? 'on' : ''} style={{ minHeight: 32, padding: '0 10px', fontSize: 13 }} onClick={() => setBasis('share')} data-testid="basis-share">부담할 돈</button>
          </div>
        </div>
        <p className="hint" style={{ margin: '-4px 0 10px' }}>{basis === 'paid' ? '각자 카드·현금으로 실제 낸 돈' : '정산 방식(반반·비율 등)대로 나눈 각자 몫'}</p>
        {people.map((p) => {
          const v = basis === 'paid' ? p.paid : p.share;
          const open = person === p.uid;
          return (
            <div key={p.uid} className="person-block">
              <button className="person-row" onClick={() => setPerson(open ? null : p.uid)} aria-expanded={open} data-testid={`person-${p.uid === me ? 'me' : 'other'}`}>
                <span className="avatar">{name(p.uid).slice(0, 1)}</span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="row between">
                    <b>{name(p.uid)}</b>
                    <b className="num">{formatKrw(v)}</b>
                  </span>
                  <span className="meter" style={{ marginTop: 6 }}><i style={{ width: `${(v / maxP) * 100}%`, background: p.uid === me ? 'var(--primary)' : 'var(--partner)' }} /></span>
                  <span className="small muted">{p.list.length}건 · {s.total ? Math.round((v / s.total) * 100) : 0}% · {open ? '접기' : '목록 보기'}</span>
                </span>
              </button>
              {open && (
                <MiniList
                  list={p.list}
                  onOpen={onOpen}
                  note={(e) => (basis === 'paid' ? (Object.keys(e.payers).length > 1 ? '나눠 결제' : '') : e.split.mode === 'equal' && Object.keys(e.split.shares).length > 1 ? '반반' : '')}
                />
              )}
            </div>
          );
        })}
      </section>

      {/* ── 분류별 ── */}
      <section className="card pad">
        <b style={{ fontSize: 17 }}>분류별</b>
        {catTotal === 0 ? (
          <div className="small muted" style={{ padding: '14px 0' }}>지출이 없어요</div>
        ) : (
          <>
            <div className="donut-wrap">
              <Donut data={catData} total={catTotal} sel={cat} onSel={setCat} />
            </div>
            <div className="legend" role="list">
              {catData
                .slice()
                .sort((a, b) => b.v - a.v)
                .map(({ k, v, n }) => (
                  <button key={k} role="listitem" className={`legend-row ${cat === k ? 'on' : ''}`} onClick={() => setCat(cat === k ? null : k)} data-testid={`cat-${k}`}>
                    <span className="sw" style={{ background: CAT_COLOR[k] }} />
                    <span className="grow">{EXPENSE_ICON[k]} {EXPENSE_CATEGORY_LABEL[k]} <span className="faint small">{n}건</span></span>
                    <span className="num">{formatKrw(v)}</span>
                    <span className="pct num">{Math.round((v / catTotal) * 1000) / 10}%</span>
                  </button>
                ))}
            </div>
            {cat && (
              <div style={{ marginTop: 10 }}>
                <div className="small muted" style={{ margin: '0 2px 6px' }}>{EXPENSE_ICON[cat]} {EXPENSE_CATEGORY_LABEL[cat]} 지출</div>
                <MiniList list={scoped.filter((e) => e.category === cat)} onOpen={onOpen} note={(e) => Object.keys(e.payers).map(name).join('·') + ' 결제'} />
              </div>
            )}
          </>
        )}
      </section>
      <p className="hint" style={{ margin: '10px 2px 0' }}>금액은 원화 환산(실제 원화 결제액이 있으면 그 금액) 기준이에요. 정산 완료 표시한 지출도 포함해요.</p>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useTripCtx } from '../pages/TripLayout';
import { importPlanItems, replaceTargets } from '../data/repo';
import { buildImportPlan, gptPrompt, parseJsonLoose, type ImportPlan } from '../lib/importPlan';
import { CATEGORY_LABEL, MODE_EMOJI } from '../lib/types';
import { shortDateDow } from '../lib/time';
import { describeError } from '../lib/saveStatus';
import { Icon, Sheet, copyText, dayColor, toast } from '../components/ui';

/** GPT 등으로 만든 일정 JSON 붙여넣기/파일 → 미리보기 → 일정에 추가 */
export default function ImportSheet({ onClose }: { onClose: () => void }) {
  const c = useTripCtx();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  const [sure, setSure] = useState(false);

  const parsed = useMemo((): { plan: ImportPlan | null; error: string | null } => {
    if (!text.trim()) return { plan: null, error: null };
    try {
      return { plan: buildImportPlan(parseJsonLoose(text), c.bundle.days, c.bundle.trip.baseCurrency), error: null };
    } catch (e) {
      return { plan: null, error: (e as Error).message };
    }
  }, [text, c.bundle.days, c.bundle.trip.baseCurrency]);
  const plan = parsed.plan;
  const gone = plan && replace ? replaceTargets(plan, c.byDay) : [];
  const goneByDay = plan ? plan.days.map((d) => ({ d, n: replace ? (c.byDay.get(d.dayId) ?? []).filter((i) => i.kind !== 'flight').length : 0 })).filter((x) => x.n > 0) : [];

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return setErr('파일이 너무 커요 (2MB 이하)');
    setErr(null);
    setText(await f.text());
  };
  const run = async () => {
    if (!plan || plan.total === 0) return;
    if (replace && gone.length && !sure) return setSure(true); // 한 번 더 눌러야 실행
    setBusy(true);
    setErr(null);
    try {
      const n = await importPlanItems(c.tripId, c.user.uid, plan, c.byDay, c.bundle.days, { replace, legs: c.legs });
      toast(replace ? `일정을 새로 바꿨어요 (${n}개)` : `일정 ${n}개를 추가했어요`);
      onClose();
    } catch (e) {
      setErr(describeError(e));
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onClose} label="JSON 일정 가져오기" wide>
      <h3>JSON 일정 가져오기</h3>
      <p className="small muted" style={{ marginTop: -8 }}>GPT 로 짠 일정을 붙여 넣으면 날짜별로 들어가요. 같은 여행이라 다시 초대할 필요 없이 함께하는 사람 화면에도 바로 바뀌어요.</p>

      <div className="seg" style={{ marginBottom: 12 }} role="radiogroup" aria-label="가져오는 방식">
        <button className={!replace ? 'on' : ''} onClick={() => { setReplace(false); setSure(false); }} data-testid="import-mode-add">기존 일정 뒤에 추가</button>
        <button className={replace ? 'on' : ''} onClick={() => { setReplace(true); setSure(false); }} data-testid="import-mode-replace">지우고 새로 넣기</button>
      </div>
      {replace && (
        <p className="hint" style={{ margin: '-4px 2px 12px' }}>
          JSON 에 들어 있는 날짜의 기존 일정(이동 정보 포함)만 지우고 새 일정으로 바꿔요. 다른 날짜·후보 장소·예약함·가계부·준비물은 그대로이고, 항공편 카드는 남겨요.
        </p>
      )}

      <button className="btn ghost sm" style={{ marginBottom: 10 }} onClick={() => copyText(gptPrompt(c.bundle.trip.name, c.bundle.days), 'GPT 요청 문구')} data-testid="copy-gpt-prompt">
        <Icon name="copy" size={16} /> GPT 에게 보낼 요청 문구 복사
      </button>

      <div className="field">
        <label className="label" htmlFor="import-text">JSON 붙여넣기</label>
        <textarea className="textarea" id="import-text" style={{ minHeight: 140, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 16 }} value={text}
          onChange={(e) => { setText(e.target.value); setSure(false); }} placeholder={'{ "days": [ { "date": "2026-11-08", "items": [ ... ] } ] }'} spellCheck={false} autoCapitalize="off" autoCorrect="off" />
      </div>
      <label className="btn block" style={{ marginBottom: 12 }}>
        <Icon name="file" size={18} /> JSON 파일 선택
        <input type="file" accept=".json,.txt,application/json,text/plain" hidden onChange={(e) => onFile(e.target.files?.[0])} data-testid="import-file" />
      </label>

      {parsed.error && <p className="err" data-testid="import-error">{parsed.error}</p>}
      {err && <p className="err">{err}</p>}

      {plan && (
        <div data-testid="import-preview">
          <div className="row between" style={{ margin: '4px 2px 8px' }}>
            <b>미리보기</b>
            <span className="small muted">총 {plan.total}개</span>
          </div>
          {plan.warnings.map((w) => <p key={w} className="hint" style={{ margin: '0 2px 6px' }}>⚠️ {w}</p>)}
          <div className="col" style={{ gap: 10 }}>
            {plan.days.map((d) => {
              const idx = d.dayId ? c.dayIndex(d.dayId) : -1;
              const col = idx >= 0 ? dayColor(idx) : null;
              return (
                <div key={d.dayId ?? 'cand'} className="card pad" style={{ padding: 12 }}>
                  <div className="row" style={{ marginBottom: 6, gap: 8 }}>
                    <span className="day-pill" style={col ? { background: col.soft, color: col.ink } : { background: 'var(--surface-2)', color: 'var(--ink-2)' }}>{idx >= 0 ? `DAY ${idx + 1}` : '후보'}</span>
                    <span className="small" style={{ fontWeight: 700 }}>{d.dayId ? shortDateDow(d.dayId) : '날짜 없음'}{d.city ? ` · ${d.city}` : ''}</span>
                    <span className="small muted" style={{ marginLeft: 'auto' }}>{d.items.length}개</span>
                  </div>
                  <ol style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.55 }}>
                    {d.items.map((it, i) => (
                      <li key={i} style={{ overflowWrap: 'anywhere' }}>
                        {it.time && <b style={{ color: 'var(--primary)' }}>{it.time} </b>}
                        {it.kind === 'memo' ? <span className="muted">📝 {it.memo.split('\n')[0].slice(0, 40)}</span> : <>{it.place!.nameKo}{it.category && <span className="faint small"> · {CATEGORY_LABEL[it.category]}</span>}</>}
                        {it.checklist.length > 0 && <span className="faint small"> · 체크 {it.checklist.length}</span>}
                        {it.legToNext && <span className="faint small"> · 다음 {MODE_EMOJI[it.legToNext.mode]}{it.legToNext.durationMin != null ? ` ${it.legToNext.durationMin}분` : ''}</span>}
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {replace && plan && (
        <div className="card pad" style={{ marginTop: 12, borderColor: '#f3c3c3', background: '#fff6f5' }} data-testid="replace-warning">
          {goneByDay.length ? (
            <>
              <b style={{ color: 'var(--danger, #d64545)' }}>지워질 기존 일정 {gone.length}개</b>
              <div className="small" style={{ marginTop: 4 }}>
                {goneByDay.map(({ d, n }) => `${d.dayId ? `DAY ${c.dayIndex(d.dayId) + 1}` : '후보 장소'} ${n}개`).join(' · ')}
              </div>
            </>
          ) : (
            <span className="small">지워질 기존 일정이 없어요. 그냥 새로 넣어요.</span>
          )}
        </div>
      )}

      <div className="actions" style={{ marginTop: 14 }}>
        <button className="btn" onClick={onClose}>취소</button>
        <button className={`btn ${replace && gone.length ? 'danger' : 'primary'}`} disabled={!plan || plan.total === 0 || busy || !c.editable} onClick={run} data-testid="import-run">
          {busy ? (replace ? '바꾸는 중…' : '추가하는 중…') : !plan ? '추가' : replace && gone.length ? (sure ? '정말 바꿀까요? 한 번 더' : `${gone.length}개 지우고 ${plan.total}개로 바꾸기`) : `${plan.total}개 추가`}
        </button>
      </div>
    </Sheet>
  );
}

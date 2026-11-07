import { useState } from 'react';
import type { CheckEntry } from '../lib/types';

const newId = () => Math.random().toString(36).slice(2, 10);

export const CHECK_PRESETS: { text: string; important: boolean }[] = [
  { text: '바우처 종이로 출력해서 지참', important: true },
  { text: '여권 지참', important: true },
  { text: '출발 시각: ', important: false },
  { text: '표 받는 곳: ', important: false },
  { text: '예약 번호: ', important: false },
  { text: '현금 준비', important: false },
];

/** 일정 편집 시트 안의 체크 항목 편집기 */
export function ChecklistEditor({ value, onChange }: { value: CheckEntry[]; onChange: (v: CheckEntry[]) => void }) {
  const [text, setText] = useState('');
  const [important, setImportant] = useState(false);
  const add = () => {
    const t = text.trim();
    if (!t) return;
    onChange([...value, { id: newId(), text: t.slice(0, 200), important, done: false }]);
    setText('');
    setImportant(false);
  };
  const patch = (id: string, p: Partial<CheckEntry>) => onChange(value.map((c) => (c.id === id ? { ...c, ...p } : c)));
  return (
    <div className="field">
      <span className="label">준비·주의 체크 (바우처 지참, 표 받는 곳 등)</span>
      {value.length > 0 && (
        <div className="card list" style={{ boxShadow: 'none' }}>
          {value.map((c, i) => (
            <div className="row" key={c.id} style={{ padding: '8px 10px', gap: 6 }}>
              <input type="checkbox" checked={c.done} onChange={() => patch(c.id, { done: !c.done })} aria-label="완료" id={`ck-done-${c.id}`} style={{ width: 20, height: 20, accentColor: 'var(--primary)' }} />
              <input className="input grow" style={{ minHeight: 38, padding: '6px 10px' }} value={c.text} maxLength={200} onChange={(e) => patch(c.id, { text: e.target.value })} id={`ck-text-${c.id}`} aria-label="내용" />
              <button type="button" className={`tag ${c.important ? 'danger' : 'grey'}`} style={{ border: 0 }} onClick={() => patch(c.id, { important: !c.important })} aria-pressed={c.important}>필수</button>
              <button type="button" className="icon-btn sm" aria-label="위로" disabled={i === 0}
                onClick={() => { const n = [...value]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); }}>↑</button>
              <button type="button" className="icon-btn sm" aria-label="삭제" style={{ color: 'var(--danger)' }} onClick={() => onChange(value.filter((x) => x.id !== c.id))}>✕</button>
            </div>
          ))}
        </div>
      )}
      <div className="row">
        <input className="input grow" id="ck-new" value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder="예: 3번 출구 옆 매표소에서 표 수령"
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
        <label className="row tiny" style={{ gap: 4, whiteSpace: 'nowrap' }}>
          <input type="checkbox" id="ck-new-important" checked={important} onChange={(e) => setImportant(e.target.checked)} style={{ accentColor: 'var(--primary)' }} /> 필수
        </label>
        <button type="button" className="btn sm soft" onClick={add}>추가</button>
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        {CHECK_PRESETS.map((p) => (
          <button type="button" key={p.text} className="tag grey" style={{ border: 0, padding: '6px 10px' }} onClick={() => { setText(p.text); setImportant(p.important); }}>
            + {p.text.replace(/: $/, '')}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 카드·상세용 체크 목록. onToggle 이 없으면 읽기 전용 */
export function ChecklistView({ list, onToggle }: { list: CheckEntry[]; onToggle?: (id: string) => void }) {
  if (!list.length) return null;
  return (
    <ul className="checks">
      {list.map((c) => (
        <li key={c.id} className={c.done ? 'done' : ''}>
          <button type="button" className="ck" disabled={!onToggle} aria-pressed={c.done} aria-label={c.done ? `${c.text} 완료 취소` : `${c.text} 완료`}
            onClick={(e) => { e.stopPropagation(); onToggle?.(c.id); }}>
            {c.done ? '✓' : ''}
          </button>
          <span className="ck-text">
            {c.important && <span className="tag danger" style={{ marginRight: 4, padding: '0 7px' }}>필수</span>}
            {c.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

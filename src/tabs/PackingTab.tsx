import { useEffect, useMemo, useState } from 'react';
import { DndContext, closestCenter, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTripCtx } from '../pages/TripLayout';
import { addPacking, copyPacking, deletePacking, movePacking, togglePacking, updatePacking } from '../data/repo';
import { useMyTrips } from '../data/hooks';
import type { PackingItem } from '../lib/types';
import { sortItems } from '../lib/order';
import { describeError } from '../lib/saveStatus';
import { ConfirmButton, Icon, Sheet, toast } from '../components/ui';

const OWNER_STYLE = (owner: string, me: string) =>
  owner === 'shared' ? { background: '#e6eefe', color: '#3d6fd6' } : owner === me ? { background: 'var(--primary-soft)', color: 'var(--primary)' } : { background: '#fde8f0', color: '#c23f78' };

function Row({ p, onEdit, onToggle }: { p: PackingItem; onEdit: () => void; onToggle: () => void }) {
  const c = useTripCtx();
  const s = useSortable({ id: p.id, disabled: !c.editable });
  const ownerName = p.owner === 'shared' ? '공동' : p.owner === c.user.uid ? '나' : c.nameOf(p.owner);
  return (
    <div ref={s.setNodeRef} style={{ transform: CSS.Transform.toString(s.transform), transition: s.transition }} className={`pk-row ${p.done ? 'done' : ''} ${s.isDragging ? 'dragging' : ''}`} data-testid="packing">
      {c.editable && <span className="drag-h" {...s.attributes} {...s.listeners} aria-label="끌어서 순서 변경"><Icon name="grip" size={18} /></span>}
      <button className="text" style={{ border: 0, background: 'none', textAlign: 'left', padding: 0 }} onClick={onEdit}>{p.text}</button>
      <span className="owner" style={OWNER_STYLE(p.owner, c.user.uid)}>{ownerName}</span>
      <button className={`switch ${p.done ? 'on' : ''}`} role="switch" aria-checked={p.done} aria-label={`${p.text} 준비 완료`} disabled={!c.editable} onClick={onToggle} data-testid="packing-toggle" />
    </div>
  );
}

export default function PackingTab() {
  const c = useTripCtx();
  const me = c.user.uid;
  const [filter, setFilter] = useState<string>('all');
  const [hideDone, setHideDone] = useState(false);
  const [text, setText] = useState('');
  const [owner, setOwner] = useState<string>('shared');
  const [edit, setEdit] = useState<PackingItem | null>(null);
  const [copying, setCopying] = useState(false);
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const sorted = useMemo(() => sortItems(c.bundle.packing), [c.bundle.packing]);
  useEffect(() => {
    setOptimistic({});
  }, [c.bundle.packing]);
  const isDone = (p: PackingItem) => optimistic[p.id] ?? p.done;
  const done = sorted.filter(isDone).length;
  const list = sorted
    .map((p) => ({ ...p, done: isDone(p) }))
    .filter((p) => (filter === 'all' ? true : p.owner === filter))
    .filter((p) => !(hideDone && p.done));
  const sensors = useSensors(
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const to = sorted.findIndex((p) => p.id === e.over!.id);
    void movePacking(c.tripId, me, sorted, String(e.active.id), to).catch(() => undefined);
  };
  const add = async () => {
    if (!text.trim()) return;
    await addPacking(c.tripId, me, text, owner, sorted).catch(() => undefined);
    setText('');
  };
  const toggle = (p: PackingItem) => {
    setOptimistic((s) => ({ ...s, [p.id]: !isDone(p) }));
    togglePacking(c.tripId, me, p.id).catch(() => setOptimistic((s) => ({ ...s, [p.id]: p.done })));
  };
  const filters = [{ id: 'all', label: `전체 ${sorted.length}` }, ...c.activeMembers.map((m) => ({ id: m.uid, label: m.uid === me ? '나' : m.displayName })), { id: 'shared', label: '공동' }];

  return (
    <div className="t-body">
      <h2 style={{ fontSize: 28, margin: '10px 0 14px', letterSpacing: '-0.03em' }}>준비물 체크리스트</h2>
      <div className="card soft pad" data-testid="progress">
        <div className="row between">
          <b style={{ color: 'var(--primary)', display: 'inline-flex', gap: 6, alignItems: 'center' }}><Icon name="bag" /> 준비 현황</b>
          <span><b style={{ fontSize: 30, color: 'var(--primary)' }} className="num">{done}</b> <span className="muted">/ {sorted.length}개</span></span>
        </div>
        <div className="progress" style={{ margin: '12px 0 8px' }}><i style={{ width: `${sorted.length ? (done / sorted.length) * 100 : 0}%` }} /></div>
        <div className="small muted">친구와 체크 상태를 함께 확인해요</div>
      </div>

      <div className="seg" style={{ margin: '16px 0 12px', gridAutoColumns: 'minmax(0,1fr)' }}>
        {filters.map((f) => <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>{f.label}</button>)}
      </div>

      {c.editable && (
        <div className="card pad" style={{ marginBottom: 12 }}>
          <div className="row">
            <input className="input grow" id="pk-text" maxLength={100} value={text} onChange={(e) => setText(e.target.value)} placeholder="준비물 추가 (예: 보조배터리)" onKeyDown={(e) => e.key === 'Enter' && add()} />
            <button className="btn primary" onClick={add} data-testid="pk-add">추가</button>
          </div>
          <div className="row wrap" style={{ marginTop: 8 }}>
            <span className="small muted">담당</span>
            {[...c.activeMembers.map((m) => ({ id: m.uid, label: m.uid === me ? '나' : m.displayName })), { id: 'shared', label: '공동' }].map((o) => (
              <button key={o.id} className={`chip ${owner === o.id ? 'on' : ''}`} style={{ minHeight: 32, padding: '4px 12px' }} onClick={() => setOwner(o.id)}>{o.label}</button>
            ))}
          </div>
        </div>
      )}

      <div className="row between" style={{ margin: '0 2px 8px' }}>
        <label className="row small"><input type="checkbox" id="pk-hide" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--primary)' }} /> 완료 항목 숨기기</label>
        {c.editable && <button className="btn ghost sm" onClick={() => setCopying(true)}><Icon name="copy" size={16} /> 다른 여행에서 복사</button>}
      </div>

      {list.length === 0 ? (
        <div className="empty-day">{sorted.length === 0 ? '준비물을 추가해 보세요' : '표시할 항목이 없어요'}</div>
      ) : (
        <div className="card list" style={{ overflow: 'hidden' }}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={list.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              {list.map((p) => <Row key={p.id} p={p} onEdit={() => c.editable && setEdit(p)} onToggle={() => toggle(p)} />)}
            </SortableContext>
          </DndContext>
        </div>
      )}
      <p className="hint">왼쪽 손잡이를 끌어 순서를 바꿔요. 여행이 끝나도 목록은 그대로 남아요.</p>

      {edit && <EditSheet p={edit} onClose={() => setEdit(null)} />}
      {copying && <CopySheet onClose={() => setCopying(false)} />}
    </div>
  );
}

function EditSheet({ p, onClose }: { p: PackingItem; onClose: () => void }) {
  const c = useTripCtx();
  const [text, setText] = useState(p.text);
  const [owner, setOwner] = useState(p.owner);
  const [err, setErr] = useState<string | null>(null);
  const opts = [...c.activeMembers.map((m) => ({ id: m.uid, label: m.uid === c.user.uid ? '나' : m.displayName })), { id: 'shared', label: '공동' }];
  return (
    <Sheet onClose={onClose} label="준비물 수정">
      <h3>준비물 수정</h3>
      <input className="input" id="pk-edit" maxLength={100} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row wrap" style={{ margin: '10px 0' }}>
        {opts.map((o) => <button key={o.id} className={`chip ${owner === o.id ? 'on' : ''}`} onClick={() => setOwner(o.id)}>{o.label}</button>)}
      </div>
      {err && <p className="err">{err}</p>}
      <div className="actions">
        <button className="btn" onClick={onClose}>취소</button>
        <button className="btn primary" disabled={!text.trim()} onClick={() => updatePacking(c.tripId, c.user.uid, p, { text: text.trim(), owner }).then(onClose, (e) => setErr(describeError(e)))}>저장</button>
      </div>
      <div style={{ marginTop: 10 }}>
        <ConfirmButton label="삭제" confirmLabel="정말 삭제" onConfirm={() => deletePacking(c.tripId, p.id).then(onClose, (e) => setErr(describeError(e)))} />
      </div>
    </Sheet>
  );
}

function CopySheet({ onClose }: { onClose: () => void }) {
  const c = useTripCtx();
  const { rows } = useMyTrips(c.user.uid);
  const others = (rows ?? []).filter((r) => r.trip.id !== c.tripId);
  return (
    <Sheet onClose={onClose} label="준비물 복사">
      <h3>어느 여행의 준비물을 가져올까요?</h3>
      {rows === null && <p className="muted">불러오는 중…</p>}
      {rows && others.length === 0 && <p className="muted">다른 여행이 없어요.</p>}
      <div className="col">
        {others.map((r) => (
          <button key={r.trip.id} className="btn block" onClick={() => copyPacking(r.trip.id, c.tripId, c.user.uid, c.activeMembers.map((m) => m.uid), c.bundle.packing).then((n) => { toast(`${n}개 가져왔어요 (같은 이름은 건너뜀)`); onClose(); }, () => undefined)}>
            {r.trip.name}
          </button>
        ))}
      </div>
      <p className="hint">완료 표시는 지우고 가져와요.</p>
    </Sheet>
  );
}

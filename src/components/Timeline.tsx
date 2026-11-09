import { useEffect, useMemo, useState } from 'react';
import { DndContext, DragOverlay, closestCenter, defaultDropAnimationSideEffects, MouseSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent, type DropAnimation, type Modifier } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Day, Item } from '../lib/types';
import { CATEGORY_LABEL } from '../lib/types';
import { hasCoords, numberPlaces } from '../lib/order';
import { flightMinutes, formatMinutes, mdSlash, tzLabel } from '../lib/time';
import { legSummary } from '../lib/legs';
import { useTripCtx } from '../pages/TripLayout';
import { ChecklistView } from './Checklist';
import { Icon, dayColor } from './ui';

/** 드래그를 막 끝낸 직후의 '탭'은 무시 (손을 떼면 click 이 같이 발생함) */
let lastDragAt = 0;
const justDragged = () => Date.now() - lastDragAt < 400;

export interface TimelineHandlers {
  onOpenItem: (it: Item) => void;
  onOpenLeg: (a: Item, b: Item) => void;
  onOpenBooking: (bookingId: string) => void;
  onMove: (dayId: string, itemId: string, toIndex: number) => Promise<unknown>;
  onToggleCheck: (itemId: string, entryId: string) => void;
}

function ItemCard({ item, num, color, selected, prevPlace, h, now }: { item: Item; num?: number; color: string; selected: boolean; prevPlace: Item | null; h: TimelineHandlers; now?: 'now' | 'next' }) {
  const c = useTripCtx();
  const sortable = useSortable({ id: item.id, disabled: !c.editable, transition: SORT_TRANSITION });
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };
  const [open, setOpen] = useState(false);
  const leg = prevPlace ? c.legs.get(`${prevPlace.id}__${item.id}`) : null;
  const sum = prevPlace ? legSummary(leg, prevPlace, item) : null;
  const booking = item.kind === 'flight' ? c.bookings.get(item.bookingIds[0]) : undefined;
  const f = booking?.flight;
  const long = item.memo.length > 80 || item.memo.split('\n').length > 3;

  return (
    <div ref={sortable.setNodeRef} style={style} className={sortable.isDragging ? 'dragging' : ''} data-testid="tl-item" data-item-id={item.id}>
      {sum && prevPlace && (
        <div className="tl-gap">
          <div className="rail" />
          <button className={`leg ${sum.empty ? 'empty' : ''}`} onClick={() => h.onOpenLeg(prevPlace, item)} data-testid="leg">
            <span className="grow">{sum.text}</span>
            {sum.badge && <span className="src">{sum.badge}</span>}
            <Icon name="next" size={18} />
          </button>
        </div>
      )}
      <div className="tl-row">
        <div className="tl-rail">
          {item.kind !== 'memo' && <span className="tl-time" style={{ color: item.time ? color : 'var(--ink-3)' }}>{item.time ?? '--:--'}</span>}
          {item.kind === 'place' && <span className="tl-num" style={{ background: color }} data-testid="num">{num}</span>}
          {item.kind === 'memo' && <span className="tl-num memo" style={{ background: color }} />}
          {item.kind === 'flight' && <span className="tl-num" style={{ background: color }}><Icon name="plane" size={18} /></span>}
        </div>
        <div
          {...sortable.attributes} {...sortable.listeners}
          role="button" tabIndex={0}
          className={`tl-card ${item.kind} ${selected ? 'sel' : ''} ${now ? 'is-now' : ''}`}
          onClick={() => { if (justDragged()) return; if (item.kind === 'flight' && item.bookingIds[0]) h.onOpenBooking(item.bookingIds[0]); else h.onOpenItem(item); }}
          onKeyDown={(e) => e.key === 'Enter' && h.onOpenItem(item)}
          aria-roledescription="길게 눌러 순서 변경"
        >
          {now && <span className="now-pill" data-testid="now-pill">{now === 'now' ? '지금' : '다음 일정'}</span>}
          {item.kind === 'place' && item.place && (
            <>
              <div className="cat">
                {[item.category ? CATEGORY_LABEL[item.category] : null, item.tag || null].filter(Boolean).join(' · ') || '장소'}
                {!hasCoords(item.place) && <span className="tag warn" style={{ marginLeft: 6, padding: '1px 8px', fontSize: 11.5 }}>위치 미지정</span>}
              </div>
              <div className="name" data-testid="item-name">{item.place.nameKo}</div>
              {item.place.nameLocal && <div className="local">{item.place.nameLocal}</div>}
            </>
          )}
          {item.kind === 'flight' && (
            <>
              <div className="cat">항공 · {f ? [f.airline, f.flightNo].filter(Boolean).join(' ') : '예약 정보 없음'}</div>
              {f ? (
                <>
                  <div className="flight-line">{f.depCode || '출발'} {f.depTime} → {f.arrCode || '도착'} {f.arrTime}{f.arrDate !== f.depDate ? ` (${mdSlash(f.arrDate)})` : ''}</div>
                  <div className="local">{tzLabel(f.depTz)} → {tzLabel(f.arrTz)}{(() => { const m = flightMinutes(f); return m ? ` · 비행 ${formatMinutes(m)}` : ''; })()}{f.depTerminal ? ` · 출발 T${f.depTerminal}` : ''}</div>
                </>
              ) : <div className="name">{booking?.title ?? '삭제된 예약'}</div>}
            </>
          )}
          {item.memo && (
            <div className={`memo-text ${!open && long ? 'clamp' : ''}`} data-testid="item-memo">{item.memo}</div>
          )}
          {long && (
            <button className="btn ghost sm" style={{ padding: 0, minHeight: 0, color: 'var(--ink-3)' }} onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
              {open ? '접기' : '더보기'}
            </button>
          )}
          {item.checklist.length > 0 && <ChecklistView list={item.checklist} onToggle={c.editable ? (id) => h.onToggleCheck(item.id, id) : undefined} />}
          {item.kind !== 'flight' && item.bookingIds.length > 0 && (
            <div className="row wrap" style={{ marginTop: 8 }}>
              {item.bookingIds.map((bid) => {
                const b = c.bookings.get(bid);
                return b ? (
                  <button key={bid} className="tag" style={{ border: 0, padding: '5px 10px' }} onClick={(e) => { e.stopPropagation(); h.onOpenBooking(bid); }} data-testid="item-booking">
                    🎫 {b.title}
                  </button>
                ) : null;
              })}
            </div>
          )}
          {item.kind !== 'flight' && (
            <span className="edit icon-btn sm" aria-hidden="true" style={{ color: 'var(--primary)' }}><Icon name="edit" size={20} /></span>
          )}
        </div>
      </div>
    </div>
  );
}

/** 아이폰 목록 순서 바꾸기 느낌: 빠르게 시작해 부드럽게 멈추는 곡선 */
const IOS_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const SORT_TRANSITION = { duration: 320, easing: IOS_EASE };
const DROP_ANIMATION: DropAnimation = {
  duration: 300,
  easing: IOS_EASE,
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.35' } } }),
};
/** 위아래로만 움직이게 */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/** 끌고 있는 동안 손가락 아래 떠 있는 카드 (항상 맨 위, 살짝 커지고 그림자) */
function LiftedCard({ item, num, color, offset }: { item: Item; num?: number; color: string; offset: number }) {
  return (
    <div className="tl-row lifted-wrap" style={{ paddingTop: offset }}>
      <div className="tl-rail">
        {item.kind !== 'memo' && <span className="tl-time" style={{ color: item.time ? color : 'var(--ink-3)' }}>{item.time ?? '--:--'}</span>}
        {item.kind === 'place' && <span className="tl-num" style={{ background: color }}>{num}</span>}
        {item.kind === 'memo' && <span className="tl-num memo" style={{ background: color }} />}
        {item.kind === 'flight' && <span className="tl-num" style={{ background: color }}><Icon name="plane" size={18} /></span>}
      </div>
      <div className={`tl-card ${item.kind} lifted`} style={{ borderColor: color }}>
        {item.kind === 'place' && item.place ? (
          <>
            <div className="cat">{[item.category ? CATEGORY_LABEL[item.category] : null, item.tag || null].filter(Boolean).join(' · ') || '장소'}</div>
            <div className="name">{item.place.nameKo}</div>
            {item.place.nameLocal && <div className="local">{item.place.nameLocal}</div>}
          </>
        ) : (
          <div className="memo-text clamp" style={{ WebkitLineClamp: 2 }}>{item.kind === 'flight' ? '✈️ 항공편' : item.memo}</div>
        )}
      </div>
    </div>
  );
}

export function DayTimeline({ day, items, selectedId, h, nowMark }: { day: Day; items: Item[]; selectedId: string | null; h: TimelineHandlers; nowMark?: { id: string; state: 'now' | 'next' } | null }) {
  const c = useTripCtx();
  const color = dayColor(day.index).main;
  const [optimistic, setOptimistic] = useState<string[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [liftOffset, setLiftOffset] = useState(0); // 원래 칸 안에서 카드가 시작하는 높이(위 이동 정보 줄) → 떠 있는 카드가 손가락 위치와 맞도록
  useEffect(() => {
    setOptimistic(null);
  }, [items]);
  const shown = useMemo(() => {
    if (!optimistic) return items;
    const by = new Map(items.map((i) => [i.id, i]));
    const list = optimistic.map((id) => by.get(id)).filter(Boolean) as Item[];
    return list.length === items.length ? list : items;
  }, [items, optimistic]);
  const nums = numberPlaces(shown);
  const sensors = useSensors(
    useSensor(TouchSensor, { activationConstraint: { delay: 350, tolerance: 8 } }),
    useSensor(MouseSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = async (e: DragEndEvent) => {
    lastDragAt = Date.now();
    if (!e.over || e.active.id === e.over.id) return;
    const from = shown.findIndex((i) => i.id === e.active.id);
    const to = shown.findIndex((i) => i.id === e.over!.id);
    setOptimistic(arrayMove(shown, from, to).map((i) => i.id));
    try {
      await h.onMove(day.date, String(e.active.id), to);
    } catch {
      setOptimistic(null);
    }
  };

  if (shown.length === 0)
    return <div className="empty-day">아직 일정이 없어요{c.editable ? ' · 아래 ‘+ 일정 추가’로 넣어 보세요' : ''}</div>;

  let prev: Item | null = null;
  const activeItem = activeId ? shown.find((i) => i.id === activeId) ?? null : null;
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[verticalOnly]}
      autoScroll={{ threshold: { x: 0, y: 0.14 }, acceleration: 7 }}
      onDragStart={(e) => {
        lastDragAt = Date.now();
        const el = document.querySelector(`[data-item-id="${String(e.active.id)}"]`);
        const row = el?.querySelector('.tl-row');
        setLiftOffset(el && row ? row.getBoundingClientRect().top - el.getBoundingClientRect().top : 0);
        setActiveId(String(e.active.id));
      }}
      onDragCancel={() => { lastDragAt = Date.now(); setActiveId(null); }}
      onDragEnd={(e) => { setActiveId(null); void onDragEnd(e); }}
    >
      <SortableContext items={shown.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div data-testid={`tl-${day.date}`} className={activeId ? 'tl-sorting' : ''}>
          {shown.map((it) => {
            const p = it.kind === 'place' ? prev : null;
            if (it.kind === 'place') prev = it;
            return <ItemCard key={it.id} item={it} num={nums.get(it.id)} color={color} selected={selectedId === it.id} prevPlace={p} h={h} now={nowMark?.id === it.id ? nowMark.state : undefined} />;
          })}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={DROP_ANIMATION} zIndex={55}>
        {activeItem ? <LiftedCard item={activeItem} num={nums.get(activeItem.id)} color={color} offset={liftOffset} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

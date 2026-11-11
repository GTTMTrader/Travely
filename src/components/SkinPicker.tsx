import { useState } from 'react';
import { SKINS, getSkin, setSkin, type SkinId } from '../lib/skin';

/** 스킨 고르기: 색 동그라미를 누르면 바로 바뀜 (이 기기에만 저장) */
export default function SkinPicker() {
  const [cur, setCur] = useState<SkinId>(getSkin());
  return (
    <div className="skin-pick" role="radiogroup" aria-label="스킨">
      {SKINS.map((s) => (
        <button
          key={s.id}
          role="radio"
          aria-checked={cur === s.id}
          className={cur === s.id ? 'on' : ''}
          onClick={() => {
            setSkin(s.id);
            setCur(s.id);
          }}
          data-testid={`skin-${s.id}`}
        >
          <span className="dot" style={{ background: s.color }}>{cur === s.id ? '✓' : ''}</span>
          <span className="nm">{s.name}</span>
        </button>
      ))}
    </div>
  );
}

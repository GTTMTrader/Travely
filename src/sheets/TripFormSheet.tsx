import { useState, type FormEvent } from 'react';
import type { AppUser } from '../data/auth';
import { createTrip, planDateChange, updateTrip, type TripInput } from '../data/repo';
import { COUNTRIES, countryOf } from '../lib/countries';
import { searchPlace } from '../lib/geo';
import { describeError } from '../lib/saveStatus';
import type { City, Currency, TripBundle } from '../lib/types';
import { CURRENCIES, CURRENCY_LABEL, CURRENCY_SYMBOL } from '../lib/types';
import { TZ_LABEL } from '../lib/time';
import { Art, ILLUSTRATIONS, Sheet } from '../components/ui';

/** 여행 만들기 / 수정. 수정 시 기간이 줄면 사라지는 날짜의 일정은 후보 장소로 옮겨진다고 미리 알려준다. */
export default function TripFormSheet({ user, bundle, onClose, onSaved }: { user: AppUser; bundle?: TripBundle; onClose: () => void; onSaved?: (id: string) => void }) {
  const t = bundle?.trip;
  const [f, setF] = useState<TripInput>(() =>
    t
      ? { name: t.name, countryCode: t.countryCode, cities: t.cities, startDate: t.startDate, endDate: t.endDate, timezone: t.timezone, baseCurrency: t.baseCurrency, illustration: t.illustration }
      : { name: '', countryCode: 'CN', cities: [], startDate: '', endDate: '', timezone: 'Asia/Shanghai', baseCurrency: 'CNY', illustration: 'temple' },
  );
  const [cityText, setCityText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const country = countryOf(f.countryCode);

  const setCountry = (code: string) => {
    const c = countryOf(code);
    setF((s) => ({ ...s, countryCode: code, baseCurrency: c?.currency ?? s.baseCurrency, timezone: c?.tz ?? s.timezone }));
  };
  const addCity = (c: City) => {
    if (f.cities.some((x) => x.name === c.name)) return;
    setF((s) => ({ ...s, cities: [...s.cities, c] }));
  };
  const addTypedCity = async () => {
    const name = cityText.trim();
    if (!name) return;
    const preset = country?.cities.find((c) => c.name === name);
    if (preset) {
      addCity(preset);
      setCityText('');
      return;
    }
    setGeoBusy(true);
    try {
      const [r] = await searchPlace(`${name} ${country?.name ?? ''}`.trim());
      addCity({ name, lat: r?.lat ?? null, lng: r?.lng ?? null });
    } catch {
      addCity({ name, lat: null, lng: null }); // 좌표 없이도 추가 (날씨만 안 나옴)
    } finally {
      setGeoBusy(false);
      setCityText('');
    }
  };

  const shrink = bundle && f.startDate && f.endDate ? planDateChange(bundle.days, bundle.items, f.startDate, f.endDate, '') : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!f.name.trim()) return setErr('여행 이름을 입력해 주세요');
    if (!f.startDate || !f.endDate) return setErr('출발일과 종료일을 입력해 주세요');
    if (f.endDate < f.startDate) return setErr('종료일이 출발일보다 빨라요');
    const days = (Date.parse(f.endDate) - Date.parse(f.startDate)) / 86400000 + 1;
    if (days > 30) return setErr('여행 기간은 30일까지 만들 수 있어요');
    setBusy(true);
    try {
      if (bundle) {
        await updateTrip(bundle.trip.id, user.uid, f, bundle);
        onClose();
      } else {
        const id = await createTrip(user, f);
        onClose();
        onSaved?.(id);
      }
    } catch (e2) {
      setErr(describeError(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onClose} label={bundle ? '여행 수정' : '새 여행'}>
      <h3>{bundle ? '여행 정보 수정' : '새 여행 만들기'}</h3>
      <form onSubmit={submit}>
        <label className="field">
          <span className="label">여행 이름</span>
          <input className="input" id="trip-name" required maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="예: 칭다오 · 옌타이" />
        </label>
        <div className="row">
          <label className="field grow">
            <span className="label">국가</span>
            <select className="select" id="trip-country" value={f.countryCode} onChange={(e) => setCountry(e.target.value)}>
              {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </label>
          <label className="field grow">
            <span className="label">기본 통화</span>
            <select className="select" id="trip-currency" value={f.baseCurrency} onChange={(e) => setF({ ...f, baseCurrency: e.target.value as Currency })}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCY_SYMBOL[c]} {CURRENCY_LABEL[c]}</option>)}
            </select>
          </label>
        </div>
        <div className="field">
          <span className="label">도시</span>
          {f.cities.length > 0 && (
            <div className="row wrap">
              {f.cities.map((c) => (
                <span key={c.name} className="tag">
                  {c.name}{c.lat == null && <span className="faint">(위치 없음)</span>}
                  <button type="button" aria-label={`${c.name} 빼기`} style={{ border: 0, background: 'none', color: 'inherit', padding: 0, marginLeft: 2 }}
                    onClick={() => setF({ ...f, cities: f.cities.filter((x) => x.name !== c.name) })}>✕</button>
                </span>
              ))}
            </div>
          )}
          {country && country.cities.length > 0 && (
            <div className="row wrap">
              {country.cities.filter((c) => !f.cities.some((x) => x.name === c.name)).map((c) => (
                <button type="button" key={c.name} className="chip" style={{ minHeight: 34, padding: '4px 12px' }} onClick={() => addCity(c)}>+ {c.name}</button>
              ))}
            </div>
          )}
          <div className="row">
            <input className="input grow" id="trip-city" value={cityText} onChange={(e) => setCityText(e.target.value)} placeholder="다른 도시 이름"
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTypedCity())} />
            <button type="button" className="btn" onClick={addTypedCity} disabled={geoBusy || !cityText.trim()}>{geoBusy ? '찾는 중' : '추가'}</button>
          </div>
          <span className="hint">도시 위치는 날씨와 지도 시작 위치에 쓰여요.</span>
        </div>
        <div className="row">
          <label className="field grow">
            <span className="label">출발일</span>
            <input className="input" id="trip-start" type="date" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value, endDate: f.endDate && f.endDate >= e.target.value ? f.endDate : e.target.value })} />
          </label>
          <label className="field grow">
            <span className="label">종료일</span>
            <input className="input" id="trip-end" type="date" required min={f.startDate} value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          </label>
        </div>
        {shrink && shrink.itemMoves.length > 0 && (
          <p className="tag warn" style={{ whiteSpace: 'normal', marginTop: -6, marginBottom: 12 }}>
            빠지는 날짜({shrink.removed.join(', ')})의 일정 {shrink.itemMoves.length}개는 ‘후보 장소’로 옮겨져요.
          </p>
        )}
        <label className="field">
          <span className="label">여행지 시간대</span>
          <select className="select" id="trip-tz" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
            {[...new Set([f.timezone, ...Object.keys(TZ_LABEL).filter((x) => x !== 'UTC'), 'America/Los_Angeles', 'Europe/Paris'])].map((tz) => <option key={tz} value={tz}>{TZ_LABEL[tz] ?? tz}</option>)}
          </select>
        </label>
        <div className="field">
          <span className="label">카드 그림</span>
          <div className="row wrap">
            {ILLUSTRATIONS.map((il) => (
              <button type="button" key={il.id} aria-label={il.label} aria-pressed={f.illustration === il.id} onClick={() => setF({ ...f, illustration: il.id })}
                style={{ width: 64, height: 64, padding: 0, borderRadius: 14, overflow: 'hidden', border: f.illustration === il.id ? '3px solid var(--primary)' : '1px solid var(--line)' }}>
                <Art kind={il.id} />
              </button>
            ))}
          </div>
        </div>
        {!bundle && <p className="hint">함께 갈 친구는 여행을 만든 뒤 오른쪽 위 사람 아이콘에서 초대 링크로 부를 수 있어요.</p>}
        {err && <p className="err">{err}</p>}
        <div className="actions">
          <button type="button" className="btn" onClick={onClose}>취소</button>
          <button className="btn primary" disabled={busy} data-testid="save-trip">{busy ? '저장 중…' : bundle ? '저장' : '만들기'}</button>
        </div>
      </form>
    </Sheet>
  );
}

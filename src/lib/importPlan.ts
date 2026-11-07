/**
 * GPT 등으로 만든 여행 일정 JSON → Travely 일정 항목.
 * 형식이 조금씩 달라도(키 이름이 영어/한국어, 날짜 대신 DAY 번호, 날짜별 객체 등) 최대한 그대로 읽는다.
 * 좌표는 JSON 에 숫자로 있을 때만 쓰고 지어내지 않는다.
 */
import type { Category, CheckEntry, Currency, Day, ItemKind, PlaceInfo, TravelMode } from './types';
import { CURRENCIES, emptyPlace } from './types';

export interface ImportLeg {
  mode: TravelMode;
  durationMin: number | null;
  distanceM: number | null;
  fareAmount: number | null;
  fareCurrency: Currency;
  memo: string;
}
export interface ImportItem {
  kind: Exclude<ItemKind, 'flight'>;
  category: Category | null;
  tag: string;
  time: string | null;
  memo: string;
  place: PlaceInfo | null;
  checklist: CheckEntry[];
  /** 이 항목 → 같은 날 다음 장소로 가는 이동 정보 */
  legToNext: ImportLeg | null;
  /** 앞 장소 → 이 항목으로 오는 이동 정보 */
  legFromPrev: ImportLeg | null;
}
export interface ImportDay {
  /** 여행 날짜(YYYY-MM-DD) 또는 null = 후보 장소 */
  dayId: string | null;
  city: string;
  items: ImportItem[];
}
export interface ImportPlan {
  days: ImportDay[];
  warnings: string[];
  total: number;
}

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const norm = (k: string) => k.toLowerCase().replace(/[\s_\-]/g, '');

/** 객체에서 후보 키 중 처음 값이 있는 것 (대소문자·밑줄 무시) */
function pick(o: J, keys: string[]): unknown {
  const map = new Map(Object.keys(o).map((k) => [norm(k), k]));
  for (const k of keys) {
    const real = map.get(norm(k));
    if (real !== undefined && o[real] !== undefined && o[real] !== null && o[real] !== '') return o[real];
  }
  return undefined;
}

const DAY_LIST_KEYS = ['days', 'itinerary', 'schedule', 'schedules', 'plan', 'plans', 'dailyPlan', 'dailyPlans', 'daily', 'trip', '일정', '일자별', '날짜별', '여행일정'];
const ITEM_LIST_KEYS = ['items', 'schedule', 'activities', 'places', 'plan', 'events', 'timeline', 'spots', 'stops', 'itinerary', 'visits', '일정', '장소', '활동', '코스'];
const NAME_KEYS = ['name', 'nameKo', 'title', 'place', 'placeName', 'activity', 'spot', 'location', 'destination', 'what', '장소', '이름', '장소명', '활동', '제목'];
const LOCAL_KEYS = ['localName', 'nameLocal', 'nameCn', 'nameZh', 'chineseName', 'nameChinese', 'originalName', 'name_local', 'local', '현지어', '현지명', '원어', '중국어'];
const ADDR_KEYS = ['address', 'addr', 'addressKo', '주소'];
const ADDR_LOCAL_KEYS = ['localAddress', 'addressLocal', 'addressCn', 'addressZh', 'chineseAddress', '현지주소', '현지어주소'];
const TIME_KEYS = ['time', 'startTime', 'start', 'start_time', 'from', 'at', '시간', '시각', '시작', '출발'];
const END_KEYS = ['endTime', 'end', 'end_time', 'to', 'until', '종료', '끝'];
const MEMO_KEYS = ['memo', 'note', 'notes', 'description', 'desc', 'details', 'detail', 'comment', 'comments', 'info', 'tip', '메모', '설명', '비고', '참고', '상세'];
const CHECK_KEYS = ['checklist', 'todo', 'todos', 'checks', 'tips', 'reminders', 'prepare', 'bring', 'mustBring', '준비물', '체크', '체크리스트', '할일', '주의사항', '팁'];
const CAT_KEYS = ['category', 'type', 'kind', 'cat', '분류', '카테고리', '종류'];
const TAG_KEYS = ['tag', 'subCategory', 'subcategory', 'area', 'theme', '태그', '세부', '지역'];
const COST_KEYS = ['cost', 'price', 'budget', 'fee', 'ticket', 'admission', '비용', '가격', '요금', '입장료', '예산'];
const DUR_KEYS = ['duration', 'stay', 'stayTime', '소요', '체류', '머무는시간'];
const NEXT_LEG_KEYS = ['moveToNext', 'toNext', 'next', 'transportToNext', 'travelToNext', 'moveNext', 'transfer', 'move', 'transport', 'transportation', 'route', 'getting', '이동', '다음이동', '교통'];
const PREV_LEG_KEYS = ['moveFromPrev', 'fromPrev', 'howToGet', 'howToGetHere', 'getThere', 'access', 'arrival', '오는길', '가는법', '찾아가는법'];

// ───────── 날짜·시간 ─────────

/** "2026-11-08", "2026.11.8", "11/8", "11월 8일", "11-08" → YYYY-MM-DD (연도 없으면 여행 연도) */
export function parseDate(v: unknown, days: Day[]): string | null {
  const s = str(v);
  if (!s) return null;
  let m = s.match(/(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (m) {
    const md = `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    const hit = days.find((d) => d.date.slice(5) === md);
    if (hit) return hit.date;
    const y = days[0]?.date.slice(0, 4) ?? String(new Date().getFullYear());
    return `${y}-${md}`;
  }
  return null;
}

/** "Day 1", "1일차", "DAY2", 3 → 1부터 시작하는 번호 */
export function parseDayNo(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 60) return v;
  const s = str(v);
  const m = s.match(/(?:day|d|데이)\s*\.?\s*(\d{1,2})|(\d{1,2})\s*(?:일차|일째|번째\s*날|th day|st day|nd day|rd day)/i) ?? s.match(/^(\d{1,2})$/);
  if (!m) return null;
  const n = Number(m[1] ?? m[2]);
  return n >= 1 && n <= 60 ? n : null;
}

/** "09:30", "9:30", "오후 2시", "2시 30분", "2:30 PM", "09:30-11:00", "09:30~" → HH:MM */
export function parseTime(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = s.match(/(오전|오후|아침|저녁|밤|새벽|am|pm|a\.m\.|p\.m\.)?\s*(\d{1,2})\s*(?::|시|h)\s*(\d{1,2})?\s*(?:분)?\s*(am|pm|a\.m\.|p\.m\.)?/i);
  if (!m) return null;
  let h = Number(m[2]);
  const min = m[3] ? Number(m[3]) : 0;
  const ap = (m[1] ?? m[4] ?? '').toLowerCase();
  if (/(오후|저녁|밤|pm|p\.m\.)/.test(ap) && h < 12) h += 12;
  if (/(오전|새벽|am|a\.m\.)/.test(ap) && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** 시간 범위 문자열에서 끝 시각 ("09:30-11:00" → 11:00) */
function rangeEnd(v: unknown): string | null {
  const s = str(v);
  const parts = s.split(/\s*(?:-|~|–|—|to|부터)\s*/);
  return parts.length >= 2 && parts[1] ? parseTime(parts[1]) : null;
}

// ───────── 분류·이동 ─────────

export function guessCategory(...texts: string[]): Category | null {
  const t = texts.join(' ').toLowerCase();
  if (!t.trim()) return null;
  const rules: [Category, RegExp][] = [
    ['transport', /transport|transit|flight|airport|station|taxi|bus|subway|metro|train|ferry|교통|이동|공항|항공|비행|역\b|터미널|택시|버스|지하철|기차|고속철|페리|체크인 카운터|출국|입국/],
    ['stay', /hotel|stay|hostel|resort|accommodation|lodging|check-?in|check-?out|숙소|호텔|체크인|체크아웃|게스트하우스|리조트|숙박/],
    ['cafe', /cafe|café|coffee|dessert|bakery|tea|카페|커피|디저트|베이커리|빵/],
    ['food', /food|restaurant|meal|lunch|dinner|breakfast|brunch|eat|bbq|beer|bar|pub|맛집|식당|점심|저녁|아침|식사|먹|음식|요리|꼬치|양꼬치|맥주|훠궈|딤섬|해산물/],
    ['shop', /shop|mall|market|store|souvenir|쇼핑|시장|몰|백화점|기념품|마트|상점/],
    ['sight', /sight|attraction|tour|museum|park|beach|temple|church|view|walk|landmark|관광|명소|공원|해변|해수욕장|박물관|성당|교회|사원|전망|산책|거리|광장|구경|투어|야경/],
  ];
  for (const [c, re] of rules) if (re.test(t)) return c;
  return null;
}

const CAT_DIRECT: Record<string, Category> = {
  sight: 'sight', attraction: 'sight', 관광: 'sight', 관광지: 'sight', 명소: 'sight',
  stay: 'stay', hotel: 'stay', accommodation: 'stay', 숙소: 'stay', 숙박: 'stay',
  food: 'food', restaurant: 'food', meal: 'food', 식당: 'food', 맛집: 'food', 식사: 'food', 음식: 'food',
  cafe: 'cafe', café: 'cafe', coffee: 'cafe', 카페: 'cafe',
  shop: 'shop', shopping: 'shop', 쇼핑: 'shop',
  transport: 'transport', transportation: 'transport', move: 'transport', 교통: 'transport', 이동: 'transport',
  etc: 'etc', other: 'etc', 기타: 'etc',
};

export function parseMode(v: unknown): TravelMode {
  const s = str(v).toLowerCase();
  if (/walk|foot|도보|걸어|걷/.test(s)) return 'walk';
  if (/taxi|cab|didi|디디|택시|grab|uber|차량|car|drive|자동차|렌터카/.test(s)) return 'taxi';
  if (/subway|metro|지하철|전철|mrt/.test(s)) return 'subway';
  if (/bus|버스/.test(s)) return 'bus';
  if (/train|rail|ktx|고속철|기차|열차|高铁|동차/.test(s)) return 'train';
  if (/flight|plane|air|비행|항공/.test(s)) return 'flight';
  return 'etc';
}

/** "15분", "1시간 20분", "1h 20m", "15 min", 15 → 분 */
export function parseMinutes(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.round(v);
  const s = str(v).toLowerCase();
  if (!s) return null;
  const h = s.match(/(\d+(?:\.\d+)?)\s*(?:시간|hours?|hrs?|h\b)/);
  const m = s.match(/(\d+)\s*(?:분|minutes?|mins?|m\b)/);
  if (h || m) return Math.round((h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0));
  const n = s.match(/^(\d+)$/);
  return n ? Number(n[1]) : null;
}

/** "2.3km", "800m", 2.3(km 키) → 미터 */
function parseMeters(v: unknown, unitHint: 'km' | 'm'): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.round(unitHint === 'km' ? v * 1000 : v);
  const s = str(v).toLowerCase();
  const km = s.match(/(\d+(?:\.\d+)?)\s*km/);
  if (km) return Math.round(Number(km[1]) * 1000);
  const m = s.match(/(\d+(?:\.\d+)?)\s*m\b|(\d+(?:\.\d+)?)\s*미터/);
  if (m) return Math.round(Number(m[1] ?? m[2]));
  return null;
}

function detectCurrency(s: string, fallback: Currency): Currency {
  const t = s.toUpperCase();
  for (const c of CURRENCIES) if (t.includes(c)) return c;
  if (/위안|元|RMB|¥/.test(s)) return 'CNY';
  if (/원|₩/.test(s)) return 'KRW';
  if (/엔|円/.test(s)) return 'JPY';
  if (/\$|달러/.test(s)) return 'USD';
  return fallback;
}

/** 25, "25위안", "¥25", "약 15,000원", "20-30元"(→20) → { amount, currency } */
export function parseMoney(v: unknown, fallback: Currency): { amount: number | null; currency: Currency } {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return { amount: v, currency: fallback };
  const s = str(v);
  const m = s.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return { amount: m ? Number(m[1]) : null, currency: detectCurrency(s, fallback) };
}

function parseLeg(v: unknown, cur: Currency): ImportLeg | null {
  if (v == null || v === '') return null;
  if (typeof v === 'string') {
    // "택시 15분 (약 25위안)" 같은 한 줄 설명
    const money = parseMoney(v.match(/[¥₩$]?\s*\d[\d,.]*\s*(?:위안|元|원|RMB|CNY|KRW|달러|USD)|[¥₩$]\s*\d[\d,.]*/)?.[0] ?? '', cur);
    return {
      mode: parseMode(v),
      durationMin: parseMinutes(v.match(/\d+\s*(?:시간|hours?|h)\s*\d*\s*(?:분|min)?|\d+\s*(?:분|min|minutes?)/i)?.[0] ?? ''),
      distanceM: parseMeters(v, 'm'),
      fareAmount: money.amount,
      fareCurrency: money.currency,
      memo: v.slice(0, 300),
    };
  }
  if (!isObj(v)) return null;
  const modeRaw = pick(v, ['mode', 'type', 'by', 'method', 'transport', 'vehicle', '수단', '교통수단', '방법']);
  const fareRaw = pick(v, ['fare', 'cost', 'price', 'fee', '요금', '비용', '가격']);
  const curRaw = str(pick(v, ['currency', '통화']));
  const money = parseMoney(fareRaw, curRaw ? detectCurrency(curRaw, cur) : cur);
  const kmRaw = pick(v, ['km', 'distanceKm', 'distance_km']);
  const distRaw = kmRaw ?? pick(v, ['distanceM', 'meters', 'distance', '거리']);
  const memo = str(pick(v, ['memo', 'note', 'notes', 'description', 'detail', 'details', '메모', '설명', '비고']));
  const leg: ImportLeg = {
    mode: parseMode(modeRaw ?? memo),
    durationMin: parseMinutes(pick(v, ['minutes', 'durationMin', 'duration', 'time', 'mins', '소요', '소요시간', '시간', '분'])),
    distanceM: parseMeters(distRaw, kmRaw !== undefined || (typeof distRaw === 'number' && distRaw < 100) ? 'km' : 'm'),
    fareAmount: money.amount,
    fareCurrency: money.currency,
    memo: memo.slice(0, 300),
  };
  const empty = leg.mode === 'etc' && leg.durationMin == null && leg.distanceM == null && leg.fareAmount == null && !leg.memo;
  return empty ? null : leg;
}

// ───────── 항목 ─────────

let seq = 0;
const cid = () => `imp${Date.now().toString(36)}${(seq++).toString(36)}`;

function toChecklist(v: unknown): CheckEntry[] {
  const arr = Array.isArray(v) ? v : typeof v === 'string' && /\n|•|·|;/.test(v) ? v.split(/\n|•|;/) : typeof v === 'string' ? [v] : [];
  const out: CheckEntry[] = [];
  for (const e of arr) {
    const text = isObj(e) ? str(pick(e, ['text', 'title', 'name', 'item', '내용'])) : str(e).replace(/^[-*·\s]+/, '');
    if (!text) continue;
    const important = isObj(e) ? Boolean(pick(e, ['important', 'required', 'must', '필수'])) : /필수|꼭|반드시|!$/.test(text);
    out.push({ id: cid(), text: text.slice(0, 200), important, done: false });
    if (out.length >= 40) break;
  }
  return out;
}

function memoText(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => (isObj(x) ? Object.values(x).map(str).filter(Boolean).join(' ') : str(x))).filter(Boolean).join('\n');
  if (isObj(v)) return Object.entries(v).map(([k, x]) => `${k}: ${str(x)}`).join('\n');
  return str(v);
}

function parseItem(raw: unknown, cur: Currency): ImportItem | null {
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return null;
    const time = /^\s*(오전|오후)?\s*\d{1,2}\s*[:시]/.test(s) ? parseTime(s) : null;
    const name = time ? s.replace(/^\s*(오전|오후)?\s*\d{1,2}\s*[:시]\s*\d{0,2}\s*분?\s*(?:[-~]\s*(오전|오후)?\s*\d{1,2}\s*[:시]\s*\d{0,2}\s*분?)?\s*[-–:·]?\s*/, '') : s;
    return { kind: 'place', category: guessCategory(name), tag: '', time, memo: '', place: { ...emptyPlace(), nameKo: name.slice(0, 120) }, checklist: [], legToNext: null, legFromPrev: null };
  }
  if (!isObj(raw)) return null;

  // place 가 객체로 들어온 경우 { place: { name, address, lat, lng } }
  const placeObj = isObj(raw.place) ? (raw.place as J) : isObj(raw.location) ? (raw.location as J) : null;
  const src = placeObj ? { ...raw, ...placeObj } : raw;
  const nameRaw = pick(src, NAME_KEYS);
  let name = isObj(nameRaw) ? str(pick(nameRaw, ['ko', 'name', 'title'])) : str(nameRaw);
  const typeRaw = str(pick(raw, CAT_KEYS));
  const memoParts: string[] = [];
  const mainMemo = memoText(pick(raw, MEMO_KEYS));
  if (mainMemo) memoParts.push(mainMemo);

  const timeRaw = pick(raw, TIME_KEYS);
  const time = parseTime(timeRaw);
  const end = parseTime(pick(raw, END_KEYS)) ?? rangeEnd(timeRaw);
  if (timeRaw !== undefined && !time) memoParts.unshift(`🕘 ${str(timeRaw)}`);
  if (end) memoParts.unshift(`~${end}까지`);
  const dur = pick(raw, DUR_KEYS);
  if (dur !== undefined && !isObj(dur)) memoParts.push(`⏱ ${str(dur)}`);
  const cost = pick(raw, COST_KEYS);
  if (cost !== undefined && !isObj(cost)) memoParts.push(`💰 ${str(cost)}`);
  else if (isObj(cost)) memoParts.push(`💰 ${memoText(cost)}`);

  // 이동 정보
  let legToNext = parseLeg(pick(raw, NEXT_LEG_KEYS), cur);
  const legFromPrev = parseLeg(pick(raw, PREV_LEG_KEYS), cur);
  // "transport" 가 분류값으로 쓰인 경우("type": "transport")는 이동 정보 아님
  if (legToNext && typeof pick(raw, NEXT_LEG_KEYS) === 'string' && CAT_DIRECT[str(pick(raw, NEXT_LEG_KEYS)).toLowerCase()]) legToNext = null;

  const isMemo = /^(memo|note|메모|노트|안내|notice|info)$/i.test(typeRaw) || (!name && !!mainMemo);
  const checklist = toChecklist(pick(raw, CHECK_KEYS));
  if (!name && !mainMemo && checklist.length === 0) return null;

  if (isMemo) {
    const text = [name, ...memoParts].filter(Boolean).join('\n').slice(0, 2000) || checklist.map((c) => c.text).join(', ');
    return { kind: 'memo', category: null, tag: '', time, memo: text, place: null, checklist, legToNext: null, legFromPrev: null };
  }
  if (!name) name = mainMemo.split('\n')[0].slice(0, 120);

  const latRaw = pick(src, ['lat', 'latitude', '위도']);
  const lngRaw = pick(src, ['lng', 'lon', 'long', 'longitude', '경도']);
  let lat = typeof latRaw === 'number' ? latRaw : Number(str(latRaw)) || null;
  let lng = typeof lngRaw === 'number' ? lngRaw : Number(str(lngRaw)) || null;
  const coords = pick(src, ['coordinates', 'coords', 'latLng', '좌표']);
  if ((lat == null || lng == null) && Array.isArray(coords) && coords.length === 2 && coords.every((x) => typeof x === 'number')) [lat, lng] = coords as [number, number];
  const coordOk = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

  const direct = CAT_DIRECT[typeRaw.toLowerCase()];
  const category: Category = direct ?? guessCategory(typeRaw, name, mainMemo) ?? 'etc';
  const tagRaw = str(pick(raw, TAG_KEYS));
  const tag = (tagRaw || (!direct && typeRaw && typeRaw.length <= 30 && !guessCategory(typeRaw) ? typeRaw : '')).slice(0, 30);

  return {
    kind: 'place',
    category,
    tag,
    time,
    memo: memoParts.join('\n').slice(0, 2000),
    place: {
      ...emptyPlace(),
      nameKo: name.slice(0, 120),
      nameLocal: str(pick(src, LOCAL_KEYS)).slice(0, 120),
      address: str(pick(src, ADDR_KEYS)).slice(0, 300),
      addressLocal: str(pick(src, ADDR_LOCAL_KEYS)).slice(0, 300),
      lat: coordOk ? lat : null,
      lng: coordOk ? lng : null,
      coordSource: coordOk ? 'user' : null,
    },
    checklist,
    legToNext,
    legFromPrev,
  };
}

function itemListOf(o: J): unknown[] | null {
  const v = pick(o, ITEM_LIST_KEYS);
  if (Array.isArray(v)) return v;
  // { morning: [...], afternoon: [...], evening: [...] } 같은 시간대 묶음
  const slots = ['morning', 'afternoon', 'evening', 'night', '오전', '오후', '저녁', '밤'];
  const found = slots.map((s) => pick(o, [s])).filter(Array.isArray) as unknown[][];
  return found.length ? found.flat() : null;
}

const looksLikeDay = (v: unknown) => isObj(v) && itemListOf(v) !== null;

// ───────── 진입점 ─────────

export function stripFences(text: string): string {
  let t = text.replace(/^﻿/, '').trim();
  const fence = t.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  // 앞뒤 설명 문장이 붙은 경우 첫 { 또는 [ 부터 마지막 } 또는 ] 까지
  const start = t.search(/[[{]/);
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (start > 0 || (end >= 0 && end < t.length - 1)) t = t.slice(Math.max(0, start), end + 1);
  return t;
}

export function parseJsonLoose(text: string): unknown {
  const t = stripFences(text);
  try {
    return JSON.parse(t);
  } catch (e) {
    // 흔한 실수: 끝 쉼표, 주석
    const fixed = t.replace(/\/\/[^\n"]*$/gm, '').replace(/,\s*([}\]])/g, '$1');
    try {
      return JSON.parse(fixed);
    } catch {
      const m = String((e as Error).message).match(/position (\d+)/);
      const line = m ? t.slice(0, Number(m[1])).split('\n').length : null;
      throw new Error(`JSON 형식이 아니에요${line ? ` (${line}번째 줄 근처)` : ''}. GPT 답변의 코드 부분만 복사했는지 확인해 주세요.`);
    }
  }
}

export function buildImportPlan(data: unknown, days: Day[], baseCurrency: Currency): ImportPlan {
  const warnings: string[] = [];
  const dates = new Set(days.map((d) => d.date));

  // 1) 날짜 묶음 찾기
  let dayList: { key?: string; v: unknown }[] | null = null;
  let flat: unknown[] | null = null;
  const root = isObj(data) && isObj(data.trip) && !Array.isArray(pick(data, DAY_LIST_KEYS.filter((k) => k !== 'trip'))) ? (data.trip as J) : data;
  if (Array.isArray(root)) {
    if (root.some(looksLikeDay)) dayList = root.map((v) => ({ v }));
    else flat = root;
  } else if (isObj(root)) {
    const dl = pick(root, DAY_LIST_KEYS.filter((k) => k !== 'trip'));
    if (Array.isArray(dl) && dl.some(looksLikeDay)) dayList = dl.map((v) => ({ v }));
    else if (Array.isArray(dl)) flat = dl;
    else if (isObj(dl)) dayList = Object.entries(dl).map(([key, v]) => ({ key, v }));
    else {
      // { "2026-11-08": [...], "2026-11-09": [...] } / { "day1": {...} }
      const keyed = Object.entries(root).filter(([k, v]) => (parseDate(k, days) || parseDayNo(k)) && (Array.isArray(v) || isObj(v)));
      if (keyed.length) dayList = keyed.map(([key, v]) => ({ key, v }));
      else if (looksLikeDay(root)) dayList = [{ v: root }];
    }
  }
  if (!dayList && !flat) throw new Error('일정 목록을 찾지 못했어요. "days" 안에 날짜별 "items" 가 있는 형식으로 만들어 주세요.');

  // 2) 날짜 해석
  const byDay = new Map<string | null, ImportDay>();
  const outOfRange = new Set<string>();
  const resolve = (dateRaw: unknown, noRaw: unknown, idx: number | null): string | null => {
    const d = parseDate(dateRaw, days);
    if (d) {
      if (dates.has(d)) return d;
      outOfRange.add(d);
      return null;
    }
    const n = parseDayNo(noRaw);
    if (n != null) {
      if (days[n - 1]) return days[n - 1].date;
      outOfRange.add(`DAY ${n}`);
      return null;
    }
    if (idx != null) {
      if (days[idx]) return days[idx].date;
      outOfRange.add(`${idx + 1}번째 날`);
    }
    return null;
  };
  const bucket = (dayId: string | null, city = '') => {
    if (!byDay.has(dayId)) byDay.set(dayId, { dayId, city: '', items: [] });
    const b = byDay.get(dayId)!;
    if (city && !b.city && dayId) b.city = city.slice(0, 40);
    return b;
  };
  let total = 0;
  let skipped = 0;
  const push = (b: ImportDay, raw: unknown) => {
    const it = parseItem(raw, baseCurrency);
    if (!it) {
      skipped++;
      return;
    }
    if (total >= 300) return;
    b.items.push(it);
    total++;
  };

  if (dayList) {
    dayList.forEach(({ key, v }, idx) => {
      const o = isObj(v) ? v : {};
      const dateRaw = pick(o, ['date', 'day_date', '날짜', '일자']) ?? (key && parseDate(key, days) ? key : undefined);
      const noRaw = pick(o, ['day', 'dayNumber', 'dayNo', 'dayIndex', 'day_number', '일차', 'title', 'label']) ?? key;
      const dayId = resolve(dateRaw, noRaw, dateRaw === undefined && parseDayNo(noRaw) == null ? idx : null);
      const cityRaw = pick(o, ['city', 'location', 'area', 'region', '도시', '지역']);
      const b = bucket(dayId, typeof cityRaw === 'string' ? cityRaw : '');
      const list = Array.isArray(v) ? v : itemListOf(o) ?? [];
      list.forEach((raw) => push(b, raw));
    });
  } else {
    flat!.forEach((raw) => {
      const o = isObj(raw) ? raw : {};
      const dateRaw = pick(o, ['date', '날짜', '일자']);
      const noRaw = pick(o, ['day', 'dayNumber', 'dayNo', '일차']);
      const dayId = dateRaw === undefined && noRaw === undefined ? (days[0]?.date ?? null) : resolve(dateRaw, noRaw, null);
      push(bucket(dayId), raw);
    });
    if (flat!.length && flat!.every((r) => !isObj(r) || (pick(r, ['date', '날짜', 'day', 'dayNumber']) === undefined)))
      warnings.push('날짜 정보가 없어 모두 첫날에 넣어요. 날짜별로 나누려면 "days" 형식을 써 주세요.');
  }

  if (outOfRange.size) warnings.push(`여행 기간 밖(${[...outOfRange].slice(0, 4).join(', ')}${outOfRange.size > 4 ? ' 등' : ''}) 일정은 '후보 장소'로 넣어요. 여행 기간을 먼저 늘리면 그 날짜로 들어가요.`);
  if (skipped) warnings.push(`이름·메모가 없는 ${skipped}개는 건너뛰어요.`);
  if (total >= 300) warnings.push('한 번에 300개까지만 가져와요.');

  const order = [...days.map((d) => d.date), null];
  const out = [...byDay.values()].filter((d) => d.items.length).sort((a, b) => order.indexOf(a.dayId) - order.indexOf(b.dayId));
  return { days: out, warnings, total };
}

/** GPT 에게 붙여 줄 요청 문구 (Travely 가 가장 정확히 읽는 형식) */
export function gptPrompt(tripName: string, days: Day[]): string {
  const range = days.length ? `${days[0].date} ~ ${days[days.length - 1].date}` : '';
  return `아래 여행 일정을 Travely 앱에 넣을 JSON 으로만 답해 줘. 설명 문장 없이 코드 블록 하나만.
여행: ${tripName}${range ? ` (${range})` : ''}

형식:
{
  "days": [
    {
      "date": "YYYY-MM-DD",
      "city": "도시 이름",
      "items": [
        {
          "time": "09:30",
          "type": "place",
          "name": "한국어 장소 이름",
          "localName": "현지어 이름 (예: 栈桥)",
          "category": "sight",
          "tag": "짧은 세부 설명 (선택)",
          "address": "주소 (선택)",
          "localAddress": "현지어 주소 (선택)",
          "memo": "메모 (표 받는 곳, 예약 정보, 팁 등)",
          "checklist": ["바우처 종이 지참", "여권"],
          "moveToNext": { "mode": "taxi", "minutes": 15, "km": 4.2, "fare": 25, "currency": "CNY", "memo": "디디 호출" }
        },
        { "time": "12:00", "type": "memo", "memo": "점심은 근처에서 자유롭게" }
      ]
    }
  ]
}

규칙:
- type: place(장소) 또는 memo(메모만)
- category: sight(관광) / food(식당) / cafe(카페) / stay(숙소) / shop(쇼핑) / transport(교통·공항) / etc(기타)
- moveToNext.mode: walk / taxi / bus / subway / train / flight / etc — 다음 장소로 가는 방법 (모르면 빼기)
- 시간 모르면 "time" 빼기. 좌표(lat, lng)는 확실할 때만 넣고 모르면 빼기 — 지어내지 말 것
- 날짜는 여행 기간 안의 실제 날짜로

일정:
(여기에 GPT 와 정리한 일정을 붙여 넣거나, "위에서 짠 일정"이라고 쓰기)`;
}

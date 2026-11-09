/** Travely 도메인 타입. 시각은 모두 ms(number)로 다룬다 (저장소 어댑터가 변환). */

export type Role = 'owner' | 'editor' | 'viewer';
export type MemberStatus = 'active' | 'removed';

// ───────── 통화·국가 ─────────
export const CURRENCIES = ['KRW', 'CNY', 'JPY', 'USD', 'HKD', 'TWD', 'THB', 'VND', 'SGD', 'EUR'] as const;
export type Currency = (typeof CURRENCIES)[number];
export const CURRENCY_SYMBOL: Record<Currency, string> = {
  KRW: '₩', CNY: '¥', JPY: '¥', USD: '$', HKD: 'HK$', TWD: 'NT$', THB: '฿', VND: '₫', SGD: 'S$', EUR: '€',
};
export const CURRENCY_LABEL: Record<Currency, string> = {
  KRW: '원', CNY: '위안', JPY: '엔', USD: '달러', HKD: '홍콩달러', TWD: '대만달러', THB: '바트', VND: '동', SGD: '싱가포르달러', EUR: '유로',
};
export const CURRENCY_DECIMALS: Record<Currency, number> = {
  KRW: 0, CNY: 2, JPY: 0, USD: 2, HKD: 2, TWD: 0, THB: 2, VND: 0, SGD: 2, EUR: 2,
};

export interface City {
  name: string;
  lat: number | null;
  lng: number | null;
}

export type Illustration = 'city' | 'coast' | 'blossom' | 'temple' | 'mountain' | 'island';

export interface Trip {
  id: string;
  name: string;
  countryCode: string;
  cities: City[];
  startDate: string; // YYYY-MM-DD
  endDate: string;
  timezone: string;
  baseCurrency: Currency;
  illustration: Illustration;
  ownerUid: string;
  isSample: boolean;
  updatedBy?: string;
  updatedAt?: number;
}

export interface Member {
  uid: string;
  role: Role;
  status: MemberStatus;
  displayName: string;
  joinedAt?: number;
  inviteToken?: string;
}

export interface Invite {
  token: string;
  role: 'editor' | 'viewer';
  revoked: boolean;
  createdBy: string;
  expiresAt: number;
  tripName: string;
  inviterName: string;
}

export interface Day {
  date: string; // = 문서 ID
  index: number;
  city: string;
}

// ───────── 일정 ─────────
export type ItemKind = 'place' | 'memo' | 'flight';
export type Category = 'sight' | 'stay' | 'food' | 'cafe' | 'shop' | 'transport' | 'etc';
export const CATEGORY_LABEL: Record<Category, string> = {
  sight: '관광', stay: '숙소', food: '음식점', cafe: '카페', shop: '쇼핑', transport: '교통', etc: '기타',
};
export const CATEGORY_ORDER: Category[] = ['sight', 'stay', 'food', 'cafe', 'shop', 'transport', 'etc'];

export type CoordSource = 'user' | 'pin' | 'search';

export interface PlaceInfo {
  nameKo: string;
  nameLocal: string;
  address: string;
  addressLocal: string;
  lat: number | null;
  lng: number | null;
  coordSource: CoordSource | null;
}

export interface CheckEntry {
  id: string;
  text: string;
  important: boolean;
  done: boolean;
}

export interface Item {
  id: string;
  /** null = 후보 장소 (아직 날짜 없음) */
  dayId: string | null;
  order: number;
  kind: ItemKind;
  category: Category | null;
  tag: string; // 세부 태그 (예: 해안)
  time: string | null; // HH:mm
  memo: string;
  place: PlaceInfo | null;
  /** 연결된 예약. kind=flight 는 bookingIds[0] 의 항공 예약을 그대로 보여줌 */
  bookingIds: string[];
  checklist: CheckEntry[];
  createdBy: string;
  updatedBy: string;
  updatedAt?: number;
  version: number;
}

export const emptyPlace = (): PlaceInfo => ({
  nameKo: '', nameLocal: '', address: '', addressLocal: '', lat: null, lng: null, coordSource: null,
});

// ───────── 이동 정보 ─────────
export type TravelMode = 'walk' | 'taxi' | 'bus' | 'subway' | 'train' | 'flight' | 'etc';
export const MODE_LABEL: Record<TravelMode, string> = {
  walk: '도보', taxi: '택시', bus: '버스', subway: '지하철', train: '기차', flight: '비행기', etc: '기타',
};
export const MODE_EMOJI: Record<TravelMode, string> = {
  walk: '🚶', taxi: '🚕', bus: '🚌', subway: '🚇', train: '🚄', flight: '✈️', etc: '➡️',
};
export const MODE_ORDER: TravelMode[] = ['walk', 'taxi', 'bus', 'subway', 'train', 'flight', 'etc'];

export interface Leg {
  id: string; // `${fromId}__${toId}`
  fromId: string;
  toId: string;
  mode: TravelMode;
  durationMin: number | null;
  distanceM: number | null;
  fareAmount: number | null;
  fareCurrency: Currency;
  memo: string;
  /** route = 경로 서비스 조회값, manual = 직접 입력. (직선거리는 저장하지 않고 화면에서 계산) */
  source: 'route' | 'manual' | null;
  /** 경로 모양 (encoded polyline, 정밀도 5) */
  geometry: string | null;
  routedAt: number | null;
  /** 조회 당시 좌표 — 장소 좌표가 바뀌면 '다시 조회 필요' 판단 */
  routedFrom: string | null; // "lat,lng"
  routedTo: string | null;
  updatedBy: string;
  updatedAt?: number;
  version: number;
}

export const legId = (fromId: string, toId: string) => `${fromId}__${toId}`;

// ───────── 예약 ─────────
export type BookingType = 'flight' | 'stay' | 'transport' | 'ticket' | 'etc';
export const BOOKING_LABEL: Record<BookingType, string> = {
  flight: '항공', stay: '숙소', transport: '교통', ticket: '입장권', etc: '기타',
};
export const BOOKING_ORDER: BookingType[] = ['flight', 'stay', 'transport', 'ticket', 'etc'];

export interface FlightInfo {
  airline: string;
  flightNo: string;
  depCode: string;
  depDate: string;
  depTime: string;
  depTz: string;
  depTerminal: string;
  arrCode: string;
  arrDate: string;
  arrTime: string;
  arrTz: string;
  arrTerminal: string;
  lookupAt: number | null;
}

export interface Booking {
  id: string;
  type: BookingType;
  title: string;
  startDate: string | null;
  startTime: string | null;
  endDate: string | null; // 숙소 체크아웃 등
  endTime: string | null;
  reservationNo: string;
  memo: string;
  flight: FlightInfo | null;
  fileIds: string[];
  createdBy: string;
  updatedBy: string;
  updatedAt?: number;
  version: number;
}

export interface FileMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
  pages: number;
  /** 목록용 작은 미리보기 (data URL, 수 KB) */
  thumb: string;
  chunkCount: number;
  complete: boolean;
  uploadedBy: string;
  uploadedAt?: number;
}

// ───────── 가계부 ─────────
export type ExpenseCategory = 'stay' | 'food' | 'cafe' | 'transport' | 'ticket' | 'shop' | 'etc';
export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  stay: '숙소', food: '식사', cafe: '카페·간식', transport: '교통', ticket: '입장권', shop: '쇼핑', etc: '기타',
};
export const EXPENSE_CATEGORY_ORDER: ExpenseCategory[] = ['stay', 'food', 'cafe', 'transport', 'ticket', 'shop', 'etc'];

export type PayMethod = 'cash' | 'credit' | 'debit' | 'alipay' | 'wechat' | 'etc';
export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  cash: '현금', credit: '신용카드', debit: '체크카드', alipay: '알리페이', wechat: '위챗페이', etc: '기타',
};
export const PAY_METHOD_ORDER: PayMethod[] = ['cash', 'credit', 'debit', 'alipay', 'wechat', 'etc'];

export type SplitMode = 'equal' | 'amount' | 'ratio';

export interface Expense {
  id: string;
  title: string;
  date: string | null; // null = 여행 전
  time: string | null;
  category: ExpenseCategory;
  amount: number; // 결제 통화 기준
  currency: Currency;
  /** 1 결제통화 = krwRate 원 (저장 시점 적용 환율). KRW 결제면 1 */
  krwRate: number;
  krwRateDate: string | null; // 환율 기준일 (직접 입력이면 null)
  /** 카드 명세서 등 실제 원화 결제액. 있으면 정산에 이 값을 사용 */
  krwActual: number | null;
  method: PayMethod;
  cardName: string;
  platform: string;
  /** 결제자별 결제 금액 (결제 통화). 합계 = amount */
  payers: Record<string, number>;
  /** 부담 방식. equal: 값=1 인 사람끼리 균등 / ratio: 값=비율 / amount: 값=부담 금액(합계=amount) */
  /** settled: 정산 완료로 표시한 지출 (정산 계산에서 제외). 보안 규칙 변경 없이 쓰려고 split 안에 둠 */
  split: { mode: SplitMode; shares: Record<string, number>; settled?: boolean };
  memo: string;
  createdBy: string;
  updatedBy: string;
  updatedAt?: number;
  version: number;
}

// ───────── 준비물 ─────────
export interface PackingItem {
  id: string;
  text: string;
  owner: string; // uid 또는 'shared'
  done: boolean;
  order: number;
  updatedBy: string;
  updatedAt?: number;
  version: number;
}

export interface TripBundle {
  trip: Trip;
  members: Member[];
  days: Day[];
  items: Item[];
  legs: Leg[];
  bookings: Booking[];
  files: FileMeta[];
  expenses: Expense[];
  packing: PackingItem[];
}

import type { Category, FlightInfo, Item } from './types';
import { emptyPlace } from './types';
import type { Seed, TripInput } from '../data/repo';

/**
 * 첨부 사진(트리플 화면 6장)에서 '보이는 것만' 옮긴 샘플 일정.
 *  - 좌표는 사진에 없으므로 전부 null(위치 미지정). 사진 속 거리값도 넣지 않음.
 *  - 날씨·'예약가능' 표시는 넣지 않음. 잘린 메모는 보이는 부분까지만 + "[사진에서 잘림]".
 *  - 항공편 2개는 예약함의 '항공' 예약으로 넣고, 일정에는 그 예약을 보여주는 항공편 카드로 연결.
 */
const TRUNC = ' … [사진에서 잘림]';

type SeedItem = NonNullable<Seed['items']>[number];
const place = (dayId: string, nameKo: string, category: Category, time: string | null = null, memo = '', tag = ''): SeedItem => ({
  dayId,
  item: { kind: 'place', category, time, memo, tag, place: { ...emptyPlace(), nameKo } } as Partial<Item> & Pick<Item, 'kind'>,
});
const note = (dayId: string, memo: string): SeedItem => ({ dayId, item: { kind: 'memo', memo } });
const flightRef = (dayId: string, bookingKey: string, time: string): SeedItem => ({
  dayId,
  item: { kind: 'flight', category: 'transport', time, bookingIds: [bookingKey] },
});

export const SAMPLE_TRIP: TripInput = {
  name: '칭다오 · 옌타이',
  countryCode: 'CN',
  cities: [
    { name: '칭다오', lat: 36.0671, lng: 120.3826 },
    { name: '옌타이', lat: 37.4638, lng: 121.4479 },
  ],
  startDate: '2026-11-08',
  endDate: '2026-11-10',
  timezone: 'Asia/Shanghai',
  baseCurrency: 'CNY',
  illustration: 'temple',
};

const D1 = '2026-11-08';
const D2 = '2026-11-09';
const D3 = '2026-11-10';

const F1: FlightInfo = {
  airline: '진에어', flightNo: 'LJ841', depCode: 'ICN', depDate: D1, depTime: '07:20', depTz: 'Asia/Seoul', depTerminal: '',
  arrCode: 'TAO', arrDate: D1, arrTime: '08:15', arrTz: 'Asia/Shanghai', arrTerminal: '', lookupAt: null,
};
const F2: FlightInfo = {
  airline: '진에어', flightNo: 'LJ844', depCode: 'YNT', depDate: D3, depTime: '17:10', depTz: 'Asia/Shanghai', depTerminal: '',
  arrCode: 'ICN', arrDate: D3, arrTime: '19:40', arrTz: 'Asia/Seoul', arrTerminal: '', lookupAt: null,
};

export function sampleSeed(): Seed {
  return {
    bookings: [
      { key: 'f1', booking: { type: 'flight', title: '인천 → 칭다오', startDate: D1, startTime: '07:20', flight: F1 } },
      { key: 'f2', booking: { type: 'flight', title: '옌타이 → 인천', startDate: D3, startTime: '17:10', flight: F2 } },
    ],
    items: [
      // DAY 1 · 11.8(일) 칭다오
      flightRef(D1, 'f1', '07:20'),
      note(D1, '✈️ 항공 스케줄 변경사항이 자동 반영되지 않으니 반드시 항공사 공식 정보를 확인해 주세요.'),
      place(D1, '칭다오 자오둥 국제공항', 'transport', '08:15', '9시 15분에 공항 out 기준'),
      place(D1, '이하이 가든 호텔', 'stay', '10:40'),
      place(D1, '선가어수교 완샹청 점', 'food', '11:00'),
      place(D1, '헤이티 완샹청 점', 'cafe'),
      place(D1, '잔교', 'sight', '13:00', '믹스몰에서 잔교까지 택시 20분'),
      place(D1, '중산로', 'sight'),
      place(D1, '천주교 성 미카엘 대성당', 'sight', '14:30'),
      place(D1, '칭다오 맥주 박물관', 'sight', '15:30', '성당에서 박물관까지 택시 20분'),
      place(D1, '다하푸 바비큐', 'food', '16:50'),
      place(D1, '5.4 광장', 'sight', '18:40'),
      place(D1, '올림픽 요트 센터', 'sight'),
      place(D1, '이하이 가든 호텔', 'stay', '20:00'),
      // DAY 2 · 11.9(월)
      place(D2, '이하이 가든 호텔', 'stay'),
      place(D2, '완샹청', 'shop', '10:00', '밍지아딤섬, 루위'),
      place(D2, '밍지아 딤섬 칭다오 완샹청 점', 'food', '10:30'),
      place(D2, '소어산 공원', 'sight'),
      place(D2, '하이디라오훠궈 홍콩중로 점', 'food'),
      place(D2, '칭다오 카페 거리', 'sight'),
      place(D2, '칭다오 역', 'transport'),
      place(D2, '연태역', 'transport'),
      place(D2, '소청리', 'shop'),
      place(D2, '완다몰', 'shop', null, '1층 헤이티, 패왕차희'),
      place(D2, '풀만 옌타이 센터', 'stay'),
      // DAY 3 · 11.10(화)
      note(D3, '옌타이'),
      place(D3, '풀만 옌타이 센터', 'stay'),
      place(D3, '장유 와인 박물관', 'sight', '09:00'),
      place(D3, '조양가', 'sight'),
      place(D3, '이씨거다탕', 'food'),
      place(D3, '풀만 옌타이 센터', 'stay', '14:00', '2시까지 호텔 와서 짐찾고 2시 20분 전에 택시 잡' + TRUNC),
      place(D3, 'Yantai Penglai International Airport', 'transport', '15:30', '체크인이 늦는편 / 후기 참고 시 3시 40분에 체크' + TRUNC),
      flightRef(D3, 'f2', '17:10'),
    ],
  };
}

/** 날짜별 도시 (사진의 day 구성 기준) */
export const SAMPLE_DAY_CITIES: Record<string, string> = { [D1]: '칭다오', [D2]: '칭다오 → 옌타이', [D3]: '옌타이' };

import type { Currency } from './types';

/** 여행 생성 시 국가 선택 → 기본 통화·시간대 자동 제안. 대표 도시 좌표는 날씨·지도 시작 위치용(사용자가 바꿀 수 있음) */
export interface Country {
  code: string;
  name: string;
  currency: Currency;
  tz: string;
  cities: { name: string; lat: number; lng: number }[];
}

export const COUNTRIES: Country[] = [
  { code: 'CN', name: '중국', currency: 'CNY', tz: 'Asia/Shanghai', cities: [
    { name: '칭다오', lat: 36.0671, lng: 120.3826 }, { name: '옌타이', lat: 37.4638, lng: 121.4479 },
    { name: '상하이', lat: 31.2304, lng: 121.4737 }, { name: '베이징', lat: 39.9042, lng: 116.4074 },
    { name: '다롄', lat: 38.914, lng: 121.6147 }, { name: '광저우', lat: 23.1291, lng: 113.2644 } ] },
  { code: 'JP', name: '일본', currency: 'JPY', tz: 'Asia/Tokyo', cities: [
    { name: '도쿄', lat: 35.6762, lng: 139.6503 }, { name: '오사카', lat: 34.6937, lng: 135.5023 },
    { name: '후쿠오카', lat: 33.5904, lng: 130.4017 }, { name: '삿포로', lat: 43.0618, lng: 141.3545 } ] },
  { code: 'KR', name: '대한민국', currency: 'KRW', tz: 'Asia/Seoul', cities: [
    { name: '제주', lat: 33.4996, lng: 126.5312 }, { name: '부산', lat: 35.1796, lng: 129.0756 },
    { name: '강릉', lat: 37.7519, lng: 128.8761 }, { name: '서울', lat: 37.5665, lng: 126.978 } ] },
  { code: 'TW', name: '대만', currency: 'TWD', tz: 'Asia/Taipei', cities: [{ name: '타이베이', lat: 25.033, lng: 121.5654 }] },
  { code: 'HK', name: '홍콩', currency: 'HKD', tz: 'Asia/Hong_Kong', cities: [{ name: '홍콩', lat: 22.3193, lng: 114.1694 }] },
  { code: 'TH', name: '태국', currency: 'THB', tz: 'Asia/Bangkok', cities: [{ name: '방콕', lat: 13.7563, lng: 100.5018 }] },
  { code: 'VN', name: '베트남', currency: 'VND', tz: 'Asia/Ho_Chi_Minh', cities: [{ name: '다낭', lat: 16.0544, lng: 108.2022 }, { name: '하노이', lat: 21.0278, lng: 105.8342 }] },
  { code: 'SG', name: '싱가포르', currency: 'SGD', tz: 'Asia/Singapore', cities: [{ name: '싱가포르', lat: 1.3521, lng: 103.8198 }] },
  { code: 'US', name: '미국', currency: 'USD', tz: 'America/Los_Angeles', cities: [] },
  { code: 'EU', name: '유럽', currency: 'EUR', tz: 'Europe/Paris', cities: [] },
];
export const countryOf = (code: string) => COUNTRIES.find((c) => c.code === code);

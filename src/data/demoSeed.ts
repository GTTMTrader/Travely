/**
 * 미리보기(메모리 모드) 시작 데이터.
 *  - 칭다오·옌타이 여행: 사진에서 보이는 일정 그대로(좌표 없음) + '(예시)' 표시된 예약·지출·준비물·체크 항목
 *  - '지도 기능 예시' 여행: 가상 장소 이름과 임의 좌표로 지도·이동 정보 동작을 보여주기 위한 것 (실제 장소 아님)
 */
import type { AppUser } from './auth';
import { createTrip, type Seed } from './repo';
import { SAMPLE_DAY_CITIES, SAMPLE_TRIP, sampleSeed } from '../lib/sample';
import { emptyPlace, type Expense, type Item } from '../lib/types';
import { encodePolyline } from '../lib/geo';

export const DEMO_ME: AppUser = { uid: 'me', displayName: '나', email: 'demo@travely.local' };
const GF = { uid: 'gf', role: 'editor' as const, status: 'active' as const, displayName: '여자친구' };

/** 예시 e티켓 이미지 (가짜 QR 무늬, '예시' 표시) */
async function ticketImage(title: string, sub: string, color: string): Promise<{ blob: Blob; thumb: string }> {
  const c = document.createElement('canvas');
  c.width = 900;
  c.height = 1300;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, 200);
  g.fillStyle = '#fff';
  g.font = 'bold 54px sans-serif';
  g.fillText('예시 e티켓 (가짜)', 50, 120);
  g.fillStyle = '#1f1b2d';
  g.font = 'bold 64px sans-serif';
  g.fillText(title, 50, 320);
  g.font = '40px sans-serif';
  g.fillStyle = '#6e6a82';
  g.fillText(sub, 50, 390);
  // QR 비슷한 무늬
  const s = 22;
  const ox = 220;
  const oy = 480;
  let seed = title.length * 97;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  g.fillStyle = '#111';
  for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) if (rnd() > 0.5) g.fillRect(ox + x * s, oy + y * s, s, s);
  for (const [fx, fy] of [[0, 0], [14, 0], [0, 14]]) {
    g.fillStyle = '#111';
    g.fillRect(ox + fx * s, oy + fy * s, 7 * s, 7 * s);
    g.fillStyle = '#fff';
    g.fillRect(ox + (fx + 1) * s, oy + (fy + 1) * s, 5 * s, 5 * s);
    g.fillStyle = '#111';
    g.fillRect(ox + (fx + 2) * s, oy + (fy + 2) * s, 3 * s, 3 * s);
  }
  g.fillStyle = '#a5a1b8';
  g.font = '34px sans-serif';
  g.fillText('실제 예약이 아닌 화면 설명용 이미지', 120, 1100);
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
  const t = document.createElement('canvas');
  t.width = 166;
  t.height = 240;
  t.getContext('2d')!.drawImage(c, 0, 0, 166, 240);
  return { blob, thumb: t.toDataURL('image/jpeg', 0.7) };
}

const exp = (p: Partial<Expense>): Partial<Expense> => ({
  time: null, krwActual: null, krwRateDate: null, cardName: '', platform: '현장 결제', memo: '', method: 'credit', category: 'food', ...p,
});

export async function seedDemo() {
  const base = sampleSeed();
  const t1 = await ticketImage('맥주박물관 입장권', '2026-11-08 15:30 · 2매', '#7c4dff');
  const t2 = await ticketImage('칭다오 → 옌타이 기차', '2026-11-09 · 2인', '#22b39b');
  const t3 = await ticketImage('칭다오 숙소 바우처', '11/8 – 11/9 체크아웃', '#ec5d9a');
  const items = base.items!.map((x) => {
    const name = (x.item.place as { nameKo?: string } | undefined)?.nameKo;
    if (name === '칭다오 맥주 박물관')
      return { ...x, item: { ...x.item, bookingIds: ['ex-ticket'], checklist: [
        { id: 'c1', text: '(예시) 바우처 종이로 출력해서 지참', important: true, done: false },
        { id: 'c2', text: '(예시) 표 받는 곳: 입구 오른쪽 단체 매표소', important: false, done: false },
      ] } };
    if (name === 'Yantai Penglai International Airport')
      return { ...x, item: { ...x.item, checklist: [{ id: 'c3', text: '(예시) 여권 지참', important: true, done: true }] } };
    return x;
  });
  const seed: Seed = {
    ...base,
    items,
    dayCities: SAMPLE_DAY_CITIES,
    extraMembers: [GF],
    bookings: [
      ...base.bookings!,
      { key: 'ex-ticket', booking: { type: 'ticket', title: '(예시) 맥주박물관 입장권', startDate: '2026-11-08', startTime: '15:30', reservationNo: 'EX-0000-1234' }, files: [{ blob: t1.blob, name: 'ticket.png', mime: 'image/png', thumb: t1.thumb }] },
      { key: 'ex-train', booking: { type: 'transport', title: '(예시) 칭다오 → 옌타이 기차', startDate: '2026-11-09', reservationNo: 'EX-TRAIN-01' }, files: [{ blob: t2.blob, name: 'train.png', mime: 'image/png', thumb: t2.thumb }] },
      { key: 'ex-hotel', booking: { type: 'stay', title: '(예시) 칭다오 숙소', startDate: '2026-11-08', endDate: '2026-11-09', reservationNo: 'EX-HOTEL-77' }, files: [{ blob: t3.blob, name: 'hotel.png', mime: 'image/png', thumb: t3.thumb }] },
    ],
    expenses: [
      exp({ title: '(예시) 숙소 예약', date: null, category: 'stay', amount: 200000, currency: 'KRW', krwRate: 1, platform: '트립닷컴', cardName: '신한 SOL트래블', payers: { me: 200000 }, split: { mode: 'equal', shares: { me: 1, gf: 1 } } }),
      exp({ title: '(예시) 저녁 식사', date: '2026-11-08', time: '16:50', category: 'food', amount: 420, currency: 'CNY', krwRate: 190, method: 'cash', payers: { gf: 420 }, split: { mode: 'equal', shares: { me: 1, gf: 1 } } }),
      exp({ title: '(예시) 택시 이동', date: '2026-11-08', time: '15:10', category: 'transport', amount: 25, currency: 'CNY', krwRate: 190, method: 'alipay', platform: '디디(택시)', payers: { me: 25 }, split: { mode: 'equal', shares: { me: 1, gf: 1 } } }),
      exp({ title: '(예시) 내 기념품', date: '2026-11-09', category: 'shop', amount: 88, currency: 'CNY', krwRate: 190, method: 'debit', cardName: '트래블월렛', payers: { me: 88 }, split: { mode: 'equal', shares: { me: 1 } } }),
    ],
    packing: [
      { text: '여권', owner: 'me', done: true }, { text: '보조배터리', owner: 'shared', done: true }, { text: '충전기', owner: 'gf' },
      { text: '선크림', owner: 'me', done: true }, { text: '세면도구', owner: 'shared' }, { text: '경량패딩', owner: 'me' },
      { text: '상비약', owner: 'gf', done: true }, { text: '여행용 어댑터', owner: 'shared' },
    ],
  };
  await createTrip(DEMO_ME, SAMPLE_TRIP, seed, true);

  // 지도 기능 예시 (가상 장소·임의 좌표)
  const P = (n: string, lat: number, lng: number, time: string | null, memo = ''): NonNullable<Seed['items']>[number] => ({
    dayId: '2026-09-11', key: n,
    item: { kind: 'place', category: 'sight', time, memo, place: { ...emptyPlace(), nameKo: `예시 장소 ${n}`, lat, lng, coordSource: 'user' } } as Partial<Item> & Pick<Item, 'kind'>,
  });
  const mapSeed: Seed = {
    extraMembers: [GF],
    items: [
      P('A', 33.4996, 126.5312, '09:30', '(예시) 지도에서 번호·선·화살표가 어떻게 보이는지 보여주는 가상 장소예요'),
      P('B', 33.5066, 126.5235, '11:00'),
      P('C', 33.5143, 126.5401, '14:30'),
      P('A', 33.4996, 126.5312, '19:00', '(예시) 같은 곳 재방문 → 한 핀에 번호 2개'),
      { dayId: '2026-09-12', item: { kind: 'place', category: 'food', time: '10:00', place: { ...emptyPlace(), nameKo: '예시 장소 D', lat: 33.4890, lng: 126.4983, coordSource: 'user' } } },
      { dayId: '2026-09-12', item: { kind: 'place', category: 'cafe', time: null, place: { ...emptyPlace(), nameKo: '예시 장소 E (위치 미지정)' } } },
      { dayId: null, item: { kind: 'place', category: 'sight', place: { ...emptyPlace(), nameKo: '예시 후보 장소', lat: 33.5200, lng: 126.5100, coordSource: 'user' } } },
    ],
    packing: [{ text: '여권', owner: 'me' }, { text: '보조배터리', owner: 'shared' }, { text: '우산', owner: 'gf' }],
  };
  const id2 = await createTrip(DEMO_ME, {
    name: '지도 기능 예시', countryCode: 'KR', cities: [{ name: '예시 도시', lat: 33.4996, lng: 126.5312 }],
    startDate: '2026-09-11', endDate: '2026-09-12', timezone: 'Asia/Seoul', baseCurrency: 'KRW', illustration: 'island',
  }, mapSeed, true);
  // 예시 이동 정보 (A→B 는 경로 모양 예시, B→C 는 직접 입력 예시)
  const { getStore } = await import('./repo');
  const s = getStore();
  const stored = (await s.getCol(`trips/${id2}/items`)).map((d) => d.data as unknown as Item);
  const byName = (n: string, t: string | null) => stored.find((i) => i.place?.nameKo === `예시 장소 ${n}` && i.time === t)!;
  const a = byName('A', '09:30');
  const b = byName('B', '11:00');
  const c = byName('C', '14:30');
  const geom = encodePolyline([[33.4996, 126.5312], [33.5010, 126.5290], [33.5030, 126.5282], [33.5048, 126.5250], [33.5066, 126.5235]]);
  await s.batch([
    { type: 'set', path: `trips/${id2}/legs/${a.id}__${b.id}`, data: { id: `${a.id}__${b.id}`, fromId: a.id, toId: b.id, mode: 'walk', durationMin: 14, distanceM: 1100, fareAmount: null, fareCurrency: 'KRW', memo: '(예시) 경로 모양이 저장된 구간', source: 'route', geometry: geom, routedAt: Date.now(), routedFrom: '33.49960,126.53120', routedTo: '33.50660,126.52350', updatedBy: 'me', version: 1 } },
    { type: 'set', path: `trips/${id2}/legs/${b.id}__${c.id}`, data: { id: `${b.id}__${c.id}`, fromId: b.id, toId: c.id, mode: 'taxi', durationMin: 12, distanceM: null, fareAmount: 8000, fareCurrency: 'KRW', memo: '(예시) 직접 입력한 구간', source: 'manual', geometry: null, routedAt: null, routedFrom: null, routedTo: null, updatedBy: 'gf', version: 1 } },
  ]);
}

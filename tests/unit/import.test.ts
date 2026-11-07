import { describe, expect, it } from 'vitest';
import { buildImportPlan, gptPrompt, parseJsonLoose, parseMinutes, parseTime } from '../../src/lib/importPlan';
import type { Day } from '../../src/lib/types';

const days: Day[] = [
  { date: '2026-11-08', index: 0, city: '칭다오' },
  { date: '2026-11-09', index: 1, city: '' },
  { date: '2026-11-10', index: 2, city: '옌타이' },
];

describe('JSON 일정 가져오기', () => {
  it('Travely 권장 형식 그대로', () => {
    const json = JSON.parse(gptPrompt('t', days).match(/형식:\n([\s\S]*?)\n\n규칙/)![1].replace('YYYY-MM-DD', '2026-11-09'));
    const p = buildImportPlan(json, days, 'CNY');
    expect(p.total).toBe(2);
    const [a, b] = p.days[0].items;
    expect(p.days[0]).toMatchObject({ dayId: '2026-11-09', city: '도시 이름' });
    expect(a).toMatchObject({ kind: 'place', time: '09:30', category: 'sight' });
    expect(a.place).toMatchObject({ nameKo: '한국어 장소 이름', nameLocal: '현지어 이름 (예: 栈桥)', lat: null });
    expect(a.checklist.map((c) => c.text)).toEqual(['바우처 종이 지참', '여권']);
    expect(a.legToNext).toMatchObject({ mode: 'taxi', durationMin: 15, distanceM: 4200, fareAmount: 25, fareCurrency: 'CNY' });
    expect(b).toMatchObject({ kind: 'memo', time: '12:00', memo: '점심은 근처에서 자유롭게' });
  });

  it('GPT 흔한 변형: 코드블록·한국어 키·Day 번호·시간 범위·문자열 이동', () => {
    const text = '여기 일정이에요!\n```json\n{"itinerary":[{"day":"Day 1","schedule":[{"시간":"오후 2시 30분","장소":"5.4 광장","설명":"야경 명소","이동":"택시 약 15분 (25위안)"},{"시간":"18:00-19:30","장소":"양꼬치 골목","유형":"맛집"}]},{"day":2,"activities":["09:00 잔교","소어산 공원"]},],}\n```\n즐거운 여행!';
    const p = buildImportPlan(parseJsonLoose(text), days, 'CNY');
    expect(p.days.map((d) => d.dayId)).toEqual(['2026-11-08', '2026-11-09']);
    const [x, y] = p.days[0].items;
    expect(x).toMatchObject({ time: '14:30', memo: '야경 명소' });
    expect(x.legToNext).toMatchObject({ mode: 'taxi', durationMin: 15, fareAmount: 25, fareCurrency: 'CNY' });
    expect(y).toMatchObject({ time: '18:00', category: 'food' });
    expect(y.memo).toContain('~19:30');
    expect(p.days[1].items.map((i) => [i.time, i.place?.nameKo])).toEqual([['09:00', '잔교'], [null, '소어산 공원']]);
  });

  it('날짜 키 객체, 기간 밖 날짜는 후보로, 좌표는 숫자일 때만', () => {
    const p = buildImportPlan({
      '11/10': [{ name: '옌타이 산', lat: 37.54, lng: 121.4 }, { name: 'X', lat: '모름', lng: 1 }],
      '2026-11-12': [{ name: '기간 밖' }],
    }, days, 'CNY');
    expect(p.days[0].dayId).toBe('2026-11-10');
    expect(p.days[0].items[0].place).toMatchObject({ lat: 37.54, lng: 121.4, coordSource: 'user' });
    expect(p.days[0].items[1].place?.lat).toBeNull();
    expect(p.days[1]).toMatchObject({ dayId: null });
    expect(p.warnings.join()).toContain('2026-11-12');
  });

  it('잘못된 JSON 은 줄 번호와 함께 안내', () => {
    expect(() => parseJsonLoose('{ "days": [ { "date": "2026-11-08" \n "items": [] } ] }')).toThrow(/JSON 형식이 아니에요/);
    expect(() => buildImportPlan({ hello: 1 }, days, 'CNY')).toThrow(/일정 목록/);
  });

  it('시간·소요 해석', () => {
    expect(parseTime('9:05')).toBe('09:05');
    expect(parseTime('오후 12시')).toBe('12:00');
    expect(parseTime('2:30 PM')).toBe('14:30');
    expect(parseTime('오전 12시')).toBe('00:00');
    expect(parseTime('점심쯤')).toBeNull();
    expect(parseMinutes('1시간 20분')).toBe(80);
    expect(parseMinutes('25 min')).toBe(25);
  });
});

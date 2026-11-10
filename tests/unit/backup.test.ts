/**
 * 여행 백업: 형식(HTML/JSON), 첨부 원본 보존, 되살리기 쓰기가 보안 규칙의 키 목록·작성자·버전 조건을 지키는지 (에뮬레이터 없이).
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryStore } from '../../src/data/memoryStore';
import { setStore, getStore } from '../../src/data/repo';
import { SERVER_TIME, type Data, type DocStore, type Op } from '../../src/data/store';
import {
  BACKUP_SLOT, backupDocs, buildBackupHtml, fromBase64, makeBackup, parseBackup, restoreBackup, toBase64, type TravelyBackup,
} from '../../src/lib/backup';

const rules = readFileSync('firestore.rules', 'utf8');
function hasOnly(col: string): string[] {
  const start = rules.indexOf(`match /${col}/{`);
  const m = rules.slice(start).match(/hasOnly\(\[([^\]]+)\]\)/)!;
  return [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]);
}

const OLD = 'oldMe';
const GF = 'gf';
const bigFile = new Uint8Array(1_600_000).map((_, i) => (i * 7) % 251); // 3조각
const smallFile = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const T = 'tOld';
const now = 1762600000000;

function fixture(): TravelyBackup {
  const item = (id: string, dayId: string | null, order: number, extra: Data = {}) => ({
    id, data: { id, dayId, order, kind: 'place', category: 'sight', tag: '', time: '09:00', memo: '메모 </script> <b>', place: { nameKo: `장소 ${id}`, nameLocal: '', address: '', addressLocal: '', lat: 36.1, lng: 120.3, coordSource: 'manual' }, bookingIds: [], checklist: [{ id: 'c', text: '여권', important: true, done: true }], createdBy: GF, createdAt: now, updatedBy: GF, updatedAt: now, version: 7, ...extra },
  });
  return {
    format: 'travely-backup', version: 1, exportedAt: now, exportedBy: { uid: OLD, displayName: '불리' }, app: 'x', tripId: T,
    trip: { name: '칭다오 · 옌타이', countryCode: 'CN', cities: [{ name: '칭다오', lat: 36.06, lng: 120.38 }], startDate: '2026-11-08', endDate: '2026-11-10', timezone: 'Asia/Shanghai', baseCurrency: 'CNY', illustration: 'coast', ownerUid: OLD, isSample: false, createdAt: now, updatedAt: now, updatedBy: OLD },
    cols: {
      members: [
        { id: OLD, data: { uid: OLD, role: 'owner', status: 'active', displayName: '불리', joinedAt: now } },
        { id: GF, data: { uid: GF, role: 'editor', status: 'active', displayName: '여자친구', joinedAt: now, inviteToken: 'x'.repeat(40) } },
      ],
      days: ['2026-11-08', '2026-11-09', '2026-11-10'].map((d, i) => ({ id: d, data: { date: d, index: i, city: i ? '옌타이' : '칭다오' } })),
      items: [item('a', '2026-11-08', 1000, { bookingIds: ['bk'] }), item('b', '2026-11-08', 2000), item('c', null, 1000), { id: 'f', data: { ...item('f', '2026-11-10', 500).data, kind: 'flight', place: null, category: null, memo: '', bookingIds: ['fl'] } }],
      legs: [{ id: 'a__b', data: { id: 'a__b', fromId: 'a', toId: 'b', mode: 'taxi', durationMin: 15, distanceM: 4200, fareAmount: 25, fareCurrency: 'CNY', memo: '디디', source: 'route', geometry: 'abc', routedAt: now, routedFrom: '1,2', routedTo: '3,4', updatedBy: GF, updatedAt: now, version: 3 } }],
      bookings: [
        { id: 'bk', data: { id: 'bk', type: 'ticket', title: '입장권', startDate: '2026-11-08', startTime: '15:30', endDate: null, endTime: null, reservationNo: 'R1', memo: '', flight: null, fileIds: ['F1', 'F2', 'GONE'], createdBy: OLD, createdAt: now, updatedBy: OLD, updatedAt: now, version: 2 } },
        { id: 'fl', data: { id: 'fl', type: 'flight', title: '귀국', startDate: '2026-11-10', startTime: '11:00', endDate: null, endTime: null, reservationNo: '', memo: '', flight: { airline: 'SC', flightNo: 'SC4087' }, fileIds: [], createdBy: OLD, createdAt: now, updatedBy: OLD, updatedAt: now, version: 1 } },
      ],
      files: [
        { id: 'F1', data: { id: 'F1', name: 'big.pdf', mime: 'application/pdf', size: bigFile.length, pages: 2, thumb: 'data:', chunkCount: 3, complete: true, uploadedBy: GF, uploadedAt: now } },
        { id: 'F2', data: { id: 'F2', name: 'small.png', mime: 'image/png', size: smallFile.length, pages: 1, thumb: '', chunkCount: 1, complete: true, uploadedBy: OLD, uploadedAt: now } },
        { id: 'GONE', data: { id: 'GONE', name: 'half.png', mime: 'image/png', size: 9, pages: 1, thumb: '', chunkCount: 1, complete: false, uploadedBy: OLD, uploadedAt: now } },
      ],
      expenses: [
        { id: 'e1', data: { id: 'e1', title: '커피', date: '2026-11-08', time: '10:00', category: 'cafe', amount: 35, currency: 'CNY', krwRate: 190, krwRateDate: '2026-11-08', krwActual: 6700, method: 'credit', cardName: 'Mastercard 5154', platform: 'Alipay', payers: { [OLD]: 35 }, split: { mode: 'equal', shares: { [OLD]: 1, [GF]: 1 }, settled: true }, memo: '가맹점: 瑞幸 → 루이싱', createdBy: OLD, createdAt: now, updatedBy: OLD, updatedAt: now, version: 4 } },
        { id: 'e2', data: { id: 'e2', title: '택시', date: '2026-11-09', time: null, category: 'transport', amount: 20, currency: 'CNY', krwRate: 190, krwRateDate: null, krwActual: null, method: 'credit', cardName: 'UnionPay 5321', platform: 'Alipay', payers: { [GF]: 20 }, split: { mode: 'equal', shares: {} }, memo: '', createdBy: GF, createdAt: now, updatedBy: GF, updatedAt: now, version: 1 } },
      ],
      packing: [
        { id: 'p1', data: { id: 'p1', text: '여권', owner: 'shared', done: true, order: 1000, updatedBy: OLD, updatedAt: now, version: 1 } },
        { id: 'p2', data: { id: 'p2', text: '충전기', owner: OLD, done: false, order: 2000, updatedBy: OLD, updatedAt: now, version: 2 } },
        { id: 'p3', data: { id: 'p3', text: '렌즈', owner: GF, done: true, order: 3000, updatedBy: GF, updatedAt: now, version: 1 } },
      ],
    },
    files: { F1: toBase64(bigFile), F2: toBase64(smallFile) },
    missingFiles: [{ id: 'GONE', name: 'half.png', reason: '업로드 중' }],
  };
}

/** 쓰기를 모두 기록하는 저장소 */
function recording(s: DocStore) {
  const batches: Op[][] = [];
  return { batches, store: { ...s, batch: async (ops: Op[]) => { batches.push(ops); await s.batch(ops); } } as DocStore };
}

beforeEach(() => setStore(createMemoryStore({ latencyMs: 0 })));

describe('백업 형식', () => {
  it('base64 왕복', () => {
    expect([...fromBase64(toBase64(bigFile)).slice(0, 50)]).toEqual([...bigFile.slice(0, 50)]);
    expect(fromBase64(toBase64(bigFile)).length).toBe(bigFile.length);
  });
  it('HTML 에 넣고 다시 읽기: 데이터 자리, </script> 가 들어 있어도 안 끊김', () => {
    const viewer = `<html><head><title>Travely 백업 보기</title></head><body>${BACKUP_SLOT}<div id="root"></div><script type="module">const s="${'<\\!--TRAVELY_BACKUP_SLOT-->'}"</script></body></html>`;
    const html = buildBackupHtml(viewer, fixture());
    expect(html).toContain('<title>칭다오 · 옌타이 · Travely 백업</title>');
    expect(html.indexOf('id="travely-backup"')).toBeLessThan(html.indexOf('id="root"'));
    expect(html.match(/<\/script>/g)!.length).toBe(2); // 데이터 안의 </script> 는 < 로
    const b = parseBackup(html);
    expect(b.cols.items[0].data.memo).toBe('메모 </script> <b>');
    expect(b.files.F1).toBe(fixture().files.F1);
    expect(parseBackup(JSON.stringify(fixture())).tripId).toBe(T);
  });
  it('다른 파일은 거부', () => {
    expect(() => parseBackup('<html>hi</html>')).toThrow('Travely 백업 파일이 아니에요');
    expect(() => parseBackup('{"a":1}')).toThrow('Travely 백업 파일이 아니에요');
  });
  it('백업 보기용 문서: 첨부 조각 700KB 단위, 받지 못한 파일은 미완료', () => {
    const docs = backupDocs(fixture(), (u) => u);
    const chunks = docs.filter((d) => d.path.includes('/chunks/'));
    expect(chunks.map((c) => c.path.split('/').slice(-3).join('/'))).toEqual(['F1/chunks/0000', 'F1/chunks/0001', 'F1/chunks/0002', 'F2/chunks/0000']);
    expect(docs.find((d) => d.path.endsWith('/files/GONE'))!.data.complete).toBe(false);
  });
});

describe('되살리기 → 보안 규칙 조건', () => {
  it('모든 쓰기가 규칙의 키 목록·작성자·버전·조각 크기를 지키고, 다시 백업하면 같은 내용', async () => {
    const rec = recording(getStore());
    setStore(rec.store);
    const me = { uid: 'newMe', displayName: '불리' };
    const id = await restoreBackup(me, fixture());
    const ops = rec.batches.flat();
    const sets = ops.filter((o): o is Extract<Op, { type: 'set' }> => o.type === 'set');
    const col = (p: string) => p.split('/')[2];
    const keysOk = (c: string, d: Data) => Object.keys(d).filter((k) => !hasOnly(c).includes(k));

    for (const b of rec.batches) expect(b.length).toBeLessThanOrEqual(500);
    for (const o of sets) {
      const parts = o.path.split('/');
      if (parts.length === 2) continue; // 여행 문서 (createTrip — 기존 코드)
      const c = col(o.path);
      if (parts.length === 6) {
        // 첨부 조각
        expect(Object.keys(o.data).sort()).toEqual(['data', 'n']);
        expect((o.data.data as Uint8Array).length).toBeLessThanOrEqual(750000);
        expect(parts[5]).toMatch(/^\d{4}$/);
        continue;
      }
      expect(keysOk(c === 'members' ? 'members' : c, o.data), `${o.path} 허용 안 된 키`).toEqual([]);
      if (['items', 'bookings', 'expenses'].includes(c)) {
        expect(o.data).toMatchObject({ createdBy: 'newMe', createdAt: SERVER_TIME, updatedBy: 'newMe', updatedAt: SERVER_TIME, version: 1, id: parts[3] });
      }
      if (['legs', 'packing'].includes(c)) expect(o.data).toMatchObject({ updatedBy: 'newMe', updatedAt: SERVER_TIME, version: 1 });
      if (c === 'legs') expect(parts[3]).toBe(`${o.data.fromId}__${o.data.toId}`);
      if (c === 'packing') expect(['shared', 'newMe']).toContain(o.data.owner);
      if (c === 'files') expect(o.data).toMatchObject({ uploadedBy: 'newMe', uploadedAt: SERVER_TIME, complete: false });
      if (c === 'members') expect(o.data).toMatchObject({ uid: 'newMe', role: 'owner' });
      if (c === 'items' && o.data.dayId) expect(['2026-11-08', '2026-11-09', '2026-11-10']).toContain(o.data.dayId);
    }
    // 파일 메타는 조각보다 먼저, 완료 표시는 마지막
    const order = ops.map((o) => o.path);
    expect(order.indexOf(`trips/${id}/files/F1`)).toBeLessThan(order.indexOf(`trips/${id}/files/F1/chunks/0000`));
    expect(ops.filter((o) => o.type === 'update').every((o) => Object.keys((o as { data: Data }).data).join() === 'complete')).toBe(true);
    // 다른 사람 멤버 문서는 만들지 않음
    expect(sets.filter((o) => o.path.includes('/members/')).map((o) => o.path)).toEqual([`trips/${id}/members/newMe`]);

    // 다시 백업 → 내용 비교
    const again = await makeBackup(id, me);
    expect(again.missingFiles).toEqual([]);
    expect(again.files).toEqual({ F1: fixture().files.F1, F2: fixture().files.F2 });
    expect(again.cols.items.length).toBe(4);
    expect(again.cols.legs.length).toBe(1);
    expect(again.cols.days.map((d) => d.data.city)).toEqual(['칭다오', '옌타이', '옌타이']);
    const bk = again.cols.bookings.find((b) => b.id === 'bk')!.data;
    expect(bk.fileIds).toEqual(['F1', 'F2']); // 담지 못한 파일 연결은 뺌
    const e1 = again.cols.expenses.find((e) => e.id === 'e1')!.data;
    expect(e1.payers).toEqual({ newMe: 35 });
    expect(e1.split).toEqual({ mode: 'equal', shares: { newMe: 1, [GF]: 1 }, settled: true });
    expect(e1).toMatchObject({ cardName: 'Mastercard 5154', platform: 'Alipay', krwActual: 6700, memo: '가맹점: 瑞幸 → 루이싱' });
    const e2 = again.cols.expenses.find((e) => e.id === 'e2')!.data;
    expect(e2.payers).toEqual({ [GF]: 20 }); // 여자친구가 같은 계정으로 다시 들어오면 그대로 이어짐
    const p = Object.fromEntries(again.cols.packing.map((x) => [x.id, x.data]));
    expect(p.p2).toMatchObject({ owner: 'newMe', text: '충전기' });
    expect(p.p3).toMatchObject({ owner: 'shared', text: '(여자친구) 렌즈', done: true });
    const it = again.cols.items.find((x) => x.id === 'a')!.data;
    expect(it).toMatchObject({ bookingIds: ['bk'], checklist: [{ id: 'c', text: '여권', important: true, done: true }], order: 1000, time: '09:00' });
  });

  it('긴 여행(20일): 한 묶음에 서로 다른 날짜 10개 이하 (규칙 조회 한도)', async () => {
    const b = fixture();
    const dates = Array.from({ length: 20 }, (_, i) => `2026-12-${String(i + 1).padStart(2, '0')}`);
    b.trip = { ...b.trip, startDate: dates[0], endDate: dates[19] };
    b.cols.days = dates.map((d, i) => ({ id: d, data: { date: d, index: i, city: '' } }));
    b.cols.items = dates.flatMap((d, i) => [0, 1, 2].map((k) => ({ id: `i${i}_${k}`, data: { ...b.cols.items[1].data, id: `i${i}_${k}`, dayId: d, order: k * 1000 } })));
    b.cols.legs = [];
    const rec = recording(getStore());
    setStore(rec.store);
    const id = await restoreBackup({ uid: 'newMe', displayName: '불리' }, b);
    for (const batch of rec.batches) {
      const days = new Set(batch.filter((o) => o.type === 'set' && o.path.includes('/items/')).map((o) => (o as { data: Data }).data.dayId));
      expect(days.size).toBeLessThanOrEqual(10);
    }
    expect((await makeBackup(id, { uid: 'newMe', displayName: '불리' })).cols.items.length).toBe(60);
  });
});

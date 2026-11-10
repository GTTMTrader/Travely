/**
 * 백업 되살리기가 실제 보안 규칙을 통과하는지 (Firestore 에뮬레이터, 앱의 restoreBackup 코드 그대로 사용).
 * 백업 원본: e2e/backup.spec.ts 가 만든 test-results/backup/trip-backup.json (없으면 건너뜀)
 * (미검증: 작업 환경에서 에뮬레이터를 내려받을 수 없어 아직 실행해 보지 못함. 같은 조건은 tests/unit/backup.test.ts 가 정적으로 검사)
 */
import { existsSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { createFirebaseStore } from '../../src/data/firebaseStore';
import { setStore } from '../../src/data/repo';
import { makeBackup, parseBackup, restoreBackup, BACKUP_COLS } from '../../src/lib/backup';

const SRC = 'test-results/backup/trip-backup.json';
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-travely', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
  await env.clearFirestore();
});
afterAll(async () => env?.cleanup());

describe.skipIf(!existsSync(SRC))('백업 되살리기 (실제 규칙)', () => {
  it('다른 계정으로 되살려도 규칙 통과, 내용·첨부 그대로', async () => {
    const b = parseBackup(readFileSync(SRC, 'utf8'));
    const db = env.authenticatedContext('restorer').firestore() as unknown as Firestore;
    setStore(createFirebaseStore(db));
    const me = { uid: 'restorer', displayName: '불리' };
    const id = await restoreBackup(me, b);

    // 되살린 여행을 다시 백업해서 비교
    const again = await makeBackup(id, me);
    expect(again.missingFiles).toEqual([]);
    for (const c of BACKUP_COLS) {
      if (c === 'members') continue;
      expect(again.cols[c].length, c).toBe(b.cols[c].length);
    }
    expect(again.cols.members.map((m) => m.id)).toEqual(['restorer']);
    // 첨부 원본 바이트 동일
    expect(Object.keys(again.files).sort()).toEqual(Object.keys(b.files).sort());
    for (const k of Object.keys(b.files)) expect(again.files[k]).toBe(b.files[k]);
    // 일정·가계부 내용 동일 (작성자/시각 제외)
    const strip = (d: Record<string, unknown>) => {
      const { createdBy, createdAt, updatedBy, updatedAt, version, ...rest } = d;
      void createdBy; void createdAt; void updatedBy; void updatedAt; void version;
      return rest;
    };
    const byId = (l: { id: string; data: Record<string, unknown> }[]) => Object.fromEntries(l.map((d) => [d.id, strip(d.data)]));
    expect(byId(again.cols.items)).toEqual(byId(b.cols.items));
    expect(byId(again.cols.legs)).toEqual(byId(b.cols.legs));
    expect(byId(again.cols.bookings)).toEqual(byId(b.cols.bookings));
    const exp = (l: typeof b.cols.expenses) =>
      Object.fromEntries(l.map((d) => [d.id, { ...strip(d.data), payers: undefined, split: undefined, amount: d.data.amount }]));
    expect(exp(again.cols.expenses)).toEqual(exp(b.cols.expenses));
    // 백업한 사람 몫 → 되살린 사람에게
    const orig = b.cols.expenses.find((e) => Object.keys(e.data.payers as object).includes(b.exportedBy.uid))!;
    const moved = again.cols.expenses.find((e) => e.id === orig.id)!;
    expect(Object.keys(moved.data.payers as object)).toContain('restorer');
    expect(again.trip.name).toBe(b.trip.name);
  }, 120_000);
});

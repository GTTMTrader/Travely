/**
 * 보안 규칙 테스트 (Firestore 에뮬레이터 필요):  npm run test:rules
 * 화면에서 버튼을 숨기는 것과 별개로, 서버가 직접 거부하는지 확인한다.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Bytes, Timestamp, collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';

let env: RulesTestEnvironment;
const T = 'trip1';
const TOKEN = 'A'.repeat(43);
const DAY = '2026-11-08';

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-travely', firestore: { rules: readFileSync('firestore.rules', 'utf8') } });
});
afterAll(async () => env?.cleanup());

const tripData = (owner: string) => ({
  name: '칭다오', countryCode: 'CN', cities: [{ name: '칭다오', lat: 36.06, lng: 120.38 }], startDate: DAY, endDate: '2026-11-10',
  timezone: 'Asia/Shanghai', baseCurrency: 'CNY', illustration: 'temple', ownerUid: owner, isSample: false,
});
const itemData = (uid: string, over: Record<string, unknown> = {}) => ({
  id: 'i1', dayId: DAY, order: 1000, kind: 'place', category: 'sight', tag: '', time: '09:30', memo: '', place: { nameKo: '잔교', lat: null, lng: null },
  bookingIds: [], checklist: [], createdBy: uid, createdAt: serverTimestamp(), updatedBy: uid, updatedAt: serverTimestamp(), version: 1, ...over,
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `trips/${T}`), { ...tripData('owner'), createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: 'owner' });
    for (const [uid, role] of [['owner', 'owner'], ['ed', 'editor'], ['vw', 'viewer']]) {
      await setDoc(doc(db, `trips/${T}/members/${uid}`), { uid, role, status: 'active', displayName: uid, joinedAt: serverTimestamp() });
    }
    await setDoc(doc(db, `trips/${T}/days/${DAY}`), { date: DAY, index: 0, city: '칭다오' });
    await setDoc(doc(db, `trips/${T}/items/i1`), { ...itemData('owner'), createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
    await setDoc(doc(db, `trips/${T}/invites/${TOKEN}`), {
      role: 'editor', revoked: false, createdBy: 'owner', createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 86400000), tripName: '칭다오', inviterName: 'owner',
    });
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();

describe('여행 만들기', () => {
  it('여행 + 내 owner 멤버를 한 묶음으로 만들면 성공', async () => {
    const db = as('newbie');
    const b = writeBatch(db);
    b.set(doc(db, 'trips/t2'), { ...tripData('newbie'), createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: 'newbie' });
    b.set(doc(db, 'trips/t2/members/newbie'), { uid: 'newbie', role: 'owner', status: 'active', displayName: 'n', joinedAt: serverTimestamp() });
    await assertSucceeds(b.commit());
  });
  it('멤버 문서 없이 여행만 만들기 / 남을 주인으로 만들기 → 거부', async () => {
    const db = as('newbie');
    await assertFails(setDoc(doc(db, 'trips/t3'), { ...tripData('newbie'), createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: 'newbie' }));
    await assertFails(setDoc(doc(db, 'trips/t4/members/newbie'), { uid: 'newbie', role: 'owner', status: 'active', displayName: 'n', joinedAt: serverTimestamp() }));
  });
});

describe('읽기 권한', () => {
  it('멤버만 읽기, 외부인 거부', async () => {
    await assertSucceeds(getDoc(doc(as('vw'), `trips/${T}/items/i1`)));
    await assertFails(getDoc(doc(as('stranger'), `trips/${T}`)));
    await assertFails(getDocs(collection(as('stranger'), `trips/${T}/items`)));
  });
  it('내 여행 목록: 내 uid 멤버 문서만 컬렉션 그룹 조회', async () => {
    await assertSucceeds(getDocs(query(collectionGroup(as('ed'), 'members'), where('uid', '==', 'ed'))));
    await assertFails(getDocs(query(collectionGroup(as('ed'), 'members'), where('uid', '==', 'owner'))));
  });
});

describe('일정 쓰기', () => {
  it('보기 권한은 쓰기 거부, 편집자는 가능', async () => {
    await assertFails(setDoc(doc(as('vw'), `trips/${T}/items/i2`), itemData('vw', { id: 'i2' })));
    await assertSucceeds(setDoc(doc(as('ed'), `trips/${T}/items/i2`), itemData('ed', { id: 'i2' })));
  });
  it('후보 장소(dayId null) 허용, 없는 날짜 거부', async () => {
    await assertSucceeds(setDoc(doc(as('ed'), `trips/${T}/items/c1`), itemData('ed', { id: 'c1', dayId: null })));
    await assertFails(setDoc(doc(as('ed'), `trips/${T}/items/c2`), itemData('ed', { id: 'c2', dayId: '2030-01-01' })));
  });
  it('version +1 만 허용 (낡은 화면 덮어쓰기 차단)', async () => {
    const ref = doc(as('ed'), `trips/${T}/items/i1`);
    await assertFails(updateDoc(ref, { memo: 'x', version: 1, updatedBy: 'ed', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { memo: 'x', version: 2, updatedBy: 'ed', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { memo: 'y', version: 2, updatedBy: 'ed', updatedAt: serverTimestamp() }));
  });
  it('항공편 카드는 예약 연결 필수, 체크 항목 40개 제한', async () => {
    await assertFails(setDoc(doc(as('ed'), `trips/${T}/items/f1`), itemData('ed', { id: 'f1', kind: 'flight', place: null })));
    const many = Array.from({ length: 41 }, (_, i) => ({ id: `c${i}`, text: 't', important: false, done: false }));
    await assertFails(setDoc(doc(as('ed'), `trips/${T}/items/i3`), itemData('ed', { id: 'i3', checklist: many })));
  });
});

describe('이동 정보·가계부·준비물', () => {
  const legData = (id: string, fromId: string, toId: string) => ({
    id, fromId, toId, mode: 'taxi', durationMin: 18, distanceM: 5200, fareAmount: 25, fareCurrency: 'CNY', memo: '', source: 'manual',
    geometry: null, routedAt: null, routedFrom: null, routedTo: null, updatedBy: 'ed', updatedAt: serverTimestamp(), version: 1,
  });
  it('이동 정보 문서 ID 는 출발__도착', async () => {
    await assertSucceeds(setDoc(doc(as('ed'), `trips/${T}/legs/a__b`), legData('a__b', 'a', 'b')));
    await assertFails(setDoc(doc(as('ed'), `trips/${T}/legs/zz`), legData('zz', 'a', 'b')));
  });
  it('지출: 형식 검사', async () => {
    const e = {
      id: 'e1', title: '저녁', date: DAY, time: null, category: 'food', amount: 120, currency: 'CNY', krwRate: 190.5, krwRateDate: DAY, krwActual: null,
      method: 'credit', cardName: '트래블월렛', platform: '', payers: { ed: 120 }, split: { mode: 'equal', shares: { ed: 1, owner: 1 } }, memo: '',
      createdBy: 'ed', createdAt: serverTimestamp(), updatedBy: 'ed', updatedAt: serverTimestamp(), version: 1,
    };
    await assertSucceeds(setDoc(doc(as('ed'), `trips/${T}/expenses/e1`), e));
    await assertFails(setDoc(doc(as('ed'), `trips/${T}/expenses/e2`), { ...e, id: 'e2', currency: 'BTC' }));
    await assertFails(setDoc(doc(as('ed'), `trips/${T}/expenses/e3`), { ...e, id: 'e3', amount: -1 }));
    await assertFails(setDoc(doc(as('vw'), `trips/${T}/expenses/e4`), { ...e, id: 'e4', createdBy: 'vw', updatedBy: 'vw' }));
  });
  it('준비물 담당자는 멤버 또는 공동', async () => {
    const p = { text: '보조배터리', owner: 'shared', done: false, order: 1000, updatedBy: 'ed', updatedAt: serverTimestamp(), version: 1 };
    await assertSucceeds(setDoc(doc(as('ed'), `trips/${T}/packing/p1`), p));
    await assertFails(setDoc(doc(as('ed'), `trips/${T}/packing/p2`), { ...p, owner: 'nobody' }));
  });
});

describe('첨부 파일 조각', () => {
  const meta = { id: 'f1', name: 'a.pdf', mime: 'application/pdf', size: 1000, pages: 1, thumb: '', chunkCount: 1, complete: false, uploadedBy: 'ed', uploadedAt: serverTimestamp() };
  it('메타 → 조각 → 완료 순서 허용, 메타 없는 조각·큰 조각·덮어쓰기 거부', async () => {
    const db = as('ed');
    await assertFails(setDoc(doc(db, `trips/${T}/files/f9/chunks/0000`), { n: 0, data: Bytes.fromUint8Array(new Uint8Array(10)) }));
    await assertSucceeds(setDoc(doc(db, `trips/${T}/files/f1`), meta));
    await assertSucceeds(setDoc(doc(db, `trips/${T}/files/f1/chunks/0000`), { n: 0, data: Bytes.fromUint8Array(new Uint8Array(1000)) }));
    await assertFails(setDoc(doc(db, `trips/${T}/files/f1/chunks/0000`), { n: 0, data: Bytes.fromUint8Array(new Uint8Array(5)) }));
    await assertFails(setDoc(doc(db, `trips/${T}/files/f1/chunks/0001`), { n: 1, data: Bytes.fromUint8Array(new Uint8Array(760000)) }));
    await assertSucceeds(updateDoc(doc(db, `trips/${T}/files/f1`), { complete: true }));
    await assertFails(updateDoc(doc(db, `trips/${T}/files/f1`), { name: 'b.pdf' }));
  });
});

describe('초대·멤버', () => {
  const join = (uid: string, role = 'editor', token = TOKEN) =>
    setDoc(doc(as(uid), `trips/${T}/members/${uid}`), { uid, role, status: 'active', displayName: uid, joinedAt: serverTimestamp(), inviteToken: token });
  it('유효한 초대로 그 권한 그대로만 참여', async () => {
    await assertFails(join('gf', 'viewer'));
    await assertFails(join('gf', 'editor', 'B'.repeat(43)));
    await assertSucceeds(join('gf'));
  });
  it('폐기·만료된 초대 거부', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), `trips/${T}/invites/${TOKEN}`), { revoked: true });
    });
    await assertFails(join('gf'));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), `trips/${T}/invites/${TOKEN}`), { revoked: false, expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    });
    await assertFails(join('gf'));
  });
  it('초대 링크는 주인만 만들기, 토큰 아는 사람은 1건 조회', async () => {
    const inv = { role: 'editor', revoked: false, createdBy: 'ed', createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 86400000), tripName: '칭다오', inviterName: 'ed' };
    await assertFails(setDoc(doc(as('ed'), `trips/${T}/invites/${'C'.repeat(43)}`), inv));
    await assertSucceeds(setDoc(doc(as('owner'), `trips/${T}/invites/${'C'.repeat(43)}`), { ...inv, createdBy: 'owner', inviterName: 'owner' }));
    await assertSucceeds(getDoc(doc(as('stranger'), `trips/${T}/invites/${TOKEN}`)));
    await assertFails(getDocs(collection(as('stranger'), `trips/${T}/invites`)));
  });
  it('스스로 권한 올리기 거부, 주인이 내보내면 읽기 불가', async () => {
    await assertFails(updateDoc(doc(as('vw'), `trips/${T}/members/vw`), { role: 'editor' }));
    await assertSucceeds(updateDoc(doc(as('owner'), `trips/${T}/members/vw`), { status: 'removed', removedAt: serverTimestamp() }));
    await assertFails(getDoc(doc(as('vw'), `trips/${T}/items/i1`)));
  });
  it('편집자는 여행 삭제 불가, 주인은 가능', async () => {
    await assertFails(deleteDoc(doc(as('ed'), `trips/${T}`)));
    await assertSucceeds(deleteDoc(doc(as('owner'), `trips/${T}`)));
  });
});

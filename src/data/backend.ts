/**
 * 실행 모드 선택.
 *  - firebase (기본): 실제 앱. .env 의 Firebase 설정 필요
 *  - memory (VITE_DATA_MODE=memory): 서버 없이 같은 화면을 메모리 데이터로 실행 (미리보기·화면 테스트)
 *  - archive (VITE_DATA_MODE=archive): 여행 백업 보기. 백업 파일 안의 데이터를 메모리에 올려 읽기 전용으로 띄움
 */
import { setStore } from './repo';
import type { AuthAdapter } from './auth';
import { PermissionError, type DocStore } from './store';

const MODE = import.meta.env.VITE_DATA_MODE;
export const DATA_MODE: 'firebase' | 'memory' | 'archive' = MODE === 'memory' ? 'memory' : MODE === 'archive' ? 'archive' : 'firebase';
export const isDemo = DATA_MODE === 'memory';
export const isArchive = DATA_MODE === 'archive';

/** 백업 보기에서 열린 백업 정보 */
export let archiveInfo: { tripId: string; exportedAt: number; exportedBy: string; missing: number } | null = null;

let auth: AuthAdapter | null = null;
let ready: Promise<{ ok: boolean; reason?: string }> | null = null;

export function getAuth(): AuthAdapter {
  if (!auth) throw new Error('backend not ready');
  return auth;
}

/** 쓰기를 모두 막은 저장소 (백업은 읽기 전용) */
function readOnly(s: DocStore): DocStore {
  const deny = async () => {
    throw new PermissionError('백업 보기는 읽기 전용이에요');
  };
  return { ...s, batch: deny, transaction: deny };
}

export function initBackend(): Promise<{ ok: boolean; reason?: string }> {
  if (ready) return ready;
  ready = (async () => {
    if (DATA_MODE === 'archive') {
      const { createMemoryStore } = await import('./memoryStore');
      const { createMemoryAuth } = await import('./auth');
      const { parseBackup, backupDocs, loadStashedBackupText, BACKUP_SCRIPT_ID } = await import('../lib/backup');
      const embedded = document.getElementById(BACKUP_SCRIPT_ID)?.textContent;
      const text = embedded || (await loadStashedBackupText());
      if (!text) return { ok: false, reason: 'archive-empty' };
      let b;
      try {
        b = parseBackup(text);
      } catch (e) {
        return { ok: false, reason: `archive-bad:${(e as Error).message}` };
      }
      const s = createMemoryStore({ latencyMs: 0 });
      await s.batch(backupDocs(b, s.bytes).map((d) => ({ type: 'set' as const, path: d.path, data: d.data })));
      setStore(readOnly(s));
      auth = createMemoryAuth({ uid: b.exportedBy.uid, displayName: b.exportedBy.displayName, email: '' });
      archiveInfo = { tripId: b.tripId, exportedAt: b.exportedAt, exportedBy: b.exportedBy.displayName, missing: b.missingFiles.length };
      return { ok: true };
    }
    if (DATA_MODE === 'memory') {
      const { createMemoryStore } = await import('./memoryStore');
      const { createMemoryAuth } = await import('./auth');
      const { seedDemo, DEMO_ME } = await import('./demoSeed');
      const s = createMemoryStore({ latencyMs: 150 });
      setStore(s);
      auth = createMemoryAuth(DEMO_ME);
      await seedDemo();
      return { ok: true };
    }
    const { firebaseConfigured, getDb } = await import('../lib/firebase');
    if (!firebaseConfigured) return { ok: false, reason: 'config' };
    const { createFirebaseStore } = await import('./firebaseStore');
    const { createFirebaseAuth } = await import('./auth');
    setStore(createFirebaseStore(getDb()));
    auth = await createFirebaseAuth();
    return { ok: true };
  })();
  return ready;
}

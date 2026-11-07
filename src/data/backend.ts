/**
 * 실행 모드 선택.
 *  - firebase (기본): 실제 앱. .env 의 Firebase 설정 필요
 *  - memory (VITE_DATA_MODE=memory): 서버 없이 같은 화면을 메모리 데이터로 실행 (미리보기·화면 테스트)
 */
import { setStore } from './repo';
import type { AuthAdapter } from './auth';

export const DATA_MODE: 'firebase' | 'memory' = import.meta.env.VITE_DATA_MODE === 'memory' ? 'memory' : 'firebase';
export const isDemo = DATA_MODE === 'memory';

let auth: AuthAdapter | null = null;
let ready: Promise<{ ok: boolean; reason?: string }> | null = null;

export function getAuth(): AuthAdapter {
  if (!auth) throw new Error('backend not ready');
  return auth;
}

export function initBackend(): Promise<{ ok: boolean; reason?: string }> {
  if (ready) return ready;
  ready = (async () => {
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

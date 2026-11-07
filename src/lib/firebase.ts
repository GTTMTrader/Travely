import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import {
  initializeFirestore,
  connectFirestoreEmulator,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  type Firestore,
} from 'firebase/firestore';

const env = import.meta.env;

export const firebaseConfigured = Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID);
export const usingEmulator = env.VITE_USE_EMULATOR === 'true';

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
let db: Firestore | undefined;

function canUseIndexedDb(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

if (firebaseConfigured) {
  app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  });
  auth = getAuth(app);
  // 오프라인 열람: 한 번 열어 본 여행은 IndexedDB 에 남아 네트워크 없이도 보인다.
  db = initializeFirestore(app, {
    localCache: canUseIndexedDb()
      ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
      : memoryLocalCache(),
  });
  if (usingEmulator) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
}

export function getDb(): Firestore {
  if (!db) throw new Error('Firebase 설정이 없습니다.');
  return db;
}
export function getAuthInstance(): Auth {
  if (!auth) throw new Error('Firebase 설정이 없습니다.');
  return auth;
}

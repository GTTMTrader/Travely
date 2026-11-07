import type { Unsub } from './store';

export interface AppUser {
  uid: string;
  displayName: string;
  email: string;
}

export interface AuthAdapter {
  onUser(cb: (u: AppUser | null) => void): Unsub;
  current(): AppUser | null;
  signIn(email: string, pw: string): Promise<void>;
  signUp(name: string, email: string, pw: string): Promise<void>;
  signInGoogle(): Promise<void>;
  signOut(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  /** 중계 서버 호출용 로그인 토큰 */
  idToken(): Promise<string | null>;
  updateName(name: string): Promise<void>;
}

export async function createFirebaseAuth(): Promise<AuthAdapter> {
  const fa = await import('firebase/auth');
  const { getAuthInstance } = await import('../lib/firebase');
  const auth = getAuthInstance();
  const map = (u: import('firebase/auth').User | null): AppUser | null =>
    u ? { uid: u.uid, displayName: (u.displayName || u.email?.split('@')[0] || '여행자').slice(0, 40), email: u.email ?? '' } : null;
  return {
    onUser: (cb) => fa.onAuthStateChanged(auth, (u) => cb(map(u))),
    current: () => map(auth.currentUser),
    signIn: async (e, p) => void (await fa.signInWithEmailAndPassword(auth, e, p)),
    signUp: async (name, e, p) => {
      const c = await fa.createUserWithEmailAndPassword(auth, e, p);
      await fa.updateProfile(c.user, { displayName: name || e.split('@')[0] });
      await c.user.reload();
      await auth.updateCurrentUser(auth.currentUser);
    },
    signInGoogle: async () => {
      const provider = new fa.GoogleAuthProvider();
      try {
        await fa.signInWithPopup(auth, provider);
      } catch (err) {
        const code = (err as { code?: string }).code ?? '';
        if (code.includes('popup-blocked') || code.includes('operation-not-supported')) await fa.signInWithRedirect(auth, provider);
        else throw err;
      }
    },
    signOut: () => fa.signOut(auth),
    resetPassword: (e) => fa.sendPasswordResetEmail(auth, e),
    idToken: async () => (auth.currentUser ? auth.currentUser.getIdToken() : null),
    updateName: async (name) => {
      if (auth.currentUser) await fa.updateProfile(auth.currentUser, { displayName: name });
    },
  };
}

/** 미리보기용: 항상 '나'로 로그인된 상태 */
export function createMemoryAuth(user: AppUser): AuthAdapter {
  let cur: AppUser | null = user;
  const subs = new Set<(u: AppUser | null) => void>();
  const emit = () => subs.forEach((f) => f(cur));
  return {
    onUser: (cb) => {
      subs.add(cb);
      queueMicrotask(() => cb(cur));
      return () => subs.delete(cb);
    },
    current: () => cur,
    signIn: async () => {
      cur = user;
      emit();
    },
    signUp: async () => {
      cur = user;
      emit();
    },
    signInGoogle: async () => {
      cur = user;
      emit();
    },
    signOut: async () => {
      cur = null;
      emit();
    },
    resetPassword: async () => undefined,
    idToken: async () => null,
    updateName: async (name) => {
      cur = { ...user, displayName: name };
      emit();
    },
  };
}

import { useSyncExternalStore } from 'react';

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving'; label: string }
  | { kind: 'saved'; at: number }
  | { kind: 'error'; message: string }
  | { kind: 'conflict'; message: string };

let state: SaveState = { kind: 'idle' };
let pending = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function setSaveState(s: SaveState) {
  state = s;
  emit();
}

export class ConflictError extends Error {
  constructor(public server: unknown, message = '다른 사람이 먼저 수정했어요') {
    super(message);
  }
}

export function describeError(e: unknown): string {
  const code = String((e as { code?: unknown })?.code ?? '');
  if (e instanceof ConflictError) return e.message;
  if (code.includes('permission-denied')) return '권한이 없어 서버가 저장을 거부했어요';
  if (code.includes('unavailable') || code.includes('deadline')) return '서버에 연결할 수 없어 저장하지 못했어요';
  if ((e as Error)?.message === 'timeout') return '응답이 없어 저장하지 못했어요 (연결 확인)';
  return `저장 실패: ${(e as Error)?.message ?? String(e)}`;
}

function withTimeout<T>(p: Promise<T>, ms = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/** 모든 쓰기를 이 함수로 감싸 저장 중/완료/실패/충돌 상태를 화면에 알린다 */
export async function track<T>(label: string, fn: () => Promise<T>, timeoutMs = 15000): Promise<T> {
  pending++;
  setSaveState({ kind: 'saving', label });
  try {
    const v = await withTimeout(fn(), timeoutMs);
    pending--;
    if (pending === 0) setSaveState({ kind: 'saved', at: Date.now() });
    return v;
  } catch (e) {
    pending = Math.max(0, pending - 1);
    setSaveState(e instanceof ConflictError ? { kind: 'conflict', message: e.message } : { kind: 'error', message: describeError(e) });
    throw e;
  }
}

export function useSaveState(): SaveState {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => state,
  );
}

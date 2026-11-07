import { useEffect, useState } from 'react';
import { setSaveState, useSaveState } from '../lib/saveStatus';
import { formatDateTime } from '../lib/time';
import { isDemo } from '../data/backend';

/** 제목 아래 얇은 상태 줄: 저장 중/완료/실패/충돌, 오프라인·서버 미연결·마지막 동기화 */
export default function StatusLine({ online, live, lastSync, viewer }: { online: boolean; live: boolean; lastSync: number | null; viewer: boolean }) {
  const save = useSaveState();
  const [stuck, setStuck] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    if (live || !online) return setStuck(false);
    const t = setTimeout(() => setStuck(true), 8000);
    return () => clearTimeout(t);
  }, [live, online]);
  useEffect(() => {
    if (save.kind !== 'saved') return;
    const t = setTimeout(() => tick((n) => n + 1), 2500);
    return () => clearTimeout(t);
  }, [save]);

  const last = lastSync ? `마지막 동기화 ${formatDateTime(lastSync)}` : '동기화 기록 없음';
  let cls = '';
  let text: string;
  let close = false;
  if (save.kind === 'error') {
    cls = 'err';
    text = `저장 실패 · ${save.message}`;
    close = true;
  } else if (save.kind === 'conflict') {
    cls = 'warn';
    text = `충돌 · ${save.message}`;
    close = true;
  } else if (!online) {
    cls = 'warn';
    text = `오프라인 · ${last} · 보기만 가능`;
  } else if (!live) {
    cls = 'warn';
    text = stuck ? `서버 연결 안 됨 · ${last} · 보기만 가능` : '서버 연결 중…';
  } else if (save.kind === 'saving') {
    cls = 'saving';
    text = `${save.label}…`;
  } else if (save.kind === 'saved' && Date.now() - save.at < 2500) {
    text = isDemo ? '반영됨 (미리보기)' : '저장 완료 · 친구 화면에도 반영돼요';
  } else {
    text = isDemo ? '미리보기 · 이 기기에서만' : viewer ? '실시간 연결 · 보기 전용' : '실시간 공동 편집 중';
  }
  return (
    <div className={`status-line ${cls}`} role="status" aria-live="polite" data-testid="status">
      <span className="dot" />
      <span className="ellipsis">{text}</span>
      {close && (
        <button className="btn ghost sm" style={{ minHeight: 22, padding: '0 6px', fontSize: 12 }} onClick={() => setSaveState({ kind: 'idle' })}>닫기</button>
      )}
    </div>
  );
}

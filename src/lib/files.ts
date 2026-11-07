import type { FileMeta } from './types';
import { readFileBytes } from '../data/repo';

/**
 * 예약 파일 처리
 *  - 사진: 긴 변 2000px 이하로 줄이고 JPEG 로 압축 (QR 이 깨지지 않도록 품질 0.9). 작은 PNG 는 그대로.
 *  - PDF: 원본 그대로 저장, 첫 페이지를 썸네일로 렌더
 *  - 한 번 받은 파일은 기기(IndexedDB)에 보관 → 오프라인에서도 QR 열기
 */

export interface Prepared {
  blob: Blob;
  name: string;
  mime: string;
  thumb: string;
  pages: number;
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      res(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      rej(new Error('이미지를 읽지 못했어요'));
    };
    img.src = url;
  });
}

function canvasOf(src: CanvasImageSource, w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('변환 실패'))), type, q));

/** 썸네일 data URL (긴 변 240px, 수 KB) */
export function thumbFrom(src: CanvasImageSource, w: number, h: number): string {
  const s = 240 / Math.max(w, h);
  return canvasOf(src, w * Math.min(1, s), h * Math.min(1, s)).toDataURL('image/jpeg', 0.7);
}

export async function prepareFile(file: File): Promise<Prepared> {
  const mime = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
  if (mime === 'application/pdf') {
    const { renderPdfPage, pdfPageCount } = await import('./pdf');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let thumb = '';
    let pages = 1;
    try {
      pages = await pdfPageCount(bytes);
      const c = await renderPdfPage(bytes, 1, 300);
      thumb = thumbFrom(c, c.width, c.height);
    } catch {
      /* 썸네일 실패 시 아이콘 표시 */
    }
    return { blob: file, name: file.name, mime, thumb, pages };
  }
  if (mime.startsWith('image/')) {
    const img = await loadImage(file);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const thumb = thumbFrom(img, w, h);
    const keep = (mime === 'image/png' || mime === 'image/jpeg') && file.size <= 1.5 * 1024 * 1024 && Math.max(w, h) <= 2400;
    if (keep) return { blob: file, name: file.name, mime, thumb, pages: 1 };
    const s = Math.min(1, 2000 / Math.max(w, h));
    const blob = await toBlob(canvasOf(img, w * s, h * s), 'image/jpeg', 0.9);
    return { blob, name: file.name.replace(/\.\w+$/, '') + '.jpg', mime: 'image/jpeg', thumb, pages: 1 };
  }
  throw new Error('사진(JPG·PNG·HEIC 변환본) 또는 PDF 만 올릴 수 있어요');
}

// ───────── 기기 보관 (IndexedDB) ─────────
const DB = 'travely-files';
function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(key: string): Promise<Blob | null> {
  try {
    const db = await idb();
    return await new Promise((res) => {
      const q = db.transaction('files').objectStore('files').get(key);
      q.onsuccess = () => res((q.result as Blob) ?? null);
      q.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}
async function idbPut(key: string, b: Blob) {
  try {
    const db = await idb();
    await new Promise<void>((res) => {
      const t = db.transaction('files', 'readwrite');
      t.objectStore('files').put(b, key);
      t.oncomplete = () => res();
      t.onerror = () => res();
    });
  } catch {
    /* 저장 불가 환경 */
  }
}
export async function isOffline(tripId: string, fid: string) {
  return (await idbGet(`${tripId}/${fid}`)) !== null;
}

const mem = new Map<string, Blob>();

/** 파일 내용 가져오기: 메모리 → 기기 보관 → 서버(청크 합치기) 순 */
export async function getFileBlob(tripId: string, meta: FileMeta): Promise<{ blob: Blob; offline: boolean }> {
  const key = `${tripId}/${meta.id}`;
  const m = mem.get(key);
  if (m) return { blob: m, offline: true };
  const cached = await idbGet(key);
  if (cached) {
    mem.set(key, cached);
    return { blob: cached, offline: true };
  }
  const bytes = await readFileBytes(tripId, meta);
  const blob = new Blob([bytes as BlobPart], { type: meta.mime });
  mem.set(key, blob);
  await idbPut(key, blob);
  return { blob, offline: true };
}

export async function saveAllOffline(tripId: string, files: FileMeta[], onProgress?: (done: number, total: number) => void) {
  let done = 0;
  for (const f of files) {
    if (f.complete) await getFileBlob(tripId, f).catch(() => undefined);
    onProgress?.(++done, files.length);
  }
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

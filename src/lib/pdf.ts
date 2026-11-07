/** PDF 렌더 (pdf.js). 필요할 때만 불러온다. */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// 단일 파일 미리보기에서는 페이지 안에 넣어 둔 워커(blob URL)를 사용
pdfjs.GlobalWorkerOptions.workerSrc = (globalThis as { __PDF_WORKER_SRC__?: string }).__PDF_WORKER_SRC__ ?? workerUrl;

export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const n = doc.numPages;
  await doc.loadingTask.destroy();
  return n;
}

/** 지정 페이지를 긴 변 maxPx 로 캔버스에 렌더 */
export async function renderPdfPage(bytes: Uint8Array, page: number, maxPx = 1600): Promise<HTMLCanvasElement> {
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  try {
    const p = await doc.getPage(page);
    const v1 = p.getViewport({ scale: 1 });
    const scale = maxPx / Math.max(v1.width, v1.height);
    const vp = p.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width);
    c.height = Math.round(vp.height);
    await p.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport: vp }).promise;
    return c;
  } finally {
    await doc.loadingTask.destroy();
  }
}

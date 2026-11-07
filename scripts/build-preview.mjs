/**
 * 미리보기용 단일 HTML 만들기 (메모리 모드 — 서버 없이 샘플 데이터로 동작).
 *   node scripts/build-preview.mjs <출력 파일>
 */
import { build } from 'vite';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'travely-preview.html';
const dir = 'dist-preview';
await build({
  mode: 'memory',
  logLevel: 'warn',
  build: {
    outDir: dir,
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
const assets = join(dir, 'assets');
const files = readdirSync(assets);
const js = files.filter((f) => f.endsWith('.js'));
if (js.length !== 1) throw new Error(`JS 파일이 하나가 아님: ${js.join(', ')}`);
const worker = files.find((f) => f.startsWith('pdf.worker'));
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
const esc = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
let html = readFileSync(join(dir, 'index.html'), 'utf8');
html = html.replace(/<link[^>]*rel="(icon|apple-touch-icon)"[^>]*>/g, '').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '').replace(/<link[^>]*rel="(stylesheet|modulepreload|manifest)"[^>]*>/g, '');
const workerTag = worker
  ? `<script>(function(){try{var s=document.getElementById('pdfw').textContent;window.__PDF_WORKER_SRC__=URL.createObjectURL(new Blob([s],{type:'text/javascript'}));}catch(e){}})();</script>`
  : '';
const workerData = worker ? `<script type="text/plain" id="pdfw">${esc(readFileSync(join(assets, worker), 'utf8'))}</script>` : '';
html = html.replace('</head>', () => `<style>${css}</style></head>`); // 함수로 넘겨 $& 같은 치환 패턴 방지
html = html.replace('</body>', () => `${workerData}${workerTag}<script type="module">${esc(readFileSync(join(assets, js[0]), 'utf8'))}</script></body>`);
writeFileSync(out, html);
console.log(`${out}  ${(html.length / 1024 / 1024).toFixed(2)} MB`);

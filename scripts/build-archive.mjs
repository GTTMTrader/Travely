/**
 * 여행 백업 보기 앱 (단일 HTML, archive 모드) 만들기 → 배포 폴더에 archive.html 로.
 * 앱의 '여행 백업 만들기'가 이 파일을 받아 데이터 자리(<!--TRAVELY_BACKUP_SLOT-->)에 여행 데이터를 넣어 저장한다.
 *   node scripts/build-archive.mjs dist/archive.html
 */
import { build } from 'vite';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'dist/archive.html';
const dir = 'dist-archive';
await build({
  mode: 'archive',
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
// 데이터 자리: <body> 바로 뒤 (JS 보다 앞이라 파일 텍스트에서 데이터를 먼저 찾게 됨)
if (!/<body[^>]*>/.test(html)) throw new Error('body 태그 없음');
html = html.replace(/<body[^>]*>/, (m) => `${m}<!--TRAVELY_BACKUP_SLOT-->`);
html = html.replace(/<title>[^<]*<\/title>/, () => '<title>Travely 백업 보기</title>');
if (html.split('<!--TRAVELY_BACKUP_SLOT-->').length !== 2) throw new Error('데이터 자리가 하나가 아님');
writeFileSync(out, html);
console.log(`${out}  ${(html.length / 1024 / 1024).toFixed(2)} MB`);

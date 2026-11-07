// 앱 아이콘 PNG 생성 (자체 제작 SVG → PNG). 실행: npm run icons
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });
const page = await browser.newPage();
const targets = [
  ['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['apple-touch-icon.png', 180, 0], ['icon-512-maskable.png', 512, 0.12],
];
for (const [name, size, pad] of targets) {
  const inner = Math.round(size * (1 - pad * 2));
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:#6d3df2;display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `).replace(pad ? 'rx="16"' : '__', pad ? 'rx="0"' : '__')}</div></body></html>`);
  await page.screenshot({ path: new URL(`../public/icons/${name}`, import.meta.url).pathname, omitBackground: false });
}
await browser.close();
console.log('icons ok');

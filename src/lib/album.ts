/**
 * 추억 앨범 — 여행 일정 + 직접 고른 사진으로 '따뜻한 앨범' 느낌의 PDF 와 날짜별 이미지 카드를 만든다.
 * 사진은 서버에 올리지 않고 이 기기에서만 그려 넣는다. 모든 그림은 캔버스로 직접 그린다(기기마다 같은 결과).
 */
import type { Day, Item, Leg, Trip } from './types';
import { MODE_EMOJI } from './types';

import serifKo400 from '@fontsource/gowun-batang/files/gowun-batang-korean-400-normal.woff2?url';
import serifKo700 from '@fontsource/gowun-batang/files/gowun-batang-korean-700-normal.woff2?url';
import serifLa400 from '@fontsource/gowun-batang/files/gowun-batang-latin-400-normal.woff2?url';
import serifLa700 from '@fontsource/gowun-batang/files/gowun-batang-latin-700-normal.woff2?url';
import handKo from '@fontsource/gaegu/files/gaegu-korean-400-normal.woff2?url';
import handLa from '@fontsource/gaegu/files/gaegu-latin-400-normal.woff2?url';

export interface AlbumDay {
  day: Day;
  items: Item[];
  photos: File[];
}
export interface AlbumInput {
  trip: Trip;
  days: AlbumDay[];
  cover: File | null;
  names: string[];
  legs: Map<string, Leg>;
}

// ───────── 스타일 ─────────
const SERIF = '"Album Serif", "Apple SD Gothic Neo", "PingFang SC", "Noto Serif CJK KR", serif';
const HAND = '"Album Hand", "Album Serif", "Apple SD Gothic Neo", sans-serif';
const INK = '#3f3127';
const INK2 = '#7a6656';
const INK3 = '#a8968a';
const ACCENT = '#e0734f';
const PAPER = '#f6efe3';
const DAY_TONES = ['#e0734f', '#d6a23a', '#5f9b7c', '#5b84b8', '#a46fb2', '#c9606e', '#4f9aa5'];
const TAPES = ['rgba(240, 196, 120, 0.72)', 'rgba(170, 205, 190, 0.72)', 'rgba(236, 170, 160, 0.72)', 'rgba(180, 190, 230, 0.72)'];

export const PAGE_W = 1240; // A4 150dpi
export const PAGE_H = 1754;
export const CARD_W = 1080;

let fontsReady: Promise<void> | null = null;
export function loadAlbumFonts(): Promise<void> {
  if (!fontsReady) {
    const faces = [
      new FontFace('Album Serif', `url(${serifKo400})`, { weight: '400' }),
      new FontFace('Album Serif', `url(${serifKo700})`, { weight: '700' }),
      new FontFace('Album Serif', `url(${serifLa400})`, { weight: '400', unicodeRange: 'U+0000-00FF, U+2000-206F, U+20AC' }),
      new FontFace('Album Serif', `url(${serifLa700})`, { weight: '700', unicodeRange: 'U+0000-00FF, U+2000-206F, U+20AC' }),
      new FontFace('Album Hand', `url(${handKo})`, { weight: '400' }),
      new FontFace('Album Hand', `url(${handLa})`, { weight: '400', unicodeRange: 'U+0000-00FF, U+2000-206F' }),
    ];
    fontsReady = Promise.all(
      faces.map((f) =>
        f.load().then(
          (ff) => void document.fonts.add(ff),
          () => undefined, // 글꼴을 못 받으면 기본 글꼴로
        ),
      ),
    ).then(() => undefined);
  }
  return fontsReady;
}

// ───────── 사진 ─────────
export async function loadPhoto(file: File, max = 1400): Promise<HTMLCanvasElement | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * s));
    c.height = Math.max(1, Math.round(img.naturalHeight * s));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ───────── 그리기 도구 ─────────
type Ctx = CanvasRenderingContext2D;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

let noiseTile: HTMLCanvasElement | null = null;
function paper(ctx: Ctx, w: number, h: number) {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);
  if (!noiseTile) {
    noiseTile = document.createElement('canvas');
    noiseTile.width = noiseTile.height = 160;
    const n = noiseTile.getContext('2d')!;
    const r = rng(7);
    for (let i = 0; i < 2600; i++) {
      n.fillStyle = r() > 0.5 ? 'rgba(120, 90, 60, 0.05)' : 'rgba(255, 255, 255, 0.10)';
      n.fillRect(r() * 160, r() * 160, 1 + r() * 1.5, 1 + r() * 1.5);
    }
  }
  ctx.fillStyle = ctx.createPattern(noiseTile, 'repeat')!;
  ctx.fillRect(0, 0, w, h);
  // 가장자리 살짝 어둡게 (오래된 종이)
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(120, 85, 50, 0.10)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function font(ctx: Ctx, size: number, weight = 400, fam = SERIF) {
  ctx.font = `${weight} ${size}px ${fam}`;
}

/** 글자 단위 줄바꿈 (한글은 어절 단위가 어색하지 않게 공백 우선, 넘치면 글자 단위) */
export function wrap(ctx: Ctx, text: string, maxW: number, maxLines = 99): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (ctx.measureText(line + word).width <= maxW) {
        line += word;
        continue;
      }
      if (line.trim()) out.push(line.trimEnd());
      line = '';
      for (const ch of word.trimStart()) {
        if (ctx.measureText(line + ch).width > maxW && line) {
          out.push(line);
          line = '';
        }
        line += ch;
      }
    }
    if (line.trim() || !para) out.push(line.trimEnd());
  }
  if (out.length > maxLines) {
    const cut = out.slice(0, maxLines);
    let last = cut[maxLines - 1];
    while (last && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    cut[maxLines - 1] = last + '…';
    return cut;
  }
  return out;
}

function tape(ctx: Ctx, cx: number, cy: number, w: number, h: number, rot: number, color: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.beginPath();
  // 찢어진 끝
  const z = 5;
  ctx.moveTo(-w / 2, -h / 2);
  for (let x = -w / 2; x <= w / 2; x += w / 8) ctx.lineTo(x, -h / 2 + (Math.round(x) % 2 ? 0 : 1.5));
  for (let y = -h / 2; y <= h / 2; y += h / 4) ctx.lineTo(w / 2 + (y % 2 ? z : -z) * 0.4, y);
  for (let x = w / 2; x >= -w / 2; x -= w / 8) ctx.lineTo(x, h / 2);
  for (let y = h / 2; y >= -h / 2; y -= h / 4) ctx.lineTo(-w / 2 + (y % 2 ? -z : z) * 0.4, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawCover(ctx: Ctx, img: HTMLCanvasElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s;
  const sh = h / s;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

/** 폴라로이드 사진틀 (cx, cy = 중심) */
function polaroid(ctx: Ctx, img: HTMLCanvasElement | null, cx: number, cy: number, w: number, rot: number, tapeColor: string, photoRatio = 1) {
  const pad = w * 0.055;
  const pw = w - pad * 2;
  const ph = pw * photoRatio;
  const h = pad + ph + pad * 3.2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.shadowColor = 'rgba(70, 45, 20, 0.22)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.fillStyle = '#fffdf8';
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.shadowColor = 'transparent';
  if (img) drawCover(ctx, img, -w / 2 + pad, -h / 2 + pad, pw, ph);
  else {
    ctx.fillStyle = '#efe4d2';
    ctx.fillRect(-w / 2 + pad, -h / 2 + pad, pw, ph);
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.strokeRect(-w / 2 + pad, -h / 2 + pad, pw, ph);
  ctx.restore();
  tape(ctx, cx + Math.sin(rot) * (h / 2), cy - Math.cos(rot) * (h / 2) + 4, w * 0.36, w * 0.085, rot - 0.05, tapeColor);
  return h;
}

export const polaroidHeight = (w: number, ratio = 1) => w * 0.055 + (w - w * 0.11) * ratio + w * 0.055 * 3.2;

function stamp(ctx: Ctx, cx: number, cy: number, r: number, text: string, sub: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.18);
  ctx.strokeStyle = ACCENT;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, r - 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = ACCENT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  font(ctx, r * 0.42, 400, HAND);
  ctx.fillText(text, 0, -r * 0.08);
  font(ctx, r * 0.2, 700);
  ctx.fillText(sub, 0, r * 0.38);
  ctx.restore();
}

const KDOW = ['일', '월', '화', '수', '목', '금', '토'];
const dateKo = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  return `${m}월 ${dd}일 (${KDOW[new Date(y, m - 1, dd).getDay()]})`;
};
const dotDate = (d: string) => d.replace(/-/g, '. ');
const nights = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// ───────── 날짜별 내용 → 블록 ─────────
type Row =
  | { k: 'place'; time: string | null; num: number; name: string; local: string; tag: string }
  | { k: 'note'; time: string | null; text: string }
  | { k: 'leg'; text: string };

const cleanLine = (s: string) => s.replace(/https?:\/\/\S+/g, '').trim();

function dayRows(items: Item[], legs: Map<string, Leg>): { rows: Row[]; subtitle: string } {
  const rows: Row[] = [];
  let subtitle = '';
  let n = 0;
  let prevPlace: Item | null = null;
  for (const it of items) {
    if (it.kind === 'memo') {
      const first = cleanLine(it.memo.split('\n')[0] ?? '');
      if (!first) continue;
      if (first.startsWith('📌') && !subtitle) {
        subtitle = first.replace(/^📌\s*/, '');
        continue;
      }
      rows.push({ k: 'note', time: it.time, text: first });
      continue;
    }
    if (it.kind === 'flight') {
      rows.push({ k: 'note', time: it.time, text: '✈️ 항공편' });
      continue;
    }
    if (prevPlace) {
      const leg = legs.get(`${prevPlace.id}__${it.id}`);
      if (leg && (leg.durationMin || leg.mode !== 'etc')) rows.push({ k: 'leg', text: `${MODE_EMOJI[leg.mode]} ${leg.durationMin ? `${leg.durationMin}분` : ''}`.trim() });
    }
    n++;
    rows.push({ k: 'place', time: it.time, num: n, name: it.place?.nameKo ?? '', local: it.place?.nameLocal ?? '', tag: it.tag });
    prevPlace = it;
  }
  return { rows, subtitle };
}

/** 한 줄(행) 높이 계산 + 그리기. x0 = 내용 왼쪽, w = 내용 폭 */
function rowHeight(ctx: Ctx, r: Row, w: number, scale: number): number {
  if (r.k === 'leg') return 40 * scale;
  if (r.k === 'note') {
    font(ctx, 25 * scale, 400, HAND);
    return wrap(ctx, r.text, w - 150 * scale, 2).length * 32 * scale + 22 * scale;
  }
  font(ctx, 31 * scale, 700);
  const lines = wrap(ctx, r.name, w - 170 * scale, 2).length;
  return lines * 40 * scale + (r.local ? 32 * scale : 0) + 30 * scale;
}

function drawRow(ctx: Ctx, r: Row, x: number, y: number, w: number, tone: string, scale: number, h: number) {
  const timeX = x;
  const dotX = x + 112 * scale;
  const textX = x + 150 * scale;
  // 세로 점선 (일정 줄기)
  ctx.save();
  ctx.strokeStyle = 'rgba(122, 102, 86, 0.35)';
  ctx.setLineDash([3 * scale, 7 * scale]);
  ctx.lineWidth = 2 * scale;
  ctx.beginPath();
  ctx.moveTo(dotX, y);
  ctx.lineTo(dotX, y + h);
  ctx.stroke();
  ctx.restore();
  ctx.textBaseline = 'alphabetic';
  if (r.k === 'leg') {
    font(ctx, 22 * scale, 400, HAND);
    ctx.fillStyle = INK3;
    ctx.textAlign = 'left';
    ctx.fillText(r.text, textX + 6 * scale, y + 27 * scale);
    return;
  }
  if (r.time) {
    font(ctx, 24 * scale, 700);
    ctx.fillStyle = r.k === 'place' ? tone : INK3;
    ctx.textAlign = 'left';
    ctx.fillText(r.time, timeX, y + 37 * scale);
  }
  if (r.k === 'note') {
    ctx.fillStyle = PAPER;
    ctx.beginPath();
    ctx.arc(dotX, y + 28 * scale, 7 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = INK3;
    ctx.lineWidth = 2 * scale;
    ctx.stroke();
    font(ctx, 25 * scale, 400, HAND);
    ctx.fillStyle = INK2;
    wrap(ctx, r.text, w - 150 * scale, 2).forEach((l, i) => ctx.fillText(l, textX, y + 36 * scale + i * 32 * scale));
    return;
  }
  // 번호 원
  ctx.fillStyle = tone;
  ctx.beginPath();
  ctx.arc(dotX, y + 27 * scale, 19 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  font(ctx, 20 * scale, 700);
  ctx.fillText(String(r.num), dotX, y + 34 * scale);
  ctx.textAlign = 'left';
  font(ctx, 31 * scale, 700);
  ctx.fillStyle = INK;
  const lines = wrap(ctx, r.name, w - 170 * scale, 2);
  lines.forEach((l, i) => ctx.fillText(l, textX, y + 38 * scale + i * 40 * scale));
  let yy = y + 38 * scale + (lines.length - 1) * 40 * scale;
  if (r.tag) {
    const tw = ctx.measureText(lines[lines.length - 1]).width;
    font(ctx, 21 * scale, 400, HAND);
    ctx.fillStyle = tone;
    if (textX + tw + 16 * scale + ctx.measureText(r.tag).width < x + w) ctx.fillText(r.tag, textX + tw + 16 * scale, yy);
  }
  if (r.local) {
    yy += 32 * scale;
    font(ctx, 22 * scale, 400);
    ctx.fillStyle = INK3;
    ctx.fillText(wrap(ctx, r.local, w - 170 * scale, 1)[0], textX, yy);
  }
}

// ───────── 페이지 ─────────
function newCanvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  paper(ctx, w, h);
  return { c, ctx };
}

function placeCount(input: AlbumInput) {
  return input.days.reduce((s, d) => s + d.items.filter((i) => i.kind === 'place').length, 0);
}

function cityLine(input: AlbumInput) {
  const seen: string[] = [];
  for (const d of input.days) for (const c of (d.day.city || '').split(/→|->|,|·/).map((x) => x.trim()).filter(Boolean)) if (!seen.includes(c)) seen.push(c);
  if (!seen.length) seen.push(...input.trip.cities.map((c) => c.name));
  return seen.join('  →  ');
}

export async function renderCover(input: AlbumInput, w = PAGE_W, h = PAGE_H): Promise<HTMLCanvasElement> {
  const { c, ctx } = newCanvas(w, h);
  const k = w / PAGE_W;
  const t = input.trip;
  ctx.textAlign = 'center';
  ctx.fillStyle = INK2;
  font(ctx, 26 * k, 700);
  ctx.save();
  (ctx as Ctx & { letterSpacing?: string }).letterSpacing = `${10 * k}px`;
  ctx.fillText('OUR TRAVEL ALBUM', w / 2, 150 * k);
  ctx.restore();
  ctx.fillStyle = INK;
  font(ctx, 78 * k, 700);
  const title = wrap(ctx, t.name, w - 200 * k, 2);
  title.forEach((l, i) => ctx.fillText(l, w / 2, 260 * k + i * 92 * k));
  let y = 260 * k + (title.length - 1) * 92 * k + 70 * k;
  font(ctx, 32 * k, 400);
  ctx.fillStyle = INK2;
  ctx.fillText(`${dotDate(t.startDate)} – ${dotDate(t.endDate).slice(5)}`, w / 2, y);
  y += 56 * k;
  font(ctx, 36 * k, 400, HAND);
  ctx.fillStyle = ACCENT;
  ctx.fillText(cityLine(input), w / 2, y);

  // 표지 사진
  const img = input.cover ? await loadPhoto(input.cover, 1600) : null;
  const pw = 760 * k;
  const ph = polaroidHeight(pw, 0.8);
  const pcy = y + 90 * k + ph / 2;
  polaroid(ctx, img, w / 2, pcy, pw, -0.035, TAPES[0], 0.8);
  if (!img) {
    ctx.fillStyle = INK3;
    font(ctx, 34 * k, 400, HAND);
    ctx.fillText('우리의 첫 장', w / 2, pcy - ph * 0.08);
  }
  const n = nights(t.startDate, t.endDate);
  stamp(ctx, w / 2 + pw / 2 - 30 * k, pcy + ph / 2 - 40 * k, 92 * k, n > 0 ? `${n}박 ${n + 1}일` : '당일', `${placeCount(input)} PLACES`);

  // 함께한 사람
  ctx.textAlign = 'center';
  font(ctx, 44 * k, 400, HAND);
  ctx.fillStyle = INK;
  ctx.fillText(input.names.join('  &  '), w / 2, h - 170 * k);
  font(ctx, 22 * k, 400);
  ctx.fillStyle = INK3;
  ctx.fillText('Travely', w / 2, h - 110 * k);
  return c;
}

interface Block {
  h: number;
  draw: (ctx: Ctx, y: number) => Promise<void> | void;
  keepWithNext?: boolean;
}

async function dayBlocks(input: AlbumInput, di: number, w: number, k: number, measure: Ctx, cols = 2): Promise<{ head: (ctx: Ctx, y: number, cont: boolean) => number; blocks: Block[] }> {
  const d = input.days[di];
  const tone = DAY_TONES[d.day.index % DAY_TONES.length];
  const { rows, subtitle } = dayRows(d.items, input.legs);
  const x = 110 * k;
  const cw = w - 220 * k;
  const head = (ctx: Ctx, y: number, cont: boolean) => {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    font(ctx, 30 * k, 400, HAND);
    ctx.fillStyle = tone;
    ctx.fillText(`DAY ${d.day.index + 1}${cont ? '  (이어서)' : ''}`, x, y + 34 * k);
    font(ctx, 52 * k, 700);
    ctx.fillStyle = INK;
    ctx.fillText(dateKo(d.day.date), x, y + 100 * k);
    const dw = ctx.measureText(dateKo(d.day.date)).width;
    if (d.day.city) {
      font(ctx, 30 * k, 400);
      ctx.fillStyle = INK2;
      ctx.fillText(`· ${d.day.city}`, x + dw + 18 * k, y + 100 * k);
    }
    // 밑줄 (형광펜 느낌)
    ctx.fillStyle = tone;
    ctx.globalAlpha = 0.22;
    ctx.fillRect(x - 6 * k, y + 82 * k, dw + 12 * k, 22 * k);
    ctx.globalAlpha = 1;
    let yy = y + 130 * k;
    if (subtitle && !cont) {
      font(ctx, 27 * k, 400, HAND);
      ctx.fillStyle = INK2;
      const ls = wrap(ctx, subtitle, cw, 2);
      ls.forEach((l, i) => ctx.fillText(l, x, yy + 22 * k + i * 34 * k));
      yy += ls.length * 34 * k + 14 * k;
    }
    return yy + 16 * k - y;
  };
  const blocks: Block[] = rows.map((r) => {
    const h = rowHeight(measure, r, cw, k);
    return { h, draw: (ctx, y) => drawRow(ctx, r, x, y, cw, tone, k, h), keepWithNext: r.k === 'leg' };
  });
  // 사진: 한 줄에 cols 장 (A4 페이지는 3장, 사진첩 카드는 2장)
  const gap = (cols === 3 ? 40 : 60) * k;
  const pw = (cw - gap * (cols - 1)) / cols;
  const ph = polaroidHeight(pw, 1);
  const r = rng(d.day.index * 97 + 13);
  if (d.photos.length) blocks.push({ h: 20 * k, draw: () => undefined });
  for (let i = 0; i < d.photos.length; i += cols) {
    const pair = d.photos.slice(i, i + cols);
    blocks.push({
      h: ph + 50 * k,
      draw: async (ctx, y) => {
        const offset = (cw - (pair.length * pw + (pair.length - 1) * gap)) / 2; // 남는 줄은 가운데로
        for (let j = 0; j < pair.length; j++) {
          const img = await loadPhoto(pair[j], 1100);
          const rot = (r() - 0.5) * 0.09 + (j % 2 === 0 ? -0.02 : 0.02);
          const cx = x + offset + pw / 2 + j * (pw + gap);
          polaroid(ctx, img, cx, y + 25 * k + ph / 2, pw, rot, TAPES[(i + j + d.day.index) % TAPES.length]);
          img && (img.width = 0);
        }
      },
    });
  }
  return { head, blocks };
}

function pageNumber(ctx: Ctx, w: number, h: number, n: number, k: number) {
  font(ctx, 20 * k, 400);
  ctx.fillStyle = INK3;
  ctx.textAlign = 'center';
  ctx.fillText(`— ${n} —`, w / 2, h - 45 * k);
}

/** 날짜 하나 → A4 페이지 여러 장 (넘치면 '이어서') */
export async function renderDayPages(input: AlbumInput, di: number, startPage: number): Promise<HTMLCanvasElement[]> {
  const w = PAGE_W;
  const h = PAGE_H;
  const k = 1;
  const measure = document.createElement('canvas').getContext('2d')!;
  const { head, blocks } = await dayBlocks(input, di, w, k, measure, 3);
  const pages: HTMLCanvasElement[] = [];
  const top = 110 * k;
  const bottom = h - 90 * k;
  let cur = newCanvas(w, h);
  let y = top + head(cur.ctx, top, false);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const need = b.h + (b.keepWithNext && blocks[i + 1] ? blocks[i + 1].h : 0);
    if (y + need > bottom && y > top + 200 * k) {
      pageNumber(cur.ctx, w, h, startPage + pages.length, k);
      pages.push(cur.c);
      cur = newCanvas(w, h);
      y = top + head(cur.ctx, top, true);
    }
    await b.draw(cur.ctx, y);
    y += b.h;
  }
  pageNumber(cur.ctx, w, h, startPage + pages.length, k);
  pages.push(cur.c);
  return pages;
}

/** 날짜 하나 → 사진첩용 세로 이미지 한 장 */
export async function renderDayCard(input: AlbumInput, di: number): Promise<HTMLCanvasElement> {
  const w = CARD_W;
  const k = w / PAGE_W;
  const measure = document.createElement('canvas').getContext('2d')!;
  const { head, blocks } = await dayBlocks(input, di, w, k, measure);
  const tmp = document.createElement('canvas').getContext('2d')!;
  const top = 90 * k;
  const headH = head(tmp, top, false);
  const total = Math.min(9000, Math.max(Math.round(w * 1.25), Math.ceil(top + headH + blocks.reduce((s, b) => s + b.h, 0) + 140 * k)));
  const { c, ctx } = newCanvas(w, total);
  let y = top + head(ctx, top, false);
  for (const b of blocks) {
    if (y + b.h > total - 100 * k) break;
    await b.draw(ctx, y);
    y += b.h;
  }
  font(ctx, 22 * k, 400, HAND);
  ctx.fillStyle = INK3;
  ctx.textAlign = 'center';
  ctx.fillText(`${input.trip.name} · Travely`, w / 2, total - 50 * k);
  return c;
}

/** 마지막 장: 사진 모음 + 다음 여행 */
export async function renderClosing(input: AlbumInput, pageNo: number): Promise<HTMLCanvasElement> {
  const w = PAGE_W;
  const h = PAGE_H;
  const { c, ctx } = newCanvas(w, h);
  ctx.textAlign = 'center';
  font(ctx, 54 * 1, 400, HAND);
  ctx.fillStyle = INK;
  ctx.fillText('함께여서 더 좋았던 여행', w / 2, 190);
  font(ctx, 26, 400);
  ctx.fillStyle = INK2;
  ctx.fillText(`${dotDate(input.trip.startDate)} – ${dotDate(input.trip.endDate).slice(5)} · ${input.names.join(' & ')}`, w / 2, 245);

  // 날짜마다 골고루 최대 6장
  const pool: File[] = [];
  const lists = input.days.map((d) => [...d.photos]);
  while (pool.length < 6 && lists.some((l) => l.length)) for (const l of lists) if (l.length && pool.length < 6) pool.push(l.shift()!);
  if (!pool.length && input.cover) pool.push(input.cover);
  const pw = 330;
  const ph = polaroidHeight(pw, 1);
  const pos = [
    [w * 0.27, 330 + ph / 2, -0.06],
    [w * 0.72, 360 + ph / 2, 0.05],
    [w * 0.5, 470 + ph / 2, -0.015],
    [w * 0.24, 760 + ph / 2, 0.04],
    [w * 0.76, 790 + ph / 2, -0.05],
    [w * 0.5, 880 + ph / 2, 0.02],
  ];
  const order = [0, 1, 3, 4, 2, 5].slice(0, pool.length);
  for (let i = 0; i < order.length; i++) {
    const img = await loadPhoto(pool[i], 900);
    const [x, y, rot] = pos[order[i]];
    polaroid(ctx, img, x, y, pw, rot, TAPES[i % TAPES.length]);
    img && (img.width = 0);
  }
  // 다음 여행
  const y0 = pool.length ? 1330 : 520;
  ctx.textAlign = 'left';
  font(ctx, 34, 400, HAND);
  ctx.fillStyle = ACCENT;
  ctx.fillText('다음 여행은 어디로?', 140, y0);
  ctx.strokeStyle = 'rgba(122, 102, 86, 0.35)';
  ctx.setLineDash([4, 8]);
  ctx.lineWidth = 2;
  for (let i = 1; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(140, y0 + i * 62);
    ctx.lineTo(w - 140, y0 + i * 62);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  pageNumber(ctx, w, h, pageNo, 1);
  return c;
}

// ───────── 결과물 ─────────
export const toJpeg = (c: HTMLCanvasElement, q = 0.86) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('이미지를 만들지 못했어요'))), 'image/jpeg', q));

export async function buildAlbumPdf(input: AlbumInput, onProgress: (done: number, total: number) => void): Promise<Blob> {
  await loadAlbumFonts();
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  const total = input.days.length + 2;
  let step = 0;
  let pageNo = 1;
  const add = async (c: HTMLCanvasElement, first = false) => {
    const blob = await toJpeg(c, 0.84);
    const u8 = new Uint8Array(await blob.arrayBuffer());
    if (!first) pdf.addPage('a4', 'portrait');
    pdf.addImage(u8, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    c.width = 0;
  };
  await add(await renderCover(input), true);
  onProgress(++step, total);
  for (let i = 0; i < input.days.length; i++) {
    const pages = await renderDayPages(input, i, pageNo + 1);
    for (const p of pages) await add(p);
    pageNo += pages.length;
    onProgress(++step, total);
  }
  await add(await renderClosing(input, pageNo + 1));
  onProgress(++step, total);
  pdf.setProperties({ title: `${input.trip.name} 추억 앨범`, creator: 'Travely' });
  return pdf.output('blob');
}

export async function buildAlbumImages(input: AlbumInput, onProgress: (done: number, total: number) => void): Promise<File[]> {
  await loadAlbumFonts();
  const files: File[] = [];
  const total = input.days.length + 1;
  const base = input.trip.name.replace(/[\\/:*?"<>|]/g, '').trim() || 'Travely';
  const cover = await renderCover(input, CARD_W, Math.round(CARD_W * 1.5));
  files.push(new File([await toJpeg(cover, 0.9)], `${base}_00_표지.jpg`, { type: 'image/jpeg' }));
  cover.width = 0;
  onProgress(1, total);
  for (let i = 0; i < input.days.length; i++) {
    const c = await renderDayCard(input, i);
    const d = input.days[i].day;
    files.push(new File([await toJpeg(c, 0.9)], `${base}_DAY${d.index + 1}_${d.date.slice(5)}.jpg`, { type: 'image/jpeg' }));
    c.width = 0;
    onProgress(i + 2, total);
  }
  return files;
}

/** 공유 시트(파일에 저장·사진 저장·카톡) → 안 되면 내려받기 */
export async function shareOrDownload(files: File[]): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files })) {
    try {
      await nav.share({ files });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
    }
  }
  for (const f of files) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  return 'downloaded';
}

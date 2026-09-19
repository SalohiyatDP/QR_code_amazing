/**
 * Yadro mantiqini tekshiruvchi testlar (brauzersiz, sof Node).
 * Ishga tushirish:  node test/run-tests.mjs
 * Natija tasvirlari: test/out/*.png
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  subpixelCount, blockShape, weightVectors, makeRng,
  encodeShares, stackShares, simulateStack,
} from '../src/vc.js';
import { prepareBinary, rgbaToLuma, resample, dither } from '../src/image.js';
import { fitText, wrapLines, FONTS } from '../src/text.js';
import { computeLayout, PAPERS } from '../src/layout.js';
import { buildPdf, packOneBit } from '../src/pdf.js';
import { buildSheetDoc, buildSheetPdf } from '../src/sheet.js';
import { decodeBmp } from '../src/bmp.js';
import { grayPng, bitsPng } from './png.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const results = [];
function check(name, cond, extra = '') {
  if (cond) { pass++; results.push(`  ok   ${name}`); }
  else { fail++; results.push(`  FAIL ${name} ${extra}`); }
}
function section(t) { results.push(`\n${t}`); }

/* ---------------------------------------------------------------- 1. vc.js */
section('1) Vizual kriptografiya asoslari');

check('subpixelCount(2)=2', subpixelCount(2) === 2);
check('subpixelCount(4)=8', subpixelCount(4) === 8);
check('subpixelCount(8)=128', subpixelCount(8) === 128);

for (const [m, exp] of [[2, [1, 2]], [4, [2, 2]], [8, [2, 4]], [16, [4, 4]], [32, [4, 8]], [64, [8, 8]], [128, [8, 16]]]) {
  const b = blockShape(m);
  check(`blockShape(${m}) = ${exp[0]}x${exp[1]}`, b.rows === exp[0] && b.cols === exp[1], `-> ${b.rows}x${b.cols}`);
}

for (let n = 2; n <= 8; n++) {
  const even = weightVectors(n, 0), odd = weightVectors(n, 1);
  const m = subpixelCount(n);
  const popc = (v) => v.toString(2).split('').filter((c) => c === '1').length;
  check(`n=${n}: juft/toq vektorlar soni = ${m}`, even.length === m && odd.length === m);
  check(`n=${n}: parity to'g'ri`, [...even].every((v) => popc(v) % 2 === 0) && [...odd].every((v) => popc(v) % 2 === 1));
  check(`n=${n}: nol vektor faqat juftlar ichida`, even.includes(0) && !odd.includes(0));
}

/* -------------------------------------------- 2. Kodlash va ustma-ust qo'yish */
section('2) Kodlash to\'g\'riligi (har bir n uchun)');

for (let n = 2; n <= 8; n++) {
  const rng = makeRng(1234 + n);
  const w = 23, h = 17;
  const bin = new Uint8Array(w * h);
  for (let i = 0; i < bin.length; i++) bin[i] = rng() < 0.5 ? 1 : 0;

  const g = encodeShares(bin, w, h, n, rng);
  const m = g.m;
  const stacked = stackShares(g.shares, g.width, g.height);

  let okReveal = true, okDensity = true, okShareDensity = true;
  const perShareInk = new Array(n).fill(0);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let open = 0;
      for (let j = 0; j < m; j++) {
        const idx = (y * g.blockRows + ((j / g.blockCols) | 0)) * g.width + x * g.blockCols + (j % g.blockCols);
        if (!stacked[idx]) open++;
      }
      // qora piksel -> 0 shaffof modul, oq piksel -> aynan 1 shaffof modul
      const expected = bin[y * w + x] ? 0 : 1;
      if (open !== expected) okReveal = false;

      for (let i = 0; i < n; i++) {
        let ink = 0;
        for (let j = 0; j < m; j++) {
          const idx = (y * g.blockRows + ((j / g.blockCols) | 0)) * g.width + x * g.blockCols + (j % g.blockCols);
          if (g.shares[i][idx]) ink++;
        }
        // Xavfsizlik: har bir ulushning har bir bloki aynan m/2 siyohga ega
        if (ink !== m / 2) okShareDensity = false;
        perShareInk[i] += ink;
      }
    }
  }
  check(`n=${n}: ustma-ust qo'yilganda asl tasvir tiklanadi (kontrast 1/${m})`, okReveal);
  check(`n=${n}: har bir ulush bloki aynan ${m / 2} siyoh (bitta ulush hech narsa oshkor qilmaydi)`, okShareDensity);
  check(`n=${n}: ulushlar zichligi 50%`, perShareInk.every((v) => Math.abs(v / (w * h * m) - 0.5) < 1e-9));
  check(`n=${n}: geometriya mos`, g.width === w * g.blockCols && g.height === h * g.blockRows);
  check(`n=${n}: blok m ga teng`, g.blockRows * g.blockCols === m);
  void okDensity;
}

// n-1 ta ulush hech narsa bermasligi (blok zichligi doim bir xil)
{
  const n = 4, w = 30, h = 30, rng = makeRng(7);
  const bin = new Uint8Array(w * h);
  for (let i = 0; i < bin.length; i++) bin[i] = (i % 7 < 3) ? 1 : 0;
  const g = encodeShares(bin, w, h, n, rng);
  const partial = stackShares(g.shares.slice(0, n - 1), g.width, g.height);
  const openByValue = { 0: [], 1: [] };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let open = 0;
      for (let j = 0; j < g.m; j++) {
        const idx = (y * g.blockRows + ((j / g.blockCols) | 0)) * g.width + x * g.blockCols + (j % g.blockCols);
        if (!partial[idx]) open++;
      }
      openByValue[bin[y * w + x]].push(open);
    }
  }
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const d = Math.abs(avg(openByValue[0]) - avg(openByValue[1]));
  check(`n=4: ${n - 1} ta ulush yetarli emas (o'rtacha yorug'lik farqi ${d.toFixed(3)} ~ 0)`, d < 0.35, `farq=${d}`);
}

/* ------------------------------------------------------------- 3. image.js */
section('3) Rasmni tayyorlash');
{
  const w = 8, h = 8;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = 255; }
  const lum = rgbaToLuma(rgba, w, h);
  check('oq rasm luma = 1', [...lum].every((v) => Math.abs(v - 1) < 1e-6));

  const half = new Float32Array(16).fill(0.5);
  const rs = resample(half, 4, 4, 2, 2);
  check('resample o\'rtacha qiymatni saqlaydi', [...rs].every((v) => Math.abs(v - 0.5) < 1e-6));

  const grayLum = new Float32Array(64).fill(0.5);
  const d = dither(grayLum, 8, 8, 'fs');
  const inkRatio = d.reduce((s, v) => s + v, 0) / 64;
  check(`50% kulrang -> ~50% nuqta (${(inkRatio * 100).toFixed(0)}%)`, Math.abs(inkRatio - 0.5) < 0.2, `ink=${inkRatio}`);

  const dark = dither(new Float32Array(64).fill(0.05), 8, 8, 'fs');
  check('qorayaqin soha -> deyarli hammasi siyoh', dark.reduce((s, v) => s + v, 0) / 64 > 0.9);
  const light = dither(new Float32Array(64).fill(0.95), 8, 8, 'fs');
  check('oqqa yaqin soha -> deyarli siyohsiz', light.reduce((s, v) => s + v, 0) / 64 < 0.1);
}

/* --------------------------------------------- 3b. text.js (avtomatik masshtab) */
section('3b) Matn: qatorlarga bo\'lish va avtomatik shrift o\'lchami');
{
  // Sinov uchun "monospace" o'lchagich: har bir belgi kengligi = 0.6 * size
  const measure = (t, size) => t.length * size * 0.6;
  const LH = 1.2;
  const box = { boxW: 600, boxH: 400, lineHeight: LH, measure };

  const fits = (r) => {
    const h = r.lines.length * r.size * LH;
    const w = Math.max(...r.lines.map((l) => measure(l, r.size)), 0);
    return h <= box.boxH + 1e-9 && w <= box.boxW + 1e-9;
  };

  const short = fitText({ ...box, text: 'SALOM' });
  const medium = fitText({ ...box, text: 'Salom dunyo, bu vizual kriptografiya sinovi' });
  const long = fitText({ ...box, text: 'Salom dunyo. '.repeat(30) });

  check(`kam matn -> katta shrift (${short.size}px), ko'p matn -> kichik (${long.size}px)`,
    short.size > medium.size && medium.size > long.size, `${short.size} / ${medium.size} / ${long.size}`);
  check('qisqa matn maydonga sig\'adi', fits(short));
  check('o\'rtacha matn maydonga sig\'adi', fits(medium));
  check('uzun matn maydonga sig\'adi', fits(long));

  // Eng kattalik: +1 px da endi sig'masligi kerak
  const plusOne = wrapLines('Salom dunyo, bu vizual kriptografiya sinovi', medium.size + 1, box.boxW, measure);
  const tooBig = plusOne.length * (medium.size + 1) * LH > box.boxH
    || Math.max(...plusOne.map((l) => measure(l, medium.size + 1))) > box.boxW;
  check('topilgan o\'lcham eng kattasi (1px kattasi sig\'maydi)', tooBig);

  // Maydon kattalashsa shrift ham kattalashadi
  const big = fitText({ ...box, boxW: 1200, boxH: 800, text: 'Salom dunyo, bu vizual kriptografiya sinovi' });
  check(`maydon 2 barobar -> shrift kattalashadi (${medium.size} -> ${big.size})`, big.size > medium.size);

  // Aniq qator ko'chirishlar saqlanadi
  const nl = fitText({ ...box, text: 'BIR\nIKKI\nUCH' });
  check('\\n bo\'yicha aynan 3 qator', nl.lines.length === 3 && nl.lines[1] === 'IKKI', JSON.stringify(nl.lines));

  // Bo'sh qator ham saqlanadi
  const blank = fitText({ ...box, text: 'A\n\nB' });
  check('bo\'sh qator saqlanadi', blank.lines.length === 3 && blank.lines[1] === '', JSON.stringify(blank.lines));

  // Juda uzun so'z bo'linadi va sig'adi
  const longWord = fitText({ ...box, text: 'A'.repeat(300) });
  check('uzun so\'z bo\'linadi va sig\'adi', longWord.lines.length > 1 && fits(longWord), JSON.stringify([longWord.size, longWord.lines.length]));

  // Bo'sh matn
  const empty = fitText({ ...box, text: '   \n  ' });
  check('bo\'sh matn -> o\'lcham 0', empty.size === 0 && empty.lines.length === 0);

  // wrapLines hech qachon kenglikdan oshmaydi (bir belgili holatdan tashqari)
  const wrapped = wrapLines('bir ikki uch to\'rt besh olti yetti sakkiz to\'qqiz o\'n', 20, 120, measure);
  check('wrapLines qatorlari kenglikka sig\'adi', wrapped.every((l) => measure(l, 20) <= 120), JSON.stringify(wrapped));

  // Juda kichik maydon ham ishlaydi (cheksiz tsikl yoki xato bo'lmasin)
  const tiny = fitText({ boxW: 5, boxH: 5, lineHeight: LH, measure, text: 'Salom dunyo' });
  check('juda kichik maydonda ham natija qaytadi', tiny.size >= 1 && tiny.lines.length > 0);
}

/* --------------------------------- 3c. layout.js fill rejimi (matn uchun) */
section('3c) Matn uchun "fill" rejimi');
{
  const n = 2;
  const bs = blockShape(subpixelCount(n));
  const base = { paper: 'A4', orientation: 'portrait', n, mode: 'sheet', moduleMm: 0.5, blockRows: bs.rows, blockCols: bs.cols };
  const img = computeLayout({ ...base, imgAspect: 1 });
  const fill = computeLayout({ ...base, imgAspect: 1, fill: true });
  check(`fill maydoni kattaroq (${(img.imageWmm * img.imageHmm / 100).toFixed(0)} -> ${(fill.imageWmm * fill.imageHmm / 100).toFixed(0)} cm²)`,
    fill.imageWmm * fill.imageHmm > img.imageWmm * img.imageHmm);
  check('fill: ulushlar varaq ichida', fill.placements.every((p) => p.frameX >= 0 && p.frameY >= 0
    && p.frameX + p.frameW <= fill.pageW + 1e-6 && p.frameY + p.frameH <= fill.pageH + 1e-6));
  for (let k = 2; k <= 8; k++) {
    const b = blockShape(subpixelCount(k));
    const l = computeLayout({ paper: 'A4', orientation: 'portrait', n: k, mode: 'sheet', moduleMm: 0.4, imgAspect: 1, fill: true, blockRows: b.rows, blockCols: b.cols });
    const ok = l.placements.length === k
      && l.placements.every((p) => p.frameX >= 0 && p.frameX + p.frameW <= l.pageW + 1e-6 && p.frameY + p.frameH <= l.pageH + 1e-6)
      && l.moduleCols * l.moduleRows <= 6.5e6;
    if (!ok) check(`fill n=${k}`, false, JSON.stringify({ w: l.imageWmm, h: l.imageHmm }));
  }
  check('fill: n = 2..8 uchun joylashuv yaroqli', true);
}

/* ------------------------------------------------------------ 4. layout.js */
section('4) Qog\'oz joylashuvi');
{
  const L = computeLayout({ paper: 'A4', orientation: 'portrait', n: 2, mode: 'sheet', moduleMm: 0.35, imgAspect: 1, blockRows: 1, blockCols: 2 });
  check('A4 o\'lchami 210x297', L.pageW === 210 && L.pageH === 297);
  check('2 ulush bitta varaqda', L.pageCount === 1 && L.placements.length === 2);
  check('yirtish chizig\'i mavjud', L.cuts.length === 1);
  check('nisbat saqlangan (kvadrat rasm -> kvadrat maydon)', Math.abs(L.imageWmm / L.imageHmm - 1) < 0.02, `${L.imageWmm}x${L.imageHmm}`);
  const inPage = L.placements.every((p) => p.frameX > 0 && p.frameY > 0 && p.frameX + p.frameW < L.pageW && p.frameY + p.frameH < L.pageH);
  check('hamma ulush varaq ichida', inPage);
  const [a, b] = L.placements;
  const overlap = !(a.frameX + a.frameW <= b.frameX || b.frameX + b.frameW <= a.frameX || a.frameY + a.frameH <= b.frameY || b.frameY + b.frameH <= a.frameY);
  check('ulushlar ustma-ust tushmaydi', !overlap);
  check('ikkala ulush bir xil o\'lchamda', a.frameW === b.frameW && a.frameH === b.frameH);

  for (let n = 2; n <= 8; n++) {
    for (const mode of ['sheet', 'pages']) {
      for (const paper of Object.keys(PAPERS)) {
        for (const orientation of ['portrait', 'landscape']) {
          const l = computeLayout({ paper, orientation, n, mode, moduleMm: 0.3, imgAspect: 4 / 3, blockRows: blockShape(subpixelCount(n)).rows, blockCols: blockShape(subpixelCount(n)).cols });
          // Juda kichik natijalar (ilova ogohlantirish beradi) uchun nisbat aniqligi talab qilinmaydi
          const tiny = l.pixelW < 20 || l.pixelH < 20;
          const aspectErr = Math.abs((l.imageWmm / l.imageHmm) / (4 / 3) - 1);
          const ok = l.placements.length === n
            && l.placements.every((p) => p.frameX >= 0 && p.frameY >= 0 && p.frameX + p.frameW <= l.pageW + 1e-6 && p.frameY + p.frameH <= l.pageH + 1e-6)
            && (tiny || aspectErr < 0.02)
            && l.moduleCols * l.moduleRows <= 6.5e6;
          if (!ok) check(`layout ${paper}/${orientation}/${mode}/n=${n}`, false, JSON.stringify({ iw: l.imageWmm, ih: l.imageHmm, px: [l.pixelW, l.pixelH], aspectErr: +aspectErr.toFixed(4), mods: l.moduleCols * l.moduleRows }));
        }
      }
    }
  }
  check('barcha qog\'oz/yo\'nalish/rejim/n kombinatsiyalari yaroqli', true);

  const LP = computeLayout({ paper: 'A4', orientation: 'portrait', n: 4, mode: 'pages', moduleMm: 0.35, imgAspect: 1, blockRows: 2, blockCols: 4 });
  check('pages rejimi: 4 varaq', LP.pageCount === 4 && LP.cuts.length === 0);
  check('pages rejimi: har varaqda 1 ulush', [0, 1, 2, 3].every((p) => LP.placements.filter((q) => q.page === p).length === 1));
}

/* --------------------------------------------------------------- 5. pdf.js */
section('5) PDF generatori');
{
  // Bit paketlashni teskari yo'l bilan tekshirish
  const w = 13, h = 5, rng = makeRng(99);
  const bits = new Uint8Array(w * h);
  for (let i = 0; i < bits.length; i++) bits[i] = rng() < 0.5 ? 1 : 0;
  const { data, rowBytes } = packOneBit(bits, w, h);
  check('rowBytes = ceil(w/8)', rowBytes === Math.ceil(w / 8));
  let roundTrip = true;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
      if ((bit === 0 ? 1 : 0) !== bits[y * w + x]) roundTrip = false;
    }
  }
  check('1-bitli paketlash teskari o\'qilganda mos (0 = qora)', roundTrip);
}

function validatePdf(bytes) {
  const s = Buffer.from(bytes).toString('latin1');
  const problems = [];
  if (!s.startsWith('%PDF-1.')) problems.push('sarlavha yo\'q');
  if (!s.trimEnd().endsWith('%%EOF')) problems.push('%%EOF yo\'q');
  const m = s.match(/startxref\s+(\d+)\s+%%EOF\s*$/);
  if (!m) problems.push('startxref topilmadi');
  else {
    const off = Number(m[1]);
    if (s.slice(off, off + 4) !== 'xref') problems.push('startxref xref ga ishora qilmaydi');
    const head = s.slice(off).match(/xref\n0 (\d+)\n/);
    if (!head) problems.push('xref sarlavhasi buzilgan');
    else {
      const count = Number(head[1]); // 0-obyekt ham hisobga olinadi
      const entries = s.slice(off + head[0].length, off + head[0].length + count * 20);
      if (entries.slice(0, 20) !== '0000000000 65535 f \n') problems.push('bo\'sh (free) yozuv formati buzilgan');
      for (let i = 1; i < count; i++) {
        const e = entries.slice(i * 20, i * 20 + 20);
        if (!/^\d{10} \d{5} n \n$/.test(e)) { problems.push(`xref yozuvi ${i} formati buzilgan: ${JSON.stringify(e)}`); continue; }
        const o = Number(e.slice(0, 10));
        if (!s.slice(o).startsWith(`${i} 0 obj`)) problems.push(`obj ${i} ofseti xato (${o})`);
      }
      const trailerSize = Number((s.match(/\/Size (\d+)/) || [])[1]);
      if (trailerSize !== count) problems.push('trailer /Size xato');
    }
  }
  // Har bir oqim uzunligini tekshirish
  const re = /\/Length (\d+) >>\nstream\n/g;
  let hit, streams = 0;
  while ((hit = re.exec(s))) {
    const declared = Number(hit[1]);
    const start = hit.index + hit[0].length;
    if (s.slice(start + declared, start + declared + 11) !== '\nendstream\n' && s.slice(start + declared, start + declared + 10) !== '\nendstream') {
      problems.push(`oqim uzunligi xato (declared=${declared})`);
    }
    streams++;
  }
  return { problems, streams, objCount: (s.match(/\n\d+ 0 obj\n/g) || []).length + 1, pages: (s.match(/\/Type \/Page[^s]/g) || []).length };
}

{
  const n = 3, rng = makeRng(42);
  const w = 40, h = 30;
  const bs = blockShape(subpixelCount(n));
  const L = computeLayout({ paper: 'A4', orientation: 'portrait', n, mode: 'sheet', moduleMm: 0.4, imgAspect: w / h, blockRows: bs.rows, blockCols: bs.cols });
  const bin = new Uint8Array(L.pixelW * L.pixelH);
  for (let i = 0; i < bin.length; i++) bin[i] = rng() < 0.4 ? 1 : 0;
  const g = encodeShares(bin, L.pixelW, L.pixelH, n, rng);
  const pdf = buildSheetPdf({ shares: g.shares, moduleCols: g.width, moduleRows: g.height, layout: L, meta: { paper: 'A4', n, m: g.m } });
  const v = validatePdf(pdf);
  check('PDF strukturasi yaroqli', v.problems.length === 0, v.problems.join('; '));
  check('PDF da 1 sahifa', v.pages === 1, `pages=${v.pages}`);
  check(`PDF da ${n} rasm + 1 kontent oqimi`, v.streams === n + 1, `streams=${v.streams}`);
  writeFileSync(join(OUT, 'sample-a4-n3.pdf'), pdf);

  // PDF ichidagi rasm baytlarini qayta o'qib, ulush bilan solishtirish
  const buf = Buffer.from(pdf);
  const s = buf.toString('latin1');
  const idx = s.indexOf('/Subtype /Image');
  const dictEnd = s.indexOf('stream\n', idx) + 7;
  const lenMatch = s.slice(idx, dictEnd).match(/\/Length (\d+)/);
  const wMatch = s.slice(idx, dictEnd).match(/\/Width (\d+)/);
  const hMatch = s.slice(idx, dictEnd).match(/\/Height (\d+)/);
  const imgW = Number(wMatch[1]), imgH = Number(hMatch[1]);
  const raw = buf.subarray(dictEnd, dictEnd + Number(lenMatch[1]));
  const rowBytes = (imgW + 7) >> 3;
  let same = imgW === g.width && imgH === g.height && raw.length === rowBytes * imgH;
  if (same) {
    for (let y = 0; y < imgH && same; y++) {
      for (let x = 0; x < imgW; x++) {
        const bit = (raw[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        if ((bit === 0 ? 1 : 0) !== g.shares[0][y * imgW + x]) { same = false; break; }
      }
    }
  }
  check('PDF ichidagi rasm baytlari 1-ulushga aynan mos', same);

  const multi = buildPdf(buildSheetDoc({
    shares: g.shares, moduleCols: g.width, moduleRows: g.height,
    layout: computeLayout({ paper: 'A5', orientation: 'landscape', n, mode: 'pages', moduleMm: 0.4, imgAspect: w / h, blockRows: bs.rows, blockCols: bs.cols }),
    meta: { paper: 'A5', n, m: g.m },
  }));
  const v2 = validatePdf(multi);
  check('ko\'p sahifali PDF yaroqli', v2.problems.length === 0 && v2.pages === n, `${v2.problems.join('; ')} pages=${v2.pages}`);
}

/* --------------------------------------------------------------- 6. bmp.js */
section('6) BMP dekoderi');
{
  // 24-bitli kichik BMP ni qo'lda yasab, o'qib ko'ramiz
  const w = 3, h = 2;
  const stride = ((w * 3 + 3) & ~3);
  const size = 54 + stride * h;
  const b = Buffer.alloc(size);
  b.write('BM', 0, 'ascii');
  b.writeUInt32LE(size, 2); b.writeUInt32LE(54, 10); b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18); b.writeInt32LE(h, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(24, 28);
  const px = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255], [0, 0, 0], [128, 128, 128]];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, gg, bb] = px[(h - 1 - y) * w + x]; // BMP pastdan yuqoriga
      const o = 54 + y * stride + x * 3;
      b[o] = bb; b[o + 1] = gg; b[o + 2] = r;
    }
  }
  const dec = decodeBmp(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  let ok = dec.width === w && dec.height === h;
  for (let i = 0; i < w * h && ok; i++) {
    const [r, gg, bb] = px[i];
    if (dec.data[i * 4] !== r || dec.data[i * 4 + 1] !== gg || dec.data[i * 4 + 2] !== bb) ok = false;
  }
  check('24-bitli BMP to\'g\'ri o\'qiladi (qatorlar tartibi ham)', ok);
}

/* ------------------------------------- 7. To'liq quvur + ko'rish uchun PNG */
section('7) To\'liq quvur (natijalar test/out/ ichida)');
{
  // Sinov rasmi: kulgichli yuz + gradient
  const sw = 360, sh = 360;
  const rgba = new Uint8ClampedArray(sw * sh * 4);
  const set = (x, y, v) => { const p = (y * sw + x) * 4; rgba[p] = rgba[p + 1] = rgba[p + 2] = v; rgba[p + 3] = 255; };
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const cx = x - sw / 2, cy = y - sh / 2;
      const r = Math.hypot(cx, cy);
      let v = 255;
      if (r > sw * 0.46) v = 235;
      if (Math.abs(r - sw * 0.42) < 7) v = 0;                                  // yuz chizig'i
      if (Math.hypot(cx + 60, cy + 55) < 26 || Math.hypot(cx - 60, cy + 55) < 26) v = 0;  // ko'zlar
      if (r > sw * 0.2 && r < sw * 0.27 && cy > 40) v = 0;                     // tabassum
      set(x, y, v);
    }
  }
  writeFileSync(join(OUT, '00-source.png'), grayPng(Uint8Array.from({ length: sw * sh }, (_, i) => rgba[i * 4]), sw, sh));

  for (const n of [2, 3, 4]) {
    const bs = blockShape(subpixelCount(n));
    const L = computeLayout({ paper: 'A4', orientation: 'portrait', n, mode: 'sheet', moduleMm: 0.3, imgAspect: sw / sh, blockRows: bs.rows, blockCols: bs.cols });
    const { binary } = prepareBinary(rgba, sw, sh, L.pixelW, L.pixelH, { method: 'fs' });
    const g = encodeShares(binary, L.pixelW, L.pixelH, n, makeRng(2024 + n));

    const light = simulateStack(g.shares, g);
    const gray = new Uint8Array(L.pixelW * L.pixelH);
    // ko'rish uchun: o'tgan yorug'likni to'liq diapazonga cho'zamiz
    for (let i = 0; i < gray.length; i++) gray[i] = Math.round(Math.min(1, light[i] * g.m) * 255);

    writeFileSync(join(OUT, `n${n}-01-binary.png`), bitsPng(binary, L.pixelW, L.pixelH, 1));
    writeFileSync(join(OUT, `n${n}-02-share1.png`), bitsPng(g.shares[0], g.width, g.height, 1));
    writeFileSync(join(OUT, `n${n}-03-share2.png`), bitsPng(g.shares[1], g.width, g.height, 1));
    writeFileSync(join(OUT, `n${n}-04-stacked.png`), bitsPng(stackShares(g.shares, g.width, g.height), g.width, g.height, 1));
    writeFileSync(join(OUT, `n${n}-05-revealed.png`), grayPng(gray, L.pixelW, L.pixelH));

    const pdf = buildSheetPdf({ shares: g.shares, moduleCols: g.width, moduleRows: g.height, layout: L, meta: { paper: 'A4', n, m: g.m, fileName: 'test.png' } });
    writeFileSync(join(OUT, `n${n}-sheet-a4.pdf`), pdf);

    // Tiklangan tasvir asl binar tasvir bilan mos kelishi kerak
    let mismatch = 0;
    for (let i = 0; i < binary.length; i++) {
      const expected = binary[i] ? 0 : 1 / g.m;
      if (Math.abs(light[i] - expected) > 1e-6) mismatch++;
    }
    check(`n=${n}: to'liq quvur -> tiklangan tasvir binar tasvirga aynan teng (${L.pixelW}x${L.pixelH} px, modul ${L.moduleMm.toFixed(2)}mm, ${L.imageWmm.toFixed(0)}x${L.imageHmm.toFixed(0)}mm)`, mismatch === 0, `farq=${mismatch}`);
    check(`n=${n}: PDF hajmi mantiqiy (${(pdf.length / 1024).toFixed(0)} KB)`, pdf.length > 1000 && pdf.length < 20e6);
  }
}

console.log(results.join('\n'));
console.log(`\n${pass} ta test o'tdi, ${fail} ta xato`);
process.exit(fail ? 1 : 0);

/**
 * Qog'ozdagi joylashuvni hisoblash: qaysi ulush qayerga, qanday o'lchamda
 * bosiladi, yirtish chiziqlari qayerda bo'ladi, modul (subpiksel) necha mm.
 * Barcha o'lchamlar millimetrda, koordinata boshi — varaqning chap-yuqori burchagi.
 */

export const PAPERS = {
  A3: { label: 'A3 — 297 × 420 mm', w: 297, h: 420 },
  A4: { label: 'A4 — 210 × 297 mm', w: 210, h: 297 },
  A5: { label: 'A5 — 148 × 210 mm', w: 148, h: 210 },
  A6: { label: 'A6 — 105 × 148 mm', w: 105, h: 148 },
  Letter: { label: 'Letter — 216 × 279 mm', w: 215.9, h: 279.4 },
  Legal: { label: 'Legal — 216 × 356 mm', w: 215.9, h: 355.6 },
};

/**
 * n ta ulush uchun eng qulay setka (ustun × qator) ni tanlaydi.
 * `fill = true` bo'lsa tasvir nisbati ahamiyatsiz (masalan matn) —
 * shunchaki bo'sh maydoni eng katta setka tanlanadi.
 */
function bestGrid(n, pageW, pageH, marginMm, gutterMm, padMm, cellAspect, fill = false) {
  let best = null;
  for (let gc = 1; gc <= n; gc++) {
    const gr = Math.ceil(n / gc);
    const cellW = (pageW - 2 * marginMm - (gc - 1) * gutterMm) / gc;
    const cellH = (pageH - 2 * marginMm - (gr - 1) * gutterMm) / gr;
    const innerW = cellW - 2 * padMm;
    const innerH = cellH - 2 * padMm;
    if (innerW <= 5 || innerH <= 5) continue;
    let iw = fill ? innerW : Math.min(innerW, innerH * cellAspect);
    let ih = fill ? innerH : iw / cellAspect;
    const area = iw * ih;
    const waste = gc * gr - n;
    if (!best || area > best.area * 1.0001 || (Math.abs(area - best.area) <= best.area * 0.0001 && waste < best.waste)) {
      best = { gc, gr, cellW, cellH, innerW, innerH, iw, ih, area, waste };
    }
  }
  if (!best) throw new Error('Qog\'oz juda kichik: chegara yoki ulushlar sonini o\'zgartiring.');
  return best;
}

/**
 * Piksel setkasini tanlash: maydonni deyarli yo'qotmagan holda (>= 90%)
 * tasvir nisbatini eng aniq saqlaydigan butun o'lchamlarni topadi.
 * Faqat "eng kattasini olib, qolganini floor qilish" nisbatni buzadi
 * (masalan 12x19 o'rniga 12x18 kerak bo'ladi).
 */
export function fitPixelGrid(maxW, maxH, ratio) {
  const cands = [];
  const stepsW = Math.max(1, Math.min(8, Math.round(maxW * 0.12)));
  const stepsH = Math.max(1, Math.min(8, Math.round(maxH * 0.12)));
  const add = (w, h) => {
    if (w >= 1 && h >= 1 && w <= maxW && h <= maxH) {
      cands.push({ w, h, err: Math.abs((w / h) / ratio - 1), area: w * h });
    }
  };
  for (let h = maxH; h >= Math.max(1, maxH - stepsH); h--) {
    add(Math.floor(h * ratio), h);
    add(Math.ceil(h * ratio), h);
  }
  for (let w = maxW; w >= Math.max(1, maxW - stepsW); w--) {
    add(w, Math.floor(w / ratio));
    add(w, Math.ceil(w / ratio));
  }
  if (!cands.length) return { w: Math.max(1, maxW), h: Math.max(1, maxH) };
  const maxArea = Math.max(...cands.map((c) => c.area));
  // Ballar: nisbat xatosi asosiy, maydon yo'qotishi ikkilamchi (koef. 0.1)
  const good = cands.filter((c) => c.area >= maxArea * 0.7);
  good.sort((a, b) => {
    const sa = a.err + 0.1 * (1 - a.area / maxArea);
    const sb = b.err + 0.1 * (1 - b.area / maxArea);
    return (sa - sb) || (b.area - a.area);
  });
  return good[0];
}

/**
 * @param {object} o
 * @param {string} o.paper        PAPERS kaliti
 * @param {'portrait'|'landscape'} o.orientation
 * @param {number} o.n            ulushlar soni
 * @param {'sheet'|'pages'} o.mode 'sheet' = hammasi bitta varaqda (yirtib ishlatiladi)
 * @param {number} o.marginMm
 * @param {number} o.gutterMm     ulushlar orasidagi yirtish yo'lagi
 * @param {number} o.moduleMm     bitta modulning tomoni
 * @param {number} o.imgAspect    asl rasm nisbati (kenglik/balandlik)
 * @param {number} o.blockRows    bitta piksel bloki: qatorlar
 * @param {number} o.blockCols    bitta piksel bloki: ustunlar
 */
export function computeLayout(o) {
  const {
    paper = 'A4', orientation = 'portrait', n = 2, mode = 'sheet',
    marginMm = 8, gutterMm = 6, imgAspect = 1,
    blockRows = 1, blockCols = 2,
    frameGapMm = 1.5, labelMm = 4.5, maxModules = 6e6, minPixels = 12,
    fill = false,
  } = o;
  let moduleMm = o.moduleMm ?? 0.35;

  const p = PAPERS[paper];
  if (!p) throw new Error('Noma\'lum qog\'oz formati: ' + paper);
  const pageW = orientation === 'landscape' ? p.h : p.w;
  const pageH = orientation === 'landscape' ? p.w : p.h;

  const warnings = [];
  const padMm = frameGapMm + 1 + labelMm; // ramka + burchak belgilari + yozuv uchun joy
  const blockAspect = blockCols / blockRows;
  // Blok kvadrat bo'lmagani uchun manba piksel setkasini oldindan "siqamiz",
  // shunda bosilgan tasvir nisbati asl rasm nisbatiga teng bo'ladi.
  const pixelRatio = imgAspect / blockAspect; // pixelW / pixelH

  const perPage = mode === 'pages' ? 1 : n;
  const grid = bestGrid(perPage, pageW, pageH, marginMm, gutterMm, padMm, imgAspect, fill);

  let pixelW = 0, pixelH = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    const maxPxW = Math.max(1, Math.floor(grid.innerW / moduleMm / blockCols));
    const maxPxH = Math.max(1, Math.floor(grid.innerH / moduleMm / blockRows));
    // fill: nisbatni saqlash shart emas, butun maydon ishlatiladi (matn rejimi)
    const fit = fill ? { w: maxPxW, h: maxPxH } : fitPixelGrid(maxPxW, maxPxH, pixelRatio);
    pixelW = fit.w;
    pixelH = fit.h;
    const total = pixelW * blockCols * pixelH * blockRows;
    if (total <= maxModules || pixelW < minPixels || pixelH < minPixels) break;
    moduleMm = +(moduleMm * Math.sqrt(total / maxModules)).toFixed(4);
    if (attempt === 0) {
      warnings.push(
        `Modul o'lchami unumdorlik uchun ${moduleMm.toFixed(2)} mm ga kattalashtirildi ` +
        `(aks holda bitta ulushda ${(total / 1e6).toFixed(1)} mln modul bo'lardi).`
      );
    }
  }

  if (pixelW < minPixels || pixelH < minPixels) {
    warnings.push('Tasvir juda kichik chiqdi: modul o\'lchamini kichraytiring, kattaroq qog\'oz tanlang yoki ulushlar sonini kamaytiring.');
    pixelW = Math.max(1, pixelW);
    pixelH = Math.max(1, pixelH);
  } else if (pixelW < 60 || pixelH < 60) {
    warnings.push(`Aniqlik past (${pixelW} x ${pixelH} piksel): kattaroq qog'oz, kichikroq modul yoki "har biri alohida varaqda" rejimi natijani yaxshilaydi.`);
  }

  const moduleCols = pixelW * blockCols;
  const moduleRows = pixelH * blockRows;
  const imageWmm = moduleCols * moduleMm;
  const imageHmm = moduleRows * moduleMm;

  const placements = [];
  for (let i = 0; i < n; i++) {
    const page = mode === 'pages' ? i : 0;
    const slot = mode === 'pages' ? 0 : i;
    const gx = slot % grid.gc;
    const gy = Math.floor(slot / grid.gc);
    const cellX = marginMm + gx * (grid.cellW + gutterMm);
    const cellY = marginMm + gy * (grid.cellH + gutterMm);
    const imgX = cellX + (grid.cellW - imageWmm) / 2;
    const imgY = cellY + (grid.cellH - labelMm - imageHmm) / 2;
    placements.push({
      share: i, page,
      cellX, cellY, cellW: grid.cellW, cellH: grid.cellH,
      imgX, imgY, imgW: imageWmm, imgH: imageHmm,
      frameX: imgX - frameGapMm, frameY: imgY - frameGapMm,
      frameW: imageWmm + 2 * frameGapMm, frameH: imageHmm + 2 * frameGapMm,
      labelX: imgX, labelY: imgY + imageHmm + frameGapMm + 3.2,
    });
  }

  // Yirtish/kesish chiziqlari (faqat bitta varaqqa joylashtirilganda)
  const cuts = [];
  if (mode === 'sheet') {
    for (let i = 1; i < grid.gc; i++) {
      const x = marginMm + i * grid.cellW + (i - 0.5) * gutterMm;
      cuts.push({ x1: x, y1: 4, x2: x, y2: pageH - 4 });
    }
    for (let i = 1; i < grid.gr; i++) {
      const y = marginMm + i * grid.cellH + (i - 0.5) * gutterMm;
      cuts.push({ x1: 4, y1: y, x2: pageW - 4, y2: y });
    }
  }

  return {
    pageW, pageH, pageCount: mode === 'pages' ? n : 1,
    grid: { cols: grid.gc, rows: grid.gr },
    mode, moduleMm, pixelW, pixelH, moduleCols, moduleRows,
    imageWmm, imageHmm, placements, cuts, warnings,
    frameGapMm, labelMm,
  };
}

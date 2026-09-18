/**
 * Layout + ulushlar -> chop etishga tayyor PDF hujjati.
 * Har bir ulush atrofida bir xil ramka, burchak va o'rta belgilar bo'ladi —
 * ulushlarni ustma-ust qo'yganda aynan shu belgilar bo'yicha moslanadi.
 */
import { buildPdf } from './pdf.js';

const MARK = 4;      // burchak belgisi uzunligi, mm
const HAIR = 0.18;   // nozik chiziq qalinligi, mm

function alignmentMarks(pl) {
  const rects = [{ x: pl.frameX, y: pl.frameY, w: pl.frameW, h: pl.frameH, widthMm: HAIR }];
  const lines = [];
  const { frameX: x, frameY: y, frameW: w, frameH: h } = pl;
  const g = 0.8; // ramkadan belgigacha bo'shliq
  const corners = [
    [x, y, -1, -1], [x + w, y, 1, -1],
    [x, y + h, -1, 1], [x + w, y + h, 1, 1],
  ];
  for (const [cx, cy, sx, sy] of corners) {
    lines.push({ x1: cx + sx * g, y1: cy, x2: cx + sx * (g + MARK), y2: cy, widthMm: HAIR });
    lines.push({ x1: cx, y1: cy + sy * g, x2: cx, y2: cy + sy * (g + MARK), widthMm: HAIR });
  }
  // Tomonlarning o'rtasidagi belgilar
  const mid = [
    [x + w / 2, y, 0, -1], [x + w / 2, y + h, 0, 1],
    [x, y + h / 2, -1, 0], [x + w, y + h / 2, 1, 0],
  ];
  for (const [cx, cy, sx, sy] of mid) {
    lines.push({ x1: cx + sx * g, y1: cy + sy * g, x2: cx + sx * (g + 2.5), y2: cy + sy * (g + 2.5), widthMm: HAIR });
  }
  return { rects, lines };
}

/**
 * @param {object} p
 * @param {Uint8Array[]} p.shares       modul massivlari (1 = siyoh)
 * @param {number} p.moduleCols
 * @param {number} p.moduleRows
 * @param {object} p.layout             computeLayout() natijasi
 * @param {object} [p.meta]             { paper, orientation, n, m, fileName }
 */
export function buildSheetDoc({ shares, moduleCols, moduleRows, layout, meta = {} }) {
  const pages = [];
  for (let pageIndex = 0; pageIndex < layout.pageCount; pageIndex++) {
    const page = {
      widthMm: layout.pageW, heightMm: layout.pageH,
      images: [], rects: [], lines: [], texts: [],
    };

    for (const pl of layout.placements.filter((q) => q.page === pageIndex)) {
      page.images.push({
        bits: shares[pl.share], w: moduleCols, h: moduleRows,
        xMm: pl.imgX, yMm: pl.imgY, wMm: pl.imgW, hMm: pl.imgH,
      });
      const marks = alignmentMarks(pl);
      page.rects.push(...marks.rects);
      page.lines.push(...marks.lines);
      page.texts.push({
        x: pl.labelX, y: pl.labelY, size: 7,
        text: `ULUSH ${pl.share + 1} / ${shares.length}  -  hammasini ustma-ust qo'ying`,
      });
    }

    for (const c of layout.cuts) {
      page.lines.push({ ...c, widthMm: 0.25, dash: [2, 1.6], gray: 0.45 });
    }

    const parts = [
      `${meta.n ?? shares.length} ulush`,
      `${meta.paper ?? ''} ${layout.mode === 'sheet' ? '(bitta varaq)' : `(varaq ${pageIndex + 1}/${layout.pageCount})`}`,
      `modul ${layout.moduleMm.toFixed(2)} mm`,
      `${layout.pixelW} x ${layout.pixelH} piksel`,
      `kontrast 1/${meta.m ?? '?'}`,
    ];
    page.texts.push({
      x: 6, y: layout.pageH - 3, size: 6, gray: 0.35,
      text: `QR Amazing (visual cryptography): ${parts.join('  |  ')}${meta.fileName ? '  |  ' + meta.fileName : ''}`,
    });
    pages.push(page);
  }

  return { title: `QR Amazing - ${shares.length} ulush`, pages };
}

export function buildSheetPdf(args) {
  return buildPdf(buildSheetDoc(args));
}

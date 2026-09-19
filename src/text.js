/**
 * Matndan tasvir yasash: qatorlarga bo'lish va **avtomatik shrift o'lchami**.
 *
 * Asosiy g'oya: matn ko'p bo'lsa harflar kichrayadi, kam bo'lsa kattalashadi —
 * ya'ni har doim berilgan maydonni to'liq egallaydi. O'lcham binar izlash
 * (binary search) bilan topiladi: eng katta shunday o'lcham-ki, matn hali ham
 * maydonga sig'adi.
 *
 * O'lchash funksiyasi (`measure`) tashqaridan beriladi, shuning uchun mantiqni
 * brauzersiz (Node testlarida) ham tekshirish mumkin.
 */

export const FONTS = {
  sans: { label: 'Sans (Arial)', css: 'Arial, Helvetica, "Liberation Sans", sans-serif' },
  serif: { label: 'Serif (Georgia)', css: 'Georgia, "Times New Roman", "Liberation Serif", serif' },
  mono: { label: 'Monospace', css: '"Courier New", "Liberation Mono", monospace' },
  system: { label: 'Tizim shrifti', css: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
};

/**
 * Matnni berilgan kenglikka sig'adigan qatorlarga bo'ladi.
 * Aniq qator ko'chirishlar (\n) saqlanadi, uzun so'zlar zarur bo'lsa bo'linadi.
 *
 * @param {string} text
 * @param {number} size          shrift o'lchami
 * @param {number} maxWidth      ruxsat etilgan kenglik
 * @param {(t: string, size: number) => number} measure
 * @returns {string[]}
 */
export function wrapLines(text, size, maxWidth, measure) {
  const out = [];
  const paragraphs = String(text).replace(/\r\n?/g, '\n').split('\n');

  for (const para of paragraphs) {
    const words = para.split(/[ \t]+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }

    let line = '';
    for (let word of words) {
      // Bitta so'zning o'zi sig'masa — bo'g'inlab (belgilab) bo'lamiz
      while (measure(word, size) > maxWidth && word.length > 1) {
        let k = 1;
        while (k < word.length && measure(word.slice(0, k + 1), size) <= maxWidth) k++;
        if (line) { out.push(line); line = ''; }
        out.push(word.slice(0, k));
        word = word.slice(k);
      }
      if (!word) continue;

      const candidate = line ? line + ' ' + word : word;
      if (measure(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line) out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * Maydonga sig'adigan eng katta shrift o'lchamini topadi.
 *
 * @param {object} o
 * @param {string} o.text
 * @param {number} o.boxW         maydon kengligi (px)
 * @param {number} o.boxH         maydon balandligi (px)
 * @param {number} [o.lineHeight] qator qadami (shrift o'lchamiga nisbatan)
 * @param {(t: string, size: number) => number} o.measure
 * @param {number} [o.maxSize]
 * @returns {{ size: number, lines: string[], width: number, height: number }}
 */
export function fitText({ text, boxW, boxH, lineHeight = 1.2, measure, maxSize }) {
  const clean = String(text ?? '');
  if (!clean.trim()) return { size: 0, lines: [], width: 0, height: 0 };

  const widest = (lines, size) => lines.reduce((mx, l) => Math.max(mx, l ? measure(l, size) : 0), 0);
  const upper = Math.max(2, Math.floor(maxSize ?? boxH));

  let lo = 1, hi = upper, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const lines = wrapLines(clean, mid, boxW, measure);
    const height = lines.length * mid * lineHeight;
    const width = widest(lines, mid);
    if (height <= boxH && width <= boxW) {
      best = { size: mid, lines, width, height };
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (!best) {
    // Hatto 1 px ham sig'masa (juda kichik maydon) — eng kichigini qaytaramiz
    const lines = wrapLines(clean, 1, Math.max(1, boxW), measure);
    best = { size: 1, lines, width: widest(lines, 1), height: lines.length * lineHeight };
  }
  return best;
}

/**
 * Matnni canvas ga chizadi (faqat brauzer).
 * Maydon o'lchami canvas o'lchamidan chekka bo'shliq (padPercent) ayirib olinadi.
 *
 * @returns {{ size: number, lines: string[], lineHeight: number,
 *             boxW: number, boxH: number }} tanlangan o'lcham va qatorlar
 */
export function renderTextToCanvas(canvas, {
  text, width, height, font = 'sans', bold = true, italic = false,
  align = 'center', padPercent = 6, lineHeight = 1.2, invert = false,
}) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const family = (FONTS[font] || FONTS.sans).css;
  const spec = (size) => `${italic ? 'italic ' : ''}${bold ? '700' : '400'} ${size}px ${family}`;
  const measure = (t, size) => { ctx.font = spec(size); return ctx.measureText(t).width; };

  const pad = (Math.min(width, height) * padPercent) / 100;
  const boxW = Math.max(1, width - 2 * pad);
  const boxH = Math.max(1, height - 2 * pad);

  const fit = fitText({ text, boxW, boxH, lineHeight, measure });

  ctx.fillStyle = invert ? '#000' : '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = invert ? '#fff' : '#000';
  ctx.textBaseline = 'top';
  ctx.font = spec(fit.size);
  ctx.textAlign = align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';

  const step = fit.size * lineHeight;
  const total = fit.lines.length * step;
  let y = (height - total) / 2;
  const x = align === 'center' ? width / 2 : align === 'right' ? width - pad : pad;

  for (const line of fit.lines) {
    // Qator qadamining ichida harfni vertikal o'rtaga qo'yamiz
    ctx.fillText(line, x, y + (step - fit.size) / 2);
    y += step;
  }

  return { ...fit, lineHeight, boxW, boxH };
}

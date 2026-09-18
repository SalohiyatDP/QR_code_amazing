/**
 * Rasmni tayyorlash: RGBA -> kulrang -> o'lchamni o'zgartirish -> tuzatish -> binarizatsiya.
 * Hamma funksiyalar sof JS (brauzer ham, Node ham ishlatadi).
 * Kulranglik konvensiyasi: 0 = qora, 1 = oq.
 */

/** RGBA baytlardan yorqinlik (luma) massivi. Shaffof piksellar oq fonga qo'yiladi. */
export function rgbaToLuma(rgba, w, h) {
  const out = new Float32Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const a = rgba[p + 3] / 255;
    const r = rgba[p] / 255, g = rgba[p + 1] / 255, b = rgba[p + 2] / 255;
    // sRGB luma + oq fon bilan alpha-kompozit
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    out[i] = y * a + (1 - a);
  }
  return out;
}

/** Box-filter bilan o'lchamni o'zgartirish (kichraytirishda aliasing bo'lmaydi). */
export function resample(src, sw, sh, dw, dh) {
  const out = new Float32Array(dw * dh);
  const xr = sw / dw, yr = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = y * yr, y1 = (y + 1) * yr;
    const iy0 = Math.floor(y0), iy1 = Math.min(sh, Math.ceil(y1));
    for (let x = 0; x < dw; x++) {
      const x0 = x * xr, x1 = (x + 1) * xr;
      const ix0 = Math.floor(x0), ix1 = Math.min(sw, Math.ceil(x1));
      let sum = 0, wsum = 0;
      for (let sy = iy0; sy < iy1; sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        if (wy <= 0) continue;
        for (let sx = ix0; sx < ix1; sx++) {
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
          if (wx <= 0) continue;
          const wgt = wx * wy;
          sum += src[sy * sw + sx] * wgt;
          wsum += wgt;
        }
      }
      out[y * dw + x] = wsum > 0 ? sum / wsum : 1;
    }
  }
  return out;
}

/**
 * Yorqinlik/kontrast/gamma/invert va ixtiyoriy "auto-levels".
 * brightness: -1..1, contrast: -1..1, gamma: 0.2..5
 */
export function adjust(lum, { brightness = 0, contrast = 0, gamma = 1, invert = false, autoLevels = false } = {}) {
  const out = new Float32Array(lum.length);
  let lo = 0, hi = 1;
  if (autoLevels) {
    lo = 1; hi = 0;
    for (const v of lum) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (hi - lo < 1e-3) { lo = 0; hi = 1; }
  }
  const c = Math.tan(((Math.min(0.999, Math.max(-0.999, contrast)) + 1) * Math.PI) / 4); // 0..inf, 1 = neytral
  for (let i = 0; i < lum.length; i++) {
    let v = (lum[i] - lo) / (hi - lo);
    v = Math.min(1, Math.max(0, v));
    v = v + brightness;
    v = (v - 0.5) * c + 0.5;
    v = Math.min(1, Math.max(0, v));
    if (gamma !== 1) v = Math.pow(v, 1 / gamma);
    if (invert) v = 1 - v;
    out[i] = Math.min(1, Math.max(0, v));
  }
  return out;
}

const BAYER8 = (() => {
  // 8x8 Bayer matritsasi
  const m = [[0]];
  let size = 1;
  let cur = m;
  while (size < 8) {
    const next = [];
    for (let y = 0; y < size * 2; y++) next.push(new Array(size * 2).fill(0));
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = cur[y][x] * 4;
        next[y][x] = v;
        next[y][x + size] = v + 2;
        next[y + size][x] = v + 3;
        next[y + size][x + size] = v + 1;
      }
    }
    cur = next;
    size *= 2;
  }
  const out = new Float32Array(64);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) out[y * 8 + x] = (cur[y][x] + 0.5) / 64;
  return out;
})();

/**
 * Binarizatsiya. Natija: Uint8Array, 1 = qora (siyoh).
 * method: 'fs' | 'atkinson' | 'bayer' | 'threshold'
 */
export function dither(lum, w, h, method = 'fs', threshold = 0.5) {
  const out = new Uint8Array(w * h);
  if (method === 'threshold') {
    for (let i = 0; i < out.length; i++) out[i] = lum[i] < threshold ? 1 : 0;
    return out;
  }
  if (method === 'bayer') {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = BAYER8[(y & 7) * 8 + (x & 7)];
        out[y * w + x] = lum[y * w + x] < t ? 1 : 0;
      }
    }
    return out;
  }

  const buf = Float32Array.from(lum);
  const put = (x, y, e) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    buf[y * w + x] += e;
  };
  const atkinson = method === 'atkinson';
  for (let y = 0; y < h; y++) {
    const ltr = true; // barqarorlik uchun serpantin ishlatmaymiz
    for (let k = 0; k < w; k++) {
      const x = ltr ? k : w - 1 - k;
      const old = buf[y * w + x];
      const black = old < threshold ? 1 : 0;
      out[y * w + x] = black;
      const err = old - (black ? 0 : 1);
      if (atkinson) {
        const e = err / 8;
        put(x + 1, y, e); put(x + 2, y, e);
        put(x - 1, y + 1, e); put(x, y + 1, e); put(x + 1, y + 1, e);
        put(x, y + 2, e);
      } else {
        put(x + 1, y, (err * 7) / 16);
        put(x - 1, y + 1, (err * 3) / 16);
        put(x, y + 1, (err * 5) / 16);
        put(x + 1, y + 1, (err * 1) / 16);
      }
    }
  }
  return out;
}

/** To'liq quvur: RGBA -> (pixelW x pixelH) binar tasvir. */
export function prepareBinary(rgba, sw, sh, pixelW, pixelH, opts = {}) {
  const lum = rgbaToLuma(rgba, sw, sh);
  const small = resample(lum, sw, sh, pixelW, pixelH);
  const tuned = adjust(small, opts);
  return { binary: dither(tuned, pixelW, pixelH, opts.method || 'fs', opts.threshold ?? 0.5), gray: tuned };
}

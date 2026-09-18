/**
 * (n, n) Visual Cryptography — Naor & Shamir konstruksiyasi.
 *
 * Har bir manba pikseli m = 2^(n-1) ta "subpiksel" (modul) blokiga kengayadi.
 * Konvensiya: 1 = siyoh (qora, yorug'likni to'sadi), 0 = bo'sh (oq, yorug'lik o'tadi).
 *
 * Ustma-ust qo'yish (stacking) = modul bo'yicha OR amali:
 *   - qora piksel  -> blokdagi hamma modul to'silgan   (0/m yorug'lik)
 *   - oq piksel    -> blokda aynan 1 ta modul shaffof  (1/m yorug'lik)
 * Ya'ni kontrast = 1/m. n ortgani sayin natija qorayadi.
 *
 * Xavfsizlik: har bir ulushning har bir blokida aynan m/2 ta siyoh moduli bo'ladi
 * (piksel qora yoki oq bo'lishidan qat'i nazar), shuning uchun bitta ulush
 * statistik jihatdan tasodifiy shovqindan farq qilmaydi.
 */

/** Bir piksel uchun subpiksel (modul) soni. */
export function subpixelCount(n) {
  return 1 << (n - 1);
}

/** m ta subpikselni imkon qadar kvadratga yaqin blokka joylash. */
export function blockShape(m) {
  let rows = 1;
  for (let r = 1; r * r <= m; r++) {
    if (m % r === 0) rows = r;
  }
  return { rows, cols: m / rows };
}

/** Uzunligi n bo'lgan, juft (parity=0) yoki toq (parity=1) vaznli bit-vektorlar. */
export function weightVectors(n, parity) {
  const out = [];
  for (let v = 0; v < 1 << n; v++) {
    let bits = 0;
    for (let i = 0; i < n; i++) bits += (v >> i) & 1;
    if ((bits & 1) === parity) out.push(v);
  }
  return Uint32Array.from(out);
}

/** Takrorlanadigan natija uchun oddiy PRNG (mulberry32). */
export function makeRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Binar tasvirni n ta ulushga bo'ladi.
 *
 * @param {Uint8Array} bin  w*h uzunlikdagi massiv, 1 = qora piksel
 * @param {number} w        piksel bo'yicha kenglik
 * @param {number} h        piksel bo'yicha balandlik
 * @param {number} n        ulushlar soni (>= 2)
 * @param {() => number} rng
 * @returns {{shares: Uint8Array[], width: number, height: number,
 *            blockRows: number, blockCols: number, m: number,
 *            pixelW: number, pixelH: number}}
 *          shares[i] — modul bo'yicha width*height massiv, 1 = siyoh
 */
export function encodeShares(bin, w, h, n, rng = Math.random) {
  if (!Number.isInteger(n) || n < 2) throw new Error('n kamida 2 bo\'lishi kerak');
  if (n > 10) throw new Error('n juda katta (maksimum 10)');
  if (bin.length < w * h) throw new Error('binar tasvir o\'lchami mos emas');

  const m = subpixelCount(n);
  const { rows: br, cols: bc } = blockShape(m);
  const even = weightVectors(n, 0);
  const odd = weightVectors(n, 1);

  const W = w * bc;
  const H = h * br;
  const shares = [];
  for (let i = 0; i < n; i++) shares.push(new Uint8Array(W * H));

  const vec = new Uint32Array(m);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Qora piksel -> toq vaznli ustunlar, oq piksel -> juft vaznli ustunlar.
      vec.set(bin[y * w + x] ? odd : even);
      // Ustunlarni har bir piksel uchun mustaqil ravishda aralashtiramiz.
      for (let j = m - 1; j > 0; j--) {
        const k = (rng() * (j + 1)) | 0;
        const t = vec[j];
        vec[j] = vec[k];
        vec[k] = t;
      }
      const baseY = y * br;
      const baseX = x * bc;
      for (let j = 0; j < m; j++) {
        const idx = (baseY + ((j / bc) | 0)) * W + baseX + (j % bc);
        const v = vec[j];
        for (let i = 0; i < n; i++) shares[i][idx] = (v >> i) & 1;
      }
    }
  }

  return { shares, width: W, height: H, blockRows: br, blockCols: bc, m, pixelW: w, pixelH: h };
}

/** Ulushlarni ustma-ust qo'yish: modul bo'yicha OR (1 = to'silgan). */
export function stackShares(shares, width, height) {
  const out = new Uint8Array(width * height);
  for (const s of shares) {
    for (let i = 0; i < out.length; i++) if (s[i]) out[i] = 1;
  }
  return out;
}

/**
 * Chiroq orqasidan ko'rilgan natijani piksel aniqligida simulyatsiya qiladi:
 * har bir blok uchun o'tgan yorug'lik ulushi [0..1].
 */
export function simulateStack(shares, geom) {
  const { width, height, blockRows: br, blockCols: bc, m, pixelW, pixelH } = geom;
  const stacked = stackShares(shares, width, height);
  const out = new Float32Array(pixelW * pixelH);
  for (let y = 0; y < pixelH; y++) {
    for (let x = 0; x < pixelW; x++) {
      let open = 0;
      for (let j = 0; j < m; j++) {
        const idx = (y * br + ((j / bc) | 0)) * width + x * bc + (j % bc);
        if (!stacked[idx]) open++;
      }
      out[y * pixelW + x] = open / m;
    }
  }
  return out;
}

/**
 * Zaxira BMP dekoderi.
 * Ko'p brauzerlar BMP ni o'zi ochadi, lekin ochilmasa shu dekoder ishlatiladi.
 * Qo'llab-quvvatlanadi: BI_RGB 1/4/8/16/24/32 bit, BI_BITFIELDS 16/32 bit,
 * pastdan-yuqoriga va yuqoridan-pastga qatorlar. RLE siqilgan BMP qo'llanmaydi.
 */
export function decodeBmp(buffer) {
  const v = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer);
  const u8 = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (u8[0] !== 0x42 || u8[1] !== 0x4d) throw new Error('BMP emas (BM imzosi yo\'q)');

  const dataOffset = v.getUint32(10, true);
  const dibSize = v.getUint32(14, true);
  if (dibSize < 12) throw new Error('BMP sarlavhasi buzilgan');

  let width, height, bpp, compression = 0, paletteCount = 0;
  if (dibSize === 12) { // BITMAPCOREHEADER
    width = v.getInt16(18, true);
    height = v.getInt16(20, true);
    bpp = v.getUint16(24, true);
  } else {
    width = v.getInt32(18, true);
    height = v.getInt32(22, true);
    bpp = v.getUint16(28, true);
    compression = v.getUint32(30, true);
    paletteCount = v.getUint32(46, true);
  }
  if (compression !== 0 && compression !== 3) throw new Error('Siqilgan BMP qo\'llab-quvvatlanmaydi');

  const topDown = height < 0;
  const h = Math.abs(height);
  const w = width;
  if (w <= 0 || h <= 0 || w * h > 80e6) throw new Error('BMP o\'lchami yaroqsiz');

  // Palitra
  const palOffset = 14 + dibSize;
  const palEntry = dibSize === 12 ? 3 : 4;
  let palette = null;
  if (bpp <= 8) {
    const count = paletteCount || 1 << bpp;
    palette = new Uint8Array(count * 3);
    for (let i = 0; i < count; i++) {
      const o = palOffset + i * palEntry;
      palette[i * 3] = u8[o + 2];
      palette[i * 3 + 1] = u8[o + 1];
      palette[i * 3 + 2] = u8[o];
    }
  }

  // Bit maskalar
  let masks = null;
  if (compression === 3 && dibSize >= 40) {
    masks = [v.getUint32(54, true), v.getUint32(58, true), v.getUint32(62, true)];
  } else if (bpp === 16) {
    masks = [0x7c00, 0x03e0, 0x001f];
  } else if (bpp === 32) {
    masks = [0x00ff0000, 0x0000ff00, 0x000000ff];
  }
  const shiftScale = (mask) => {
    if (!mask) return null;
    let shift = 0;
    while (((mask >>> shift) & 1) === 0) shift++;
    const bits = ((mask >>> shift) >>> 0).toString(2).length;
    return { shift, max: (1 << bits) - 1 };
  };
  const ms = masks ? masks.map(shiftScale) : null;

  const stride = (((w * bpp + 31) >> 5) << 2);
  const out = new Uint8ClampedArray(w * h * 4);

  for (let row = 0; row < h; row++) {
    const y = topDown ? row : h - 1 - row;
    const ro = dataOffset + row * stride;
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 255;
      if (bpp === 1 || bpp === 4 || bpp === 8) {
        const perByte = 8 / bpp;
        const byte = u8[ro + Math.floor(x / perByte)] ?? 0;
        const shift = 8 - bpp * ((x % perByte) + 1);
        const idx = (byte >> shift) & ((1 << bpp) - 1);
        r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2];
      } else if (bpp === 24) {
        const o = ro + x * 3;
        b = u8[o]; g = u8[o + 1]; r = u8[o + 2];
      } else if (bpp === 16 || bpp === 32) {
        const o = ro + x * (bpp / 8);
        const px = bpp === 16 ? v.getUint16(o, true) : v.getUint32(o, true);
        const ch = (i) => (ms[i] ? Math.round((((px & masks[i]) >>> ms[i].shift) / ms[i].max) * 255) : 0);
        r = ch(0); g = ch(1); b = ch(2);
      } else {
        throw new Error(`${bpp}-bitli BMP qo'llab-quvvatlanmaydi`);
      }
      const p = (y * w + x) * 4;
      out[p] = r; out[p + 1] = g; out[p + 2] = b; out[p + 3] = a;
    }
  }
  return { data: out, width: w, height: h };
}

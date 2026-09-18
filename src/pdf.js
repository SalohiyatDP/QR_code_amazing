/**
 * Minimal PDF generatori (hech qanday tashqi kutubxona yo'q).
 *
 * Nega PDF? Ulushlarni rastr rasm sifatida chop etganda brauzer/printer
 * piksellarni "silliqlashi" mumkin — bu vizual kriptografiyani buzadi.
 * PDF ichida 1-bitli rasm (DeviceGray, BitsPerComponent 1, /Interpolate false)
 * aniq millimetrlarda joylashtiriladi, ya'ni modullar tekis va o'lchami aniq
 * bo'ladi — printerning to'liq aniqligida bosiladi.
 *
 * Kiritish o'lchamlari millimetrda, koordinata boshi chap-yuqorida.
 */

const MM = 72 / 25.4; // mm -> PDF punkti

function latin1(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

function pdfString(s) {
  // PDF matnida faqat latin1; boshqa belgilarni almashtiramiz
  const clean = String(s).replace(/[^\x20-\x7e]/g, (ch) => ({ '‘': "'", '’': "'", '×': 'x', '–': '-', '—': '-' }[ch] ?? '?'));
  return '(' + clean.replace(/[\\()]/g, (m) => '\\' + m) + ')';
}

const f = (v) => {
  const r = Math.round(v * 1000) / 1000;
  return Number.isInteger(r) ? String(r) : String(r);
};

/** 1 = qora bo'lgan massivni 1-bitli DeviceGray oqimga paketlash (qator baytga to'ldiriladi). */
export function packOneBit(bits, w, h) {
  const rowBytes = (w + 7) >> 3;
  const out = new Uint8Array(rowBytes * h);
  for (let y = 0; y < h; y++) {
    const ro = y * rowBytes, so = y * w;
    for (let x = 0; x < w; x++) {
      if (!bits[so + x]) out[ro + (x >> 3)] |= 0x80 >> (x & 7); // 1 = oq
    }
  }
  return { data: out, rowBytes };
}

/**
 * @param {object} doc
 * @param {string} [doc.title]
 * @param {Array} doc.pages  [{ widthMm, heightMm, images, rects, lines, texts }]
 * @returns {Uint8Array}
 */
export function buildPdf(doc) {
  const objs = [null, null, null]; // 1: Catalog, 2: Pages, 3: Font
  const addObj = (chunks) => { objs.push(chunks); return objs.length; };

  const pageRefs = [];

  for (const page of doc.pages) {
    const pw = page.widthMm * MM;
    const ph = page.heightMm * MM;
    const flipY = (yMm) => (page.heightMm - yMm) * MM;

    const xobjects = [];
    for (const img of page.images || []) {
      const { data } = packOneBit(img.bits, img.w, img.h);
      const num = addObj([
        `<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} ` +
        `/ColorSpace /DeviceGray /BitsPerComponent 1 /Interpolate false /Length ${data.length} >>\nstream\n`,
        data,
        '\nendstream',
      ]);
      xobjects.push({ name: `Im${xobjects.length}`, num, img });
    }

    const ops = [];
    ops.push('q', '0 G', '0 g');
    for (const x of xobjects) {
      const { img } = x;
      ops.push('q');
      ops.push(`${f(img.wMm * MM)} 0 0 ${f(img.hMm * MM)} ${f(img.xMm * MM)} ${f(flipY(img.yMm + img.hMm))} cm`);
      ops.push(`/${x.name} Do`);
      ops.push('Q');
    }
    const setStroke = (o) => {
      ops.push(`${f((o.widthMm ?? 0.15) * MM)} w`);
      ops.push(o.dash ? `[${o.dash.map((d) => f(d * MM)).join(' ')}] 0 d` : '[] 0 d');
      if (o.gray != null) ops.push(`${f(o.gray)} G`);
      else ops.push('0 G');
    };
    for (const r of page.rects || []) {
      setStroke(r);
      ops.push(`${f(r.x * MM)} ${f(flipY(r.y + r.h))} ${f(r.w * MM)} ${f(r.h * MM)} re S`);
    }
    for (const l of page.lines || []) {
      setStroke(l);
      ops.push(`${f(l.x1 * MM)} ${f(flipY(l.y1))} m ${f(l.x2 * MM)} ${f(flipY(l.y2))} l S`);
    }
    for (const t of page.texts || []) {
      ops.push('BT', `/F1 ${f(t.size ?? 8)} Tf`, `${f(t.gray ?? 0)} g`,
        `${f(t.x * MM)} ${f(flipY(t.y))} Td`, `${pdfString(t.text)} Tj`, 'ET');
    }
    ops.push('Q');
    const content = ops.join('\n') + '\n';
    const contentNum = addObj([`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);

    const xobjDict = xobjects.length
      ? ` /XObject << ${xobjects.map((x) => `/${x.name} ${x.num} 0 R`).join(' ')} >>`
      : '';
    const pageNum = addObj([
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pw)} ${f(ph)}] ` +
      `/Resources << /Font << /F1 3 0 R >>${xobjDict} >> /Contents ${contentNum} 0 R >>`,
    ]);
    pageRefs.push(pageNum);
  }

  objs[0] = ['<< /Type /Catalog /Pages 2 0 R >>'];
  objs[1] = [`<< /Type /Pages /Count ${pageRefs.length} /Kids [${pageRefs.map((n) => `${n} 0 R`).join(' ')}] >>`];
  objs[2] = ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'];

  const infoNum = doc.title
    ? addObj([`<< /Title ${pdfString(doc.title)} /Producer ${pdfString('QR Amazing (visual cryptography)')} >>`])
    : 0;

  // Faylni yig'ish
  const chunks = [];
  let len = 0;
  const push = (c) => { const b = typeof c === 'string' ? latin1(c) : c; chunks.push(b); len += b.length; };

  push('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const offsets = [];
  objs.forEach((body, i) => {
    offsets[i] = len;
    push(`${i + 1} 0 obj\n`);
    for (const c of body) push(c);
    push('\nendobj\n');
  });
  const xrefOff = len;
  push(`xref\n0 ${objs.length + 1}\n`);
  push('0000000000 65535 f \n');
  for (let i = 0; i < objs.length; i++) push(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
  push(`trailer\n<< /Size ${objs.length + 1} /Root 1 0 R${infoNum ? ` /Info ${infoNum} 0 R` : ''} >>\nstartxref\n${xrefOff}\n%%EOF\n`);

  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

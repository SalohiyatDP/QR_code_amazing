/**
 * UI mantiqi: rasmni o'qish, sozlamalarni yig'ish, ulushlarni yaratish,
 * ko'rish oynalarini chizish va chop etishga tayyor PDF berish.
 */
import { subpixelCount, blockShape, makeRng, encodeShares, simulateStack } from './vc.js';
import { prepareBinary } from './image.js';
import { computeLayout, PAPERS } from './layout.js';
import { buildSheetPdf } from './sheet.js';
import { decodeBmp } from './bmp.js';
import { renderTextToCanvas, FONTS } from './text.js';

const $ = (id) => document.getElementById(id);
const MAX_SOURCE_SIDE = 2400;
const TEXT_CANVAS_MAX = 1800; // matn tasviri uchun maksimal tomon (px)

const state = {
  mode: 'image',     // 'image' | 'text'
  source: null,      // { rgba, width, height, aspect }
  fileName: '',
  result: null,      // { geom, layout, light, binary, n, m }
  pdfUrl: null,
  seed: (Math.random() * 1e9) | 0,
};

/* ----------------------------------------------------------- yordamchilar */

function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** 1 = qora bo'lgan modul massivini canvas ga 1 modul = 1 piksel qilib chizadi. */
function drawBits(canvas, bits, w, h) {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const v = bits[i] ? 0 : 255;
    d[p] = d[p + 1] = d[p + 2] = v;
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/** O'tgan yorug'lik ulushini (0..1) kulrang tasvir sifatida chizadi. */
function drawLight(canvas, light, w, h, gain = 1) {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const v = Math.round(Math.min(1, light[i] * gain) * 255);
    d[p] = d[p + 1] = d[p + 2] = v;
    d[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/* ------------------------------------------------------------ rasmni o'qish */

async function rgbaFromBitmap(bitmap) {
  const scale = Math.min(1, MAX_SOURCE_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  return { rgba: data, width: w, height: h, aspect: bitmap.width / bitmap.height };
}

let loading = false;

async function loadFile(file) {
  if (!file) {
    setStatus('Fayl topilmadi. Rasmni fayl sifatida tashlang yoki “Faylni tanlash” ni bosing.', 'err');
    return;
  }
  if (loading) return;

  const byName = /\.(jpe?g|png|bmp|gif|webp|avif)$/i.test(file.name);
  const byType = /^image\//.test(file.type);
  if (!byType && !byName) {
    setStatus(`“${file.name}” rasm fayliga o'xshamaydi. JPG, PNG yoki BMP tanlang.`, 'err');
    return;
  }

  loading = true;
  $('drop').classList.add('busy');
  setStatus(`“${file.name}” o'qilmoqda…`, 'busy');
  try {
    const buf = await file.arrayBuffer();
    let src;
    try {
      const bmp = await createImageBitmap(new Blob([buf], { type: file.type || 'image/png' }));
      src = await rgbaFromBitmap(bmp);
      bmp.close?.();
    } catch (err) {
      // Brauzer BMP ni ochmasa — o'zimizning dekoder
      const dec = decodeBmp(buf);
      if (dec.width * dec.height > 40e6) throw new Error('Rasm juda katta');
      src = { rgba: dec.data, width: dec.width, height: dec.height, aspect: dec.width / dec.height };
    }
    state.source = src;
    state.fileName = file.name;

    const thumb = $('thumb');
    if (thumb.dataset.url) URL.revokeObjectURL(thumb.dataset.url);
    const url = URL.createObjectURL(file);
    thumb.dataset.url = url;
    thumb.src = url;
    thumb.hidden = false;
    $('drop').classList.add('has-image');
    $('change').hidden = false;
    $('fileInfo').textContent = `${file.name} — ${src.width} × ${src.height} px, ${(file.size / 1024).toFixed(0)} KB`;
    if (state.mode !== 'image') setMode('image'); // rasm tashlandi -> rasm rejimiga o'tamiz
    $('generate').disabled = false;
    setStatus('Rasm tayyor. “Ulushlarni yaratish” tugmasini bosing.');
  } catch (err) {
    console.error(err);
    setStatus(`“${file.name}” ni o'qib bo'lmadi: ${err.message}. Boshqa rasm (JPG/PNG/BMP) bilan urinib ko'ring.`, 'err');
  } finally {
    loading = false;
    $('drop').classList.remove('busy');
  }
}

/** DataTransfer dan birinchi fayl (files bo'sh bo'lsa items dan olamiz). */
function fileFromDataTransfer(dt) {
  if (!dt) return null;
  if (dt.files && dt.files.length) return dt.files[0];
  if (dt.items) {
    for (const item of dt.items) {
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) return f;
      }
    }
  }
  return null;
}

/* --------------------------------------------------------------- yaratish */

/* -------------------------------------------------------- matndan tasvir */

/**
 * Matnni layout bergan bosma maydon nisbatidagi canvas ga chizadi.
 * Keyingi qadamlar (resample + binarizatsiya) rasm rejimi bilan bir xil.
 */
function textSource(layout, o) {
  const aspect = layout.imageWmm / layout.imageHmm;
  let w = TEXT_CANVAS_MAX, h = Math.round(TEXT_CANVAS_MAX / aspect);
  if (h > TEXT_CANVAS_MAX) { h = TEXT_CANVAS_MAX; w = Math.round(TEXT_CANVAS_MAX * aspect); }
  // Piksel setkasidan kichik bo'lmasin (aks holda mayda detal yo'qoladi)
  w = Math.max(w, layout.pixelW * 2);
  h = Math.max(h, layout.pixelH * 2);

  const canvas = document.createElement('canvas');
  const fit = renderTextToCanvas(canvas, {
    text: o.text, width: w, height: h,
    font: o.font, bold: o.bold, align: o.align,
    padPercent: o.padPercent, lineHeight: o.lineHeight, invert: o.textInvert,
  });
  const { data } = canvas.getContext('2d').getImageData(0, 0, w, h);
  return {
    src: { rgba: data, width: w, height: h, aspect },
    text: {
      fontPx: fit.size,
      lines: fit.lines.length,
      // harf balandligi: qog'ozdagi mm va tiklanadigan tasvirdagi piksellar
      fontMm: (fit.size / h) * layout.imageHmm,
      fontPixels: (fit.size / h) * layout.pixelH,
    },
  };
}

function readOptions() {
  return {
    sourceKind: state.mode,
    text: $('text').value,
    font: $('font').value,
    bold: $('bold').checked,
    align: $('align').value,
    padPercent: Number($('pad').value),
    lineHeight: Number($('lineHeight').value),
    textInvert: $('textInvert').checked,
    n: Number($('n').value),
    paper: $('paper').value,
    orientation: $('orientation').value,
    mode: $('mode').value,
    moduleMm: Number($('module').value),
    marginMm: Number($('margin').value),
    gutterMm: Number($('gutter').value),
    method: $('dither').value,
    brightness: Number($('bright').value),
    contrast: Number($('contrast').value),
    gamma: Number($('gamma').value),
    invert: $('invert').checked,
    autoLevels: $('autoLevels').checked,
  };
}

async function generate() {
  const o = readOptions();
  if (o.sourceKind === 'text') {
    if (!o.text.trim()) { setStatus('Avval matn yozing.', 'err'); return; }
  } else if (!state.source) {
    setStatus('Avval rasm yuklang.', 'err');
    return;
  }
  $('generate').disabled = true;
  $('reshuffle').disabled = true;
  setStatus('Hisoblanmoqda…', 'busy');
  await nextFrame();

  try {
    const isText = o.sourceKind === 'text';
    const m = subpixelCount(o.n);
    const bs = blockShape(m);
    const layout = computeLayout({
      paper: o.paper, orientation: o.orientation, n: o.n, mode: o.mode,
      marginMm: o.marginMm, gutterMm: o.gutterMm, moduleMm: o.moduleMm,
      // Matn uchun nisbat cheklovi yo'q — butun bo'sh maydon ishlatiladi
      imgAspect: isText ? 1 : state.source.aspect,
      fill: isText,
      blockRows: bs.rows, blockCols: bs.cols,
    });

    let src, textFit = null;
    if (isText) {
      const t = textSource(layout, o);
      src = t.src;
      textFit = t.text;
    } else {
      src = state.source;
    }

    // Matn allaqachon qora/oq: ditheringsiz aniq chegara eng toza natija beradi
    const prep = isText
      ? { method: 'threshold', threshold: 0.5 }
      : { method: o.method, brightness: o.brightness, contrast: o.contrast, gamma: o.gamma, invert: o.invert, autoLevels: o.autoLevels };

    const { binary } = prepareBinary(src.rgba, src.width, src.height, layout.pixelW, layout.pixelH, prep);

    setStatus(`${o.n} ta ulush kodlanmoqda (${(layout.moduleCols * layout.moduleRows / 1e6).toFixed(2)} mln modul)…`, 'busy');
    await nextFrame();

    const geom = encodeShares(binary, layout.pixelW, layout.pixelH, o.n, makeRng(state.seed));
    const light = simulateStack(geom.shares, geom);

    state.result = { geom, layout, light, binary, n: o.n, m, options: o, textFit };
    if (state.pdfUrl) { URL.revokeObjectURL(state.pdfUrl); state.pdfUrl = null; }

    render();
    setStatus('Tayyor. PDF ni yuklab olib, 100% masshtabda chop eting.');
  } catch (err) {
    console.error(err);
    setStatus('Xato: ' + err.message, 'err');
  } finally {
    $('generate').disabled = false;
    $('reshuffle').disabled = !state.result;
  }
}

function render() {
  const { geom, layout, light, binary, n, m, textFit } = state.result;
  $('empty').hidden = true;
  $('output').hidden = false;

  // Ogohlantirishlar
  const warns = [...layout.warnings];
  if (n >= 5) warns.push(`n = ${n} bo'lganda o'tgan yorug'lik faqat 1/${m} — oddiy qog'ozda tasvirni ko'rish juda qiyin. 2–4 tavsiya etiladi.`);
  if (layout.moduleMm < 0.3) warns.push('Modul 0.3 mm dan kichik: uy printerlari bunda siyohni yoyib yuborishi mumkin, bo\'laklarni moslash ham qiyin bo\'ladi.');
  if (textFit) {
    if (textFit.fontPixels < 9) {
      warns.push(
        `Harflar juda kichik chiqdi (balandligi ${textFit.fontPixels.toFixed(1)} piksel, o'qilishi uchun 9+ kerak): ` +
        'matnni qisqartiring, modul o\'lchamini kichraytiring, kattaroq qog\'oz tanlang yoki ulushlar sonini kamaytiring.'
      );
    } else if (textFit.fontPixels < 14) {
      warns.push(`Harflar chegaraviy o'lchamda (${textFit.fontPixels.toFixed(1)} piksel) — qalin shrift va kamroq matn natijani yaxshilaydi.`);
    }
    if (state.result.options.textInvert) {
      warns.push('“Qora fonda oq harflar” rejimida siyoh ko\'p ketadi va fon yorug\'likni to\'sadi — natija qorong\'iroq ko\'rinadi.');
    }
  }
  const wbox = $('warnings');
  wbox.hidden = warns.length === 0;
  wbox.innerHTML = warns.length ? '<ul>' + warns.map((w) => `<li>${w}</li>`).join('') + '</ul>' : '';

  // Ma'lumotlar
  const openPct = (100 / m).toFixed(m > 16 ? 2 : 1);
  const rows = [
    ['Ulushlar', `${n} ta`],
    ['Kontrast', `1/${m} (yorug'lik ${openPct}%)`],
    ['Qog\'oz', `${state.result.options.paper} ${layout.pageW.toFixed(0)}×${layout.pageH.toFixed(0)} mm, ${layout.pageCount} varaq`],
    ['Bitta ulush o\'lchami', `${layout.imageWmm.toFixed(1)} × ${layout.imageHmm.toFixed(1)} mm`],
    ['Tasvir aniqligi', `${layout.pixelW} × ${layout.pixelH} piksel`],
    ['Modul', `${layout.moduleMm.toFixed(2)} mm (blok ${geom.blockRows}×${geom.blockCols})`],
    ['Modullar soni', `${(layout.moduleCols * layout.moduleRows / 1e6).toFixed(2)} mln / ulush`],
  ];
  if (textFit) {
    rows.splice(4, 0,
      ['Harf balandligi', `${textFit.fontMm.toFixed(1)} mm (${textFit.fontPixels.toFixed(0)} piksel)`],
      ['Matn qatorlari', `${textFit.lines} ta`]);
  }
  $('info').innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');

  // Simulyatsiyalar.
  // Piksel setkasi ataylab "siqilgan" (blok kvadrat emas), shuning uchun
  // ko'rsatishda haqiqiy bosma nisbatini majburan qo'yamiz.
  drawLight($('simReal'), light, layout.pixelW, layout.pixelH, 1);
  drawLight($('simNorm'), light, layout.pixelW, layout.pixelH, m);
  drawBits($('simSource'), binary, layout.pixelW, layout.pixelH);
  const printAspect = layout.imageWmm / layout.imageHmm;
  for (const id of ['simReal', 'simNorm', 'simSource']) $(id).style.aspectRatio = String(printAspect);

  // Ulushlar
  const box = $('shares');
  box.innerHTML = '';
  geom.shares.forEach((share, i) => {
    const fig = document.createElement('figure');
    fig.className = 'share';
    const canvas = document.createElement('canvas');
    fig.appendChild(canvas);
    const row = document.createElement('div');
    row.className = 'cap-row';
    row.innerHTML = `<span class="muted small">Ulush ${i + 1} / ${n}</span>`;
    const btn = document.createElement('button');
    btn.textContent = 'PNG';
    btn.onclick = () => canvas.toBlob((b) => download(b, `ulush-${i + 1}-dan-${n}.png`), 'image/png');
    row.appendChild(btn);
    fig.appendChild(row);
    box.appendChild(fig);
    drawBits(canvas, share, geom.width, geom.height);
  });
}

/* ------------------------------------------------------------------- PDF */

function pdfBlob() {
  const { geom, layout, n, m, options } = state.result;
  const bytes = buildSheetPdf({
    shares: geom.shares, moduleCols: geom.width, moduleRows: geom.height, layout,
    meta: {
      paper: options.paper, orientation: options.orientation, n, m,
      fileName: options.sourceKind === 'text' ? 'matn rejimi' : state.fileName,
    },
  });
  return new Blob([bytes], { type: 'application/pdf' });
}

function pdfName() {
  const { n, options } = state.result;
  const kind = options.sourceKind === 'text' ? '-matn' : '';
  return `qr-amazing-${n}-ulush-${options.paper}${kind}${options.mode === 'pages' ? '-alohida' : ''}.pdf`;
}

/* --------------------------------------------------------------- ishga tushirish */

/** Manba rejimini almashtirish: 'image' yoki 'text'. */
function setMode(mode) {
  state.mode = mode;
  const isText = mode === 'text';
  $('tabImage').classList.toggle('active', !isText);
  $('tabText').classList.toggle('active', isText);
  $('tabImage').setAttribute('aria-selected', String(!isText));
  $('tabText').setAttribute('aria-selected', String(isText));
  $('paneImage').hidden = isText;
  $('paneText').hidden = !isText;
  // Rasmga xos tuzatishlar matn rejimida ma'nosiz (matn allaqachon qora/oq)
  $('imgAdjust').hidden = isText;
  $('generate').disabled = isText ? !$('text').value.trim() : !state.source;
  if (isText) $('text').focus();
  if (state.result) setStatus('Manba o\'zgardi — “Ulushlarni yaratish” ni qayta bosing.');
}

function init() {
  // Qog'oz ro'yxati
  $('paper').innerHTML = Object.entries(PAPERS)
    .map(([k, v]) => `<option value="${k}"${k === 'A4' ? ' selected' : ''}>${v.label}</option>`).join('');

  // Shrift ro'yxati
  $('font').innerHTML = Object.entries(FONTS)
    .map(([k, v]) => `<option value="${k}"${k === 'sans' ? ' selected' : ''}>${v.label}</option>`).join('');

  // Tablar
  $('tabImage').addEventListener('click', () => setMode('image'));
  $('tabText').addEventListener('click', () => setMode('text'));
  $('text').addEventListener('input', () => {
    if (state.mode === 'text') $('generate').disabled = !$('text').value.trim();
  });

  // ------------------------------------------------ fayl tanlash / tashlash
  const drop = $('drop');
  const fileInput = $('file');

  const openPicker = () => {
    // showPicker() aniqroq xato beradi, bo'lmasa oddiy click
    try {
      if (typeof fileInput.showPicker === 'function') fileInput.showPicker();
      else fileInput.click();
    } catch (err) {
      fileInput.click();
    }
  };

  drop.addEventListener('click', openPicker);
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); }
  });
  // Tugma .drop ichida: click ikki marta ishlamasligi uchun to'xtatamiz
  $('pick').addEventListener('click', (e) => { e.stopPropagation(); openPicker(); });
  $('change').addEventListener('click', (e) => { e.stopPropagation(); openPicker(); });

  fileInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = ''; // bir xil faylni qayta tanlash ham ishlashi uchun
    loadFile(f);
  });

  // Drag & drop: butun sahifada ishlaydi (chetga tushsa ham brauzer faylni ochib ketmaydi)
  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault();
    dragDepth++;
    document.body.classList.add('dragging');
  });
  document.addEventListener('dragover', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    document.body.classList.add('dragging');
  });
  document.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); }
  });
  document.addEventListener('drop', (e) => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    loadFile(fileFromDataTransfer(e.dataTransfer));
  });

  window.addEventListener('paste', (e) => {
    const f = fileFromDataTransfer(e.clipboardData);
    if (f) loadFile(f);
  });

  // Slayder ko'rsatkichlari
  const bind = (id, out, fmt) => {
    const upd = () => { $(out).textContent = fmt(Number($(id).value)); };
    $(id).addEventListener('input', upd);
    upd();
  };
  bind('module', 'moduleOut', (v) => v.toFixed(2));
  bind('bright', 'brightOut', (v) => v.toFixed(2));
  bind('contrast', 'contrastOut', (v) => v.toFixed(2));
  bind('gamma', 'gammaOut', (v) => v.toFixed(2));
  bind('pad', 'padOut', (v) => String(v));
  bind('lineHeight', 'lhOut', (v) => v.toFixed(2));

  $('generate').addEventListener('click', () => generate());
  $('reshuffle').addEventListener('click', () => { state.seed = (Math.random() * 1e9) | 0; generate(); });

  $('pdf').addEventListener('click', () => {
    if (!state.result) return;
    download(pdfBlob(), pdfName());
    setStatus('PDF yuklab olindi. Chop etishda masshtab 100% ("Actual size") bo\'lishi shart.');
  });

  $('print').addEventListener('click', () => {
    if (!state.result) return;
    if (state.pdfUrl) URL.revokeObjectURL(state.pdfUrl);
    state.pdfUrl = URL.createObjectURL(pdfBlob());
    const win = window.open(state.pdfUrl, '_blank');
    if (win) {
      setStatus('PDF yangi oynada ochildi — Ctrl/Cmd + P bilan chop eting (masshtab 100%).');
    } else {
      setStatus('Brauzer yangi oynani bloklab qo\'ydi. “PDF yuklab olish” dan foydalanib, faylni ochib chop eting.', 'err');
    }
  });

  $('zipless').addEventListener('click', async () => {
    if (!state.result) return;
    const canvases = [...document.querySelectorAll('#shares canvas')];
    for (let i = 0; i < canvases.length; i++) {
      await new Promise((res) => canvases[i].toBlob((b) => {
        download(b, `ulush-${i + 1}-dan-${canvases.length}.png`);
        setTimeout(res, 350);
      }, 'image/png'));
    }
    setStatus(`${canvases.length} ta PNG saqlandi. Eslatma: aniq chop etish uchun PDF ishlatish tavsiya etiladi.`);
  });

  // Sozlama o'zgarsa — natija eskirgani haqida eslatma
  for (const id of ['n', 'paper', 'orientation', 'mode', 'module', 'margin', 'gutter', 'dither',
    'bright', 'contrast', 'gamma', 'invert', 'autoLevels',
    'font', 'align', 'bold', 'textInvert', 'pad', 'lineHeight']) {
    $(id).addEventListener('change', () => {
      if (state.result) setStatus('Sozlama o\'zgardi — “Ulushlarni yaratish” ni qayta bosing.');
    });
  }
}

// Ikki marta ishga tushishdan saqlanish (index.html modul + zaxira bundle yo'llari).
if (!window.__qrInit) {
  window.__qrInit = true;
  init();
}

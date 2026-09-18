/**
 * UI mantiqi: rasmni o'qish, sozlamalarni yig'ish, ulushlarni yaratish,
 * ko'rish oynalarini chizish va chop etishga tayyor PDF berish.
 */
import { subpixelCount, blockShape, makeRng, encodeShares, simulateStack } from './vc.js';
import { prepareBinary } from './image.js';
import { computeLayout, PAPERS } from './layout.js';
import { buildSheetPdf } from './sheet.js';
import { decodeBmp } from './bmp.js';

const $ = (id) => document.getElementById(id);
const MAX_SOURCE_SIDE = 2400;

const state = {
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

async function loadFile(file) {
  if (!file) return;
  const okType = /image\/(jpeg|png|bmp|x-ms-bmp)/.test(file.type) || /\.(jpe?g|png|bmp)$/i.test(file.name);
  if (!okType) {
    setStatus('Faqat JPG, PNG yoki BMP fayl qo\'llab-quvvatlanadi.', 'err');
    return;
  }
  setStatus('Rasm o\'qilmoqda…', 'busy');
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
    if (thumb.src) URL.revokeObjectURL(thumb.src);
    thumb.src = URL.createObjectURL(file);
    thumb.hidden = false;
    $('drop').classList.add('has-image');
    $('fileInfo').textContent = `${file.name} — ${src.width} × ${src.height} px, ${(file.size / 1024).toFixed(0)} KB`;
    $('generate').disabled = false;
    setStatus('Rasm tayyor. “Ulushlarni yaratish” tugmasini bosing.');
  } catch (err) {
    console.error(err);
    setStatus('Rasmni o\'qib bo\'lmadi: ' + err.message, 'err');
  }
}

/* --------------------------------------------------------------- yaratish */

function readOptions() {
  return {
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
  if (!state.source) return;
  const o = readOptions();
  $('generate').disabled = true;
  $('reshuffle').disabled = true;
  setStatus('Hisoblanmoqda…', 'busy');
  await nextFrame();

  try {
    const m = subpixelCount(o.n);
    const bs = blockShape(m);
    const layout = computeLayout({
      paper: o.paper, orientation: o.orientation, n: o.n, mode: o.mode,
      marginMm: o.marginMm, gutterMm: o.gutterMm, moduleMm: o.moduleMm,
      imgAspect: state.source.aspect, blockRows: bs.rows, blockCols: bs.cols,
    });

    const { binary } = prepareBinary(
      state.source.rgba, state.source.width, state.source.height,
      layout.pixelW, layout.pixelH,
      { method: o.method, brightness: o.brightness, contrast: o.contrast, gamma: o.gamma, invert: o.invert, autoLevels: o.autoLevels }
    );

    setStatus(`${o.n} ta ulush kodlanmoqda (${(layout.moduleCols * layout.moduleRows / 1e6).toFixed(2)} mln modul)…`, 'busy');
    await nextFrame();

    const geom = encodeShares(binary, layout.pixelW, layout.pixelH, o.n, makeRng(state.seed));
    const light = simulateStack(geom.shares, geom);

    state.result = { geom, layout, light, binary, n: o.n, m, options: o };
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
  const { geom, layout, light, binary, n, m } = state.result;
  $('empty').hidden = true;
  $('output').hidden = false;

  // Ogohlantirishlar
  const warns = [...layout.warnings];
  if (n >= 5) warns.push(`n = ${n} bo'lganda o'tgan yorug'lik faqat 1/${m} — oddiy qog'ozda rasmni ko'rish juda qiyin. 2–4 tavsiya etiladi.`);
  if (layout.moduleMm < 0.3) warns.push('Modul 0.3 mm dan kichik: uy printerlari bunda siyohni yoyib yuborishi mumkin, bo\'laklarni moslash ham qiyin bo\'ladi.');
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
    meta: { paper: options.paper, orientation: options.orientation, n, m, fileName: state.fileName },
  });
  return new Blob([bytes], { type: 'application/pdf' });
}

function pdfName() {
  const { n, options } = state.result;
  return `qr-amazing-${n}-ulush-${options.paper}${options.mode === 'pages' ? '-alohida' : ''}.pdf`;
}

/* --------------------------------------------------------------- ishga tushirish */

function init() {
  // Qog'oz ro'yxati
  $('paper').innerHTML = Object.entries(PAPERS)
    .map(([k, v]) => `<option value="${k}"${k === 'A4' ? ' selected' : ''}>${v.label}</option>`).join('');

  // Fayl kiritish
  const drop = $('drop');
  drop.addEventListener('click', () => $('file').click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } });
  $('file').addEventListener('change', (e) => loadFile(e.target.files[0]));
  for (const ev of ['dragenter', 'dragover']) {
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
  }
  for (const ev of ['dragleave', 'drop']) {
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); });
  }
  drop.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
  window.addEventListener('paste', (e) => {
    const f = [...(e.clipboardData?.files || [])][0];
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
  for (const id of ['n', 'paper', 'orientation', 'mode', 'module', 'margin', 'gutter', 'dither', 'bright', 'contrast', 'gamma', 'invert', 'autoLevels']) {
    $(id).addEventListener('change', () => {
      if (state.result) setStatus('Sozlama o\'zgardi — “Ulushlarni yaratish” ni qayta bosing.');
    });
  }
}

init();

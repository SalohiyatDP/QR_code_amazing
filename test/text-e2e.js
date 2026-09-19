/**
 * Matn rejimi — 1-qism: tab almashish, avtomatik masshtab (kam matn -> katta
 * harf), ma'lumot paneli, PDF.
 *
 * Loglar window.__txtLog ichida ham saqlanadi, shuning uchun eval vaqt bo'yicha
 * uzilib qolsa ham natijani keyingi chaqiruvda o'qish mumkin.
 */
(async () => {
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (window.__txtLog = window.__txtLog || []);
  if (!window.__txtErr) {
    window.__txtErr = [];
    window.addEventListener('error', (e) => window.__txtErr.push(String(e.message)));
    window.addEventListener('unhandledrejection', (e) => window.__txtErr.push('promise: ' + e.reason));
  }

  window.__info = () => {
    const out = {};
    document.querySelectorAll('#info div').forEach((d) => {
      out[d.querySelector('dt').textContent] = d.querySelector('dd').textContent;
    });
    return out;
  };
  window.__fontMm = () => parseFloat((window.__info()['Harf balandligi'] || '0').replace(/[^\d.]/g, ''));
  window.__run = async (text) => {
    $('text').value = text;
    $('text').dispatchEvent(new Event('input', { bubbles: true }));
    $('generate').click();
    for (let i = 0; i < 40; i++) {
      await sleep(150);
      if (!$('output').hidden && !$('generate').disabled) break;
    }
    await sleep(100);
  };

  // 1) Matn tabiga o'tish
  $('tabText').click();
  await sleep(120);
  log.push(`1) Matn tabi: paneText ko'rinadi=${!$('paneText').hidden}, paneImage yashirin=${$('paneImage').hidden}` +
           `, rasm tuzatishlari yashirin=${$('imgAdjust').hidden}, generate o'chirilgan=${$('generate').disabled}`);

  // 2) Bo'sh matnda yaratilmaydi
  $('generate').click();
  await sleep(120);
  log.push(`2) bo'sh matn -> generate o'chirilgan=${$('generate').disabled}, natija yashirin=${$('output').hidden}`);

  // 3-5) Uch xil hajmdagi matn
  await window.__run('SALOM');
  const i1 = window.__info();
  const f1 = window.__fontMm();
  log.push(`3) "SALOM": harf=${i1['Harf balandligi']}, qatorlar=${i1['Matn qatorlari']}, ulush=${i1["Bitta ulush o'lchami"]}, aniqlik=${i1['Tasvir aniqligi']}`);

  await window.__run('Tug\'ilgan kuning bilan, aziz do\'stim! Omad va baxt tilaymiz.');
  const f2 = window.__fontMm();
  log.push(`4) o'rtacha matn: harf=${window.__info()['Harf balandligi']}, qatorlar=${window.__info()['Matn qatorlari']}`);

  await window.__run('Bu vizual kriptografiya sinovi uchun yozilgan uzun matn. '.repeat(6));
  const f3 = window.__fontMm();
  log.push(`5) uzun matn: harf=${window.__info()['Harf balandligi']}, qatorlar=${window.__info()['Matn qatorlari']}`);
  log.push(`6) AVTOMATIK MASSHTAB: ${f1} > ${f2} > ${f3} mm -> ${(f1 > f2 && f2 > f3) ? "TO'G'RI" : 'XATO'}`);

  // 7) PDF
  const orig = URL.createObjectURL;
  let pdf = null;
  URL.createObjectURL = function (b) { if (b && b.type === 'application/pdf') pdf = b; return orig.call(URL, b); };
  $('pdf').click();
  await sleep(400);
  URL.createObjectURL = orig;
  log.push(`7) PDF: ${pdf ? (pdf.size / 1024).toFixed(0) + ' KB' : 'YARATILMADI'}`);

  return log.join('\n');
})()

/**
 * Matn rejimi — 2-qism: o'ta uzun matn uchun ogohlantirish, \n bilan qatorlar,
 * shrift/joylashuv sozlamalari, rasm rejimiga qaytish. 1-qismdan keyin ishlaydi.
 */
(async () => {
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = [];

  // 8) O'ta uzun matn -> o'qilmaydi, ogohlantirish chiqishi kerak
  await window.__run('Juda uzun matn. '.repeat(120));
  log.push(`8) o'ta uzun matn: harf=${window.__info()['Harf balandligi']}, ogohlantirish=` +
    ($('warnings').hidden ? "yo'q (XATO)" : '"' + $('warnings').innerText.replace(/\s+/g, ' ').slice(0, 120) + '"'));

  // 9) \n bilan qatorlar + mono shrift + chapga tekislash
  $('font').value = 'mono';
  $('align').value = 'left';
  await window.__run('BIRINCHI QATOR\nIKKINCHI QATOR\nUCHINCHI');
  log.push(`9) 3 qatorli matn (mono, chapga): qatorlar=${window.__info()['Matn qatorlari']}, harf=${window.__info()['Harf balandligi']}`);

  // 10) Rasm rejimiga qaytish
  $('tabImage').click();
  await sleep(120);
  log.push(`10) Rasm tabi: paneImage ko'rinadi=${!$('paneImage').hidden}, generate o'chirilgan=${$('generate').disabled} (rasm yuklanmagan)`);

  // 11) Ekran tasviri uchun yakuniy holat
  $('tabText').click();
  $('font').value = 'sans';
  $('align').value = 'center';
  await window.__run('MAXFIY\nXABAR');
  log.push(`11) yakuniy: harf=${window.__info()['Harf balandligi']}, qatorlar=${window.__info()['Matn qatorlari']}, ` +
    `ogohlantirish=${$('warnings').hidden ? "yo'q" : 'bor'}`);

  log.push('xatolar: ' + JSON.stringify(window.__txtErr || []));
  return log.join('\n');
})()

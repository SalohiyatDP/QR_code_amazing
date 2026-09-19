/**
 * Matn rejimida PDF yasab, uni base64 ko'rinishida qaytaradi —
 * shunda PDF ni faylga yozib, haqiqiy ko'rinishini tekshirish mumkin.
 */
(async () => {
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  $('tabText').click();
  $('text').value = 'MAXFIY\nXABAR';
  $('text').dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(100);
  $('generate').click();
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    if (!$('output').hidden && !$('generate').disabled) break;
  }

  const orig = URL.createObjectURL;
  let blob = null;
  URL.createObjectURL = function (b) { if (b && b.type === 'application/pdf') blob = b; return orig.call(URL, b); };
  $('pdf').click();
  await sleep(400);
  URL.createObjectURL = orig;
  if (!blob) return 'XATO: PDF yaratilmadi';

  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
})()

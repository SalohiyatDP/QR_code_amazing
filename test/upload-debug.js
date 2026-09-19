/**
 * Yuklash yo'llarini tekshirish:
 *  1) #drop ga click -> fayl tanlash oynasi faqat BIR marta chaqirilishi
 *  2) "Faylni tanlash" tugmasi -> ham bir marta (ikki karra emas)
 *  3) input change orqali yuklash
 *  4) bir xil faylni ikki marta tanlash ham ishlashi
 *  5) sahifaning istalgan joyiga drag&drop
 *  6) rasm bo'lmagan fayl uchun tushunarli xato
 */
(async () => {
  const log = [];
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__err = [];
  window.addEventListener('error', (e) => window.__err.push(String(e.message)));

  // Fayl tanlash oynasi ochilish urinishlarini sanaymiz
  let picker = 0;
  const origClick = HTMLInputElement.prototype.click;
  const origShow = HTMLInputElement.prototype.showPicker;
  HTMLInputElement.prototype.click = function () { if (this.id === 'file') { picker++; return; } return origClick.call(this); };
  if (origShow) HTMLInputElement.prototype.showPicker = function () { if (this.id === 'file') { picker++; return; } return origShow.call(this); };

  $('drop').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(150);
  log.push(`1) #drop ga click -> oyna chaqirig'i: ${picker} marta (kutilgan: 1)`);

  picker = 0;
  $('pick').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(150);
  log.push(`2) “Faylni tanlash” tugmasi -> oyna chaqirig'i: ${picker} marta (kutilgan: 1)`);

  HTMLInputElement.prototype.click = origClick;
  if (origShow) HTMLInputElement.prototype.showPicker = origShow;

  // Sinov fayllari
  const mkPng = async (label) => {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 150;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 200, 150);
    x.fillStyle = '#000'; x.fillRect(40, 30, 120, 90);
    x.fillStyle = '#888'; x.fillText(label, 10, 20);
    const b = await new Promise((r) => c.toBlob(r, 'image/png'));
    return new File([b], label, { type: 'image/png' });
  };

  const setInput = (file) => {
    const dt = new DataTransfer();
    dt.items.add(file);
    $('file').files = dt.files;
    $('file').dispatchEvent(new Event('change', { bubbles: true }));
  };

  setInput(await mkPng('birinchi.png'));
  await sleep(700);
  log.push(`3) input change -> "${$('fileInfo').textContent}"`);

  // 4) bir xil nomdagi faylni qayta tanlash (input.value tozalanishi kerak)
  setInput(await mkPng('birinchi.png'));
  await sleep(700);
  log.push(`4) bir xil faylni qayta tanlash -> status: "${$('status').textContent}" | input.value bo'sh: ${$('file').value === ''}`);

  // 5) sahifaning tasodifiy joyiga (drop zonasidan tashqarida) tashlash
  const dt2 = new DataTransfer();
  dt2.items.add(await mkPng('tashlangan.png'));
  document.querySelector('footer').dispatchEvent(new DragEvent('drop', { dataTransfer: dt2, bubbles: true, cancelable: true }));
  await sleep(800);
  log.push(`5) footer ustiga tashlash -> "${$('fileInfo').textContent}"`);

  // 6) rasm bo'lmagan fayl
  const dt3 = new DataTransfer();
  dt3.items.add(new File([new Blob(['salom'])], 'hujjat.txt', { type: 'text/plain' }));
  $('drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt3, bubbles: true, cancelable: true }));
  await sleep(400);
  log.push(`6) .txt fayl -> status: "${$('status').textContent}" (err klass: ${$('status').classList.contains('err')})`);

  // 7) bootWarn ko'rinmasligi (ilova ishga tushgan)
  log.push(`7) bootWarn yashirin: ${$('bootWarn').offsetParent === null}, qog'oz ro'yxati: ${$('paper').options.length}`);

  // 8) yuklangandan keyin yaratish ham ishlaydimi
  setInput(await mkPng('oxirgi.png'));
  await sleep(700);
  $('generate').click();
  for (let i = 0; i < 80; i++) { await sleep(200); if (!$('output').hidden && !$('generate').disabled) break; }
  log.push(`8) yaratish -> ulushlar: ${document.querySelectorAll('#shares canvas').length}, status: "${$('status').textContent}"`);

  log.push('xatolar: ' + JSON.stringify(window.__err));
  return log.join('\n');
})()

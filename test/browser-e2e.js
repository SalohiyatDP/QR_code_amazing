/**
 * Brauzerdagi to'liq tekshiruv (agent-browser / Playwright `eval` uchun).
 * Haqiqiy foydalanuvchi yo'li bilan ishlaydi: drag&drop -> tugma bosish -> natija.
 *
 * Misol:
 *   agent-browser --session x open "file://.../dist/qr-amazing.html" \
 *     && agent-browser --session x eval --stdin < test/browser-e2e.js
 */
(async () => {
  const log = [];
  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push('promise: ' + String(e.reason)));

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Sinov rasmi: kulgichli yuz (400x300, ya'ni 4:3 albom) */
  function testImage() {
    const c = document.createElement('canvas');
    c.width = 400; c.height = 300;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 300);
    x.strokeStyle = '#000'; x.lineWidth = 14;
    x.beginPath(); x.arc(200, 150, 120, 0, 7); x.stroke();
    x.fillStyle = '#000';
    x.beginPath(); x.arc(160, 115, 18, 0, 7); x.fill();
    x.beginPath(); x.arc(240, 115, 18, 0, 7); x.fill();
    x.beginPath(); x.arc(200, 160, 70, 0.25 * Math.PI, 0.75 * Math.PI); x.lineWidth = 16; x.stroke();
    return c;
  }

  /** 24-bitli BMP yasash — BMP qabul qilinishini tekshirish uchun */
  function tinyBmp(w = 60, h = 40) {
    const stride = (w * 3 + 3) & ~3;
    const size = 54 + stride * h;
    const b = new Uint8Array(size);
    const dv = new DataView(b.buffer);
    b[0] = 0x42; b[1] = 0x4d;
    dv.setUint32(2, size, true); dv.setUint32(10, 54, true); dv.setUint32(14, 40, true);
    dv.setInt32(18, w, true); dv.setInt32(22, h, true);
    dv.setUint16(26, 1, true); dv.setUint16(28, 24, true);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = 54 + y * stride + x * 3;
        const dark = (x > w * 0.25 && x < w * 0.75 && y > h * 0.25 && y < h * 0.75) ? 0 : 255;
        b[o] = b[o + 1] = b[o + 2] = dark;
      }
    }
    return b;
  }

  async function dropFile(file) {
    const before = $('fileInfo').textContent;
    const dt = new DataTransfer();
    dt.items.add(file);
    $('drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    // Fayl nomi yangilanishini (yoki xato xabarini) kutamiz
    for (let i = 0; i < 50; i++) {
      await sleep(100);
      if ($('fileInfo').textContent !== before && $('fileInfo').textContent.includes(file.name)) return true;
      if ($('status').classList.contains('err')) return false;
    }
    return false;
  }

  async function generate() {
    $('generate').click();
    for (let i = 0; i < 120; i++) {
      await sleep(200);
      if (!$('output').hidden && !$('generate').disabled) break;
    }
    await sleep(100);
  }

  const info = () => [...document.querySelectorAll('#info div')]
    .map((d) => d.querySelector('dt').textContent + '=' + d.querySelector('dd').textContent).join(' | ');

  /* 1) PNG yuklash */
  const png = await new Promise((r) => testImage().toBlob(r, 'image/png'));
  await dropFile(new File([png], 'smiley.png', { type: 'image/png' }));
  log.push('1) PNG yuklandi: ' + $('fileInfo').textContent);

  /* 2) n=2, A4, bitta varaq */
  await generate();
  log.push('2) n=2: ' + info());
  const shareCanvases = [...document.querySelectorAll('#shares canvas')];
  log.push('   ulushlar: ' + shareCanvases.length + ', canvas: ' + shareCanvases.map((c) => `${c.width}x${c.height}`).join(', '));
  log.push('   sim nisbati (CSS): ' + $('simReal').style.aspectRatio);
  log.push('   bo\'sh joy yashiringan: ' + ($('empty').offsetParent === null));

  /* 3) Ulushlar bir-biridan farq qiladi va zichligi ~50% */
  const density = shareCanvases.map((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let black = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) black++;
    return black / (c.width * c.height);
  });
  log.push('3) ulush zichligi: ' + density.map((v) => (v * 100).toFixed(1) + '%').join(', '));

  /* 4) PDF yaratilishi (blob ni tutib olamiz) */
  const origCreate = URL.createObjectURL;
  let captured = null;
  URL.createObjectURL = function (b) { if (b && b.type === 'application/pdf') captured = b; return origCreate.call(URL, b); };
  $('pdf').click();
  await sleep(500);
  URL.createObjectURL = origCreate;
  if (captured) {
    const head = new Uint8Array(await captured.slice(0, 8).arrayBuffer());
    const tail = new TextDecoder('latin1').decode(await captured.slice(captured.size - 20).arrayBuffer());
    log.push(`4) PDF: ${(captured.size / 1024).toFixed(0)} KB, sarlavha="${new TextDecoder().decode(head).trim()}", oxiri EOF=${tail.includes('%%EOF')}`);
  } else {
    log.push('4) PDF: BLOB TUTILMADI (xato)');
  }

  /* 5) n=4 + har biri alohida varaqda */
  $('n').value = '4';
  $('mode').value = 'pages';
  $('module').value = '0.4';
  $('n').dispatchEvent(new Event('change'));
  await generate();
  log.push('5) n=4/alohida varaq: ' + info());
  log.push('   ulushlar: ' + document.querySelectorAll('#shares canvas').length +
           ', ogohlantirish: ' + ($('warnings').hidden ? 'yo\'q' : $('warnings').innerText.replace(/\s+/g, ' ')));

  /* 6) BMP qabul qilinishi */
  const bmpOk = await dropFile(new File([tinyBmp()], 'kvadrat.bmp', { type: 'image/bmp' }));
  log.push('6) BMP yuklandi=' + bmpOk + ': ' + $('fileInfo').textContent + ' | status: ' + $('status').textContent);

  /* 6b) JPEG ham ishlashi */
  const jpg = await new Promise((r) => testImage().toBlob(r, 'image/jpeg', 0.9));
  const jpgOk = await dropFile(new File([jpg], 'smiley.jpg', { type: 'image/jpeg' }));
  log.push('6b) JPEG yuklandi=' + jpgOk + ': ' + $('fileInfo').textContent);

  /* 7) n=8 (chegaraviy holat) hech narsani buzmasligi */
  $('n').value = '8';
  $('mode').value = 'sheet';
  $('n').dispatchEvent(new Event('change'));
  await generate();
  log.push('7) n=8: ' + info());
  log.push('   ogohlantirishlar: ' + ($('warnings').hidden ? 'yo\'q' : $('warnings').innerText.replace(/\s+/g, ' ').slice(0, 220)));

  log.push('XATOLAR: ' + (errors.length ? JSON.stringify(errors) : 'yo\'q'));
  return log.join('\n');
})()

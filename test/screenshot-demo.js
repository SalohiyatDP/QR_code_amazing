/**
 * README uchun toza ekran tasviri tayyorlaydi: rasm yuklaydi va n=2 bilan yaratadi.
 * agent-browser eval --stdin bilan ishlatiladi, so'ng screenshot olinadi.
 */
(async () => {
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const c = document.createElement('canvas');
  c.width = 420; c.height = 300;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 420, 300);
  x.strokeStyle = '#000'; x.lineWidth = 15;
  x.beginPath(); x.arc(210, 150, 120, 0, 7); x.stroke();
  x.fillStyle = '#000';
  x.beginPath(); x.arc(168, 115, 18, 0, 7); x.fill();
  x.beginPath(); x.arc(252, 115, 18, 0, 7); x.fill();
  x.beginPath(); x.arc(210, 160, 70, 0.25 * Math.PI, 0.75 * Math.PI); x.lineWidth = 17; x.stroke();
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'kulgich.png', { type: 'image/png' }));
  $('drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  await sleep(1000);
  $('generate').click();
  for (let i = 0; i < 100; i++) { await sleep(200); if (!$('output').hidden && !$('generate').disabled) break; }
  await sleep(300);
  return 'tayyor: ' + $('status').textContent;
})()

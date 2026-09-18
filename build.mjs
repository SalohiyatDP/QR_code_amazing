/**
 * Bitta faylli versiyani yig'adi: dist/qr-amazing.html
 *
 * Nega kerak? ES modullar file:// orqali ochilganda brauzer CORS sababli
 * ishlamaydi. Bu skript CSS va barcha modullarni bitta HTML ichiga joylaydi —
 * natijada faylni oddiy ikki marta bosib (server kerak emas) ochish mumkin.
 *
 * Ishga tushirish:  node build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MODULES = ['vc.js', 'image.js', 'layout.js', 'pdf.js', 'sheet.js', 'bmp.js', 'app.js'];

/** import satrlarini olib tashlab, export kalit so'zini yechadi. */
function flatten(src, name) {
  let out = src
    .replace(/^\s*import\s+[^;]*;\s*$/gm, '')
    .replace(/^export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/gm, '');
  if (/^\s*export\b/m.test(out)) {
    throw new Error(`${name}: qo'llab-quvvatlanmagan export shakli topildi`);
  }
  return `/* ===== src/${name} ===== */\n${out.trim()}\n`;
}

const parts = MODULES.map((m) => flatten(readFileSync(join(ROOT, 'src', m), 'utf8'), m));
const bundle = parts.join('\n');

// Yuqori darajadagi nomlar takrorlanmasligini tekshiramiz (aks holda bundle buziladi)
const names = new Map();
for (let i = 0; i < MODULES.length; i++) {
  const re = /^(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(parts[i]))) {
    if (names.has(m[1])) {
      throw new Error(`Nom ikki marta e'lon qilingan: "${m[1]}" (${names.get(m[1])} va ${MODULES[i]})`);
    }
    names.set(m[1], MODULES[i]);
  }
}

const css = readFileSync(join(ROOT, 'styles.css'), 'utf8');
let html = readFileSync(join(ROOT, 'index.html'), 'utf8');

html = html
  .replace('<link rel="stylesheet" href="styles.css">', `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="src/app.js"></script>', `<script>\n${bundle}\n</script>`)
  .replace('</title>', '</title>\n<!-- Bitta faylli versiya: node build.mjs orqali yig\'ilgan -->');

if (/<link[^>]+styles\.css/.test(html) || /<script[^>]+src=/.test(html)) {
  throw new Error('HTML ichidagi havolalar almashtirilmadi');
}
if (/<\/script>/i.test(bundle)) {
  throw new Error('Bundle ichida </script> bor — inline qilish mumkin emas');
}

mkdirSync(join(ROOT, 'dist'), { recursive: true });
const outPath = join(ROOT, 'dist', 'qr-amazing.html');
writeFileSync(outPath, html);
console.log(`Yig'ildi: dist/qr-amazing.html (${(html.length / 1024).toFixed(0)} KB, ${names.size} ta yuqori darajali nom)`);

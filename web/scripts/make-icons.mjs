// Genera public/icon-192.png e public/icon-512.png (solo moduli built-in: zlib per la compressione PNG).
// Disegno: quadrato Jet Black con angoli arrotondati, anello Pacific Blue e una X stilizzata (Cornsilk e Pacific Blue) che richiama il marchio.
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, '..', 'public');

const JET = [1, 33, 44], BLUE = [113, 177, 189], SILK = [255, 250, 227];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Funzioni di distanza (in unità normalizzate 0..1) con anti-aliasing semplice
const sdRoundRect = (x, y, cx, cy, hw, hh, r) => { const dx = Math.abs(x - cx) - hw + r, dy = Math.abs(y - cy) - hh + r; return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r; };
const sdSegment = (x, y, ax, ay, bx, by) => { const px = x - ax, py = y - ay, bxa = bx - ax, bya = by - ay; const h = Math.max(0, Math.min(1, (px * bxa + py * bya) / (bxa * bxa + bya * bya))); return Math.hypot(px - bxa * h, py - bya * h); };
const cover = (d, aa) => Math.max(0, Math.min(1, 0.5 - d / aa));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function render(size) {
  const buf = Buffer.alloc(size * size * 4);
  const aa = 1.2 / size;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const x = (px + 0.5) / size, y = (py + 0.5) / size;
    let col = [0, 0, 0], alpha = 0;
    // sfondo arrotondato
    const bg = cover(sdRoundRect(x, y, 0.5, 0.5, 0.5, 0.5, 0.22), aa);
    if (bg > 0) { col = JET; alpha = bg; }
    // anello Pacific Blue
    const ring = cover(Math.abs(Math.hypot(x - 0.5, y - 0.5) - 0.33) - 0.028, aa);
    if (ring > 0) col = mix(col, BLUE, ring * 0.55);
    // X stilizzata: due tratti spessi, arrotondati
    const w = 0.065;
    const s1 = cover(sdSegment(x, y, 0.33, 0.33, 0.67, 0.67) - w, aa);
    const s2 = cover(sdSegment(x, y, 0.67, 0.33, 0.33, 0.67) - w, aa);
    if (s2 > 0) col = mix(col, BLUE, s2);
    if (s1 > 0) col = mix(col, SILK, s1);
    const o = (py * size + px) * 4;
    buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2]; buf[o + 3] = Math.round(alpha * 255);
  }
  return png(size, size, buf);
}

for (const s of [192, 512]) fs.writeFileSync(path.join(out, `icon-${s}.png`), render(s));
fs.writeFileSync(path.join(out, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="#01212C"/><circle cx="50" cy="50" r="33" fill="none" stroke="#71B1BD" stroke-opacity=".55" stroke-width="5.6"/><path d="M67 33 33 67" stroke="#71B1BD" stroke-width="13" stroke-linecap="round"/><path d="M33 33l34 34" stroke="#FFFAE3" stroke-width="13" stroke-linecap="round"/></svg>\n`);
console.log('Icone generate in', out);

// Test del servizio dei file caricati dagli utenti (lib/servFile.js, debug pre-produzione B1): il tipo viene dall'estensione e dalla
// firma, mai dal client; in linea solo PDF e immagini raster; SVG e HTML mai in linea; nosniff e sandbox sempre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tipoFile, firma, contentDisposition, intestazioniFile, servFile } from '../src/lib/servFile.js';

const PDF = Buffer.from('%PDF-1.4\n%prova\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const HTML = Buffer.from('<html><body><script>window.__xss=1</script></body></html>');

// risposta finta: raccoglie intestazioni e corpo
function finta() {
  const h = {}; const r = { statusCode: 200, body: null, headersSent: false };
  r.setHeader = (k, v) => { h[k.toLowerCase()] = String(v); };
  r.getHeader = (k) => h[k.toLowerCase()];
  r.status = (s) => { r.statusCode = s; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = (b) => { r.body = b; return r; };
  r.h = h;
  return r;
}

test('firma dei primi byte', () => {
  assert.equal(firma(PDF), 'application/pdf');
  assert.equal(firma(PNG), 'image/png');
  assert.equal(firma(JPG), 'image/jpeg');
  assert.equal(firma(HTML), null);
  assert.equal(firma(Buffer.alloc(0)), null);
});

test('tipoFile: estensione in elenco, mai il tipo dichiarato dal client', () => {
  assert.deepEqual(tipoFile('referto.pdf', PDF, 'text/html'), { contentType: 'application/pdf', inline: true });
  assert.deepEqual(tipoFile('foto.png', PNG, 'text/html'), { contentType: 'image/png', inline: true });
  // estensione .pdf ma contenuto HTML (il caso del collaudo): mai text/html, mai in linea
  assert.deepEqual(tipoFile('referto.pdf', HTML, 'text/html'), { contentType: 'application/octet-stream', inline: false });
  // estensione sconosciuta e tipo dichiarato pericoloso: dato grezzo
  assert.deepEqual(tipoFile('pagina.html', HTML, 'text/html'), { contentType: 'application/octet-stream', inline: false });
  assert.deepEqual(tipoFile('modulo.js', Buffer.from('alert(1)'), 'application/javascript'), { contentType: 'application/octet-stream', inline: false });
  // SVG: tipo corretto ma mai in linea
  assert.deepEqual(tipoFile('logo.svg', Buffer.from('<svg/>'), 'image/svg+xml'), { contentType: 'image/svg+xml', inline: false });
  // documenti d'ufficio: tipo dall'estensione, da scaricare
  assert.equal(tipoFile('offerta.docx', null).inline, false);
  assert.equal(tipoFile('offerta.docx', null).contentType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  // senza estensione: dalla firma, poi dal tipo dichiarato solo se è in elenco
  assert.deepEqual(tipoFile('logo', PNG, 'image/png'), { contentType: 'image/png', inline: true });
  assert.deepEqual(tipoFile('richiesta-12', null, 'text/html'), { contentType: 'application/octet-stream', inline: false });
  // immagine con estensione sbagliata ma firma di un tipo sicuro: tipo della firma
  assert.deepEqual(tipoFile('foto.jpg', PNG), { contentType: 'image/png', inline: true });
});

test('contentDisposition: nome pulito (virgolette, a capo, barre) e filename* in UTF-8', () => {
  const d = contentDisposition('a"b\r\nX-Injected: 1/../è.pdf', true);
  assert.ok(d.startsWith('inline; filename="'));
  assert.ok(!/[\r\n]/.test(d));
  assert.ok(!d.includes('"b'));
  assert.ok(d.includes("filename*=UTF-8''"));
  assert.ok(contentDisposition('x.docx').startsWith('attachment;'));
});

test('intestazioniFile: nosniff sempre, sandbox salvo i PDF in linea, attachment per tutto ciò che non è PDF o immagine', () => {
  let r = finta(); intestazioniFile(r, 'referto.pdf', { inline: true, buf: HTML, mime: 'text/html' });
  assert.equal(r.h['content-type'], 'application/octet-stream');
  assert.match(r.h['content-disposition'], /^attachment;/);
  assert.equal(r.h['x-content-type-options'], 'nosniff');
  assert.match(r.h['content-security-policy'], /sandbox/);
  r = finta(); intestazioniFile(r, 'referto.pdf', { inline: true, buf: PDF });
  assert.equal(r.h['content-type'], 'application/pdf');
  assert.match(r.h['content-disposition'], /^inline;/);
  assert.equal(r.h['content-security-policy'], undefined);
  r = finta(); intestazioniFile(r, 'foto.png', { inline: true, buf: PNG });
  assert.match(r.h['content-disposition'], /^inline;/);
  assert.match(r.h['content-security-policy'], /sandbox/);
  r = finta(); intestazioniFile(r, 'disegno.svg', { inline: true, buf: Buffer.from('<svg onload="alert(1)"/>') });
  assert.match(r.h['content-disposition'], /^attachment;/);
});

test('servFile: invia i byte dal database con le intestazioni giuste', async () => {
  const r = finta();
  await servFile(r, { filename: 'referto.pdf', data: HTML, mime: 'text/html' }, { inline: true });
  assert.equal(r.h['content-type'], 'application/octet-stream');
  assert.equal(r.h['content-length'], String(HTML.length));
  assert.ok(Buffer.isBuffer(r.body));
  const r2 = finta();
  await servFile(r2, { filename: 'vuoto.pdf' });
  assert.equal(r2.statusCode, 404);
});

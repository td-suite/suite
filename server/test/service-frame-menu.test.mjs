// Test del Portale Service (modules/service/lib/regole.js): lettura di X-Frame-Options e CSP frame-ancestors (si può incorporare il
// Vademecum online di referti.toscanadiagnostica.it nella Suite?) e mappa delle voci di menu Servizi con la rimappatura del CEO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valutaIncorporamento, sorgenteAmmette, mappaVoci, moduloDaHref, RIMAPPA } from '../src/modules/service/lib/regole.js';

const SUITE = 'https://suite.toscanadiagnostica.it';
const VAD = 'https://referti.toscanadiagnostica.it/vademecum';
const ok = (headers, extra = {}) => ({ ok: true, status: 200, url: VAD, headers, ...extra });

test('X-Frame-Options: DENY e SAMEORIGIN vietano, nessuna intestazione consente', () => {
  assert.equal(valutaIncorporamento(ok({}), SUITE, VAD).consentito, true);
  assert.deepEqual(valutaIncorporamento(ok({ 'X-Frame-Options': 'DENY' }), SUITE, VAD), { consentito: false, motivo: 'X-Frame-Options: DENY' });
  assert.equal(valutaIncorporamento(ok({ 'x-frame-options': 'deny' }), SUITE, VAD).consentito, false, 'maiuscole indifferenti');
  assert.equal(valutaIncorporamento(ok({ 'x-frame-options': 'SAMEORIGIN' }), SUITE, VAD).consentito, false);
  assert.equal(valutaIncorporamento(ok({ 'x-frame-options': 'SAMEORIGIN' }, { url: `${SUITE}/vademecum` }), SUITE, `${SUITE}/vademecum`).consentito, true, 'stessa origine');
  assert.equal(valutaIncorporamento(ok({ 'x-frame-options': 'ALLOW-FROM https://suite.toscanadiagnostica.it/' }), SUITE, VAD).consentito, true);
  assert.equal(valutaIncorporamento(ok({ 'x-frame-options': 'ALLOW-FROM https://altro.it' }), SUITE, VAD).consentito, false);
});

test('CSP frame-ancestors prevale su X-Frame-Options; sorgenti con jolly, self, none, schema, porta', () => {
  assert.equal(valutaIncorporamento(ok({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self' https://*.toscanadiagnostica.it", 'x-frame-options': 'DENY' }), SUITE, VAD).consentito, true);
  assert.equal(valutaIncorporamento(ok({ 'content-security-policy': "frame-ancestors 'none'" }), SUITE, VAD).consentito, false);
  assert.equal(valutaIncorporamento(ok({ 'content-security-policy': "frame-ancestors 'self'" }), SUITE, VAD).consentito, false, "'self' è referti, non la Suite");
  assert.equal(valutaIncorporamento(ok({ 'content-security-policy': "script-src 'self'" }), SUITE, VAD).consentito, true, 'CSP senza frame-ancestors: nessun divieto');
  assert.equal(valutaIncorporamento(ok({ 'content-security-policy': "frame-ancestors https://suite.toscanadiagnostica.it, frame-ancestors 'none'" }), SUITE, VAD).consentito, false, 'due politiche: devono ammettere entrambe');
  assert.equal(valutaIncorporamento(ok({ 'content-security-policy': 'frame-ancestors *' }), SUITE, VAD).consentito, true);
  assert.equal(sorgenteAmmette('https:', SUITE, VAD), true);
  assert.equal(sorgenteAmmette('http:', SUITE, VAD), false);
  assert.equal(sorgenteAmmette('suite.toscanadiagnostica.it', SUITE, VAD), true, 'host senza schema');
  assert.equal(sorgenteAmmette('*.toscanadiagnostica.it', 'https://toscanadiagnostica.it', VAD), false, 'il jolly non copre il dominio nudo');
  assert.equal(sorgenteAmmette('https://suite.toscanadiagnostica.it:8443', SUITE, VAD), false, 'porta diversa');
  assert.equal(sorgenteAmmette('http://127.0.0.1:3134', 'http://127.0.0.1:3134', VAD), true);
  assert.equal(sorgenteAmmette('http://127.0.0.1', 'http://127.0.0.1:3134', VAD), false, 'porta non standard da dichiarare');
});

test('sito che non risponde o risponde con errore: non incorporabile (si mostra il PDF dallo specchio)', () => {
  assert.equal(valutaIncorporamento({ errore: 'ENOTFOUND' }, SUITE, VAD).consentito, false);
  assert.match(valutaIncorporamento({ errore: 'timeout' }, SUITE, VAD).motivo, /non raggiungibile/);
  assert.deepEqual(valutaIncorporamento({ ok: false, status: 403, headers: {} }, SUITE, VAD), { consentito: false, motivo: 'il sito risponde 403' });
  assert.equal(valutaIncorporamento(null, SUITE, VAD).consentito, false);
});

// menu.json del sito com'è oggi (prima del patch) e com'è dopo il patch (href verso la Suite)
const VOCI_OGGI = [
  { id: 'vademecum', label: 'Vademecum', icon: 'book', href: '/vademecum', blank: false },
  { id: 'circolari', label: 'Circolari e aggiornamenti operativi', icon: 'list', href: '', blank: true },
  { id: 'ordine-materiale', label: 'Ordine del materiale', icon: 'folder', href: '', blank: true, modulo: 'TD-SGI-MOD252', box: { url: 'https://orders.toscanadiagnostica.it', titolo: 'Portale Ordini' } },
  { id: 'promozioni', label: 'Check-up e promozioni mensili', icon: 'star', href: '', blank: true },
  { id: 'portale-nc', label: 'Portale NC', icon: 'shield', href: 'https://nc.toscanadiagnostica.it/', blank: true },
];
const MODULI = new Map([
  ['circolari', { nome: 'Circolari', href: '/circolari', accessibile: true }],
  ['orders', { nome: 'Ordini e Magazzino', href: '/orders', accessibile: false }],
  ['nc', { nome: 'Non conformità', href: '/go/nc', accessibile: true }],
]);

test('voci Servizi: Vademecum interno, Circolari/Ordini/NC ai widget, Check-up segnaposto', () => {
  const v = Object.fromEntries(mappaVoci(VOCI_OGGI, MODULI).map((x) => [x.id, x]));
  assert.deepEqual(Object.keys(v), ['vademecum', 'circolari', 'ordine-materiale', 'promozioni', 'portale-nc']);
  assert.equal(v.vademecum.tipo, 'interno'); assert.equal(v.vademecum.to, 'vademecum');
  assert.deepEqual([v.circolari.tipo, v.circolari.modulo, v.circolari.href, v.circolari.accessibile], ['widget', 'circolari', '/circolari', true]);
  assert.deepEqual([v['ordine-materiale'].tipo, v['ordine-materiale'].modulo, v['ordine-materiale'].accessibile], ['widget', 'orders', false], 'senza accesso al widget la voce resta con il motivo');
  assert.equal(v['ordine-materiale'].modulo_sgi, 'TD-SGI-MOD252', 'resta il modulo cartaceo come alternativa');
  assert.deepEqual([v['portale-nc'].tipo, v['portale-nc'].href], ['widget', '/go/nc'], 'href dalla Suite: /go/ se il modulo non è dentro la Suite');
  assert.deepEqual([v.promozioni.tipo, v.promozioni.to], ['segnaposto', 'servizi/promozioni']);
  assert.ok(Object.keys(RIMAPPA).length === 4);
});

test('voci Servizi dopo il patch del sito: href verso la Suite o verso le app TD diventano widget; altri link restano esterni', () => {
  const dopo = [
    { id: 'circolari', label: 'Circolari', href: 'https://suite.toscanadiagnostica.it/circolari', blank: true },
    { id: 'nuova', label: 'Ticket', href: 'https://suite.toscanadiagnostica.it/ticket', blank: true },
    { id: 'listino', label: 'Listino', href: 'https://www.toscanadiagnostica.it/listino', blank: true },
    { id: 'interno', label: 'Senza link', href: '' },
    { label: 'senza id' },
  ];
  const v = mappaVoci(dopo, MODULI, { suiteHosts: ['suite.toscanadiagnostica.it'] });
  assert.equal(v.length, 4, 'voci senza id scartate');
  assert.deepEqual([v[0].tipo, v[0].modulo], ['widget', 'circolari']);
  assert.deepEqual([v[1].tipo, v[1].modulo, v[1].href, v[1].accessibile], ['widget', 'ticket', '/ticket', false], 'modulo non tra quelli noti: href diretto, accesso da verificare');
  assert.deepEqual([v[2].tipo, v[2].blank], ['esterno', true]);
  assert.equal(v[3].tipo, 'segnaposto');
  assert.equal(moduloDaHref('https://orders.toscanadiagnostica.it'), 'orders');
  assert.equal(moduloDaHref('https://suite.toscanadiagnostica.it/', ['suite.toscanadiagnostica.it']), null);
  assert.equal(moduloDaHref('non un url'), null);
});

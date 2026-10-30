// Interpretazione degli articoli Silva: categoria, icona e colore dalla descrizione
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpreta, CATEGORIE_INTERPRETATE } from '../src/modules/orders/lib/silvaClassify.js';
import { mappaArticolo, anniDaSincronizzare } from '../src/modules/orders/lib/silvaCatalog.js';

test('interpretazione: provette, aghi, contenitori, tamponi, buste, vetrini, reagenti, modulistica, DPI, altro', () => {
  const casi = [['Provetta siero gel 5 ml tappo rosso', 'PROVETTE', 'tube'], ['Vacutainer EDTA K2 3 ml', 'PROVETTE', 'tube'], ['Ago butterfly 21G', 'AGHI', 'needle'], ['Holder monouso', 'AGHI', 'needle'],
    ['Contenitore urine sterile 120 ml', 'CONTENITORI', 'jar'], ['Tampone con terreno Amies', 'TAMPONI', 'swab'], ['Busta biohazard 20x30', 'TRASPORTO', 'bag'], ['Vetrino portaoggetto molato', 'VETRINI', 'slide'],
    ['Disinfettante clorexidina 500 ml', 'REAGENTI', 'bottle'], ['Etichette termiche 50x25', 'MODULISTICA', 'doc'], ['Guanti nitrile M', 'DPI', 'kit'], ['Articolo generico XYZ', 'MAGAZZINO', 'kit']];
  for (const [d, cat, icon] of casi) { const r = interpreta(d); assert.equal(r.category_code, cat, d); assert.equal(r.icon, icon, d); assert.match(r.color, /^#[0-9A-F]{6}$/i); }
  assert.equal(new Set(CATEGORIE_INTERPRETATE.map((c) => c.code)).size, CATEGORIE_INTERPRETATE.length);
});
test('mappa articolo Silva → riga feed; anni da sincronizzare', () => {
  assert.deepEqual(mappaArticolo({ codiceArticolo: 'A1', descrizione: 'Provetta', quantita: 12, unita: 'PZ', lotti: [] }), { codice: 'A1', descrizione: 'Provetta', quantita: 12, unita: 'PZ', barcode: null, confezione: null, unitaPerConfezione: null, categoria: null, lotti: [] });
  assert.deepEqual(anniDaSincronizzare({ settings: { catalog_years: '2026, 2027' } }), [2026, 2027]);
  assert.deepEqual(anniDaSincronizzare({ settings: {} }), [new Date().getFullYear()]);
});

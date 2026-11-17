// v0.77.1 · Regressione: dalla v0.46.0 sette route chiamavano servFile() senza importarla e rispondevano 500 a ogni download
// (dossier del personale, CCNL, CV Box, allegati delle richieste Finance, documenti dei professionisti di Room, Cartella, foto Retail).
// Nessun test scaricava un file, quindi non se n'era accorto nessuno. Qui: controllo statico su tutto il codice del server e un
// download vero dal dossier del personale.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const tutti = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tutti(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
// funzioni condivise che si chiamano nude e devono quindi essere importate (o definite) nel file che le usa
const CONDIVISE = ['servFile', 'intestazioniFile', 'contentDisposition', 'sendMail', 'analyzeAttachment', 'leggiAttestato'];

test('ogni file che chiama una funzione condivisa la importa o la definisce', () => {
  const mancanti = [];
  for (const f of tutti(SRC)) {
    const s = fs.readFileSync(f, 'utf8');
    const senzaCommenti = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const nome of CONDIVISE) {
      if (!new RegExp(`(^|[^.\\w])${nome}\\(`, 'm').test(senzaCommenti)) continue;
      const importata = new RegExp(`import\\s*\\{[^}]*\\b${nome}\\b[^}]*\\}\\s*from`).test(s);
      const definita = new RegExp(`(function\\s+${nome}\\b|(const|let)\\s+${nome}\\s*=|\\{[^}]*\\b${nome}\\b[^}]*\\}\\s*=\\s*await import)`).test(s);
      if (!importata && !definita) mancanti.push(`${path.relative(SRC, f)}: ${nome}`);
    }
  }
  assert.deepEqual(mancanti, []);
});

// v0.78.1 · Stessa famiglia di errore lato web: mkDoc() di Room è asincrona (jsPDF si carica al primo uso) ma pdfTurni e pdfRendiconto la
// chiamavano senza await, quindi i pulsanti PDF di Turni, Portale e Rendiconti (e l'approvazione del rendiconto) non producevano nulla.
test('web: i generatori di PDF asincroni si chiamano sempre con await', () => {
  const WEB = path.join(SRC, '..', '..', 'web', 'src');
  const tuttiWeb = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tuttiWeb(path.join(d, e.name)) : /\.jsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
  const file = tuttiWeb(WEB).map((f) => [f, fs.readFileSync(f, 'utf8')]);
  const asincrone = new Set();
  for (const [, s] of file) for (const m of s.matchAll(/export\s+async\s+function\s+((?:pdf|xlsx|mkDoc)\w*)/g)) asincrone.add(m[1]);
  assert.ok(asincrone.has('mkDoc') && asincrone.has('pdfTurni') && asincrone.has('pdfRendiconto'));
  const senza = [];
  for (const [f, s] of file) s.split('\n').forEach((riga, i) => {
    for (const n of asincrone) for (const m of riga.matchAll(new RegExp(`(?<![\\w.])${n}\\(`, 'g'))) {
      const prima = riga.slice(Math.max(0, m.index - 40), m.index);
      if (/(await|function|return)\s*$/.test(prima) || /build=\{\(\) =>/.test(riga)) continue;   // build() è atteso da MailModal
      senza.push(`${path.relative(WEB, f)}:${i + 1} ${n}`);
    }
  });
  assert.deepEqual(senza, []);
});

describe('download di un allegato del dossier', { skip: !process.env.DATABASE_URL_TEST }, () => {
  let H, S, db, O;
  before(async () => {
    H = await import('./helpers/suiteTest.mjs');
    const pg = (await import('pg')).default;
    S = await H.avviaSuite();
    db = new pg.Client({ connectionString: S.url }); await db.connect();
    O = await H.entra(H.client(S.base), H.OWNER.email, H.OWNER.password, H.OWNER.finale);
    assert.equal((await O.post('/api/travaso/contracts/run')).s, 200);
  }, { timeout: 240000 });
  after(async () => { await db?.end().catch(() => {}); await S?.stop(); });

  test('anteprima in linea e download rispondono 200 con il contenuto del file', async () => {
    const id = (await db.query(`INSERT INTO people (kind,status,last_name,first_name) VALUES ('DIPENDENTE','ATTIVO','Scaricotest','Sara') RETURNING id`)).rows[0].id;
    const corpo = '%PDF-1.4 contenuto di prova';
    const f = new FormData(); f.append('category', 'ALTRO'); f.append('file', new Blob([corpo], { type: 'application/pdf' }), 'Allegati al contratto - 13 aprile 2026.pdf');
    const up = await fetch(`${S.base}/api/contracts/resources/${id}/attachments`, { method: 'POST', headers: { cookie: O.cookie, 'X-Requested-With': 'td-suite' }, body: f });
    assert.equal(up.status, 201);
    const aid = (await up.json()).id;
    for (const [q, disp] of [['?inline=1', 'inline'], ['', 'attachment']]) {
      const r = await fetch(`${S.base}/api/contracts/resources/${id}/attachments/${aid}/download${q}`, { headers: { cookie: O.cookie } });
      assert.equal(r.status, 200, q);
      assert.equal(r.headers.get('content-type'), 'application/pdf');
      assert.ok(r.headers.get('content-disposition').startsWith(disp));
      assert.equal(await r.text(), corpo);
    }
  });
});

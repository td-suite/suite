// Amministrazione > Pulizia allegati (14/11/2026, richiesta del CEO): cerca negli ALLEGATI di Business Hub e Room Planning (e nei
// documenti delle sedi) i termini della gestione precedente, per NOME del file e per CONTENUTO (docx/xlsx/pptx dal loro XML, PDF con
// pdftotext, firmati .p7m dal PDF incapsulato, testi ed email), e permette al titolare di eliminarli definitivamente dopo conferma.
// La pulizia del 07/11/2026 (migrazione business 017) aveva toccato solo i campi di testo, non i file: questo strumento chiude il buco.
// Nessun contenuto dei file finisce nei log o nell'audit: solo nome, origine e termine trovato.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { one, many, pool } from '../db.js';
import { readBuffer, dropBlobs } from './moduleStorage.js';
import { pdfText } from './pdftext.js';

export const TERMINI_DEFAULT = ['Fanfani', 'Synlab'];
const MAX_BYTES = 60 * 1024 * 1024;

// Ogni sorgente: tabella, colonne del nome e dell'etichetta, contesto leggibile e collegamento alla pagina dove l'allegato compare
export const SORGENTI = [
  { key: 'business.contract_files', modulo: 'Business Hub', tipo: 'Allegato del contratto', nome: 'f.filename', extra: 'f.label', blob: true, prefix: 'business',
    from: `business.contract_files f JOIN business.contracts c ON c.id = f.contract_id`,
    contesto: `concat_ws(' · ', c.protocol, c.title, c.status, f.category)`, link: `'/business/contratti/' || c.id`, delicato: `f.category = 'FIRMATO'` },
  { key: 'business.dossier_files', modulo: 'Business Hub', tipo: 'Documento del fascicolo di autorizzazione', nome: 'f.filename', extra: 'f.label', blob: true, prefix: 'business',
    from: `business.dossier_files f JOIN business.dossiers d ON d.id = f.dossier_id LEFT JOIN business.contracts c ON c.id = d.contract_id LEFT JOIN public.sites st ON st.id = d.site_id`,
    contesto: `concat_ws(' · ', c.protocol, coalesce(c.title, st.name), 'fascicolo ' || d.status, f.doc_key)`, link: `'/business/fascicoli/' || d.id`, delicato: `d.status IN ('PRESENTATO','AUTORIZZATO')` },
  { key: 'business.documenti', modulo: 'Business Hub', tipo: 'Documento dell\'account', nome: 'f.filename', extra: 'f.etichetta', blob: true, prefix: 'business',
    from: `business.documenti f LEFT JOIN business.accounts a ON a.id = f.account_id LEFT JOIN public.organizations o ON o.id = a.organization_id`,
    contesto: `concat_ws(' · ', o.name, f.categoria)`, link: `CASE WHEN a.id IS NOT NULL THEN '/business/account/' || a.id ELSE '/business/email' END`, delicato: `false` },
  { key: 'room.professionista_docs', modulo: 'Room Planning', tipo: 'Documento del professionista', nome: 'f.nome', extra: 'f.note', blob: false, base64: true,
    from: `room.professionista_docs f LEFT JOIN public.people p ON p.id = f.person_id`,
    contesto: `concat_ws(' · ', concat_ws(' ', p.last_name, p.first_name), f.tipo)`, link: `'/room/specialisti'`, delicato: `false` },
  { key: 'public.site_documents', modulo: 'Sedi (Room, Finance)', tipo: 'Documento della sede', nome: 'f.filename', extra: 'NULL', blob: true, prefix: 'suite',
    from: `public.site_documents f JOIN public.sites s ON s.id = f.site_id`,
    contesto: `concat_ws(' · ', s.name, f.kind)`, link: `'/admin/sites'`, delicato: `false` },
];

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const normTermini = (t) => [...new Set((Array.isArray(t) ? t : TERMINI_DEFAULT).map((x) => String(x || '').trim()).filter((x) => x.length >= 3))].slice(0, 10);
// "Synlab" non deve mai colpire "Synclab" (il gestionale di laboratorio): è già così per costruzione, ma lo fissiamo con il confine di parola
export const reTermini = (termini) => new RegExp(`(?<![a-z0-9])(${termini.map(esc).join('|')})(?![a-z0-9])`, 'i');
const trovati = (re, testo) => { const g = new RegExp(re.source, 'gi'); return [...new Set([...String(testo || '').matchAll(g)].map((m) => m[1].toLowerCase()))]; };

const xmlTesto = (xml) => xml.replace(/<\/(w:p|a:p|si|row|text:p)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
async function testoZip(buf, filtro) {
  const zip = await JSZip.loadAsync(buf);
  const out = [];
  for (const nome of Object.keys(zip.files)) if (filtro.test(nome) && !zip.files[nome].dir) out.push(xmlTesto(await zip.files[nome].async('string')));
  return out.join('\n');
}
async function testoPdf(buf) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdpul-'));
  try {
    const file = path.join(dir, 'in.pdf'); fs.writeFileSync(file, buf);
    const pagine = await pdfText.testoPagine(file);
    return pagine.join('\n');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** Testo di un allegato: { testo, esito } con esito OK | SOLO_IMMAGINE | NON_ANALIZZABILE | TROPPO_GRANDE | ERRORE */
export async function estraiTestoAllegato(filename, buf) {
  if (!buf || !buf.length) return { testo: '', esito: 'NON_ANALIZZABILE' };
  if (buf.length > MAX_BYTES) return { testo: '', esito: 'TROPPO_GRANDE' };
  const ext = (String(filename || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
  const isPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-';
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  try {
    if (isPdf) { const t = await testoPdf(buf); return t.replace(/\s+/g, '').length < 40 ? { testo: t, esito: 'SOLO_IMMAGINE' } : { testo: t, esito: 'OK' }; }
    if (ext === 'p7m' || ext === 'p7s') {
      const a = buf.indexOf('%PDF-'); const b = buf.lastIndexOf('%%EOF');
      if (a >= 0 && b > a) {
        try { const t = await testoPdf(buf.subarray(a, b + 5)); if (t.replace(/\s+/g, '').length >= 40) return { testo: t, esito: 'OK' }; } catch { /* busta a blocchi: non leggibile così */ }
      }
      return { testo: '', esito: 'NON_ANALIZZABILE' };
    }
    if (isZip && ['docx', 'docm', 'dotx'].includes(ext)) return { testo: await testoZip(buf, /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/), esito: 'OK' };
    if (isZip && ['xlsx', 'xlsm'].includes(ext)) return { testo: await testoZip(buf, /^xl\/(sharedStrings\.xml|workbook\.xml|worksheets\/[^/]+\.xml)$/), esito: 'OK' };
    if (isZip && ['pptx'].includes(ext)) return { testo: await testoZip(buf, /^ppt\/(slides|notesSlides)\/[^/]+\.xml$/), esito: 'OK' };
    if (isZip && ['odt', 'ods'].includes(ext)) return { testo: await testoZip(buf, /^content\.xml$/), esito: 'OK' };
    if (['txt', 'csv', 'eml', 'html', 'htm', 'xml', 'json', 'md', 'rtf'].includes(ext)) return { testo: buf.toString('utf8'), esito: 'OK' };
    if (['doc', 'xls', 'msg'].includes(ext)) {   // formati binari di Office: testo in chiaro a 8 e a 16 bit
      return { testo: `${buf.toString('latin1')}\n${buf.toString('utf16le')}`, esito: 'OK' };
    }
    return { testo: '', esito: 'NON_ANALIZZABILE' };
  } catch { return { testo: '', esito: 'ERRORE' }; }
}

const esiste = async (q) => Boolean((await one('SELECT to_regclass($1) AS t', [q])).t);
const tabella = (s) => s.key;

/** Sorgenti presenti in questo database (un modulo non travasato non ha lo schema) */
export async function sorgentiAttive() {
  const out = [];
  for (const s of SORGENTI) if (await esiste(tabella(s))) out.push(s);
  return out;
}

// Stato della scansione in memoria (una alla volta): la scansione legge i file dall'archivio e può durare minuti
let corrente = null;
export const stato = () => corrente && { ...corrente, righe: corrente.righe };

export function avvia({ termini, contenuto = true, by = null } = {}) {
  if (corrente && corrente.in_corso) return corrente;
  const t = normTermini(termini);
  if (!t.length) throw Object.assign(new Error('Indica almeno un termine di 3 caratteri'), { status: 400 });
  corrente = { id: Date.now(), in_corso: true, termini: t, contenuto, by, avviata_at: new Date().toISOString(), finita_at: null, totale: 0, letti: 0, righe: [], non_analizzati: [], errore: null };
  const run = corrente;
  scansiona(run).catch((e) => { run.errore = e.message; }).finally(() => { run.in_corso = false; run.finita_at = new Date().toISOString(); });
  return run;
}

export async function scansiona(run) {
  const re = reTermini(run.termini);
  const attive = await sorgentiAttive();
  for (const s of attive) run.totale += (await one(`SELECT count(*)::int AS n FROM ${tabella(s)}`)).n;
  for (const s of attive) {
    const righe = await many(`SELECT f.id, ${s.nome} AS nome, ${s.extra} AS extra, f.size, f.created_at, ${s.contesto} AS contesto, ${s.link} AS link, (${s.delicato}) AS delicato FROM ${s.from} ORDER BY f.id`);
    for (const r of righe) {
      const base = { sorgente: s.key, modulo: s.modulo, tipo: s.tipo, id: r.id, nome: r.nome, size: r.size, created_at: r.created_at, contesto: r.contesto, link: r.link, delicato: r.delicato };
      const nelNome = trovati(re, `${r.nome}\n${r.extra || ''}`);
      let nelContenuto = []; let esito = 'NON_LETTO';
      if (run.contenuto) {
        try {
          const f = await one(`SELECT ${s.blob ? 'data, blob_path' : 'data'} FROM ${tabella(s)} WHERE id=$1`, [r.id]);
          const buf = s.base64 ? Buffer.from(String(f?.data || '').replace(/^data:[^,]*,/, ''), 'base64') : await readBuffer(f || {});
          const x = await estraiTestoAllegato(r.nome, buf);
          esito = x.esito; nelContenuto = trovati(re, x.testo);
        } catch { esito = 'ERRORE'; }
      }
      run.letti += 1;
      if (nelNome.length || nelContenuto.length) run.righe.push({ ...base, nel_nome: nelNome, nel_contenuto: nelContenuto, esito });
      else if (run.contenuto && esito !== 'OK') run.non_analizzati.push({ ...base, esito });
    }
  }
}

/** Elimina definitivamente gli allegati indicati ([{sorgente, id}]): riga del database e file dell'archivio. Restituisce l'elenco eliminato. */
export async function elimina(voci) {
  const fatte = [];
  for (const v of voci) {
    const s = SORGENTI.find((x) => x.key === v.sorgente);
    if (!s || !(await esiste(tabella(s)))) continue;
    const info = await one(`SELECT f.id, ${s.nome} AS nome, ${s.contesto} AS contesto FROM ${s.from} WHERE f.id=$1`, [v.id]);
    if (!info) continue;
    const gone = (await pool.query(`DELETE FROM ${tabella(s)} WHERE id=$1 RETURNING ${s.blob ? 'blob_path' : 'NULL::text AS blob_path'}`, [v.id])).rows[0];
    if (!gone) continue;
    if (gone.blob_path) await dropBlobs(s.prefix, [gone.blob_path]);
    fatte.push({ sorgente: s.key, modulo: s.modulo, tipo: s.tipo, id: info.id, nome: info.nome, contesto: info.contesto });
    if (corrente) { corrente.righe = corrente.righe.filter((r) => !(r.sorgente === s.key && r.id === info.id)); }
  }
  return fatte;
}
export const _reset = () => { corrente = null; };

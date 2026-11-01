// Portale Service · specchio del sito pubblico service.toscanadiagnostica.it (una sola fonte, due presentazioni identiche).
// La meccanica è comune al Portale SGI ed è in server/src/lib/specchioPortale.js; qui i parametri del Portale Service:
// - specchio(): legge /api/meta e /data/*.json (nove JSON) dall'origine; se meta.build o lo sha di un JSON cambia salva tutto
//   (contenuti, stato) e invalida la cache dei file. Lo chiama il job service:specchio (ogni 6 ore), "Aggiorna adesso" e il primo avvio.
// - importaZip(): stessa pipeline a partire dallo ZIP del repo (fallback se il sito non risponde dalla rete di Render), con i file;
//   dal contenuto dello ZIP ricava anche il PDF del Vademecum (colonna stato.vademecum_pdf).
// - leggiFile(): un PDF dalla cache (archivio a due vie del modulo) o, se manca, scaricato dall'origine e messo in cache.
// Nessuna scrittura verso il sito di origine: la Suite legge soltanto.
import { q, one, many, tx } from '../db.js';
import { creaSpecchio } from '../../../lib/specchioPortale.js';
import { config, ORIGINE_DEFAULT, VADEMECUM_PDF_DEFAULT, KEY } from '../config.js';
import { CHIAVI, validaContenuti, percorsoValido, costruisciIndice } from './regole.js';

const S = creaSpecchio({
  key: KEY,
  nome: 'Portale Service',
  db: { q, one, many, tx },
  config,
  origineDefault: ORIGINE_DEFAULT,
  chiavi: CHIAVI,
  percorsoValido,
  validaContenuti,
  costruisciIndice,
  descriviMeta: (m) => `pubblicazione del ${m.build}, REG006 rev. ${m.reg006_rev} del ${m.reg006_data}, ${m.n_pdf} PDF, ${m.n_prestazioni} prestazioni`,
  // PDF del Vademecum trovato nello ZIP; dall'origine resta quello già noto (menu.json lo indica comunque)
  extraDaZip: (percorsi) => ({ vademecum_pdf: percorsi.filter((p) => p.startsWith('vademecum/')).sort()[0] || null }),
  aggiornaStato: (c, { fonte, extra }) => c.query(`UPDATE stato SET vademecum_pdf=coalesce($1, CASE WHEN $2='ZIP' THEN NULL ELSE vademecum_pdf END) WHERE id=1`,
    [extra?.vademecum_pdf || null, fonte]),
});

export const { getImpostazione, setImpostazione, origine, leggiOrigine, provaOrigine, statoSpecchio, contenuto, indice, statoCache, svuotaCache, specchio, importaZip, leggiFile } = S;
export const specchioService = S;

/** Conteggi dello specchio confrontabili con meta.json (n_pdf = documenti in docs.json, n_prestazioni = righe di preparazioni.json). */
export async function conteggi() {
  const r = await one(`SELECT
      (SELECT jsonb_array_length(json) FROM contenuti WHERE chiave='docs') AS n_pdf,
      (SELECT jsonb_array_length(json->'righe') FROM contenuti WHERE chiave='preparazioni') AS n_prestazioni,
      (SELECT count(*) FROM jsonb_array_elements((SELECT json->'righe' FROM contenuti WHERE chiave='preparazioni')) x WHERE jsonb_array_length(coalesce(x->'link','[]'::jsonb)) > 0) AS n_prep_collegate,
      (SELECT json FROM contenuti WHERE chiave='meta') AS meta`);
  return { n_pdf: r?.n_pdf ?? null, n_prestazioni: r?.n_prestazioni ?? null, n_prep_collegate: r?.n_prep_collegate != null ? Number(r.n_prep_collegate) : null, meta: r?.meta || null };
}

/** PDF del Vademecum nello specchio: menu.json (voce vademecum, campo "pdf"), poi quello trovato nello ZIP, poi il predefinito. */
export async function vademecumPdf() {
  const menu = await contenuto('menu');
  const voce = (menu?.json?.voci || []).find((v) => v.id === 'vademecum');
  const daMenu = voce?.pdf && percorsoValido(voce.pdf);
  if (daMenu) return daMenu;
  const st = await one('SELECT vademecum_pdf FROM stato WHERE id=1');
  return st?.vademecum_pdf || VADEMECUM_PDF_DEFAULT;
}
/** Il PDF è disponibile (in cache o scaricabile adesso)? Lo scarica se manca: serve al ripiego della pagina Vademecum. */
export async function vademecumDisponibile() {
  const p = await vademecumPdf();
  try { await leggiFile(p); return { pdf: p, disponibile: true }; } catch (e) { return { pdf: p, disponibile: false, errore: e.message }; }
}

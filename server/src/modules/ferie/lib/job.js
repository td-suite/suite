// Job giornaliero ferie:promemoria (scheduler della Suite, solo con modulo LIVE):
// 1. i periodi APPROVATI con data di fine passata diventano GODUTI (evento di sistema);
// 2. piani non inviati: da `promemoria_scadenza_giorni` (7) giorni prima della scadenza di invio dell'anno (Impostazioni > scadenza del
//    piano) e dopo, promemoria al dipendente per i piani ancora in BOZZA, al massimo uno ogni `promemoria_giorni` giorni;
// 3. piani inviati (PROPOSTO, IN_REVISIONE) da più di `promemoria_giorni` (3) giorni: promemoria al responsabile (e ai delegati attivi;
//    senza responsabile agli amministratori), al massimo uno al giorno per piano;
// 4. variazioni in attesa (righe RICHIESTA) da più di `promemoria_giorni` giorni: promemoria al responsabile, al massimo uno al giorno.
import { q, many } from '../db.js';
import { settings, evento, notifica, utentiDiPersone, utentiHr, loadRichiesta, periodoTesto, quantitaTesto, oggi, itData } from './core.js';
import { perimetro } from './perimetro.js';
import { eventoPiano, destinatariResponsabile, linkArea, linkMioPiano } from './pianoAnnuale.js';
import { addDays } from './calendario.js';

export async function eseguiJob() {
  const s = await settings();
  const g = oggi();
  const out = { godute: 0, promemoria: 0, promemoria_piani_non_inviati: 0, promemoria_piani_da_approvare: 0 };
  const godute = await many(`UPDATE richieste SET stato='GODUTA', goduta_at=now(), updated_at=now() WHERE stato='APPROVATA' AND data_fine < $1::date RETURNING id`, [g]);
  for (const r of godute) { await evento(r.id, 'GODUTA', null, { automatico: true }); out.godute++; }

  const giorni = Math.max(1, Number(s.promemoria_giorni || 3));
  const perim = await perimetro({ includiDirigenti: s.includi_dirigenti !== false });

  // piani non inviati entro la scadenza dell'anno (solo le persone ancora nel perimetro)
  const anticipo = Math.max(0, Number(s.promemoria_scadenza_giorni ?? 7));
  for (const [anno, scad] of Object.entries(s.scadenze_piano || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(scad)) || g < addDays(scad, -anticipo)) continue;
    const bozze = await many(`SELECT id, person_id FROM piani WHERE anno=$1 AND stato='BOZZA' AND (promemoria_at IS NULL OR promemoria_at < now() - ($2 || ' days')::interval + interval '4 hours')`, [Number(anno), String(giorni)]);
    for (const b of bozze) {
      if (!perim.persone.has(b.person_id)) continue;
      const dest = await utentiDiPersone([b.person_id]);
      if (!dest.length) continue;
      const scaduta = g > scad;
      await notifica(dest, { id: `piano-${b.id}` }, { evento: 'promemoria_invio', link: linkMioPiano(Number(anno)),
        title: scaduta ? `Il piano ferie ${anno} andava inviato entro il ${itData(scad)}` : `Invia il piano ferie ${anno} entro il ${itData(scad)}`,
        body: 'Apri "Il mio piano", inserisci i periodi e premi "Invia al responsabile".' });
      await q('UPDATE piani SET promemoria_at=now() WHERE id=$1', [b.id]);
      await eventoPiano(b.id, 'PROMEMORIA', null, { tipo: 'invio', scadenza: scad });
      out.promemoria_piani_non_inviati++;
    }
  }

  // piani inviati in attesa del responsabile
  const inviati = await many(`SELECT id, person_id, anno, inviato_at FROM piani WHERE stato IN ('PROPOSTO','IN_REVISIONE') AND inviato_at < now() - ($1 || ' days')::interval
      AND (promemoria_at IS NULL OR promemoria_at < now() - interval '20 hours') ORDER BY inviato_at`, [String(giorni)]);
  for (const p of inviati) {
    const persona = perim.persone.get(p.person_id);
    if (!persona) continue;
    const dest = await destinatariResponsabile(persona);
    const gg = Math.floor((Date.now() - new Date(p.inviato_at).getTime()) / 86400000);
    await notifica(dest, { id: `piano-${p.id}` }, { evento: 'promemoria_approva', link: linkArea(persona.gruppo, p.anno), title: `Promemoria: il piano ferie ${p.anno} di ${persona.nome} attende da ${gg} giorni`, body: 'Rivedi i periodi, approva e rendi definitivo il piano.' });
    await q('UPDATE piani SET promemoria_at=now() WHERE id=$1', [p.id]);
    await eventoPiano(p.id, 'PROMEMORIA', null, { tipo: 'approvazione', destinatari: dest.length, giorni_attesa: gg });
    out.promemoria_piani_da_approvare++;
  }

  // variazioni in attesa
  const attesa = await many(`SELECT id, approvatore_person_id FROM richieste WHERE stato='RICHIESTA' AND created_at < now() - ($1 || ' days')::interval
      AND (promemoria_at IS NULL OR promemoria_at < now() - interval '20 hours') ORDER BY created_at`, [String(giorni)]);
  for (const a of attesa) {
    const rr = await loadRichiesta(a.id);
    const delegati = a.approvatore_person_id ? (await many(`SELECT delegato_person_id AS id FROM deleghe WHERE delegante_person_id=$1 AND $2::date BETWEEN dal AND al`, [a.approvatore_person_id, g])).map((x) => x.id) : [];
    let dest = await utentiDiPersone([a.approvatore_person_id, ...delegati]);
    if (!dest.length) dest = await utentiHr();
    const gg = Math.floor((Date.now() - new Date(rr.created_at).getTime()) / 86400000);
    await notifica(dest, rr, { evento: 'promemoria', title: `Promemoria: variazione di ${rr.persona} in attesa da ${gg} giorni`, body: `${quantitaTesto(rr)} ${periodoTesto(rr)}` });
    await q('UPDATE richieste SET promemoria_at=now() WHERE id=$1', [a.id]);
    await evento(a.id, 'PROMEMORIA', null, { destinatari: dest.length, giorni_attesa: gg });
    out.promemoria++;
  }
  return out;
}

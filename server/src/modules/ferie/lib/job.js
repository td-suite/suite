// Job giornaliero ferie:promemoria (scheduler della Suite, solo con modulo LIVE):
// 1. le richieste APPROVATE con data di fine passata diventano GODUTE (evento di sistema);
// 2. le richieste in attesa da più di `promemoria_giorni` (predefinito 3) generano un promemoria all'approvatore (e ai suoi delegati
//    attivi; senza approvatore a HR), al massimo uno al giorno per richiesta.
import { q, many } from '../db.js';
import { settings, evento, notifica, utentiDiPersone, utentiHr, loadRichiesta, periodoTesto, quantitaTesto, oggi } from './core.js';

export async function eseguiJob() {
  const s = await settings();
  const g = oggi();
  const out = { godute: 0, promemoria: 0 };
  const godute = await many(`UPDATE richieste SET stato='GODUTA', goduta_at=now(), updated_at=now() WHERE stato='APPROVATA' AND data_fine < $1::date RETURNING id`, [g]);
  for (const r of godute) { await evento(r.id, 'GODUTA', null, { automatico: true }); out.godute++; }

  const giorni = Math.max(1, Number(s.promemoria_giorni || 3));
  const attesa = await many(`SELECT id, approvatore_person_id FROM richieste WHERE stato='RICHIESTA' AND created_at < now() - ($1 || ' days')::interval
      AND (promemoria_at IS NULL OR promemoria_at < now() - interval '20 hours') ORDER BY created_at`, [String(giorni)]);
  for (const a of attesa) {
    const rr = await loadRichiesta(a.id);
    const delegati = a.approvatore_person_id ? (await many(`SELECT delegato_person_id AS id FROM deleghe WHERE delegante_person_id=$1 AND $2::date BETWEEN dal AND al`, [a.approvatore_person_id, g])).map((x) => x.id) : [];
    let dest = await utentiDiPersone([a.approvatore_person_id, ...delegati]);
    if (!dest.length) dest = await utentiHr();
    const gg = Math.floor((Date.now() - new Date(rr.created_at).getTime()) / 86400000);
    await notifica(dest, rr, { evento: 'promemoria', title: `Promemoria: ${rr.persona} attende da ${gg} giorni`, body: `${quantitaTesto(rr)} ${periodoTesto(rr)}` });
    await q('UPDATE richieste SET promemoria_at=now() WHERE id=$1', [a.id]);
    await evento(a.id, 'PROMEMORIA', null, { destinatari: dest.length, giorni_attesa: gg });
    out.promemoria++;
  }
  return out;
}

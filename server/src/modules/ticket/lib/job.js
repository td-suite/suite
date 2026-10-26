// Lavoro periodico del modulo Ticket: SLA sforati, escalation alla casella superiore, chiusura automatica dei risolti.
import { q, many } from '../db.js';
import { settings, evento, notifica, loadTicket } from './core.js';
import { unitHeadUserIds } from './access.js';

export async function runTicketJob() {
  const s = await settings();
  const out = { sforati_risposta: 0, sforati_risoluzione: 0, escalation: 0, chiusi: 0 };

  // 1. SLA sforati (solo ticket ancora aperti o in corso: l'attesa congela la scadenza)
  const r1 = await q(`UPDATE tickets SET sla_risposta_sforato=TRUE, updated_at=now() WHERE NOT sla_risposta_sforato AND prima_risposta_at IS NULL AND stato IN ('APERTO','IN_CORSO') AND sla_risposta_scadenza < now()`);
  out.sforati_risposta = r1.rowCount;
  const r2 = await q(`UPDATE tickets SET sla_risoluzione_sforato=TRUE, updated_at=now() WHERE NOT sla_risoluzione_sforato AND risolto_at IS NULL AND stato IN ('APERTO','IN_CORSO') AND sla_risoluzione_scadenza < now()`);
  out.sforati_risoluzione = r2.rowCount;

  // 2. Escalation: risoluzione sforata e nessuna presa in carico → casella superiore, avviso ai suoi responsabili
  if (s.escalation_attiva) {
    const cands = await many(`SELECT t.id, u.parent_id FROM tickets t JOIN public.org_units u ON u.id=t.unit_id
      WHERE t.stato='APERTO' AND t.assegnatario_user_id IS NULL AND t.prima_risposta_at IS NULL AND t.escalation_unit_id IS NULL
        AND t.sla_risoluzione_scadenza < now() AND u.parent_id IS NOT NULL`);
    for (const c of cands) {
      await q('UPDATE tickets SET escalation_unit_id=$2, escalated_at=now(), updated_at=now() WHERE id=$1', [c.id, c.parent_id]);
      const t = await loadTicket(c.id);
      await evento(t.id, 'ESCALATION', null, { da_unit_id: t.unit_id, a_unit_id: c.parent_id, a_unit: t.escalation_unit_nome, motivo: 'SLA di risoluzione sforato senza presa in carico' });
      await notifica(await unitHeadUserIds(c.parent_id), t, { evento: 'escalation', title: 'Escalation: ticket senza presa in carico oltre lo SLA', body: `Casella ${t.unit_nome}: nessuna presa in carico entro la scadenza. Il ticket è ora visibile anche a te come responsabile di ${t.escalation_unit_nome}.` });
      out.escalation++;
    }
  }

  // 3. Chiusura automatica dei RISOLTI dopo N giorni
  const giorni = Number(s.chiusura_automatica_giorni || 0);
  if (giorni > 0) {
    const rows = await many(`UPDATE tickets SET stato='CHIUSO', chiuso_at=now(), updated_at=now() WHERE stato='RISOLTO' AND risolto_at < now() - ($1 || ' days')::interval RETURNING id`, [String(giorni)]);
    for (const r of rows) {
      const t = await loadTicket(r.id);
      await evento(t.id, 'CHIUSO', null, { automatico: true, giorni });
      await notifica([t.richiedente_user_id], t, { evento: 'chiuso_auto', title: 'Ticket chiuso automaticamente', body: `Risolto da più di ${giorni} giorni senza riapertura.` });
      out.chiusi++;
    }
  }
  return out;
}

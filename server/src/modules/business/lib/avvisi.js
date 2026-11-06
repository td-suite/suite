// Business Hub · notifiche in app all'owner dell'account (job business:avvisi): NC aperta sul suo cliente (widget NC), ordine del
// cliente senza risposta oltre la soglia (Impostazioni, giorni), prossima azione scaduta. Le email in arrivo notificano già
// all'ingest (lib/caselle.js). Ogni evento si notifica una volta sola (tabella avvisi_inviati).
import { many, q } from '../db.js';
import { getModuleState } from '../../../lib/modules.js';
import { notify } from '../../../lib/community.js';
import { getSettings } from './rules.js';

const attivo = async (key) => { const st = await getModuleState(key); return Boolean(st.schema_ready) && ['LIVE', 'MIRROR'].includes(st.mode); };
async function una(chiave) { return (await q('INSERT INTO avvisi_inviati (chiave) VALUES ($1) ON CONFLICT DO NOTHING', [chiave])).rowCount === 1; }

export async function inviaAvvisi() {
  const s = await getSettings();
  const giorni = Number(s.hub_ordini_giorni) || 3;
  const acc = await many(`SELECT a.id, a.organization_id, a.owner_user_id, a.prossima_azione, a.data_prossima_azione, o.name AS org_name FROM accounts a JOIN public.organizations o ON o.id=a.organization_id WHERE a.owner_user_id IS NOT NULL`);
  const out = { nc: 0, ordini: 0, azioni: 0 };
  if (!acc.length) return out;
  const perOrg = new Map(); for (const a of acc) { if (!perOrg.has(a.organization_id)) perOrg.set(a.organization_id, []); perOrg.get(a.organization_id).push(a); }
  const orgIds = [...perOrg.keys()];
  if (await attivo('nc')) {
    const nc = await many(`SELECT n.id, n.codice, n.gravita, coalesce(n.org_id, s.organization_id, s.host_organization_id) AS org FROM nc.nc n LEFT JOIN public.sites s ON s.id=n.site_id
      WHERE n.opened_at >= now() - interval '3 days' AND n.stato NOT IN ('ANNULLATA') AND (n.org_id = ANY($1::int[]) OR s.organization_id = ANY($1::int[]) OR s.host_organization_id = ANY($1::int[]))`, [orgIds]).catch(() => []);
    for (const n of nc) for (const a of perOrg.get(n.org) || []) {
      if (!(await una(`nc:${n.id}:${a.id}`))) continue;
      await notify([a.owner_user_id], { kind: 'MODULO', module_key: 'business', title: `NC ${n.codice} su ${a.org_name}`.slice(0, 200), body: `Non conformità aperta (gravità ${String(n.gravita).toLowerCase()}): la trovi nella scheda account, sezione Non conformità.`, link: `/business/account/${a.id}` }).catch(() => 0);
      out.nc++;
    }
  }
  if (await attivo('orders')) {
    const ord = await many(`SELECT o.id, o.number, coalesce(o.org_id, s.organization_id) AS org, floor(extract(epoch FROM now() - o.submitted_at) / 86400)::int AS giorni
      FROM orders.orders o LEFT JOIN public.sites s ON s.id=o.site_id WHERE o.status='INVIATO' AND o.submitted_at < now() - make_interval(days => $2)
        AND (o.org_id = ANY($1::int[]) OR s.organization_id = ANY($1::int[]))`, [orgIds, giorni]).catch(() => []);
    for (const o of ord) for (const a of perOrg.get(o.org) || []) {
      if (!(await una(`ordine:${o.id}:${a.id}`))) continue;
      await notify([a.owner_user_id], { kind: 'MODULO', module_key: 'business', title: `Ordine ${o.number} di ${a.org_name} senza risposta`.slice(0, 200), body: `In attesa di approvazione da ${o.giorni} giorni (soglia ${giorni}).`, link: `/business/account/${a.id}` }).catch(() => 0);
      out.ordini++;
    }
  }
  const oggi = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  for (const a of acc) {
    if (!a.data_prossima_azione || String(a.data_prossima_azione) >= oggi) continue;
    if (!(await una(`azione:${a.id}:${a.data_prossima_azione}`))) continue;
    await notify([a.owner_user_id], { kind: 'MODULO', module_key: 'business', title: `Prossima azione scaduta: ${a.org_name}`.slice(0, 200), body: `${a.prossima_azione || 'Azione'} (prevista il ${String(a.data_prossima_azione).split('-').reverse().join('/')})`, link: `/business/account/${a.id}` }).catch(() => 0);
    out.azioni++;
  }
  await q(`DELETE FROM avvisi_inviati WHERE at < now() - interval '180 days'`);
  if (out.nc || out.ordini || out.azioni) console.log(`[business] avvisi: ${out.nc} NC, ${out.ordini} ordini, ${out.azioni} azioni scadute`);
  return out;
}


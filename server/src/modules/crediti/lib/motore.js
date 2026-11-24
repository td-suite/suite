// Recupero Crediti · motore della scala di sollecito (memo "Modello di sollecito clienti B2B"). A ogni giro: fatture da Synclab,
// riconciliazione dei bonifici, promesse e sospensioni, poi la scala nei giorni e nelle ore di invio.
//
// Regole di prudenza (il processo è il più delicato, CEO 24/11/2026):
//  - modalità PROVA (predefinita): tutto si prepara e si mostra, NULLA esce e nessuna fase avanza; ATTIVA la decidono solo CEO e CFO;
//  - partono da soli solo l'avviso di scadenza e il 1° sollecito, e solo se nessun "cancello" li ferma (vedi cancelli());
//    il 2° sollecito aspetta sempre la firma del CFO o del CEO; chiamata e area legale sono passi di persone;
//  - un cliente escluso dai solleciti (decisione di CEO o CFO), con una promessa o un piano in corso, sospeso, o con una pratica
//    legale autorizzata non riceve nulla; le fatture contestate escono dalla scala;
//  - una fase si considera fatta solo quando l'email è davvero partita: la successiva conta i giorni da lì.
import crypto from 'node:crypto';
import { one, many, q, tx } from '../db.js';
import { sendMail, mailStatus } from '../../../lib/mailer.js';
import { notify } from '../../../lib/community.js';
import { bancaAggiornata } from '../../../lib/banca.js';
import { faseDovuta, piuGiorni, piuLavorativi, giornoSettimana, FASE_LABEL } from './regole.js';
import { impostazioni, evento, oggiRoma, oraRoma } from './impostazioni.js';
import { componi, itData, eur } from './testi.js';
import { sincronizzaSynclab, fattureAperte, posizioni, destinatari, listaEmail, hub, r2 } from './fatture.js';
import { esaminaMovimenti, bonificiDubbi } from './riconcilia.js';
import { utentiConProfilo } from './access.js';

const bad = (m, s = 400) => Object.assign(new Error(m), { status: s });
const nuovoRif = () => crypto.randomBytes(5).toString('hex').toUpperCase();
const postaAttiva = () => mailStatus().provider === 'graph' || (process.env.NODE_ENV !== 'production' && process.env.CREDITI_POSTA_PROVA === '1');
const avvisa = (ids, titolo, corpo, link = '/crediti') => notify(ids, { kind: 'MODULO', module_key: 'crediti', title: titolo, body: corpo, link }).catch(() => 0);

/** Valori dei segnaposto per un cliente e una fase. */
async function valoriTesto(orgId, fase, dest, imp, oggi) {
  const prec = await many(`SELECT fase, max(inviata_at) AS at FROM comunicazioni WHERE organization_id = $1 AND stato IN ('INVIATA','REGISTRATA') GROUP BY fase`, [orgId]);
  const quando = (n) => { const x = prec.find((p) => p.fase === n); return x ? itData(oggiRoma(new Date(x.at))) : null; };
  const chiamata = await one('SELECT max(data)::text AS d FROM chiamate WHERE organization_id = $1', [orgId]);
  return { referente: dest?.nome || 'Cliente', iban: imp.iban, 'codice cliente': dest?.codice, 'ragione sociale': dest?.ragione_sociale,
    entro: itData(fase === 3 ? piuGiorni(oggi, imp.giorni_termine_2) : piuGiorni(oggi, imp.giorni_termine_1)),
    'data 1° sollecito': quando(2), 'data 2° sollecito': quando(3), 'data chiamata': chiamata?.d ? itData(chiamata.d) : null,
    firma: imp.firma_att, telefono: imp.telefono_att, email: imp.casella, 'firma raf': imp.firma_raf_nome, 'ruolo raf': imp.firma_raf_ruolo };
}

/**
 * I cancelli: motivi per cui una comunicazione NON parte da sola e aspetta una persona. Elenco vuoto = può partire.
 * pos = riga di posizioni() del cliente; righe = fatture della comunicazione; dest = destinatari(); comp = testo composto.
 */
export async function cancelli({ pos, righe, dest, comp, imp, banca, hubPresente, oggi }) {
  const c = [];
  if (!postaAttiva()) c.push('la posta della Suite non è attiva: nessuna email può partire');
  if (!banca.ok) c.push(`incassi non verificabili: ${banca.motivo}`);
  if (!dest?.to?.length) c.push('nessun indirizzo a cui scrivere: indica i destinatari nella scheda del cliente');
  if (comp.mancanti.length) c.push(`testo incompleto, manca: ${comp.mancanti.join(', ')}`);
  if (righe.some((f) => f.scadenza_origine === 'PREDEFINITA')) c.push('scadenza calcolata con i termini predefiniti: i termini di pagamento del cliente non sono indicati');
  if (hubPresente && !pos?.hub_attivo) c.push('cliente non attivo nel Business Hub');
  if (pos?.risposte_da_gestire) c.push('una risposta del cliente aspetta di essere letta');
  if (Number(pos?.note_credito) > 0) c.push(`nota di credito non ancora applicata (€ ${eur(pos.note_credito)})`);
  if (pos?.contestata) c.push('contestazione aperta su altre fatture del cliente');
  const dubbi = await bonificiDubbi(pos.organization_id, righe.map((f) => f.residuo), imp.giorni_bonifici_dubbi, oggi);
  if (dubbi.length) c.push(`${dubbi.length === 1 ? 'un bonifico recente' : `${dubbi.length} bonifici recenti`} da abbinare ${dubbi.length === 1 ? 'potrebbe' : 'potrebbero'} essere il pagamento (${dubbi.map((d) => `€ ${eur(d.importo)} del ${itData(d.data)}`).join('; ')})`);
  return c;
}

/** Spedisce una comunicazione già scritta e, se parte, fa avanzare la fase delle sue fatture ancora aperte. */
async function spedisci(k, imp, { userId = null } = {}) {
  const esito = await sendMail({ to: listaEmail(k.destinatari), cc: listaEmail(k.cc), subject: k.oggetto, html: k.corpo_html, text: k.corpo_testo, ref: `crediti:${k.id}`, from: imp.casella });
  if (!esito.ok) {
    await q(`UPDATE comunicazioni SET stato = 'FALLITA', errore = $2, email_log = $3 WHERE id = $1`, [k.id, String(esito.error || 'invio non riuscito').slice(0, 500), esito.logId ? String(esito.logId) : null]);
    await evento(k.organization_id, 'INVIO_FALLITO', `${FASE_LABEL[k.fase]}: invio non riuscito (${String(esito.error || '').slice(0, 200)})`, { userId });
    await avvisa(await utentiConProfilo('ATT', 'CFO'), `Recupero crediti: invio non riuscito`, `${FASE_LABEL[k.fase]} non partito. Verifica i permessi della casella ${imp.casella}.`, '/crediti/comunicazioni');
    return { ok: false, errore: esito.error };
  }
  const stato = esito.logged ? 'REGISTRATA' : 'INVIATA';
  await tx(async (c) => {
    const pec = k.fase === 3 ? (k.pec_indirizzo ? 'DA_INVIARE' : 'NON_PREVISTA') : 'NON_PREVISTA';
    await c.query(`UPDATE comunicazioni SET stato = $2, inviata_at = now(), email_log = $3, pec_stato = $4, errore = NULL WHERE id = $1`, [k.id, stato, esito.logId ? String(esito.logId) : null, pec]);
    await c.query(`UPDATE fatture f SET fase = GREATEST(f.fase, $2), fase_at = now(), updated_at = now() FROM comunicazioni_fatture cf WHERE cf.comunicazione_id = $1 AND cf.fattura_id = f.id AND f.stato IN ('APERTA','PARZIALE') AND f.fase < $2`, [k.id, k.fase]);
    await evento(k.organization_id, 'COMUNICAZIONE', `${FASE_LABEL[k.fase]} ${stato === 'INVIATA' ? 'inviato' : 'scritto nel registro email (posta non attiva)'} a ${k.destinatari} per € ${eur(k.totale)}${userId ? '' : ' in automatico'}`, { userId, dati: { comunicazione_id: k.id } }, c);
  });
  return { ok: true, stato };
}

/** Prepara (e, se consentito, spedisce) la comunicazione di una fase per un cliente. modo: PROVA | ATTIVA | ANTEPRIMA (non scrive). */
async function comunica({ orgId, fase, righe, pos, imp, banca, hubPresente, oggi, modo, out }) {
  const dest = await destinatari(orgId);
  const rif = nuovoRif();
  const comp = componi(fase, imp, await valoriTesto(orgId, fase, dest, imp, oggi), righe, rif);
  const stop = await cancelli({ pos, righe, dest, comp, imp, banca, hubPresente, oggi });
  const firma = fase === 3;
  const parte = modo !== 'PROVA' && !firma && !stop.length;
  const riga = { organization_id: orgId, cliente: dest?.ragione_sociale, fase, totale: comp.totale, fatture: righe.length, motivi: stop };
  if (modo === 'ANTEPRIMA') { (parte ? out.invii : firma ? out.firme : out.attese).push(riga); return; }
  const cc = [...new Set([...listaEmail(imp.cc_fissi), ...(firma && dest?.referente?.email ? [dest.referente.email.toLowerCase()] : [])])].filter((e) => !(dest?.to || []).includes(e));
  const stato = modo === 'PROVA' ? 'SIMULATA' : parte ? 'IN_CODA' : 'DA_APPROVARE';
  const motivo = [firma ? 'firma del Responsabile Amministrazione e Finanza (CFO o CEO)' : null, ...stop].filter(Boolean).join(' · ') || null;
  const k = await tx(async (c) => {
    const ins = (await c.query(`INSERT INTO comunicazioni (organization_id, fase, stato, motivo_attesa, destinatari, cc, oggetto, corpo_html, corpo_testo, totale, rif, simulata, pec_indirizzo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [orgId, fase, stato, motivo, (dest?.to || []).join(', '), cc.join(', '), comp.oggetto, comp.html, comp.testo, comp.totale, rif, modo === 'PROVA', firma ? dest?.pec || null : null])).rows[0];
    for (const f of righe) await c.query('INSERT INTO comunicazioni_fatture (comunicazione_id, fattura_id, fase, residuo) VALUES ($1,$2,$3,$4)', [ins.id, f.id, fase, f.residuo]);
    return ins;
  });
  if (stato === 'SIMULATA') { out.simulate++; return; }
  if (stato === 'DA_APPROVARE') {
    out.in_attesa++;
    await evento(orgId, 'IN_ATTESA', `${FASE_LABEL[fase]} preparato e in attesa: ${motivo}`, { dati: { comunicazione_id: k.id } });
    return;
  }
  const r = await spedisci(k, imp);
  if (r.ok) out.inviate++; else out.fallite++;
}

/** La scala: cosa è dovuto oggi, cliente per cliente. */
async function scala({ imp, oggi, modo, out }) {
  const banca = await bancaAggiornata(imp.ore_banca_fresca);
  const hubPresente = (await hub()).accounts;
  const pos = new Map((await posizioni({ oggi, tolleranza: imp.tolleranza_promessa })).map((p) => [p.organization_id, p]));
  const aperte = (await fattureAperte({ oggi })).filter((f) => f.organization_id && f.residuo > 0 && !f.contestata && f.data >= imp.fatture_dal);
  // fatture già dentro una comunicazione in corso per quella fase (in attesa, in coda, fallita oggi; in Prova anche simulata)
  const occupate = new Set((await many(`SELECT cf.fattura_id, cf.fase FROM comunicazioni_fatture cf JOIN comunicazioni k ON k.id = cf.comunicazione_id
      WHERE k.stato IN ('DA_APPROVARE','IN_CODA') OR (k.stato = 'FALLITA' AND k.creata_at > now() - interval '20 hours') OR ($1 AND k.stato = 'SIMULATA')`, [modo === 'PROVA'])).map((r) => `${r.fattura_id}:${r.fase}`));
  const perCliente = new Map();
  for (const f of aperte) {
    const fase = faseDovuta(f, imp, oggi);
    if (!fase) continue;
    if (!perCliente.has(f.organization_id)) perCliente.set(f.organization_id, new Map());
    const m = perCliente.get(f.organization_id); if (!m.has(fase)) m.set(fase, []); m.get(fase).push(f);
  }
  const attivitaAperte = new Set((await many(`SELECT organization_id FROM attivita WHERE stato = 'APERTA'`)).map((r) => r.organization_id));
  for (const [orgId, fasi] of perCliente) {
    const p = pos.get(orgId);
    if (!p) continue;
    if (['ESCLUSO', 'PROMESSA', 'SOSPESO', 'LEGALE'].includes(p.stato)) { out.fermi[p.stato] = (out.fermi[p.stato] || 0) + 1; continue; }
    if (Number(imp.soglia_minima) > 0 && p.scaduto < Number(imp.soglia_minima) && ![...fasi.keys()].every((n) => n === 1)) { out.fermi.SOTTO_SOGLIA = (out.fermi.SOTTO_SOGLIA || 0) + 1; continue; }
    for (const fase of [1, 2, 3]) {
      const righe = (fasi.get(fase) || []).filter((f) => !occupate.has(`${f.id}:${fase}`));
      if (righe.length) await comunica({ orgId, fase, righe, pos: p, imp, banca, hubPresente, oggi, modo, out });
    }
    if (fasi.has(4) && !attivitaAperte.has(orgId)) await apriChiamata({ orgId, righe: fasi.get(4), imp, oggi, modo, out });
    if (fasi.has(5)) await proponiLegale({ orgId, motivo: `Scaduto da oltre ${imp.giorni_legale} giorni dopo solleciti e chiamata`, imp, oggi, modo, out });
  }
  // chiamata senza esito utile: nessun impegno entro i giorni lavorativi previsti -> proposta all'area legale
  const senza = await many(`SELECT DISTINCT ON (c.organization_id) c.organization_id, c.data::text AS data FROM chiamate c
      WHERE c.esito = 'NESSUN_RISCONTRO' AND c.data > $1::date - 60
        AND NOT EXISTS (SELECT 1 FROM promesse p WHERE p.organization_id = c.organization_id AND p.created_at > c.created_at)
        AND NOT EXISTS (SELECT 1 FROM chiamate d WHERE d.organization_id = c.organization_id AND d.created_at > c.created_at)
      ORDER BY c.organization_id, c.created_at DESC`, [oggi]);
  for (const s of senza) {
    const p = pos.get(s.organization_id);
    if (!p || !(p.scaduto > 0) || ['ESCLUSO', 'PROMESSA', 'SOSPESO', 'LEGALE', 'CONTESTAZIONE'].includes(p.stato)) continue;
    if (piuLavorativi(s.data, imp.giorni_piano_dopo_chiamata) > oggi) continue;
    await proponiLegale({ orgId: s.organization_id, motivo: `Nessun impegno entro ${imp.giorni_piano_dopo_chiamata} giorni lavorativi dalla chiamata del ${itData(s.data)}`, imp, oggi, modo, out });
  }
}

async function apriChiamata({ orgId, righe, imp, oggi, modo, out }) {
  const dest = await destinatari(orgId);
  const totale = r2(righe.reduce((s, f) => s + f.residuo, 0));
  if (modo === 'ANTEPRIMA') { out.chiamate.push({ organization_id: orgId, cliente: dest?.ragione_sociale, totale, referente: dest?.referente?.nome || null }); return; }
  const entro = piuLavorativi(oggi, 3);
  await tx(async (c) => {
    await c.query(`INSERT INTO attivita (organization_id, tipo, entro, assegnata_user_id, fattura_ids, totale, simulata) VALUES ($1,'CHIAMATA',$2,$3,$4,$5,$6)`, [orgId, entro, dest?.referente?.id || null, righe.map((f) => f.id), totale, modo === 'PROVA']);
    if (modo === 'ATTIVA') {
      await c.query(`UPDATE fatture SET fase = 4, fase_at = now(), updated_at = now() WHERE id = ANY($1::int[]) AND fase < 4`, [righe.map((f) => f.id)]);
      await evento(orgId, 'CHIAMATA_ASSEGNATA', `Chiamata di recupero assegnata a ${dest?.referente?.nome || 'nessun referente commerciale (da indicare nella scheda)'}: € ${eur(totale)} scaduti, da fare entro il ${itData(entro)}`, {}, c);
    }
  });
  out.chiamate_aperte++;
  if (modo === 'ATTIVA') {
    if (dest?.referente?.id) await avvisa([dest.referente.id], `Chiamata di recupero: ${dest.ragione_sociale}`, `€ ${eur(totale)} scaduti dopo due solleciti. Chiama il cliente entro il ${itData(entro)} e registra l'esito.`, '/crediti/chiamate');
    else await avvisa(await utentiConProfilo('ATT', 'CFO'), `Chiamata di recupero senza referente: ${dest?.ragione_sociale}`, 'Il cliente non ha un referente commerciale: indicalo nella scheda crediti.', `/crediti/clienti/${orgId}`);
  }
}

/** Propone una pratica per l'area legale (la autorizza il RAF; sopra la soglia serve anche la Direzione). Mai automatica oltre la proposta. */
export async function proponiLegale({ orgId, motivo, imp, oggi, modo, out, userId = null }) {
  const gia = await one(`SELECT id FROM pratiche_legali WHERE organization_id = $1 AND (stato IN ('PROPOSTA','AUTORIZZATA','TRASMESSA') OR (stato = 'RESPINTA' AND chiusa_at > now() - interval '30 days')) LIMIT 1`, [orgId]);
  if (gia) return null;
  const ff = (await fattureAperte({ orgId, oggi })).filter((f) => f.giorni > 0 && !f.contestata);
  if (!ff.length) return null;
  const totale = r2(ff.reduce((s, f) => s + f.residuo, 0));
  const dir = totale > Number(imp.soglia_dir);
  if (modo === 'ANTEPRIMA') { out.pratiche.push({ organization_id: orgId, totale, serve_dir: dir, motivo }); return null; }
  const p = await one(`INSERT INTO pratiche_legali (organization_id, motivo, fattura_ids, totale, serve_dir, simulata) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [orgId, motivo, ff.map((f) => f.id), totale, dir, modo === 'PROVA']);
  if (out) out.pratiche_proposte++;
  if (modo === 'ATTIVA') {
    await evento(orgId, 'LEGALE_PROPOSTA', `Proposta di passaggio all'area legale per € ${eur(totale)}: ${motivo}`, { userId });
    await avvisa(await utentiConProfilo(...(dir ? ['CFO', 'CEO'] : ['CFO'])), 'Recupero crediti: pratica legale da autorizzare', `€ ${eur(totale)}. ${motivo}.${dir ? ' Sopra la soglia: serve anche la Direzione.' : ''}`, '/crediti/legale');
  }
  return p.id;
}

/** Approva e spedisce una comunicazione in attesa: il testo si riscrive sulle fatture ANCORA aperte in quel momento. */
export async function approva(id, user, { destinatari: destOverride = null, cc: ccOverride = null } = {}) {
  const imp = await impostazioni(); const oggi = oggiRoma();
  if (imp.modalita !== 'ATTIVA') throw bad('Modalità Prova: nessuna comunicazione può partire. La modalità Attiva si imposta dalle Impostazioni (CEO o CFO).');
  const k = await one('SELECT * FROM comunicazioni WHERE id = $1', [id]);
  if (!k) throw bad('Comunicazione non trovata', 404);
  if (!['DA_APPROVARE', 'FALLITA'].includes(k.stato)) throw bad('La comunicazione non è in attesa di approvazione');
  const pos = (await posizioni({ orgIds: [k.organization_id], oggi, tolleranza: imp.tolleranza_promessa }))[0];
  if (pos?.stato === 'ESCLUSO') throw bad('Cliente escluso dai solleciti: la comunicazione non può partire. Annullala, oppure CEO o CFO riammettono il cliente.');
  const ids = (await many('SELECT fattura_id FROM comunicazioni_fatture WHERE comunicazione_id = $1', [id])).map((r) => r.fattura_id);
  const righe = (await fattureAperte({ orgId: k.organization_id, oggi })).filter((f) => ids.includes(f.id) && !f.contestata && f.residuo > 0 && (k.fase !== 1 || f.giorni < 0));
  if (!righe.length) {
    await q(`UPDATE comunicazioni SET stato = 'ANNULLATA', motivo_attesa = 'Annullata: le fatture risultano incassate, contestate o, per un avviso, già scadute' WHERE id = $1`, [id]);
    return { annullata: true };
  }
  const dest = await destinatari(k.organization_id);
  const to = destOverride != null ? listaEmail(destOverride) : (dest?.to?.length ? dest.to : listaEmail(k.destinatari));
  if (!to.length) throw bad('Nessun destinatario valido: indica almeno un indirizzo');
  const comp = componi(k.fase, imp, await valoriTesto(k.organization_id, k.fase, dest, imp, oggi), righe, k.rif);
  if (comp.mancanti.length) throw bad(`Testo incompleto, manca: ${comp.mancanti.join(', ')}. Completa le Impostazioni (IBAN, firma, telefono) prima di inviare.`);
  const cc = (ccOverride != null ? listaEmail(ccOverride) : listaEmail(k.cc)).filter((e) => !to.includes(e));
  const agg = await tx(async (c) => {
    await c.query('DELETE FROM comunicazioni_fatture WHERE comunicazione_id = $1 AND NOT (fattura_id = ANY($2::int[]))', [id, righe.map((f) => f.id)]);
    for (const f of righe) await c.query('UPDATE comunicazioni_fatture SET residuo = $3 WHERE comunicazione_id = $1 AND fattura_id = $2', [id, f.id, f.residuo]);
    return (await c.query(`UPDATE comunicazioni SET stato = 'IN_CODA', destinatari = $2, cc = $3, oggetto = $4, corpo_html = $5, corpo_testo = $6, totale = $7, approvata_da = $8, approvata_at = now(), automatica = $9,
        pec_indirizzo = CASE WHEN fase = 3 THEN $10 ELSE pec_indirizzo END WHERE id = $1 AND stato IN ('DA_APPROVARE','FALLITA') RETURNING *`, [id, to.join(', '), cc.join(', '), comp.oggetto, comp.html, comp.testo, comp.totale, user?.id || null, !user, dest?.pec || null])).rows[0];
  });
  if (!agg) throw bad('La comunicazione è già stata lavorata da un\'altra persona');
  const r = await spedisci(agg, imp, { userId: user?.id || null });
  if (!r.ok) throw bad(`Invio non riuscito: ${r.errore}`, 502);
  return { inviata: true, stato: r.stato, totale: comp.totale, fatture: righe.length };
}

/** Manutenzione: esclusioni a termine, promesse, chiamate in ritardo, comunicazioni in attesa da ripulire o sbloccare. */
async function manutenzione({ imp, oggi, out, inFinestra }) {
  for (const c of await many(`UPDATE clienti SET escluso = FALSE, updated_at = now() WHERE escluso AND esclusione_fino IS NOT NULL AND esclusione_fino < $1::date RETURNING organization_id, esclusione_fino::text AS fino`, [oggi])) {
    await q(`INSERT INTO esclusioni_log (organization_id, azione, motivo) VALUES ($1,'RIAMMESSO',$2)`, [c.organization_id, `Termine dell'esclusione raggiunto (${itData(c.fino)})`]);
    await evento(c.organization_id, 'RIAMMESSO', `Esclusione dai solleciti terminata il ${itData(c.fino)}: il cliente rientra nella scala`);
    out.riammessi++;
  }
  for (const p of await many(`SELECT p.*, p.data::text AS d, (SELECT coalesce(sum(i.importo), 0) FROM incassi i JOIN fatture f ON f.id = i.fattura_id WHERE f.organization_id = p.organization_id AND i.stato = 'CONFERMATO' AND i.origine <> 'NOTA_CREDITO' AND i.created_at >= p.created_at) AS incassato,
        EXISTS (SELECT 1 FROM fatture f WHERE f.organization_id = p.organization_id AND f.stato IN ('APERTA','PARZIALE') AND NOT f.contestata AND f.scadenza < p.created_at::date) AS ancora_scaduto
      FROM promesse p WHERE p.stato = 'APERTA'`)) {
    const rate = Array.isArray(p.rate) ? p.rate : [];
    const incassato = Number(p.incassato);
    let esito = null;
    if (p.piano && rate.length) {
      const totale = rate.reduce((s, r) => s + Number(r.importo || 0), 0);
      const dovuto = rate.filter((r) => piuGiorni(r.data, imp.tolleranza_promessa) < oggi).reduce((s, r) => s + Number(r.importo || 0), 0);
      if (incassato >= totale - 0.005 || !p.ancora_scaduto) esito = 'MANTENUTA'; else if (incassato < dovuto - 0.005) esito = 'NON_RISPETTATA';
    } else if ((p.importo != null && incassato >= Number(p.importo) - 0.005) || !p.ancora_scaduto) esito = 'MANTENUTA';
    else if (piuGiorni(p.d, imp.tolleranza_promessa) < oggi) esito = 'NON_RISPETTATA';
    if (!esito) continue;
    await q(`UPDATE promesse SET stato = $2, chiusa_at = now() WHERE id = $1 AND stato = 'APERTA'`, [p.id, esito]);
    await evento(p.organization_id, esito === 'MANTENUTA' ? 'PROMESSA_MANTENUTA' : 'PROMESSA_NON_RISPETTATA', esito === 'MANTENUTA' ? `${p.piano ? 'Piano di rientro' : 'Promessa di pagamento'} del ${itData(p.d)} rispettat${p.piano ? 'o' : 'a'}` : `${p.piano ? 'Piano di rientro' : 'Promessa di pagamento'} del ${itData(p.d)} non rispettat${p.piano ? 'o' : 'a'}: la scala riprende`);
    if (esito === 'NON_RISPETTATA') { out.promesse_mancate++; if (imp.modalita === 'ATTIVA') await avvisa(await utentiConProfilo('ATT', 'CFO'), 'Recupero crediti: promessa non rispettata', `Il pagamento promesso per il ${itData(p.d)} non è arrivato: la scala di sollecito riprende.`, `/crediti/clienti/${p.organization_id}`); }
  }
  if (imp.modalita === 'ATTIVA') for (const a of await many(`UPDATE attivita SET sollecitata_at = now() WHERE stato = 'APERTA' AND NOT simulata AND entro < $1::date AND (sollecitata_at IS NULL OR sollecitata_at < now() - interval '3 days') RETURNING organization_id, assegnata_user_id, entro::text AS entro`, [oggi])) {
    await avvisa([...(a.assegnata_user_id ? [a.assegnata_user_id] : []), ...(await utentiConProfilo('ATT'))], 'Recupero crediti: chiamata non registrata', `La chiamata di recupero era da fare entro il ${itData(a.entro)}: registra l'esito.`, '/crediti/chiamate');
  }
  // invio rimasto a metà (riavvio del servizio fra la scrittura e la spedizione): torna in attesa di una persona, mai rispedito alla cieca
  await q(`UPDATE comunicazioni SET stato = 'DA_APPROVARE', automatica = FALSE, motivo_attesa = 'invio interrotto: controlla nella posta inviata della casella se è partito prima di approvare' WHERE stato = 'IN_CODA' AND creata_at < now() - interval '30 minutes' AND coalesce(approvata_at, creata_at) < now() - interval '30 minutes'`);
  // comunicazioni in attesa: via quelle senza più fatture aperte; avviso e 1° sollecito ripartono da soli se i motivi dell'attesa sono caduti
  const banca = await bancaAggiornata(imp.ore_banca_fresca); const hubPresente = (await hub()).accounts;
  for (const k of await many(`SELECT * FROM comunicazioni WHERE stato = 'DA_APPROVARE' ORDER BY id`)) {
    const ids = (await many('SELECT fattura_id FROM comunicazioni_fatture WHERE comunicazione_id = $1', [k.id])).map((r) => r.fattura_id);
    const righe = (await fattureAperte({ orgId: k.organization_id, oggi })).filter((f) => ids.includes(f.id) && !f.contestata && f.residuo > 0 && (k.fase !== 1 || f.giorni < 0));
    const pos = (await posizioni({ orgIds: [k.organization_id], oggi, tolleranza: imp.tolleranza_promessa }))[0];
    if (!righe.length || ['ESCLUSO', 'LEGALE'].includes(pos?.stato)) {
      await q(`UPDATE comunicazioni SET stato = 'ANNULLATA', motivo_attesa = $2 WHERE id = $1 AND stato = 'DA_APPROVARE'`, [k.id, !righe.length ? 'Annullata: le fatture risultano incassate, contestate o, per un avviso, già scadute' : `Annullata: cliente ${pos.stato === 'ESCLUSO' ? 'escluso dai solleciti' : 'passato all\'area legale'}`]);
      out.annullate++; continue;
    }
    if (imp.modalita !== 'ATTIVA' || !inFinestra || k.fase === 3 || !k.automatica || ['PROMESSA', 'SOSPESO'].includes(pos?.stato)) continue;
    const dest = await destinatari(k.organization_id);
    const comp = componi(k.fase, imp, await valoriTesto(k.organization_id, k.fase, dest, imp, oggi), righe, k.rif);
    const stop = await cancelli({ pos, righe, dest, comp, imp, banca, hubPresente, oggi });
    if (stop.length) { const m = stop.join(' · '); if (m !== k.motivo_attesa) await q('UPDATE comunicazioni SET motivo_attesa = $2 WHERE id = $1', [k.id, m]); continue; }
    try { const r = await approva(k.id, null); if (r.inviata) out.sbloccate++; } catch (e) { console.warn('[crediti] sblocco', k.id, e.message); }
  }
}

/**
 * Un giro del motore. forza = true esegue la scala anche fuori dai giorni e dalle ore di invio (pulsante "Esegui ora" di CEO e CFO).
 * anteprima = true calcola cosa farebbe la scala in modalità Attiva senza scrivere nulla.
 */
export async function giro({ adesso = new Date(), forza = false, anteprima = false } = {}) {
  const imp = await impostazioni();
  const oggi = oggiRoma(adesso), ora = oraRoma(adesso);
  const inFinestra = forza || (imp.giorni_invio.includes(giornoSettimana(oggi)) && ora >= imp.ora_invio_da && ora < imp.ora_invio_a);
  const out = { modalita: imp.modalita, oggi, scala: inFinestra, inviate: 0, in_attesa: 0, simulate: 0, fallite: 0, sbloccate: 0, annullate: 0, chiamate_aperte: 0, pratiche_proposte: 0, riammessi: 0, promesse_mancate: 0, fermi: {}, invii: [], attese: [], firme: [], chiamate: [], pratiche: [] };
  if (anteprima) { await scala({ imp, oggi, modo: 'ANTEPRIMA', out }); return out; }
  try { out.synclab = await sincronizzaSynclab(imp); } catch (e) { out.synclab = { errore: e.message }; }
  try { out.banca = await esaminaMovimenti(imp, { oggi }); } catch (e) { out.banca = { errore: e.message }; }
  await manutenzione({ imp, oggi, out, inFinestra });
  if (inFinestra) await scala({ imp, oggi, modo: imp.modalita, out });
  for (const k of ['invii', 'attese', 'firme', 'chiamate', 'pratiche']) delete out[k];
  await q('INSERT INTO giri (modalita, esito) VALUES ($1,$2)', [imp.modalita, JSON.stringify(out)]);
  await q('DELETE FROM giri WHERE id < (SELECT max(id) - 500 FROM giri)');
  if (out.inviate || out.in_attesa || out.fallite) console.log(`[crediti] giro ${imp.modalita}: ${out.inviate} inviate, ${out.in_attesa} in attesa, ${out.fallite} fallite`);
  return out;
}

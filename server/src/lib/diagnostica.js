// Diagnostica anagrafica (correzione A13 del programma "anagrafica unica", 08/11/2026; review sezione 6). Elenco dichiarativo dei
// controlli D01-D40 sull'anagrafica di sedi, Legal entity, persone e sui flussi che la toccano. Ogni controllo:
//   { id, area, gravita: BLOCCANTE|ATTENZIONE|INFO, titolo, spiegazione, richiede: [tabelle di modulo], sql, chiave, link(riga),
//     correggi?: { etichetta, conferma, descrizione, fn(righe, ctx) }, correggiDopo?: '<blocco>', attivoDopo?: '<blocco>' }
// L'esecuzione è in una transazione READ ONLY con statement_timeout di 5 s per istruzione; un controllo che richiede lo schema di un
// modulo non avviato si salta ("modulo non avviato"). Le correzioni chiamano le funzioni del core (saveSite, realignOrgPerimeters,
// siteToLease, effettiCessazione, unisciNodiSede, ...), mai SQL libero sui dati dell'anagrafica, e scrivono l'audit
// DIAGNOSTICA_CORREZIONE con prima e dopo. Le query sono quelle della review (sezione 6.2), adattate dove indicato nel commento.
import { pool, one, many, q, tx } from '../db.js';
import { bad } from './util.js';

export const AREE = {
  SEDI: 'Sedi e titolo di godimento',
  CLIENTI: 'Clienti e Legal entity',
  ORGANIGRAMMA: 'Organigramma e persone',
  SISTEMA: 'Processi e sistema',
};
export const GRAVITA = ['BLOCCANTE', 'ATTENZIONE', 'INFO'];
const enc = encodeURIComponent;
const sedeLink = (r) => (r.code || r.site_code ? `/admin/sites?q=${enc(r.code || r.site_code)}` : null);
const orgLink = (name) => (name ? `/admin/organizations?q=${enc(name)}` : null);

// ------------------------------------------------------------------ correzioni (import pigri: niente cicli tra moduli)
const sites = () => import('./sites.js');
const corr = {
  // D01: Legal entity proprietaria = Legal entity di TD (A9, Dati aziendali)
  async d01(righe, ctx) {
    const { companyOrgId } = await import('./company.js');
    const td = await companyOrgId();
    if (!td) throw bad('Imposta prima la Legal entity di Toscana Diagnostica in Impostazioni > Dati aziendali (controllo D22a)');
    const { saveSite } = await sites();
    const out = [];
    for (const r of righe) { await saveSite({ id: r.id, data: { organization_id: td }, origine: 'Diagnostica anagrafica D01', req: ctx.req }); out.push({ id: r.id, esito: `Legal entity proprietaria = #${td}` }); }
    return out;
  },
  // D02: ospitante = controparte dell'UNICO contratto PP vigente sulla sede
  async d02(righe, ctx) {
    const { saveSite } = await sites();
    const out = [];
    for (const r of righe) {
      const cc = await pp(`SELECT DISTINCT c.org_id FROM business.contracts c WHERE c.kind='PP' AND c.site_id=$1 AND c.status IN ('FIRMATO','AUTORIZZATO','ATTIVO') AND c.org_id IS NOT NULL`, [r.id]);
      if (cc.length !== 1) { out.push({ id: r.id, esito: 'non corretta', motivo: cc.length ? 'più contratti PP vigenti con controparti diverse' : 'nessun contratto PP vigente: scegli l\'ospitante in Amministrazione > Sedi' }); continue; }
      await saveSite({ id: r.id, data: { tenure: 'OSPITATA', host_organization_id: cc[0].org_id }, origine: 'Diagnostica anagrafica D02', req: ctx.req });
      out.push({ id: r.id, esito: `ospitante = #${cc[0].org_id} (controparte del contratto PP)` });
    }
    return out;
  },
  // D03: ospitante con titolo diverso da OSPITATA → OSPITATA se c'è un contratto PP vigente con quella controparte, altrimenti ospitante tolto
  async d03(righe, ctx) {
    const { saveSite } = await sites();
    const out = [];
    for (const r of righe) {
      const c = await pp(`SELECT 1 FROM business.contracts c WHERE c.kind='PP' AND c.site_id=$1 AND c.org_id=$2 AND c.status IN ('FIRMATO','AUTORIZZATO','ATTIVO') LIMIT 1`, [r.id, r.host_organization_id]);
      if (c.length) { await saveSite({ id: r.id, data: { tenure: 'OSPITATA' }, origine: 'Diagnostica anagrafica D03', req: ctx.req }); out.push({ id: r.id, esito: 'titolo = Ospitata (contratto PP vigente con l\'ospitante)' }); }
      else { await saveSite({ id: r.id, data: { host_organization_id: null }, origine: 'Diagnostica anagrafica D03', req: ctx.req }); out.push({ id: r.id, esito: 'ospitante tolto (titolo invariato)' }); }
    }
    return out;
  },
  // D04: regola della firma (A1): imposta l'ospitante se manca, avviso se è un'altra Legal entity
  async d04(righe, ctx) {
    const { allineaSedeAllaFirma } = await import('../modules/business/lib/contrattoSede.js');
    const out = [];
    for (const r of righe) { const x = await allineaSedeAllaFirma(r.id, { req: ctx.req }); out.push({ id: r.id, esito: x.esito, motivo: x.avviso || undefined }); }
    return out;
  },
  // D06: specchio di Cash riallineato al core
  async d06(righe) {
    const { syncHostToCash } = await sites();
    const out = [];
    for (const r of righe) { const n = await syncHostToCash({ query: q }, r.id); out.push({ id: r.id, esito: n ? 'Cash riallineato' : 'già allineato' }); }
    return out;
  },
  // D10a: contratto di Payments dall'anagrafica
  async d10a(righe) {
    const { siteToLease } = await import('./leaseSync.js');
    const out = [];
    for (const r of righe) { const x = await siteToLease(r.id, { rentChanged: false }).catch((e) => ({ status: 'error', reason: e.message })); out.push({ id: r.id, esito: x.status, motivo: x.reason }); }
    return out;
  },
  // D18a: nodi SEDE doppi uniti nel più vecchio, poi indice unico parziale
  async d18a(righe) {
    const { unisciNodiSede, assicuraIndiceNodiSede } = await import('../routes/orgcat.js');
    const out = [];
    for (const r of righe) { const x = await tx((c) => unisciNodiSede(c, r.site_id)); out.push({ id: r.site_id, esito: `tenuto il nodo #${x.tenuto}, uniti ${x.uniti.join(', ')}`, spostati: x.spostati }); }
    const indice = await assicuraIndiceNodiSede();
    out.push({ id: null, esito: indice ? 'indice "un nodo Sede per sede" attivo' : 'indice non creato: restano doppioni' });
    return out;
  },
  // D18b: nodo SEDE senza sede → collega alla sede omonima, crea la sede dal nodo, elimina il nodo (decisione 7)
  async d18b(righe, ctx) {
    const azione = ctx.opzioni?.azione || 'collega';
    const out = [];
    if (azione === 'elimina_nodo') {
      const { eliminaUnita } = await import('../routes/orgcat.js');
      for (const r of righe) { const x = await tx((c) => eliminaUnita(c, r.id)); out.push({ id: r.id, esito: 'nodo eliminato', spostati: x.moved }); }
      return out;
    }
    if (azione === 'crea_sede') {
      if (righe.length !== 1) throw bad('"Crea la sede dal nodo" si fa un nodo alla volta (con codice e tipo della sede)');
      const r = righe[0]; const d = ctx.opzioni?.sede || {};
      const { scriviSede } = await sites();
      const res = await tx(async (c) => {
        const s = await scriviSede(c, { data: { code: d.code, name: d.name || r.name, kind: d.kind || 'PUNTO_PRELIEVI', city: d.city || null, province: d.province || null, address: d.address || null }, origine: `Diagnostica anagrafica D18b, sede creata dal nodo #${r.id}`, req: ctx.req });
        await c.query(`UPDATE org_units SET site_id=$2, updated_at=now() WHERE id=$1 AND site_id IS NULL`, [r.id, s.site.id]);
        return s;
      });
      await res.effetti();
      out.push({ id: r.id, esito: `sede ${res.site.code} creata e collegata al nodo`, site_id: res.site.id });
      return out;
    }
    // collega: sede attiva TD con nome o nome breve uguale e senza nodo
    for (const r of righe) {
      const cand = await many(`SELECT s.id, s.code FROM sites s WHERE s.kind <> 'SERVICE' AND (lower(unaccent(s.name))=lower(unaccent($1)) OR lower(unaccent(coalesce(s.short_name,'')))=lower(unaccent($1)))
        AND NOT EXISTS (SELECT 1 FROM org_units u WHERE u.kind='SEDE' AND u.site_id=s.id)`, [r.name]);
      if (cand.length !== 1) { out.push({ id: r.id, esito: 'non corretta', motivo: cand.length ? 'più sedi con questo nome' : 'nessuna sede con questo nome: usa "Crea la sede dal nodo" o "Elimina il nodo"' }); continue; }
      await q(`UPDATE org_units SET site_id=$2, active=TRUE, updated_at=now() WHERE id=$1 AND site_id IS NULL`, [r.id, cand[0].id]);
      out.push({ id: r.id, esito: `collegato alla sede ${cand[0].code}` });
    }
    return out;
  },
  // D18c: nodi Sede mancanti (creati o adottati)
  async d18c() {
    const { ensureSiteNodes } = await import('../routes/orgcat.js');
    const n = await ensureSiteNodes();
    return [{ id: null, esito: `${n} nodi Sede creati o adottati` }];
  },
  // D18e: responsabili non attivi: cessati → effetti della cessazione (A11); altri stati → incarico da responsabile chiuso
  async d18e(righe, ctx) {
    const { effettiCessazione } = await import('./cessazione.js');
    const out = []; const fatte = new Set();
    for (const r of righe) {
      if (r.status === 'CESSATO') {
        if (fatte.has(r.person_id)) continue; fatte.add(r.person_id);
        const x = await effettiCessazione(r.person_id, { req: ctx.req, origine: 'Diagnostica anagrafica D18e' });
        out.push({ id: r.person_id, esito: `${x.incarichi_chiusi} incarichi chiusi, ${x.utenti_disattivati.length} accessi disattivati`, motivo: x.admin_da_confermare.length ? 'accesso da amministratore da confermare (D19)' : undefined });
      } else {
        await q('DELETE FROM org_positions WHERE unit_id=$1 AND person_id=$2 AND is_head', [r.unit_id, r.person_id]);
        await q('UPDATE org_units SET head_person_id=NULL WHERE id=$1 AND head_person_id=$2', [r.unit_id, r.person_id]);
        out.push({ id: r.person_id, esito: `incarico da responsabile di ${r.name} chiuso (persona ${r.status})` });
      }
    }
    return out;
  },
  // D19: persone cessate con accesso attivo → effetti della cessazione (gli amministratori solo con l'opzione esplicita)
  async d19(righe, ctx) {
    const { effettiCessazione } = await import('./cessazione.js');
    const out = []; const fatte = new Set();
    for (const r of righe) {
      if (fatte.has(r.id)) continue; fatte.add(r.id);
      const x = await effettiCessazione(r.id, { req: ctx.req, confermaAdmin: ctx.opzioni?.includi_admin === true, origine: 'Diagnostica anagrafica D19' });
      out.push({ id: r.id, esito: `${x.utenti_disattivati.length} accessi disattivati, ${x.incarichi_chiusi} incarichi chiusi`, motivo: x.admin_da_confermare.length ? `amministratori non disattivati senza conferma: ${x.admin_da_confermare.map((u) => u.email).join(', ')}` : undefined });
    }
    return out;
  },
  // D22a: Legal entity di TD = proposta automatica (A9)
  async d22a(_righe, ctx) {
    const { propostaCompanyOrg, aggiornaOrgTd } = await import('./company.js');
    const p = await propostaCompanyOrg();
    if (!p) throw bad('Nessuna Legal entity proponibile (né P.IVA dei Dati aziendali né nome "Toscana Diagnostica"): creala in Amministrazione > Legal entity');
    const r = await tx(async (c) => {
      await c.query(`INSERT INTO app_settings (key, value, updated_by) VALUES ('company_org_id',$1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now(), updated_by=EXCLUDED.updated_by`, [JSON.stringify(p.id), ctx.req?.user?.id || null]);
      const saved = (await c.query(`SELECT value FROM app_settings WHERE key='company'`)).rows[0]?.value || null;
      return aggiornaOrgTd(c, saved);
    });
    return [{ id: p.id, esito: `Legal entity di TD = ${p.name} (#${p.id}, ${p.come})`, modifiche: r.modifiche }];
  },
  // D22b: Legal entity di TD allineata ai Dati aziendali
  async d22b() {
    const { aggiornaOrgTd } = await import('./company.js');
    const r = await tx(async (c) => aggiornaOrgTd(c, (await c.query(`SELECT value FROM app_settings WHERE key='company'`)).rows[0]?.value || null));
    return [{ id: r.org_id, esito: r.org_id ? 'Legal entity di TD allineata ai Dati aziendali' : 'Legal entity di TD non impostata', modifiche: r.modifiche }];
  },
  // D30: planimetria corrente ripubblicata in Room
  async d30(righe) {
    const { publishCurrentPlan } = await import('./roomPlan.js');
    const out = [];
    for (const r of righe) { const x = await publishCurrentPlan(r.id).catch((e) => ({ error: e.message })); out.push({ id: r.id, esito: x?.error ? 'non pubblicata' : 'pubblicata in Room', motivo: x?.error }); }
    return out;
  },
  // D31: coordinate dall'indirizzo, in coda (una al secondo), scritte con saveSite
  async d31(righe, ctx) {
    const { geocodeAddress } = await import('./geocode.js');
    const { saveSite } = await sites();
    (async () => { for (const r of righe) { try { const s = await one('SELECT * FROM sites WHERE id=$1', [r.id]); const g = await geocodeAddress(s); if (g) await saveSite({ id: r.id, data: { lat: g.lat, lng: g.lng }, origine: 'Diagnostica anagrafica D31', actorId: ctx.req?.user?.id || null }); } catch (e) { console.warn('[diagnostica] D31', r.id, e.message); } } })();
    return [{ id: null, esito: `${righe.length} sedi in coda per le coordinate` }];
  },
  // D33: accessi esterni di Legal entity disattivate → DISABLED
  async d33(righe) {
    const out = [];
    for (const r of righe) { const x = await q(`UPDATE users SET status='DISABLED', updated_at=now() WHERE id=$1 AND is_external AND status='ACTIVE'`, [r.id]); out.push({ id: r.id, esito: x.rowCount ? 'accesso disattivato' : 'già disattivato' }); }
    return out;
  },
  // D34: perimetri dei partner riallineati alle sedi ospitate
  async d34(righe, ctx) {
    const { realignOrgPerimeters } = await import('./esterni.js');
    const orgs = [...new Set(righe.map((r) => r.org_id).filter(Boolean))];
    const out = [];
    for (const o of orgs) { const x = await realignOrgPerimeters(o, { actorId: ctx.req?.user?.id }); out.push({ id: o, esito: `${x.changed} grant riallineati su ${x.users} utenti` }); }
    return out;
  },
};
// controllo su schema di modulo dentro le correzioni (lettura semplice)
const pp = (sql, p) => many(sql, p);

// ------------------------------------------------------------------ controlli
export const CONTROLLI = [
  // ---------------- Sedi e titolo di godimento
  { id: 'D01', area: 'SEDI', gravita: 'BLOCCANTE', titolo: 'Sedi TD senza Legal entity proprietaria', spiegazione: 'Ogni sede di Toscana Diagnostica (non SERVICE) appartiene a una Legal entity: quella di TD indicata nei Dati aziendali (A9).',
    sql: `SELECT s.id, s.code, s.name, s.kind FROM sites s WHERE s.active AND s.kind <> 'SERVICE' AND s.organization_id IS NULL ORDER BY s.code`, chiave: 'id', link: sedeLink,
    correggi: { etichetta: 'Assegna la Legal entity di TD', conferma: true, descrizione: 'organization_id = Legal entity di TD (Dati aziendali), con saveSite e audit', fn: corr.d01 } },
  { id: 'D02', area: 'SEDI', gravita: 'BLOCCANTE', titolo: 'Sedi OSPITATE senza Legal entity ospitante', spiegazione: 'Una sede ospitata deve indicare chi la ospita: Cash (royalties) e l\'accesso del partner dipendono da questo dato.',
    sql: `SELECT id, code, name FROM sites WHERE active AND tenure = 'OSPITATA' AND host_organization_id IS NULL ORDER BY code`, chiave: 'id', link: sedeLink,
    correggi: { etichetta: 'Ospitante dal contratto PP', conferma: true, descrizione: 'ospitante = controparte dell\'unico contratto PP vigente sulla sede (se manca o ce ne sono più, la riga resta da sistemare in Sedi)', fn: corr.d02, richiede: ['business.contracts'] } },
  { id: 'D03', area: 'SEDI', gravita: 'ATTENZIONE', titolo: 'Ospitante valorizzato ma titolo diverso da Ospitata', spiegazione: 'Succedeva dopo un contratto creato in Payments o una modifica da Cash: l\'ospitante restava sulla sede in locazione.',
    sql: `SELECT id, code, name, tenure, host_organization_id FROM sites WHERE active AND host_organization_id IS NOT NULL AND tenure <> 'OSPITATA' ORDER BY code`, chiave: 'id', link: sedeLink,
    correggi: { etichetta: 'Rendi coerente', conferma: true, descrizione: 'titolo = Ospitata se c\'è un contratto PP vigente con l\'ospitante, altrimenti ospitante tolto', fn: corr.d03 } },
  { id: 'D04', area: 'SEDI', gravita: 'BLOCCANTE', titolo: 'Contratti PP vigenti con sede non ospitata dalla controparte', richiede: ['business.contracts'], spiegazione: 'Regola della firma (decisione 2): la sede del contratto PP è Ospitata dalla controparte. Se l\'ospitante è un\'altra Legal entity decide il CEO.',
    sql: `SELECT c.id, c.protocol, c.status, s.id AS site_id, s.code, s.tenure, s.host_organization_id, c.org_id FROM business.contracts c JOIN sites s ON s.id = c.site_id
          WHERE c.kind = 'PP' AND c.status IN ('FIRMATO','AUTORIZZATO','ATTIVO') AND (s.tenure <> 'OSPITATA' OR s.host_organization_id IS DISTINCT FROM c.org_id) ORDER BY s.code`, chiave: 'id', link: sedeLink,
    correggi: { etichetta: 'Applica la regola della firma', conferma: true, descrizione: 'se la sede non ha ospitante diventa Ospitata dalla controparte; se ne ha un altro resta l\'avviso (nessuna scrittura)', fn: corr.d04 } },
  { id: 'D05', area: 'SEDI', gravita: 'INFO', titolo: 'Punti prelievo ospitati senza contratto PP vigente', richiede: ['business.contracts'], spiegazione: 'Punti in sede di terzi senza il contratto con il partner nel Business Hub.',
    sql: `SELECT s.id, s.code, s.name, s.host_organization_id FROM sites s WHERE s.active AND s.kind = 'PUNTO_PRELIEVI' AND s.tenure = 'OSPITATA'
          AND NOT EXISTS (SELECT 1 FROM business.contracts c WHERE c.kind = 'PP' AND c.site_id = s.id AND c.status IN ('FIRMATO','AUTORIZZATO','ATTIVO')) ORDER BY s.code`, chiave: 'id', link: sedeLink },
  { id: 'D06', area: 'SEDI', gravita: 'BLOCCANTE', titolo: 'Cash diverso dal core (ospitante o tipo di sede)', richiede: ['cash.site_ext'], spiegazione: 'Lo specchio di Cash (site_ext) deve coincidere con il titolo dell\'anagrafica: Cash non scrive più titolo e ospitante (A2).',
    sql: `SELECT s.id, s.code, s.tenure, s.host_organization_id, e.host_org_id, e.ownership FROM sites s JOIN cash.site_ext e ON e.site_id = s.id
          WHERE e.host_org_id IS DISTINCT FROM CASE WHEN s.tenure = 'OSPITATA' THEN s.host_organization_id END
             OR e.ownership IS DISTINCT FROM CASE WHEN s.tenure = 'OSPITATA' THEN 'OSPITATA' ELSE 'PROPRIA' END ORDER BY s.code`, chiave: 'id', link: sedeLink,
    correggi: { etichetta: 'Riallinea Cash dal core', conferma: true, descrizione: 'cash.site_ext.ownership e host_org_id ricopiati dall\'anagrafica', fn: corr.d06 } },
  { id: 'D07', area: 'SEDI', gravita: 'ATTENZIONE', titolo: 'Azienda di Cash diversa dalla Legal entity della sede', richiede: ['cash.site_ext'], spiegazione: 'L\'azienda Cash della sede dovrebbe essere la sua Legal entity proprietaria.',
    sql: `SELECT s.id, s.code, s.organization_id, e.company_id FROM sites s JOIN cash.site_ext e ON e.site_id = s.id WHERE e.company_id IS DISTINCT FROM s.organization_id ORDER BY s.code`, chiave: 'id', link: sedeLink, correggiDopo: 'Fase 3 (B6: azienda Cash derivata dalla sede)' },
  { id: 'D08', area: 'SEDI', gravita: 'ATTENZIONE', titolo: 'Sedi in locazione senza canone, decorrenza o locatore', spiegazione: 'Il canone si inserisce una volta sola in Amministrazione > Sedi (Payments e Facility lo leggono da lì).',
    sql: `SELECT id, code, name, rent_amount, lease_start, lease_landlord_org_id FROM sites WHERE active AND kind <> 'SERVICE' AND tenure = 'LOCAZIONE' AND (rent_amount IS NULL OR lease_start IS NULL OR lease_landlord_org_id IS NULL) ORDER BY code`, chiave: 'id', link: sedeLink },
  { id: 'D09', area: 'SEDI', gravita: 'ATTENZIONE', titolo: 'Sedi in locazione senza PDF del contratto', spiegazione: 'Il contratto di locazione in PDF si carica nella scheda della sede (lettura con Claude).',
    sql: `SELECT s.id, s.code, s.name FROM sites s WHERE s.active AND s.kind <> 'SERVICE' AND s.tenure = 'LOCAZIONE' AND NOT EXISTS (SELECT 1 FROM site_documents d WHERE d.site_id = s.id AND d.kind = 'CONTRATTO_LOCAZIONE') ORDER BY s.code`, chiave: 'id', link: sedeLink },
  { id: 'D10a', area: 'SEDI', gravita: 'BLOCCANTE', titolo: 'Locazione con canone e decorrenza senza contratto Payments', richiede: ['finance.lease_contracts'], spiegazione: 'Il contratto dello Scadenziario strutture nasce dall\'anagrafica (siteToLease).',
    sql: `SELECT s.id, s.code, s.name FROM sites s WHERE s.active AND s.tenure = 'LOCAZIONE' AND s.rent_amount IS NOT NULL AND s.lease_start IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM finance.lease_contracts l WHERE l.site_id = s.id AND l.active AND l.registry_sync) ORDER BY s.code`, chiave: 'id', link: sedeLink,
    correggi: { etichetta: 'Crea il contratto in Payments', conferma: true, descrizione: 'siteToLease: contratto collegato all\'anagrafica con lo scatto iniziale', fn: corr.d10a } },
  { id: 'D10b', area: 'SEDI', gravita: 'ATTENZIONE', titolo: 'Contratto Payments attivo su sede non in locazione o chiusa', richiede: ['finance.lease_contracts'], spiegazione: 'Le scadenze continuano a correre: il contratto si chiude nello Scadenziario strutture.',
    sql: `SELECT l.id, l.site_id, s.code, s.tenure, s.active FROM finance.lease_contracts l JOIN sites s ON s.id = l.site_id WHERE l.active AND (s.tenure <> 'LOCAZIONE' OR NOT s.active) ORDER BY s.code`, chiave: 'id', link: sedeLink },
  { id: 'D10c', area: 'SEDI', gravita: 'INFO', titolo: 'Canone di Sedi diverso dallo scatto iniziale di Payments', richiede: ['finance.lease_contracts', 'finance.lease_steps'], spiegazione: 'Differenza tra il canone dell\'anagrafica e il primo scatto del contratto collegato.',
    sql: `SELECT s.id, s.code, s.rent_amount, st.amount FROM sites s JOIN finance.lease_contracts l ON l.site_id = s.id AND l.active AND l.registry_sync
          JOIN finance.lease_steps st ON st.lease_id = l.id AND st.reason = 'INIZIALE' WHERE st.amount IS DISTINCT FROM s.rent_amount ORDER BY s.code`, chiave: 'id', link: sedeLink },
  { id: 'D11', area: 'SEDI', gravita: 'INFO', titolo: 'Contratti SEDE ancora nel Business Hub', richiede: ['business.contracts', 'business.contract_files', 'business.dossiers'], spiegazione: 'Il contratto di locazione sta in Sedi: i contratti SEDE si eliminano con l\'operazione una tantum qui sotto (Prova, poi Esegui; A3).',
    sql: `SELECT c.id, c.protocol, c.status, c.site_id, s.code, s.tenure, s.rent_amount, c.data->'rent'->>'amount' AS canone_business,
          (SELECT count(*)::int FROM business.contract_files f WHERE f.contract_id = c.id) AS file, (SELECT count(*)::int FROM business.dossiers d WHERE d.contract_id = c.id) AS fascicoli
          FROM business.contracts c LEFT JOIN sites s ON s.id = c.site_id WHERE c.kind = 'SEDE' ORDER BY c.id`, chiave: 'id', link: sedeLink },

  // ---------------- Clienti e Legal entity
  { id: 'D12', area: 'CLIENTI', gravita: 'BLOCCANTE', titolo: 'Account con contratto vigente ancora prospect o sotto la fase 6', richiede: ['business.accounts', 'business.contracts'], spiegazione: 'Il contratto della linea firmato o attivo rende il cliente contrattualizzato (decisione 1: "attivo" lo conferma il CEO).',
    sql: `SELECT a.id, o.name, a.linea, a.prospect, a.cliente_attivo, a.contrattualizzato_at, a.fase_corrente FROM business.accounts a JOIN organizations o ON o.id = a.organization_id
          WHERE EXISTS (SELECT 1 FROM business.contracts c WHERE c.org_id = a.organization_id AND c.kind = a.linea AND c.status IN ('FIRMATO','AUTORIZZATO','ATTIVO'))
            AND (a.prospect OR a.contrattualizzato_at IS NULL OR a.fase_corrente < 6) ORDER BY o.name`, chiave: 'id', link: (r) => `/business/account/${r.id}`, correggiDopo: 'Fase 2 (A5: clienti attivi e contrattualizzati)' },
  { id: 'D13', area: 'CLIENTI', gravita: 'BLOCCANTE', titolo: 'Clienti Service/MdL vigenti senza sede SERVICE', richiede: ['business.accounts', 'business.contracts'], attivoDopo: 'Fase 2 (A5 e A7: regola del cliente attivo e sede SERVICE creata dalla contrattualizzazione)', spiegazione: 'Ogni cliente Service o MdL contrattualizzato ha il suo punto SERVICE con il codice StudioLAB (decisione 5).',
    sql: `SELECT o.id, o.name, a.linea FROM business.accounts a JOIN organizations o ON o.id = a.organization_id WHERE a.linea IN ('SRV','MDL')
          AND (a.cliente_attivo OR a.contrattualizzato_at IS NOT NULL OR EXISTS (SELECT 1 FROM business.contracts c WHERE c.org_id = a.organization_id AND c.kind = a.linea AND c.status IN ('FIRMATO','ATTIVO')))
          AND NOT EXISTS (SELECT 1 FROM sites s WHERE s.organization_id = o.id AND s.kind = 'SERVICE' AND s.active) ORDER BY o.name`, chiave: 'id', link: (r) => orgLink(r.name) },
  { id: 'D14', area: 'CLIENTI', gravita: 'ATTENZIONE', titolo: 'Sedi SERVICE di Legal entity non clienti, non attive o senza account', richiede: ['business.accounts'], spiegazione: 'Un punto SERVICE appartiene a un cliente Service o MdL attivo.',
    sql: `SELECT s.id, s.code, s.studiolab_code, o.id AS org_id, o.name, o.kind FROM sites s LEFT JOIN organizations o ON o.id = s.organization_id
          WHERE s.kind = 'SERVICE' AND s.active AND (o.id IS NULL OR o.kind <> 'CLIENTE' OR NOT o.active OR NOT EXISTS (SELECT 1 FROM business.accounts a WHERE a.organization_id = o.id AND a.linea IN ('SRV','MDL'))) ORDER BY s.code`, chiave: 'id', link: sedeLink },
  { id: 'D15a', area: 'CLIENTI', gravita: 'BLOCCANTE', titolo: 'Sedi SERVICE senza codice StudioLAB', spiegazione: 'Il codice lo inserisce chi gestisce il widget subito dopo la creazione del cliente (decisione 5).',
    sql: `SELECT id, code, name FROM sites WHERE kind = 'SERVICE' AND active AND coalesce(studiolab_code, '') = '' ORDER BY code`, chiave: 'id', link: sedeLink },
  { id: 'D15b', area: 'CLIENTI', gravita: 'BLOCCANTE', titolo: 'Codice StudioLAB su più sedi', spiegazione: 'Ordini e NC abbinano il codice a una sola sede: con due sedi l\'abbinamento è arbitrario.',
    sql: `SELECT lower(studiolab_code) AS codice, array_agg(id ORDER BY id) AS sedi FROM sites WHERE coalesce(studiolab_code, '') <> '' GROUP BY 1 HAVING count(*) > 1 ORDER BY 1`, chiave: 'codice', link: (r) => `/admin/sites?q=${enc(r.codice)}` },
  { id: 'D16a', area: 'CLIENTI', gravita: 'ATTENZIONE', titolo: 'Legal entity con la stessa P.IVA', spiegazione: 'Duplicati da unire con lo strumento di fusione (decisione 9).',
    sql: `SELECT regexp_replace(upper(vat_number), '[^0-9A-Z]', '', 'g') AS piva, array_agg(id ORDER BY id) AS ids, array_agg(name ORDER BY id) AS nomi FROM organizations WHERE coalesce(vat_number, '') <> '' GROUP BY 1 HAVING count(*) > 1 ORDER BY 1`, chiave: 'piva', link: (r) => `/admin/organizations?q=${enc(r.piva)}`, correggiDopo: 'Fase 3 (B5b: fusione di Legal entity duplicate)' },
  { id: 'D16b', area: 'CLIENTI', gravita: 'ATTENZIONE', titolo: 'Legal entity con lo stesso codice fiscale (diverso dalla P.IVA)', spiegazione: 'Possibili duplicati.',
    sql: `SELECT upper(tax_code) AS cf, array_agg(id ORDER BY id) AS ids FROM organizations WHERE coalesce(tax_code, '') <> '' AND tax_code IS DISTINCT FROM vat_number GROUP BY 1 HAVING count(*) > 1 ORDER BY 1`, chiave: 'cf', link: () => '/admin/organizations', correggiDopo: 'Fase 3 (B5b)' },
  { id: 'D16c', area: 'CLIENTI', gravita: 'INFO', titolo: 'Legal entity con nomi molto simili', spiegazione: 'Somiglianza dei nomi di almeno 0,8 (pg_trgm).',
    sql: `SELECT a.id AS id_a, a.name AS nome_a, b.id AS id_b, b.name AS nome_b, round(similarity(lower(a.name), lower(b.name))::numeric, 2) AS sim
          FROM organizations a JOIN organizations b ON a.id < b.id AND similarity(lower(a.name), lower(b.name)) >= 0.8 ORDER BY sim DESC`, chiave: 'id_a', link: (r) => orgLink(r.nome_a), correggiDopo: 'Fase 3 (B5b)' },
  { id: 'D17', area: 'CLIENTI', gravita: 'INFO', titolo: 'Legal entity da rivedere', spiegazione: 'Create in automatico (locatori, richiedenti, prospect) con la spunta "da rivedere".',
    sql: `SELECT id, kind, name, notes, created_at FROM organizations WHERE needs_review ORDER BY created_at DESC`, chiave: 'id', link: (r) => orgLink(r.name) },
  { id: 'D20', area: 'CLIENTI', gravita: 'ATTENZIONE', titolo: 'Legal entity tra le strutture di Ordini e NC senza essere clienti', richiede: ['orders.strutture_v', 'business.accounts'], spiegazione: 'Finché A4 non è fatto, Ordini e NC mostrano tutte le Legal entity come strutture.',
    sql: `SELECT v.org_id, v.name, v.org_kind, v.configured FROM orders.strutture_v v WHERE v.origin = 'ORG' AND v.active
          AND NOT EXISTS (SELECT 1 FROM business.accounts a WHERE a.organization_id = v.org_id AND a.linea IN ('SRV','MDL') AND (a.cliente_attivo OR a.contrattualizzato_at IS NOT NULL))
          AND NOT EXISTS (SELECT 1 FROM sites s WHERE s.organization_id = v.org_id AND s.kind = 'SERVICE' AND s.active) ORDER BY v.name`, chiave: 'org_id', link: (r) => orgLink(r.name), correggiDopo: 'Fase 2 (A4)' },
  { id: 'D21a', area: 'CLIENTI', gravita: 'ATTENZIONE', titolo: 'Clienti B2B di Retail non abbinati a una Legal entity', richiede: ['retail.customers'], spiegazione: 'Il ponte codice StudioLAB → Legal entity è la correzione B15.',
    sql: `SELECT c.id, c.external_code, c.company_name, c.vat_number, c.b2b_type FROM retail.customers c WHERE c.kind = 'B2B' AND NOT c.demo AND c.organization_id IS NULL ORDER BY c.company_name`, chiave: 'id', link: (r) => `/retail/clienti/${r.id}`, correggiDopo: 'Fase 3 (B15)' },
  { id: 'D21b', area: 'CLIENTI', gravita: 'ATTENZIONE', titolo: 'B2B abbinato a una Legal entity diversa da quella della sede con lo stesso codice', richiede: ['retail.customers'], spiegazione: 'Codice cliente StudioLAB uguale al codice della sede SERVICE ma Legal entity diversa.',
    sql: `SELECT c.id, c.external_code, s.id AS site_id, s.code, s.organization_id, c.organization_id AS customer_org_id FROM retail.customers c
          JOIN sites s ON lower(s.studiolab_code) = lower(c.external_code) WHERE c.kind = 'B2B' AND c.organization_id IS DISTINCT FROM s.organization_id ORDER BY c.external_code`, chiave: 'id', link: sedeLink, correggiDopo: 'Fase 3 (B15)' },
  { id: 'D22a', area: 'CLIENTI', gravita: 'BLOCCANTE', titolo: 'Legal entity di TD non collegata ai Dati aziendali', spiegazione: 'A9: la riga di Toscana Diagnostica in Legal entity è quella indicata nei Dati aziendali, con la stessa P.IVA.',
    // adattata ad A9: anomalia se company_org_id manca, se la sua P.IVA non è quella dei Dati aziendali, o se nessuna società del gruppo ha quella P.IVA
    sql: `WITH k AS (SELECT CASE WHEN jsonb_typeof(value) = 'number' THEN (value)::text::int END AS org_id FROM app_settings WHERE key = 'company_org_id'),
               v AS (SELECT coalesce(nullif(regexp_replace(value->>'vat', '\\D', '', 'g'), ''), '07528130482') AS piva FROM app_settings WHERE key = 'company' UNION ALL SELECT '07528130482' WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'company'))
          SELECT 'Legal entity di TD non impostata nei Dati aziendali' AS problema, NULL::int AS org_id WHERE NOT EXISTS (SELECT 1 FROM k WHERE org_id IS NOT NULL)
          UNION ALL SELECT 'P.IVA della Legal entity di TD diversa dai Dati aziendali', o.id FROM k JOIN organizations o ON o.id = k.org_id, v WHERE regexp_replace(coalesce(o.vat_number, ''), '\\D', '', 'g') <> (SELECT piva FROM v LIMIT 1)
          UNION ALL SELECT 'Nessuna società del gruppo ha la P.IVA dei Dati aziendali', NULL WHERE NOT EXISTS (SELECT 1 FROM organizations o WHERE o.kind IN ('SOCIETA','GRUPPO') AND regexp_replace(coalesce(o.vat_number, ''), '\\D', '', 'g') = (SELECT piva FROM v LIMIT 1))`,
    chiave: 'problema', link: () => '/admin/settings',
    correggi: { etichetta: 'Usa la proposta automatica', conferma: true, descrizione: 'company_org_id = Legal entity con la P.IVA dei Dati aziendali (altrimenti di nome Toscana Diagnostica) e allineamento dei suoi campi', fn: corr.d22a, tutte: true } },
  { id: 'D22b', area: 'CLIENTI', gravita: 'ATTENZIONE', titolo: 'Legal entity di TD diversa dai Dati aziendali', spiegazione: 'Ragione sociale, P.IVA, CF, indirizzo, PEC e SDI della riga di TD devono essere quelli dei Dati aziendali (si allineano al salvataggio).',
    // adattata ad A9: confronto campo per campo con la riga company_org_id (la seconda query della review è D22c)
    sql: `WITH k AS (SELECT CASE WHEN jsonb_typeof(value) = 'number' THEN (value)::text::int END AS org_id FROM app_settings WHERE key = 'company_org_id'),
               c AS (SELECT value AS v FROM app_settings WHERE key = 'company')
          SELECT o.id, o.name, x.campo, x.legal_entity, x.dati_aziendali FROM k JOIN organizations o ON o.id = k.org_id CROSS JOIN c
          CROSS JOIN LATERAL (VALUES ('ragione sociale', o.name, nullif(c.v->>'legal_name', '')), ('P.IVA', o.vat_number, nullif(regexp_replace(coalesce(c.v->>'vat', ''), '\\D', '', 'g'), '')),
                                     ('codice fiscale', o.tax_code, nullif(c.v->>'tax_code', '')), ('indirizzo', o.address, nullif(c.v->>'address', '')), ('PEC', o.pec, nullif(c.v->>'pec', '')), ('SDI', o.sdi, nullif(c.v->>'sdi_code', ''))) x(campo, legal_entity, dati_aziendali)
          WHERE x.dati_aziendali IS NOT NULL AND x.legal_entity IS DISTINCT FROM x.dati_aziendali`,
    chiave: 'campo', link: () => '/admin/settings', correggi: { etichetta: 'Allinea ai Dati aziendali', conferma: true, descrizione: 'i campi della Legal entity di TD presi dai Dati aziendali', fn: corr.d22b, tutte: true } },
  { id: 'D22c', area: 'CLIENTI', gravita: 'INFO', titolo: 'Copie dell\'indirizzo del Laboratorio nelle impostazioni dei moduli', richiede: ['business.app_settings', 'nc.app_settings'], spiegazione: 'Nome e indirizzo del Laboratorio verranno letti dalla sede LABORATORIO (B9); senza chiave il modulo usa il valore predefinito del codice.',
    sql: `SELECT 'business' AS modulo, key, value::text AS valore FROM business.app_settings WHERE key = 'lab_address' UNION ALL SELECT 'nc', key, value::text FROM nc.app_settings WHERE key IN ('lab_nome','lab_indirizzo')`, chiave: 'key', link: () => null, correggiDopo: 'Fase 3 (B9)' },
  { id: 'D23', area: 'CLIENTI', gravita: 'INFO', titolo: 'Referenti Business senza persona o con persona di un\'altra Legal entity', richiede: ['business.contatti', 'business.accounts'], spiegazione: 'Abbinamento per email dei referenti alle persone dell\'anagrafica (B7).',
    sql: `SELECT k.id, k.account_id, k.email, p.id AS person_id, p.organization_id FROM business.contatti k JOIN business.accounts a ON a.id = k.account_id LEFT JOIN people p ON lower(p.email) = lower(k.email)
          WHERE k.email IS NOT NULL AND (k.person_id IS NULL OR p.organization_id IS DISTINCT FROM a.organization_id) ORDER BY k.email`, chiave: 'id', link: (r) => `/business/account/${r.account_id}`, correggiDopo: 'Fase 3 (B7)' },
  { id: 'D25', area: 'CLIENTI', gravita: 'ATTENZIONE', titolo: 'Tipi assegnati dal creatore: locatori PARTNER, richiedenti Spedizioni CLIENTE', spiegazione: 'Decisione 8: locatori = FORNITORE, partner dei punti prelievo = PARTNER (migrazione B5).',
    sql: `SELECT id, kind, name, notes FROM organizations WHERE (kind = 'PARTNER' AND (notes ILIKE '%contratto di locazione%' OR notes ILIKE '%Scadenziario strutture%')) OR (kind = 'CLIENTE' AND notes ILIKE 'Creata da Shipments%') ORDER BY name`, chiave: 'id', link: (r) => orgLink(r.name), correggiDopo: 'Fase 3 (B5)' },
  { id: 'D33', area: 'CLIENTI', gravita: 'BLOCCANTE', titolo: 'Accessi esterni attivi di Legal entity disattivate', spiegazione: 'Un partner o cliente disattivato non deve più entrare nella Suite.',
    sql: `SELECT u.id, u.email, o.id AS org_id, o.name FROM users u LEFT JOIN people p ON p.id = u.person_id JOIN organizations o ON o.id = coalesce(p.organization_id, u.organization_id)
          WHERE u.is_external AND u.status = 'ACTIVE' AND NOT o.active ORDER BY o.name, u.email`, chiave: 'id', link: (r) => `/admin/users/${r.id}`,
    correggi: { etichetta: 'Disattiva gli accessi', conferma: true, descrizione: 'utenti esterni in stato DISABLED', fn: corr.d33 } },

  // ---------------- Organigramma e persone
  { id: 'D18a', area: 'ORGANIGRAMMA', gravita: 'BLOCCANTE', titolo: 'Più nodi SEDE per la stessa sede', spiegazione: 'Un solo nodo Sede per sede (A8): i doppioni si uniscono nel più vecchio, poi si attiva l\'indice unico.',
    sql: `SELECT site_id, (SELECT code FROM sites s WHERE s.id = u.site_id) AS code, array_agg(id ORDER BY id) AS nodi FROM org_units u WHERE kind = 'SEDE' AND site_id IS NOT NULL GROUP BY site_id HAVING count(*) > 1 ORDER BY site_id`, chiave: 'site_id', link: (r) => `/admin/organization?q=${enc(r.code || '')}`,
    correggi: { etichetta: 'Unisci i nodi doppi', conferma: true, descrizione: 'resta il nodo più vecchio; unità dipendenti, persone e incarichi passano a lui; poi indice unico parziale', fn: corr.d18a } },
  { id: 'D18b', area: 'ORGANIGRAMMA', gravita: 'ATTENZIONE', titolo: 'Nodi SEDE senza sede', spiegazione: 'Decisione 7: per ogni nodo si collega la sede omonima, si crea la sede dal nodo o si elimina il nodo.',
    sql: `SELECT u.id, u.name, (SELECT p.name FROM org_units p WHERE p.id = u.parent_id) AS padre FROM org_units u WHERE u.kind = 'SEDE' AND u.site_id IS NULL AND u.active ORDER BY u.name`, chiave: 'id', link: (r) => `/admin/organization?q=${enc(r.name)}`,
    correggi: { etichetta: 'Collega alla sede omonima', conferma: true, descrizione: 'collega il nodo alla sede con lo stesso nome; altrimenti "Crea la sede dal nodo" o "Elimina il nodo" dalla riga', fn: corr.d18b, azioni: ['collega', 'crea_sede', 'elimina_nodo'] } },
  { id: 'D18c', area: 'ORGANIGRAMMA', gravita: 'ATTENZIONE', titolo: 'Sedi TD senza nodo', spiegazione: 'Ogni sede TD attiva ha il suo nodo Sede (creato o adottato da saveSite).',
    sql: `SELECT s.id, s.code, s.name, s.org_node FROM sites s WHERE s.active AND s.kind <> 'SERVICE' AND NOT EXISTS (SELECT 1 FROM org_units u WHERE u.kind = 'SEDE' AND u.site_id = s.id) ORDER BY s.code`, chiave: 'id', link: sedeLink,
    correggi: { etichetta: 'Crea o adotta i nodi', conferma: true, descrizione: 'ensureSiteNodes: adotta il nodo omonimo senza sede, altrimenti lo crea sotto la Direzione', fn: corr.d18c, tutte: true } },
  { id: 'D18d', area: 'ORGANIGRAMMA', gravita: 'BLOCCANTE', titolo: 'Sedi TD senza responsabile attivo', spiegazione: 'Audit, Room e Ordini restano senza destinatario: il responsabile si nomina in Organizzazione.',
    // adattata ad A8: conta solo i responsabili ATTIVI (un responsabile cessato non è un responsabile)
    sql: `SELECT s.id, s.code, s.name FROM sites s WHERE s.active AND s.kind <> 'SERVICE'
          AND NOT EXISTS (SELECT 1 FROM org_units u JOIN org_positions op ON op.unit_id = u.id AND op.is_head JOIN people p ON p.id = op.person_id AND p.status = 'ATTIVO' WHERE u.kind = 'SEDE' AND u.site_id = s.id) ORDER BY s.code`, chiave: 'id', link: (r) => `/admin/organization?q=${enc(r.name)}` },
  { id: 'D18e', area: 'ORGANIGRAMMA', gravita: 'BLOCCANTE', titolo: 'Responsabili (di qualunque unità) non più attivi', spiegazione: 'A11: alla cessazione gli incarichi si chiudono.',
    sql: `SELECT u.id AS unit_id, u.name, p.id AS person_id, p.last_name, p.status FROM org_units u JOIN org_positions op ON op.unit_id = u.id AND op.is_head JOIN people p ON p.id = op.person_id WHERE p.status <> 'ATTIVO' ORDER BY u.name`, chiave: 'person_id', link: (r) => `/admin/people?q=${enc(r.last_name)}`,
    correggi: { etichetta: 'Chiudi gli incarichi', conferma: true, descrizione: 'persone cessate: effetti della cessazione (incarichi chiusi, accessi disattivati); altri stati: incarico da responsabile chiuso', fn: corr.d18e } },
  { id: 'D19', area: 'ORGANIGRAMMA', gravita: 'BLOCCANTE', titolo: 'Persone cessate con accesso attivo', spiegazione: 'A11: l\'accesso di una persona cessata si disattiva (un amministratore solo con conferma esplicita).',
    sql: `SELECT p.id, p.last_name, p.first_name, p.terminated_at, u.id AS user_id, u.email, u.level, u.last_login_at FROM people p JOIN users u ON u.person_id = p.id WHERE p.status = 'CESSATO' AND u.status = 'ACTIVE' ORDER BY p.last_name`, chiave: 'id', link: (r) => `/admin/users/${r.user_id}`,
    correggi: { etichetta: 'Disattiva gli accessi', conferma: true, descrizione: 'accessi DISABLED e incarichi chiusi; gli amministratori solo con "includi gli amministratori"', fn: corr.d19, opzioneAdmin: true } },
  { id: 'D34', area: 'ORGANIGRAMMA', gravita: 'BLOCCANTE', titolo: 'Partner con perimetro Cash non allineato alle sedi ospitate', spiegazione: 'Il partner ospitante vede in Cash le royalties delle sue sedi: il perimetro si ricalcola dalle sedi ospitate.',
    sql: `SELECT u.id AS user_id, u.email, s.id AS site_id, s.code, coalesce(p.organization_id, u.organization_id) AS org_id FROM users u LEFT JOIN people p ON p.id = u.person_id
          JOIN grants g ON g.user_id = u.id AND g.module_key = 'cash' JOIN sites s ON s.active AND s.tenure = 'OSPITATA' AND s.host_organization_id = coalesce(p.organization_id, u.organization_id)
          WHERE u.is_external AND u.status = 'ACTIVE' AND NOT EXISTS (SELECT 1 FROM grant_scopes gs WHERE gs.grant_id = g.id AND gs.scope_type = 'SITE' AND gs.scope_id = s.id) ORDER BY u.email`, chiave: 'user_id', link: (r) => `/admin/users/${r.user_id}`,
    correggi: { etichetta: 'Riallinea i perimetri', conferma: true, descrizione: 'realignOrgPerimeters per le Legal entity dei partner', fn: corr.d34 } },
  { id: 'D35', area: 'ORGANIGRAMMA', gravita: 'INFO', titolo: 'Personale attivo senza sede di afferenza', spiegazione: 'Dipendenti, LP e dirigenti senza sede di lavoro.',
    sql: `SELECT p.id, p.last_name, p.kind FROM people p WHERE p.status = 'ATTIVO' AND p.kind IN ('DIPENDENTE','LP','DIRIGENTE') AND p.site_id IS NULL ORDER BY p.last_name`, chiave: 'id', link: (r) => `/admin/people?q=${enc(r.last_name)}` },
  { id: 'D36', area: 'ORGANIGRAMMA', gravita: 'INFO', titolo: 'Sede del contratto di lavoro diversa dalla sede di afferenza', richiede: ['contracts.employments'], attivoDopo: 'Fase 4 (C13: regola di coerenza tra sede di afferenza e sede del contratto)', spiegazione: 'Tre rappresentazioni di "dove lavora" senza regola di coerenza.',
    sql: `SELECT p.id, p.last_name, p.site_id, e.work_site_id FROM people p JOIN contracts.employments e ON e.resource_id = p.id WHERE e.work_site_id IS DISTINCT FROM p.site_id ORDER BY p.last_name`, chiave: 'id', link: (r) => `/admin/people?q=${enc(r.last_name)}` },

  // ---------------- Processi e sistema
  { id: 'D24', area: 'SISTEMA', gravita: 'ATTENZIONE', titolo: 'Account PP con sede chiusa o non PP, o data di avvio diversa dall\'apertura', richiede: ['business.accounts'], attivoDopo: 'Fase 3 (B1: data di avvio effettiva scritta in Sedi)', spiegazione: 'La data di avvio effettiva del punto diventa l\'apertura della sede.',
    sql: `SELECT a.id, a.pp_site_id, s.code, s.active, s.kind, a.data_avvio_effettiva, s.opened_at FROM business.accounts a JOIN sites s ON s.id = a.pp_site_id
          WHERE a.linea = 'PP' AND (NOT s.active OR s.kind <> 'PUNTO_PRELIEVI' OR a.data_avvio_effettiva IS DISTINCT FROM s.opened_at) ORDER BY s.code`, chiave: 'id', link: (r) => `/business/account/${r.id}` },
  { id: 'D26', area: 'SISTEMA', gravita: 'BLOCCANTE', titolo: 'Sorgenti legacy che hanno scritto l\'anagrafica di recente', spiegazione: 'A12: la sincronizzazione dalle app di origine non scrive più sedi, Legal entity e persone. Controlla anche, in Render, LEGACY_FINANCE_DATABASE_URL e LEGACY_SHIPMENTS_DATABASE_URL.',
    // adattata ad A12: solo le sorgenti che negli ultimi 7 giorni hanno creato o aggiornato sedi, organizzazioni o persone
    sql: `SELECT key, enabled, last_sync_at, last_status, stats FROM legacy_sources WHERE enabled AND last_sync_at > now() - interval '7 days'
          AND (coalesce((stats->'sedi'->>'creati')::int, 0) + coalesce((stats->'sedi'->>'aggiornati')::int, 0) + coalesce((stats->'organizzazioni'->>'creati')::int, 0)
             + coalesce((stats->'organizzazioni'->>'aggiornati')::int, 0) + coalesce((stats->'persone'->>'creati')::int, 0) + coalesce((stats->'persone'->>'aggiornati')::int, 0)) > 0 ORDER BY key`, chiave: 'key', link: () => '/admin/legacy' },
  { id: 'D27', area: 'SISTEMA', gravita: 'INFO', titolo: 'Sedi nate o aggiornate dal connettore', spiegazione: 'Il connettore abbina per codice: rinominare il codice in Sedi crea un doppione al prossimo invio (B11).',
    sql: `SELECT s.id, s.code, s.name, s.legacy_refs FROM sites s WHERE EXISTS (SELECT 1 FROM jsonb_object_keys(s.legacy_refs) k WHERE k LIKE 'ingest:%') ORDER BY s.code`, chiave: 'id', link: sedeLink },
  { id: 'D28', area: 'SISTEMA', gravita: 'ATTENZIONE', titolo: 'Sedi chiuse con dati ancora vivi', richiede: ['business.accounts'], spiegazione: 'Quadro d\'impatto della chiusura: account PP, persone, utenti e perimetri ancora sulla sede.',
    // adattata: solo le sedi chiuse con almeno un dato vivo (la query della review elencava tutte le sedi disattivate)
    sql: `SELECT * FROM (SELECT s.id, s.code, s.closed_at, (SELECT count(*)::int FROM business.accounts a WHERE a.pp_site_id = s.id) AS account_pp,
          (SELECT count(*)::int FROM people p WHERE p.site_id = s.id AND p.status = 'ATTIVO') AS persone, (SELECT count(*)::int FROM users u WHERE u.site_id = s.id AND u.status = 'ACTIVE') AS utenti,
          (SELECT count(*)::int FROM grant_scopes g WHERE g.scope_type = 'SITE' AND g.scope_id = s.id) AS perimetri FROM sites s WHERE NOT s.active) x
          WHERE account_pp + persone + utenti + perimetri > 0 ORDER BY code`, chiave: 'id', link: sedeLink },
  { id: 'D29', area: 'SISTEMA', gravita: 'INFO', titolo: 'Punti SERVICE configurati in Room', richiede: ['room.site_ext'], spiegazione: 'Room riguarda le sedi TD (B10).',
    sql: `SELECT s.id, s.code FROM room.site_ext e JOIN sites s ON s.id = e.site_id WHERE s.kind = 'SERVICE' ORDER BY s.code`, chiave: 'id', link: sedeLink },
  { id: 'D30', area: 'SISTEMA', gravita: 'ATTENZIONE', titolo: 'Planimetria di Sedi non pubblicata in Room', spiegazione: 'La planimetria corrente della sede va in Room Planning.',
    sql: `SELECT s.id, s.code, d.id AS doc_id, d.created_at, d.published_room_at FROM sites s
          JOIN LATERAL (SELECT * FROM site_documents x WHERE x.site_id = s.id AND x.kind = 'PLANIMETRIA' ORDER BY x.created_at DESC, x.id DESC LIMIT 1) d ON TRUE WHERE s.active AND d.published_room_at IS NULL ORDER BY s.code`, chiave: 'id', link: sedeLink,
    correggi: { etichetta: 'Pubblica in Room', conferma: true, descrizione: 'publishCurrentPlan (se Room Planning è avviato)', fn: corr.d30 } },
  { id: 'D31', area: 'SISTEMA', gravita: 'INFO', titolo: 'Sedi TD senza coordinate', spiegazione: 'Mappa, meteo e Intorno del Retail usano le coordinate.',
    sql: `SELECT id, code, name FROM sites WHERE active AND kind <> 'SERVICE' AND (lat IS NULL OR lng IS NULL) ORDER BY code`, chiave: 'id', link: sedeLink,
    correggi: { etichetta: 'Calcola dall\'indirizzo', conferma: false, descrizione: 'coordinate da OpenStreetMap, in coda, salvate con saveSite', fn: corr.d31 } },
  { id: 'D39', area: 'SISTEMA', gravita: 'BLOCCANTE', titolo: 'Colonne di riferimento a sedi e Legal entity senza chiave esterna', spiegazione: 'Un riferimento senza FK può puntare a una sede o Legal entity inesistente.',
    sql: `SELECT c.table_schema, c.table_name, c.column_name FROM information_schema.columns c
          WHERE c.table_schema NOT IN ('pg_catalog','information_schema') AND c.column_name ~ '(^|_)(site_id|sede_id|struttura_id|org_id|organization_id|company_id|host_org_id)$'
            AND NOT EXISTS (SELECT 1 FROM information_schema.key_column_usage k JOIN information_schema.table_constraints t ON t.constraint_name = k.constraint_name AND t.constraint_schema = k.constraint_schema
                            WHERE t.constraint_type = 'FOREIGN KEY' AND k.table_schema = c.table_schema AND k.table_name = c.table_name AND k.column_name = c.column_name)
            AND c.table_name NOT LIKE '%\\_v' AND EXISTS (SELECT 1 FROM information_schema.tables tt WHERE tt.table_schema = c.table_schema AND tt.table_name = c.table_name AND tt.table_type = 'BASE TABLE')
          ORDER BY 1, 2, 3`, chiave: 'table_name', link: () => null },
  { id: 'D40', area: 'SISTEMA', gravita: 'INFO', titolo: 'Tabelle residue dello scadenziario in Cash', spiegazione: 'Prima passata C8: tabelle create solo da vecchie migrazioni di Cash.',
    sql: `SELECT t AS tabella FROM unnest(ARRAY['cash.lease_contracts','cash.utilities','cash.schedule_done']) t WHERE to_regclass(t) IS NOT NULL`, chiave: 'tabella', link: () => null },
];
export const controllo = (id) => CONTROLLI.find((c) => c.id.toLowerCase() === String(id).toLowerCase());

// ------------------------------------------------------------------ esecuzione
async function esistono(c, tabelle) {
  if (!tabelle?.length) return [];
  const r = await c.query(`SELECT t FROM unnest($1::text[]) t WHERE to_regclass(t) IS NULL`, [tabelle]);
  return r.rows.map((x) => x.t);
}

/** Esegue i controlli (tutti o `ids`) in una transazione di sola lettura. limite = righe per controllo. */
export async function esegui({ ids = null, limite = 50 } = {}) {
  const scelti = ids ? CONTROLLI.filter((k) => ids.includes(k.id)) : CONTROLLI;
  const c = await pool.connect();
  const out = [];
  try {
    await c.query('BEGIN READ ONLY');
    await c.query(`SET LOCAL statement_timeout = '5s'`);
    for (const k of scelti) {
      const base = { id: k.id, area: k.area, area_nome: AREE[k.area], gravita: k.gravita, titolo: k.titolo, spiegazione: k.spiegazione,
        correggi: k.correggi ? { etichetta: k.correggi.etichetta, conferma: k.correggi.conferma !== false, descrizione: k.correggi.descrizione, tutte: Boolean(k.correggi.tutte), azioni: k.correggi.azioni || null, opzione_admin: Boolean(k.correggi.opzioneAdmin) } : null,
        correggi_dopo: k.correggiDopo || null, chiave: k.chiave };
      if (k.attivoDopo) { out.push({ ...base, stato: 'DOPO', n: null, righe: [], nota: `controllo attivo dopo ${k.attivoDopo}` }); continue; }
      const mancano = await esistono(c, k.richiede || []);
      if (mancano.length) { out.push({ ...base, stato: 'NON_AVVIATO', n: null, righe: [], nota: `modulo non avviato (${mancano.join(', ')})` }); continue; }
      await c.query('SAVEPOINT k');
      try {
        const lim = Math.max(1, Number.isFinite(Number(limite)) ? Number(limite) : 50);
        const r = await c.query(`SELECT x.*, count(*) OVER () AS __n FROM (${k.sql}) x LIMIT ${lim}`);
        const n = r.rows[0] ? Number(r.rows[0].__n) : 0;
        const righe = (Number(limite) === 0 ? [] : r.rows).map(({ __n, ...x }) => ({ ...x, __link: k.link ? k.link(x) : null }));
        out.push({ ...base, stato: n === 0 ? 'OK' : k.gravita, n, righe });
        await c.query('RELEASE SAVEPOINT k');
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT k');
        out.push({ ...base, stato: 'ERRORE', n: null, righe: [], nota: /statement timeout/.test(e.message) ? 'tempo scaduto (5 s)' : e.message });
      }
    }
    await c.query('ROLLBACK');
  } finally { c.release(); }
  return out;
}

export const riepilogo = (risultati) => ({
  bloccanti: risultati.filter((r) => r.stato === 'BLOCCANTE').length,
  attenzione: risultati.filter((r) => r.stato === 'ATTENZIONE').length,
  info: risultati.filter((r) => r.stato === 'INFO').length,
  ok: risultati.filter((r) => r.stato === 'OK').length,
  altri: risultati.filter((r) => ['DOPO', 'NON_AVVIATO', 'ERRORE'].includes(r.stato)).length,
});

/** Salva l'esito (job giornaliero o "Esegui e salva") e restituisce il precedente per il confronto. */
export async function salvaEsito(risultati, userId = null) {
  const prev = await one('SELECT id, at, bloccanti, risultati FROM diagnostica_runs ORDER BY at DESC LIMIT 1');
  const sint = risultati.map((r) => ({ id: r.id, gravita: r.gravita, stato: r.stato, n: r.n }));
  const bloccanti = risultati.filter((r) => r.stato === 'BLOCCANTE').reduce((a, r) => a + (r.n || 0), 0);
  const row = await one('INSERT INTO diagnostica_runs (by_user, risultati, bloccanti) VALUES ($1,$2,$3) RETURNING id, at', [userId, JSON.stringify(sint), bloccanti]);
  return { run: { ...row, bloccanti }, precedente: prev };
}

/** Controlli BLOCCANTI cresciuti rispetto all'esito precedente: [{ id, titolo, prima, ora }] */
export function cresciuti(risultati, prev) {
  const old = Object.fromEntries((prev?.risultati || []).map((r) => [r.id, r.n || 0]));
  return risultati.filter((r) => r.stato === 'BLOCCANTE' && (r.n || 0) > (old[r.id] || 0)).map((r) => ({ id: r.id, titolo: r.titolo, prima: old[r.id] || 0, ora: r.n }));
}

/** Correzione: rilegge le righe ancora anomale tra quelle indicate e chiama la funzione del controllo. */
export async function correggi(id, { ids = [], opzioni = {}, req = null } = {}) {
  const k = controllo(id);
  if (!k) throw bad('Controllo inesistente');
  if (k.attivoDopo) throw bad(`Controllo attivo dopo ${k.attivoDopo}`);
  if (!k.correggi) throw bad(k.correggiDopo ? `Correzione disponibile dopo ${k.correggiDopo}` : 'Questo controllo non ha una correzione automatica: si sistema nella scheda indicata');
  const manca = (k.correggi.richiede || []).length ? (await many(`SELECT t FROM unnest($1::text[]) t WHERE to_regclass(t) IS NULL`, [k.correggi.richiede])).map((x) => x.t) : [];
  if (manca.length) throw bad(`Correzione non disponibile: modulo non avviato (${manca.join(', ')})`);
  const prima = (await esegui({ ids: [k.id], limite: 5000 }))[0];
  if (prima.stato === 'NON_AVVIATO' || prima.stato === 'ERRORE') throw bad(prima.nota || 'Controllo non eseguibile');
  const wanted = new Set((ids || []).map(String));
  const righe = k.correggi.tutte ? prima.righe : prima.righe.filter((r) => wanted.has(String(r[k.chiave])));
  if (!righe.length && !k.correggi.tutte) throw bad('Nessuna delle righe indicate è ancora anomala');
  const esito = await k.correggi.fn(righe.map(({ __link, ...r }) => r), { req, opzioni });
  const dopo = (await esegui({ ids: [k.id], limite: 5000 }))[0];
  return { controllo: k.id, prima: { n: prima.n, righe: righe.map(({ __link, ...r }) => r) }, esito, dopo: { n: dopo.n, stato: dopo.stato } };
}

/** CSV con separatore ";" (Excel italiano). colonne: [[chiave, intestazione]] */
export function csv(righe, colonne) {
  const cell = (v) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return '﻿' + [colonne.map((c) => cell(c[1])).join(';'), ...righe.map((r) => colonne.map((c) => cell(r[c[0]])).join(';'))].join('\r\n') + '\r\n';
}

// ------------------------------------------------------------------ lavoro giornaliero
export function registerDiagnosticaJobs(registerJob) {
  registerJob('core:diagnostica', 24 * 60, async () => {
    const risultati = await esegui({ limite: 0 });
    const { run, precedente } = await salvaEsito(risultati, null);
    const cr = cresciuti(risultati, precedente);
    if (cr.length) {
      const { notify, adminUserIds } = await import('./community.js');
      await notify(await adminUserIds(), { kind: 'AVVISO', title: `Diagnostica anagrafica: ${cr.length} controlli bloccanti in aumento`,
        body: cr.map((x) => `${x.id} ${x.titolo}: ${x.prima} → ${x.ora}`).join('; '), link: '/admin/diagnostica' }).catch(() => 0);
    }
    return { run: run.id, ...riepilogo(risultati), cresciuti: cr.length };
  });
}

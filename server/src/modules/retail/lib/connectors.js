// Connettori verso i gestionali. Struttura pronta: configurazione cifrata, test di connessione, sincronizzazione.
// GIPO e StudioLab non espongono API pubbliche documentate: finché il fornitore non fornisce credenziali
// di integrazione, i dati entrano con l'import da file (lib/importer.js). TuoTempo espone API REST v3.
import { one, many, q } from '../db.js';
import { decrypt } from './crypto.js';
import { HttpError } from './util.js';
import { runImport } from './importer.js';

export async function getConnector(kind) {
  const c = await one('SELECT * FROM connectors WHERE kind=$1', [kind]);
  if (!c) throw new HttpError(404, 'Connettore inesistente');
  return c;
}

// TuoTempo API v3 (documento "Tuotempo Api integration (Key Entities)"): Bearer api_key fisso, chiamate server-side da IP statici
// autorizzati da Docplanner, parametro "fields" obbligatorio su ogni chiamata, header User-Agent obbligatorio, Content-Type JSON.
// Perimetro contrattuale: solo Key Entities (typologies, activities, areas, resources, insurances). Reservations e users NON sono autorizzati.
const TT_FIELDS = {
  typologies: 'typologyid,typologyTitle,legacyid,isHiddenResource,tags',
  activities: 'activityid,activityTitle,description,duration,price,typologyid,typologyTitle,legacyid,isHidden,isHiddenArea,created,modified,price_rules,first_appointment,user_min_age,user_max_age',
  areas: 'areaid,areaTitle,isHidden,isDefault,webTitle,legacyid,address,cp,city,province,region,latitude,longitude,mobile,landline,opening_hrs,rooms,tags',
  resources: 'resourceid,machid,resourceName,name,location,status,isHidden,legacyid,idnumber,is_machine,email,rphone,tags',
  insurances: 'insuranceid,insurance_title,legacyid,legacyTitle,isDefault,IsHidden,tags',
};
export const TT_USER_AGENT = 'td-retail/1.0 (node-fetch; Toscana Diagnostica)';
async function tuotempoRequest(c, path, params = {}) {
  const creds = c.credentials ? JSON.parse(decrypt(c.credentials)) : {};
  const settings = c.settings || {};
  if (!settings.instance) throw new HttpError(400, 'Impostare l\'identificativo dell\'istanza TuoTempo (dbName) nelle impostazioni del connettore');
  if (!creds.token && !creds.password) throw new HttpError(400, 'Impostare l\'api_key TuoTempo (autenticazione API key)');
  const resource = path.replace(/^\//, '').split('/')[0];
  const url = new URL(`${(c.base_url || 'https://app.tuotempo.com/api/v3').replace(/\/$/, '')}/${settings.instance}/${path.replace(/^\//, '')}`);
  if (!params.fields && TT_FIELDS[resource]) params.fields = TT_FIELDS[resource];
  if (settings.lang || !params.lang) params.lang = settings.lang || 'it';
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  const headers = { accept: 'application/json', 'content-type': 'application/json; charset=utf-8', 'user-agent': TT_USER_AGENT, authorization: `Bearer ${creds.token || creds.password}` };
  let res;
  try { res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) }); } catch (e) { throw new HttpError(502, `TuoTempo non raggiungibile: ${e.cause?.message || e.message}`); }
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* non JSON */ }
  if (!res.ok || (json && json.result && json.result !== 'OK')) {
    const msg = json?.msg || text.slice(0, 200);
    const hint = /not logged in|permission/i.test(msg) ? ' · Verifica: api_key corretta per questa istanza, IP statici in uscita di Render autorizzati da Docplanner, risorsa inclusa nel perimetro contrattuale (solo Key Entities).' : '';
    throw new HttpError(502, `TuoTempo ${res.status}${json?.exception ? ` ${json.exception}` : ''}: ${msg}${hint}`);
  }
  if (!json) throw new HttpError(502, 'Risposta TuoTempo non in formato JSON');
  return json;
}
const ttResults = (j) => (Array.isArray(j?.return?.results) ? j.return.results : Array.isArray(j?.results) ? j.results : Array.isArray(j?.return?.results?.results) ? j.return.results.results : []);
// Lettura completa con paginazione (dove disponibile: istanze standalone)
async function ttList(c, resource, params = {}) {
  const out = []; let page = 1;
  for (;;) {
    const j = await tuotempoRequest(c, resource, { ...params, page, limit: 500 });
    const rows = ttResults(j); out.push(...rows);
    if (rows.length < 500 || page >= 40) break;
    page++;
  }
  return out;
}

export async function testConnector(kind) {
  const c = await getConnector(kind);
  if (kind === 'TUOTEMPO') {
    // Endpoint leggero del perimetro autorizzato (Key Entities): elenco aree (sedi) dell'istanza
    const r = await tuotempoRequest(c, 'areas', {});
    const areas = ttResults(r);
    return { ok: true, message: `Connessione riuscita: ${areas.length} aree (${areas.slice(0, 5).map((a) => a.areaTitle).join(', ')}${areas.length > 5 ? '…' : ''})` };
  }
  if (!c.base_url) throw new HttpError(400, `${kind}: nessun endpoint configurato. Finché il fornitore non attiva l'integrazione, usa l'import da file.`);
  try {
    const res = await fetch(c.base_url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    return { ok: res.ok, message: `Endpoint raggiungibile (HTTP ${res.status})` };
  } catch (e) { throw new HttpError(502, `Endpoint non raggiungibile: ${e.message}`); }
}

// Sincronizzazione TuoTempo: il perimetro contrattuale copre solo le Key Entities, quindi si sincronizza il catalogo prenotabile
// (attività con prezzo web e tipologia -> prestazioni; aree -> sedi, per nome; risorse e assicurazioni -> conteggio e settings.tuotempo).
// Le prenotazioni (reservations) e i pazienti (users) non sono autorizzati: le vendite B2C entrano dall'export GIPO.
export async function syncConnector(kind, userId, { from, to } = {}) {
  const c = await getConnector(kind);
  const log = await one('INSERT INTO sync_log(connector_id) VALUES ($1) RETURNING id', [c.id]);
  const finish = async (status, message, read = 0, written = 0) => {
    await q('UPDATE sync_log SET finished_at=now(), status=$2, message=$3, rows_read=$4, rows_written=$5 WHERE id=$1', [log.id, status, message, read, written]);
    await q('UPDATE connectors SET last_sync_at=now(), last_status=$2, last_message=$3, updated_at=now() WHERE id=$1', [c.id, status, message]);
  };
  try {
    if (kind !== 'TUOTEMPO') {
      await finish('ERRORE', `${kind}: sincronizzazione automatica non disponibile senza API del fornitore. Usa l'import da file.`);
      throw new HttpError(400, `${kind}: sincronizzazione automatica non disponibile senza API del fornitore. Usa l'import da file.`);
    }
    const [activities, areas, resources, insurances] = await Promise.all([ttList(c, 'activities'), ttList(c, 'areas'), ttList(c, 'resources'), ttList(c, 'insurances')]);
    // Attività -> catalogo prestazioni (codice = legacyid se presente, altrimenti activityid). Riusa l'importatore PRODUCTS.
    const rows = activities.filter((a) => a.activityTitle).map((a) => ({
      codice: (a.legacyid && String(a.legacyid).trim()) || `TT-${a.activityid}`, descrizione: a.activityTitle, specialita: a.typologyTitle || '', prezzo: a.price != null && a.price !== '' ? String(a.price).replace('.', ',') : '', durata: a.duration || '', tuotempo_id: a.activityid, nascosta: a.isHidden === '1' ? 'SI' : 'NO',
    }));
    let imp = { rows_total: 0, rows_ok: 0, rows_skipped: 0 };
    if (rows.length) {
      const header = Object.keys(rows[0]);
      const csv = [header.join(';'), ...rows.map((r) => header.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(';'))].join('\n');
      imp = await runImport({ source: 'TUOTEMPO', dataset: 'PRODUCTS', buffer: Buffer.from(csv, 'utf8'), filename: `tuotempo_catalogo_${new Date().toISOString().slice(0, 10)}.csv`, mapping: { code: 'codice', description: 'descrizione', specialty: 'specialita', price: 'prezzo', duration_min: 'durata' }, userId });
    }
    // Aree -> sedi: abbina per nome o città e salva l'areaid nelle impostazioni della sede (per i filtri futuri)
    const sites = await many('SELECT id, code, name, city FROM sites_v WHERE active AND in_network');
    const normS = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    let matched = 0; const unmatched = [];
    for (const a of areas) {
      const t = normS(a.areaTitle || a.webTitle); const city = normS(a.city);
      const site = sites.find((x) => normS(x.name) === t) || sites.find((x) => t && normS(x.name).includes(t)) || sites.find((x) => city && normS(x.city) === city && sites.filter((y) => normS(y.city) === city).length === 1) || null;
      if (site) { matched++; await q(`INSERT INTO site_ext (site_id, tuotempo_area_id) VALUES ($1,$2) ON CONFLICT (site_id) DO UPDATE SET tuotempo_area_id=EXCLUDED.tuotempo_area_id, updated_at=now()`, [site.id, a.areaid]).catch(() => {}); } else unmatched.push(a.areaTitle);
    }
    const summary = { synced_at: new Date().toISOString(), activities: activities.length, areas: areas.length, areas_matched: matched, areas_unmatched: unmatched.slice(0, 20), resources: resources.length, resources_active: resources.filter((r) => r.status === 'a' && r.isHidden !== '1').length, machines: resources.filter((r) => r.is_machine === '1').length, insurances: insurances.length, insurance_titles: insurances.map((i) => i.insurance_title).slice(0, 50) };
    await q(`UPDATE connectors SET settings = settings || jsonb_build_object('tuotempo', $2::jsonb) WHERE id=$1`, [c.id, JSON.stringify(summary)]);
    const msg = `Catalogo TuoTempo: ${activities.length} attività (${imp.rows_ok} prestazioni aggiornate), ${areas.length} aree (${matched} abbinate a sedi${unmatched.length ? `, non abbinate: ${unmatched.slice(0, 5).join(', ')}` : ''}), ${resources.length} risorse, ${insurances.length} assicurazioni/convenzioni`;
    await finish('OK', msg, activities.length + areas.length + resources.length + insurances.length, imp.rows_ok);
    return { ...imp, ...summary, message: msg };
  } catch (e) {
    if (!(e instanceof HttpError && e.status === 400)) await finish('ERRORE', e.message);
    throw e;
  }
}

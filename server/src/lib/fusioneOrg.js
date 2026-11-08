// Fusione di Legal entity duplicate (correzione B5b del programma "anagrafica unica", decisione 9 del CEO dell'08/11/2026: strumento in
// Amministrazione > Legal entity con la scelta della riga che resta). Una sola funzione per anteprima ed esecuzione: la fusione gira in
// una transazione che, in prova, si annulla alla fine (l'anteprima è esattamente ciò che succederebbe).
//   1. Tutti i riferimenti alla riga assorbita in ogni schema (chiavi esterne verso public.organizations) passano alla riga che resta.
//      Le tabelle di estensione dei moduli (<schema>.org_ext e simili, una riga per Legal entity) si fondono campo per campo: restano i
//      valori della riga che resta, quelli vuoti si completano con la riga assorbita; i JSON si uniscono (vince la riga che resta).
//      Una riga che violerebbe un vincolo di unicità (es. due account del Business Hub sulla stessa linea) è un CONFLITTO: la fusione non
//      si esegue finché non lo si risolve nella scheda indicata.
//   2. Riferimenti senza chiave esterna noti: perimetri degli accessi (grant_scopes ORG), Legal entity di TD dei Dati aziendali.
//   3. I campi vuoti della riga che resta (P.IVA, CF, indirizzo, PEC, IBAN, ...) si completano con quelli della riga assorbita; le note e
//      i riferimenti legacy si uniscono; il tipo resta quello della riga che resta.
//   4. La riga assorbita si elimina; audit ORG_MERGED con il rapporto, registro org_merges con la riga assorbita intera (nulla si perde);
//      indice di ricerca e perimetri degli accessi esterni ricalcolati.
import { pool, one } from '../db.js';
import { audit, bad } from './util.js';

const CAMPI_CORE = ['code', 'vat_number', 'tax_code', 'sdi', 'pec', 'email', 'phone', 'address', 'zip', 'city', 'province', 'website', 'iban', 'bic', 'bank_name'];
const NON_FONDERE = new Set(['created_at', 'updated_at', 'created_by', 'updated_by']);
const qi = (s) => `"${String(s).replace(/"/g, '""')}"`;

/** Riferimenti a public.organizations(id) in tutti gli schemi: [{ schema, table, column, unica }] (unica = la colonna da sola è unica). */
async function riferimenti(c) {
  const r = await c.query(`
    SELECT n.nspname AS schema, t.relname AS table, a.attname AS column,
           EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = t.oid AND i.indisunique AND i.indnatts = 1 AND i.indkey[0] = a.attnum) AS unica
      FROM pg_constraint k
      JOIN pg_class t ON t.oid = k.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
     WHERE k.contype = 'f' AND k.confrelid = 'public.organizations'::regclass AND array_length(k.conkey, 1) = 1
     ORDER BY 1, 2, 3`);
  return r.rows;
}

async function colonne(c, schema, table) {
  return (await c.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`, [schema, table])).rows;
}

/** Campi della riga che resta dopo la fusione (funzione pura, provata nei test): vince il valore presente nella riga che resta. */
export function campiFusi(tieni, assorbi) {
  const vuoto = (v) => v == null || (typeof v === 'string' && v.trim() === '');
  const set = {}; const presi = [];
  for (const k of CAMPI_CORE) if (vuoto(tieni[k]) && !vuoto(assorbi[k])) { set[k] = assorbi[k]; presi.push(k); }
  const note = [tieni.notes, assorbi.notes && !String(tieni.notes || '').includes(assorbi.notes) ? `Dalla Legal entity unita #${assorbi.id} ${assorbi.name}: ${assorbi.notes}` : null].filter(Boolean).join('\n');
  if (note !== (tieni.notes || '')) set.notes = note;
  const refs = { ...(assorbi.legacy_refs || {}), ...(tieni.legacy_refs || {}) };
  if (JSON.stringify(refs) !== JSON.stringify(tieni.legacy_refs || {})) set.legacy_refs = refs;
  if (!tieni.active && assorbi.active) { set.active = true; presi.push('active'); }
  return { set, presi };
}

/**
 * Fusione della Legal entity `assorbiId` in `tieniId`. prova = true: tutto in una transazione annullata alla fine (anteprima).
 * Ritorna { tieni, assorbi, riferimenti: [{ tabella, righe, azione }], conflitti: [{ tabella, motivo }], campi: [...], eseguita }.
 */
export async function fondiLegalEntity(tieniId, assorbiId, { prova = true, req = null, actorId = null } = {}) {
  tieniId = Number(tieniId); assorbiId = Number(assorbiId);
  if (!tieniId || !assorbiId || tieniId === assorbiId) throw bad('Indica due Legal entity diverse: quella che resta e quella da unire');
  const c = await pool.connect();
  const rep = { tieni: null, assorbi: null, riferimenti: [], conflitti: [], campi: [], avvisi: [], eseguita: false };
  try {
    await c.query('BEGIN');
    const rows = (await c.query('SELECT * FROM organizations WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [[tieniId, assorbiId]])).rows;
    const tieni = rows.find((x) => x.id === tieniId); const assorbi = rows.find((x) => x.id === assorbiId);
    if (!tieni || !assorbi) throw bad('Legal entity non trovata');
    rep.tieni = { id: tieni.id, name: tieni.name, kind: tieni.kind, vat_number: tieni.vat_number };
    rep.assorbi = { id: assorbi.id, name: assorbi.name, kind: assorbi.kind, vat_number: assorbi.vat_number };
    if (tieni.kind !== assorbi.kind) rep.avvisi.push(`Tipi diversi: resta ${tieni.kind} (la riga unita era ${assorbi.kind})`);
    if (tieni.vat_number && assorbi.vat_number && tieni.vat_number.replace(/\W/g, '').toUpperCase() !== assorbi.vat_number.replace(/\W/g, '').toUpperCase()) rep.avvisi.push(`Partite IVA diverse (${tieni.vat_number} / ${assorbi.vat_number}): verifica che sia davvero lo stesso soggetto`);

    for (const ref of await riferimenti(c)) {
      const tab = `${ref.schema}.${ref.table}`;
      const T = `${qi(ref.schema)}.${qi(ref.table)}`; const C = qi(ref.column);
      const n = (await c.query(`SELECT count(*)::int AS n FROM ${T} WHERE ${C}=$1`, [assorbiId])).rows[0].n;
      if (!n) continue;
      if (ref.unica) {
        // tabella di estensione (una riga per Legal entity): si fonde campo per campo nella riga che resta, se c'è
        const haTieni = (await c.query(`SELECT count(*)::int AS n FROM ${T} WHERE ${C}=$1`, [tieniId])).rows[0].n > 0;
        if (!haTieni) { await c.query(`UPDATE ${T} SET ${C}=$1 WHERE ${C}=$2`, [tieniId, assorbiId]); rep.riferimenti.push({ tabella: tab, colonna: ref.column, righe: n, azione: 'spostata' }); continue; }
        const cols = (await colonne(c, ref.schema, ref.table)).filter((x) => x.column_name !== ref.column && !NON_FONDERE.has(x.column_name));
        const sets = cols.map((x) => {
          const k = qi(x.column_name);
          if (x.data_type === 'jsonb') return `${k} = CASE WHEN jsonb_typeof(a.${k})='object' AND jsonb_typeof(t.${k})='object' THEN a.${k} || t.${k} ELSE coalesce(t.${k}, a.${k}) END`;
          if (['text', 'character varying'].includes(x.data_type)) return `${k} = coalesce(nullif(t.${k}, ''), a.${k})`;
          return `${k} = coalesce(t.${k}, a.${k})`;
        });
        if (sets.length) await c.query(`UPDATE ${T} t SET ${sets.join(', ')} FROM ${T} a WHERE t.${C}=$1 AND a.${C}=$2`, [tieniId, assorbiId]);
        await c.query(`DELETE FROM ${T} WHERE ${C}=$1`, [assorbiId]);
        rep.riferimenti.push({ tabella: tab, colonna: ref.column, righe: n, azione: 'fusa campo per campo' });
        continue;
      }
      await c.query('SAVEPOINT r');
      try {
        await c.query(`UPDATE ${T} SET ${C}=$1 WHERE ${C}=$2`, [tieniId, assorbiId]);
        await c.query('RELEASE SAVEPOINT r');
        rep.riferimenti.push({ tabella: tab, colonna: ref.column, righe: n, azione: 'spostate' });
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT r');
        rep.conflitti.push({ tabella: tab, colonna: ref.column, righe: n, motivo: e.code === '23505' ? `vincolo di unicità (${e.constraint || 'unico'}): la riga che resta ha già un elemento equivalente (es. un account sulla stessa linea): risolvi prima nella scheda del modulo` : e.message });
      }
    }
    // riferimenti senza chiave esterna
    const gs = await c.query(`UPDATE grant_scopes g SET scope_id=$1 WHERE g.scope_type='ORG' AND g.scope_id=$2
        AND NOT EXISTS (SELECT 1 FROM grant_scopes x WHERE x.grant_id=g.grant_id AND x.scope_type='ORG' AND x.scope_id=$1)`, [tieniId, assorbiId]);
    const gsd = await c.query(`DELETE FROM grant_scopes WHERE scope_type='ORG' AND scope_id=$1`, [assorbiId]);
    if (gs.rowCount || gsd.rowCount) rep.riferimenti.push({ tabella: 'public.grant_scopes', colonna: 'scope_id (ORG)', righe: gs.rowCount + gsd.rowCount, azione: 'spostati (doppioni tolti)' });
    const td = await c.query(`UPDATE app_settings SET value=to_jsonb($1::int), updated_at=now() WHERE key='company_org_id' AND value = to_jsonb($2::int)`, [tieniId, assorbiId]);
    if (td.rowCount) rep.riferimenti.push({ tabella: 'public.app_settings', colonna: 'company_org_id', righe: 1, azione: 'Legal entity di TD = riga che resta' });

    // campi del core
    const { set, presi } = campiFusi(tieni, assorbi);
    rep.campi = presi;
    if (rep.conflitti.length) { await c.query('ROLLBACK'); return rep; }
    // prima si elimina la riga assorbita (codice e altri vincoli di unicità), poi si completano i campi della riga che resta
    await c.query('DELETE FROM organizations WHERE id=$1', [assorbiId]);
    const ks = Object.keys(set);
    if (ks.length) await c.query(`UPDATE organizations SET ${ks.map((k, i) => `${qi(k)}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [tieniId, ...ks.map((k) => (k === 'legacy_refs' ? JSON.stringify(set[k]) : set[k]))]);
    if (prova) { await c.query('ROLLBACK'); return rep; }
    const by = req ? (req.suiteUser || req.user)?.id || null : actorId || null;
    await c.query('INSERT INTO org_merges (by_user, kept_id, merged_id, merged_row, report) VALUES ($1,$2,$3,$4,$5)', [by, tieniId, assorbiId, JSON.stringify(assorbi), JSON.stringify(rep)]);
    await c.query('COMMIT');
    rep.eseguita = true;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }

  // dopo il COMMIT: audit, indice di ricerca, perimetri degli accessi esterni
  const attore = req ? { user: req.suiteUser || req.user, ip: req.ip } : { user: actorId ? { id: actorId } : null, ip: null };
  await audit(attore, 'ORG_MERGED', { entity: 'organization', entityId: tieniId, label: `${rep.assorbi.name} (#${assorbiId}) unita in ${rep.tieni.name} (#${tieniId})`, data: rep });
  const { indexOrg, removeFromIndex } = await import('./search.js');
  await removeFromIndex('org', assorbiId).catch(() => {});
  indexOrg(await one('SELECT * FROM organizations WHERE id=$1', [tieniId])).catch(() => {});
  const { realignOrgPerimeters } = await import('./esterni.js');
  rep.perimetri = await realignOrgPerimeters(tieniId, { actorId: (req ? (req.suiteUser || req.user)?.id : actorId) || null }).then((x) => ({ utenti: x.users, cambiati: x.changed })).catch((e) => ({ errore: e.message }));
  return rep;
}

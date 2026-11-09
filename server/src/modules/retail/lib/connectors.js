// Connettori verso i gestionali: sincronizzazioni del modulo (TuoTempo, import da file). Base URL, credenziali e
// impostazioni di accesso (istanza, lingua) vengono dal connettore unico della Suite (Amministrazione > Connettori,
// lib/connectors.js del core): la riga retail.connectors conserva solo pianificazione, esito e riepilogo dell'ultima
// sincronizzazione. GIPO e StudioLab non espongono API pubbliche documentate: i dati entrano con l'import da file (lib/importer.js).
import { one, many, q } from '../db.js';
import { decrypt } from './crypto.js';
import { HttpError } from './util.js';
import { getConnector as getCoreConnector, testConnector as testCoreConnector, publicConnector } from '../../../lib/connectors.js';
import { encrypt as coreEncrypt } from '../../../lib/secrets.js';

export async function getConnector(kind) {
  const c = await one('SELECT * FROM connectors WHERE kind=$1', [kind]);
  if (!c) throw new HttpError(404, 'Connettore inesistente');
  return c;
}
// Stato del connettore core per l'interfaccia del modulo (mai credenziali in chiaro)
export const coreStatus = (kind) => publicConnector(kind);

// Credenziali salvate nell'app di origine (retail.connectors, cifrate con la chiave del modulo): se il connettore core è ancora
// vuoto si copiano lì una volta, ricifrate con lib/secrets della Suite; poi la configurazione si fa solo in Amministrazione.
export async function migrateCredentialsToCore() {
  const rows = await many('SELECT * FROM connectors WHERE core_migrated_at IS NULL');
  for (const c of rows) {
    try {
      let creds = {}; try { creds = c.credentials ? JSON.parse(decrypt(c.credentials)) : {}; } catch { creds = {}; }
      const core = await getCoreConnector(c.kind);
      const sets = []; const vals = [c.kind];
      const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
      if (!core.configured && Object.values(creds).some(Boolean)) {
        const mapped = { ...creds };
        if (mapped.token && !mapped.api_key) { mapped.api_key = mapped.token; delete mapped.token; }
        add('credentials', coreEncrypt(JSON.stringify(mapped)));
        if (c.base_url) add('base_url', c.base_url);
        if (c.auth_kind && ['API_KEY', 'BASIC', 'OAUTH2'].includes(c.auth_kind)) add('auth_kind', c.auth_kind);
        const st = { ...(c.settings || {}) }; delete st.tuotempo; delete st.sync_days; delete st.note;
        if (Object.keys(st).length) add('settings', JSON.stringify({ ...core.settings, ...st }));
        await q(`UPDATE public.connectors SET ${sets.join(', ')}, updated_at=now() WHERE kind=$1`, vals);
        console.log(`[retail] credenziali ${c.kind} copiate nel connettore della Suite`);
      }
      await q('UPDATE connectors SET core_migrated_at=now() WHERE id=$1', [c.id]);
    } catch (e) { console.error(`[retail] migrazione credenziali ${c.kind}:`, e.message); }
  }
}

// Prova di connessione: la fa il connettore della Suite (una chiamata leggera per sistema); qui si registra l'esito sulla riga del modulo
export async function testConnector(kind) {
  await getConnector(kind);
  const out = await testCoreConnector(kind);
  if (!out.ok) throw new HttpError(502, out.message);
  return out;
}

// Sincronizzazione TuoTempo = allineamento delle Key Entities (Fase 1 del piano, lib/tuotempo.js): aree con le proposte di abbinamento alle
// sedi (mai scritte da sole: si confermano in Retail > Connettori o in Amministrazione > Sedi), attività con la prima disponibilità giornaliera,
// risorse con le proposte di abbinamento alle persone, assicurazioni. Prenotazioni (reservations) e pazienti (users) non sono autorizzati:
// le vendite B2C entrano dall'export GIPO.
export async function syncConnector(kind, userId, { actorId = null } = {}) {
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
    const { allineaTuotempo } = await import('./tuotempo.js');
    const out = await allineaTuotempo({ userId, actorId });
    const { message, rows_read: read, rows_ok: ok, ...summary } = out;
    await q(`UPDATE connectors SET settings = settings || jsonb_build_object('tuotempo', $2::jsonb) WHERE id=$1`, [c.id, JSON.stringify(summary)]);
    await finish('OK', message, read, ok);
    return { ...out, rows_ok: ok };
  } catch (e) {
    if (!(e instanceof HttpError && e.status === 400 && kind !== 'TUOTEMPO')) await finish('ERRORE', e.message).catch(() => {});
    throw e;
  }
}

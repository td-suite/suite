import { PERSONAL_EXT, DEPARTMENT_EXT, SWITCHBOARD, IVR } from './seed/centralino.js';
import { applyCentralino } from './lib/centralino.js';
import { seedGrantRules } from './lib/grantRules.js';
import { displayName, splitName } from './lib/util.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { pool, one, q } from './db.js';
import { config, LEGACY_KEYS } from './config.js';
import { MODULES } from './seed/modules.js';
import { QUOTES } from './seed/quotes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, 'migrations');

export async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())`);
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const c = await pool.connect();
    try {
      await c.query('BEGIN'); await c.query(sql);
      await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      await c.query('COMMIT');
      console.log(`[migrate] applicata ${f}`);
    } catch (e) { await c.query('ROLLBACK'); throw new Error(`Migrazione ${f} fallita: ${e.message}`); }
    finally { c.release(); }
  }
  await seed();
}

async function seed() {
  // Catalogo moduli: inserisce i nuovi e aggiorna nome, descrizione, profili e URL di quelli esistenti (non tocca sso_secret e active)
  for (const m of MODULES) {
    await q(`INSERT INTO modules (key, area, name, tagline, description, icon, kind, legacy_url, route, restricted, profiles, scope_type, sort_order, open_to_all)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
             ON CONFLICT (key) DO UPDATE SET area=EXCLUDED.area, name=EXCLUDED.name, tagline=EXCLUDED.tagline, icon=EXCLUDED.icon, kind=EXCLUDED.kind,
               legacy_url=coalesce(modules.legacy_url, EXCLUDED.legacy_url), route=EXCLUDED.route, restricted=EXCLUDED.restricted, profiles=EXCLUDED.profiles,
               scope_type=EXCLUDED.scope_type, sort_order=EXCLUDED.sort_order, open_to_all=EXCLUDED.open_to_all, updated_at=now()`,
      [m.key, m.area, m.name, m.tagline || null, m.description || null, m.icon, m.kind, m.legacy_url || null, m.route || null, Boolean(m.restricted),
        JSON.stringify(m.profiles || []), m.scope_type || null, m.sort_order || 100, Boolean(m.open_to_all)]);
  }

  // Nessuna sede o legal entity di esempio: l'anagrafica la carica Francesco dai modelli (sedi LAB e HQ già codificate da lui).

  // Owner
  if (config.seed.ownerEmail) {
    const ex = await one('SELECT id, level, status FROM users WHERE lower(email)=$1', [config.seed.ownerEmail]);
    if (!ex) {
      const pwd = config.seed.ownerPassword.length >= 12 ? await bcrypt.hash(config.seed.ownerPassword, 12) : null;
      const u = await one(
        `INSERT INTO users (email, full_name, first_name, last_name, title, level, status, auth_provider, organization_id, password_hash, must_change_password)
         VALUES ($1,$2,$7,$8,'Dott.','OWNER','ACTIVE',$3,$4,$5,$6) RETURNING id`,
        [config.seed.ownerEmail, displayName(splitName(config.seed.ownerName).last_name, splitName(config.seed.ownerName).first_name), pwd ? 'BOTH' : 'ENTRA', null, pwd, Boolean(pwd), splitName(config.seed.ownerName).first_name, splitName(config.seed.ownerName).last_name]);
      for (const m of MODULES) {
        const profile = (m.profiles.find((p) => ['OWNER', 'SUPERADMIN', 'ADMIN', 'CEO', 'DIREZIONE', 'PUBLISHER', 'EDITOR'].includes(p.key)) || m.profiles[0]).key;
        await q(`INSERT INTO grants (user_id, module_key, profile, source) VALUES ($1,$2,$3,'SEED') ON CONFLICT DO NOTHING`, [u.id, m.key, profile]);
      }
      console.log(`[seed] creato il titolare ${config.seed.ownerEmail}`);
    } else if (ex.level !== 'OWNER' || ex.status !== 'ACTIVE') {
      await q(`UPDATE users SET level='OWNER', status='ACTIVE' WHERE id=$1`, [ex.id]);
    }
  }

  // Sorgenti legacy: una riga per app, abilitata se la URL è configurata
  const labels = { cash: 'Cash Management', orders: 'Orders Management', shipments: 'Shipments', room: 'Room Planning', nc: 'Non conformità', retail: 'Retail Assistant', business: 'Business', finance: 'Finance', integration: 'Integration', contracts: 'Contracts (People)', circolari: 'Circolari (nativo, senza sorgente)', ticket: 'Ticket (nativo, senza sorgente)', cartella: 'Cartella condivisa (nativo, senza sorgente)' };
  for (const k of LEGACY_KEYS) {
    await q(`INSERT INTO legacy_sources (key, label, enabled) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET enabled=EXCLUDED.enabled`, [k, labels[k], Boolean(config.legacy[k])]);
  }

  // Frasi del giorno: 365 giorni programmati da oggi con citazioni classiche, a rotazione di tema; le restanti restano approvate come riserva
  const seeded = await one(`SELECT 1 FROM app_settings WHERE key='community.quotes_seeded'`);
  if (!seeded) {
    const byTheme = new Map();
    for (const x of QUOTES) { if (!byTheme.has(x.theme)) byTheme.set(x.theme, []); byTheme.get(x.theme).push(x); }
    const themes = [...byTheme.keys()];
    const ordered = [];
    for (let i = 0; ordered.length < QUOTES.length; i++) { const list = byTheme.get(themes[i % themes.length]); if (list.length) ordered.push(list.shift()); }
    const taken = new Set((await q('SELECT for_date FROM quotes WHERE for_date IS NOT NULL')).rows.map((r) => String(r.for_date)));
    const start = new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }));
    let day = 0, scheduled = 0;
    for (const x of ordered) {
      let forDate = null;
      if (scheduled < 365) {
        let d;
        do { d = new Date(start); d.setUTCDate(start.getUTCDate() + day); day++; } while (taken.has(d.toISOString().slice(0, 10)));
        forDate = d.toISOString().slice(0, 10); scheduled++;
      }
      await q(`INSERT INTO quotes (text, author_label, theme, status, for_date) VALUES ($1,$2,$3,'APPROVED',$4)`, [x.text, x.author, x.theme, forDate]);
    }
    await q(`INSERT INTO app_settings (key, value) VALUES ('community.quotes_seeded', $1)`, [JSON.stringify({ at: new Date().toISOString(), n: QUOTES.length, scheduled })]);
    console.log(`[seed] frasi del giorno: ${QUOTES.length} caricate, ${scheduled} programmate`);
  }

  // Impostazioni predefinite
  const defaults = {
    'community.values': ['Ci prendiamo cura del tempo dei pazienti, lì dove ogni minuto conta', 'Rigore e qualità in ogni passaggio', 'Rete: insieme siamo più forti di dodici strutture separate', 'Innovazione concreta, al servizio delle persone', 'Rispetto, ascolto e responsabilità'],
    'community.weather_default': { city: 'Sesto Fiorentino', lat: 43.8325, lng: 11.2010 },
    'search.ai_enabled': true,
    'sso.bar': { showHome: true },
  };
  for (const [k, v] of Object.entries(defaults)) await q(`INSERT INTO app_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING`, [k, JSON.stringify(v)]);
  await seedCentralino();
  await seedGrantRules().then((n) => { if (n) console.log(`[seed] regole di accesso: ${n}`); }).catch((e) => console.warn('[seed] regole', e.message));
}

if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  migrate().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}

// Centralino: interni personali sulle schede persona (per cognome e nome, solo se vuoti) e numeri di reparto in settings
export async function seedCentralino() {
  await applyCentralino().catch((e) => console.warn('[centralino]', e.message));
  for (const [last, first, ext] of PERSONAL_EXT) {
    await q(`UPDATE people SET phone_ext=$3, updated_at=now() WHERE phone_ext IS NULL AND lower(unaccent(last_name))=lower(unaccent($1)) AND lower(unaccent(first_name))=lower(unaccent($2))`, [last, first, ext]).catch(() => {});
  }
  await q(`INSERT INTO app_settings (key, value) VALUES ('community.switchboard', $1::jsonb) ON CONFLICT (key) DO NOTHING`, [JSON.stringify({ ...SWITCHBOARD, departments: DEPARTMENT_EXT, ivr: IVR })]).catch(() => {});
}

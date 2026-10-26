// Registro dei moduli travasati. Ogni cartella server/src/modules/<key>/ espone index.js con `export default function mount(app)`
// (monta il router sotto /api/<key>) e la cartella migrations/ con gli SQL dell'app di origine.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Canali macchina dei moduli (LIS, HL7, fornitori con chiave API): montati PRIMA di sessione e CSRF, come /api/ingest.
// Un modulo li espone con `export function mountPublic(app)`.
export async function mountModulesPublic(app) {
  for (const key of fs.readdirSync(here, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const entry = path.join(here, key, 'index.js');
    if (!fs.existsSync(entry)) continue;
    try {
      const m = await import(`./${key}/index.js`);
      if (typeof m.mountPublic === 'function') { await m.mountPublic(app); console.log(`[moduli] canali macchina di ${key} montati prima della sessione`); }
    } catch (e) { console.error(`[moduli] ${key} (public): ${e.message}`); }
  }
}

export async function mountModules(app) {
  for (const key of fs.readdirSync(here, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const entry = path.join(here, key, 'index.js');
    if (!fs.existsSync(entry)) continue;
    try {
      const m = await import(`./${key}/index.js`);
      if (typeof m.default === 'function') { await m.default(app); console.log(`[moduli] montato ${key} su /api/${key}`); }
    } catch (e) { console.error(`[moduli] ${key}: ${e.message}`); }
  }
}

// Passi dei moduli da eseguire dopo migrazioni, segreti e connettori (es. copia una tantum di credenziali nel core):
// un modulo li espone con `export async function afterStart()`
export async function runModulesAfterStart() {
  for (const key of fs.readdirSync(here, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
    const entry = path.join(here, key, 'index.js');
    if (!fs.existsSync(entry)) continue;
    try {
      const m = await import(`./${key}/index.js`);
      if (typeof m.afterStart === 'function') await m.afterStart();
    } catch (e) { console.error(`[moduli] ${key} (afterStart): ${e.message}`); }
  }
}

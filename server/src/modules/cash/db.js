// Accesso al database del modulo Cash Management: schema PostgreSQL "cash" della Suite (search_path = cash, public).
// Sostituisce il db.js dell'app di origine: stesse funzioni q / one / many / tx, stesso comportamento.
// I parser di tipo (NUMERIC -> number, DATE -> 'YYYY-MM-DD') sono quelli già impostati dal db.js della Suite.
import { moduleDb } from '../../lib/modules.js';

const db = moduleDb('cash');
export const pool = db.pool;
export const q = db.q;
export const one = db.one;
export const many = db.many;
export const tx = db.tx;

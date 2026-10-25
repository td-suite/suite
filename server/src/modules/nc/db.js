// Accesso al database del modulo Non conformità: schema PostgreSQL "nc" della Suite (search_path = nc, public).
// Sostituisce il db.js dell'app di origine con la stessa interfaccia (q, one, many, tx, pool).
import { moduleDb } from '../../lib/modules.js';

const db = moduleDb('nc');
export const { pool, q, one, many, tx } = db;
export default db;

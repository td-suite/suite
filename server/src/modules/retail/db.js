// Accesso al database del modulo Retail Assistant: schema PostgreSQL "retail" della Suite (search_path = retail, public).
// Sostituisce il db.js dell'app di origine con la stessa interfaccia (q, one, many, tx, pool).
// I tipi NUMERIC e DATE sono già convertiti dal db.js della Suite (number e stringa ISO), come faceva l'app.
import { moduleDb } from '../../lib/modules.js';

const db = moduleDb('retail');
export const { pool, q, one, many, tx } = db;
export default db;

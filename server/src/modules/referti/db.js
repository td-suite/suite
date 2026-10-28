// Accesso al database del modulo Referti esterni: schema PostgreSQL "referti" della Suite (search_path = referti, public).
import { moduleDb } from '../../lib/modules.js';

const db = moduleDb('referti');
export const { pool, q, one, many, tx } = db;
export default db;

// Accesso al database del modulo Portale SGI: schema PostgreSQL "sgi" della Suite (search_path = sgi, public).
import { moduleDb } from '../../lib/modules.js';

const db = moduleDb('sgi');
export const { pool, q, one, many, tx } = db;
export default db;

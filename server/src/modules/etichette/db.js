// Accesso al database del modulo Label (etichette provette): schema PostgreSQL "etichette" della Suite (search_path = etichette, public).
import { moduleDb } from '../../lib/modules.js';

const db = moduleDb('etichette');
export const { pool, q, one, many, tx } = db;
export default db;

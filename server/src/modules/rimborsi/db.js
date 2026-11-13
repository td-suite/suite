// Accesso al database del modulo Rimborso Spese: schema PostgreSQL "rimborsi" della Suite (search_path = rimborsi, public).
import { moduleDb } from '../../lib/modules.js';

const db = moduleDb('rimborsi');
export const { pool, q, one, many, tx } = db;
export default db;

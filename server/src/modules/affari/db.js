// Accesso al database del modulo Public Affairs: schema PostgreSQL "affari" della Suite (search_path = affari, public).
import { moduleDb } from '../../lib/modules.js';

const db = moduleDb('affari');
export const { pool, q, one, many, tx } = db;
export default db;

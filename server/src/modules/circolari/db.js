// Accesso al database del modulo Circolari: schema PostgreSQL "circolari" della Suite (search_path = circolari, public).
import { moduleDb } from '../../lib/modules.js';

const db = moduleDb('circolari');
export const { pool, q, one, many, tx } = db;
export default db;

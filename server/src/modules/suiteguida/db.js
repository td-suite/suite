// Accesso al database del modulo Guida alla Suite: schema PostgreSQL "suiteguida" della Suite (search_path = suiteguida, public).
import { moduleDb } from '../../lib/modules.js';

const db = moduleDb('suiteguida');
export const { pool, q, one, many, tx } = db;
export default db;

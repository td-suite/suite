// Accesso al database del modulo Recupero Crediti: schema PostgreSQL "crediti" della Suite (search_path = crediti, public).
import { moduleDb } from '../../lib/modules.js';

const db = moduleDb('crediti');
export const { pool, q, one, many, tx } = db;
export default db;

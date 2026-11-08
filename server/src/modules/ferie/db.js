// Accesso al database del modulo Piano Ferie: schema PostgreSQL "ferie" della Suite (search_path = ferie, public).
import { moduleDb } from '../../lib/modules.js';

const db = moduleDb('ferie');
export const { pool, q, one, many, tx } = db;
export default db;

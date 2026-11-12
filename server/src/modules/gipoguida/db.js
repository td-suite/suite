// Accesso al database del modulo Guida GIPO: schema PostgreSQL "gipoguida" della Suite (search_path = gipoguida, public).
import { moduleDb } from '../../lib/modules.js';

const db = moduleDb('gipoguida');
export const { pool, q, one, many, tx } = db;
export default db;

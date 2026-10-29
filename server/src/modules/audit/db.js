// Accesso al database del modulo Audit SGI: schema PostgreSQL "audit" della Suite (search_path = audit, public).
import { moduleDb } from '../../lib/modules.js';

const db = moduleDb('audit');
export const { pool, q, one, many, tx } = db;
export default db;

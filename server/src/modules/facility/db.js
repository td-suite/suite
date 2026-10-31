// Accesso al database del modulo Facility e Manutenzioni: schema PostgreSQL "facility" della Suite (search_path = facility, public).
// Payments (schema finance) e Room Planning (schema room) si leggono e scrivono con il nome dello schema esplicito.
import { moduleDb } from '../../lib/modules.js';

const db = moduleDb('facility');
export const { pool, q, one, many, tx } = db;
export default db;

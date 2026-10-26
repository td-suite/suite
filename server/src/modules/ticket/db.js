// Accesso al database del modulo Ticket: schema PostgreSQL "ticket" della Suite (search_path = ticket, public).
import { moduleDb } from '../../lib/modules.js';

const db = moduleDb('ticket');
export const { pool, q, one, many, tx } = db;
export default db;

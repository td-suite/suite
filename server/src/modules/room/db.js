// Accesso al database del modulo Room Planning: schema PostgreSQL "room" della Suite (search_path = room, public).
// Sostituisce il db.js dell'app di origine con la stessa interfaccia (q, one, many, tx, pool).
import { moduleDb } from '../../lib/modules.js';

const db = moduleDb('room');
export const { pool, q, one, many, tx } = db;
export default db;

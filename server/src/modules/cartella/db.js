// Accesso al database del modulo Cartella condivisa: schema PostgreSQL "cartella" della Suite (search_path = cartella, public).
import { moduleDb } from '../../lib/modules.js';

const db = moduleDb('cartella');
export const { pool, q, one, many, tx } = db;
export default db;

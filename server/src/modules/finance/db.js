// Accesso al database del modulo Finance: schema PostgreSQL "finance" della Suite (search_path = finance, public).
// Sostituisce il db.js dell'app di origine: stesse funzioni (q, one, many, tx, pool), nessuna modifica alle query.
import { moduleDb } from '../../lib/modules.js';

export const { q, one, many, tx, pool } = moduleDb('finance');

// Accesso al database del modulo: schema PostgreSQL "integration" della Suite (search_path = integration, public).
// Sostituisce il db.js dell'app di origine: stesse funzioni q/one/many/tx, stesso codice SQL.
import { moduleDb } from '../../lib/modules.js';

export const { q, one, many, tx, pool } = moduleDb('integration');

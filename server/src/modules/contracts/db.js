// Accesso al database: pool della Suite con search_path = contracts, public (sostituisce il db.js dell'app di origine).
// Le tabelle dell'app (users, resources, employments, attachments, ...) risolvono nello schema "contracts" del database della Suite.
// Le conversioni NUMERIC -> number e DATE -> 'YYYY-MM-DD' dell'app sono già quelle del driver pg della Suite (server/src/db.js).
import { moduleDb } from '../../lib/modules.js';

export const { q, one, many, tx, pool } = moduleDb('contracts');

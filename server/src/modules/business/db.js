// Accesso al database: pool della Suite con search_path = business, public (sostituisce il db.js dell'app di origine).
// Le tabelle dell'app (users, partners, contracts, ...) risolvono nello schema "business" del database della Suite.
import { moduleDb } from '../../lib/modules.js';

export const { q, one, many, tx, pool } = moduleDb('business');

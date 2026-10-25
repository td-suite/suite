// Accesso al database del modulo Shipments: schema PostgreSQL "shipments" della Suite (search_path = shipments, public).
// Sostituisce il db.js dell'app di origine: stesse funzioni q / one / many / tx, stesso comportamento.
import { moduleDb } from '../../lib/modules.js';

const db = moduleDb('shipments');
export const pool = db.pool;
export const q = db.q;
export const one = db.one;
export const many = db.many;
export const tx = db.tx;

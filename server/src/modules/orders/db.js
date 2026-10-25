// Accesso al database del modulo Orders: schema PostgreSQL "orders" della Suite (search_path = orders, public).
// Sostituisce il db.js dell'app di origine: stesse funzioni q / one / many / tx, stesso comportamento
// (i parser NUMERIC → number e DATE → stringa ISO sono già impostati dal db.js della Suite).
import { moduleDb } from '../../lib/modules.js';

const db = moduleDb('orders');
export const pool = db.pool;
export const q = db.q;
export const one = db.one;
export const many = db.many;
export const tx = db.tx;

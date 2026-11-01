// Accesso al database del modulo Portale Service: schema PostgreSQL "service" della Suite (search_path = service, public).
import { moduleDb } from '../../lib/modules.js';

const db = moduleDb('service');
export const { pool, q, one, many, tx } = db;
export default db;

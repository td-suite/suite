// Registra i lavori di sfondo. Ogni blocco (community, legacy, search) esporta una funzione register*Jobs.
import { registerJob } from '../lib/jobs.js';
const tryImport = async (p, fn) => { try { const m = await import(p); if (m[fn]) m[fn](registerJob); } catch (e) { console.warn(`[jobs] ${p}: ${e.message}`); } };
await tryImport('../lib/legacy.js', 'registerLegacyJobs');
await tryImport('../lib/community.js', 'registerCommunityJobs');
await tryImport('../lib/search.js', 'registerSearchJobs');

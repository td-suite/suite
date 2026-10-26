// Protocollo progressivo annuale TD-AAAA/NNN, assegnato dal database alla pubblicazione, mai in bozza e mai dal client.
// Da chiamare dentro una transazione (client): il blocco consultivo serializza le pubblicazioni dello stesso anno.
import { config } from '../config.js';

export const formatProtocollo = (anno, numero, revisione = 0) => `${config.protocolPrefix}-${anno}/${String(numero).padStart(3, '0')}${revisione ? `-r${revisione}` : ''}`;

export async function nextNumero(client, anno) {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`circolari:protocollo:${anno}`]);
  const r = await client.query('SELECT coalesce(max(numero), 0) + 1 AS n FROM circolari WHERE anno = $1', [anno]);
  return Number(r.rows[0].n);
}

// Token non indovinabile per l'URL pubblico raggiunto dal QR code
export const newToken = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');

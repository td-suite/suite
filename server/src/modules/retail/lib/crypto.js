// Cifratura delle credenziali dei connettori (AES-256-GCM con chiave derivata da SESSION_SECRET)
import crypto from 'node:crypto';
import { config } from '../config.js';

const key = crypto.createHash('sha256').update(`td-retail:${config.sessionSecret}`).digest();

export function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

export function decrypt(blob) {
  if (!blob) return null;
  const [iv, tag, enc] = blob.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

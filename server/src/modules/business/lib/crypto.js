// Cifratura delle credenziali dei portali: AES-256-GCM con chiave derivata da CREDENTIALS_KEY
import crypto from 'node:crypto';
import { config } from '../config.js';

// Senza chiave (produzione senza BUSINESS_CREDENTIALS_KEY/CREDENTIALS_KEY, M5) le credenziali dei portali sono disattivate
const key = config.credentialsKey ? crypto.createHash('sha256').update(String(config.credentialsKey)).digest() : null;
const senzaChiave = () => Object.assign(new Error('Credenziali dei portali disattivate: manca BUSINESS_CREDENTIALS_KEY nelle variabili d\'ambiente della Suite'), { status: 503 });

export function encrypt(text) {
  if (text == null || text === '') return null;
  if (!key) throw senzaChiave();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${ct.toString('base64')}`;
}

export function decrypt(payload) {
  if (!payload) return '';
  if (!key) throw senzaChiave();
  const [iv, tag, ct] = payload.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

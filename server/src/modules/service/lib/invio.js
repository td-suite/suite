// Consegna di un file dello specchio: intestazioni come il sito di origine (PDF inline, nosniff, cache di un'ora nel browser),
// X-Service-Cache dice se il file è arrivato dalla cache della Suite (HIT) o dal sito di origine (MISS).
import { sendFile } from '../../../lib/moduleStorage.js';

export async function inviaFile(res, file, { da, scarica = false } = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Service-Cache', da === 'cache' ? 'HIT' : 'MISS');
  if (file.sha256) res.setHeader('ETag', `"${file.sha256}"`);
  await sendFile(res, { mime: file.mime, filename: file.filename, data: file.data, blob_path: file.blob_path }, { inline: !scarica });
}

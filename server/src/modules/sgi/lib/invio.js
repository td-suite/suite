// Consegna di un file dello specchio SGI: intestazioni come il sito di origine (PDF inline, nosniff, cache di un'ora nel browser),
// X-SGI-Cache dice se il file è arrivato dalla cache della Suite (HIT) o dal sito di origine (MISS). Comune al Portale Service.
import { inviaFilePortale } from '../../../lib/specchioPortale.js';

export function inviaFile(res, file, { da, scarica = false } = {}) {
  return inviaFilePortale(res, file, { da, scarica, intestazioneCache: 'X-SGI-Cache' });
}

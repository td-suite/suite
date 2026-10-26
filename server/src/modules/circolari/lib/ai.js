// Strutturazione della bozza grezza con Claude: dal testo del laboratorio alla scheda della circolare (titolo, oggetto,
// sintesi, destinatari, decorrenza, corpo a blocchi). Nessun dato di pazienti deve transitare: le circolari sono comunicazioni
// commerciali e organizzative. Se l'AI non è configurata si usa l'euristica di lib/extract.js.
import { aiEnabled, askJson, cleanText } from '../../../lib/claude.js';
import { heuristicStructure } from './extract.js';

const BLOCK_TYPES = new Set(['titolo', 'paragrafo', 'elenco', 'tabella']);

function sanitizeBlocks(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const b of arr) {
    if (!b || !BLOCK_TYPES.has(b.type)) continue;
    if (b.type === 'elenco') { const items = (b.items || []).map((x) => cleanText(x, 600)).filter(Boolean); if (items.length) out.push({ type: 'elenco', items }); }
    else if (b.type === 'tabella') {
      const colonne = (b.colonne || []).map((x) => cleanText(x, 80));
      if (!colonne.length) continue;
      const righe = (b.righe || []).filter(Array.isArray).map((r) => colonne.map((_, i) => cleanText(r[i], 200)));
      out.push({ type: 'tabella', colonne, righe });
    } else { const text = cleanText(b.text, b.type === 'titolo' ? 160 : 3000); if (text) out.push({ type: b.type, text }); }
  }
  return out;
}

export async function structureDraft({ text, blocchi, hint, userId }) {
  const fallback = heuristicStructure(blocchi || []);
  if (!aiEnabled()) return { ...fallback, ai: false };
  const system = [
    'Sei la redazione di Toscana Diagnostica S.r.l., rete toscana di laboratori e centri diagnostici.',
    'Trasformi la bozza grezza di una circolare aziendale (scritta dal laboratorio o da un ufficio) nella scheda strutturata della circolare ufficiale, destinata a clienti, strutture sanitarie, laboratori partner o personale.',
    'Regole di scrittura: italiano, registro professionale e diretto, frasi brevi, nessun trattino lungo, nessuna enfasi retorica, nessuna parola come "approfondire", "sinergia", "eccellenza", "all\'avanguardia". Non inventare dati, date, prezzi o impegni che non sono nella bozza: se mancano, lascia il campo vuoto.',
    'Non alterare numeri, orari, date, codici, nomi di esami o condizioni presenti nella bozza. Le tabelle della bozza restano tabelle con le stesse colonne e righe.',
    'Rispondi esclusivamente con un oggetto JSON con questi campi: titolo (max 120 caratteri), oggetto (una riga), destinatari (una riga), decorrenza (una riga o vuoto), riferimenti (una riga o vuoto), sintesi (2-4 frasi: cosa cambia, per chi, da quando), tipo (es. "Comunicazione ai clienti", "Comunicazione interna"), linea (es. "Laboratorio di Analisi", "Diagnostica per Immagini", "Medicina del Lavoro"), corpo (array di blocchi).',
    'Blocchi ammessi: {"type":"titolo","text":"1. Titolo di sezione"}, {"type":"paragrafo","text":"..."}, {"type":"elenco","items":["...","..."]}, {"type":"tabella","colonne":["..."],"righe":[["..."]]}. Le sezioni si numerano "1.", "2.". Il corpo inizia di norma con il saluto "Gentile Cliente," come paragrafo (o "Gentili Colleghi," per le circolari interne) e termina con un blocco "Cosa fare" quando ai destinatari è richiesta un\'azione.',
  ].join(' ');
  const user = `${hint ? `Indicazioni del redattore: ${cleanText(hint, 500)}\n\n` : ''}Bozza grezza:\n\n${String(text || '').slice(0, 24000)}`;
  try {
    const obj = await askJson({ kind: 'circolare', system, user, maxTokens: 6000, userId, query: 'structureDraft', timeoutMs: 90_000 });
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Risposta non interpretabile');
    const corpo = sanitizeBlocks(obj.corpo);
    return {
      titolo: cleanText(obj.titolo, 160) || fallback.titolo,
      oggetto: cleanText(obj.oggetto, 300) || fallback.oggetto,
      destinatari: cleanText(obj.destinatari, 300),
      decorrenza: cleanText(obj.decorrenza, 120),
      riferimenti: cleanText(obj.riferimenti, 300),
      sintesi: cleanText(obj.sintesi, 800) || fallback.sintesi,
      tipo: cleanText(obj.tipo, 80),
      linea: cleanText(obj.linea, 80),
      corpo: corpo.length ? corpo : fallback.corpo,
      ai: true,
    };
  } catch (e) {
    return { ...fallback, ai: false, ai_error: e.message };
  }
}

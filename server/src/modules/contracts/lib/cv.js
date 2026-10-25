// Lettura CV: estrazione testo (PDF) e sintesi del profilo (API Claude, facoltativa)
import { createRequire } from 'node:module';
import { config } from '../config.js';

const require = createRequire(import.meta.url);

export async function extractText(buffer, mime, filename = '') {
  // PDF con testo, PDF scansionato (OCR), DOCX e testo semplice: stessa estrazione usata per i contratti
  try {
    const { extractAnyText } = await import('./contractParse.js');
    const r = await extractAnyText(buffer, mime, filename);
    return (r.text || '').replace(/\s+\n/g, '\n').trim().slice(0, 20000);
  } catch (e) {
    console.error('[cv] estrazione testo fallita:', e.message);
  }
  return '';
}

// Estrazione euristica di email e telefono dal testo
export function quickFacts(text) {
  const email = (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/) || [])[0] || null;
  const phone = (text.match(/(\+39\s?)?(3\d{2}[\s.-]?\d{3}[\s.-]?\d{3,4}|0\d{1,3}[\s.-]?\d{5,8})/) || [])[0] || null;
  return { email, phone: phone ? phone.replace(/\s/g, ' ').trim() : null };
}

export async function summarizeCv(text, areas) {
  if (!config.anthropicKey) return null;
  if (!text || text.replace(/\s/g, '').length < 50) { const e = new Error('Dal file non si ricava testo: il CV è vuoto, è un\'immagine non leggibile o un formato non supportato (accettati PDF, DOCX, TXT).'); e.status = 400; throw e; }
  const prompt = `Sei l'assistente HR di Toscana Diagnostica (rete sanitaria: laboratorio di analisi, diagnostica per immagini, medicina specialistica, medicina del lavoro). Analizza il CV seguente e rispondi SOLO con un oggetto JSON con le chiavi: first_name, last_name, email, phone, role_target (ruolo per cui è più adatto, in italiano, breve), area (una tra: ${areas.join(' | ')}), summary (sintesi del profilo in 4-6 frasi, italiano, tono professionale: formazione, esperienze, competenze chiave, punti di attenzione), rating (1-5, attinenza al settore sanitario-diagnostico). Usa null per i dati non presenti.\n\nCV:\n${text.slice(0, 12000)}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: config.anthropicModel, max_tokens: 2000, system: 'Rispondi esclusivamente con un oggetto JSON valido, senza testo prima o dopo e senza blocchi di codice.', messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) {
    const body = await res.text();
    let detail = body;
    try { detail = JSON.parse(body)?.error?.message || body; } catch { /* testo grezzo */ }
    const hint = res.status === 404 ? ` Il modello "${config.anthropicModel}" non è disponibile: imposta ANTHROPIC_MODEL su Render con un modello corrente (es. claude-sonnet-5-5).`
      : res.status === 401 ? ' Chiave API non valida: controlla ANTHROPIC_API_KEY su Render.'
        : res.status === 429 ? ' Limite di utilizzo o credito esaurito sul piano API.' : '';
    const err = new Error(`API Claude (${res.status}): ${String(detail).slice(0, 300)}.${hint}`);
    err.status = 424; throw err;
  }
  const data = await res.json();
  const txt = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text || '').join('').trim();
  const parsed = parseJsonObject(txt);
  if (!parsed) {
    console.error('[cv] risposta non interpretabile:', txt.slice(0, 500), '| stop_reason:', data.stop_reason);
    const e = new Error(`Il modello non ha restituito una sintesi leggibile (stop: ${data.stop_reason || 'n.d.'}). Inizio della risposta: ${txt.slice(0, 160) || '(vuota)'}`);
    e.status = 424; throw e;
  }
  return parsed;
}

/** Estrae il primo oggetto JSON bilanciato dal testo (anche dentro ```json ... ```). */
function parseJsonObject(txt) {
  const cleaned = txt.replace(/```(?:json)?/gi, '').trim();
  try { return JSON.parse(cleaned); } catch { /* prosegue */ }
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(cleaned.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

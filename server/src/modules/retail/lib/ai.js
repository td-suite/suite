// Generazione di claim e piano di spinta per le promozioni: API Claude se configurata, altrimenti schemi predefiniti
import { config } from '../config.js';
import { HttpError } from './util.js';

const TEMPLATES = [
  (p) => `${p.theme || p.name}: il tuo tempo vale. ${p.offer}`,
  (p) => `Prenditi cura di te a ${p.monthName}. ${p.offer}`,
  (p) => `${p.offer} Solo a ${p.monthName}, in tutte le sedi Toscana Diagnostica.`,
  (p) => `Prevenire è una scelta. ${p.offer}`,
  (p) => `Un minuto per prenotare, un anno di tranquillità. ${p.offer}`,
];
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

function offerText(p, products) {
  const names = products.slice(0, 3).map((x) => x.description.toLowerCase()).join(', ');
  if (p.discount_type === 'PERCENTUALE' && p.discount_value) return `${names ? names.charAt(0).toUpperCase() + names.slice(1) : 'Le prestazioni selezionate'}: ${Number(p.discount_value)}% di sconto.`;
  if (p.discount_type === 'PREZZO_FISSO' && p.discount_value) return `${names ? names.charAt(0).toUpperCase() + names.slice(1) : 'Il pacchetto'} a ${Number(p.discount_value).toLocaleString('it-IT')} €.`;
  if (p.discount_type === 'IMPORTO' && p.discount_value) return `${Number(p.discount_value).toLocaleString('it-IT')} € di sconto su ${names || 'prestazioni selezionate'}.`;
  if (p.discount_type === 'PACCHETTO' && p.bundle_price) return `Pacchetto completo a ${Number(p.bundle_price).toLocaleString('it-IT')} €.`;
  if (p.discount_type === 'OMAGGIO') return `${names ? names.charAt(0).toUpperCase() + names.slice(1) : 'Un esame'} in omaggio.`;
  return names ? `${names.charAt(0).toUpperCase() + names.slice(1)} con referto in 24 ore.` : 'Referti rapidi, prenotazione online, nessuna attesa.';
}

export const DEFAULT_PUSH_PLAN = (p) => {
  const ym = `${p.year}-${String(p.month).padStart(2, '0')}`;
  return [
    { channel: 'INSTORE', action: 'Sostituzione locandine, cavalieri e palinsesto monitor in tutte le sedi coinvolte', when: `${ym}-01`, owner: 'Site manager', done: false },
    { channel: 'ACCETTAZIONE', action: 'Script di proposta allo sportello e al call center (apertura, beneficio, prezzo, prenotazione)', when: `${ym}-01`, owner: 'Responsabile accettazione', done: false },
    { channel: 'SMS', action: 'SMS al target con consenso marketing e ultima visita oltre 10 mesi', when: `${ym}-03`, owner: 'Retail & Communications', done: false },
    { channel: 'EMAIL', action: 'Newsletter mensile con la promo in apertura', when: `${ym}-02`, owner: 'Retail & Communications', done: false },
    { channel: 'META', action: 'Campagna social geolocalizzata (15 km dalle sedi), 3 creatività, budget giornaliero', when: `${ym}-01`, owner: 'Agenzia', done: false },
    { channel: 'GOOGLE', action: 'Annunci search sulle parole chiave della prestazione e del territorio', when: `${ym}-01`, owner: 'Agenzia', done: false },
    { channel: 'MMG', action: 'Comunicazione ai medici di base e agli specialisti invianti del bacino', when: `${ym}-05`, owner: 'Retail & Communications', done: false },
    { channel: 'B2B', action: 'Proposta alle aziende convenzionate e ai fondi (welfare)', when: `${ym}-08`, owner: 'Business Development', done: false },
    { channel: 'SITO', action: 'Landing page con prenotazione TuoTempo e codice promo', when: `${ym}-01`, owner: 'Retail & Communications', done: false },
    { channel: 'MISURA', action: 'Lettura KPI a metà mese e correttivi (budget, creatività, sedi)', when: `${ym}-15`, owner: 'Retail & Communications', done: false },
  ];
};

export const DEFAULT_MATERIALS = () => [
  { type: 'Locandina 70x100 (vetrina)', status: 'DA_FARE' }, { type: 'Locandina A3 (sala d\'attesa)', status: 'DA_FARE' }, { type: 'Cavaliere A5 (accettazione)', status: 'DA_FARE' },
  { type: 'Palinsesto monitor (16:9)', status: 'DA_FARE' }, { type: 'Post social (3 creatività)', status: 'DA_FARE' }, { type: 'Testo SMS (160 caratteri)', status: 'DA_FARE' },
  { type: 'Newsletter', status: 'DA_FARE' }, { type: 'Landing page', status: 'DA_FARE' }, { type: 'Script accettazione e call center', status: 'DA_FARE' },
];

export async function generateClaims(p, products) {
  const monthName = MONTHS[(p.month || 1) - 1];
  const offer = offerText(p, products);
  if (!config.anthropicKey) {
    const base = TEMPLATES.map((t) => t({ ...p, monthName, offer }));
    return { source: 'template', claims: base.map((c) => ({ claim: c, claim_short: c.split(/[.:!]/)[0].trim(), sms: `${c.split(/[.:!]/)[0].trim()}. ${offer} Prenota: www.toscanadiagnostica.it`.slice(0, 160) })) };
  }
  const prompt = `Sei il responsabile Retail & Communications di Toscana Diagnostica, rete sanitaria toscana (laboratorio analisi, diagnostica per immagini, medicina specialistica, medicina del lavoro). Posizionamento: "Ci prendiamo cura del tempo dei pazienti, lì dove ogni minuto conta". Tono: professionale, caldo, diretto, mai allarmistico; nessuna promessa clinica; conforme alla pubblicità sanitaria (decoro, nessun confronto con concorrenti).
Promozione del mese di ${monthName} ${p.year}: "${p.name}". Tema: ${p.theme || '-'}. Target: ${p.target || 'adulti'}. Offerta: ${offer} Prestazioni: ${products.map((x) => x.description).join('; ') || '-'}.
Genera 5 proposte. Rispondi SOLO con JSON: {"claims":[{"claim":"headline max 60 caratteri","claim_short":"max 30 caratteri per social/cavaliere","sms":"SMS max 160 caratteri con invito a prenotare"}]}`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: config.anthropicModel, max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new HttpError(502, res.status === 404 ? `Modello ${config.anthropicModel} non disponibile: aggiorna ANTHROPIC_MODEL` : `API Claude: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data.content?.map((c) => c.text || '').join('') || '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new HttpError(502, 'Risposta dell\'API non interpretabile');
  const parsed = JSON.parse(m[0]);
  return { source: 'claude', claims: (parsed.claims || []).slice(0, 6) };
}

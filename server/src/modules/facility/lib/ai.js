// "Analisi con Claude" dei consumi (facoltativa): commento sui consumi della sede o della rete nell'anno, anomalie e azioni di
// efficientamento ordinate per urgenza, utile al riesame per le certificazioni (ISO 9001; ISO 14001 / 50001 se intraprese).
// askJson di lib/claude.js, kind 'facility_energia' (registrato in ai_log). Nel prompt solo dati aggregati di consumo: nessun dato
// personale. Senza chiave Anthropic: 400 "Intelligenza artificiale non configurata"; in sviluppo FACILITY_AI_MOCK=1 costruisce un
// commento standard dai numeri reali (mai in produzione).
import { config } from '../config.js';
import { config as appConfig } from '../../../config.js';
import { askJson, aiEnabled } from '../../../lib/claude.js';
import { bad } from '../../../lib/util.js';

export const AI_NOT_CONFIGURED = 'Intelligenza artificiale non configurata: inserisci la chiave Anthropic in Amministrazione > Impostazioni';
const useMock = () => config.aiMock && !aiEnabled();
export const aiState = () => ({ enabled: aiEnabled(), mock: useMock(), message: aiEnabled() ? null : (config.aiMock ? 'Analisi simulata (FACILITY_AI_MOCK=1): testi standard costruiti dai numeri reali' : AI_NOT_CONFIGURED) });

const SYSTEM = [
  'Sei un energy manager esperto di strutture sanitarie non ospedaliere (punti prelievo, centri medici, diagnostica per immagini, laboratori di analisi), al servizio di Toscana Diagnostica.',
  'Scrivi in italiano, sobrio e concreto. Niente emoji, niente trattini lunghi.',
  'Sei fedele ai dati forniti: non inventare consumi, costi, sedi o interventi. Se i dati sono pochi o incompleti dillo nel commento.',
  'Le fasce di benchmark sono indicative e vanno tarate: non presentarle come limiti normativi.',
  'Rispondi esclusivamente con un oggetto JSON valido, senza testo prima o dopo.',
].join(' ');

const FORMAT = `Formato: {"commento": "5-8 frasi sull'andamento dei consumi, dei costi e della CO2", "anomalie": [{"descrizione": "...", "possibile_causa": "..."}],
"azioni": [{"azione": "...", "urgenza": "ALTA|MEDIA|BASSA", "beneficio_atteso": "...", "sede": "nome o rete"}], "note_certificazione": "2-3 frasi utili al riesame ISO 9001 e, se intrapresa, ISO 14001/50001"}`;

// Riduzione dei dati del quadro energetico a ciò che serve al modello (aggregati)
export function promptData(e, siteId) {
  const pick = (s) => ({ sede: s.site?.name || 'Rete', tipologia: s.site?.kind || null, superficie_m2: s.sqm, totali: s.totals, anno_precedente_intero: s.prev, anno_precedente_stessi_mesi: s.prev_ytd, variazione_kwh_pct_stessi_mesi: s.delta_kwh_pct,
    vettori: s.vectors.map((v) => ({ vettore: v.vector, unita: v.unit, quantita: v.qty, costo: v.cost, costo_unitario: v.unit_cost, variazione_pct: v.delta_pct })),
    intensita: s.intensity, benchmark: s.benchmark ? { fascia: s.benchmark.band, posizione: s.benchmark.position } : null,
    mensile_kwh: s.monthly.map((m) => ({ mese: m.month, kwh: m.kwh, anno_prima: m.prev_kwh })), anomalie: s.anomalies.slice(0, 12) });
  if (siteId) { const s = e.sites.find((x) => x.site.id === siteId); return { anno: e.year, sede: s ? pick(s) : null, benchmark_fonte: e.benchmark.source }; }
  return { anno: e.year, rete: pick(e.network), sedi: e.sites.filter((s) => s.totals.kwh > 0).map(pick), classifica_kwh_per_accettazione: e.classifica.per_accettazione.slice(0, 15), obiettivi: e.obiettivi.map((t) => ({ sede: t.site_name || 'Rete', anno: t.year, vettore: t.vector || 'totale', obiettivo_pct: t.target_pct_reduction, base: t.baseline_year, avanzamento: t.progress })), benchmark_fonte: e.benchmark.source };
}

function mock(d) {
  const s = d.sede || d.rete;
  if (!s) return { commento: 'Dati insufficienti per un commento: registra bollette o letture.', anomalie: [], azioni: [], note_certificazione: '' };
  const t = s.totali || {};
  const dv = s.variazione_kwh_pct_stessi_mesi;
  const commento = [`Nel ${d.anno} ${s.sede === 'Rete' ? 'la rete' : `la sede ${s.sede}`} ha consumato ${Math.round(t.kwh || 0).toLocaleString('it-IT')} kWh equivalenti per una spesa di ${Math.round(t.cost || 0).toLocaleString('it-IT')} euro e ${Math.round(t.co2 || 0).toLocaleString('it-IT')} kg di CO2.`,
    dv == null ? 'Manca l\'anno precedente per il confronto.' : `Rispetto agli stessi mesi dell'anno precedente i consumi sono ${dv >= 0 ? 'aumentati' : 'diminuiti'} del ${Math.abs(dv)}%.`,
    s.intensita?.kwh_m2_anno != null ? `L'intensità è di ${s.intensita.kwh_m2_anno} kWh per m2 all'anno${s.benchmark?.posizione ? `, ${s.benchmark.posizione === 'SOPRA' ? 'sopra' : s.benchmark.posizione === 'SOTTO' ? 'sotto' : 'dentro'} la fascia indicativa della tipologia` : ''}.` : 'Manca la superficie: inseriscila nella scheda immobile per l\'intensità per m2.',
    'Commento simulato per il collaudo (FACILITY_AI_MOCK=1).'].join(' ');
  const anomalie = (s.anomalie || []).slice(0, 5).map((a) => ({ descrizione: `${a.vector} ${a.month}: +${a.delta_pct}% rispetto a ${a.ref_kind === 'ANNO_PRECEDENTE' ? 'stesso mese dell\'anno prima' : 'media dei tre mesi precedenti'}`, possibile_causa: 'Da verificare: lettura stimata, guasto, uso fuori orario o cambio di attività.' }));
  const azioni = [
    { azione: 'Verificare le anomalie con le letture del contatore e i rapportini di manutenzione', urgenza: anomalie.length ? 'ALTA' : 'BASSA', beneficio_atteso: 'Esclusione di sprechi e di errori di fatturazione', sede: s.sede },
    { azione: 'Programmare spegnimenti e set point degli impianti di climatizzazione fuori orario', urgenza: 'MEDIA', beneficio_atteso: 'Riduzione dei consumi elettrici nelle ore di chiusura', sede: s.sede },
    { azione: 'Sostituire l\'illuminazione residua con LED e sensori di presenza', urgenza: 'BASSA', beneficio_atteso: 'Riduzione dei consumi per illuminazione', sede: s.sede },
  ];
  return { commento, anomalie, azioni, note_certificazione: 'I dati mensili, le anomalie verificate e le azioni decise possono essere riportati nel riesame della direzione come evidenza del monitoraggio delle prestazioni energetiche.' };
}
const URG = ['ALTA', 'MEDIA', 'BASSA'];
function normalize(x) {
  const o = x && typeof x === 'object' ? x : {};
  const azioni = (Array.isArray(o.azioni) ? o.azioni : []).map((a) => ({ azione: String(a?.azione || '').slice(0, 400), urgenza: URG.includes(String(a?.urgenza).toUpperCase()) ? String(a.urgenza).toUpperCase() : 'MEDIA', beneficio_atteso: String(a?.beneficio_atteso || '').slice(0, 400), sede: String(a?.sede || '').slice(0, 120) })).filter((a) => a.azione);
  azioni.sort((a, b) => URG.indexOf(a.urgenza) - URG.indexOf(b.urgenza));
  return { commento: String(o.commento || '').slice(0, 4000), anomalie: (Array.isArray(o.anomalie) ? o.anomalie : []).slice(0, 20).map((a) => ({ descrizione: String(a?.descrizione || '').slice(0, 400), possibile_causa: String(a?.possibile_causa || '').slice(0, 400) })),
    azioni, note_certificazione: String(o.note_certificazione || '').slice(0, 2000) };
}

export async function analizza(e, siteId, { userId } = {}) {
  if (!aiEnabled() && !config.aiMock) throw bad(AI_NOT_CONFIGURED);
  const d = promptData(e, siteId);
  if (useMock()) return { result: normalize(mock(d)), model: 'mock' };
  const user = `Analizza i consumi energetici ${siteId ? 'della sede' : 'della rete'} di Toscana Diagnostica nell'anno ${e.year}. Commenta l'andamento, le anomalie e proponi azioni di efficientamento ordinate per urgenza.\n${FORMAT}\n\nDati (JSON):\n${JSON.stringify(d)}`;
  const out = await askJson({ kind: 'facility_energia', system: SYSTEM, user, maxTokens: 3000, userId, query: `energia ${siteId ? `sede ${siteId}` : 'rete'} ${e.year}` });
  return { result: normalize(out), model: appConfig.anthropic.model };
}

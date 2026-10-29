// Sintesi con Claude (lib/claude.js askJson, kind 'audit_sintesi'): per sede, per la rete TD, per singolo partner e per tutti i partner.
// Il prompt porta nomi di sedi e organizzazioni, punteggi, non conformità, osservazioni e il testo estratto dai PDF di terze parti
// (troncato). Nessun dato di pazienti (qui non ce ne sono). Nei log della Suite solo id e conteggi.
// Senza chiave Anthropic: 400 "Intelligenza artificiale non configurata"; con AUDIT_AI_MOCK=1 (solo fuori produzione) la sintesi
// viene costruita dai punteggi reali con testi standard, per il collaudo.
import { q, one, many } from '../db.js';
import { config as appConfig } from '../../../config.js';
import { config, KEY, KINDS, STRUCTURE_KINDS, INTERNAL_ORG_KINDS } from '../config.js';
import { askJson, aiEnabled } from '../../../lib/claude.js';
import { bad } from '../../../lib/util.js';
import { A_COLS, A_FROM, decorate, siteById, orgById } from './core.js';
import { levelOf, levelLetter, sectionsOf, monthLabel } from './scoring.js';

export const AI_NOT_CONFIGURED = 'Intelligenza artificiale non configurata: inserisci la chiave Anthropic in Amministrazione > Impostazioni';
const useMock = () => config.aiMock && !aiEnabled();
const requireAi = () => { if (!aiEnabled() && !config.aiMock) throw bad(AI_NOT_CONFIGURED); };

const SYSTEM = [
  'Sei un auditor esperto di sistemi di gestione integrati (SGI) in sanità, con competenza su ISO 9001 e ISO 37001, al servizio di Toscana Diagnostica (rete toscana di laboratori, centri medici e punti prelievo).',
  'Scrivi in italiano, in modo sobrio, concreto e professionale. Niente emoji, niente trattini lunghi.',
  'Sei fedele ai dati forniti: non inventare voci, punteggi, eventi o documenti che non compaiono nei dati. Se i dati sono pochi o incompleti, dillo esplicitamente nel giudizio e nelle note.',
  'Il giudizio è un supporto alla funzione Qualità, che resta responsabile della valutazione finale.',
  'Rispondi esclusivamente con un oggetto JSON valido, senza testo prima o dopo, nel formato richiesto.',
].join(' ');

const clip = (s, n) => { const t = String(s || ''); return t.length > n ? `${t.slice(0, n)}\n[... testo troncato ...]` : t; };
const lvlLabel = (score) => { const l = levelOf(score); return l ? `${l.letter} ${l.label}` : 'n.d.'; };

// ---- Raccolta dei dati di una sede (ultimi 12 mesi)
async function auditsForSite(siteId, { months = 12, withText = true } = {}) {
  const rows = await many(`SELECT ${A_COLS}, a.answers, a.verifier_answers${withText ? ", a.third_party->>'sintesi_testo' AS sintesi_testo" : ''} FROM ${A_FROM}
    WHERE a.deleted_at IS NULL AND a.site_id=$1 AND a.kind IN ('AUTO','INTERNO','TERZI') AND a.status IN ('INVIATO','VERIFICATO','CHIUSO','CARICATO')
      AND coalesce(a.conducted_at, a.created_at) >= now() - make_interval(months => $2) ORDER BY coalesce(a.conducted_at, a.created_at)`, [siteId, months]);
  return rows.map(decorate);
}

function describeAudit(a, template) {
  const lines = [];
  const when = a.kind === 'AUTO' && a.period ? monthLabel(a.period) : (a.conducted_at || a.created_at ? new Date(a.conducted_at || a.created_at).toLocaleDateString('it-IT') : '');
  if (a.kind === 'TERZI') {
    const tp = a.third_party || {};
    lines.push(`- [${a.id}] Audit di terze parti (${tp.ente_tipo || 'ente'}: ${tp.ente || 'n.d.'}, ${tp.data || when}), esito dichiarato: ${tp.esito || 'n.d.'}${tp.note ? `. Note: ${tp.note}` : ''}`);
    return lines.join('\n');
  }
  const sec = Object.entries(a.score_by_section || {}).map(([k, s]) => `${s.title || k}: sede ${s.score ?? 'n.d.'}%${s.score_verifier != null ? `, verifica ${s.score_verifier}%` : ''}${(s.nc || s.nc_verifier) ? ` (NC ${s.nc_verifier ?? s.nc})` : ''}`).join('; ');
  lines.push(`- [${a.id}] ${KINDS[a.kind]} ${when}, stato ${a.status}: punteggio sede ${a.score ?? 'n.d.'}%${a.score_verifier != null ? `, verificatore ${a.score_verifier}% (scostamento ${a.score_delta >= 0 ? '+' : ''}${a.score_delta})` : ''}, che fa fede ${a.effective_score ?? 'n.d.'}% (${lvlLabel(a.effective_score)}).`);
  if (sec) lines.push(`  Sezioni: ${sec}`);
  // voci NO/NC con nota (dalla colonna che fa fede)
  const col = a.score_source === 'VERIFICA' ? a.verifier_answers : a.answers;
  const items = template ? itemsIndex(template) : {};
  const neg = Object.entries(col || {}).filter(([, v]) => v && ['NO', 'NC'].includes(v.v)).slice(0, 40).map(([k, v]) => `${k} ${items[k] || ''} = ${v.v}${v.note ? ` (${v.note})` : ''}`);
  if (neg.length) lines.push(`  Voci negative: ${neg.join('; ')}`);
  const ncs = (a.ncs || []).filter((n) => n && (n.descrizione || n.n));
  if (ncs.length) lines.push(`  Non conformità: ${ncs.map((n) => `${n.n ? `voce ${n.n}: ` : ''}${n.descrizione || ''}${n.azione_correttiva ? ` → ${n.azione_correttiva}` : ''}${n.entro ? ` entro ${n.entro}` : ''}`).join('; ')}`);
  if (a.observations) lines.push(`  Osservazioni: ${clip(a.observations, 800)}`);
  return lines.join('\n');
}
function itemsIndex(template) {
  const out = {};
  for (const p of template.body?.parts || template.parts || []) for (const s of p.sections || []) for (const it of s.items || []) {
    if (it.sub?.length) for (const su of it.sub) out[su.key] = su.text; else out[String(it.n).replace(/\s+/g, '')] = it.text;
  }
  return out;
}

const SEDE_FORMAT = `{"livello_allineamento": 0-100, "livello_lettera": "A|B|C|D", "giudizio": "testo", "dati_sufficienti": true|false,
 "aree": [{"area": "nome della sezione", "livello": 0-100, "punti_di_forza": ["..."], "criticita": ["..."], "azioni": [{"descrizione": "...", "urgenza": "ALTA|MEDIA|BASSA", "responsabile_suggerito": "...", "entro_giorni": 30}]}],
 "piano_miglioramento": [{"fase": "1", "obiettivo": "...", "azioni": ["..."], "scadenza": "...", "indicatore": "..."}],
 "trend": "testo (se più mesi) oppure null", "note_terze_parti": "testo oppure null"}`;

// ---- (a) Sede
export async function sintesiSede(siteId, { userId, moduleUserId } = {}) {
  requireAi();
  const site = await siteById(siteId);
  const audits = await auditsForSite(siteId);
  if (!audits.length) throw bad('Nessun audit inviato, verificato o chiuso negli ultimi 12 mesi per questa sede: non c\'è nulla da sintetizzare');
  const template = await one(`SELECT body FROM templates WHERE kind='SEDE' AND active ORDER BY id DESC LIMIT 1`);
  const sections = template ? sectionsOf(template.body) : [];
  let budget = config.synthTerziTotal; let truncated = false;
  const terzi = [];
  for (const a of audits.filter((x) => x.kind === 'TERZI' && x.sintesi_testo)) {
    const t = clip(a.sintesi_testo, Math.min(config.synthTerziEach, budget));
    if (budget <= 0) { truncated = true; break; }
    budget -= t.length; terzi.push(`--- PDF audit [${a.id}] (${a.third_party?.ente || 'ente'}) ---\n${t}`);
  }
  const user = [
    `Sede: ${site.name} (${site.kind}${site.city ? `, ${site.city}` : ''}). Site manager: ${site.manager_name || 'n.d.'}.`,
    `Aree del modello di audit (usa questi nomi nel campo "area"): ${sections.map((s) => s.title).join('; ')}.`,
    `Scala dei livelli: A Allineato (90-100), B Sostanzialmente allineato (75-89), C Parzialmente allineato (60-74), D Critico (0-59). Per gli auto-audit fa fede il punteggio del verificatore quando presente.`,
    `Audit degli ultimi 12 mesi (${audits.length}):`,
    audits.map((a) => describeAudit(a, template)).join('\n'),
    terzi.length ? `Testo estratto dai rapporti di terze parti${truncated ? ' (parte del testo è stata omessa per lunghezza)' : ''}:\n${terzi.join('\n\n')}` : 'Nessun rapporto di terze parti con testo estraibile.',
    `Produci il giudizio di sintesi della sede con il livello di allineamento al SGI (0-100), le aree di competenza con livello, punti di forza, criticità e azioni per urgenza, il piano di miglioramento e il trend se ci sono più mesi. Formato JSON: ${SEDE_FORMAT}`,
  ].join('\n\n');
  const result = useMock() ? mockSede(site, audits, sections, template) : normalizeSede(await askJson({ kind: 'audit_sintesi', system: SYSTEM, user, maxTokens: 4000, userId, query: `sintesi sede ${siteId}, ${audits.length} audit` }));
  const lastAt = audits.reduce((m, a) => { const d = new Date(a.verified_at || a.conducted_at || a.created_at); return !m || d > m ? d : m; }, null);
  const row = await one(`INSERT INTO syntheses (scope, site_id, generated_by, model, inputs, result, score, level) VALUES ('SEDE',$1,$2,$3,$4,$5,$6,$7) RETURNING id, generated_at`,
    [siteId, moduleUserId || null, useMock() ? 'mock' : appConfig.anthropic.model, JSON.stringify({ audit_ids: audits.map((a) => a.id), mesi: 12, troncato: truncated }), JSON.stringify(result), result.livello_allineamento, result.livello_lettera]);
  await q(`INSERT INTO public.site_sgi_scores (site_id, score, level, summary, synthesis_id, last_audit_at, computed_at) VALUES ($1,$2,$3,$4,$5,$6,now())
    ON CONFLICT (site_id) DO UPDATE SET score=EXCLUDED.score, level=EXCLUDED.level, summary=EXCLUDED.summary, synthesis_id=EXCLUDED.synthesis_id, last_audit_at=EXCLUDED.last_audit_at, computed_at=now()`,
  [siteId, result.livello_allineamento, result.livello_lettera, String(result.giudizio || '').slice(0, 400), row.id, lastAt]);
  return { id: row.id, scope: 'SEDE', site_id: siteId, generated_at: row.generated_at, model: useMock() ? 'mock' : appConfig.anthropic.model, inputs: { audit_ids: audits.map((a) => a.id), troncato: truncated }, result, score: result.livello_allineamento, level: result.livello_lettera };
}

const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 10) / 10)) : d; };
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v, n = 4000) => (v == null ? null : String(v).slice(0, n));
const URG = ['ALTA', 'MEDIA', 'BASSA'];
const azioni = (v) => arr(v).map((x) => ({ descrizione: str(x?.descrizione, 600) || '', urgenza: URG.includes(x?.urgenza) ? x.urgenza : 'MEDIA', responsabile_suggerito: str(x?.responsabile_suggerito, 120), entro_giorni: Number.isFinite(Number(x?.entro_giorni)) ? Number(x.entro_giorni) : null })).filter((x) => x.descrizione);
const piano = (v) => arr(v).map((x) => ({ fase: str(x?.fase, 40), obiettivo: str(x?.obiettivo, 400), azioni: arr(x?.azioni).map((s) => str(s, 400)), scadenza: str(x?.scadenza, 80), indicatore: str(x?.indicatore, 200) }));
function normalizeSede(r) {
  const score = num(r?.livello_allineamento, 0);
  return { livello_allineamento: score, livello_lettera: levelLetter(score), giudizio: str(r?.giudizio) || '', dati_sufficienti: r?.dati_sufficienti !== false,
    aree: arr(r?.aree).map((a) => ({ area: str(a?.area, 120) || '', livello: num(a?.livello), punti_di_forza: arr(a?.punti_di_forza).map((s) => str(s, 400)), criticita: arr(a?.criticita).map((s) => str(s, 400)), azioni: azioni(a?.azioni) })),
    piano_miglioramento: piano(r?.piano_miglioramento), trend: str(r?.trend, 1500), note_terze_parti: str(r?.note_terze_parti, 1500) };
}

// Sintesi simulata per il collaudo: media pesata dei punteggi reali (ultimi audit pesano di più), aree dalle sezioni, azioni dalle voci negative
function mockSede(site, audits, sections, template) {
  const scored = audits.filter((a) => a.effective_score != null);
  const wsum = scored.reduce((s, a, i) => s + (i + 1), 0);
  const score = scored.length ? Math.round((scored.reduce((s, a, i) => s + a.effective_score * (i + 1), 0) / wsum) * 10) / 10 : 0;
  const terzi = audits.filter((a) => a.kind === 'TERZI');
  const malus = terzi.filter((a) => a.third_party?.esito === 'NON_CONFORME').length * 5 + terzi.filter((a) => a.third_party?.esito === 'CONFORME_CON_RILIEVI').length * 2;
  const finale = Math.max(0, Math.round((score - malus) * 10) / 10);
  const bySec = {};
  for (const a of scored) for (const [k, s] of Object.entries(a.score_by_section || {})) { const v = a.score_source === 'VERIFICA' && s.score_verifier != null ? s.score_verifier : s.score; if (v == null) continue; (bySec[k] = bySec[k] || { t: s.title, v: [] }).v.push(v); }
  const aree = sections.map((sec) => {
    const b = bySec[sec.key]; const lv = b && b.v.length ? Math.round((b.v.reduce((x, y) => x + y, 0) / b.v.length) * 10) / 10 : null;
    const last = scored[scored.length - 1];
    const col = last ? (last.score_source === 'VERIFICA' ? last.verifier_answers : last.answers) : {};
    const neg = Object.entries(col || {}).filter(([k, v]) => v && ['NO', 'NC'].includes(v.v) && itemsOfSection(template?.body, sec.key).includes(k));
    return { area: sec.title, livello: lv, punti_di_forza: lv != null && lv >= 90 ? ['Tutte le voci verificate risultano conformi nell\'ultimo audit'] : (lv != null ? ['Sezione valutata con regolarità'] : []), criticita: neg.map(([k, v]) => `Voce ${k}: ${v.v}${v.note ? ` (${v.note})` : ''}`),
      azioni: neg.slice(0, 3).map(([k, v]) => ({ descrizione: `Ripristinare la conformità della voce ${k}${v.note ? `: ${v.note}` : ''}`, urgenza: v.v === 'NC' ? 'ALTA' : (lv != null && lv < 75 ? 'MEDIA' : 'BASSA'), responsabile_suggerito: 'Site manager', entro_giorni: v.v === 'NC' ? 15 : 45 })) };
  });
  const ncs = audits.flatMap((a) => (a.ncs || []).filter((n) => n && n.descrizione));
  return normalizeSede({
    livello_allineamento: finale,
    giudizio: `[Sintesi simulata, senza chiave Anthropic] La sede ${site.name} presenta un livello di allineamento al SGI del ${finale}% calcolato su ${scored.length} audit con punteggio${terzi.length ? ` e ${terzi.length} rapporti di terze parti` : ''} negli ultimi 12 mesi. ${ncs.length ? `Sono registrate ${ncs.length} non conformità con azioni correttive da seguire.` : 'Nessuna non conformità registrata nei report.'} ${scored.length < 2 ? 'I dati sono pochi: il giudizio va letto con cautela e confermato da Qualità.' : ''}`.trim(),
    dati_sufficienti: scored.length >= 2,
    aree,
    piano_miglioramento: [
      { fase: '1', obiettivo: 'Chiudere le non conformità aperte', azioni: ncs.slice(0, 5).map((n) => n.azione_correttiva || n.descrizione), scadenza: '30 giorni', indicatore: 'NC chiuse / NC aperte' },
      { fase: '2', obiettivo: 'Portare le aree sotto il 75% almeno al livello B', azioni: aree.filter((a) => a.livello != null && a.livello < 75).map((a) => `Piano d'area: ${a.area}`), scadenza: '90 giorni', indicatore: 'Punteggio di sezione nel prossimo auto-audit' },
      { fase: '3', obiettivo: 'Consolidare il livello A', azioni: ['Auto-audit mensile puntuale entro il giorno di alert', 'Verifica di Qualità con scostamento sede/verificatore sotto i 5 punti'], scadenza: '6 mesi', indicatore: 'Livello di allineamento della sede' },
    ],
    trend: scored.length > 1 ? `Dal ${scored[0].effective_score}% al ${scored[scored.length - 1].effective_score}% tra il primo e l'ultimo audit del periodo.` : null,
    note_terze_parti: terzi.length ? terzi.map((a) => `${a.third_party?.ente_tipo || 'Ente'} ${a.third_party?.ente || ''}: esito ${a.third_party?.esito || 'n.d.'}`).join('; ') : null,
  });
}
function itemsOfSection(templateBody, secKey) {
  if (!templateBody) return [];
  for (const p of templateBody.parts || []) for (const s of p.sections || []) if (s.key === secKey) return (s.items || []).flatMap((it) => (it.sub?.length ? it.sub.map((x) => x.key) : [String(it.n).replace(/\s+/g, '')]));
  return [];
}

// ---- (b) TD complessivo
const TD_FORMAT = `{"livello_allineamento": 0-100, "livello_lettera": "A|B|C|D", "giudizio": "testo", "dati_sufficienti": true|false,
 "classifica": [{"sede": "nome", "livello": 0-100, "lettera": "A|B|C|D", "nota": "..."}],
 "aree_deboli": [{"area": "...", "sedi_coinvolte": ["..."], "descrizione": "..."}],
 "azioni_trasversali": [{"descrizione": "...", "urgenza": "ALTA|MEDIA|BASSA", "responsabile_suggerito": "...", "entro_giorni": 30}],
 "piano_miglioramento": [{"fase": "1", "obiettivo": "...", "azioni": ["..."], "scadenza": "...", "indicatore": "..."}]}`;

export async function sintesiTD({ userId, moduleUserId } = {}) {
  requireAi();
  const sites = await many(`SELECT ${'s.id, s.name, s.kind, s.city'}, g.score AS sgi_score, g.level AS sgi_level, g.summary AS sgi_summary, g.computed_at FROM sites_v s LEFT JOIN public.site_sgi_scores g ON g.site_id=s.id WHERE s.active AND s.kind = ANY($1) ORDER BY s.sort_order, s.name`, [STRUCTURE_KINDS]);
  const rows = [];
  for (const s of sites) {
    const audits = await auditsForSite(s.id, { withText: false });
    if (!audits.length && s.sgi_score == null) continue;
    const scored = audits.filter((a) => a.effective_score != null);
    const avg = scored.length ? Math.round((scored.reduce((x, a) => x + a.effective_score, 0) / scored.length) * 10) / 10 : null;
    const weak = {};
    for (const a of scored) for (const [k, sec] of Object.entries(a.score_by_section || {})) { const v = a.score_source === 'VERIFICA' && sec.score_verifier != null ? sec.score_verifier : sec.score; if (v != null && v < 75) weak[sec.title || k] = (weak[sec.title || k] || 0) + 1; }
    rows.push({ site: s, audits, avg, weak, ncs: audits.reduce((n, a) => n + (a.n_nc || 0), 0), terzi: audits.filter((a) => a.kind === 'TERZI').map((a) => a.third_party?.esito).filter(Boolean) });
  }
  if (!rows.length) throw bad('Nessuna sede con audit o sintesi: non c\'è nulla da sintetizzare');
  const user = [
    `Rete Toscana Diagnostica: ${rows.length} sedi con dati negli ultimi 12 mesi.`,
    'Scala dei livelli: A 90-100, B 75-89, C 60-74, D 0-59.',
    rows.map((r) => `- ${r.site.name} (${r.site.kind}${r.site.city ? `, ${r.site.city}` : ''}): ${r.audits.length} audit, media dei punteggi ${r.avg ?? 'n.d.'}%${r.site.sgi_score != null ? `, ultima sintesi di sede ${r.site.sgi_score}% (${r.site.sgi_level})` : ''}, NC ${r.ncs}${Object.keys(r.weak).length ? `, sezioni sotto il 75%: ${Object.entries(r.weak).map(([k, n]) => `${k} (${n})`).join(', ')}` : ''}${r.terzi.length ? `, terze parti: ${r.terzi.join(', ')}` : ''}${r.site.sgi_summary ? `. Giudizio di sede: ${clip(r.site.sgi_summary, 300)}` : ''}`).join('\n'),
    `Produci il giudizio complessivo della rete con classifica delle sedi, aree deboli ricorrenti, azioni trasversali per urgenza e piano di miglioramento di rete. Formato JSON: ${TD_FORMAT}`,
  ].join('\n\n');
  const result = useMock() ? mockTD(rows) : normalizeTD(await askJson({ kind: 'audit_sintesi', system: SYSTEM, user, maxTokens: 4000, userId, query: `sintesi TD, ${rows.length} sedi` }));
  const row = await one(`INSERT INTO syntheses (scope, generated_by, model, inputs, result, score, level) VALUES ('TD',$1,$2,$3,$4,$5,$6) RETURNING id, generated_at`,
    [moduleUserId || null, useMock() ? 'mock' : appConfig.anthropic.model, JSON.stringify({ site_ids: rows.map((r) => r.site.id), audit_ids: rows.flatMap((r) => r.audits.map((a) => a.id)), mesi: 12 }), JSON.stringify(result), result.livello_allineamento, result.livello_lettera]);
  return { id: row.id, scope: 'TD', generated_at: row.generated_at, model: useMock() ? 'mock' : appConfig.anthropic.model, result, score: result.livello_allineamento, level: result.livello_lettera };
}
function normalizeTD(r) {
  const score = num(r?.livello_allineamento, 0);
  return { livello_allineamento: score, livello_lettera: levelLetter(score), giudizio: str(r?.giudizio) || '', dati_sufficienti: r?.dati_sufficienti !== false,
    classifica: arr(r?.classifica).map((x) => ({ sede: str(x?.sede, 120), livello: num(x?.livello), lettera: levelLetter(num(x?.livello)), nota: str(x?.nota, 400) })).sort((a, b) => (b.livello ?? -1) - (a.livello ?? -1)),
    aree_deboli: arr(r?.aree_deboli).map((x) => ({ area: str(x?.area, 120), sedi_coinvolte: arr(x?.sedi_coinvolte).map((s) => str(s, 120)), descrizione: str(x?.descrizione, 600) })),
    azioni_trasversali: azioni(r?.azioni_trasversali), piano_miglioramento: piano(r?.piano_miglioramento) };
}
function mockTD(rows) {
  const withScore = rows.map((r) => ({ ...r, lv: r.site.sgi_score != null ? Number(r.site.sgi_score) : r.avg })).filter((r) => r.lv != null);
  const score = withScore.length ? Math.round((withScore.reduce((s, r) => s + r.lv, 0) / withScore.length) * 10) / 10 : 0;
  const weakAll = {};
  for (const r of rows) for (const [k, n] of Object.entries(r.weak)) (weakAll[k] = weakAll[k] || []).push(r.site.name);
  return normalizeTD({
    livello_allineamento: score,
    giudizio: `[Sintesi simulata, senza chiave Anthropic] La rete presenta un allineamento medio del ${score}% su ${withScore.length} sedi con dati. ${withScore.filter((r) => r.lv < 60).length ? `${withScore.filter((r) => r.lv < 60).length} sedi in area critica.` : 'Nessuna sede in area critica.'}`,
    dati_sufficienti: withScore.length >= 2,
    classifica: withScore.map((r) => ({ sede: r.site.name, livello: r.lv, nota: `${r.audits.length} audit, ${r.ncs} NC` })),
    aree_deboli: Object.entries(weakAll).map(([k, sedi]) => ({ area: k, sedi_coinvolte: sedi, descrizione: `Sezione sotto il 75% in ${sedi.length} sedi` })),
    azioni_trasversali: Object.keys(weakAll).slice(0, 5).map((k) => ({ descrizione: `Piano di rete sull'area "${k}": istruzione operativa e verifica nel prossimo auto-audit`, urgenza: weakAll[k].length > 1 ? 'ALTA' : 'MEDIA', responsabile_suggerito: 'Qualità', entro_giorni: 60 })),
    piano_miglioramento: [{ fase: '1', obiettivo: 'Portare tutte le sedi almeno al livello B', azioni: ['Verifica degli auto-audit entro 10 giorni dall\'invio', 'Audit interno nelle sedi sotto il 75%'], scadenza: '6 mesi', indicatore: 'Sedi con livello A o B / sedi totali' }],
  });
}

// ---- (c) Legal entity (singola e complessiva)
const LE_FORMAT = `{"livello_conformita": 0-100, "livello_lettera": "A|B|C|D", "rischio_residuo": "BASSO|MEDIO|ALTO", "giudizio": "testo", "dati_sufficienti": true|false,
 "aree": [{"area": "nome della sezione", "livello": 0-100, "criticita": ["..."], "azioni": [{"descrizione": "...", "urgenza": "ALTA|MEDIA|BASSA", "responsabile_suggerito": "...", "entro_giorni": 30}]}],
 "azioni": [{"descrizione": "...", "urgenza": "ALTA|MEDIA|BASSA", "responsabile_suggerito": "...", "entro_giorni": 30}],
 "classifica": [{"partner": "nome", "livello": 0-100, "rischio": "BASSO|MEDIO|ALTO", "nota": "..."}]}`;

async function auditsForOrg(orgId) {
  const rows = await many(`SELECT ${A_COLS}, a.answers FROM ${A_FROM} WHERE a.deleted_at IS NULL AND a.kind='LEGAL_ENTITY' AND a.organization_id=$1 AND a.status IN ('BOZZA','CHIUSO')
    AND coalesce(a.conducted_at, a.created_at) >= now() - interval '24 months' ORDER BY coalesce(a.conducted_at, a.created_at)`, [orgId]);
  return rows.map(decorate);
}
function describeLE(a, template) {
  const h = a.header || {}; const r = a.report || {};
  const items = template ? itemsIndex(template) : {};
  const neg = Object.entries(a.answers || {}).filter(([, v]) => v && ['NO', 'NC'].includes(v.v)).map(([k, v]) => `${k} ${items[k] || ''} = ${v.v}${v.note ? ` (${v.note})` : ''}${v.risk ? ` rischio ${v.risk}` : ''}`);
  const sec = Object.entries(a.score_by_section || {}).map(([k, s]) => `${s.title || k}: ${s.score ?? 'n.d.'}%${s.nc ? ` (NC ${s.nc})` : ''}`).join('; ');
  return [`- [${a.id}] Audit ISO 37001 del ${a.conducted_at ? new Date(a.conducted_at).toLocaleDateString('it-IT') : 'n.d.'} (stato ${a.status}), relazione ${h.relazione || 'n.d.'}, rischio iniziale ${h.livello_rischio_iniziale || 'n.d.'}, rischio finale ${r.livello_rischio_finale || 'n.d.'}, esito ${r.esito || 'n.d.'}, punteggio ${a.score ?? 'n.d.'}% (${lvlLabel(a.score)}).`,
    sec ? `  Sezioni: ${sec}` : null, neg.length ? `  Voci negative: ${neg.join('; ')}` : null,
    (a.ncs || []).filter((n) => n && n.descrizione).length ? `  Criticità: ${(a.ncs || []).filter((n) => n && n.descrizione).map((n) => `${n.descrizione}${n.azione_correttiva ? ` → ${n.azione_correttiva}` : ''}`).join('; ')}` : null,
    a.observations ? `  Osservazioni: ${clip(a.observations, 800)}` : null].filter(Boolean).join('\n');
}
export async function sintesiLegalEntity(orgId, { userId, moduleUserId } = {}) {
  requireAi();
  const org = await orgById(orgId);
  const audits = await auditsForOrg(orgId);
  if (!audits.length) throw bad('Nessun audit ISO 37001 per questo partner');
  const template = await one(`SELECT body FROM templates WHERE kind='LEGAL_ENTITY' AND active ORDER BY id DESC LIMIT 1`);
  const sections = template ? sectionsOf(template.body) : [];
  const user = [
    `Partner (Legal entity): ${org.name} (${org.kind}${org.city ? `, ${org.city}` : ''}).`,
    `Aree del modello ISO 37001 (usa questi nomi nel campo "area"): ${sections.map((s) => s.title).join('; ')}.`,
    'Scala: A 90-100, B 75-89, C 60-74, D 0-59; il rischio residuo tiene conto anche del rischio finale indicato dall\'auditor.',
    `Audit (${audits.length}):\n${audits.map((a) => describeLE(a, template)).join('\n')}`,
    `Produci il livello di conformità del partner, il rischio corruzione residuo e le azioni per urgenza (anche per area). Formato JSON: ${LE_FORMAT} (il campo classifica può restare vuoto).`,
  ].join('\n\n');
  const result = useMock() ? mockLE([{ org, audits }], sections, template) : normalizeLE(await askJson({ kind: 'audit_sintesi', system: SYSTEM, user, maxTokens: 4000, userId, query: `sintesi partner ${orgId}, ${audits.length} audit` }));
  const row = await one(`INSERT INTO syntheses (scope, organization_id, generated_by, model, inputs, result, score, level) VALUES ('LEGAL_ENTITY',$1,$2,$3,$4,$5,$6,$7) RETURNING id, generated_at`,
    [orgId, moduleUserId || null, useMock() ? 'mock' : appConfig.anthropic.model, JSON.stringify({ audit_ids: audits.map((a) => a.id) }), JSON.stringify(result), result.livello_conformita, result.livello_lettera]);
  return { id: row.id, scope: 'LEGAL_ENTITY', organization_id: orgId, generated_at: row.generated_at, model: useMock() ? 'mock' : appConfig.anthropic.model, result, score: result.livello_conformita, level: result.livello_lettera };
}
export async function sintesiLegalEntities({ userId, moduleUserId } = {}) {
  requireAi();
  const orgs = await many(`SELECT DISTINCT o.id, o.kind, o.name, o.city FROM public.organizations o JOIN audits a ON a.organization_id=o.id AND a.kind='LEGAL_ENTITY' AND a.deleted_at IS NULL WHERE NOT (o.kind = ANY($1)) ORDER BY o.name`, [INTERNAL_ORG_KINDS]);
  if (!orgs.length) throw bad('Nessun partner auditato');
  const template = await one(`SELECT body FROM templates WHERE kind='LEGAL_ENTITY' AND active ORDER BY id DESC LIMIT 1`);
  const sections = template ? sectionsOf(template.body) : [];
  const groups = [];
  for (const org of orgs) groups.push({ org, audits: await auditsForOrg(org.id) });
  const user = [
    `Partner auditati secondo la checklist ISO 37001 di Toscana Diagnostica: ${groups.length}.`,
    'Scala: A 90-100, B 75-89, C 60-74, D 0-59.',
    groups.map((g) => `Partner ${g.org.name} (${g.org.kind}):\n${g.audits.map((a) => describeLE(a, template)).join('\n')}`).join('\n\n'),
    `Produci il giudizio complessivo sui partner: livello di conformità medio, rischio corruzione residuo complessivo, classifica dei partner, azioni per urgenza. Formato JSON: ${LE_FORMAT}`,
  ].join('\n\n');
  const result = useMock() ? mockLE(groups, sections, template) : normalizeLE(await askJson({ kind: 'audit_sintesi', system: SYSTEM, user, maxTokens: 4000, userId, query: `sintesi partner complessiva, ${groups.length} partner` }));
  const row = await one(`INSERT INTO syntheses (scope, generated_by, model, inputs, result, score, level) VALUES ('LEGAL_ENTITIES',$1,$2,$3,$4,$5,$6) RETURNING id, generated_at`,
    [moduleUserId || null, useMock() ? 'mock' : appConfig.anthropic.model, JSON.stringify({ organization_ids: orgs.map((o) => o.id), audit_ids: groups.flatMap((g) => g.audits.map((a) => a.id)) }), JSON.stringify(result), result.livello_conformita, result.livello_lettera]);
  return { id: row.id, scope: 'LEGAL_ENTITIES', generated_at: row.generated_at, model: useMock() ? 'mock' : appConfig.anthropic.model, result, score: result.livello_conformita, level: result.livello_lettera };
}
const RISK = ['BASSO', 'MEDIO', 'ALTO'];
function normalizeLE(r) {
  const score = num(r?.livello_conformita, 0);
  return { livello_conformita: score, livello_lettera: levelLetter(score), rischio_residuo: RISK.includes(r?.rischio_residuo) ? r.rischio_residuo : 'MEDIO', giudizio: str(r?.giudizio) || '', dati_sufficienti: r?.dati_sufficienti !== false,
    aree: arr(r?.aree).map((a) => ({ area: str(a?.area, 120) || '', livello: num(a?.livello), criticita: arr(a?.criticita).map((s) => str(s, 400)), azioni: azioni(a?.azioni) })),
    azioni: azioni(r?.azioni), classifica: arr(r?.classifica).map((x) => ({ partner: str(x?.partner, 120), livello: num(x?.livello), rischio: RISK.includes(x?.rischio) ? x.rischio : null, nota: str(x?.nota, 400) })) };
}
function mockLE(groups, sections, template) {
  const per = groups.map((g) => { const last = g.audits[g.audits.length - 1]; return { org: g.org, lv: last?.score == null ? null : Number(last.score), risk: last?.report?.livello_rischio_finale || last?.header?.livello_rischio_iniziale || 'MEDIO', last }; }).filter((x) => x.lv != null);
  const score = per.length ? Math.round((per.reduce((s, x) => s + x.lv, 0) / per.length) * 10) / 10 : 0;
  const worst = RISK[Math.max(0, ...per.map((x) => RISK.indexOf(x.risk)))] || 'MEDIO';
  const last = per[0]?.last;
  const aree = sections.map((sec) => { const s = last?.score_by_section?.[sec.key]; const neg = Object.entries(last?.answers || {}).filter(([k, v]) => v && ['NO', 'NC'].includes(v.v) && itemsOfSection(template?.body, sec.key).includes(k));
    return { area: sec.title, livello: s?.score ?? null, criticita: neg.map(([k, v]) => `Voce ${k}: ${v.v}${v.note ? ` (${v.note})` : ''}`), azioni: neg.slice(0, 2).map(([k, v]) => ({ descrizione: `Richiedere al partner evidenza sulla voce ${k}`, urgenza: v.v === 'NC' ? 'ALTA' : 'MEDIA', responsabile_suggerito: 'Qualità / Funzione di conformità', entro_giorni: 30 })) }; });
  return normalizeLE({
    livello_conformita: score, rischio_residuo: worst,
    giudizio: `[Sintesi simulata, senza chiave Anthropic] ${groups.length === 1 ? `Il partner ${groups[0].org.name}` : `I ${groups.length} partner auditati`} presenta${groups.length === 1 ? '' : 'no'} un livello di conformità ISO 37001 del ${score}% con rischio corruzione residuo ${worst}. ${per.length < 2 ? 'I dati sono pochi: giudizio da confermare da Qualità.' : ''}`.trim(),
    dati_sufficienti: per.length >= 2, aree,
    azioni: aree.flatMap((a) => a.azioni).slice(0, 6).concat(worst === 'ALTO' ? [{ descrizione: 'Ripetere la due diligence entro 12 mesi (rischio alto)', urgenza: 'ALTA', responsabile_suggerito: 'Funzione di conformità', entro_giorni: 365 }] : []),
    classifica: per.map((x) => ({ partner: x.org.name, livello: x.lv, rischio: x.risk, nota: `${groups.find((g) => g.org.id === x.org.id)?.audits.length || 0} audit` })),
  });
}

// ---- Letture
export async function ultimaSintesi(scope, { site_id = null, organization_id = null } = {}) {
  const params = [scope]; let w = 'scope=$1';
  if (site_id) { params.push(site_id); w += ` AND site_id=$${params.length}`; }
  if (organization_id) { params.push(organization_id); w += ` AND organization_id=$${params.length}`; }
  return one(`SELECT sy.*, u.full_name AS generated_by_name FROM syntheses sy LEFT JOIN users u ON u.id=sy.generated_by WHERE ${w} ORDER BY generated_at DESC, id DESC LIMIT 1`, params);
}
export const aiState = () => ({ enabled: aiEnabled(), mock: useMock(), message: aiEnabled() ? null : (config.aiMock ? 'Sintesi simulata (AUDIT_AI_MOCK=1): testi standard costruiti dai punteggi reali' : AI_NOT_CONFIGURED) });

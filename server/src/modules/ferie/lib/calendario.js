// Calendario del Piano Ferie: festivi nazionali italiani, Pasquetta, patrono della sede, settimana lavorativa della persona e
// conteggio dei giorni lavorativi di un periodo con le mezze giornate. Funzioni pure (nessun database): testate in server/test.
// Le date sono stringhe ISO 'AAAA-MM-GG' e i calcoli avvengono in UTC, così l'ora legale non sposta mai un giorno.

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const parseIso = (s) => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return isoDate(d) === `${m[1]}-${m[2]}-${m[3]}` ? d : null;   // scarta 2026-02-31 e simili
};
export const addDays = (s, n) => { const d = parseIso(s); d.setUTCDate(d.getUTCDate() + n); return isoDate(d); };
/** Giorno della settimana ISO: 1 = lunedì ... 7 = domenica */
export const isoWeekday = (s) => { const g = parseIso(s).getUTCDay(); return g === 0 ? 7 : g; };
/** Elenco delle date da inizio a fine compresi */
export function giorniTra(inizio, fine) {
  const out = [];
  if (!parseIso(inizio) || !parseIso(fine) || fine < inizio) return out;
  for (let d = inizio; d <= fine; d = addDays(d, 1)) { out.push(d); if (out.length > 800) break; }
  return out;
}
/** Settimana ISO (anno e numero) di una data, per la vista annuale del piano */
export function settimanaIso(s) {
  const d = parseIso(s);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const wd = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - wd);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { anno: t.getUTCFullYear(), settimana: Math.ceil(((t - y0) / 86400000 + 1) / 7) };
}

/** Domenica di Pasqua (calendario gregoriano, algoritmo anonimo di Meeus/Jones/Butcher) */
export function pasqua(anno) {
  const a = anno % 19, b = Math.floor(anno / 100), c = anno % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mese = Math.floor((h + l - 7 * m + 114) / 31), giorno = ((h + l - 7 * m + 114) % 31) + 1;
  return `${anno}-${pad(mese)}-${pad(giorno)}`;
}

/**
 * Festività nazionali italiane (L. 260/1949 e successive): Capodanno, Epifania, Lunedì dell'Angelo, Liberazione, Festa del lavoro,
 * Festa della Repubblica, Assunzione, Ognissanti, Immacolata, Natale, Santo Stefano. Dal 2026 anche il 4 ottobre (San Francesco
 * d'Assisi e Santa Caterina da Siena, festa nazionale ripristinata dalla legge del 2025): disattivabile da Impostazioni
 * (`festa_4_ottobre`) se il consulente del lavoro indica diversamente. Le domeniche non sono elencate: le esclude la settimana.
 */
export function festiviNazionali(anno, { quattroOttobre = true } = {}) {
  const lunPasqua = addDays(pasqua(anno), 1);
  const f = [
    [`${anno}-01-01`, 'Capodanno'], [`${anno}-01-06`, 'Epifania'], [lunPasqua, 'Lunedì dell\'Angelo'], [`${anno}-04-25`, 'Festa della Liberazione'],
    [`${anno}-05-01`, 'Festa del lavoro'], [`${anno}-06-02`, 'Festa della Repubblica'], [`${anno}-08-15`, 'Assunzione'], [`${anno}-11-01`, 'Ognissanti'],
    [`${anno}-12-08`, 'Immacolata Concezione'], [`${anno}-12-25`, 'Natale'], [`${anno}-12-26`, 'Santo Stefano'],
  ];
  if (quattroOttobre && anno >= 2026) f.push([`${anno}-10-04`, 'San Francesco d\'Assisi e Santa Caterina da Siena']);
  return f.map(([data, nome]) => ({ data, nome })).sort((a, b) => a.data.localeCompare(b.data));
}

/**
 * Festivi che valgono per una persona: nazionali + patrono della sede (MM-GG) + festivi aggiunti da HR (date ISO) − date escluse da HR.
 * Ritorna una Map data → nome.
 */
export function festiviPer(anni, { patrono = null, aggiunti = [], esclusi = [], quattroOttobre = true } = {}) {
  const out = new Map();
  for (const anno of [...new Set(anni)]) {
    for (const f of festiviNazionali(anno, { quattroOttobre })) out.set(f.data, f.nome);
    if (patrono?.giorno && /^\d{2}-\d{2}$/.test(patrono.giorno) && parseIso(`${anno}-${patrono.giorno}`)) out.set(`${anno}-${patrono.giorno}`, patrono.santo ? `Patrono: ${patrono.santo}` : 'Santo patrono');
  }
  for (const a of aggiunti || []) if (a?.data && parseIso(a.data)) out.set(a.data, a.nome || 'Festivo aziendale');
  for (const e of esclusi || []) out.delete(typeof e === 'string' ? e : e?.data);
  return out;
}

/**
 * Settimana lavorativa dal contratto (contracts.employments): weekly_days 6 o days_label con "sabato" → lunedì-sabato; altrimenti
 * lunedì-venerdì (anche senza contratto, ipotesi del brief). Ritorna i giorni ISO lavorati (1 = lunedì).
 */
export function settimanaDaContratto(emp) {
  const label = String(emp?.days_label || '').toLowerCase();
  const giorni = Number(emp?.weekly_days || 0);
  if (giorni >= 6 || /sabato/.test(label)) return { giorni: [1, 2, 3, 4, 5, 6], fonte: emp ? 'contratto' : 'predefinita', etichetta: 'lunedì-sabato' };
  return { giorni: [1, 2, 3, 4, 5], fonte: emp && (giorni || label) ? 'contratto' : 'predefinita', etichetta: 'lunedì-venerdì' };
}

/** La data è un giorno lavorativo per la persona? */
export const lavorativo = (data, settimana, festivi) => settimana.includes(isoWeekday(data)) && !(festivi && festivi.has(data));

/**
 * Giorni lavorativi di un periodo con le mezze giornate: mezza_inizio = il primo giorno solo il pomeriggio, mezza_fine = l'ultimo
 * giorno solo la mattina. Un periodo di un giorno con una delle due vale mezza giornata; con entrambe non è valido.
 * Ritorna { giorni, dettaglio: [{ data, quota, festivo? }], errore? }.
 */
export function contaGiorni({ inizio, fine, mezza_inizio = false, mezza_fine = false }, { settimana = [1, 2, 3, 4, 5], festivi = new Map() } = {}) {
  if (!parseIso(inizio) || !parseIso(fine)) return { giorni: 0, dettaglio: [], errore: 'Date non valide' };
  if (fine < inizio) return { giorni: 0, dettaglio: [], errore: 'La data di fine precede quella di inizio' };
  if (inizio === fine && mezza_inizio && mezza_fine) return { giorni: 0, dettaglio: [], errore: 'Un solo giorno: indica la mattina o il pomeriggio, non entrambi' };
  const giorni = giorniTra(inizio, fine);
  if (giorni.length > 366) return { giorni: 0, dettaglio: [], errore: 'Periodo troppo lungo (oltre un anno)' };
  const dettaglio = [];
  let tot = 0;
  for (const d of giorni) {
    if (!lavorativo(d, settimana, festivi)) { if (festivi.has(d) && settimana.includes(isoWeekday(d))) dettaglio.push({ data: d, quota: 0, festivo: festivi.get(d) }); continue; }
    let quota = 1;
    if (d === inizio && mezza_inizio) quota = 0.5;
    if (d === fine && mezza_fine) quota = 0.5;
    dettaglio.push({ data: d, quota });
    tot += quota;
  }
  return { giorni: tot, dettaglio };
}

/** Quota di assenza di una richiesta in una data (0, 0.5, 1) per la griglia del piano e per la copertura */
export function quotaInData(r, data) {
  const ini = String(r.data_inizio).slice(0, 10), fin = String(r.data_fine).slice(0, 10);
  if (data < ini || data > fin) return 0;
  if (data === ini && r.mezza_inizio) return 0.5;
  if (data === fin && r.mezza_fine) return 0.5;
  return 1;
}

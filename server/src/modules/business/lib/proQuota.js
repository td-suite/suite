// Business Hub · pro quota del fatturato FY atteso dichiarato nella scheda account (regole pure, senza database). Le usano la scheda
// account e la correlazione con Synclab (lib/synclabAccount.js, v0.68.1) e, dalla v0.68.4, Finance Management per le stime commerciali
// del conto economico e del margine per cliente Service (finance/lib/contoEconomico.js): una sola regola del pro quota in tutta la Suite.
//   pro quota = fatturato_fy_atteso × giorni lavorativi (lun-ven, festivi esclusi solo come approssimazione dichiarata) dall'avvio /
//   giorni lavorativi dell'anno (impostazione hub_giorni_lavorativi, 250), come volumiGiornalieri e ribaltaDaAvvio di lib/processo.js.
// Test: server/test/v0681-correlazioni.test.mjs e server/test/v0684-stime-room.test.mjs.
const iso = (d) => d.toISOString().slice(0, 10);
const giorno = (v) => (v == null || v === '' ? null : (v instanceof Date ? iso(v) : String(v).slice(0, 10)));
const r2 = (n) => (n == null ? null : Math.round((Number(n) + Number.EPSILON) * 100) / 100);
const gg = (d) => String(d).split('-').reverse().join('/');

/** Giorni lavorativi (lunedì-venerdì, festivi non considerati: approssimazione dichiarata) fra da e a compresi. */
export function giorniLavorativi(da, a) {
  const s = Date.parse(`${giorno(da)}T00:00:00Z`), e = Date.parse(`${giorno(a)}T00:00:00Z`);
  if (!(e >= s)) return 0;
  let n = 0;
  for (let t = s; t <= e; t += 86400000) { const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}

/** Data di avvio dell'account: effettiva, prevista, cliente attivo dal (la prima che c'è). */
export const dataAvvio = (a = {}) => giorno(a.data_avvio_effettiva) || giorno(a.data_avvio_prevista) || giorno(a.data_avvio) || giorno(a.attivo_dal) || null;

/**
 * Pro quota del fatturato dichiarato maturato a oggi nell'anno di oggi.
 * { anno, inizio, avvio, giorni, giorni_anno, quota, importo, nota } oppure null senza fatturato dichiarato.
 */
export function proQuota({ fatturato_fy_atteso: fy, avvio = null, oggi, giorniAnno = 250 }) {
  if (fy == null || !(Number(fy) > 0)) return null;
  const anno = Number(String(oggi).slice(0, 4));
  const gl = Number(giorniAnno) > 0 ? Number(giorniAnno) : 250;
  const inizioAnno = `${anno}-01-01`;
  const av = giorno(avvio);
  if (av && av > oggi) return { anno, inizio: av, avvio: av, giorni: 0, giorni_anno: gl, quota: 0, importo: 0, nota: `Avvio previsto il ${av.split('-').reverse().join('/')}: nessun pro quota maturato` };
  const inizio = av && av > inizioAnno ? av : inizioAnno;
  const giorni = giorniLavorativi(inizio, oggi);
  const quota = Math.min(1, giorni / gl);
  return { anno, inizio, avvio: av, giorni, giorni_anno: gl, quota: Math.round(quota * 10000) / 10000, importo: r2(Number(fy) * quota),
    nota: `${giorni} giorni lavorativi dal ${inizio.split('-').reverse().join('/')}${av && av <= inizioAnno ? ' (avvio precedente: dal 1° gennaio)' : !av ? ' (data di avvio non indicata: dal 1° gennaio)' : ''} su ${gl}` };
}

/**
 * Pro quota del fatturato FY atteso su un periodo qualunque (un mese, l'anno fino a oggi) per un cliente: giorni lavorativi del periodo
 * successivi alla data di avvio e non successivi a oggi, sul totale dei giorni lavorativi dell'anno. giorniUsati: giorni lavorativi già
 * contati per lo stesso cliente nello stesso anno (per non superare mai il fatturato FY atteso pieno sommando i mesi).
 * { inizio, fine, giorni, giorni_anno, quota, importo, nota } oppure null senza fatturato dichiarato.
 */
export function proQuotaPeriodo({ fatturato_fy_atteso: fy, avvio = null, da, a, oggi = null, giorniAnno = 250, giorniUsati = 0 }) {
  if (fy == null || !(Number(fy) > 0)) return null;
  const gl = Number(giorniAnno) > 0 ? Number(giorniAnno) : 250;
  const av = giorno(avvio);
  const inizio = av && av > giorno(da) ? av : giorno(da);
  const fine = oggi && giorno(oggi) < giorno(a) ? giorno(oggi) : giorno(a);
  const lordi = fine >= inizio ? giorniLavorativi(inizio, fine) : 0;
  const giorni = Math.max(0, Math.min(lordi, gl - Number(giorniUsati || 0)));
  const quota = giorni / gl;
  const nota = !lordi ? (av && av > fine ? `avvio il ${gg(av)}: nessun giorno lavorativo dopo l'avvio nel periodo` : 'nessun giorno lavorativo nel periodo')
    : `${giorni} giorni lavorativi dal ${gg(inizio)} al ${gg(fine)} su ${gl}${!av ? ' (data di avvio non indicata)' : ''}${giorni < lordi ? ' (raggiunto il fatturato FY atteso pieno)' : ''}`;
  return { inizio, fine, giorni, giorni_anno: gl, quota: Math.round(quota * 10000) / 10000, importo: r2(Number(fy) * quota), nota };
}

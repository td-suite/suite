// Vista di rete: specialisti su tutte le sedi, simulatore di proposta, calendario reale. Codice puro (nessun DOM).
import { computePlan, medDisc, rangesM, intersectM, subtractM, sumM, t2m, m2t, roomExclusive, isPrelievi, DAYS, DAYS_S } from './engine.js';

export { DAYS, DAYS_S, m2t, t2m };

// Chiave di identità dello specialista tra sedi diverse: nome normalizzato (minuscolo, senza accenti, ordine delle parole indifferente)
export const personKey = (nome) => (nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean).sort().join(' ');
export const sedeLabel = (s) => (s.nomeSede ? `${s.denominazione} · ${s.nomeSede}` : s.denominazione || 'Sede senza nome');
const ATTIVITA = /^(punto prelievi|rm |rx|mammograf|tc\b|moc|opt|seminolog|anatomia patolog|medicina del lavoro)/i;
export const isAttivita = (p) => ATTIVITA.test((p.nome || '').trim());

// Costruisce la rete: piani per sede e indice degli specialisti (medici e professionisti sanitari)
export function buildNetwork(strutture) {
  const dup = {}; strutture.forEach((s) => { dup[s.denominazione] = (dup[s.denominazione] || 0) + 1; });
  const labelOf = (s) => (s.nomeSede || dup[s.denominazione] < 2 || !s.indirizzo ? sedeLabel(s) : `${s.denominazione} · ${String(s.indirizzo).split(',')[0].trim()}`);
  const sedi = strutture.map((s) => { let plan = null; try { plan = computePlan(s); } catch { plan = null; } return { s, plan, label: labelOf(s) }; });
  const spec = new Map();
  for (const { s, plan, label } of sedi) {
    for (const p of s.personale) {
      if (!p.nome?.trim() || !['medico', 'sanitario'].includes(p.tipo)) continue;
      const key = personKey(p.nome);
      if (!spec.has(key)) spec.set(key, { key, nome: p.nome.trim(), tipo: p.tipo, attivita: isAttivita(p), discipline: new Set(), profili: new Set(), attrezzature: new Set(), email: '', sedi: [], sessioni: [], dispBySede: {} });
      const x = spec.get(key);
      if (p.email && !x.email) x.email = p.email;
      medDisc(p).forEach((d) => x.discipline.add(d));
      if (p.profilo) x.profili.add(p.profilo);
      (p.attrezzature || []).forEach((a) => x.attrezzature.add(a));
      x.sedi.push({ sedeId: s.id, sede: label, persona: p, tipo: p.tipo });
      x.dispBySede[s.id] = p.disp || {};
      if (!plan) continue;
      for (const a of plan.assigns) {
        if (a.medId === p.id) x.sessioni.push({ sedeId: s.id, sede: label, d: a.d, s: a.s, e: a.e, room: plan.byId[a.roomId].nome, roomId: a.roomId, ruolo: 'titolare', disciplina: medDisc(p).join(', '), personaId: p.id, slots: a.slots, sanId: a.sanId, note: p.note || '' });
        if (a.sanId === p.id) x.sessioni.push({ sedeId: s.id, sede: label, d: a.d, s: a.s, e: a.e, room: plan.byId[a.roomId].nome, roomId: a.roomId, ruolo: 'supporto a ' + plan.byId[a.medId].nome, disciplina: medDisc(plan.byId[a.medId]).join(', '), personaId: p.id, medId: a.medId });
      }
      if (p.tipo === 'medico') for (const u of plan.unassigned) if (u.medId === p.id) x.sessioni.push({ sedeId: s.id, sede: label, d: u.d, s: u.s, e: u.e, room: null, ruolo: 'non allocata', reason: u.reason, personaId: p.id, disciplina: medDisc(p).join(', ') });
    }
  }
  const specialisti = [...spec.values()].map((x) => ({ ...x, discipline: [...x.discipline], profili: [...x.profili], attrezzature: [...x.attrezzature],
    ore: x.sessioni.filter((q) => q.room).reduce((t, q) => t + (q.e - q.s), 0), nSedi: new Set(x.sedi.map((z) => z.sedeId)).size,
    sessioni: x.sessioni.sort((a, b) => a.d - b.d || a.s - b.s) })).sort((a, b) => a.nome.localeCompare(b.nome, 'it'));
  return { sedi, specialisti, byKey: Object.fromEntries(specialisti.map((x) => [x.key, x])) };
}

// Fasce già impegnate dello specialista in un giorno della settimana (tutte le sedi)
const busyOn = (x, d) => x.sessioni.filter((q) => q.d === d && q.room).map((q) => [q.s, q.e]);

/* Simulatore: date le finestre di disponibilità aggiuntiva (per giorno: [{from,to}]), propone gli spazi liberi compatibili
   in tutte le sedi, senza mai togliere spazio alle attività già pianificate (si usano solo le fasce libere del piano). */
export function simulate(net, key, windows, opts = {}) {
  const x = net.byKey[key]; if (!x) return { proposte: [], totale: 0 };
  const minDur = opts.minDur || 60;
  const disc = x.discipline, eq = x.attrezzature;
  const proposte = [];
  for (const { s, plan, label } of net.sedi) {
    if (!plan) continue;
    if (opts.soloAltreSedi && x.sedi.some((z) => z.sedeId === s.id)) continue;
    for (const r of s.ambulatori) {
      if (r.soloVincolati) continue;
      if (!eq.every((e) => (r.attrezzature || []).includes(e))) continue;
      const dOK = !disc.length || !r.discipline.length || isPrelievi(r) || disc.some((q) => r.discipline.includes(q));
      if (!dOK && roomExclusive(r)) continue;
      for (let d = 0; d < 7; d++) {
        const win = windows === 'tutto' ? [[0, 1440]] : rangesM(windows[d]); if (!win.length) continue;
        const free = plan.free.filter((f) => f.roomId === r.id && f.d === d).map((f) => [f.s, f.e]);
        let cand = [];
        for (const w of win) for (const f of free) { const a = Math.max(w[0], f[0]), b = Math.min(w[1], f[1]); if (b - a >= minDur) cand.push([a, b]); }
        cand = subtractM(cand, busyOn(x, d)).filter(([a, b]) => b - a >= minDur);
        for (const [a, b] of cand) proposte.push({ sedeId: s.id, sede: label, indirizzo: s.indirizzo, roomId: r.id, room: r.nome, d, s: a, e: b, min: b - a, dedicato: r.discipline.length ? r.discipline.join(', ') : 'polivalente', attrezzature: r.attrezzature || [], giaPresente: x.sedi.some((z) => z.sedeId === s.id), prefDisc: dOK && r.discipline.length > 0 });
      }
    }
  }
  // per ogni sede/giorno/finestra tieni la stanza migliore (più lunga, poi dedicata alla disciplina, poi meno attrezzature)
  const best = new Map();
  for (const p of proposte) {
    const k = `${p.sedeId}|${p.d}|${p.s}`;
    const cur = best.get(k);
    const score = [p.min, p.prefDisc ? 1 : 0, -p.attrezzature.length];
    if (!cur || cmpArr(score, cur._score) > 0) best.set(k, { ...p, _score: score });
  }
  // scarta le proposte interamente contenute in una proposta più lunga della stessa sede e giorno
  const vals = [...best.values()];
  const kept = vals.filter((p) => !vals.some((q) => q !== p && q.sedeId === p.sedeId && q.d === p.d && q.s <= p.s && q.e >= p.e && q.min > p.min));
  const out = kept.sort((a, b) => a.sede.localeCompare(b.sede, 'it') || a.d - b.d || a.s - b.s);
  return { proposte: out, totale: out.reduce((t, p) => t + p.min, 0), perSede: Object.values(out.reduce((acc, p) => { (acc[p.sedeId] ||= { sedeId: p.sedeId, sede: p.sede, indirizzo: p.indirizzo, min: 0, n: 0 }); acc[p.sedeId].min += p.min; acc[p.sedeId].n++; return acc; }, {})).sort((a, b) => b.min - a.min) };
}
function cmpArr(a, b) { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }

// ---------- Calendario reale ----------
export const isoDate = (d) => d.toISOString().slice(0, 10);
export function mondayOf(iso) { const d = new Date(iso + 'T12:00:00Z'); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return isoDate(d); }
export function addDays(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoDate(d); }
export const itDate = (iso) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const inRange = (iso, e) => iso >= e.dal && iso <= e.al;

/* Agenda datata di una settimana: sessioni della settimana-tipo applicate alle date, con chiusure, assenze, sostituzioni e sessioni extra.
   Ritorna { giorni:[{d, iso, sessioni:[...], chiusure:[...]}], eventi } con sessioni {sedeId, sede, roomId, room, s, e, medId, nome, disciplina, stato:'ok'|'assente'|'sostituita'|'extra'|'chiusa', sostituto, evento} */
export function datedWeek(net, eventi, mondayISO, filter = {}) {
  const giorni = [];
  for (let d = 0; d < 7; d++) {
    const iso = addDays(mondayISO, d);
    const sessioni = [], chiusure = [];
    for (const { s, plan, label } of net.sedi) {
      if (filter.sedeId && s.id !== filter.sedeId) continue;
      if (!plan || !plan.open[d]) continue;
      const chiusa = eventi.find((e) => e.kind === 'CHIUSURA' && e.sede_id === s.id && inRange(iso, e));
      if (chiusa) chiusure.push({ sedeId: s.id, sede: label, evento: chiusa });
      for (const a of plan.assigns) {
        if (a.d !== d) continue;
        const m = plan.byId[a.medId];
        const key = personKey(m.nome);
        if (filter.key && key !== filter.key && !(a.sanId && personKey(plan.byId[a.sanId].nome) === filter.key)) continue;
        const base = { sedeId: s.id, sede: label, roomId: a.roomId, room: plan.byId[a.roomId].nome, s: a.s, e: a.e, medId: m.id, nome: m.nome, key, disciplina: medDisc(m).join(', '), san: a.sanId ? plan.byId[a.sanId].nome : null, slots: a.slots, iso, d };
        if (chiusa) { sessioni.push({ ...base, stato: 'chiusa', evento: chiusa }); continue; }
        const ass = eventi.find((e) => e.kind === 'ASSENZA' && e.persona_key === key && (!e.sede_id || e.sede_id === s.id) && inRange(iso, e));
        if (ass) sessioni.push({ ...base, stato: ass.sost_nome ? 'sostituita' : 'assente', sostituto: ass.sost_nome || null, evento: ass });
        else sessioni.push({ ...base, stato: 'ok' });
      }
      for (const e of eventi) {
        if (e.kind !== 'SESSIONE_EXTRA' || e.sede_id !== s.id || !inRange(iso, e)) continue;
        if (filter.key && e.persona_key !== filter.key) continue;
        const r = s.ambulatori.find((q) => q.id === e.room_id);
        sessioni.push({ sedeId: s.id, sede: label, roomId: e.room_id, room: r ? r.nome : 'ambulatorio', s: t2m(e.ora_da), e: t2m(e.ora_a), medId: e.persona_id, nome: e.persona_nome, key: e.persona_key, disciplina: '', stato: 'extra', evento: e, iso, d });
      }
    }
    sessioni.sort((a, b) => a.sede.localeCompare(b.sede, 'it') || a.s - b.s);
    giorni.push({ d, iso, sessioni, chiusure });
  }
  return { giorni, mondayISO, sundayISO: addDays(mondayISO, 6) };
}

// Sostituti possibili per una sessione: stessa disciplina, liberi in quella fascia (prima nella stessa sede, poi nelle altre)
export function suggestSubstitutes(net, sess) {
  const out = [];
  const want = new Set((sess.disciplina || '').split(', ').filter(Boolean));
  for (const x of net.specialisti) {
    if (x.key === sess.key || x.tipo !== 'medico' || x.attivita) continue;
    if (want.size && !x.discipline.some((q) => want.has(q))) continue;
    const busy = busyOn(x, sess.d);
    if (busy.some(([a, b]) => a < sess.e && b > sess.s)) continue;
    const inSede = x.sedi.find((z) => z.sedeId === sess.sedeId);
    const disp = inSede ? rangesM((inSede.persona.disp || {})[sess.d]) : [];
    const disponibile = disp.some(([a, b]) => a <= sess.s && b >= sess.e);
    out.push({ key: x.key, nome: x.nome, discipline: x.discipline, inSede: Boolean(inSede), personaId: inSede ? inSede.persona.id : null, disponibile, sedi: x.sedi.map((z) => z.sede) });
  }
  return out.sort((a, b) => (b.inSede - a.inSede) || (b.disponibile - a.disponibile) || a.nome.localeCompare(b.nome, 'it'));
}

// ---------- Confronto versioni ----------
export function diffStrutture(a, b) {
  const out = [];
  const scalar = (k) => ['denominazione', 'nomeSede', 'indirizzo', 'telefono', 'email', 'siteManager', 'deskCapacity', 'deskCapAM', 'deskCapPM', 'deskSplit', 'deskRatio', 'deskMax', 'note'].includes(k);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (scalar(k) && JSON.stringify(a[k] ?? '') !== JSON.stringify(b[k] ?? '')) out.push({ area: 'Anagrafica', voce: k, prima: a[k] ?? '', dopo: b[k] ?? '' });
  if (JSON.stringify(a.hours) !== JSON.stringify(b.hours)) out.push({ area: 'Anagrafica', voce: 'orari di apertura', prima: hoursTxt(a.hours), dopo: hoursTxt(b.hours) });
  diffList(out, 'Ambulatori', a.ambulatori || [], b.ambulatori || [], (r) => r.nome, roomTxt);
  diffList(out, 'Personale', a.personale || [], b.personale || [], (p) => `${p.nome} (${p.tipo})`, personTxt);
  if (JSON.stringify(a.plan?.markers || {}) !== JSON.stringify(b.plan?.markers || {})) out.push({ area: 'Planimetria', voce: 'posizione dei marcatori', prima: '…', dopo: 'modificata' });
  return out;
}
function diffList(out, area, A, B, label, txt) {
  const ma = new Map(A.map((x) => [x.id, x])), mb = new Map(B.map((x) => [x.id, x]));
  for (const [id, x] of ma) if (!mb.has(id)) out.push({ area, voce: label(x), prima: txt(x), dopo: '— eliminato —' });
  for (const [id, y] of mb) {
    const x = ma.get(id);
    if (!x) { out.push({ area, voce: label(y), prima: '— nuovo —', dopo: txt(y) }); continue; }
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (k === 'id') continue;
      const va = JSON.stringify(x[k] ?? null), vb = JSON.stringify(y[k] ?? null);
      if (va !== vb) out.push({ area, voce: `${label(y)} · ${k}`, prima: fmtVal(k, x[k]), dopo: fmtVal(k, y[k]) });
    }
  }
}
const hoursTxt = (h) => h ? Object.entries(h).map(([d, v]) => `${DAYS_S[d]} ${v.closed ? 'chiuso' : v.open + '-' + v.close}`).join(', ') : '';
const dispTxt = (disp) => disp ? Object.entries(disp).filter(([, v]) => v && v.length).map(([d, v]) => `${DAYS_S[d]} ${v.map((r) => r.from + '-' + r.to).join(',')}`).join('; ') : '';
const roomTxt = (r) => `${r.mq || '?'} mq · ${(r.discipline || []).join(', ') || 'polivalente'} · ${(r.attrezzature || []).join(', ') || 'nessuna attrezzatura'}`;
const personTxt = (p) => `${medDisc(p).join(', ') || p.profilo || ''} · ${dispTxt(p.disp)}`;
function fmtVal(k, v) {
  if (v == null || v === '') return '—';
  if (k === 'disp' || k === 'prelievi') return dispTxt(v);
  if (Array.isArray(v)) return v.join(', ') || '—';
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 'sì' : 'no';
  return String(v);
}

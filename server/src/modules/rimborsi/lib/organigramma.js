// Rimborso Spese · chi approva: il superiore diretto dell'organigramma (public.people_manager, "Dipende da" di Amministrazione > Persone),
// come nel Piano Ferie (CEO, 09/11/2026: "Segui pedissequamente quanto indicato in organigramma"). Regole (funzioni pure, testate):
//  - approva il superiore diretto; se è assente (cessato, senza accesso attivo alla Suite, in ferie oggi nel Piano Ferie) o non è un
//    dipendente (un libero professionista non entra nel modulo, riservato ai dipendenti) si sale al superiore successivo, e la scheda
//    dice perché;
//  - nessuno approva la propria nota (un ciclo nell'anagrafica non riporta mai alla persona);
//  - il vertice (nessuno sopra: il titolare) ha l'approvazione automatica all'invio (CEO, 13/11/2026: "La mia nota spese è
//    automaticamente approvata dopo la mia conferma", decisa nella route di invio); chi ha un superiore non raggiungibile va a P&C.
// `nodi`: Map id → { id, nome, manager_id, attivo, dipendente, user_id, in_ferie } (dipendente assente = true).

/** Approvatore di una persona: { approvatore_id, approvatore_nome, superiore_id, saltati: [{ id, nome, motivo }], al_pc, origine } */
export function approvatore(pid, nodi) {
  const io = nodi.get(pid) || null;
  const sup = io?.manager_id && io.manager_id !== pid ? io.manager_id : null;
  const base = { vertice: false, approvatore_id: null, approvatore_nome: null, approvatore_user_id: null, superiore_id: sup, superiore_nome: sup ? nodi.get(sup)?.nome || null : null, saltati: [], al_pc: false, origine: null };
  // vertice: nessun superiore in anagrafica. Il titolare (OWNER) che lo è ha l'approvazione automatica all'invio (CEO, 13/11/2026); un
  // dipendente senza superiore che non è il titolare è un'anomalia dell'anagrafica e va a P&C
  if (!sup) return { ...base, vertice: true, al_pc: true, origine: 'vertice dell\'organigramma (nessun superiore)' };
  const visti = new Set([pid]);
  let cur = sup;
  while (cur && !visti.has(cur) && visti.size < 30) {
    visti.add(cur);
    const n = nodi.get(cur);
    const motivo = !n || !n.attivo ? 'è cessato' : n.dipendente === false ? 'non è dipendente (non accede al Rimborso Spese)' : !n.user_id ? 'non ha accesso alla Suite' : n.in_ferie ? 'è assente (ferie oggi)' : null;
    if (!motivo) {
      return { ...base, approvatore_id: cur, approvatore_nome: n.nome, approvatore_user_id: n.user_id,
        origine: base.saltati.length ? `risale a ${n.nome}: ${base.saltati.map((s) => `${s.nome} ${s.motivo}`).join(', ')}` : 'superiore diretto in organigramma' };
    }
    base.saltati.push({ id: cur, nome: n?.nome || `persona ${cur}`, motivo });
    cur = n?.manager_id || null;
  }
  return { ...base, al_pc: true, origine: `nessun superiore raggiungibile (${base.saltati.map((s) => `${s.nome} ${s.motivo}`).join(', ') || 'catena interrotta'}): la nota va a P&C` };
}

/** Figli diretti secondo il superiore dell'anagrafica: Map manager_id → [id] */
export function figliDi(nodi) {
  const out = new Map();
  for (const n of nodi.values()) {
    if (!n.manager_id || n.manager_id === n.id) continue;
    if (!out.has(n.manager_id)) out.set(n.manager_id, []);
    out.get(n.manager_id).push(n.id);
  }
  return out;
}

/** Tutti i riporti (a ogni livello) di una persona, senza la persona; protetto dai cicli */
export function discendenti(rootId, nodi, figli = figliDi(nodi)) {
  const out = [];
  const visti = new Set([rootId]);
  const coda = [...(figli.get(rootId) || [])];
  while (coda.length) {
    const id = coda.shift();
    if (visti.has(id)) continue;
    visti.add(id); out.push(id);
    coda.push(...(figli.get(id) || []));
  }
  return out;
}

// Approvatore del piano ferie = il superiore diretto della persona nell'anagrafica (decisione del CEO, 09/11/2026: "Segui pedissequamente
// quanto indicato in organigramma. Segui quindi chi approva, come indicato in organigramma").
// Il superiore diretto è "Dipende da" di Amministrazione > Persone: public.people_manager(id), cioè people.manager_person_id quando è
// impostato a mano, altrimenti il responsabile calcolato dall'organigramma (afferenza e incarichi, org_positions.is_head), NULL per il
// vertice (people.no_manager). Il modulo lo LEGGE soltanto: nessuna tabella propria, nessuna copia dell'organigramma.
// Regole:
//  - approva il superiore diretto; se è cessato o non ha un accesso attivo alla Suite si risale al superiore del superiore (e così via),
//    e la scheda lo dice;
//  - chi non ha nessuno sopra è il vertice (l'Owner, il CEO): il suo piano non richiede approvazione;
//  - un dipendente senza superiore che non è il vertice è un'anomalia dell'anagrafica (Diagnostica D43): il piano non ha un approvatore
//    e lo può decidere solo l'amministratore.
// Funzioni pure (test in server/test/ferie.test.mjs): `nodi` è una Map id → { id, nome, manager_id, attivo, user_id, owner }.

/**
 * Approvatore effettivo di una persona. Ritorna { superiore_id, superiore_nome, approvatore_id, approvatore_nome, approvatore_user_id,
 * saltati: [{ id, nome, motivo }], senza_superiore, vertice, irraggiungibile, origine }.
 */
export function approvatoreDa(pid, nodi) {
  const io = nodi.get(pid) || null;
  const superiore = io?.manager_id && io.manager_id !== pid ? io.manager_id : null;
  const base = {
    superiore_id: superiore, superiore_nome: superiore ? nodi.get(superiore)?.nome || null : null,
    approvatore_id: null, approvatore_nome: null, approvatore_user_id: null, saltati: [],
    senza_superiore: !superiore, vertice: !superiore && Boolean(io?.owner), irraggiungibile: false, origine: null,
  };
  if (!superiore) {
    base.origine = base.vertice ? 'vertice dell\'organigramma: nessuna approvazione' : 'nessun superiore in anagrafica: decide l\'amministratore';
    return base;
  }
  const visti = new Set([pid]);
  let cur = superiore;
  while (cur && !visti.has(cur) && visti.size < 30) {
    visti.add(cur);
    const n = nodi.get(cur);
    if (n && n.attivo && n.user_id) {
      base.approvatore_id = cur; base.approvatore_nome = n.nome || null; base.approvatore_user_id = n.user_id;
      base.origine = base.saltati.length
        ? `risale a ${n.nome}: ${base.saltati.map((s) => `${s.nome} ${s.motivo}`).join(', ')}`
        : 'superiore diretto (anagrafica)';
      return base;
    }
    base.saltati.push({ id: cur, nome: n?.nome || `persona ${cur}`, motivo: !n || !n.attivo ? 'è cessato' : 'non ha accesso alla Suite' });
    cur = n?.manager_id || null;
  }
  base.irraggiungibile = true;
  base.origine = `nessun superiore attivo con accesso (${base.saltati.map((s) => `${s.nome} ${s.motivo}`).join(', ')}): decide l'amministratore`;
  return base;
}

/** Figli diretti di ogni nodo secondo il superiore dell'anagrafica: Map manager_id → [id] */
export function figliDi(nodi) {
  const out = new Map();
  for (const n of nodi.values()) {
    if (!n.manager_id || n.manager_id === n.id) continue;
    if (!out.has(n.manager_id)) out.set(n.manager_id, []);
    out.get(n.manager_id).push(n.id);
  }
  return out;
}

/** Tutti i riporti (diretti, diretti dei diretti, ...) di una persona, senza la persona; protetto dai cicli */
export function discendenti(rootId, nodi, figli = figliDi(nodi)) {
  const out = [];
  const visti = new Set([rootId]);
  const coda = [...(figli.get(rootId) || [])];
  while (coda.length) {
    const id = coda.shift();
    if (visti.has(id)) continue;
    visti.add(id);
    out.push(id);
    coda.push(...(figli.get(id) || []));
  }
  return out;
}

/**
 * Albero dei riporti di una persona (vista "La mia catena"): { id, livello, figli: [...] } fino a `maxLivelli` livelli; i nodi
 * che non sono nel perimetro restano come raccordo (un responsabile libero professionista, un superiore cessato).
 */
export function alberoDi(rootId, nodi, { figli = figliDi(nodi), maxLivelli = 12 } = {}) {
  const visti = new Set();
  const nodo = (id, livello) => {
    visti.add(id);
    const sotto = livello >= maxLivelli ? [] : (figli.get(id) || []).filter((x) => !visti.has(x));
    return { id, livello, figli: sotto.map((x) => nodo(x, livello + 1)) };
  };
  return nodo(rootId, 0);
}

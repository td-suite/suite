
/* TD Integration Plan Management - motore GANTT (vanilla JS), portato dalla pagina autocontenuta alla webapp td-integration
   e da questa alla Suite TD come modulo ES. Stato caricato dal server (REST), modifiche sincronizzate per singola entità,
   aggiornamenti in tempo reale via SSE (sessione della Suite).
   Anagrafica unica (docs/ANAGRAFICA.md): le società target sono organizzazioni della Suite (public.organizations, tipo Target) e
   gli owner/support delle attività sono persone della Suite (public.people): il motore lavora con i loro id e mostra i nomi
   (STATE.people); il team (STATE.team) è l'elenco delle persone con il ruolo nel piano. Nessuna creazione o rinomina qui:
   i pulsanti "Apri in Amministrazione" portano alle pagine della Suite. L'import da file dell'app originale non esiste più.
   Nella Suite la Content Security Policy non ammette gestori inline (onclick="..."): gli eventi sono delegati dalla radice del
   modulo tramite attributi data-hc (click), data-hx (change), data-hd (dragstart) e data-hdrop (dragover/drop), che puntano a
   chiusure registrate a ogni render. La logica di pianificazione, catalogo, workload, export e stampa è invariata. */

/* ---------------- gestori delegati (al posto degli attributi onclick/onchange) ---------------- */
var HANDLERS = [];
function reg(attr, fn) { HANDLERS.push(fn); return ' ' + attr + '="' + (HANDLERS.length - 1) + '"'; }
function hc(fn) { return reg('data-hc', fn); }
function hx(fn) { return reg('data-hx', fn); }
function hd(fn) { return reg('data-hd', fn); }
function hdrop(fn) { return reg('data-hdrop', fn); }
var IPM_ROOT = null, IPM_UNBIND = null;
function bindDelegation(root) {
  if (IPM_UNBIND) IPM_UNBIND();
  IPM_ROOT = root;
  function find(ev, attr) { var el = ev.target && ev.target.closest ? ev.target.closest('[' + attr + ']') : null; return el && root.contains(el) ? el : null; }
  function call(el, attr, ev) { var fn = HANDLERS[+el.getAttribute(attr)]; if (fn) fn(el, ev); }
  var onClick = function (ev) { var el = find(ev, 'data-hc'); if (!el) return; if (el.tagName === 'A') ev.preventDefault(); call(el, 'data-hc', ev); };
  var onChange = function (ev) { var el = find(ev, 'data-hx'); if (el) call(el, 'data-hx', ev); };
  var onDragStart = function (ev) { var el = find(ev, 'data-hd'); if (el) call(el, 'data-hd', ev); };
  var onDragOver = function (ev) { var el = find(ev, 'data-hdrop'); if (el) dragOver(ev, el); };
  var onDrop = function (ev) { var el = find(ev, 'data-hdrop'); if (el) call(el, 'data-hdrop', ev); };
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  root.addEventListener('dragstart', onDragStart);
  root.addEventListener('dragover', onDragOver);
  root.addEventListener('drop', onDrop);
  IPM_UNBIND = function () {
    root.removeEventListener('click', onClick); root.removeEventListener('change', onChange); root.removeEventListener('dragstart', onDragStart);
    root.removeEventListener('dragover', onDragOver); root.removeEventListener('drop', onDrop); IPM_UNBIND = null; IPM_ROOT = null;
  };
}

/* ---------------- i18n ---------------- */
var LANG = 'it';
var I18N = {
  title: { it: 'Integration Plan Management', en: 'Integration Plan Management' },
  sub: { it: 'Gestione e coordinamento del piano di integrazione post closing - Target Phase 1', en: 'Management and coordination of the post-closing integration plan - Phase 1 targets' },
  cover: { it: 'Cruscotto', en: 'Dashboard' },
  newTarget: { it: '+ Aggiungi target', en: '+ Add target' },
  export_: { it: 'Salva XLSX', en: 'Save XLSX' },
  import_: { it: 'Carica dati', en: 'Load data' },
  saveFile: { it: 'Salva nel file', en: 'Save to file' },
  chipDirty_app: { it: 'salvataggio in corso…', en: 'saving…' },
  chipSync_app: { it: 'sincronizzato', en: 'synced' },
  chipOffline: { it: 'offline: modifiche in coda', en: 'offline: changes queued' },
  chipErr: { it: 'errore di salvataggio', en: 'save error' },
  revLog_app: { it: 'Ultime modifiche (registro attività)', en: 'Latest changes (activity log)' },
  revNone_app: { it: 'Nessuna modifica registrata.', en: 'No change recorded yet.' },
  roMsg: { it: 'Profilo in sola lettura: le modifiche non sono consentite.', en: 'Read-only profile: changes are not allowed.' },
  conflictMsg: { it: 'Un altro utente ha appena modificato questo elemento: la riga è stata aggiornata con la sua versione.', en: 'Another user just changed this item: the row has been refreshed with their version.' },
  remoteChange: { it: '{who} ha aggiornato {what}', en: '{who} updated {what}' },
  importConfirm: { it: 'Importare i dati dal file nel database condiviso? Le attività più recenti nel file sostituiscono quelle attuali (viene salvato prima uno snapshot di sicurezza).', en: 'Import the file data into the shared database? Newer activities in the file replace current ones (a safety snapshot is saved first).' },
  importDone: { it: 'Importazione completata e condivisa con il team.', en: 'Import completed and shared with the team.' },
  saveFile_pub: { it: 'Salva e pubblica', en: 'Save & publish' },
  firmaNote_pub: { it: 'La firma resta nel registro delle revisioni della pagina, così tutto il team sa chi ha pubblicato per ultimo. Dopo il salvataggio la pagina si ricarica con la nuova versione per tutti.', en: 'The signature stays in the page revision log, so the whole team knows who published last. After saving, the page reloads to the new version for everyone.' },
  savedPub: { it: 'Pubblicato per il team', en: 'Published for the team' },
  pubConflict: { it: 'Un altro membro del team ha pubblicato una versione più recente: la pagina si ricarica con quella versione. Le tue modifiche restano nella memoria di questo browser.', en: 'Another team member published a newer version: the page reloads to it. Your changes stay in this browser memory.' },
  pubRO: { it: 'Vista di sola lettura: non hai i permessi per pubblicare modifiche a questa pagina.', en: 'Read-only view: you do not have permission to publish changes to this page.' },
  pubErr: { it: 'Pubblicazione non riuscita. Riprova tra qualche secondo; in alternativa esporta i dati (Export) per non perderli.', en: 'Publishing failed. Try again in a few seconds; alternatively export the data (Export) so nothing is lost.' },
  pubBusy: { it: 'Pubblicazione in corso…', en: 'Publishing…' },
  srcFile_pub: { it: 'Dati della versione pubblicata', en: 'Data of the published version' },
  srcLocalNew_pub: { it: 'Ho caricato modifiche più recenti trovate nella memoria di questo browser, non ancora pubblicate: premi "Salva e pubblica" per condividerle con il team.', en: 'Loaded more recent changes found in this browser memory, not yet published: press "Save & publish" to share them with the team.' },
  srcLocalOnly_pub: { it: 'Dati caricati dalla memoria di questo browser: premi "Salva e pubblica" per condividerli con il team.', en: 'Data loaded from this browser memory: press "Save & publish" to share them with the team.' },
  chipDirty_pub: { it: 'da pubblicare', en: 'to be published' },
  chipSync_pub: { it: 'allineato alla versione pubblicata', en: 'in sync with published version' },
  dlgOk: { it: 'OK', en: 'OK' },
  dlgCancel: { it: 'Annulla', en: 'Cancel' },
  dlgConfirm: { it: 'Conferma', en: 'Confirm' },
  mergeBtn: { it: 'Unisci da file', en: 'Merge from file' },
  firmaTit: { it: 'Chi sta salvando?', en: 'Who is saving?' },
  firmaSel: { it: 'Nome dal registro', en: 'Name from the registry' },
  firmaAlt: { it: 'Oppure scrivi', en: 'Or type it' },
  firmaNote: { it: 'La firma resta nel registro delle revisioni del file, così tutti sanno chi ha salvato per ultimo.', en: 'The signature stays in the file revision log, so everyone knows who saved last.' },
  savedFsa: { it: 'Salvato nel file', en: 'Saved to file' },
  savedDl: { it: 'Copia aggiornata scaricata: sostituisci con questa il file precedente nella cartella condivisa.', en: 'Updated copy downloaded: replace the previous file in the shared folder with it.' },
  srcFile: { it: 'Dati caricati dal file', en: 'Data loaded from the file' },
  srcLocalNew: { it: 'Ho caricato modifiche più recenti trovate nella memoria di questo browser, non ancora salvate nel file: premi "Salva nel file" per consolidarle.', en: 'Loaded more recent changes found in this browser memory, not yet saved to the file: press "Save to file" to consolidate them.' },
  srcLocalOnly: { it: 'Dati caricati dalla memoria di questo browser: premi "Salva nel file" per portarli dentro il file, così viaggiano con esso.', en: 'Data loaded from this browser memory: press "Save to file" to carry them inside the file, so they travel with it.' },
  chipDirty: { it: 'da salvare nel file', en: 'to be saved to file' },
  chipSync: { it: 'allineato al file', en: 'in sync with file' },
  rev: { it: 'rev', en: 'rev' },
  revLog: { it: 'Ultime modifiche (registro attività)', en: 'Latest changes (activity log)' },
  revNone: { it: 'Nessuna modifica registrata.', en: 'No change recorded yet.' },
  revBy: { it: 'Salvato da', en: 'Saved by' },
  mergeRep: { it: 'Unione completata: {aU} attività aggiornate, {aN} aggiunte, {tN} target aggiunte, {gU} anagrafiche aggiornate. Ora premi "Salva nel file" per consolidare.', en: 'Merge complete: {aU} activities updated, {aN} added, {tN} targets added, {gU} records updated. Now press "Save to file" to consolidate.' },
  mergeNo: { it: 'Nessuna differenza trovata: le due copie erano già allineate.', en: 'No differences found: the two copies were already aligned.' },
  mergeErr: { it: 'File non riconosciuto: scegli una copia HTML di questa app oppure un suo export XLSX.', en: 'File not recognised: choose an HTML copy of this app or one of its XLSX exports.' },
  print: { it: 'Stampa PDF', en: 'Print PDF' },
  targets: { it: 'Società target', en: 'Target companies' },
  totAct: { it: 'Attività totali', en: 'Total activities' },
  avgDone: { it: 'Avanzamento medio', en: 'Average progress' },
  noOwner: { it: 'Attività senza owner', en: 'Activities without owner' },
  closingWin: { it: 'Finestra closing', en: 'Closing window' },
  openCard: { it: 'Apri la scheda', en: 'Open the card' },
  anagrafica: { it: 'Società target (anagrafica unica)', en: 'Target company (shared registry)' },
  anagHint: { it: 'Ragione sociale, P.IVA, indirizzo e contatti vengono da Amministrazione, Legal entity: qui si modificano solo i parametri del piano. Al closing l\'Amministrazione cambia il tipo in Società e il piano resta agganciato.', en: 'Company name, VAT, address and contacts come from Administration > Organisations: only the plan parameters are edited here. At closing the Administration changes the type to Company and the plan stays attached.' },
  openAdmin: { it: 'Apri in Amministrazione', en: 'Open in Administration' },
  openPerson: { it: 'Scheda persona', en: 'Person record' },
  pickTarget: { it: 'Scegli la società target da aggiungere al piano (organizzazioni di tipo Target in anagrafica):', en: 'Choose the target company to add to the plan (organisations of type Target in the registry):' },
  noTargetAvail: { it: 'Nessuna società target disponibile: crea prima l\'organizzazione (tipo Target) in Amministrazione, Legal entity.', en: 'No target company available: first create the organisation (type Target) in Administration > Organisations.' },
  pickPerson: { it: 'Scegli la persona da aggiungere al team (anagrafica persone della Suite; chi ha accesso al modulo è segnato con ●):', en: 'Choose the person to add to the team (Suite people registry; module users are marked with ●):' },
  noPersonAvail: { it: 'Nessuna persona disponibile: le persone si creano in Amministrazione > Persone.', en: 'No person available: people are created in Administration > People.' },
  addPerson: { it: '+ Aggiungi persona', en: '+ Add person' },
  persona: { it: 'Persona', en: 'Person' },
  noTargets: { it: 'Nessuna società nel piano. Le società target si creano in Amministrazione, Legal entity (tipo Target) e poi si aggiungono qui con "+ Aggiungi target".', en: 'No company in the plan. Target companies are created in Administration > Organisations (type Target) and then added here with "+ Add target".' },
  teamEmpty: { it: 'Il team è vuoto: aggiungi le persone dall\'anagrafica e assegna a ciascuna il ruolo nel piano (es. CEO, CFO, Legal & Compliance). Gli owner delle attività si scelgono tra queste persone.', en: 'The team is empty: add people from the registry and give each a plan role (e.g. CEO, CFO, Legal & Compliance). Activity owners are chosen among these people.' },
  planStatus: { it: 'Stato del piano', en: 'Plan status' },
  psATTIVO: { it: 'Attivo', en: 'Active' },
  psSOSPESO: { it: 'Sospeso', en: 'On hold' },
  psCONCLUSO: { it: 'Concluso', en: 'Completed' },
  noteT: { it: 'Note del piano', en: 'Plan notes' },
  exPerson: { it: 'non più nel team', en: 'no longer in the team' },
  rs: { it: 'Ragione Sociale', en: 'Company name' },
  ind: { it: 'Indirizzo', en: 'Address' },
  piva: { it: 'P.IVA', en: 'VAT no.' },
  ref: { it: 'Persona di riferimento', en: 'Reference person' },
  fatt: { it: 'Fatturato 2025 (€)', en: '2025 revenue (€)' },
  pfn: { it: 'PFN (€)', en: 'NFP (€)' },
  ev: { it: 'EV (€)', en: 'EV (€)' },
  linee: { it: 'Linee di attività', en: 'Business lines' },
  lin_lab: { it: 'Analisi di Laboratorio', en: 'Laboratory Testing' },
  lin_img: { it: 'Diagnostica per Immagini', en: 'Imaging Diagnostics' },
  lin_spec: { it: 'Medicina Specialistica', en: 'Specialist Medicine' },
  lin_lav: { it: 'Medicina del Lavoro', en: 'Occupational Health' },
  lin_chir: { it: 'Chirurgia', en: 'Surgery' },
  lin_altro: { it: 'Altro', en: 'Other' },
  operazione: { it: 'Disegno dell’operazione', en: 'Deal structure' },
  loi: { it: 'Lettera di Intenti', en: 'Letter of Intent' },
  prelim: { it: 'Preliminare', en: 'Preliminary agreement' },
  closing: { it: 'Closing', en: 'Closing' },
  ganttStart: { it: 'Il GANTT parte dal lunedì della settimana del Preliminare se indicato, altrimenti del Closing.', en: 'The GANTT starts on the Monday of the Preliminary week if set, otherwise of the Closing week.' },
  orizzonte: { it: 'Orizzonte (settimane)', en: 'Horizon (weeks)' },
  gantt: { it: 'GANTT di integrazione', en: 'Integration GANTT' },
  ganttHint: { it: 'Clicca le celle per pianificare: un clic fuori dalla barra la estende, sul bordo la accorcia, sull’unica settimana la cancella. Clicca il nome per modificare owner, note e stato.', en: 'Click cells to plan: clicking outside the bar extends it, on its edge trims it, on its only week clears it. Click the name to edit owners, notes and status.' },
  attivita: { it: 'Attività', en: 'Activity' },
  owners: { it: 'Owner', en: 'Owner' },
  support: { it: 'Ownership Support', en: 'Ownership Support' },
  selSupport: { it: 'Seleziona una o più funzioni', en: 'Select one or more functions' },
  nessuno: { it: 'Nessuno', en: 'None' },
  dett: { it: 'Dettagli', en: 'Details' },
  note: { it: 'Note', en: 'Notes' },
  status: { it: 'Stato', en: 'Status' },
  st0: { it: 'Da avviare', en: 'To start' },
  st1: { it: 'In corso', en: 'In progress' },
  st2: { it: 'Completata', en: 'Completed' },
  st3: { it: 'Critica', en: 'Critical' },
  sw: { it: 'Settimana inizio', en: 'Start week' },
  ew: { it: 'Settimana fine', en: 'End week' },
  pl: { it: 'Effetti diretti sul P&L', en: 'Direct P&L impact' },
  ms: { it: 'Milestone', en: 'Milestone' },
  del: { it: 'Elimina', en: 'Delete' },
  chiudi: { it: 'Chiudi', en: 'Close' },
  catalogo: { it: 'Catalogo attività (adempimenti generali + attività operative TD)', en: 'Activity catalogue (general obligations + TD operating activities)' },
  catHint: { it: 'Tutte le attività del piano generale e delle schede: aggiungile al GANTT con un clic. Le voci barrate sono già in scheda.', en: 'Every activity from the master plan and the target sheets: add them to the GANTT with one click. Struck-through items are already on the card.' },
  add: { it: 'Aggiungi', en: 'Add' },
  addCustom: { it: 'Aggiungi un’attività non prevista', en: 'Add an unplanned activity' },
  nome: { it: 'Nome attività', en: 'Activity name' },
  proc: { it: 'Processo', en: 'Process' },
  alerts: { it: 'Punti di attenzione', en: 'Attention points' },
  alOwner: { it: 'attività senza owner', en: 'activities without an owner' },
  alPlan: { it: 'attività non pianificate sul GANTT', en: 'activities not planned on the GANTT' },
  alCrit: { it: 'attività in stato critico', en: 'activities flagged critical' },
  alOk: { it: 'Nessun punto aperto: piano completo e assegnato.', en: 'Nothing open: plan complete and fully assigned.' },
  workload: { it: 'Carico di lavoro per owner', en: 'Owner workload' },
  wlAct: { it: 'Attività', en: 'Activities' },
  wlWeeks: { it: 'Settimane · uomo', en: 'Man · weeks' },
  day100: { it: 'Day 100', en: 'Day 100' },
  wClosing: { it: 'Closing', en: 'Closing' },
  printTitle: { it: 'Stampa PDF del GANTT', en: 'Print GANTT to PDF' },
  pScope: { it: 'Perimetro', en: 'Scope' },
  pThis: { it: 'Questa società', en: 'This company' },
  pAll: { it: 'Tutte le società', en: 'All companies' },
  pMode: { it: 'Vista', en: 'View' },
  pFull: { it: 'GANTT totale per società', en: 'Full GANTT by company' },
  pOwner: { it: 'GANTT per owner (una pagina per persona)', en: 'GANTT by owner (one page per person)' },
  pGo: { it: 'Genera e stampa', en: 'Generate and print' },
  annulla: { it: 'Annulla', en: 'Cancel' },
  fasi: { it: 'Fasi del piano generale: 1 (Day 1-15), 2 (Day 16-30), 3 (Day 31-60), 4 (Day 61-100)', en: 'Master plan phases: 1 (Day 1-15), 2 (Day 16-30), 3 (Day 31-60), 4 (Day 61-100)' },
  settDal: { it: 'Settimane dal', en: 'Weeks from' },
  docFooter: { it: 'Toscana Diagnostica S.r.l. · Documento riservato · Integration Plan Management', en: 'Toscana Diagnostica S.r.l. · Confidential · Integration Plan Management' },
  wk: { it: 'Sett.', en: 'Wk' },
  progresso: { it: 'Avanzamento', en: 'Progress' },
  saved: { it: 'Dati salvati in XLSX: riepilogo, team e un foglio per target, consultabili in Excel.', en: 'Data saved to XLSX: summary, team and one sheet per target, readable in Excel.' },
  fineEff: { it: 'Conclusa il', en: 'Completed on' },
  delTarget: { it: 'Rimuovi dal piano', en: 'Remove from plan' },
  confermaDel: { it: 'Rimuovere dal piano (attività comprese) la società', en: 'Remove from the plan (activities included) the company' },
  noDate: { it: 'Per generare il GANTT inserisci una data certa: Preliminare oppure Closing.', en: 'To generate the GANTT enter a firm date: Preliminary or Closing.' },
  alLate: { it: 'attività concluse oltre la settimana pianificata', en: 'activities completed after the planned week' },
  ownerActs: { it: 'Attività di', en: 'Activities of' },
  overlayHint: { it: 'Vista sovrapposta per società: le settimane con più attività in parallelo sono evidenziate nella riga in alto.', en: 'Overlaid view across companies: weeks with several parallel activities are highlighted in the top row.' },
  dens: { it: 'Attività in parallelo', en: 'Parallel activities' },
  clickFix: { it: 'clicca per correggere', en: 'click to fix' },
  importErr: { it: 'File non riconosciuto: carica un XLSX salvato da questa app (o un JSON).', en: 'Unrecognised file: load an XLSX saved by this app (or a JSON).' },
  drag: { it: 'Trascina ⠿ per riordinare le attività.', en: 'Drag ⠿ to reorder activities.' },
  sortChrono: { it: '↕ Ordina per data di inizio', en: '↕ Sort by start date' },
  alignBtn: { it: '⇉ Allinea ownership sulle altre target', en: '⇉ Align ownership across targets' },
  alignTip: { it: 'Copia Owner e Ownership Support di questa target sulle attività corrispondenti delle altre target, senza toccare il timing', en: 'Copies Owner and Ownership Support from this target onto matching activities of the other targets, leaving timing untouched' },
  alignConfirm: { it: 'Copio Owner e Ownership Support di questa target sulle attività corrispondenti di TUTTE le altre target. Timing, stato e date non cambiano. Procedo?', en: 'Copy Owner and Ownership Support from this target onto matching activities of ALL other targets. Timing, status and dates stay unchanged. Proceed?' },
  alignDone: { it: 'Ownership allineata: {n} attività aggiornate su {m} target.', en: 'Ownership aligned: {n} activities updated across {m} targets.' },
  alignNone: { it: 'Nessuna differenza: le assegnazioni erano già allineate.', en: 'No differences: assignments were already aligned.' },
  tel: { it: 'Telefono', en: 'Phone' },
  mail: { it: 'Mail', en: 'Email' },
  web: { it: 'Sito web', en: 'Website' },
  pec: { it: 'PEC', en: 'Certified email (PEC)' },
  ownerBox: { it: 'Team di integrazione: persone e ruoli nel piano', en: 'Integration team: people and plan roles' },
  ownerBoxHint: { it: 'Le persone vengono dall’anagrafica unica della Suite (Amministrazione > Persone): qui si sceglie chi fa parte del team e il suo ruolo nel piano. Gli owner e i support delle attività si assegnano tra queste persone.', en: 'People come from the Suite shared registry (Administration > People): here you choose who is on the team and their plan role. Activity owners and support are assigned among these people.' },
  ruolo: { it: 'Ruolo', en: 'Role' },
  funzione: { it: 'Funzione', en: 'Function' },
  manager: { it: 'Persona', en: 'Person' },
  nAss: { it: 'Task', en: 'Tasks' },
  addRole: { it: '+ Aggiungi persona', en: '+ Add person' },
  interna: { it: 'Interna', en: 'Internal' },
  esterna: { it: 'Esterna', en: 'External' }
};
/* persone dell'anagrafica unica: STATE.people = [{id, name, in_team}], STATE.team = [{person_id, r, f, n}] */
function pid(v) { var n = parseInt(v, 10); return isFinite(n) && n > 0 ? n : null; }
function person(id) { id = pid(id); if (!id) return null; return (STATE.people || []).find(function (p) { return p.id === id; }) || null; }
function pName(id) { var p = person(id); if (p) return p.name; var m = teamOf(id); return m ? m.n : (id ? '#' + id : ''); }
function teamOf(id) { id = pid(id); return (STATE.team || []).find(function (x) { return x.person_id === id; }) || null; }
/* ruolo nel piano di una persona (es. CEO) */
function teamRole(id) { var m = teamOf(id); return m ? m.r : ''; }
/* etichetta completa: "Nome Cognome · ruolo" */
function pLabel(id) { var n = pName(id), r = teamRole(id); return n ? n + (r ? ' · ' + r : '') : ''; }
function teamName(id) { return teamRole(id); }
/* persona del team con quel ruolo nel piano (per gli owner di default del catalogo) */
function roleToPerson(role) {
  if (!role) return null;
  var k = String(role).trim().toLowerCase();
  var m = (STATE.team || []).find(function (x) { return String(x.r || '').trim().toLowerCase() === k; });
  return m ? m.person_id : null;
}
function T(k) { var d = I18N[k + '_app'] || I18N[k]; return d ? (d[LANG] || d.it) : k; }
function L(v) { return v == null ? '' : (typeof v === 'object' ? (v[LANG] || v.it || '') : v); }

/* ---------------- processi (categorie) ---------------- */
var PROCS = {
  gov: { it: 'Governance & Legale', en: 'Governance & Legal', c: 'var(--c-gov)', hex: '#1C505E' },
  reg: { it: 'Regulatory & Accreditamento', en: 'Regulatory & Accreditation', c: 'var(--c-reg)', hex: '#7E57C2' },
  hr: { it: 'HR & Persone', en: 'HR & People', c: 'var(--c-hr)', hex: '#B08718' },
  it: { it: 'IT & Sistemi', en: 'IT & Systems', c: 'var(--c-it)', hex: '#0E7FA0' },
  fin: { it: 'Finanza & Controllo', en: 'Finance & Control', c: 'var(--c-fin)', hex: '#01212C' },
  proc: { it: 'Procurement & Facilities', en: 'Procurement & Facilities', c: 'var(--c-proc)', hex: '#2E7D32' },
  cli: { it: 'Clinico & Qualità', en: 'Clinical & Quality', c: 'var(--c-cli)', hex: '#B3261E' },
  mkt: { it: 'Comunicazione & Marketing', en: 'Communication & Marketing', c: 'var(--c-mkt)', hex: '#C2185B' },
  ops: { it: 'Operations', en: 'Operations', c: 'var(--c-ops)', hex: '#45AFD4' }
};

/* ---------------- catalogo generale (foglio "Adempimenti generali") ---------------- */
function ga(id, fase, proc, it, en, ow, co, sw, ew) {
  return { cid: id, fase: fase, proc: proc, it: it, en: en, ow: ow, co: co, sw: sw, ew: ew, gen: true };
}
var CAT_GEN = [
  ga('1.1', 1, 'reg', 'Comunicazione di subentro a Regione e ASL (salvaguardia accreditamento e budget SSN)', 'Takeover notice to Region and ASL (safeguarding accreditation and NHS budget)', 'Legal & Compliance', 'Direzione Sanitaria', 1, 1),
  ga('1.2', 1, 'cli', 'Conferma o nomina del Direttore Sanitario e comunicazione agli ordini', 'Confirmation or appointment of the Medical Director and notice to professional boards', 'Amministratore Delegato', 'Legal & Compliance', 1, 1),
  ga('1.3', 1, 'it', 'Subentro credenziali Sistema Tessera Sanitaria e flussi regionali di fatturazione', 'Takeover of the Health Card System credentials and regional billing flows', 'Responsabile IT', 'Direzione Amministrativa', 1, 1),
  ga('1.4', 1, 'fin', 'Voltura conti correnti dedicati ai rimborsi SSN e aggiornamento firme', 'Transfer of NHS reimbursement bank accounts and signature update', 'CFO', 'Tesoreria', 1, 2),
  ga('1.5', 1, 'hr', 'Chiusura procedura ex art. 47 L. 428/90 e benvenuto formale al personale', 'Closure of the art. 47 L. 428/90 procedure and formal welcome to staff', 'Direttore HR', 'Amministratore Delegato', 1, 3),
  ga('2.1', 2, 'gov', 'Nomina del nuovo DPO e aggiornamento del Registro dei Trattamenti (GDPR)', 'Appointment of the new DPO and update of the GDPR processing register', 'Legal & Compliance', 'DPO', 3, 3),
  ga('2.2', 2, 'cli', 'Aggiornamento timbri, ricettari regionali, consensi informati e carta dei servizi', 'Update of stamps, regional prescription pads, informed consents and service charter', 'Direzione Sanitaria', 'Responsabile Qualità', 3, 4),
  ga('2.3', 2, 'proc', 'Voltura contratti critici: gas medicinali, rifiuti speciali, energia', 'Transfer of critical contracts: medical gases, special waste, energy', 'Responsabile Acquisti', 'HSE Manager', 3, 5),
  ga('2.4', 2, 'proc', 'Verifica manutenzioni preventive e controlli di sicurezza apparecchiature (TAC/RMN)', 'Check of preventive maintenance and safety controls on equipment (CT/MRI)', 'Ingegneria Clinica', 'Responsabile Acquisti', 3, 5),
  ga('3.1', 3, 'hr', 'Censimento crediti ECM e idoneità di medicina del lavoro del personale', 'Census of CME credits and occupational-health fitness of staff', 'Direttore HR', 'Medico Competente', 5, 7),
  ga('3.2', 3, 'fin', 'Allineamento fatturazione attiva SSN e controllo di gestione sui tetti di spesa', 'Alignment of NHS billing and management control on spending caps', 'Direzione Amministrativa', 'Controllo di Gestione', 5, 8),
  ga('3.3', 3, 'it', 'Piano di migrazione o integrazione della Cartella Clinica Elettronica', 'Migration or integration plan for the Electronic Health Record', 'Responsabile IT', 'Direzione Sanitaria', 5, 9),
  ga('3.4', 3, 'proc', 'Rinegoziazione acquisti farmaci e dispositivi con accordi quadro di gruppo', 'Renegotiation of drug and device purchases under group framework agreements', 'Responsabile Acquisti', 'Farmacia Clinica', 5, 9),
  ga('4.1', 4, 'cli', 'Audit interno su requisiti strutturali, tecnologici e organizzativi (LEA)', 'Internal audit on structural, technological and organisational requirements', 'Responsabile Qualità', 'Direzione Sanitaria', 9, 11),
  ga('4.2', 4, 'gov', 'Integrazione nella polizza RCT/RCO di Gruppo (Legge Gelli-Bianco)', 'Integration into the Group liability policy (Gelli-Bianco law)', 'Legal & Compliance', 'Broker Assicurativo', 9, 12),
  ga('4.3', 4, 'mkt', 'Aggiornamento posizionamento del brand e comunicazione a MMG/PLS', 'Brand positioning update and communication to GPs and paediatricians', 'Direttore Marketing', 'Direzione Commerciale', 9, 13),
  ga('4.4', 4, 'fin', 'Prima rendicontazione economica consolidata ed esame degli scostamenti', 'First consolidated financial report and variance review', 'CFO', 'Amministratore Delegato', 13, 15),
  ga('G1', 1, 'gov', 'Aggiornamento registro imprese: cariche sociali e variazioni di quote', 'Company register update: officers and share changes', 'Legal & Compliance', '', 1, 1),
  ga('G2', 1, 'gov', 'Delibere per cambio amministratori e poteri di firma', 'Resolutions for change of directors and signing powers', 'Legal & Compliance', '', 1, 1),
  ga('G3', 1, 'gov', 'Archiviazione e catalogazione dei documenti firmati del closing', 'Filing and cataloguing of signed closing documents', 'Legal & Compliance', '', 1, 2),
  ga('G4', 1, 'reg', 'Voltura autorizzazioni sanitarie: istanze a Comune, ASL e Regione', 'Transfer of health authorisations: filings to Municipality, ASL and Region', 'Legal & Compliance', 'Direzione Sanitaria', 1, 3),
  ga('G5', 1, 'gov', 'Censimento contenziosi in essere e coperture assicurative RCT/RCO', 'Census of pending litigation and liability insurance coverage', 'Legal & Compliance', '', 1, 2),
  ga('G6', 1, 'fin', 'Pagamenti di conguaglio e monitoraggio earn-out e garanzie contrattuali', 'Balance payments and monitoring of earn-outs and contractual warranties', 'CFO', '', 1, 2),
  ga('G7', 1, 'mkt', 'Comunicazioni ufficiali ai clienti chiave sulla continuità', 'Official communications to key clients on continuity', 'Direzione Commerciale', '', 1, 2),
  ga('G8', 2, 'proc', 'Aggiornamento anagrafiche e contratti dei fornitori strategici', 'Update of strategic suppliers records and contracts', 'Responsabile Acquisti', '', 3, 4),
  ga('G9', 1, 'mkt', 'Comunicazione interna ed esterna (comunicato stampa o note informative)', 'Internal and external communication (press release or notes)', 'Direttore Marketing', '', 1, 1),
  ga('G10', 3, 'hr', 'Armonizzazione dei contratti del personale (CCNL di riferimento)', 'Harmonisation of staff contracts (reference collective agreements)', 'Direttore HR', '', 5, 9),
  ga('G11', 2, 'gov', 'Verifica trasferimento o rinnovo di licenze, permessi e locazioni', 'Check on transfer or renewal of licences, permits and leases', 'Legal & Compliance', '', 3, 5),
  ga('G12', 3, 'it', 'Migrazione sicura dei dati dei pazienti nel rispetto del GDPR (art. 9)', 'Secure migration of patient data in compliance with GDPR (art. 9)', 'Responsabile IT', 'DPO', 5, 9),
  ga('G13', 1, 'cli', 'Continuità delle cure: piani terapeutici attivi senza interruzioni', 'Continuity of care: active treatment plans without interruption', 'Direzione Sanitaria', '', 1, 4)
];

/* ---------------- catalogo operativo TD (dalle schede target) ---------------- */
function oa(id, proc, it, en) { return { cid: id, fase: 0, proc: proc, it: it, en: en, gen: false }; }
var CAT_OPS = [
  oa('O1', 'hr', 'Accoglienza del personale e incontro con medici, specialisti e collaboratori', 'Staff welcome and meeting with physicians, specialists and collaborators'),
  oa('O2', 'hr', 'Assunzione del personale', 'Staff hiring'),
  oa('O3', 'mkt', 'Comunicazione a clienti e fornitori sulla continuità con il supporto di TD', 'Communication to clients and suppliers on continuity with TD support'),
  oa('O4', 'mkt', 'Carte intestate e documenti operativi', 'Letterheads and operating documents'),
  oa('O5', 'cli', 'Adempimenti in materia di salute e sicurezza nei luoghi di lavoro', 'Workplace health and safety obligations'),
  oa('O6', 'ops', 'Gestione dell’offerta e del software di gestione', 'Service offering and management software'),
  oa('O7', 'ops', 'Gestione di agende e flussi dei pazienti', 'Diary management and patient flows'),
  oa('O8', 'hr', 'Formazione del personale sul gestionale di accettazione post fusione', 'Staff training on the post-merger front-office system'),
  oa('O9', 'proc', 'Assorbimento fornitori e razionalizzazione del procurement', 'Supplier absorption and procurement rationalisation'),
  oa('O10', 'proc', 'Ordini con fornitori TD (pricing di gruppo)', 'Orders with TD suppliers (group pricing)'),
  oa('O11', 'proc', 'Chiusura di tutti i contratti non più in uso', 'Closure of all contracts no longer in use'),
  oa('O12', 'proc', 'Disdetta contratti con consulenti', 'Termination of consultant contracts'),
  oa('O13', 'hr', 'Razionalizzazione dell’organico e riorganizzazione delle funzioni', 'Workforce rationalisation and reorganisation of functions'),
  oa('O14', 'mkt', 'Piano di co-brand (con Wodka Agency)', 'Co-branding plan (with Wodka Agency)'),
  oa('O15', 'ops', 'Riorganizzazione interna degli spazi', 'Internal reorganisation of spaces'),
  oa('O16', 'gov', 'Incontro con i proprietari dell’immobile', 'Meeting with the property owners'),
  oa('O17', 'mkt', 'Meeting e contatti con tutti i clienti', 'Meetings and contacts with all clients'),
  oa('O18', 'gov', 'Disdetta contratto di locazione e rilascio dei locali', 'Lease termination and release of premises'),
  oa('O19', 'gov', 'Fusione della società in Toscana Diagnostica S.r.l.', 'Merger of the company into Toscana Diagnostica S.r.l.'),
  oa('O20', 'mkt', 'Comunicazioni a enti istituzionali, fornitori e clienti', 'Communications to institutions, suppliers and clients'),
  oa('O21', 'it', 'Avvio del nuovo software di gestione', 'Go-live of the new management software'),
  oa('O22', 'hr', 'Formazione del personale su salute e sicurezza', 'Staff training on health and safety'),
  oa('O23', 'gov', 'Supporto a concordato / trasformazione societaria pre closing', 'Support to pre-closing arrangement / corporate transformation'),
  oa('O24', 'gov', 'Conclusione dell’integrazione', 'Integration completed')
];
var CATALOG = CAT_GEN.concat(CAT_OPS);
function catById(cid) { for (var i = 0; i < CATALOG.length; i++) if (CATALOG[i].cid === cid) return CATALOG[i]; return null; }
/* riclassificazione owner di default sui ruoli del registro */
var ROLE_MAP = { 'Amministratore Delegato': 'CEO', 'Responsabile IT': 'IT Management', 'Direzione Amministrativa': 'CFO',
  'Tesoreria': 'CFO', 'Direttore HR': 'HR Manager', 'Responsabile Qualità': 'HSQ Manager', 'Responsabile Acquisti': 'Procurement',
  'HSE Manager': 'RSPP', 'Controllo di Gestione': 'CFO', 'Farmacia Clinica': 'Direzione Sanitaria', 'Direttore Marketing': 'Retail Manager' };
CAT_GEN.forEach(function (c) { c.ow = ROLE_MAP[c.ow] || c.ow; c.co = ROLE_MAP[c.co] || c.co; });

/* ---------------- seed targets (dal file M&A Integration Plan, bozza 08/2026) ---------------- */
var AID = 1;
/* owner UNICO + ownership support (una o piu' funzioni) */
function act(cid, sw, ew, owners, o) {
  o = o || {};
  var c = catById(cid) || {};
  var arr = (owners || (c.ow ? [c.ow].concat(c.co ? [c.co] : []) : [])).map(function (x) { return pid(x) || roleToPerson(x); }).filter(function (x) { return x; });
  arr = arr.filter(function (x, i) { return arr.indexOf(x) === i; });
  return { id: 'a' + (AID++), cid: cid, nome: o.nome || null, proc: o.proc || c.proc || 'ops',
    sw: sw, ew: ew, owner: arr[0] || null, support: arr.slice(1),
    dett: o.dett || '', note: o.note || '', st: 0, pl: !!o.pl, ms: !!o.ms, lm: 0 };
}
function inv(a) { return (a.owner ? [a.owner] : []).concat(a.support || []); }
function normAtt(a) {
  if (a.owners) { a.owner = a.owners[0] || null; a.support = a.owners.slice(1); delete a.owners; }
  a.owner = pid(a.owner);
  a.support = (a.support || []).map(pid).filter(function (x) { return x && x !== a.owner; });
  return a;
}
/* attività del piano generale per una nuova target: gli owner di default (ruoli del catalogo) vengono risolti sulle persone
   del team che hanno quel ruolo nel piano; senza corrispondenza l'attività nasce senza owner (punto di attenzione) */
function genActs() { return CAT_GEN.map(function (c) { return act(c.cid, c.sw, c.ew); }); }
function sortActs(t) {
  t.atts = t.atts.map(function (a, i) { return [a, i]; }).sort(function (x, y) {
    var a = x[0], b = y[0];
    var ka = a.sw ? a.sw : 9999, kb = b.sw ? b.sw : 9999;
    if (ka !== kb) return ka - kb;
    var ea = a.ew || 0, eb = b.ew || 0;
    if (ea !== eb) return ea - eb;
    return x[1] - y[1];
  }).map(function (p) { return p[0]; });
}
function sortChrono(tid) { if (!canEdit()) return roToast(); var t = tg(tid); sortActs(t); SYNC.reorder(t); render(); }
/* allineamento ownership tra target: copia owner+support dalla target corrente
   alle attività corrispondenti delle altre, SENZA toccare timing, stato e date */
function alignKey(a) {
  if (a.cid && a.cid !== 'nuova' && !a.nome) return 'c:' + a.cid;
  var n = a.nome;
  if (n && typeof n === 'object') n = n.it || n.en || '';
  return 'n:' + String(n || a.cid || '').trim().toLowerCase();
}
function alignOwnership(tid) {
  if (!canEdit()) return roToast();
  var src = tg(tid);
  if (!src) return;
  tdConfirm(T('alignConfirm'), function () { alignOwnershipDo(src); });
}
function alignOwnershipDo(src) {
  var map = {};
  src.atts.forEach(function (a) { if (!a.ms) map[alignKey(a)] = a; });
  var nAtt = 0, nTg = 0;
  STATE.targets.forEach(function (t) {
    if (t.id === src.id) return;
    var touched = 0;
    t.atts.forEach(function (a) {
      if (a.ms) return;
      var s = map[alignKey(a)];
      if (!s) return;
      var ns = (s.support || []).slice();
      if (a.owner !== s.owner || (a.support || []).join('|') !== ns.join('|')) {
        a.owner = s.owner; a.support = ns; touch(a); touched++;
      }
    });
    if (touched) { nTg++; nAtt += touched; }
  });
  save(); render();
  tdAlert(nAtt ? T('alignDone').replace('{n}', nAtt).replace('{m}', nTg) : T('alignNone'));
}
var STATE = { targets: [], team: [], people: [], page: 'cover', meta: { rev: 0, savedBy: '', savedAt: '', log: [] } };

/* --- versione portabile: lo stato viaggia dentro il file --- */
var DIRTY = false, BOOT_SRC = '', BANNER_OFF = false, FLASH = '';
/* contesto applicativo (impostato da IPM.mount) */
var IPM_OPTS = { api: null, user: null, readOnly: true, onState: null, onToast: null, navigate: null, eventsUrl: '/api/integration/events', root: null };
/* collegamenti all'Amministrazione della Suite (router della Suite se disponibile, altrimenti navigazione piena) */
function goSuite(path) { if (IPM_OPTS.navigate) IPM_OPTS.navigate(path); else window.location.href = path; }
function canEdit() { return !IPM_OPTS.readOnly; }
function roToast() { if (IPM_OPTS.onToast) IPM_OPTS.onToast(roMsgText(), 'err'); }
/* testo della sola lettura: quello dell'app, oppure quello passato dalla cornice (es. modulo in MIRROR nella Suite) */
function roMsgText() { var m = IPM_OPTS.roMsg; return m ? (typeof m === 'object' ? (m[LANG] || m.it) : m) : T('roMsg'); }
function nowIso() { return new Date().toISOString(); }
function touch(o) { if (o) { o.lm = Date.now(); SYNC.schedule(o); } DIRTY = true; }
function ensureMeta() { if (!STATE.meta) STATE.meta = { rev: 0, savedBy: '', savedAt: '', log: [] }; if (!STATE.meta.log) STATE.meta.log = []; return STATE.meta; }

/* ---------------- utilità ---------------- */
function byId(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function mondayOf(x) {
  if (!x) return null;
  var d = x instanceof Date ? new Date(x) : new Date(x + 'T12:00:00');
  var day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}
function addW(d, w) { var x = new Date(d); x.setDate(x.getDate() + w * 7); return x; }
function fmtD(d) {
  if (!d) return '';
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
}
function fmtDY(d) { return fmtD(d) + '/' + String(d.getFullYear()).slice(2); }
/* data certa: preliminare oppure closing; senza date il GANTT non parte */
function startDate(t) { return mondayOf(t.prelim || t.closing); }
function weekOfDate(t, dstr) {
  var sd = startDate(t); if (!sd || !dstr) return null;
  return Math.floor((mondayOf(dstr) - sd) / (7 * 864e5)) + 1;
}
function fmtMil(v) {
  var n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
  return isNaN(n) ? '' : n.toLocaleString('it-IT');
}
function actName(a) { var c = catById(a.cid); return a.nome ? L(a.nome) : (c ? L({ it: c.it, en: c.en }) : ''); }
function tProgress(t) {
  var n = t.atts.length, done = 0;
  t.atts.forEach(function (a) { if (a.st === 2) done++; });
  return n ? done / n : 0;
}
function allOwners() {
  var s = {};
  (STATE.team || []).forEach(function (m) { s[m.person_id] = 1; });
  STATE.targets.forEach(function (t) { t.atts.forEach(function (a) { inv(a).forEach(function (o) { if (o) s[o] = 1; }); }); });
  return Object.keys(s).map(Number).sort(function (a, b) { return pName(a).localeCompare(pName(b)); });
}
function ownerOpts(sel) {
  return allOwners().map(function (r) {
    return '<option ' + (pid(sel) === r ? 'selected' : '') + ' value="' + r + '">' + esc(pLabel(r)) + (teamOf(r) ? '' : ' (' + T('exPerson') + ')') + '</option>';
  }).join('');
}
function refreshOwnlist() { /* non serve più: gli owner si scelgono dall'elenco del team */ }
function save() { /* lo stato vive sul server: niente persistenza locale */ }
function applyLoaded(d) {
  if (!d) return false;
  var ok = false;
  if (Array.isArray(d)) { if (d.length) { STATE.targets = d; ok = true; } }
  else if (d.targets && d.targets.length) { STATE.targets = d.targets; if (d.team && d.team.length) STATE.team = d.team; if (d.people) STATE.people = d.people; if (d.meta) STATE.meta = d.meta; ok = true; }
  if (ok) { STATE.targets.forEach(function (t) { (t.atts || []).forEach(normAtt); }); ensureMeta(); }
  return ok;
}
function renderCore() {
  HANDLERS = [];   /* le chiusure della vista precedente non servono più */
  var nav = byId('ipm-nav');
  var h = '<button class="' + (STATE.page === 'cover' ? 'on' : '') + '"'+ hc(function () { go('cover'); }) + '>🏠 ' + T('cover') + '</button>';
  STATE.targets.forEach(function (t) {
    h += '<button class="' + (STATE.page === t.id ? 'on' : '') + '"' + hc(function () { go(t.id); }) + '>' + esc(t.nome || '?') + '</button>';
  });
  h += '<span class="sp"></span>';
  h += syncChipHtml();
  if (canEdit()) h += '<button' + hc(addTarget) + '>' + T('newTarget') + '</button>';
  h += '<button' + hc(exportJSON) + '>📊 ' + T('export_') + '</button>';
  h += '<button' + hc(openPrint) + '>🖨 ' + T('print') + '</button>';
  nav.innerHTML = h;
  renderBanner();
  var m = byId('ipm-main');
  if (STATE.page === 'cover') renderCover(m); else renderTarget(m, STATE.targets.find(function (t) { return t.id === STATE.page; }));
  if (IPM_OPTS.onState) IPM_OPTS.onState({ page: STATE.page, targets: STATE.targets.map(function (t) { return { id: t.id, nome: t.nome }; }) });
}
function syncChipHtml() {
  var s = SYNC.status();
  var cls = s === 'ok' ? 'ok' : (s === 'err' ? 'err' : 'warn');
  var key = s === 'ok' ? 'chipSync' : s === 'pending' ? 'chipDirty' : s === 'offline' ? 'chipOffline' : 'chipErr';
  return '<span class="syncchip ' + cls + '" title="' + T('rev') + ' ' + (ensureMeta().rev || 0) + '"><span class="dot"></span>' + T(key) + '</span>';
}
function go(p) { STATE.page = p; render(); window.scrollTo(0, 0); }

/* ---------------- copertina ---------------- */
function renderCover(m) {
  var totA = 0, totDone = 0, noOw = 0;
  STATE.targets.forEach(function (t) {
    totA += t.atts.length;
    t.atts.forEach(function (a) { if (a.st === 2) totDone++; if (!a.owner) noOw++; });
  });
  var h = '<div class="tiles" style="margin-bottom:14px">' +
    '<div class="tile dark"><div class="lab">' + T('targets') + '</div><div class="val">' + STATE.targets.length + '</div><div class="sub">Phase 1</div></div>' +
    '<div class="tile"><div class="lab">' + T('totAct') + '</div><div class="val">' + totA + '</div></div>' +
    '<div class="tile"><div class="lab">' + T('avgDone') + '</div><div class="val">' + Math.round(totA ? totDone / totA * 100 : 0) + '%</div></div>' +
    '<div class="tile"><div class="lab">' + T('noOwner') + '</div><div class="val" style="color:' + (noOw ? 'var(--crit)' : 'var(--good)') + '">' + noOw + '</div></div>' +
    '<div class="tile"><div class="lab">' + T('closingWin') + '</div><div class="val" style="font-size:15px">' + closingWindow() + '</div></div></div>';
  h += '<div class="card"><h3>' + T('targets') + '</h3><div class="tcards">';
  STATE.targets.forEach(function (t) {
    var p = Math.round(tProgress(t) * 100);
    var cd = t.closing ? fmtDY(new Date(t.closing + 'T12:00:00')) : '-';
    h += '<div class="tcard"' + hc(function () { go(t.id); }) + '><div class="tn">' + esc(t.nome) + (t.status && t.status !== 'ATTIVO' ? ' <span class="badge ' + (t.status === 'CONCLUSO' ? 'good' : 'warn') + '" style="font-size:9px">' + T('ps' + t.status) + '</span>' : '') + '</div>' +
      '<div class="ti">' + (t.piva ? 'P.IVA ' + esc(t.piva) : '') + (t.ind ? (t.piva ? ' · ' : '') + esc(t.ind) : '') + '</div>' +
      '<div class="pbar"><i style="width:' + p + '%"></i></div>' +
      '<div class="meta"><span>' + t.atts.length + ' ' + T('wlAct').toLowerCase() + ' · ' + p + '%</span><span>' + T('closing') + ': <b>' + cd + '</b></span></div>' +
      '<div style="margin-top:8px"><span class="badge canary">' + T('openCard') + ' →</span></div></div>';
  });
  if (!STATE.targets.length) h += '<div class="note">' + T('noTargets') + ' <a href="#" style="color:var(--teal);font-weight:650"' + hc(function () { goSuite('/admin/organizations'); }) + '>' + T('openAdmin') + '</a></div>';
  h += '</div><div class="note" style="margin-top:10px">' + T('fasi') + '</div></div>';
  /* ultime modifiche (registro attività) */
  var mlog = ensureMeta().log || [];
  h += '<div class="card" style="margin-top:14px"><h3>🗂 ' + T('revLog') + '</h3>' +
    (mlog.length ? '<div class="tbl-wrap"><table class="revlog" style="border-collapse:collapse;width:100%">' + mlog.slice(0, 10).map(function (e) {
      var d = e.at ? new Date(e.at) : null;
      return '<tr><td class="r">#' + e.rev + '</td><td style="white-space:nowrap">' + esc(e.by || '-') + '</td><td style="white-space:nowrap">' +
        (d ? fmtDY(d) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') : '-') + '</td><td style="color:var(--ink-2)">' + esc(e.what || '') + '</td></tr>';
    }).join('') + '</table></div>' : '<div class="note">' + T('revNone') + '</div>') + '</div>';
  /* registro owner: ruoli, funzioni e nomi */
  var cntO = {}, cntS = {};
  STATE.targets.forEach(function (t) { t.atts.forEach(function (a) {
    if (a.owner) cntO[a.owner] = (cntO[a.owner] || 0) + 1;
    (a.support || []).forEach(function (o) { cntS[o] = (cntS[o] || 0) + 1; });
  }); });
  h += '<div class="card"><h3>' + T('ownerBox') + '</h3><div class="note" style="margin-bottom:8px">' + T('ownerBoxHint') + '</div>' +
    '<div class="tbl-wrap"><table class="wl"><thead><tr><th style="text-align:left">' + T('ruolo') + '</th><th style="text-align:left">' + T('funzione') + '</th><th style="text-align:left">' + T('manager') + '</th><th>' + T('nAss') + '</th><th></th></tr></thead><tbody>';
  (STATE.team || []).forEach(function (mrow, i) {
    var k = mrow.person_id;
    h += '<tr>' +
      '<td style="text-align:left"><input ' + (canEdit() ? '' : 'disabled ') + 'style="border:1px solid var(--line);border-radius:7px;padding:4px 7px;font:inherit;font-weight:700;color:var(--jet);width:100%" placeholder="' + T('ruolo') + '" value="' + esc(mrow.r) + '"' + hx(function (el) { edTeam(i, 'r', el.value); }) + '></td>' +
      '<td style="text-align:left"><select ' + (canEdit() ? '' : 'disabled ') + 'style="border:1px solid var(--line);border-radius:7px;padding:4px;font:inherit"' + hx(function (el) { edTeam(i, 'f', el.value); }) + '>' +
      '<option ' + (mrow.f === 'Interna' ? 'selected' : '') + ' value="Interna">' + T('interna') + '</option>' +
      '<option ' + (mrow.f === 'Esterna' ? 'selected' : '') + ' value="Esterna">' + T('esterna') + '</option></select></td>' +
      '<td style="text-align:left"><b>' + esc(mrow.n) + '</b>' + (mrow.job_title ? ' <span style="color:var(--ink-3)">· ' + esc(mrow.job_title) + '</span>' : '') +
      ' <a href="#" style="color:var(--teal);font-size:11px"' + hc(function () { goSuite('/people/' + k); }) + '>' + T('openPerson') + '</a></td>' +
      '<td><span class="badge ' + (cntO[k] || cntS[k] ? 'info' : 'warn') + '" title="Owner + Support">' + (cntO[k] || 0) + ' + ' + (cntS[k] || 0) + 'S</span></td>' +
      '<td>' + (canEdit() ? '<button class="btn mini danger"' + hc(function () { delTeam(i); }) + '>✕</button>' : '') + '</td></tr>';
  });
  h += '</tbody></table></div>' + (!(STATE.team || []).length ? '<div class="note" style="margin-top:8px">' + T('teamEmpty') + '</div>' : '') +
    '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">' + (canEdit() ? '<button class="btn mini ghost"' + hc(addTeam) + '>' + T('addRole') + '</button>' : '') +
    '<button class="btn mini ghost"' + hc(function () { goSuite('/people'); }) + '>' + T('openAdmin') + ' → ' + T('persona') + '</button></div></div>';
  h += '<div class="card"><h3>' + T('workload') + ' (' + (LANG === 'it' ? 'tutte le società' : 'all companies') + ')</h3>' + workloadTable(null) + '</div>';
  m.innerHTML = h;
}
function edTeam(i, k, v) { if (!canEdit()) return roToast(); STATE.team[i][k] = v; STATE.team[i].lm = Date.now(); SYNC.team(); render(); }
function delTeam(i) { if (!canEdit()) return roToast(); STATE.team.splice(i, 1); SYNC.team(); render(); }
/* aggiunta di una persona dall'anagrafica unica (GET /people del modulo: chi ha un grant sul modulo viene prima) */
function addTeam() {
  if (!canEdit()) return roToast();
  IPM_OPTS.api.get('/people').then(function (list) {
    var inTeam = {}; (STATE.team || []).forEach(function (m) { inTeam[m.person_id] = 1; });
    var opts = (list || []).filter(function (p) { return !inTeam[p.id]; }).map(function (p) {
      return { value: p.id, label: (p.has_grant ? '● ' : '') + p.name + (p.job_title ? ' · ' + p.job_title : '') };
    });
    if (!opts.length) return tdAlert(T('noPersonAvail'));
    tdSelect(T('pickPerson'), opts, function (v) {
      var p = (list || []).find(function (x) { return x.id === pid(v); });
      if (!p) return;
      if (!person(p.id)) STATE.people.push({ id: p.id, name: p.name, email: p.email, job_title: p.job_title, in_team: true });
      STATE.team.push({ person_id: p.id, r: '', f: p.kind === 'ESTERNO' ? 'Esterna' : 'Interna', n: p.name, job_title: p.job_title, lm: Date.now() });
      SYNC.team(); render();
    });
  }).catch(function (e) { tdAlert((e && e.message) || 'Errore'); });
}
/* finestra closing: dal primo all'ultimo closing delle target nel piano */
function closingWindow() {
  var ds = STATE.targets.map(function (t) { return t.closing; }).filter(function (d) { return d; }).sort();
  if (!ds.length) return '-';
  var a = new Date(ds[0] + 'T12:00:00'), b = new Date(ds[ds.length - 1] + 'T12:00:00');
  var M = LANG === 'it' ? ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'] : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var fa = M[a.getMonth()] + ' ' + a.getFullYear(), fb = M[b.getMonth()] + ' ' + b.getFullYear();
  return fa === fb ? fa : fa + ' - ' + fb;
}

/* ---------------- scheda target ---------------- */
var LINEE = [['lab', 'lin_lab'], ['img', 'lin_img'], ['spec', 'lin_spec'], ['lav', 'lin_lav'], ['chir', 'lin_chir'], ['altro', 'lin_altro']];
function renderTarget(m, t) {
  if (!t) { STATE.page = 'cover'; return renderCover(m); }
  var h = '';
  /* anagrafica */
  h += '<div class="card"><h3 style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">' +
    '<span>' + esc(t.nome) + ' · ' + T('anagrafica') + (t.kind && t.kind !== 'TARGET' ? ' <span class="badge info" style="font-size:9px">' + esc(t.kind) + '</span>' : '') + '</span>' +
    '<span style="display:flex;gap:6px;flex-wrap:wrap">' +
    '<button class="btn mini ghost"' + hc(function () { goSuite('/admin/organizations'); }) + '>' + T('openAdmin') + '</button>' +
    (canEdit() ? '<button class="btn mini danger"' + hc(function () { delTarget(t.id); }) + '>🗑 ' + T('delTarget') + '</button>' : '') + '</span></h3>' +
    '<div class="note" style="margin-bottom:8px">' + T('anagHint') + '</div><div class="frm">' +
    rfld(t.rs, T('rs')) + rfld(t.ind, T('ind')) + rfld(t.piva, T('piva')) + rfld(t.tel, T('tel')) + rfld(t.mail, T('mail')) + rfld(t.web, T('web')) + rfld(t.pec, T('pec')) +
    '</div><div class="frm" style="margin-top:10px">' +
    fld(t, 'ref', T('ref')) + nfld(t, 'fatt', T('fatt')) + nfld(t, 'pfn', T('pfn')) + nfld(t, 'ev', T('ev')) +
    '<div class="fld"><label>' + T('planStatus') + '</label><select' + hx(function (el) { setF(t.id, 'status', el.value); }) + '>' +
    ['ATTIVO', 'SOSPESO', 'CONCLUSO'].map(function (k) { return '<option value="' + k + '" ' + (t.status === k ? 'selected' : '') + '>' + T('ps' + k) + '</option>'; }).join('') + '</select></div>' +
    '<div class="fld" style="grid-column:span 2"><label>' + T('noteT') + '</label><input value="' + esc(t.note || '') + '"' + hx(function (el) { setF(t.id, 'note', el.value); }) + '></div>' +
    '</div><div style="margin-top:10px"><label style="font-size:10.5px;text-transform:uppercase;color:var(--ink-3);font-weight:700">' + T('linee') + '</label>' +
    '<div class="chips" style="margin-top:4px">' + LINEE.map(function (l) {
      return '<span class="chip ' + (t.linee.indexOf(l[0]) >= 0 ? 'on' : '') + '"' + hc(function () { togLinea(t.id, l[0]); }) + '>' + T(l[1]) + '</span>';
    }).join('') + '</div></div></div>';
  /* operazione */
  var sd = startDate(t);
  h += '<div class="card"><h3>' + T('operazione') + '</h3><div class="opbox">' +
    dfld(t, 'loi', T('loi')) + dfld(t, 'prelim', T('prelim')) + dfld(t, 'closing', T('closing')) +
    '<div class="fld"><label>' + T('orizzonte') + '</label><input type="number" min="8" max="52" value="' + t.hor + '"' + hx(function (el) { setHor(t.id, el.value); }) + '></div>' +
    (sd ? '<span class="badge info">' + T('settDal') + ' ' + fmtDY(sd) + '</span>' : '<span class="badge crit">' + T('noDate') + '</span>') + '</div>' +
    '<div class="note" style="margin-top:6px">' + T('ganttStart') + '</div></div>';
  /* gantt */
  h += '<div class="card"><h3 style="display:flex;justify-content:space-between;align-items:center"><span>' + T('gantt') + '</span>' +
    (sd ? '<span style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">' +
      '<button class="btn mini ghost"' + hc(function () { sortChrono(t.id); }) + '>' + T('sortChrono') + '</button>' +
      '<button class="btn mini ghost" title="' + T('alignTip') + '"' + hc(function () { alignOwnership(t.id); }) + '>' + T('alignBtn') + '</button></span>' : '') + '</h3>' +
    (sd ? '<div class="note" style="margin-bottom:8px">' + T('ganttHint') + ' ' + T('drag') + '</div>' + ganttTable(t) + legendHtml()
        : '<div class="badge crit" style="font-size:13px;padding:10px 16px">' + T('noDate') + '</div>') + '</div>';
  /* alert + workload */
  h += '<div class="grid" style="grid-template-columns:1fr 1fr">' +
    '<div class="card"><h3>' + T('alerts') + '</h3>' + alertsHtml(t) + '</div>' +
    '<div class="card"><h3>' + T('workload') + '</h3>' + workloadTable(t) + '</div></div>';
  /* catalogo */
  h += '<div class="card"><h3>' + T('catalogo') + '</h3><div class="note">' + T('catHint') + '</div>' + catalogHtml(t) +
    '<div style="margin-top:12px;border-top:1px solid var(--line);padding-top:10px"><b style="font-size:13px;color:var(--teal)">' + T('addCustom') + '</b>' +
    '<div class="frm" style="margin-top:6px;grid-template-columns:2fr 1fr 1fr auto">' +
    '<div class="fld"><label>' + T('nome') + '</label><input id="cust_nome"></div>' +
    '<div class="fld"><label>' + T('proc') + '</label><select id="cust_proc">' + Object.keys(PROCS).map(function (k) { return '<option value="' + k + '">' + L(PROCS[k]) + '</option>'; }).join('') + '</select></div>' +
    '<div class="fld"><label>Owner</label><select id="cust_ow"><option value="">' + T('nessuno') + '</option>' +
    ownerOpts(null) + '</select></div>' +
    '<div class="fld"><label>&nbsp;</label><button class="btn canary"' + hc(function () { addCustom(t.id); }) + '>+ ' + T('add') + '</button></div>' +
    '</div></div></div>';
  m.innerHTML = h;
}
function fld(t, k, lab) {
  return '<div class="fld"><label>' + lab + '</label><input value="' + esc(t[k] || '') + '"' + hx(function (el) { setF(t.id, k, el.value); }) + '></div>';
}
/* campo in sola lettura (dati che vengono dall'anagrafica unica) */
function rfld(v, lab) {
  return '<div class="fld"><label>' + lab + '</label><input readonly tabindex="-1" style="background:#F3F6F7;color:var(--ink-2)" value="' + esc(v || '') + '" title="' + esc(T('openAdmin')) + '"></div>';
}
/* campo numerico con separatore delle migliaia (fatturato, PFN, EV) */
function nfld(t, k, lab) {
  return '<div class="fld"><label>' + lab + '</label><input value="' + esc(fmtMil(t[k])) + '" inputmode="numeric"' + hx(function (el) { setNF(t.id, k, el.value); }) + '></div>';
}
function setNF(tid, k, v) {
  if (!canEdit()) return roToast();
  var n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
  var t = tg(tid); t[k] = isNaN(n) ? '' : n; touch(t);
  render();
}
function delTarget(tid) {
  if (!canEdit()) return roToast();
  var t = tg(tid);
  tdConfirm(T('confermaDel') + ' ' + t.nome + '?', function () {
    STATE.targets = STATE.targets.filter(function (x) { return x.id !== tid; });
    SYNC.deleteTarget(tid);
    go('cover');
  });
}
function dfld(t, k, lab) {
  return '<div class="fld"><label>' + lab + '</label><input type="date" value="' + (t[k] || '') + '"' + hx(function (el) { setF(t.id, k, el.value); }) + '></div>';
}
function setF(tid, k, v) { if (!canEdit()) return roToast(); var t = tg(tid); t[k] = v; touch(t); render(); }
function setHor(tid, v) { if (!canEdit()) return roToast(); var t = tg(tid); t.hor = Math.max(8, Math.min(52, +v || 24)); touch(t); render(); }
function togLinea(tid, l) {
  if (!canEdit()) return roToast();
  var t = tg(tid); t.linee = t.linee || []; var i = t.linee.indexOf(l);
  if (i >= 0) t.linee.splice(i, 1); else t.linee.push(l);
  touch(t);
  render();
}
function tg(tid) { return STATE.targets.find(function (t) { return t.id === tid; }); }

/* ---------------- gantt ---------------- */
var OPEN_EDIT = null;
function closingWeek(t) {
  if (!t.closing) return null;
  var sd = startDate(t); if (!sd) return null;
  return Math.round((mondayOf(t.closing) - sd) / (7 * 864e5)) + 1;
}
function ganttTable(t) {
  var sd = startDate(t), W = t.hor;
  var cw = closingWeek(t);
  var d100 = t.closing ? Math.ceil((Math.round((mondayOf(t.closing) - sd) / (7 * 864e5)) * 7 + 100) / 7) : null;
  var h = '<div class="gwrap"><table class="gantt"><thead><tr><th class="actcol">' + T('attivita') + '</th>';
  for (var w = 1; w <= W; w++) {
    var cls = (w === d100 ? 'm100' : '');
    var tag = w === cw ? ' ★' : '';
    h += '<th class="' + cls + '" title="' + (w === d100 ? T('day100') : '') + '">W' + w + tag + '<span class="wd">' + fmtD(addW(sd, w - 1)) + '</span></th>';
  }
  h += '</tr></thead><tbody>';
  /* milestone dell'operazione: Preliminare (se valorizzato) e Closing (sempre, con data) */
  function msRow(label, dstr, color) {
    if (!dstr) return '';
    var wk = weekOfDate(t, dstr);
    var r = '<tr style="background:#FFFDF2"><td class="actcol" style="background:#FFFDF2">' +
      '<div class="an" style="color:var(--jet)">◆ ' + label + ' · ' + fmtDY(new Date(dstr + 'T12:00:00')) + '</div>' +
      '<span class="stato" style="background:var(--canary);color:var(--jet)">Milestone</span></td>';
    for (var w = 1; w <= W; w++) {
      r += '<td class="wk" style="cursor:default">' + (w === wk ? '<span class="ms" style="color:' + color + ';font-size:17px">◆</span>' : '') + '</td>';
    }
    return r + '</tr>';
  }
  h += msRow(T('prelim'), t.prelim, 'var(--teal)');
  h += msRow(T('closing'), t.closing, 'var(--crit)');
  t.atts.forEach(function (a) {
    var col = PROCS[a.proc] ? PROCS[a.proc].hex : '#888';
    var wDone = a.fine ? weekOfDate(t, a.fine) : null;
    var late = wDone && a.ew && wDone > a.ew;
    h += '<tr class="' + (a.st === 2 ? 'done' : '') + '" data-aid="' + a.id + '"' + hdrop(function (el, ev) { dragDrop(ev, t.id, a.id); }) + '>' +
      '<td class="actcol" draggable="true"' + hd(function (el, ev) { dragStart(ev, a.id); }) + hc(function () { togEdit(t.id, a.id); }) + '>' +
      '<div class="an"><span style="color:var(--ink-3);cursor:grab">⠿</span> <span style="color:' + col + '">●</span> ' + esc(actName(a)) + (a.ms ? ' ◆' : '') + (a.pl ? ' <span class="badge warn" style="font-size:9px">P&L</span>' : '') + '</div>' +
      '<div class="ao">' + (a.owner ? esc(pLabel(a.owner)) : '⚠ ' + (LANG === 'it' ? 'owner da assegnare' : 'owner to assign')) +
      ((a.support || []).length ? ' <span style="color:var(--ink-3);font-weight:500">+ ' + esc(a.support.map(pName).join(', ')) + '</span>' : '') + '</div>' +
      (a.dett ? '<div class="ad">' + esc(a.dett) + '</div>' : '') +
      '<span class="stato st' + a.st + '">' + T('st' + a.st) + '</span>' +
      (a.fine ? ' <span class="stato ' + (late ? 'st3' : 'st2') + '">✓ ' + fmtDY(new Date(a.fine + 'T12:00:00')) + '</span>' : '') + '</td>';
    var barEnd = Math.max(a.ew || 0, wDone || 0);
    for (let w = 1; w <= W; w++) {
      var inPlan = a.sw && w >= a.sw && w <= a.ew;
      var inLate = late && w > a.ew && w <= wDone;
      var inbar = inPlan || inLate;
      var cls = inbar ? 'fill ' + (a.sw === barEnd ? 'startend' : w === a.sw ? 'start' : w === barEnd ? 'end' : '') : '';
      var style = inPlan ? 'background:' + col + (a.st === 2 ? '55' : '') + ';'
                : inLate ? 'background:' + col + '40;border-bottom:2.5px solid var(--crit);' : '';
      var mark = (a.ms && inPlan && w === a.sw ? '<span class="ms">◆</span>' : '') +
        (wDone && w === wDone ? '<span class="ms" style="color:' + (late ? 'var(--crit)' : 'var(--good)') + '">✓</span>' : '');
      h += '<td class="wk ' + cls + '" style="' + style + '"' + hc(function () { cellClick(t.id, a.id, w); }) + '>' + mark + '</td>';
    }
    h += '</tr>';
    if (OPEN_EDIT === a.id) h += editRow(t, a, W);
  });
  h += '</tbody></table></div>';
  return h;
}
/* drag & drop riordino attivita' */
var DRAG_AID = null;
function dragStart(ev, aid) { DRAG_AID = aid; OPEN_EDIT = null; ev.dataTransfer.effectAllowed = 'move'; }
function dragOver(ev, tr) { if (DRAG_AID) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; } }
function dragDrop(ev, tid, aid) {
  ev.preventDefault();
  if (!canEdit()) { DRAG_AID = null; return roToast(); }
  if (!DRAG_AID || DRAG_AID === aid) { DRAG_AID = null; return; }
  var t = tg(tid);
  var from = t.atts.findIndex(function (x) { return x.id === DRAG_AID; });
  var to = t.atts.findIndex(function (x) { return x.id === aid; });
  if (from < 0 || to < 0) { DRAG_AID = null; return; }
  var moved = t.atts.splice(from, 1)[0];
  t.atts.splice(to, 0, moved);
  DRAG_AID = null;
  SYNC.reorder(t);
  render();
}
function editRow(t, a, W) {
  return '<tr class="aedit"><td colspan="' + (W + 1) + '"><div class="frm">' +
    '<div class="fld" style="grid-column:span 2"><label>' + T('attivita') + '</label><input value="' + esc(actName(a)) + '"'+ hx(function (el) { edA(t.id, a.id, 'nome', el.value); }) + '></div>' +
    '<div class="fld"><label>' + T('owners') + '</label><select'+ hx(function (el) { edA(t.id, a.id, 'owner', el.value); }) + '>' +
    '<option value="">' + T('nessuno') + '</option>' + ownerOpts(a.owner) + '</select></div>' +
    '<div class="fld"><label>' + T('support') + '</label><details class="msdd"><summary>' + ((a.support || []).length ? esc(a.support.map(pName).join(', ')) : T('selSupport')) + '</summary><div class="msdd-list">' +
    allOwners().filter(function (r) { return r !== pid(a.owner); }).map(function (r) {
      var on = (a.support || []).indexOf(r) >= 0;
      return '<span class="chip ' + (on ? 'on' : '') + '"' + hc(function () { togSupport(t.id, a.id, r); }) + '>' + esc(pLabel(r)) + '</span>';
    }).join('') + '</div></details></div>' +
    '<div class="fld"><label>' + T('proc') + '</label><select'+ hx(function (el) { edA(t.id, a.id, 'proc', el.value); }) + '>' +
    Object.keys(PROCS).map(function (k) { return '<option value="' + k + '" ' + (a.proc === k ? 'selected' : '') + '>' + L(PROCS[k]) + '</option>'; }).join('') + '</select></div>' +
    '<div class="fld"><label>' + T('status') + '</label><select'+ hx(function (el) { edA(t.id, a.id, 'st', el.value); }) + '>' +
    [0, 1, 2, 3].map(function (s) { return '<option value="' + s + '" ' + (a.st === s ? 'selected' : '') + '>' + T('st' + s) + '</option>'; }).join('') + '</select></div>' +
    '<div class="fld"><label>' + T('sw') + '</label><input type="number" min="0" max="' + W + '" value="' + (a.sw || 0) + '"'+ hx(function (el) { edA(t.id, a.id, 'sw', el.value); }) + '></div>' +
    '<div class="fld"><label>' + T('ew') + '</label><input type="number" min="0" max="' + W + '" value="' + (a.ew || 0) + '"'+ hx(function (el) { edA(t.id, a.id, 'ew', el.value); }) + '></div>' +
    '<div class="fld" style="grid-column:span 2"><label>' + T('dett') + '</label><input value="' + esc(a.dett || '') + '"'+ hx(function (el) { edA(t.id, a.id, 'dett', el.value); }) + '></div>' +
    '<div class="fld" style="grid-column:span 2"><label>' + T('note') + '</label><input value="' + esc(a.note || '') + '"'+ hx(function (el) { edA(t.id, a.id, 'note', el.value); }) + '></div>' +
    '<div class="fld"><label>' + T('fineEff') + '</label><input type="date" value="' + (a.fine || '') + '"'+ hx(function (el) { edA(t.id, a.id, 'fine', el.value); }) + '></div>' +
    '<div class="fld"><label>' + T('pl') + '</label><input type="checkbox" style="width:20px" ' + (a.pl ? 'checked' : '') + ''+ hx(function (el) { edA(t.id, a.id, 'pl', el.checked); }) + '></div>' +
    '<div class="fld"><label>' + T('ms') + '</label><input type="checkbox" style="width:20px" ' + (a.ms ? 'checked' : '') + ''+ hx(function (el) { edA(t.id, a.id, 'ms', el.checked); }) + '></div>' +
    '</div><div style="margin-top:8px;display:flex;gap:8px">' +
    '<button class="btn mini ghost"' + hc(function () { togEdit(t.id, null); }) + '>' + T('chiudi') + '</button>' +
    '<button class="btn mini danger"' + hc(function () { delA(t.id, a.id); }) + '>🗑 ' + T('del') + '</button></div></td></tr>';
}
function togEdit(tid, aid) { OPEN_EDIT = (OPEN_EDIT === aid ? null : aid); render(); }
function edA(tid, aid, k, v) {
  if (!canEdit()) return roToast();
  var a = tg(tid).atts.find(function (x) { return x.id === aid; });
  if (k === 'owner') { a.owner = pid(v); a.support = (a.support || []).filter(function (x) { return x !== a.owner; }); }
  else if (k === 'nome') a.nome = v;
  else if (k === 'sw' || k === 'ew') { a[k] = Math.max(0, +v || 0); if (a.sw && a.ew < a.sw) a.ew = a.sw; }
  else if (k === 'st') { a.st = +v; if (a.st !== 2) a.fine = ''; }
  else if (k === 'fine') { a.fine = v; if (v) a.st = 2; else if (a.st === 2) a.st = 1; }
  else a[k] = v;
  touch(a);
  render();
}
function togSupport(tid, aid, r) {
  if (!canEdit()) return roToast();
  var a = tg(tid).atts.find(function (x) { return x.id === aid; });
  a.support = a.support || []; r = pid(r);
  var i = a.support.indexOf(r);
  if (i >= 0) a.support.splice(i, 1); else a.support.push(r);
  touch(a);
  render();
  var dd = document.querySelector('.aedit details.msdd');
  if (dd) dd.open = true;
}
function delA(tid, aid) {
  if (!canEdit()) return roToast();
  var t = tg(tid);
  t.atts = t.atts.filter(function (x) { return x.id !== aid; });
  SYNC.deleteActivity(tid, aid);
  OPEN_EDIT = null; render();
}
function cellClick(tid, aid, w) {
  if (!canEdit()) return roToast();
  var a = tg(tid).atts.find(function (x) { return x.id === aid; });
  if (!a.sw) { a.sw = a.ew = w; }
  else if (w < a.sw) a.sw = w;
  else if (w > a.ew) a.ew = w;
  else if (a.sw === a.ew && w === a.sw) { a.sw = a.ew = 0; }
  else if (w === a.sw) a.sw++;
  else if (w === a.ew) a.ew--;
  else a.ew = w;
  touch(a);
  render();
}
function legendHtml() {
  return '<div class="legend">' + Object.keys(PROCS).map(function (k) {
    return '<span class="it"><span class="sw" style="background:' + PROCS[k].hex + '"></span>' + L(PROCS[k]) + '</span>';
  }).join('') + '<span class="it">◆ ' + T('ms') + '</span><span class="it">★ ' + T('wClosing') + '</span></div>';
}

/* ---------------- catalogo ---------------- */
function catalogHtml(t) {
  var used = {};
  t.atts.forEach(function (a) { if (a.cid && a.cid !== 'nuova') used[a.cid] = 1; });
  var groups = [
    { tit: { it: 'Adempimenti generali (piano master Day 1-100)', en: 'General obligations (master plan Day 1-100)' }, list: CAT_GEN },
    { tit: { it: 'Attività operative TD', en: 'TD operating activities' }, list: CAT_OPS }
  ];
  return groups.map(function (g) {
    return '<div class="catgrp"><div class="cgh">' + L(g.tit) + '</div>' + g.list.map(function (c) {
      var u = used[c.cid];
      return '<div class="catrow ' + (u ? 'used' : '') + '"><span class="dot" style="background:' + PROCS[c.proc].hex + '"></span>' +
        '<span class="cn">' + (c.gen ? '<b>' + c.cid + '</b> · ' : '') + esc(L({ it: c.it, en: c.en })) + '</span>' +
        (u ? '' : '<button class="btn mini ghost"' + hc(function () { addFromCat(t.id, c.cid); }) + '>+ ' + T('add') + '</button>') + '</div>';
    }).join('') + '</div>';
  }).join('');
}
function addFromCat(tid, cid) {
  if (!canEdit()) return roToast();
  var t = tg(tid), c = catById(cid);
  var a = act(cid, c.sw || 0, c.ew || 0);
  a.id = 'cat_' + cid;
  if (t.atts.some(function (x) { return x.id === a.id; })) a.id += '_' + Date.now().toString(36);
  bindAct(a, t.id);
  t.atts.push(a);
  SYNC.createActivity(t, a);
  render();
}
function addCustom(tid) {
  if (!canEdit()) return roToast();
  var t = tg(tid);
  var nome = byId('cust_nome').value.trim();
  if (!nome) return;
  var a = act('nuova', 0, 0, pid(byId('cust_ow').value) ? [pid(byId('cust_ow').value)] : [],
    { nome: nome, proc: byId('cust_proc').value });
  a.id = 'x' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
  bindAct(a, t.id);
  t.atts.push(a);
  SYNC.createActivity(t, a);
  OPEN_EDIT = a.id;
  render();
}
function addTarget() {
  if (!canEdit()) return roToast();
  IPM_OPTS.api.get('/organizations').then(function (list) {
    var opts = (list || []).filter(function (o) { return !o.in_plan && o.kind === 'TARGET'; }).map(function (o) {
      return { value: o.id, label: o.name + (o.city ? ' · ' + o.city : '') + (o.vat_number ? ' · P.IVA ' + o.vat_number : '') };
    });
    if (!opts.length) {
      return tdConfirm(T('noTargetAvail'), function () { goSuite('/admin/organizations'); }, null, T('openAdmin'));
    }
    tdSelect(T('pickTarget'), opts, function (v) {
      var org = (list || []).find(function (o) { return o.id === pid(v); });
      if (!org) return;
      var nt = { id: org.id, org_id: org.id, nome: org.name, rs: org.name, ind: '', piva: org.vat_number || '', ref: '', fatt: '', pfn: '', ev: '',
        linee: [], loi: '', prelim: '', closing: '', hor: 24, note: '', status: 'ATTIVO', atts: genActs() };
      nt.atts.forEach(function (a) { bindAct(a, nt.id); });
      nt.lm = Date.now();
      STATE.targets.push(nt);
      SYNC.createTarget(nt);
      go(org.id);
    }, T('openAdmin'), function () { goSuite('/admin/organizations'); });
  }).catch(function (e) { tdAlert((e && e.message) || 'Errore'); });
}

/* ---------------- alert + workload ---------------- */
function jumpToAct(tid, aid) {
  STATE.page = tid; OPEN_EDIT = aid; render();
  var tr = document.querySelector('tr[data-aid="' + aid + '"]');
  if (tr) tr.scrollIntoView({ block: 'center' });
}
function alertsHtml(t) {
  var noOw = t.atts.filter(function (a) { return !a.owner; });
  var noPlan = t.atts.filter(function (a) { return !a.sw; }).length;
  var crit = t.atts.filter(function (a) { return a.st === 3; }).length;
  var late = t.atts.filter(function (a) { var w = a.fine ? weekOfDate(t, a.fine) : null; return w && a.ew && w > a.ew; }).length;
  var li = [];
  if (noOw.length) {
    li.push('<li><span class="badge crit">' + noOw.length + '</span> ' + T('alOwner') + ' (' + T('clickFix') + '):</li>');
    noOw.slice(0, 12).forEach(function (a) {
      li.push('<li style="padding-left:14px">→ <a href="#" style="color:var(--teal);font-weight:650"' + hc(function () { jumpToAct(t.id, a.id); }) + '>' + esc(actName(a)) + '</a></li>');
    });
    if (noOw.length > 12) li.push('<li style="padding-left:14px;color:var(--ink-3)">+ ' + (noOw.length - 12) + '…</li>');
  }
  if (noPlan) li.push('<li><span class="badge warn">' + noPlan + '</span> ' + T('alPlan') + '</li>');
  if (crit) li.push('<li><span class="badge crit">' + crit + '</span> ' + T('alCrit') + '</li>');
  if (late) li.push('<li><span class="badge warn">' + late + '</span> ' + T('alLate') + '</li>');
  var p = Math.round(tProgress(t) * 100);
  var bar = '<div style="margin-bottom:8px"><div style="font-size:11px;color:var(--ink-3)">' + T('progresso') + ': <b>' + p + '%</b></div><div class="pbar"><i style="width:' + p + '%"></i></div></div>';
  return bar + (li.length ? '<ul class="alerts" style="margin:0;padding-left:4px;list-style:none">' + li.join('') + '</ul>'
    : '<div class="badge good">✓ ' + T('alOk') + '</div>');
}
var WL_OPEN = null;
function togWL(o) { o = pid(o); WL_OPEN = (WL_OPEN === o ? null : o); render(); }
function workloadTable(t) {
  var rows = {};
  var list = t ? [t] : STATE.targets;
  list.forEach(function (tt) {
    tt.atts.forEach(function (a) {
      var dur = a.sw ? (a.ew - a.sw + 1) : 0;
      inv(a).forEach(function (o, oi) {
        if (!rows[o]) rows[o] = { n: 0, s: 0, w: 0, acts: [] };
        if (oi === 0) rows[o].n++; else rows[o].s++;
        rows[o].w += dur;
        rows[o].acts.push({ t: tt, a: a, sup: oi > 0 });
      });
    });
  });
  var ks = Object.keys(rows).map(Number).sort(function (a, b) { return rows[b].w - rows[a].w; });
  if (!ks.length) return '<div class="note">-</div>';
  var max = rows[ks[0]].w || 1;
  var h = '<table class="wl"><thead><tr><th>Owner</th><th>' + T('wlAct') + '</th><th>Support</th><th>' + T('wlWeeks') + '</th><th style="width:28%"></th></tr></thead><tbody>';
  ks.forEach(function (k) {
    var nm = teamRole(k);
    h += '<tr style="cursor:pointer"' + hc(function () { togWL(k); }) + '><td>' + (WL_OPEN === k ? '▾' : '▸') + ' <b>' + esc(pName(k)) + '</b>' + (nm ? ' <span style="color:var(--ink-3)">· ' + esc(nm) + '</span>' : '') + '</td><td>' + rows[k].n + '</td><td>' + rows[k].s + '</td><td>' + rows[k].w + '</td>' +
      '<td><div class="pbar"><i style="width:' + Math.round(rows[k].w / max * 100) + '%"></i></div></td></tr>';
    if (WL_OPEN === k) {
      h += '<tr><td colspan="5" style="background:#F7FAFA;padding:8px 10px"><div style="font-size:11px;color:var(--ink-3);margin-bottom:4px">' + T('ownerActs') + ' ' + esc(pName(k)) + ':</div>' +
        rows[k].acts.map(function (x) {
          return '<div style="font-size:12px;margin:2px 0">→ <b>' + esc(x.t.nome) + '</b> · <a href="#" style="color:var(--teal)"' + hc(function () { jumpToAct(x.t.id, x.a.id); }) + '>' + esc(actName(x.a)) + '</a>' +
            (x.sup ? ' <span class="badge info" style="font-size:9px">SUPPORT</span>' : '') +
            (x.a.sw ? ' <span style="color:var(--ink-3)">(W' + x.a.sw + '-W' + x.a.ew + ')</span>' : '') +
            ' <span class="stato st' + x.a.st + '">' + T('st' + x.a.st) + '</span></div>';
        }).join('') + '</td></tr>';
    }
  });
  return h + '</tbody></table>';
}

/* ---------------- stampa ---------------- */
function openPrint() {
  var sel = byId('pr_owner');
  sel.innerHTML = '<option value="*">' + (LANG === 'it' ? 'Tutti gli owner' : 'All owners') + '</option>' +
    allOwners().map(function (o) { return '<option value="' + o + '">' + esc(pLabel(o)) + '</option>'; }).join('');
  byId('pm_t').textContent = T('printTitle');
  byId('pm_l1').textContent = T('pScope'); byId('pm_l2').textContent = T('pMode');
  byId('pm_o1').textContent = T('pThis'); byId('pm_o2').textContent = T('pAll');
  byId('pm_o3').textContent = T('pFull'); byId('pm_o4').textContent = T('pOwner');
  byId('pm_c').textContent = T('annulla'); byId('pm_go').textContent = T('pGo');
  byId('printmodal').classList.add('show');
}
function doPrint() {
  var scope = byId('pr_scope').value, mode = byId('pr_mode').value, owner = byId('pr_owner').value;
  if (owner !== '*') owner = pid(owner);
  var list = (scope === 'this' && STATE.page !== 'cover' ? [tg(STATE.page)] : STATE.targets)
    .filter(function (t) { return startDate(t); });
  var pa = byId('printarea'), h = '';
  if (mode === 'full') {
    list.forEach(function (t) { h += printSec(t, null); });
  } else if (list.length === 1) {
    var ows1 = owner === '*' ? ownersOf(list[0]) : [owner];
    ows1.forEach(function (o) { if (hasOwner(list[0], o)) h += printSec(list[0], o); });
  } else {
    /* piu' societa' + per owner: vista sovrapposta su calendario comune */
    var allOws = owner === '*' ? (function () {
      var s = {};
      list.forEach(function (t) { ownersOf(t).forEach(function (o) { s[o] = 1; }); });
      return Object.keys(s).map(Number).sort(function (a, b) { return pName(a).localeCompare(pName(b)); });
    })() : [owner];
    allOws.forEach(function (o) { h += printOverlay(list, o); });
  }
  byId('printmodal').classList.remove('show');
  printHtml(h, pa);
}
/* Stampa in una finestra dedicata (solo il GANTT, con i suoi stili); se il browser blocca la finestra si usa l'area nascosta della pagina */
var PRINT_CSS = '@page { size: A4 landscape; margin: 8mm; }' +
  'body { font-family: "Manrope Variable", "Segoe UI", system-ui, -apple-system, sans-serif; color: #0f2a33; margin: 0; }' +
  '.psec { break-after: page; } .psec:last-child { break-after: auto; }' +
  '.phead { display: flex; justify-content: space-between; align-items: center; border-bottom: 2.5px solid #01212C; padding-bottom: 6px; margin-bottom: 8px; }' +
  '.phead .t1 { font-size: 17px; font-weight: 800; color: #01212C; } .phead .t2 { font-size: 11px; color: #48656F; }' +
  'table.pgantt { border-collapse: collapse; width: 100%; font-size: 8.5px; }' +
  '.pgantt th, .pgantt td { border: .5px solid #B9C7CC; padding: 2px 3px; }' +
  '.pgantt thead th { background: #01212C !important; color: #fff; font-size: 7.5px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }' +
  '.pgantt td.on { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .pgantt td.acol { text-align: left; max-width: 200px; }' +
  '.pgantt tr { break-inside: avoid; } .pgantt thead { display: table-header-group; } .plegend { font-size: 8px; margin-top: 5px; color: #333; }' +
  ':root { --jet: #01212C; --teal: #1C505E; --crit: #b3372f; --good: #2f7d5b; --ink-2: #48656F; --ink-3: #7B929A; }';
function printHtml(h, fallbackArea) {
  var w = null;
  try { w = window.open('', '_blank', 'noopener=no,width=1200,height=800'); } catch (e) { w = null; }
  if (w && w.document) {
    w.document.open();
    w.document.write('<!doctype html><html lang="' + LANG + '"><head><meta charset="utf-8"><title>' + esc(T('printTitle')) + '</title><style>' + PRINT_CSS + '</style></head><body>' + h + '</body></html>');
    w.document.close();
    setTimeout(function () { try { w.focus(); w.print(); } catch (e) { /* finestra chiusa */ } }, 400);
    return;
  }
  if (fallbackArea) { fallbackArea.innerHTML = h; setTimeout(function () { window.print(); }, 150); }
}
/* pagina sovrapposta: tutte le attivita' di un owner su un unico calendario, per vedere le sovrapposizioni */
function printOverlay(list, owner) {
  var items = [];
  var g0 = null;
  list.forEach(function (t) {
    var sd = startDate(t);
    if (!g0 || sd < g0) g0 = sd;
  });
  var maxW = 0;
  list.forEach(function (t) {
    var off = Math.round((startDate(t) - g0) / (7 * 864e5));
    t.atts.forEach(function (a) {
      if (inv(a).indexOf(owner) < 0 || !a.sw) return;
      items.push({ t: t, a: a, gs: a.sw + off, ge: a.ew + off, sup: a.owner !== owner });
      if (a.ew + off > maxW) maxW = a.ew + off;
    });
  });
  if (!items.length) return '';
  var W = Math.min(maxW, 40);
  items.sort(function (x, y) { return x.gs - y.gs || x.ge - y.ge; });
  var dens = [];
  for (var w = 1; w <= W; w++) {
    dens[w] = items.filter(function (it) { return w >= it.gs && w <= it.ge; }).length;
  }
  var h = '<div class="psec"><div class="phead"><div><div class="t1">' + esc(pLabel(owner)) + ' · ' + (LANG === 'it' ? 'tutte le società (vista sovrapposta)' : 'all companies (overlaid view)') + '</div>' +
    '<div class="t2">' + T('overlayHint') + '</div></div><div class="t2">' + T('docFooter') + ' · ' + fmtDY(new Date()) + '</div></div>';
  h += '<table class="pgantt"><thead><tr><th style="text-align:left">' + (LANG === 'it' ? 'Società' : 'Company') + '</th><th style="text-align:left">' + T('attivita') + '</th>';
  for (var w = 1; w <= W; w++) h += '<th>W' + w + '<br>' + fmtD(addW(g0, w - 1)) + '</th>';
  h += '</tr></thead><tbody>';
  h += '<tr><td colspan="2" class="acol" style="font-weight:800">' + T('dens') + '</td>';
  for (var w = 1; w <= W; w++) {
    var d = dens[w] || 0;
    h += '<td style="text-align:center;font-weight:800;' + (d >= 3 ? 'background:#B3261E;color:#fff' : d === 2 ? 'background:#F7F052' : '') + '">' + (d || '') + '</td>';
  }
  h += '</tr>';
  /* rombi dei closing di ogni societa' sul calendario comune */
  var seenT = {};
  items.forEach(function (it) { seenT[it.t.id] = it.t; });
  Object.keys(seenT).forEach(function (k) {
    var t = seenT[k];
    if (!t.closing) return;
    var off = Math.round((startDate(t) - g0) / (7 * 864e5));
    var wk = weekOfDate(t, t.closing) + off;
    h += '<tr><td class="acol" style="font-weight:800">' + esc(t.nome) + '</td><td class="acol">◆ ' + T('closing') + ' ' + fmtDY(new Date(t.closing + 'T12:00:00')) + '</td>';
    for (var w = 1; w <= W; w++) h += '<td style="text-align:center;font-weight:800">' + (w === wk ? '◆' : '') + '</td>';
    h += '</tr>';
  });
  items.forEach(function (it) {
    var col = PROCS[it.a.proc] ? PROCS[it.a.proc].hex : '#888';
    h += '<tr><td class="acol" style="font-weight:700">' + esc(it.t.nome) + '</td><td class="acol">' + esc(actName(it.a)) + (it.a.pl ? ' [P&L]' : '') +
      (it.sup ? ' <b>[SUPPORT]</b>' : '') + '</td>';
    for (var w = 1; w <= W; w++) {
      var on = w >= it.gs && w <= it.ge;
      h += '<td class="' + (on ? 'on' : '') + '" style="' + (on ? 'background:' + col : '') + '"></td>';
    }
    h += '</tr>';
  });
  h += '</tbody></table><div class="plegend">' + (LANG === 'it' ? 'Riga in alto: numero di attività in parallelo per settimana (giallo = 2, rosso = 3 o più). Calendario comune dal ' : 'Top row: parallel activities per week (yellow = 2, red = 3+). Common calendar from ') + fmtDY(g0) + '</div></div>';
  return h;
}
function ownersOf(t) {
  var s = {};
  t.atts.forEach(function (a) { inv(a).forEach(function (o) { s[o] = 1; }); });
  return Object.keys(s).map(Number).sort(function (a, b) { return pName(a).localeCompare(pName(b)); });
}
function hasOwner(t, o) { return t.atts.some(function (a) { return inv(a).indexOf(o) >= 0; }); }
function printSec(t, owner) {
  var sd = startDate(t), W = t.hor;
  var atts = owner ? t.atts.filter(function (a) { return inv(a).indexOf(owner) >= 0; }) : t.atts;
  var h = '<div class="psec"><div class="phead"><div><div class="t1">' + esc(t.nome) + (owner ? ' · ' + esc(pLabel(owner)) : '') + '</div>' +
    '<div class="t2">' + esc(t.rs || '') + ' · ' + T('closing') + ': ' + (t.closing ? fmtDY(new Date(t.closing + 'T12:00:00')) : '-') +
    (t.prelim ? ' · ' + T('prelim') + ': ' + fmtDY(new Date(t.prelim + 'T12:00:00')) : '') + '</div></div>' +
    '<div class="t2">' + T('docFooter') + ' · ' + fmtDY(new Date()) + '</div></div>';
  h += '<table class="pgantt"><thead><tr><th style="text-align:left">' + T('attivita') + '</th><th>Owner</th><th>Support</th>';
  for (var w = 1; w <= W; w++) h += '<th>W' + w + '<br>' + fmtD(addW(sd, w - 1)) + '</th>';
  h += '</tr></thead><tbody>';
  [[T('prelim'), t.prelim], [T('closing'), t.closing]].forEach(function (msp) {
    if (!msp[1]) return;
    var wk = weekOfDate(t, msp[1]);
    h += '<tr><td class="acol" style="font-weight:800">◆ ' + msp[0] + '</td><td class="acol" colspan="2">' + fmtDY(new Date(msp[1] + 'T12:00:00')) + '</td>';
    for (var w = 1; w <= W; w++) h += '<td style="text-align:center;font-weight:800">' + (w === wk ? '◆' : '') + '</td>';
    h += '</tr>';
  });
  atts.forEach(function (a) {
    var col = PROCS[a.proc] ? PROCS[a.proc].hex : '#888';
    h += '<tr><td class="acol">' + (a.ms ? '◆ ' : '') + esc(actName(a)) + (a.pl ? ' [P&L]' : '') + '</td>' +
      '<td class="acol" style="max-width:80px">' + esc(a.owner ? pName(a.owner) : '') + '</td>' +
      '<td class="acol" style="max-width:80px">' + esc((a.support || []).map(pName).join(', ')) + '</td>';
    for (var w = 1; w <= W; w++) {
      var on = a.sw && w >= a.sw && w <= a.ew;
      h += '<td class="' + (on ? 'on' : '') + '" style="' + (on ? 'background:' + col : '') + '"></td>';
    }
    h += '</tr>';
  });
  h += '</tbody></table><div class="plegend">' + Object.keys(PROCS).map(function (k) { return L(PROCS[k]); }).join(' · ') + ' · ◆ ' + T('ms') + '</div></div>';
  return h;
}

/* ---------------- export XLSX (zip stored, senza librerie) ---------------- */
var CRC_T = (function () {
  var t = [], c;
  for (var n = 0; n < 256; n++) {
    c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  var c = 0xFFFFFFFF;
  for (var i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function zipStore(files) { /* files: [{name, text}] -> Uint8Array (metodo STORED) */
  var enc = new TextEncoder(), parts = [], central = [], off = 0;
  function u16(v) { return [v & 255, (v >> 8) & 255]; }
  function u32(v) { return [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]; }
  files.forEach(function (f) {
    var name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
    var head = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
    parts.push(new Uint8Array(head), name, data);
    var cen = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0),
      u32(0), u32(off));
    central.push(new Uint8Array(cen), name);
    off += head.length + name.length + data.length;
  });
  var cenLen = 0;
  central.forEach(function (p) { cenLen += p.length; });
  var end = [].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cenLen), u32(off), u16(0));
  var tot = off + cenLen + end.length, out = new Uint8Array(tot), p = 0;
  parts.concat(central, [new Uint8Array(end)]).forEach(function (u) { out.set(u, p); p += u.length; });
  return out;
}
function xesc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function sheetXml(rows) { /* rows: array di array; numeri -> celle numeriche, resto inline string */
  var body = rows.map(function (r, ri) {
    return '<row r="' + (ri + 1) + '">' + r.map(function (v, ci) {
      var ref = colL(ci) + (ri + 1);
      if (typeof v === 'number' && isFinite(v)) return '<c r="' + ref + '"><v>' + v + '</v></c>';
      if (v === '' || v == null) return '';
      return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xesc(v) + '</t></is></c>';
    }).join('') + '</row>';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + body + '</sheetData></worksheet>';
}
function colL(i) { var s = ''; i++; while (i) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
function sheetName(s) { return String(s).replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 28) || 'Target'; }
function exportJSON() { /* mantiene il nome storico del bottone: ora salva XLSX */
  var sheets = [];
  var sum = [[T('targets')],
    ['Target', T('rs'), T('ind'), T('piva'), T('ref'), T('tel'), T('mail'), T('web'), T('pec'), T('fatt'), T('pfn'), T('ev'), T('prelim'), T('closing'), T('planStatus'), T('progresso')]];
  STATE.targets.forEach(function (t) {
    sum.push([t.nome, t.rs, t.ind, t.piva, t.ref, t.tel || '', t.mail || '', t.web || '', t.pec || '', +t.fatt || '', +t.pfn || '', +t.ev || '', t.prelim || '', t.closing || '', T('ps' + (t.status || 'ATTIVO')), Math.round(tProgress(t) * 100) + '%']);
  });
  sheets.push({ name: 'Riepilogo', rows: sum });
  var trows = [[T('ownerBox')], [T('ruolo'), T('funzione'), T('manager'), 'Email']];
  (STATE.team || []).forEach(function (m) { trows.push([m.r, m.f, m.n, m.email || '']); });
  sheets.push({ name: 'Team', rows: trows });
  STATE.targets.forEach(function (t) {
    var sd = startDate(t);
    var rows = [[t.nome + ' - GANTT ' + (sd ? T('settDal') + ' ' + fmtDY(sd) : '')],
      ['ID', T('attivita'), T('proc'), 'Owner', 'Ownership Support', T('sw'), T('ew'), LANG === 'it' ? 'Dal' : 'From', LANG === 'it' ? 'Al' : 'To', T('status'), T('fineEff'), 'P&L', T('ms'), T('dett'), T('note')]];
    t.atts.forEach(function (a) {
      rows.push([a.cid || '', actName(a), L(PROCS[a.proc] || {}), a.owner ? pLabel(a.owner) : '', (a.support || []).map(pName).join(', '),
        a.sw || '', a.ew || '',
        sd && a.sw ? fmtDY(addW(sd, a.sw - 1)) : '', sd && a.ew ? fmtDY(new Date(addW(sd, a.ew - 1).getTime() + 6 * 864e5)) : '',
        T('st' + a.st), a.fine || '', a.pl ? 'X' : '', a.ms ? 'X' : '', a.dett || '', a.note || '']);
    });
    sheets.push({ name: sheetName(t.nome), rows: rows });
  });
  var files = [];
  var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>';
  var wbs = '', rels = '';
  sheets.forEach(function (s, i) {
    var n = i + 1;
    ct += '<Override PartName="/xl/worksheets/sheet' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    wbs += '<sheet name="' + xesc(s.name) + '" sheetId="' + n + '" r:id="rId' + n + '"/>';
    rels += '<Relationship Id="rId' + n + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + n + '.xml"/>';
    files.push({ name: 'xl/worksheets/sheet' + n + '.xml', text: sheetXml(s.rows) });
  });
  ct += '</Types>';
  files.unshift(
    { name: '[Content_Types].xml', text: ct },
    { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + wbs + '</sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + '</Relationships>' }
  );
  var blob = new Blob([zipStore(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  var fname = 'TD_Integration_Plan_' + new Date().toISOString().slice(0, 10) + '.xlsx';
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fname;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  if (IPM_OPTS.onToast) IPM_OPTS.onToast(T('saved'));
}
/* ---------------- banner ---------------- */
function renderBanner() {
  var el = byId('td-banner'); if (!el) return;
  var h = '';
  if (FLASH) h += '<div class="bnr okk">✓ ' + FLASH + '<button class="x"' + hc(function () { FLASH = ''; render(); }) + '>✕</button></div>';
  if (IPM_OPTS.readOnly) h += '<div class="bnr info">🔒 ' + roMsgText() + '</div>';
  el.innerHTML = h;
}
/* ---------------- boot ---------------- */
function setLang(l) {
  LANG = l;
  try { localStorage.setItem('tdi_lang', l); } catch (e) {}
  var bi = byId('lang-it'), be = byId('lang-en');
  if (bi) bi.classList.toggle('on', l === 'it');
  if (be) be.classList.toggle('on', l === 'en');
  render();
}
/* ---------------- finestre di dialogo in pagina (sostituiscono alert/confirm/prompt) ---------------- */
function tdDialog(msg, opts) {
  var old = byId('tddlg'); if (old) old.remove();
  var d = document.createElement('div'); d.className = 'ipm-modal show'; d.id = 'tddlg';
  d.innerHTML = '<div class="mbox"><div class="mrow" style="white-space:pre-wrap">' + esc(msg) + '</div>' +
    (opts.input ? '<div class="mrow"><div class="fld"><input id="tddlg_in" autocomplete="off"></div></div>' : '') +
    (opts.select ? '<div class="mrow"><div class="fld"><select id="tddlg_sel">' + opts.select.map(function (o) { return '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>'; }).join('') + '</select></div></div>' : '') +
    '<div class="mrow" style="display:flex;gap:8px;justify-content:flex-end">' +
    (opts.cancel ? '<button class="btn ghost" id="tddlg_c">' + esc(T('dlgCancel')) + '</button>' : '') +
    (opts.altLabel ? '<button class="btn ghost" id="tddlg_alt">' + esc(opts.altLabel) + '</button>' : '') +
    '<button class="btn canary" id="tddlg_ok">' + esc(opts.okLabel || T('dlgOk')) + '</button></div></div>';
  (byId('ipm-root') || document.body).appendChild(d);
  var close = function () { d.remove(); };
  var ok = function () { var v = opts.input ? (byId('tddlg_in').value || '').trim() : opts.select ? byId('tddlg_sel').value : true; close(); if (opts.onOk) opts.onOk(v); };
  byId('tddlg_ok').onclick = ok;
  if (opts.altLabel) byId('tddlg_alt').onclick = function () { close(); if (opts.onAlt) opts.onAlt(); };
  if (opts.cancel) byId('tddlg_c').onclick = function () { close(); if (opts.onCancel) opts.onCancel(); };
  if (opts.input) { var inp = byId('tddlg_in'); inp.focus(); inp.onkeydown = function (ev) { if (ev.key === 'Enter') ok(); if (ev.key === 'Escape') { close(); if (opts.onCancel) opts.onCancel(); } }; }
  else byId('tddlg_ok').focus();
}
function tdAlert(msg) { tdDialog(msg, {}); }
function tdConfirm(msg, onOk, onCancel, okLabel) { tdDialog(msg, { cancel: true, okLabel: okLabel || T('dlgConfirm'), onOk: onOk, onCancel: onCancel }); }
/* scelta da elenco (persone dell'anagrafica, organizzazioni target); altLabel/onAlt = pulsante secondario (es. Apri in Amministrazione) */
function tdSelect(msg, options, onOk, altLabel, onAlt) { tdDialog(msg, { cancel: true, select: options, okLabel: T('dlgConfirm'), onOk: onOk, altLabel: altLabel, onAlt: onAlt }); }
function tdPrompt(msg, onOk) { tdDialog(msg, { cancel: true, input: true, onOk: onOk }); }
function render() { if (!byId('ipm-main')) return; renderCore(); refreshOwnlist(); }



/* ================= strato dati: REST + SSE ================= */
function bindAct(a, tid) { Object.defineProperty(a, '_t', { value: tid, enumerable: false, writable: true, configurable: true }); return a; }
function cleanObj(o) { var c = {}; Object.keys(o).forEach(function (k) { if (k !== 'atts' && k[0] !== '_') c[k] = o[k]; }); return c; }
/* membro del team per il server: solo person_id, ruolo, funzione, colore */
function cleanMember(m) { return { person_id: m.person_id, r: m.r || '', f: m.f === 'Esterna' ? 'Esterna' : 'Interna', color: m.color || null, lm: m.lm || Date.now() }; }
function applyServerRow(local, row) { Object.keys(row).forEach(function (k) { if (k === 'atts' || k === 'position' || k === 'target_id') return; local[k] = row[k]; }); }

var SYNC = (function () {
  var pending = {};        // key -> {kind, obj, tid}
  var timer = null, inflight = 0, offline = false, lastErr = false;
  var TARGET_DEBOUNCE = 350;
  function key(kind, tid, id) { return kind + ':' + (tid || '') + ':' + (id || ''); }
  function status() {
    if (offline) return 'offline';
    if (lastErr) return 'err';
    if (inflight || Object.keys(pending).length) return 'pending';
    return 'ok';
  }
  function schedule(o) {
    if (!o) return;
    if (o.atts) pending[key('target', o.id)] = { kind: 'target', obj: o };
    else if (o._t) pending[key('act', o._t, o.id)] = { kind: 'act', obj: o, tid: o._t };
    else if ('person_id' in o) { team(); return; }
    clearTimeout(timer); timer = setTimeout(flush, TARGET_DEBOUNCE);
    updateChip();
  }
  function team() { pending[key('team')] = { kind: 'team' }; clearTimeout(timer); timer = setTimeout(flush, TARGET_DEBOUNCE); updateChip(); }
  function reorder(t) { pending[key('order', t.id)] = { kind: 'order', obj: t }; clearTimeout(timer); timer = setTimeout(flush, 50); updateChip(); }
  function createActivity(t, a) { run(function () { return IPM_OPTS.api.post('/targets/' + enc(t.id) + '/activities', cleanObj(a)); }, function (row) { applyServerRow(a, row); }); }
  function deleteActivity(tid, aid) { run(function () { return IPM_OPTS.api.del('/targets/' + enc(tid) + '/activities/' + enc(aid)); }); }
  function createTarget(t) {
    var body = cleanObj(t); body.org_id = t.id; body.atts = t.atts.map(cleanObj);
    run(function () { return IPM_OPTS.api.post('/targets', body); }, function (row) { applyServerRow(t, row); });
  }
  function deleteTarget(tid) { run(function () { return IPM_OPTS.api.del('/targets/' + enc(tid)); }); }
  function enc(s) { return encodeURIComponent(s); }
  function updateChip() { var n = document.querySelector('#ipm-root .syncchip'); if (n) n.outerHTML = syncChipHtml(); }
  function run(fn, onOk) {
    inflight++; updateChip();
    return fn().then(function (row) {
      inflight--; offline = false; lastErr = false;
      if (onOk) onOk(row);
      updateChip();
      return row;
    }).catch(function (e) {
      inflight--;
      handleErr(e);
      updateChip();
    });
  }
  function handleErr(e) {
    if (e && e.status === 409 && e.current) {
      // conflitto: adotta la versione del server
      adoptCurrent(e.current);
      if (IPM_OPTS.onToast) IPM_OPTS.onToast(T('conflictMsg'), 'err');
      render();
      return;
    }
    if (e && e.status === 403) { if (IPM_OPTS.onToast) IPM_OPTS.onToast(e.message || roMsgText(), 'err'); reloadAll(); return; }
    if (e && e.status === 401) return; // gestito dalla shell (sessione scaduta)
    if (!e || !e.status) { offline = true; retrySoon(); return; }
    lastErr = true;
    if (IPM_OPTS.onToast) IPM_OPTS.onToast((e && e.message) || 'Errore di salvataggio', 'err');
  }
  var retryTimer = null;
  function retrySoon() { clearTimeout(retryTimer); retryTimer = setTimeout(function () { flush(); }, 4000); }
  function adoptCurrent(cur) {
    if (cur.kind === 'activity') {
      var t = tg(cur.row.target_id); if (!t) return;
      var a = t.atts.find(function (x) { return x.id === cur.row.id; });
      if (a) applyServerRow(a, cur.row);
    } else if (cur.kind === 'target') {
      var tt = tg(cur.row.id); if (tt) applyServerRow(tt, cur.row);
    }
  }
  function flush() {
    var items = pending; pending = {};
    Object.keys(items).forEach(function (k) {
      var it = items[k];
      if (it.kind === 'act') {
        var a = it.obj, tid = it.tid;
        run(function () { return IPM_OPTS.api.patch('/targets/' + enc(tid) + '/activities/' + enc(a.id), cleanObj(a)); },
            function (row) { applyServerRow(a, row); });
      } else if (it.kind === 'target') {
        var t = it.obj;
        run(function () { return IPM_OPTS.api.patch('/targets/' + enc(t.id), cleanObj(t)); }, function (row) { applyServerRow(t, row); });
      } else if (it.kind === 'order') {
        var tt = it.obj;
        run(function () { return IPM_OPTS.api.put('/targets/' + enc(tt.id) + '/order', { ids: tt.atts.map(function (a) { return a.id; }) }); });
      } else if (it.kind === 'team') {
        run(function () { return IPM_OPTS.api.put('/team', { members: STATE.team.map(cleanMember) }); },
            function (rows) { if (Array.isArray(rows)) { STATE.team = rows; rows.forEach(function (m) { if (!person(m.person_id)) STATE.people.push({ id: m.person_id, name: m.n, email: m.email, job_title: m.job_title, in_team: true }); }); render(); } });
      }
    });
    updateChip();
  }
  function flushNow() { clearTimeout(timer); flush(); }
  return { schedule: schedule, team: team, reorder: reorder, createActivity: createActivity, deleteActivity: deleteActivity,
           createTarget: createTarget, deleteTarget: deleteTarget, status: status, flushNow: flushNow, isIdle: function () { return !inflight && !Object.keys(pending).length; } };
})();

function loadPlan(data) {
  STATE.targets = (data.targets || []).map(function (t) { (t.atts || []).forEach(function (a) { normAtt(a); bindAct(a, t.id); }); return t; });
  STATE.team = data.team || [];
  STATE.people = data.people || [];
  STATE.meta = data.meta || { rev: 0, log: [] };
  ensureMeta();
  if (STATE.page !== 'cover' && !tg(STATE.page)) STATE.page = 'cover';
}
function reloadAll() {
  return IPM_OPTS.api.get('/plan').then(function (d) { loadPlan(d); render(); });
}
/* eventi in tempo reale dagli altri utenti */
function applyRemoteEvent(ev) {
  if (!ev || !ev.type) return;
  if (ev.clientId && ev.clientId === IPM_CLIENT_ID) return;   // già applicato localmente
  var d = ev.data || {};
  if (ev.type === 'activity.updated' || ev.type === 'activity.created') {
    var t = tg(d.target_id); if (!t) return reloadAll();
    var a = t.atts.find(function (x) { return x.id === d.id; });
    if (!a) { a = bindAct({}, t.id); t.atts.push(a); }
    applyServerRow(a, d); normAtt(a);
    if (ev.type === 'activity.created' || d.position != null) { t.atts.sort(function (x, y) { return (x.position || 0) - (y.position || 0); }); }
  } else if (ev.type === 'activity.deleted') {
    var t2 = tg(d.target_id); if (t2) t2.atts = t2.atts.filter(function (x) { return x.id !== d.id; });
  } else if (ev.type === 'activities.reordered') {
    var t3 = tg(d.target_id); if (!t3) return;
    var pos = {}; (d.ids || []).forEach(function (id, i) { pos[id] = i; });
    t3.atts.forEach(function (a) { a.position = pos[a.id] != null ? pos[a.id] : 9999; });
    t3.atts.sort(function (x, y) { return x.position - y.position; });
  } else if (ev.type === 'target.updated') {
    var t4 = tg(d.id); if (t4) applyServerRow(t4, d); else return reloadAll();
  } else if (ev.type === 'target.created' || ev.type === 'target.deleted' || ev.type === 'plan.replaced') {
    return reloadAll();
  } else if (ev.type === 'team.updated') {
    STATE.team = d.members || STATE.team;
    STATE.team.forEach(function (m) { if (!person(m.person_id)) STATE.people.push({ id: m.person_id, name: m.n, email: m.email, job_title: m.job_title, in_team: true }); });
  }
  if (ev.meta) STATE.meta = ev.meta;
  if (ev.by && IPM_OPTS.onToast && ev.type !== 'team.updated') {
    IPM_OPTS.onToast(T('remoteChange').replace('{who}', ev.by).replace('{what}', ev.label || ''), 'info');
  }
  render();
}

var IPM_CLIENT_ID = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
var IPM_ES = null;
function connectEvents() {
  if (IPM_ES) { try { IPM_ES.close(); } catch (e) {} }
  if (typeof EventSource === 'undefined') return;
  IPM_ES = new EventSource(IPM_OPTS.eventsUrl);
  IPM_ES.onmessage = function (m) { try { applyRemoteEvent(JSON.parse(m.data)); } catch (e) {} };
  IPM_ES.onerror = function () { /* il browser riconnette da solo; al ritorno ricarichiamo lo stato */ };
  IPM_ES.onopen = function () { if (IPM_BOOTED) reloadAll(); };
}
var IPM_BOOTED = false;

var IPM = {
  mount: function (opts) {
    IPM_OPTS = Object.assign(IPM_OPTS, opts || {});
    IPM_OPTS.api = Object.assign({}, IPM_OPTS.api, { clientId: IPM_CLIENT_ID });
    try { var l = localStorage.getItem('tdi_lang'); if (l === 'en' || l === 'it') LANG = l; } catch (e) {}
    var root = IPM_OPTS.root || byId('ipm-root') || document.body;
    bindDelegation(root);
    return IPM_OPTS.api.get('/plan').then(function (d) {
      loadPlan(d);
      render();
      connectEvents();
      IPM_BOOTED = true;
    });
  },
  unmount: function () {
    if (IPM_ES) { try { IPM_ES.close(); } catch (e) {} IPM_ES = null; }
    IPM_BOOTED = false;
    if (IPM_UNBIND) IPM_UNBIND();
    HANDLERS = [];
  },
  doPrint: doPrint,
  go: function (p) { go(p); },
  setLang: setLang,
  getLang: function () { return LANG; },
  exportXlsx: function () { exportJSON(); },
  print: function () { openPrint(); },
  flush: function () { SYNC.flushNow(); },
  clientId: IPM_CLIENT_ID,
  state: function () { return STATE; },
};
window.addEventListener('beforeunload', function () { SYNC.flushNow(); });
export default IPM;

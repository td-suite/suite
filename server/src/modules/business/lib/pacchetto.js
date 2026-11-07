// Business Hub · "Pacchetto di benvenuto" (richiesta del CEO del 06/11/2026): regole pure, senza database né rete, usate dalla route,
// dal generatore e dai test (server/test/business-pacchetto.test.mjs).
// "Voglio mandargli l'offerta in un unico pacchetto che contiene la lettera di offerta, il vademecum, le credenziali, una lettera a firma
// mia che gli presenta l'azienda, la presentazione del portale service con il livello di supporto, l'informatizzazione di NC, Ordini,
// SGI, Circolari, Audit, Contatti con il personale. TUTTO!"
// - Sezioni del pacchetto per linea (SRV completo; PP senza vademecum né portale service ma con la rete dei punti; MDL con la medicina
//   del lavoro), nell'ordine di stampa, con le spunte dell'operatore e le sezioni omesse per mancanza di dati (con il motivo).
// - Modelli dei testi (lettera del CEO per linea, email di accompagnamento) con i segnaposto {{cliente}}, {{referente}}, {{data}},
//   {{owner}} e il blocco {{referenti}}: i testi predefiniti si modificano in Impostazioni (app_settings pacchetto.lettera_ceo e
//   pacchetto.email). Nessun nome, numero o impegno inventato: i dati delle persone arrivano dallo specchio del Portale Service
//   (contatti.json) e dai Dati aziendali; se un dato manca la riga si omette.
// - Piano dei primi 30-60-90 giorni con le date calcolate dalla data del pacchetto, checklist per iniziare, pagina delle credenziali
//   (con o senza password, scelta dell'operatore).

export const OGGETTO_EMAIL = 'Toscana Diagnostica · Benvenuto {{cliente}}';
export const SEGNAPOSTO = ['cliente', 'referente', 'data', 'owner'];

// Sezioni nell'ordine di stampa. linee: a quali linee si applicano (assente = tutte). fissa: sempre presente.
export const SEZIONI = [
  { key: 'copertina', titolo: 'Copertina', fissa: true },
  { key: 'indice', titolo: 'Indice', fissa: true },
  { key: 'lettera', titolo: 'Lettera di benvenuto' },
  { key: 'offerta', titolo: 'Lettera di offerta' },
  { key: 'listino', titolo: 'Offerta economica', linee: ['SRV'] },          // dal listino StudioLAB del cliente (processo Service, 06/11/2026)
  { key: 'portale', titolo: 'Il Portale Service e i servizi digitali', linee: ['SRV'] },
  { key: 'network', titolo: 'La rete Toscana Diagnostica', linee: ['PP'] },
  { key: 'mdl', titolo: 'La Medicina del Lavoro', linee: ['MDL'] },
  { key: 'credenziali', titolo: 'Accesso al Portale' },
  { key: 'studiolab', titolo: 'Credenziali StudioLAB', linee: ['SRV'] },    // portale dei referti (contratto della linea o Legal entity)
  { key: 'avvio', titolo: 'I primi 30-60-90 giorni' },
  { key: 'referente', titolo: 'Il vostro referente dedicato' },
  { key: 'diversi', titolo: 'Cosa ci rende diversi' },
  { key: 'checklist', titolo: 'Checklist per iniziare' },
  { key: 'vademecum', titolo: 'Vademecum degli esami', linee: ['SRV'] },
];
const PER_KEY = Object.fromEntries(SEZIONI.map((s) => [s.key, s]));
export const sezioniLinea = (linea) => SEZIONI.filter((s) => !s.linee || s.linee.includes(linea));

// Titolo della sezione offerta secondo quello che c'è: lettera generata (MOD230 service, MOD231 MdL, contratto del punto prelievi) o
// riepilogo della proposta dell'account
export function titoloOfferta(linea, tipo) {
  if (tipo === 'ECONOMICA') return 'Offerta economica';
  if (linea === 'PP') return 'Proposta di contratto';
  return 'Lettera di offerta';
}

// Varianti (processo Service, 06/11/2026): BENVENUTO (il pacchetto di sempre), KIT (kit di proposta: lettera di presentazione e invito,
// offerta, credenziali Suite e StudioLAB), PROSPECT (richiamo periodico: presentazione senza credenziali né offerta)
export const VARIANTI = ['BENVENUTO', 'KIT', 'PROSPECT'];
const SOLO_CLIENTE = ['offerta', 'listino', 'credenziali', 'studiolab', 'avvio', 'checklist'];

/**
 * Composizione del pacchetto: [{ key, titolo, inclusa, fissa, motivo }] per le sezioni della linea, nell'ordine di stampa.
 * scelte: { [key]: false } per escludere (le fisse restano); disp: { offerta: 'PDF'|'ECONOMICA'|null (null = nessuna offerta generata
 * né dati della proposta: la sezione si omette con il motivo), listino: offerta economica dal listino sì/no, studiolab: credenziali
 * StudioLAB sì/no (assente = come prima: le credenziali del portale referti restano nella pagina degli accessi), variante }.
 */
export function componiSezioni(linea, scelte = {}, disp = {}) {
  const variante = VARIANTI.includes(disp.variante) ? disp.variante : 'BENVENUTO';
  return sezioniLinea(linea).map((s) => {
    const out = { key: s.key, titolo: s.titolo, fissa: Boolean(s.fissa), inclusa: true, motivo: null };
    if (variante === 'PROSPECT' && SOLO_CLIENTE.includes(s.key)) { out.inclusa = false; out.motivo = 'Versione di presentazione per i prospect: senza offerta né credenziali'; return out; }
    if (variante === 'PROSPECT' && s.key === 'referente' && disp.owner === false) { out.inclusa = false; out.motivo = 'Nessun owner assegnato all\'account: i contatti sono nella lettera'; return out; }
    if (s.key === 'listino' && !disp.listino) { out.inclusa = false; out.motivo = 'Nessuna offerta economica generata dal listino StudioLAB del cliente'; return out; }
    if (s.key === 'studiolab' && !disp.studiolab) { out.inclusa = false; out.motivo = disp.studiolab === undefined ? 'Credenziali StudioLAB nella pagina degli accessi' : 'Nessuna credenziale StudioLAB registrata (contratto della linea o Legal entity)'; return out; }
    if (s.key === 'offerta' && disp.offerta === 'ECONOMICA' && disp.listino) { out.inclusa = false; out.motivo = 'Sostituita dall\'offerta economica dal listino StudioLAB'; return out; }
    if (s.key === 'lettera' && variante !== 'BENVENUTO') out.titolo = 'Lettera di presentazione';
    if (s.key === 'offerta') {
      out.titolo = titoloOfferta(linea, disp.offerta);
      if (!disp.offerta) { out.inclusa = false; out.motivo = 'Nessuna lettera di offerta generata per il contratto dell\'account e nessun dato della proposta (listino, sconto, prezzo medio, volume)'; return out; }
    }
    if (s.key === 'credenziali' && linea !== 'SRV') out.titolo = 'Accesso alla Suite';
    if (!s.fissa && scelte[s.key] === false) { out.inclusa = false; out.motivo = 'Esclusa dall\'operatore'; }
    return out;
  });
}

// ---------------------------------------------------------------- segnaposto
const valoreSegnaposto = (v) => (v == null ? '' : String(v).trim());
/** Sostituisce {{cliente}}, {{referente}}, {{data}}, {{owner}} (spazi ammessi, maiuscole indifferenti). I segnaposto sconosciuti
 * restano come sono (così l'editor li mostra); {{referenti}} resta per il generatore, che lo sostituisce con il blocco dei contatti. */
export function sostituisci(testo, valori = {}) {
  return String(testo ?? '').replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}(\.?)/g, (m, k, punto) => {
    const key = k.toLowerCase();
    if (!(SEGNAPOSTO.includes(key) && key in valori)) return m;
    const v = valoreSegnaposto(valori[key]);
    return punto && v.endsWith('.') ? v : v + punto;   // "AgapeLab S.r.l." a fine frase: un solo punto
  });
}
/** Testo + punto finale, senza raddoppiarlo ("... S.r.l." resta così). */
export const conPunto = (s) => { const t = String(s ?? '').trim(); return /[.!?]$/.test(t) ? t : `${t}.`; };
/** Segnaposto non riconosciuti in un modello (per l'avviso dell'editor). */
export const segnapostoSconosciuti = (testo) => [...new Set([...String(testo || '').matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)].map((m) => m[1].toLowerCase()))]
  .filter((k) => !SEGNAPOSTO.includes(k) && k !== 'referenti');

/** Valori dei segnaposto: il referente è il destinatario scelto (nome) o "Cliente"; l'owner è il nome dell'owner dell'account. */
export function valoriSegnaposto({ cliente, referente, data, owner }) {
  return { cliente: cliente || '', referente: referente || 'Cliente', data: dataLunga(data), owner: owner || 'Il nostro team commerciale' };
}

// ---------------------------------------------------------------- date
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const iso = (d) => (/^\d{4}-\d{2}-\d{2}/.test(String(d || '')) ? String(d).slice(0, 10) : null);
export function dataLunga(d) {
  const s = iso(d); if (!s) return '';
  const [y, m, g] = s.split('-').map(Number);
  return `${g} ${MESI[m - 1]} ${y}`;
}
export function dataBreve(d) { const s = iso(d); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : ''; }
export function addGiorni(d, n) {
  const s = iso(d); if (!s) return null;
  const t = new Date(`${s}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + Number(n));
  return t.toISOString().slice(0, 10);
}

/**
 * Piano dei primi 30-60-90 giorni (proposta da concordare): tre fasi con la data di chiusura calcolata dalla data del pacchetto e i
 * passi per linea. Nessuna promessa di tempi del laboratorio: solo tappe dell'avvio.
 */
export function pianoAvvio(linea, data) {
  const passi30 = {
    SRV: ['Attivazione degli accessi personali al Portale Service', 'Formazione del vostro personale sul portale: ricerca delle preparazioni, Vademecum, non conformità, ordini, circolari, ticket',
      'Conferma dei giorni e degli orari di ritiro dei campioni', 'Primo ordine del materiale per il prelievo e il confezionamento', 'Primo invio dei campioni al laboratorio'],
    PP: ['Attivazione degli accessi personali alla Suite', 'Formazione del vostro personale: royalties mensili, circolari, ticket, rubrica',
      'Definizione con il referente dell\'organizzazione del punto prelievi'],
    MDL: ['Attivazione degli accessi personali alla Suite', 'Invio a mdl@toscanadiagnostica.it dell\'elenco dei lavoratori da sottoporre alle prestazioni',
      'Conferma dell\'indirizzo email per gli appuntamenti e del contatto di riferimento', 'Primi appuntamenti'],
  }[linea] || [];
  return [
    { fase: 'Primi 30 giorni', entro: addGiorni(data, 30), titolo: 'Partenza', passi: [...passi30, 'Revisione a 30 giorni con il vostro referente: cosa funziona, cosa sistemare'] },
    { fase: 'Entro 60 giorni', entro: addGiorni(data, 60), titolo: 'Messa a punto', passi: linea === 'SRV'
      ? ['Lettura insieme delle non conformità del periodo per migliorare la fase pre-analitica', 'Verifica degli ordini e delle consegne del materiale', 'Abilitazione di eventuali altri utenti del vostro personale']
      : ['Verifica insieme dell\'andamento del periodo', 'Abilitazione di eventuali altri utenti del vostro personale'] },
    { fase: 'Entro 90 giorni', entro: addGiorni(data, 90), titolo: 'Bilancio del trimestre', passi: ['Incontro di bilancio del primo trimestre con il vostro referente', 'Piano dei passi successivi'] },
  ];
}

// ---------------------------------------------------------------- referenti
const pulito = (s) => String(s ?? '').trim();
const unaRiga = (s) => pulito(s).split(/\n+/).map((x) => x.trim()).filter(Boolean).join(' · ');
/**
 * Referenti dedicati per la lettera e la pagina del referente, solo da dati presenti: contatti.json dello specchio del Portale Service
 * (Laboratorio di Analisi, Service Flow & Back Office Manager, Direzione Sanitaria, Direttore tecnico) e Dati aziendali (supporto
 * clienti, direttore sanitario come riserva). Per PP e MDL: la casella della linea al posto del service. Ogni voce: { ruolo, nome,
 * email, telefono, nota }; una voce senza alcun recapito si omette.
 */
export function referentiDedicati({ contatti = null, company = {}, linea = 'SRV', casella = null } = {}) {
  const voci = (contatti?.gruppi || []).flatMap((g) => g.contatti || []);
  const trova = (re) => voci.find((v) => re.test(String(v.ruolo || '')));
  const out = [];
  const add = (ruolo, v, extra = {}) => {
    if (!v && !extra.email && !extra.telefono) return;
    const tel = [pulito(v?.tel), pulito(v?.cell) ? `cell. ${pulito(v.cell)}` : ''].filter(Boolean).join(' · ');
    const r = { ruolo, nome: pulito(v?.nome), email: pulito(v?.email2 || v?.email) || null, telefono: tel || null, telefoni: telefoni({ fisso: v?.tel, cellulare: v?.cell }), nota: null, ...extra };
    if (!r.email && !r.telefono) return;
    out.push(r);
  };
  if (linea === 'SRV') {
    add('Laboratorio di Analisi', trova(/^laboratorio di analisi$/i), { nota: 'campioni, richieste, referti e preparazioni' });
    add(pulito(trova(/service.*back office/i)?.ruolo) || 'Service, Flow & Back Office Manager', trova(/service.*back office/i), { nota: 'organizzazione del service e ritiri' });
  } else if (casella) {
    out.push({ ruolo: linea === 'PP' ? 'Linea Punti Prelievo' : 'Medicina del Lavoro', nome: '', email: casella, telefono: null, telefoni: [], nota: linea === 'PP' ? 'la casella della rete dei punti prelievo' : 'elenchi dei lavoratori e appuntamenti' });
  }
  const ds = trova(/direzione sanitaria/i);
  if (ds) add('Direzione Sanitaria', ds);
  else if (company.health_director) out.push({ ruolo: 'Direzione Sanitaria', nome: pulito(company.health_director), email: null, telefono: pulito(company.phone) || null, telefoni: telefoni({ fisso: company.phone }), nota: null });
  if (linea === 'SRV') add('Direttore Tecnico del Laboratorio', trova(/direttore tecnico/i));
  if (company.support_email || company.support_phone) {
    out.push({ ruolo: 'Supporto clienti', nome: '', email: pulito(company.support_email) || null, telefono: pulito(company.support_phone) || null, telefoni: telefoni({ fisso: company.support_phone }), nota: unaRiga(company.support_hours) || null });
  }
  return out.filter((r) => r.email || r.telefono);
}

/** Etichetta di un numero: "cell." per i cellulari italiani (3xx, anche con +39/0039), altrimenti "tel.". */
export const etichettaTelefono = (n) => (/^(\+39|0039)?\s*3\d/.test(pulito(n).replace(/[\s./-]/g, '')) ? 'cell.' : 'tel.');
/**
 * Telefoni di un contatto su righe separate (richiesta del CEO del 07/11/2026): [{ etichetta, numero }], prima il fisso poi il
 * cellulare, senza doppioni. fisso/cellulare dichiarati dalla fonte (contatti.json: tel/cell); altro = numero di tipo non dichiarato
 * (users.phone): l'etichetta la decide il numero stesso. Nessun numero inventato: i vuoti si omettono.
 */
export function telefoni({ fisso = null, cellulare = null, altro = null } = {}) {
  const out = []; const visti = new Set();
  const aggiungi = (etichetta, n) => { const x = pulito(n); const k = x.replace(/\D/g, ''); if (!x || visti.has(k)) return; visti.add(k); out.push({ etichetta, numero: x }); };
  aggiungi('tel.', fisso); aggiungi('cell.', cellulare); aggiungi(etichettaTelefono(altro), altro);
  return out;
}

/**
 * Righe della tabella dei referenti del pacchetto (lettera del CEO, pagina del referente, checklist; richiesta del CEO del 07/11/2026):
 * il CEO SEMPRE in prima riga ("Chief Executive Officer · Francesco Epifani", recapiti dall'anagrafica: se mancano la cella resta
 * vuota), poi i referenti dedicati della linea, poi l'owner dell'account se non è già tra loro. Pura.
 * ceo/owner: { nome, ruolo, email, telefoni } o null; referenti: voci di referentiDedicati.
 */
export function righeReferenti({ ceo = null, referenti = [], owner = null } = {}) {
  const chiave = (v) => pulito(v?.email).toLowerCase() || pulito(v?.nome).toLowerCase();
  const out = [];
  const presente = (v) => { const k = pulito(v?.email).toLowerCase(); const n = pulito(v?.nome).toLowerCase(); return out.some((x) => (k && pulito(x.email).toLowerCase() === k) || (n && pulito(x.nome).toLowerCase() === n)); };
  if (ceo && (pulito(ceo.nome) || pulito(ceo.email))) {
    out.push({ ruolo: pulito(ceo.ruolo) || 'Chief Executive Officer', nome: pulito(ceo.nome), email: pulito(ceo.email) || null, telefoni: ceo.telefoni || [], nota: null, ceo: true });
  }
  for (const r of referenti) {
    if (presente(r) && chiave(r)) continue;
    out.push({ ...r, telefoni: r.telefoni || (r.telefono ? [{ etichetta: '', numero: r.telefono }] : []) });
  }
  if (owner && (pulito(owner.nome) || pulito(owner.email)) && !presente(owner)) {
    out.push({ ruolo: 'Il vostro referente dedicato', nome: pulito(owner.nome), email: pulito(owner.email) || null, telefoni: owner.telefoni || [], nota: pulito(owner.ruolo) || null, owner: true });
  }
  return out;
}

/** Laboratorio di Analisi (voce principale del gruppo omonimo) da contatti.json, o null. */
export function contattoLaboratorio(contatti) {
  const voci = (contatti?.gruppi || []).flatMap((g) => g.contatti || []);
  const v = voci.find((x) => /^laboratorio di analisi$/i.test(String(x.ruolo || '')));
  return v ? { ruolo: 'Laboratorio di Analisi', nome: '', email: pulito(v.email) || null, telefono: pulito(v.tel) || null } : null;
}

// ---------------------------------------------------------------- certificazioni
/** Le certificazioni ISO con numero (certificazioni.json dello specchio): { norma, titolo, numero, scadenza }. */
export function certificazioniIso(cert) {
  return (cert?.certificazioni || []).filter((c) => /^ISO\s/.test(String(c.norma || '')) && c.numero)
    .map((c) => ({ norma: pulito(c.norma), titolo: pulito(c.titolo), numero: pulito(c.numero), scadenza: pulito(c.scadenza) || null }));
}

// ---------------------------------------------------------------- credenziali
/**
 * Pagina delle credenziali. accessi: utenti esterni della Legal entity [{ nome, email, profilo, stato, ultimo_accesso }];
 * portale: credenziali del portale referti { portal_url, username, password|null, fonte } o null; includiPassword: l'operatore ha
 * spuntato "includi la password nel pacchetto". La password compare SOLO in quel caso, altrimenti "comunicata separatamente".
 */
export function paginaCredenziali({ suiteUrl, accessi = [], portale = null, includiPassword = false }) {
  const righe = accessi.map((a) => ({
    nome: pulito(a.nome), email: pulito(a.email), profilo: pulito(a.profilo) || 'Accesso esterno',
    password: a.ultimo_accesso ? 'già attiva (accesso effettuato)' : 'provvisoria, inviata via email con l\'invito "Benvenuto in Suite TD"',
  }));
  let referti = null;
  if (portale && (portale.portal_url || portale.username)) {
    const conPw = includiPassword && Boolean(portale.password);
    referti = { url: pulito(portale.portal_url) || null, username: pulito(portale.username) || null,
      password: conPw ? String(portale.password) : 'comunicata separatamente', password_inclusa: conPw };
  }
  return { suiteUrl, righe, referti, password_inclusa: Boolean(referti?.password_inclusa) };
}

// ---------------------------------------------------------------- checklist
export function checklist(linea, { data, offerta = false, firmata = false } = {}) {
  const l = [
    'Accedete alla Suite con la password provvisoria e sceglietene una nuova',
    'Prendete visione dell\'Informativa privacy e dell\'Informativa sull\'uso dell\'intelligenza artificiale',
    'Attivate il secondo fattore di autenticazione dal vostro profilo (consigliato)',
  ];
  if (offerta && !firmata) l.push(linea === 'PP' ? 'Restituiteci firmata la proposta di contratto' : 'Restituiteci firmata la lettera di offerta, con gli allegati compilati');
  if (linea === 'SRV') {
    l.push('Salvate nei preferiti il Portale Service e il Vademecum degli esami', 'Concordate con noi giorni e orari di ritiro dei campioni',
      'Fate il primo ordine del materiale dal catalogo', 'Leggete le circolari in vigore e confermate la presa visione');
  } else if (linea === 'PP') {
    l.push('Verificate in Cash Management le royalties del mese', 'Leggete le circolari in vigore e confermate la presa visione');
  } else {
    l.push('Inviate a mdl@toscanadiagnostica.it l\'elenco dei lavoratori', 'Indicateci l\'indirizzo email per la conferma degli appuntamenti');
  }
  l.push('Segnalateci altre persone del vostro personale da abilitare');
  const rev = addGiorni(data, 30);
  if (rev) l.push(`Fissate con il vostro referente la revisione dei primi 30 giorni (entro il ${dataBreve(rev)})`);
  return l;
}

// ---------------------------------------------------------------- nomi
const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'cliente';
export const nomeFile = (cliente, versione, data) => `${String(data || '').slice(0, 10)}_Pacchetto_benvenuto_${slug(cliente)}_v${versione}.pdf`;

// ---------------------------------------------------------------- testi predefiniti
// Lettera del CEO per linea: prosa, 1-2 pagine. {{referenti}} su una riga da sola = blocco dei contatti generato dai dati.
export const LETTERA_CEO_DEFAULT = {
  SRV: `Gentile {{referente}},

benvenuti in Toscana Diagnostica. Con questa lettera desidero presentarvi chi siamo e come lavoreremo insieme. Nelle pagine che seguono, dedicate a {{cliente}}, trovate la nostra offerta, il portale che userete ogni giorno, le istruzioni di accesso e il Vademecum degli esami: abbiamo voluto riunire tutto in un solo documento, perché l'inizio di una collaborazione merita chiarezza. Sapere a chi rivolgersi, dove trovare le informazioni e che cosa aspettarsi da noi.

Toscana Diagnostica è una rete sanitaria integrata nata nell'aprile 2026 in Toscana. Riunisce il Laboratorio di Analisi, la Diagnostica per Immagini, la Medicina Specialistica e la Medicina del Lavoro sotto un'unica direzione e un unico sistema di regole. Il principio che ci guida è semplice: ci prendiamo cura del tempo dei pazienti, lì dove ogni minuto conta. Per una struttura che ci affida i propri campioni questo significa risultati affidabili, nei tempi dichiarati, e un interlocutore che risponde.

Per i laboratori e le strutture clienti svolgiamo il service di laboratorio: eseguiamo gli esami che ci affidate, organizziamo il ritiro dei campioni nei giorni e negli orari concordati, forniamo il materiale per il prelievo e il confezionamento e rendiamo disponibili i referti in formato digitale. I tempi di refertazione di ogni esame sono scritti nel Vademecum, consultabile online e allegato in coda a questo documento; ogni variazione vi viene comunicata per iscritto.

Il modo in cui lavoriamo è scritto, verificato e misurato. Il nostro Sistema di Gestione Integrato è certificato secondo le norme ISO 9001, ISO 14001, ISO 45001 e ISO 37001: qualità dei processi, rispetto dell'ambiente, sicurezza di chi lavora, prevenzione della corruzione. Partecipiamo ai programmi di Valutazione Esterna di Qualità, che confrontano i nostri risultati con quelli degli altri laboratori, e ogni campione è tracciato dall'arrivo al referto. Quello che vediamo noi lo vedete anche voi: sul Portale Service trovate in ogni momento le procedure in vigore, le non conformità con le relative risposte, gli ordini del materiale, le circolari e le certificazioni.

La nostra sede e il nostro laboratorio sono a Sesto Fiorentino, in Via di Pratignone 13/4, al centro della rete di punti che Toscana Diagnostica ha costruito sul territorio. È qui che arrivano i vostri campioni.

Non sarete mai soli con una domanda. Qui sotto trovate le persone che vi seguiranno: il laboratorio per i campioni e i referti, la responsabile del service per l'organizzazione di ogni giorno, la direzione sanitaria e la direzione tecnica per gli aspetti clinici e analitici, il supporto clienti per tutto il resto. {{owner}} seguirà personalmente l'avvio della collaborazione.

{{referenti}}

Vi ringrazio per la fiducia. Il nostro impegno è che, fra qualche mese, possiate dire di aver scelto un partner che si fa trovare quando serve e che non vi fa perdere tempo.

Con i migliori saluti,`,
  PP: `Gentile {{referente}},

benvenuti nella rete di Toscana Diagnostica. Con questa lettera desidero presentarvi chi siamo e come lavoreremo insieme. Nelle pagine che seguono, dedicate a {{cliente}}, trovate la nostra proposta, la presentazione della rete, le istruzioni di accesso alla Suite e il piano dei primi mesi, riuniti in un solo documento perché l'inizio di una collaborazione merita chiarezza.

Toscana Diagnostica è una rete sanitaria integrata nata nell'aprile 2026 in Toscana. Riunisce il Laboratorio di Analisi, la Diagnostica per Immagini, la Medicina Specialistica e la Medicina del Lavoro sotto un'unica direzione e un unico sistema di regole. Il principio che ci guida è semplice: ci prendiamo cura del tempo dei pazienti, lì dove ogni minuto conta. Un punto prelievi vicino a casa, ben organizzato e collegato al laboratorio, è il modo più concreto di farlo.

Con le strutture che ci ospitano costruiamo punti prelievo della rete Toscana Diagnostica: portiamo il laboratorio, le procedure, la tracciabilità dei campioni e il sistema qualità; insieme offriamo ai pazienti del territorio un servizio vicino e affidabile. I campioni raccolti nel punto arrivano al nostro laboratorio di Sesto Fiorentino, in Via di Pratignone 13/4, e i referti sono disponibili in formato digitale.

Il modo in cui lavoriamo è scritto, verificato e misurato. Il nostro Sistema di Gestione Integrato è certificato secondo le norme ISO 9001, ISO 14001, ISO 45001 e ISO 37001; ogni campione è tracciato dal prelievo al referto e ogni sede della rete è verificata con audit periodici. Nella Suite di Toscana Diagnostica vedete ogni mese le royalties del punto, ricevete le circolari e aprite le vostre richieste con un ticket.

Non sarete mai soli con una domanda. Qui sotto trovate i recapiti delle persone che vi seguiranno; {{owner}} seguirà personalmente l'avvio della collaborazione.

{{referenti}}

Vi ringrazio per la fiducia. Il nostro impegno è che il punto prelievi diventi, per i pazienti della vostra struttura, un motivo in più per sceglierla.

Con i migliori saluti,`,
  MDL: `Gentile {{referente}},

benvenuti in Toscana Diagnostica. Con questa lettera desidero presentarvi chi siamo e come lavoreremo insieme per la salute dei vostri lavoratori. Nelle pagine che seguono, dedicate a {{cliente}}, trovate la nostra offerta, il funzionamento del servizio di Medicina del Lavoro, le istruzioni di accesso e il piano dei primi mesi, riuniti in un solo documento.

Toscana Diagnostica è una rete sanitaria integrata nata nell'aprile 2026 in Toscana. Riunisce il Laboratorio di Analisi, la Diagnostica per Immagini, la Medicina Specialistica e la Medicina del Lavoro sotto un'unica direzione e un unico sistema di regole. Il principio che ci guida è semplice: ci prendiamo cura del tempo dei pazienti, lì dove ogni minuto conta. Per un'azienda significa visite e accertamenti organizzati senza perdite di tempo per i lavoratori e per chi li coordina.

Eroghiamo ai vostri lavoratori le prestazioni di Medicina del Lavoro previste dall'offerta: ci indicate per iscritto chi deve essere visitato, noi organizziamo gli appuntamenti e ve li confermiamo all'indirizzo che ci indicate. La fatturazione è mensile, con il riepilogo delle prestazioni.

Il modo in cui lavoriamo è scritto, verificato e misurato. Il nostro Sistema di Gestione Integrato è certificato secondo le norme ISO 9001, ISO 14001, ISO 45001 e ISO 37001: qualità dei processi, rispetto dell'ambiente, sicurezza di chi lavora, prevenzione della corruzione. La nostra sede e il nostro laboratorio sono a Sesto Fiorentino, in Via di Pratignone 13/4.

Non sarete mai soli con una domanda. Qui sotto trovate i recapiti delle persone che vi seguiranno; {{owner}} seguirà personalmente l'avvio della collaborazione.

{{referenti}}

Vi ringrazio per la fiducia accordata a Toscana Diagnostica.

Con i migliori saluti,`,
};

export const EMAIL_DEFAULT = `Gentile {{referente}},

in allegato trovate il pacchetto di benvenuto di Toscana Diagnostica preparato per {{cliente}}: la lettera di presentazione, la nostra offerta e tutte le informazioni per iniziare, riunite in un unico documento.

Per qualunque domanda potete rispondere a questa email.

Un cordiale saluto,
{{owner}}
Toscana Diagnostica`;

/** Modelli salvati (app_settings, JSON) → modelli completi con i predefiniti per le linee mancanti. */
export function modelliDa(salvati = {}) {
  const lettera = { ...LETTERA_CEO_DEFAULT };
  let l = salvati.lettera;
  if (typeof l === 'string') { try { l = JSON.parse(l); } catch { l = null; } }
  if (l && typeof l === 'object') for (const k of Object.keys(LETTERA_CEO_DEFAULT)) if (typeof l[k] === 'string' && l[k].trim()) lettera[k] = l[k];
  const email = typeof salvati.email === 'string' && salvati.email.trim() ? salvati.email : EMAIL_DEFAULT;
  return { lettera, email, oggetto: OGGETTO_EMAIL };
}

/** Lettera in paragrafi: [{ tipo: 'p', testo } | { tipo: 'referenti' }] (righe vuote = nuovo paragrafo, a capo singolo = a capo). */
export function paragrafiLettera(testo) {
  return String(testo || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean)
    .map((x) => (/^\{\{\s*referenti\s*\}\}$/i.test(x) ? { tipo: 'referenti' } : { tipo: 'p', testo: x.replace(/\{\{\s*referenti\s*\}\}/gi, '').trim() }))
    .filter((x) => x.tipo === 'referenti' || x.testo);
}

export const sezione = (key) => PER_KEY[key] || null;

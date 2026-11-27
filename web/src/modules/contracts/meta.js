// Modulo Contracts (Gestione del Personale, già Contratti del Personale): voci di navigazione disegnate dalla Suite (la sidebar dell'app non si porta).
// Le voci di inserimento sono riservate ai profili che scrivono (ADMIN, HR); Registro al solo ADMIN. Impostazioni: ADMIN tutto,
// HR solo la sezione Casella People. Profilo LP (solo liberi professionisti, sola lettura): vede soltanto Elenco LP e scadenze degli LP. Casella People (documenti da approvare): ADMIN e HR (il titolare della Suite entra come ADMIN).
// Profilo LP: restano solo "Elenco LP" e il calendario delle scadenze (degli LP); vale anche per un amministratore della Suite con quel profilo
const nonLp = (u) => u?.grants?.contracts?.profile !== 'LP';
const PER_LP = ['lp', 'lp/nuovo', 'scadenze'];
// Profilo MDL (scadenze di medicina del lavoro, sola lettura, per il responsabile HQS): vede soltanto la sua pagina
const soloMdl = (u) => u?.grants?.contracts?.profile === 'MDL';
const nonMdl = (u) => !soloMdl(u);
const conLp = (nav) => [{ to: 'scadenze-mdl', icon: 'shield', label: 'Scadenze medicina del lavoro', badge: 'mdl_in_scadenza', when: soloMdl },
  ...nav.map((i) => ((i.group ? i.group === 'Liberi professionisti' : PER_LP.includes(i.to)) ? { ...i, when: nonMdl } : { ...i, when: (u) => nonLp(u) && nonMdl(u) }))];

export default {
  key: 'contracts',
  title: 'Gestione del Personale',
  kicker: 'People',
  area: 'PEOPLE',
  nav: conLp([
    { to: '', icon: 'home', label: 'Cruscotto', end: true },
    { to: 'risorse/nuova', icon: 'plus', label: 'Nuova persona', profiles: ['ADMIN', 'HR'] },
    { to: 'risorse', icon: 'users', label: 'Elenco persone', end: true },
    { to: 'scadenze', icon: 'calendar', label: 'Calendario delle scadenze', badge: 'scadenze' },
    { to: 'casella-people', icon: 'mail', label: 'Casella People', badge: 'people_da_approvare', profiles: ['ADMIN', 'HR'] },
    { group: 'Scouting' },
    { to: 'scouting/cv', icon: 'import', label: 'CV Box', badge: 'cv_nuovi' },
    { to: 'scouting/lettere/nuova', icon: 'mail', label: 'Lettere di impegno', profiles: ['ADMIN', 'HR'] },
    { to: 'scouting/lettere', icon: 'list', label: 'Elenco lettere di impegno', end: true, badge: 'lettere_aperte' },
    { group: 'Dipendenti' },
    { to: 'dipendenti/nuovo', icon: 'plus', label: 'Nuovo dipendente', profiles: ['ADMIN', 'HR'] },
    { to: 'dipendenti', icon: 'doc', label: 'Elenco dipendenti', end: true },
    { to: 'ccnl', icon: 'file', label: 'CCNL di riferimento' },
    { to: 'busta-paga', icon: 'stats', label: 'Simulatore busta paga' },
    { group: 'Liberi professionisti' },
    { to: 'lp/nuovo', icon: 'plus', label: 'Nuovo professionista', profiles: ['ADMIN', 'HR', 'LP'] },
    { to: 'lp', icon: 'user', label: 'Elenco LP', end: true },
    { group: 'Tirocinanti' },
    { to: 'tirocinanti/nuovo', icon: 'plus', label: 'Nuovo tirocinante', profiles: ['ADMIN', 'HR'] },
    { to: 'tirocinanti', icon: 'user', label: 'Elenco tirocinanti', end: true },
    { group: 'Formazione e tutela' },
    { to: 'formazione-ecm', icon: 'stats', label: 'Formazione ed ECM' },
    { to: 'medicina-lavoro', icon: 'shield', label: 'Medicina del lavoro', profiles: ['ADMIN', 'HR'], badge: 'mdl_in_scadenza' },
    { group: 'Amministrazione', profiles: ['ADMIN', 'HR'] },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni e import', profiles: ['ADMIN', 'HR'] },
    { to: 'audit', icon: 'shield', label: 'Registro attività', profiles: ['ADMIN'] },
  ]),
};

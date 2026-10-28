// Modulo Integration M&A: voci di menu disegnate dalla Suite (la sidebar dell'app non si porta).
// La navigazione tra le società target resta nella barra interna del piano (motore GANTT); cruscotto e schede target
// lavorano sull'anagrafica unica (organizzazioni di tipo Target, persone della Suite).
export default {
  key: 'integration',
  title: 'Integration M&A',
  kicker: 'Finance',
  area: 'FINANCE',
  nav: [
    { to: '', icon: 'home', label: 'Piano di integrazione', end: true, badge: 'in_ritardo' },
    { to: 'guida', icon: 'list', label: 'Guida all\'uso' },
    { group: 'Amministrazione', profiles: ['ADMIN'] },
    { to: 'audit', icon: 'shield', label: 'Registro attività', profiles: ['ADMIN'] },
    { to: 'snapshot', icon: 'clock', label: 'Snapshot e ripristino', profiles: ['ADMIN'] },
  ],
};

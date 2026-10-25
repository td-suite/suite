// Configurazione centralino Toscana Diagnostica (Rev01 del 06/10/2026), fonte: file "Centralino Telefonico" fornito da Francesco Epifani.
// Interni personali: assegnati alla persona in anagrafica per cognome e nome (solo se la persona non ha già un interno).
// Numeri di reparto: mostrati nella Rubrica come "Numeri interni".
export const SWITCHBOARD = { number: '055 776511', label: 'Centralino', second: { number: '0574 740027', label: 'Inoltro diretto a Core Lab (int. 109-113)' } };
export const PERSONAL_EXT = [
  ['Epifani', 'Francesco', '101'], ['Zezza', 'Valentina', '102'], ['Greco', 'Rosetta', '103'], ['Sansoni', 'Silvia', '104'],
  ['Stabile', 'Federico', '105'], ['Cupelli', 'Iacopo', '106'], ['Baldacci', 'Sara', '107'], ['Arrighetti', 'Sara', '114'],
  ['Masseria', 'Fabiana', '115'], ['Fondi', 'Cristina', '116'],
];
export const DEPARTMENT_EXT = [
  { ext: '100', name: 'Centralino' }, { ext: '108', name: 'Preanalitica' }, { ext: '109', name: 'Core Lab' }, { ext: '110', name: 'Anatomia Patologica' },
  { ext: '111', name: 'Microbiologia' }, { ext: '113', name: 'Biologia Molecolare' }, { ext: '148', name: 'Citofono interno' }, { ext: '149', name: 'Citofono esterno' },
];
export const IVR = [
  { key: 1, name: 'Prenotazioni', ext: '100' }, { key: 2, name: 'Analisi di Laboratorio', ext: '102' }, { key: 3, name: 'Diagnostica per Immagini', ext: '100' },
  { key: 4, name: 'Medicina Specialistica e Medicina dello Sport', ext: '100' }, { key: 5, name: 'Service di Laboratorio', ext: '108-109' }, { key: 6, name: 'Medicina del Lavoro', ext: '100' },
  { key: 7, name: 'Direzione, Amministrazione e Uffici', ext: '114' }, { key: 8, name: 'Supporto Clienti', ext: '100' },
];

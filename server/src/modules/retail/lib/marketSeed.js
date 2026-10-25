// Dati di mercato precaricati: MEF, Redditi e principali variabili IRPEF su base comunale, anno d'imposta 2024 (dich. 2025),
// per i comuni del network (fonte: 02_Contesto_SocioEconomico_Pilota.xlsx, progetto Retail Assistant). Altri indicatori si importano da Excel.
export const MARKET_SEED = [
  // comune, provincia, contribuenti, reddito complessivo medio, reddito imponibile medio, quota <15k, quota 26-55k, quota >55k
  ['Calenzano', 'FI', 14123, 28222, 27005, 0.25, 0.38, 0.06],
  ['Quarrata', 'PT', 19986, 23681, 22536, 0.32, 0.29, 0.04],
  ['Montemurlo', 'PO', 14513, 24589, 23426, 0.32, 0.29, 0.05],
  ['Firenze', 'FI', 284300, 31941, 30016, 0.29, 0.34, 0.11],
  ['Sesto Fiorentino', 'FI', 38507, 28901, 27660, 0.25, 0.39, 0.07],
  ['Borgo San Lorenzo', 'FI', 14291, 25875, 24726, 0.27, 0.36, 0.05],
  ['Livorno', 'LI', 114563, 27402, 26527, 0.30, 0.37, 0.07],
  ['Rosignano Marittimo', 'LI', 23421, 25739, 24778, 0.33, 0.35, 0.05],
];
export const MARKET_BENCH = [
  ['REGIONE', 'Toscana', 'reddito_medio', 25692, 'MEF a.i. 2024'],
  ['ITALIA', 'Italia', 'reddito_medio', 25125, 'MEF a.i. 2024'],
  ['REGIONE', 'Toscana', 'spesa_famiglia_mensile', 3160.39, 'ISTAT Spese famiglie 2024'],
  ['ITALIA', 'Italia', 'spesa_famiglia_mensile', 2755.09, 'ISTAT Spese famiglie 2024'],
  ['REGIONE', 'Toscana', 'spesa_salute_famiglia_mensile', 133.32, 'stima su quota ISTAT 4,2%'],
  ['ITALIA', 'Italia', 'spesa_salute_famiglia_mensile', 116.22, 'ISTAT Spese famiglie 2024'],
];
export const METRIC_LABEL = { popolazione: 'Popolazione residente', famiglie: 'Famiglie', eta_media: 'Età media', contribuenti: 'Contribuenti IRPEF', reddito_medio: 'Reddito complessivo medio (€)', reddito_imponibile_medio: 'Reddito imponibile medio (€)', quota_redditi_bassi: 'Quota contribuenti < 15k', quota_redditi_medi: 'Quota contribuenti 26-55k', quota_redditi_alti: 'Quota contribuenti > 55k', spesa_famiglia_mensile: 'Spesa media mensile famiglia (€)', spesa_salute_famiglia_mensile: 'Spesa salute mensile famiglia (€)', imprese_attive: 'Imprese attive', addetti: 'Addetti', unita_locali: 'Unità locali', var_imprese_pct: 'Variazione imprese % a/a', var_addetti_pct: 'Variazione addetti % a/a', tasso_disoccupazione: 'Tasso di disoccupazione %', stranieri_pct: 'Stranieri %' };

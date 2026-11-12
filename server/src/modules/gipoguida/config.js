// Configurazione del modulo Guida GIPO. I limiti sono decisioni del brief del CEO (12/11/2026), non variabili d'ambiente.
export const KEY = 'gipoguida';
export const config = {
  appName: 'Guida GIPO',
  gipoBase: 'https://www.giponext.it',   // "Apri in GIPO": solo i percorsi di consultazione, in una scheda nuova
  domandeOrarie: 20,                      // domande per utente per ora (POST /chiedi)
  braniRisposta: 6,                       // sezioni e FAQ passate al modello per la risposta
  giorniCodaVecchia: 7,                   // Diagnostica D56: domande in coda da oltre N giorni
  riepilogoGiorno: 1,                     // job gipoguida:riepilogo: lunedì (0 = domenica), dalle 8 (ora di Roma)
  riepilogoOra: 8,
  aiTimeoutMs: 45_000,
};

// Configurazione del modulo Guida GIPO. I limiti sono decisioni del brief del CEO (12/11/2026), non variabili d'ambiente.
export const KEY = 'gipoguida';
export const config = {
  appName: 'Guida GIPO',
  gipoBase: 'https://www.giponext.it',   // "Apri in GIPO": solo i percorsi di consultazione, in una scheda nuova
  domandeOrarie: 20,                      // domande per utente per ora (POST /chiedi)
  // v0.71.1 (brief "risposte all'altezza del back-end"): pianificazione sull'indice completo, poi risposta sul testo integrale
  sezioniPiano: 10,                       // sezioni che il passaggio di pianificazione può scegliere dall'indice
  sezioniRisposta: 12,                    // sezioni (testo integrale) passate al modello per la risposta
  faqRisposta: 8,                         // FAQ passate al modello (collegate alle sezioni scelte o trovate dalla ricerca)
  caratteriSezione: 9000,                 // tetto per sezione
  caratteriBrani: 60000,                  // tetto complessivo dei brani della risposta
  procedureSenzaAi: 3,                    // senza AI: sezioni migliori di cui si mostrano i passi già scritti
  giorniCodaVecchia: 7,                   // Diagnostica D56: domande in coda da oltre N giorni
  riepilogoGiorno: 1,                     // job gipoguida:riepilogo: lunedì (0 = domenica), dalle 8 (ora di Roma)
  riepilogoOra: 8,
  aiTimeoutMs: 45_000,
};

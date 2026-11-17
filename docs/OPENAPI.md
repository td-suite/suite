# Openapi nella Suite

Stato alla v0.80.0. Connettore unico: Amministrazione > Connettori > Openapi (token generato in console.openapi.com/it/oauth, mai la chiave API del conto).

## Fase 1 (v0.80.0): scheda dell'impresa e CAP

- **Scheda dell'impresa** (`GET /IT-advanced/{partita IVA o codice fiscale}` su company.openapi.com): ragione sociale, sede legale, PEC, SDI, stato di attività, ATECO, forma giuridica, REA, ultimo bilancio, soci.
- **Legal entity**: alla creazione con partita IVA, e quando partita IVA o codice fiscale cambiano, la Suite legge la scheda e compila i **soli campi vuoti**. Un dato già scritto non viene mai sovrascritto: la differenza è segnalata e si applica con "usa" nella scheda.
- **Verifica notturna** (tra le 2 e le 5): Legal entity attive mai verificate o verificate da più di `giorni_verifica`, al massimo `verifiche_per_notte` per notte. Avviso in elenco se l'impresa risulta cessata o se sede, PEC, SDI, partita IVA o codice fiscale differiscono. La ragione sociale diversa non genera avviso.
- **CAP** (`GET /cap/{cap}` su cap.openapi.it): città e provincia compilate dal CAP quando mancano.
- **Spesa sotto controllo**: una scheda letta resta valida `giorni_cache` giorni (predefinito 30) e non si paga di nuovo; tetto mensile `tetto_schede_mese` (predefinito 200); ogni chiamata è nel registro del connettore senza la partita IVA cercata.

Il token deve includere i permessi IT-advanced (Company) e Cap. Senza, la Suite risponde con un messaggio che dice quale permesso manca.

Impostazioni del connettore: `tetto_schede_mese`, `giorni_cache`, `giorni_verifica`, `verifiche_per_notte`, `verifica_automatica`.

## Ricerca prospect: codici ATECO

Verificato sul servizio reale il 17/11/2026: `atecoCode` si confronta in modo esatto con il codice che Openapi conserva, a 3 o 4 cifre secondo l'impresa, senza prefissi (Firenze: 869 → 25 imprese, 8690 → 0, 8691 → 2). I codici predefiniti includono perciò entrambe le precisioni. Prezzo osservato della ricerca: 0,10 € a impresa con `dataEnrichment=advanced`.

## Fasi successive (non realizzate)

Visure Camerali e Visengine a richiesta, Catasto e Real Estate, Automotive, Risk e Ufficio Postale con cautele (dati su persone fisiche, invii con costo e valore legale).

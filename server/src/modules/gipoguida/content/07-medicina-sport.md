---
capitolo: 7
titolo: Medicina dello sport
intro: Visite di idoneità sportiva: nuova visita, elenco delle visite e scadenze delle idoneità.
---

=== sezione
ordine: 1
slug: sport-nuova-visita
titolo: Nuova visita sportiva
percorso_gipo: /medicina-dello-sport/nuova-visita
parole_chiave: medicina dello sport, visita sportiva, idoneità, certificato, nuova visita, inizia visita sportiva, agonistica, non agonistica, paralimpici, tipo visita, sport, società sportiva, anamnesi, esame obiettivo, esame aggiuntivo, conclusioni visita, ecg, spirometria
sintesi: Come si apre e si compila una visita di medicina dello sport secondo il manuale TD: tipo visita, sport, anamnesi, esame obiettivo e accertamenti, esame aggiuntivo, conclusioni.
fonte: INTERFACCIA+MANUALE
livello: OPERATIVO
stato: VALIDATA
validazione: Manuale operativo TD-SGI-MAN007
===
### A cosa serve
Registrare una visita di idoneità sportiva in GIPO, con anamnesi, accertamenti e conclusioni, da cui nascono certificato e relazione.

### Dove si trova
- Menu **Med. dello sport > Nuova visita** (percorso /medicina-dello-sport/nuova-visita): si cerca il paziente in anagrafica (se manca si può creare al momento).
- Dalla **Lista di lavoro**: **Azioni > Inizia visita sportiva** sulla riga dell'appuntamento, già collegata al paziente e all'episodio prenotato.

### Come si fa
1. Apri la visita da **Azioni > Inizia visita sportiva** (se c'è l'appuntamento) oppure da **Nuova visita**.
2. Scegli il **Tipo Visita**: Visita agonistica, Visita Agonistica Paralimpici, Visita Non Agonistica.
3. Scegli lo sport (o gli sport) dal catalogo delle discipline; facoltativi la disciplina o il nome personalizzato e la società sportiva.
4. Compila i blocchi della scheda durante la visita:
   - **Anamnesi**: ore di attività settimanale, attività lavorativa, fumo, alcol, integratori, caffè e stimolanti, sostanze dopanti, alvo, diuresi, ecc.;
   - **Esame obiettivo e accertamenti clinici**: i blocchi proposti dipendono dallo sport e dal tipo visita (trofismo, peso, statura, BMI, circonferenza addominale, gruppo sanguigno, pressione a riposo, pre-test e post-test, acuità visiva, ECG a riposo e da sforzo, spirometria, visita ORL, visita neurologica, ecc.). Ogni blocco ha la data dell'accertamento e si può segnare con esito "Idoneo" o come eseguito da fonte "Esterna";
   - **Esame aggiuntivo**: con l'apposito pulsante aggiungi accertamenti oltre a quelli previsti per lo sport;
   - **Conclusioni visita**: la sintesi del medico.
5. Esprimi l'esito e genera i certificati: vedi [Idoneità, certificati e relazione sintetica](sezione:sport-idoneita-certificati).
6. Salva.

### Da riconciliare con il manuale
- Il manuale dice di partire dalla sezione "Visite" con il pulsante "+ Nuova"; nel menu di GIPO osservato le voci sono **Med. dello sport > Nuova visita** ed **Elenco visite**.

### Attenzioni
- Modelli di esame, tipi di visita e tipi di certificato (associazione esami e sport, modelli PDF) si configurano nel back office: vedi [Medicina dello sport: modelli e tipi](sezione:config-sport).

=== sezione
ordine: 2
slug: sport-elenco-visite
titolo: Elenco visite e scadenze delle idoneità
percorso_gipo: /medicina-dello-sport
parole_chiave: elenco visite, idoneità, scadenza certificato, sport, tipo visita, rinnovo, registro idoneità, agonisti, non agonisti, excel, filtri visite
sintesi: Elenco delle visite sportive con idoneità e scadenza, filtri, e il Registro idoneità esportabile in Excel (agonisti e non agonisti).
fonte: INTERFACCIA+MANUALE
livello: OPERATIVO
stato: VALIDATA
validazione: Manuale operativo TD-SGI-MAN007
===
### A cosa serve
Elenca le visite sportive con l'esito di idoneità e la scadenza, ed esporta il registro delle idoneità.

### Dove si trova
Menu **Med. dello sport > Elenco visite** (percorso /medicina-dello-sport): è la pagina iniziale del modulo.

### Cosa c'è nella schermata
- Colonne: **Tipo visita**, **Paziente**, **Data visita**, **Sport**, **Idoneità** (icona verde o rossa), **Data scadenza**.
- Filtri per paziente o tipo visita, data visita e data scadenza.
- Pulsante **Registro idoneità**.

### Come si fa
1. Apri **Med. dello sport > Elenco visite**.
2. Filtra per **Data scadenza** per vedere le idoneità in scadenza (per esempio per proporre il rinnovo).
3. Apri la visita dalla riga per i dettagli, i certificati e la relazione.
4. Per il registro ufficiale premi **Registro idoneità**: esporta in Excel gli atleti dichiarati idonei in due elenchi, **Agonisti** e **Non Agonisti**, con cognome, nome, codice fiscale, sesso, data e luogo di nascita e data della visita (adempimento per la tenuta del registro delle idoneità sportive).

### Attenzioni
- Con esito "Non idoneo" o "Sospeso" lo sport compare con l'icona di non idoneità e senza data di scadenza.
- La validità del certificato dipende dal **Tipo certificato** configurato (campo **Validità del rilascio**).
- Il registro contiene dati personali degli atleti: conservalo e consegnalo secondo le regole privacy.

=== sezione
ordine: 3
slug: sport-idoneita-certificati
titolo: Idoneità, certificati e relazione sintetica
percorso_gipo: /medicina-dello-sport
parole_chiave: idoneità, idoneo, sospeso, non idoneo, motivo non idoneità, certificato, numero certificato, data di scadenza, certificato aggiuntivo, certificato agonistico, certificato non agonistico, ludico motoria, elevato impegno cardiovascolare, assistente bagnanti, relazione sintetica, cartella sanitaria, autodichiarazione, referti collegati, scarica il file
sintesi: Come esprimere l'esito di idoneità per ogni sport (Idoneo, Sospeso, Non idoneo), generare il certificato con numero e scadenza, aggiungere certificati e stampare certificato e relazione sintetica secondo il manuale TD.
fonte: MANUALE_TD
livello: OPERATIVO
stato: VALIDATA
validazione: Manuale operativo TD-SGI-MAN007
===
### A cosa serve
Chiudere la visita sportiva con il giudizio e produrre i documenti ufficiali.

### Esito di idoneità
1. Nella sezione **Idoneità e Certificati**, per ogni sport della visita scegli l'esito: **Idoneo**, **Sospeso**, **Non idoneo**.
2. Con "Non idoneo" il campo **Motivo non idoneità** è obbligatorio.
3. Con "Idoneo" GIPO compila da solo il certificato:
   - **data di scadenza** proposta in base al tipo di idoneità ("per sport" per il certificato agonistico, 12 mesi per le altre);
   - **numero certificato** progressivo automatico.
4. Per più certificazioni nella stessa visita (più sport, o più tipi di certificato per lo stesso sport) usa **+ Certificato aggiuntivo**.

### Tipi di certificato a catalogo (tra gli altri)
| Certificato | Idoneità | Validità |
|---|---|---|
| Certificato agonistico | Agonistica | per sport |
| Certificato non agonistico | Altra idoneità | 12 mesi |
| Certificato attività ludico-motoria | Altra idoneità | 12 mesi |
| Certificato elevato impegno cardiovascolare | Altra idoneità | 12 mesi |
| Certificato assistente bagnanti | Altra idoneità | 12 mesi |

Con "Non idoneo" o "Sospeso" non si genera né il certificato né la scadenza per quello sport.

### Certificato e relazione sintetica
Salvata la visita, la scheda ha due pulsanti che generano i documenti già compilati:
1. **Certificati**: il PDF del certificato di idoneità o non idoneità per lo sport, con intestazione Toscana Diagnostica, dati anagrafici, sport, esito, numero e validità; pronto per la stampa o il download ("Scarica il file").
2. **Relazione sintetica**: il PDF di più pagine che costituisce la cartella sanitaria della visita (nome del file relazioneSintetica_ seguito da paziente, tipo visita e data): autodichiarazione del paziente ai sensi del Regolamento UE 2016/679 (informativa privacy, condizioni psicofisiche, nessuna precedente non idoneità, nessun uso di sostanze dopanti, informazione sui rischi di fumo e alcol, spazio per la firma del paziente e, per i minori, del genitore o tutore), riepilogo dell'esame obiettivo e degli accertamenti, conclusioni.
3. Entrambi si consultano e scaricano dalla scheda della visita e si possono associare a un referto già in GIPO dalla sezione **Referti collegati**.

### Attenzioni
- Prima di consegnarli verifica che sport, esito di idoneità e dati anagrafici siano corretti: i documenti si generano dai dati inseriti.

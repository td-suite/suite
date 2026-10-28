# Business: caricamento dello status quo (28/10/2026)

Richiesta del CEO, testuale: "Includi tutto il contenuto della cartella nei rispettivi WIDGET. In B2C punti prelievo, contratti e la
documentazione correlata; per la parte autorizzativa (Fascicoli autorizzazione), integra con la folder Autorizzazioni Sanitarie. Integra la
parte B2B con la folder Service e Medicina del Lavoro. Tutti i soggetti coinvolti dai contratti, includili in Legal Entity."

## Fonti (OneDrive Toscana Diagnostica)
`Business/Punti Prelievo e Centri Medici` (contratti di appalto dei punti prelievo, lettere di recesso, cartelle Autorizzazione Sanitaria
dell'era Fanfani), `Business/Service di Laboratorio` (64 cartelle cliente in Inviati e Da inviare, pipeline B2B del 21/07/2026, censimento
delle strutture private toscane, contratto Endeavor DNA), `Business/Medicina del Lavoro` (ACF Fiorentina, CNA Firenze),
`HQS/ISO 9001/1. Gestione del Sistema/Autorizzazioni Sanitarie` (fascicoli di Laboratorio, Calenzano, Montemurlo, Quarrata, CIFS).
2.443 file copiati (1,4 GB); esclusi gli archivi ZIP oltre 30 MB (copie dei faldoni), i DWG, gli export di Pianificazione Ambulatori
(già in Room Planning) e la cartella "Claude outputs". I documenti sono stati letti (docx, pdf con testo, xlsx) e i dati estratti in
`/tmp` di sessione (`estratti.json`, riepilogo in `estratti.md`); i PDF firmati sono scansioni senza testo: i dati vengono dal docx
omonimo e la firma è dedotta dal nome del file (segnalato nelle note del contratto).

## Che cosa entra nella Suite
- Legal entity (public.organizations): 90 controparti: strutture ospitanti dei punti prelievo (PARTNER), clienti service e
  medicina del lavoro (CLIENTE), locatore del laboratorio e fornitori ricorrenti nei fascicoli (FORNITORE: Ecoeridania, Ekolav, Silva,
  Vivaldi & Cardino...), soggetti terzi (Istituto Fanfani, Synlab, Ambiente Impresa, Sustineo...). Abbinamento per P.IVA, codice fiscale,
  nome normalizzato o somiglianza (pg_trgm >= 72%); chi non c'è viene creato con `legacy_refs.business_pack`. I campi vuoti del core si
  completano, nulla si sovrascrive. Firmatario, legale rappresentante e condizioni di pagamento vanno in `business.org_ext`.
- Contratti (81): 10 punti prelievo (5 dell'era TD, 5 dell'era Fanfani come CESSATO/storico),
  1 locazione del laboratorio (Tecnolibri, 87.600 euro/anno), 68 service
  (64 cartelle + 4 clienti presenti solo nella pipeline; stato dalla fase della pipeline: 7 = ATTIVO, 6 = FIRMATO, 4-5 = PROPOSTA, 1-3 = BOZZA),
  2 medicina del lavoro. Stati: {'BOZZA': 8, 'PROPOSTA': 31, 'FIRMATO': 2, 'AUTORIZZATO': 0, 'ATTIVO': 35, 'CESSATO': 5, 'ANNULLATO': 0}. I contratti oltre la bozza ricevono il protocollo del modulo
  (anno della proposta). I dati specifici (corrispettivo PP in voci strutturate, servizi, canone SEDE, condizioni service) stanno in `data`;
  la pipeline B2B per intero in `data.pipeline`; le note riportano le clausole letterali e i punti da verificare.
- Fascicoli di autorizzazione (6): Calenzano (Atto SUAP/51/2026 del 15/07/2026), Montemurlo (autorizzazione unica SUAP,
  domanda 09/06/2026, parere GTRV 30/06/2026: data del rilascio da leggere sul documento, scansione), Quarrata (autorizzazione unica SUAP
  del 16/07/2026), Laboratorio (autorizzazione n. 12 del 12/06/2026), Poggio a Caiano e Osmannoro (in corso). Documenti classificati per
  voce del catalogo dal nome del file ({'ALTRO': 923, 'ATTO_CONDIVISIONE': 9, 'AUTORIZZAZIONE': 9, 'AUTOVALUTAZIONE_A': 11, 'AUTOVALUTAZIONE_B': 11, 'AUTOVALUTAZIONE_B11': 18, 'COLLEGAMENTO_FUNZIONALE': 15, 'CONFORMITA_IMPIANTI': 25, 'DISPONIBILITA_LOCALI': 31, 'DUVRI': 7, 'DVR': 4, 'ELENCO_PERSONALE': 10, 'ELENCO_STRUMENTAZIONE': 21, 'GESTIONE_FARMACI': 8, 'MODELLO_5': 12, 'MODELLO_6': 20, 'PLANIMETRIA_GENERALE': 13, 'PLANIMETRIA_INQUADRAMENTO': 54, 'RELAZIONE_NON_INSUDICIANTI': 6, 'RELAZIONE_OPERATIVA': 18, 'RELAZIONE_TECNICA': 25, 'SPORCO_PULITO': 11}); le sottocartelle A/B/B1 dei requisiti (procedure del SGI), le informative e la
  pratica SUAP restano in "Altri documenti" con l'etichetta della cartella di origine; nella pagina del fascicolo oltre 8 file si vedono
  raggruppati per cartella.
- Non caricati: cartelle Firenze Via Giano della Bella (COR) e Campi Bisenzio (nessuna controparte identificata), Scandicci (vuota),
  "Patologi (Internal)" della pipeline, i 4 file del kit Fanfani dentro Service - Performance.zip, gli archivi ZIP oltre 30 MB.

## Meccanismo (migrazione business 007)
`POST /api/business/import/pack` (Superamministratore; `dry_run=1` per la prova), UI in Business > Impostazioni > "Caricamento dello status
quo": si scelgono uno o più pacchetti, "Prova" mostra il piano (sedi e Legal entity abbinate, contratti e fascicoli da creare, cosa manca),
"Importa" li carica in sequenza. Idempotente: `contracts.import_key`, `dossiers.import_key`, documenti per impronta sha256. Le sedi TD si
abbinano per codice, città e nome (`public.sites`, kind <> SERVICE): se una sede manca il contratto viene saltato con l'indicazione di
crearla in Amministrazione > Sedi e ripetere. Le controparti e i contratti dei pacchetti precedenti si ritrovano (legacy_refs, import_key).
`import_runs` registra ogni esecuzione.

Archivio dei documenti: `business.contract_files` e `business.dossier_files` hanno `blob_path`; con AZURE_STORAGE_CONNECTION_STRING
configurata (stesso archivio di Cartella e Community) i contenuti vanno su Azure Blob e nel database restano i metadati; senza blob i
documenti finiscono nel database e il caricamento accetta solo pacchetti piccoli (BUSINESS_PACK_DB_LIMIT_MB, predefinito 60). In locale,
con tutti i pacchetti nel database, il database è passato a 1,8 GB: il piano Render basic-1gb non li regge, quindi in produzione il blob è
obbligatorio prima del caricamento. Caricamenti manuali e documenti generati seguono la stessa regola (lib/storage.js).

## Pacchetti consegnati (41, 1889 documenti, 860 MB)
Costruiti con `/tmp/claude-0/biz/build_packs.py` (sessione Cowork), massimo 28 MB ciascuno. Ordine: 01 (Legal entity e contratti), poi i
contratti, poi i fascicoli per sede; si possono selezionare tutti insieme.

| Pacchetto | MB | Documenti |
|---|---|---|
| TD_Business_pacchetto_01_contratti_e_legal_entity.zip | 24.6 | 3 |
| TD_Business_pacchetto_02_contratti.zip | 18.3 | 4 |
| TD_Business_pacchetto_03_contratti.zip | 12.6 | 4 |
| TD_Business_pacchetto_04_contratti.zip | 21.7 | 7 |
| TD_Business_pacchetto_05_contratti.zip | 20.6 | 17 |
| TD_Business_pacchetto_06_contratti.zip | 16.1 | 19 |
| TD_Business_pacchetto_07_contratti.zip | 17.5 | 20 |
| TD_Business_pacchetto_08_contratti.zip | 17.9 | 29 |
| TD_Business_pacchetto_09_contratti.zip | 24.9 | 34 |
| TD_Business_pacchetto_10_contratti.zip | 24.6 | 50 |
| TD_Business_pacchetto_11_contratti.zip | 17.9 | 118 |
| TD_Business_pacchetto_12_contratti.zip | 23.0 | 323 |
| TD_Business_pacchetto_13_fascicolo_calenzano_1.zip | 16.9 | 1 |
| TD_Business_pacchetto_14_fascicolo_calenzano_2.zip | 24.8 | 2 |
| TD_Business_pacchetto_15_fascicolo_calenzano_3.zip | 26.9 | 4 |
| TD_Business_pacchetto_16_fascicolo_calenzano_4.zip | 26.7 | 19 |
| TD_Business_pacchetto_17_fascicolo_calenzano_5.zip | 25.7 | 76 |
| TD_Business_pacchetto_18_fascicolo_calenzano_6.zip | 26.5 | 122 |
| TD_Business_pacchetto_19_fascicolo_calenzano_7.zip | 1.5 | 36 |
| TD_Business_pacchetto_20_fascicolo_montemurlo_1.zip | 16.9 | 1 |
| TD_Business_pacchetto_21_fascicolo_montemurlo_2.zip | 16.8 | 1 |
| TD_Business_pacchetto_22_fascicolo_montemurlo_3.zip | 27.9 | 3 |
| TD_Business_pacchetto_23_fascicolo_montemurlo_4.zip | 26.8 | 7 |
| TD_Business_pacchetto_24_fascicolo_montemurlo_5.zip | 24.3 | 36 |
| TD_Business_pacchetto_25_fascicolo_montemurlo_6.zip | 25.3 | 81 |
| TD_Business_pacchetto_26_fascicolo_montemurlo_7.zip | 26.4 | 106 |
| TD_Business_pacchetto_27_fascicolo_montemurlo_8.zip | 10.6 | 126 |
| TD_Business_pacchetto_28_fascicolo_quarrata_1.zip | 27.9 | 3 |
| TD_Business_pacchetto_29_fascicolo_quarrata_2.zip | 28.5 | 16 |
| TD_Business_pacchetto_30_fascicolo_quarrata_3.zip | 25.6 | 71 |
| TD_Business_pacchetto_31_fascicolo_quarrata_4.zip | 26.3 | 98 |
| TD_Business_pacchetto_32_fascicolo_quarrata_5.zip | 12.0 | 100 |
| TD_Business_pacchetto_33_fascicolo_laboratorio_1.zip | 28.0 | 3 |
| TD_Business_pacchetto_34_fascicolo_laboratorio_2.zip | 25.1 | 11 |
| TD_Business_pacchetto_35_fascicolo_laboratorio_3.zip | 26.3 | 52 |
| TD_Business_pacchetto_36_fascicolo_laboratorio_4.zip | 26.3 | 93 |
| TD_Business_pacchetto_37_fascicolo_laboratorio_5.zip | 10.8 | 90 |
| TD_Business_pacchetto_38_fascicolo_poggio-a-caiano_1.zip | 23.6 | 7 |
| TD_Business_pacchetto_39_fascicolo_poggio-a-caiano_2.zip | 26.2 | 53 |
| TD_Business_pacchetto_40_fascicolo_poggio-a-caiano_3.zip | 0.7 | 19 |
| TD_Business_pacchetto_41_fascicolo_osmannoro.zip | 9.3 | 24 |

## Da verificare in produzione (note del caricamento)
Date di firma dei contratti PP (scansioni), Calenzano art. 5 (1.200 euro/mese letto come importo fisso), 21 contratti service presenti solo
come format non compilato (anagrafica da pipeline e censimento, P.IVA assente), documenti "firmati" di era Fanfani (Santa Zita 2024, Baronci
2024, Beato Gregorio X 2023), codice fiscale Santa Zita a 10 cifre, Endeavor DNA data 2025 vs decorrenza 2026, Studio Medico Sole con due
intestazioni, data di rilascio dell'autorizzazione di Montemurlo.

## Aggiornamenti del 28/10/2026 (sera)
- Cestino a fine riga nell'elenco dei contratti (richiesta del CEO): le bozze le elimina chi gestisce la sezione, i contratti protocollati
  (compresi quelli caricati dai pacchetti) solo il Superamministratore; la cancellazione è definitiva e porta via documenti, cronologia,
  credenziali e fascicolo collegato; la Legal entity resta. Attenzione: un contratto eliminato torna se si ricarica il pacchetto che lo contiene
  (la chiave di importazione sparisce con lui); per toglierlo per sempre va tolto anche dal manifest o lasciato fuori dal ricaricamento.
- Pacchetti ricostruiti: il contratto storico Fanfani di Quarrata (controparte "XXX" nel docx) è ora intestato a G.B. Center come il contratto TD;
  la Legal entity fittizia "GB Medical Center (controparte nel docx lasciata come XXX)" non viene più creata. Chi ha già importato la prima
  versione: ricaricare il pacchetto 01 riassegna il contratto e la Legal entity fittizia resta orfana, da eliminare in Amministrazione > Legal entity.

# TD.Suite · modulo PowerShell per l'ingestione in Suite TD

Modulo client per l'API di ingestione di Suite TD (`/api/ingest`). Serve agli automatismi che portano nella Suite i dati dei gestionali (anagrafica del personale, sedi, scadenze, chiusure cassa in PDF) senza caricamenti manuali. Funziona con Windows PowerShell 5.1 (preinstallato su Windows 10 e 11 e Windows Server) e con PowerShell 7.

## Installazione

1. Copiare la cartella `TD.Suite` in una delle cartelle dei moduli dell'utente che eseguirà gli automatismi:
   - Windows PowerShell 5.1: `%USERPROFILE%\Documents\WindowsPowerShell\Modules\TD.Suite`
   - PowerShell 7: `%USERPROFILE%\Documents\PowerShell\Modules\TD.Suite`
   - per tutti gli utenti del server: `C:\Program Files\WindowsPowerShell\Modules\TD.Suite`
2. Verificare che la policy di esecuzione consenta i moduli firmati: `Get-ExecutionPolicy` deve restituire `RemoteSigned` o `AllSigned`. Se restituisce `Restricted`: `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`.
3. Importare il modulo e verificare: `Import-Module TD.Suite; Get-Command -Module TD.Suite`.

## Chiave API

La chiave la crea un amministratore della Suite in **Amministrazione > Chiavi API** (`POST /api/api-keys`), indicando nome, sorgente (es. `ZUCCHETTI`, `CASSA`, `POWERSHELL`), eventuale sede e i permessi (`ingest:people`, `ingest:sites`, `ingest:events`, `ingest:files`, oppure `ingest:*`). La chiave in chiaro (`tds_` più 40 caratteri) compare **una sola volta**: va copiata subito. La Suite conserva solo l'impronta SHA-256. Una chiave si revoca in qualunque momento e può avere una scadenza.

Regole pratiche:
- una chiave per ogni automatismo o postazione, con i soli permessi necessari;
- mai incollare la chiave negli script: usare `Connect-TDSuite -Save` (vedi sotto) oppure una variabile d'ambiente protetta;
- revocare la chiave quando la postazione viene dismessa.

## Primo utilizzo

```powershell
Import-Module TD.Suite
Connect-TDSuite -BaseUrl https://suite.toscanadiagnostica.it -ApiKey (Read-Host -AsSecureString 'Chiave API') -Save
Test-TDSuite
```

`-Save` scrive la connessione in `%LOCALAPPDATA%\TDSuite\connection.xml` cifrata con la protezione dati di Windows (DPAPI) dell'utente che la salva: solo quell'utente, su quel computer, può rileggerla. Le attività pianificate devono quindi girare con lo stesso account. Su Linux o macOS con PowerShell 7 la cifratura DPAPI non è disponibile e il file va protetto con i permessi del filesystem.

`Test-TDSuite` chiama `GET /api/ingest/ping` e mostra sorgente, permessi e sede associata alla chiave.

## Esempi

### Personale da un export CSV del gestionale (Excel o Zucchetti)

Il gestionale esporta un CSV con intestazioni come `Cognome;Nome;CodiceFiscale;Email;Area;Mansione;Sede;Telefono;Matricola`. Le intestazioni in italiano vengono tradotte nei campi della Suite; le righe sono riconciliate per codice fiscale e poi per email.

```powershell
Send-TDPeople -Path 'C:\Export\Zucchetti\dipendenti.csv' -Source Zucchetti -BatchUid ('hr-' + (Get-Date -Format yyyy-MM-dd))
```

Da Excel con il modulo ImportExcel:

```powershell
Import-Excel 'C:\Export\organico.xlsx' -WorksheetName Attivi |
  Select-Object @{n='last_name';e={$_.Cognome}}, @{n='first_name';e={$_.Nome}}, @{n='tax_code';e={$_.CF}}, @{n='email';e={$_.Email}}, @{n='area';e={$_.Area}}, @{n='job_title';e={$_.Ruolo}} |
  Send-TDPeople -Source Excel -BatchUid ('organico-' + (Get-Date -Format yyyy-MM))
```

Il `BatchUid` stabile (una data o un periodo) rende l'invio ripetibile: se lo script riparte dopo un errore, il server risponde `DUPLICATE` e non applica due volte lo stesso lotto. Per rinviare dati corretti usare un nuovo `BatchUid`.

### Sedi

```powershell
Send-TDSites -Path 'C:\Export\sedi.csv' -Source Excel -BatchUid sedi-2026-10
```

Campi: `code` (obbligatorio, es. FI-CAL), `name`, `kind` (HEADQUARTER, LABORATORIO, CENTRO_DIAGNOSTICO, POLIAMBULATORIO, PUNTO_PRELIEVI, SERVICE, CENTRO_MEDICO, ALTRO), `address`, `zip`, `city`, `province`, `phone`, `email`, `manager_name`, `studiolab_code`, `organization_code`.

### Scadenze nel calendario

```powershell
$eventi = Import-Csv 'C:\Export\scadenze.csv' -Delimiter ';' | ForEach-Object {
  @{ title = $_.Descrizione; starts_at = [datetime]$_.Scadenza; kind = 'SCADENZA'; site_code = $_.Sede; external_id = 'SCAD-' + $_.Id }
}
Send-TDEvents -Rows $eventi -Source Gestionale
```

`external_id` è obbligatorio: reinviando lo stesso identificativo l'evento viene aggiornato, non duplicato.

### Cartella delle chiusure cassa in PDF

```powershell
Get-ChildItem 'C:\Cassa\Chiusure\2026-10\*.pdf' |
  ForEach-Object { Send-TDFile -Path $_.FullName -Folder 'chiusure/2026-10' }
```

Ogni file genera un lotto con identificativo derivato dall'impronta del contenuto: lo stesso PDF non viene caricato due volte. Richiede il permesso `ingest:files` e l'archiviazione Azure configurata sulla Suite (altrimenti la risposta è `503 BLOB_DISABLED`).

### Lotti generici e stato

```powershell
Send-TDBatch -Dataset 'gipo:incassi' -Rows $righe -Source GIPO -Manifest @{ periodo = '2026-10'; versione = '1' }
Get-TDBatchStatus -BatchUid hr-2026-10-24
```

Un dataset non ancora gestito dalla Suite viene comunque registrato (`RECEIVED`) con le righe (massimo 1000) per i moduli futuri. Oltre 1000 righe `Send-TDBatch` spezza il lotto da solo (`<uid>-1`, `<uid>-2`, ...).

### Attività pianificata

Script `C:\TDSuite\Invia-Dipendenti.ps1`:

```powershell
Import-Module TD.Suite
Send-TDPeople -Path 'C:\Export\Zucchetti\dipendenti.csv' -Source Zucchetti -BatchUid ('hr-' + (Get-Date -Format yyyy-MM-dd))
```

Registrazione (una volta, dall'utente che ha eseguito `Connect-TDSuite -Save`):

```powershell
Register-TDScheduledTask -Name 'Suite TD - Dipendenti' -ScriptPath 'C:\TDSuite\Invia-Dipendenti.ps1' -At '06:30'
```

L'attività viene creata nella cartella `\Toscana Diagnostica\` dell'Utilità di pianificazione, con riprova ogni 15 minuti per 3 volte in caso di errore e limite di 2 ore. L'output dello script finisce in `%LOCALAPPDATA%\TDSuite\logs\task-<nome>.log`; il modulo scrive il proprio registro in `%LOCALAPPDATA%\TDSuite\logs\AAAA-MM-GG.log` (un file al giorno, con esito di ogni lotto ed errori riga per riga).

## Firma del modulo

La policy `AllSigned` (consigliata sui server) richiede che `.psd1` e `.psm1` siano firmati con un certificato di firma codice attendibile per il computer. Con il certificato aziendale (emesso dalla CA interna o acquistato, con uso "Code Signing") installato nell'archivio personale dell'utente che firma:

```powershell
$cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object Subject -like '*Toscana Diagnostica*' | Select-Object -First 1
Get-ChildItem .\TD.Suite\*.ps*1 | ForEach-Object {
  Set-AuthenticodeSignature -FilePath $_.FullName -Certificate $cert -HashAlgorithm SHA256 -TimestampServer http://timestamp.digicert.com
}
Get-AuthenticodeSignature .\TD.Suite\TD.Suite.psm1   # Status deve essere Valid
```

Indicazioni:
- firmare sempre con marca temporale: la firma resta valida anche dopo la scadenza del certificato;
- sui computer di destinazione il certificato della CA emittente deve stare in "Autorità di certificazione radice attendibili" e, se la CA è interna, il certificato di firma (o la CA) in "Autori attendibili" (`Cert:\LocalMachine\TrustedPublisher`), così PowerShell non chiede conferma;
- ogni modifica al modulo richiede una nuova firma; conservare la versione firmata in una share di sola lettura;
- firmare anche gli script `.ps1` pianificati, perché con `AllSigned` anche quelli devono essere firmati.

## Sicurezza

- La chiave API viaggia solo nell'header `Authorization` su HTTPS. Il modulo rifiuta indirizzi che non iniziano per `http(s)://` e impone TLS 1.2.
- Il server limita ogni chiave a 120 richieste al minuto e a 1000 righe per lotto, verifica i permessi per dataset, registra ogni lotto (checksum SHA-256 del corpo, esito riga per riga) nel registro importazioni consultabile dagli amministratori e scrive l'audit con il nome della sorgente.
- I dati inviati sono anagrafici e organizzativi (chi è, dove lavora, cosa fa). Non inviare retribuzioni, dati sanitari o documenti con dati dei pazienti: la Suite non li gestisce e non ne ha bisogno.
- Le persone nuove create dall'ingestione non ricevono un accesso alla Suite: gli account li crea e abilita l'amministratore.
- In caso di smarrimento di una postazione revocare subito la chiave dalla Suite: la connessione salvata diventa inutilizzabile.

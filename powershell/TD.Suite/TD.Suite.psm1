#Requires -Version 5.1
<#
    TD.Suite · client PowerShell per l'API di ingestione di Suite TD (Toscana Diagnostica).
    Compatibile con Windows PowerShell 5.1 e PowerShell 7.
    Tutte le chiamate usano l'header Authorization: Bearer <chiave API>. Nessun dato viene scritto nei database legacy.
#>

Set-StrictMode -Version 1.0

# ------------------------------------------------------------------ stato del modulo
$script:TDConnection = $null          # @{ BaseUrl; ApiKey (SecureString) }
$script:TDMaxRows = 1000              # limite del server per lotto
$script:TDUserAgent = 'TD.Suite-PowerShell/0.1.0'

if ([System.Net.ServicePointManager]::SecurityProtocol -notmatch 'Tls12') {
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12
}

function Get-TDAppDataPath {
    $base = $env:LOCALAPPDATA
    if (-not $base) { $base = Join-Path $HOME '.local/share' }
    $dir = Join-Path $base 'TDSuite'
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    return $dir
}

function Write-TDLog {
    <# Scrive una riga nel registro giornaliero %LOCALAPPDATA%\TDSuite\logs\AAAA-MM-GG.log #>
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Message, [ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level = 'INFO')
    try {
        $dir = Join-Path (Get-TDAppDataPath) 'logs'
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        $file = Join-Path $dir ((Get-Date).ToString('yyyy-MM-dd') + '.log')
        $line = '{0} [{1}] {2}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Level, $Message
        Add-Content -Path $file -Value $line -Encoding UTF8
    } catch { Write-Verbose "Registro non scrivibile: $($_.Exception.Message)" }
    switch ($Level) { 'WARN' { Write-Warning $Message } 'ERROR' { Write-Verbose $Message } default { Write-Verbose $Message } }
}

function ConvertFrom-TDSecureString {
    param([Parameter(Mandatory)][System.Security.SecureString]$Secure)
    $ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Get-TDConnection {
    if ($script:TDConnection) { return $script:TDConnection }
    $file = Join-Path (Get-TDAppDataPath) 'connection.xml'
    if (Test-Path $file) {
        try {
            $saved = Import-Clixml -Path $file
            $script:TDConnection = @{ BaseUrl = $saved.BaseUrl; ApiKey = $saved.ApiKey }
            Write-TDLog "Connessione caricata dal profilo utente ($($saved.BaseUrl))"
            return $script:TDConnection
        } catch { throw "Connessione salvata non leggibile ($($_.Exception.Message)). Esegui di nuovo Connect-TDSuite." }
    }
    throw 'Nessuna connessione attiva: esegui prima Connect-TDSuite -BaseUrl ... -ApiKey ...'
}

function Get-TDErrorBody {
    <# Estrae il corpo JSON di un errore HTTP in modo compatibile tra PowerShell 5.1 e 7 #>
    param($ErrorRecord)
    $text = $null
    try {
        if ($ErrorRecord.ErrorDetails -and $ErrorRecord.ErrorDetails.Message) { $text = $ErrorRecord.ErrorDetails.Message }
        elseif ($ErrorRecord.Exception.Response) {
            $stream = $ErrorRecord.Exception.Response.GetResponseStream()
            if ($stream) { $reader = New-Object System.IO.StreamReader($stream); $text = $reader.ReadToEnd(); $reader.Dispose() }
        }
    } catch { }
    $status = $null
    try { $status = [int]$ErrorRecord.Exception.Response.StatusCode } catch { }
    $obj = $null
    if ($text) { try { $obj = $text | ConvertFrom-Json } catch { } }
    return [pscustomobject]@{ Status = $status; Text = $text; Json = $obj }
}

function Invoke-TDRequest {
    <# Chiamata HTTP verso /api/ingest con riprova (3 tentativi, attesa crescente) sugli errori di rete e sui 5xx #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateSet('GET', 'POST')][string]$Method,
        [Parameter(Mandatory)][string]$Path,
        [object]$Body,
        [int]$Retries = 3
    )
    $conn = Get-TDConnection
    $uri = $conn.BaseUrl.TrimEnd('/') + '/api/ingest/' + $Path.TrimStart('/')
    $headers = @{ Authorization = 'Bearer ' + (ConvertFrom-TDSecureString $conn.ApiKey); Accept = 'application/json'; 'User-Agent' = $script:TDUserAgent }
    $json = $null
    if ($null -ne $Body) { $json = [System.Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 12 -Compress)) }
    $attempt = 0
    while ($true) {
        $attempt++
        try {
            if ($Method -eq 'GET') { return Invoke-RestMethod -Method Get -Uri $uri -Headers $headers -TimeoutSec 120 }
            return Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body $json -ContentType 'application/json; charset=utf-8' -TimeoutSec 300
        } catch {
            $info = Get-TDErrorBody $_
            $transient = (-not $info.Status) -or ($info.Status -ge 500) -or ($info.Status -eq 429)
            if ($transient -and $attempt -lt $Retries) {
                $wait = [math]::Pow(2, $attempt) * 2
                Write-TDLog "Tentativo $attempt su $Retries fallito per $Method $Path (stato: $($info.Status)): riprovo tra $wait s" 'WARN'
                Start-Sleep -Seconds $wait
                continue
            }
            $msg = if ($info.Json -and $info.Json.error) { $info.Json.error } elseif ($info.Text) { $info.Text } else { $_.Exception.Message }
            Write-TDLog "Errore $Method $Path (stato: $($info.Status)): $msg" 'ERROR'
            throw "Suite TD ha risposto con un errore (stato $($info.Status)): $msg"
        }
    }
}

# ------------------------------------------------------------------ cmdlet pubblici

function Connect-TDSuite {
    <#
    .SYNOPSIS
        Imposta l'indirizzo della Suite e la chiave API da usare nelle chiamate successive.
    .DESCRIPTION
        La chiave resta in memoria per la sessione corrente. Con -Save viene salvata cifrata nel profilo utente
        (%LOCALAPPDATA%\TDSuite\connection.xml, protezione DPAPI dell'utente Windows che la salva): le sessioni
        successive, anche le attività pianificate eseguite dallo stesso utente, la ritrovano senza doverla ripetere.
        La chiave API si crea dalla Suite in Amministrazione > Chiavi API e compare in chiaro una sola volta.
    .PARAMETER BaseUrl
        Indirizzo della Suite, es. https://suite.toscanadiagnostica.it
    .PARAMETER ApiKey
        Chiave API (inizia con tds_). Accetta una stringa o una SecureString.
    .PARAMETER Save
        Salva la connessione cifrata nel profilo dell'utente corrente.
    .EXAMPLE
        Connect-TDSuite -BaseUrl https://suite.toscanadiagnostica.it -ApiKey (Read-Host -AsSecureString 'Chiave API') -Save
    .EXAMPLE
        Connect-TDSuite -BaseUrl https://suite.toscanadiagnostica.it -ApiKey $env:TD_SUITE_KEY
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidatePattern('^https?://')][string]$BaseUrl,
        [Parameter(Mandatory)][object]$ApiKey,
        [switch]$Save
    )
    $secure = if ($ApiKey -is [System.Security.SecureString]) { $ApiKey } else { ConvertTo-SecureString -String ([string]$ApiKey) -AsPlainText -Force }
    $plain = ConvertFrom-TDSecureString $secure
    if ($plain -notmatch '^tds_[A-Za-z0-9_-]{40}$') { throw 'Chiave API non valida: deve iniziare con tds_ ed essere lunga 44 caratteri.' }
    $script:TDConnection = @{ BaseUrl = $BaseUrl.TrimEnd('/'); ApiKey = $secure }
    if ($Save) {
        $file = Join-Path (Get-TDAppDataPath) 'connection.xml'
        [pscustomobject]@{ BaseUrl = $script:TDConnection.BaseUrl; ApiKey = $secure; SavedAt = (Get-Date) } | Export-Clixml -Path $file -Force
        Write-TDLog "Connessione salvata in $file"
        Write-Host "Connessione salvata per l'utente corrente in $file"
    }
    Write-TDLog "Connesso a $($script:TDConnection.BaseUrl)"
    return Test-TDSuite
}

function Disconnect-TDSuite {
    <#
    .SYNOPSIS
        Dimentica la connessione corrente e, con -RemoveSaved, cancella quella salvata nel profilo.
    #>
    [CmdletBinding()]
    param([switch]$RemoveSaved)
    $script:TDConnection = $null
    if ($RemoveSaved) { $file = Join-Path (Get-TDAppDataPath) 'connection.xml'; if (Test-Path $file) { Remove-Item $file -Force } }
    Write-TDLog 'Disconnesso'
}

function Test-TDSuite {
    <#
    .SYNOPSIS
        Verifica la chiave API (GET /api/ingest/ping) e restituisce sorgente, permessi e sede associata.
    .EXAMPLE
        Test-TDSuite
    #>
    [CmdletBinding()]
    param()
    $r = Invoke-TDRequest -Method GET -Path 'ping'
    Write-TDLog "Ping ok: sorgente $($r.source), permessi $($r.scopes -join ', ')"
    return $r
}

function Send-TDBatch {
    <#
    .SYNOPSIS
        Invia un lotto di righe a un dataset della Suite (POST /api/ingest/<dataset>).
    .DESCRIPTION
        Le righe sono oggetti PowerShell (o hashtable) con i campi previsti dal dataset. Oltre 1000 righe il lotto viene
        spezzato automaticamente in più lotti con batch_uid progressivo (<BatchUid>-1, -2, ...). Ogni lotto è idempotente:
        se lo stesso batch_uid viene inviato due volte il server risponde DUPLICATE senza riapplicarlo.
        Errori di rete e risposte 5xx vengono ritentati tre volte con attesa crescente. Tutto viene registrato in
        %LOCALAPPDATA%\TDSuite\logs\AAAA-MM-GG.log.
    .PARAMETER Dataset
        people | sites | organizations | events | news oppure un dataset futuro (viene solo registrato dal server).
    .PARAMETER Rows
        Righe da inviare.
    .PARAMETER Source
        Nome del sistema di origine (es. Zucchetti, GIPO, Excel). Informativo: la sorgente ufficiale è quella della chiave API.
    .PARAMETER BatchUid
        Identificativo del lotto. Se omesso viene generato un GUID. Usa un valore stabile (es. "hr-2026-10-24") per rendere
        l'invio ripetibile senza duplicati.
    .PARAMETER Manifest
        Informazioni libere sul lotto (file di origine, periodo, versione dell'export).
    .EXAMPLE
        $righe = Import-Csv .\dipendenti.csv -Delimiter ';' -Encoding UTF8
        Send-TDBatch -Dataset people -Rows $righe -Source Zucchetti -BatchUid ("hr-" + (Get-Date -Format yyyy-MM-dd))
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidatePattern('^[a-z0-9_:-]{2,40}$')][string]$Dataset,
        [Parameter(Mandatory, ValueFromPipeline)][object[]]$Rows,
        [string]$Source = 'POWERSHELL',
        [string]$BatchUid,
        [hashtable]$Manifest
    )
    begin { $all = New-Object System.Collections.Generic.List[object] }
    process { foreach ($r in $Rows) { if ($null -ne $r) { $all.Add($r) } } }
    end {
        if (-not $BatchUid) { $BatchUid = [guid]::NewGuid().ToString() }
        if ($BatchUid -notmatch '^[A-Za-z0-9_.:-]{8,120}$') { throw 'BatchUid non valido: 8-120 caratteri tra lettere, numeri, punto, due punti, trattino.' }
        $rows = @($all.ToArray() | ForEach-Object { ConvertTo-TDRow $_ })
        $chunks = @()
        if ($rows.Count -le $script:TDMaxRows) { $chunks += , @{ Uid = $BatchUid; Rows = $rows } }
        else {
            $n = [math]::Ceiling($rows.Count / $script:TDMaxRows)
            for ($i = 0; $i -lt $n; $i++) {
                $slice = $rows[($i * $script:TDMaxRows)..([math]::Min(($i + 1) * $script:TDMaxRows, $rows.Count) - 1)]
                $chunks += , @{ Uid = ('{0}-{1}' -f $BatchUid, ($i + 1)); Rows = @($slice) }
            }
            Write-TDLog "Lotto $BatchUid spezzato in $n parti da massimo $($script:TDMaxRows) righe"
        }
        $results = @()
        foreach ($c in $chunks) {
            $body = @{ batch_uid = $c.Uid; source = $Source; rows = @($c.Rows) }
            if ($Manifest) { $body.manifest = $Manifest }
            Write-TDLog "Invio $Dataset lotto $($c.Uid): $($c.Rows.Count) righe"
            $res = Invoke-TDRequest -Method POST -Path $Dataset -Body $body
            Write-TDLog "Esito $($c.Uid): $($res.status) (ok $($res.rows_ok), scartate $($res.rows_rejected))"
            if ($res.errors -and $res.errors.Count -gt 0) { foreach ($e in $res.errors) { Write-TDLog ("  riga {0}: {1}" -f $e.row, $e.error) 'WARN' } }
            $results += $res
        }
        return $results
    }
}

function ConvertTo-TDRow {
    <# Normalizza una riga: hashtable o oggetto → hashtable con stringhe vuote convertite in null e numeri riconosciuti #>
    param($Row)
    $h = @{}
    $props = if ($Row -is [hashtable]) { $Row.Keys } else { $Row.PSObject.Properties.Name }
    foreach ($p in $props) {
        $v = if ($Row -is [hashtable]) { $Row[$p] } else { $Row.$p }
        if ($v -is [string]) { $v = $v.Trim(); if ($v -eq '') { $v = $null } }
        if ($v -is [datetime]) { $v = $v.ToString('yyyy-MM-dd') }
        $h[[string]$p] = $v
    }
    return $h
}

function Send-TDPeople {
    <#
    .SYNOPSIS
        Invia persone (dipendenti, liberi professionisti, medici) alla rubrica della Suite da un CSV o da oggetti.
    .DESCRIPTION
        Campi riconosciuti: last_name, first_name, email, tax_code, kind (DIPENDENTE|LP|MEDICO|SANITARIO|ESTERNO|DIRIGENTE),
        status (CANDIDATO|IMPEGNO|ATTIVO|CESSATO), area, job_title, discipline, title, site_code, phone, phone_office,
        hired_at, terminated_at (AAAA-MM-GG), external_id. Le intestazioni in italiano più comuni vengono tradotte
        (Cognome, Nome, Email, CodiceFiscale, Area, Mansione, Sede, Telefono, Matricola).
        La Suite riconcilia per codice fiscale, poi per email.
    .PARAMETER Path
        File CSV esportato dal gestionale (separatore ; o , riconosciuto in automatico, UTF-8).
    .PARAMETER Rows
        In alternativa al CSV: oggetti già pronti.
    .EXAMPLE
        Send-TDPeople -Path 'C:\Export\Zucchetti\dipendenti.csv' -Source Zucchetti -BatchUid ("hr-" + (Get-Date -Format yyyy-MM-dd))
    .EXAMPLE
        Import-Excel .\organico.xlsx | Send-TDPeople -Source Excel
    #>
    [CmdletBinding(DefaultParameterSetName = 'Rows')]
    param(
        [Parameter(Mandatory, ParameterSetName = 'Csv')][string]$Path,
        [Parameter(Mandatory, ParameterSetName = 'Rows', ValueFromPipeline)][object[]]$Rows,
        [string]$Source = 'POWERSHELL',
        [string]$BatchUid
    )
    begin { $buf = New-Object System.Collections.Generic.List[object] }
    process { if ($PSCmdlet.ParameterSetName -eq 'Rows') { foreach ($r in $Rows) { $buf.Add($r) } } }
    end {
        if ($PSCmdlet.ParameterSetName -eq 'Csv') { foreach ($r in (Import-TDCsv $Path)) { $buf.Add($r) } }
        $map = @{ cognome = 'last_name'; nome = 'first_name'; email = 'email'; 'e-mail' = 'email'; codicefiscale = 'tax_code'; cf = 'tax_code'; tipo = 'kind'; stato = 'status';
                  area = 'area'; mansione = 'job_title'; qualifica = 'job_title'; disciplina = 'discipline'; titolo = 'title'; sede = 'site_code'; codicesede = 'site_code';
                  telefono = 'phone'; cellulare = 'phone'; telefonoufficio = 'phone_office'; interno = 'phone_office'; dataassunzione = 'hired_at'; assunzione = 'hired_at';
                  datacessazione = 'terminated_at'; cessazione = 'terminated_at'; matricola = 'external_id'; id = 'external_id' }
        $rows = @($buf.ToArray() | ForEach-Object { Rename-TDColumns $_ $map })
        if (-not $rows.Count) { Write-Warning 'Nessuna riga da inviare'; return }
        Send-TDBatch -Dataset people -Rows $rows -Source $Source -BatchUid $BatchUid -Manifest @{ file = $(if ($Path) { Split-Path $Path -Leaf } else { $null }) }
    }
}

function Send-TDSites {
    <#
    .SYNOPSIS
        Invia sedi (code, name, kind, address, zip, city, province, phone, email, manager_name, studiolab_code, organization_code) da CSV o oggetti.
    .EXAMPLE
        Send-TDSites -Path .\sedi.csv -Source Excel -BatchUid sedi-2026-10
    #>
    [CmdletBinding(DefaultParameterSetName = 'Rows')]
    param(
        [Parameter(Mandatory, ParameterSetName = 'Csv')][string]$Path,
        [Parameter(Mandatory, ParameterSetName = 'Rows', ValueFromPipeline)][object[]]$Rows,
        [string]$Source = 'POWERSHELL',
        [string]$BatchUid
    )
    begin { $buf = New-Object System.Collections.Generic.List[object] }
    process { if ($PSCmdlet.ParameterSetName -eq 'Rows') { foreach ($r in $Rows) { $buf.Add($r) } } }
    end {
        if ($PSCmdlet.ParameterSetName -eq 'Csv') { foreach ($r in (Import-TDCsv $Path)) { $buf.Add($r) } }
        $map = @{ codice = 'code'; nome = 'name'; denominazione = 'name'; nomebreve = 'short_name'; tipo = 'kind'; indirizzo = 'address'; cap = 'zip'; citta = 'city'; 'città' = 'city'; comune = 'city';
                  provincia = 'province'; prov = 'province'; telefono = 'phone'; email = 'email'; responsabile = 'manager_name'; sitemanager = 'manager_name'; codicestudiolab = 'studiolab_code';
                  orari = 'opening_hours'; insegna = 'legacy_brand'; societa = 'organization_code'; 'società' = 'organization_code' }
        $rows = @($buf.ToArray() | ForEach-Object { Rename-TDColumns $_ $map })
        if (-not $rows.Count) { Write-Warning 'Nessuna riga da inviare'; return }
        Send-TDBatch -Dataset sites -Rows $rows -Source $Source -BatchUid $BatchUid
    }
}

function Send-TDEvents {
    <#
    .SYNOPSIS
        Invia eventi al calendario della Suite (title, starts_at, ends_at, kind, location, site_code, external_id obbligatorio).
    .DESCRIPTION
        starts_at ed ends_at accettano date PowerShell o stringhe ISO 8601 con fuso orario. external_id rende l'evento
        aggiornabile: reinviando lo stesso external_id l'evento viene aggiornato e non duplicato.
    .EXAMPLE
        $ev = @(@{ title = 'Chiusura cassa mensile'; starts_at = (Get-Date '2026-10-31 17:00'); kind = 'SCADENZA'; site_code = 'FI-CAL'; external_id = 'CHIUS-2026-10' })
        Send-TDEvents -Rows $ev -Source Cassa
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, ValueFromPipeline)][object[]]$Rows,
        [string]$Source = 'POWERSHELL',
        [string]$BatchUid
    )
    begin { $buf = New-Object System.Collections.Generic.List[object] }
    process { foreach ($r in $Rows) { $buf.Add($r) } }
    end {
        $map = @{ titolo = 'title'; descrizione = 'description'; tipo = 'kind'; inizio = 'starts_at'; fine = 'ends_at'; luogo = 'location'; sede = 'site_code'; id = 'external_id' }
        $rows = @($buf.ToArray() | ForEach-Object {
            $h = Rename-TDColumns $_ $map
            foreach ($k in @('starts_at', 'ends_at')) {
                if ($h.ContainsKey($k) -and $h[$k]) {
                    $d = $h[$k]; if ($d -isnot [datetime]) { $d = [datetime]::Parse([string]$d) }
                    $h[$k] = ([datetimeoffset]$d).ToString('yyyy-MM-ddTHH:mm:sszzz')
                }
            }
            $h
        })
        if (-not $rows.Count) { Write-Warning 'Nessuna riga da inviare'; return }
        Send-TDBatch -Dataset events -Rows $rows -Source $Source -BatchUid $BatchUid
    }
}

function Send-TDFile {
    <#
    .SYNOPSIS
        Carica un file nella Suite (POST /api/ingest/files, multipart) in una cartella logica, es. le chiusure cassa in PDF.
    .DESCRIPTION
        Richiede il permesso ingest:files sulla chiave e l'archiviazione Azure configurata sulla Suite (altrimenti 503 BLOB_DISABLED).
        Il batch_uid predefinito è derivato dal nome del file e dal suo hash, quindi lo stesso file non viene caricato due volte.
    .PARAMETER Path
        File da caricare.
    .PARAMETER Folder
        Cartella logica di destinazione (es. chiusure/2026-10).
    .EXAMPLE
        Get-ChildItem 'C:\Cassa\Chiusure\2026-10\*.pdf' | ForEach-Object { Send-TDFile -Path $_.FullName -Folder 'chiusure/2026-10' }
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory, ValueFromPipelineByPropertyName)][Alias('FullName')][string]$Path,
        [string]$Folder,
        [string]$BatchUid
    )
    process {
        if (-not (Test-Path $Path -PathType Leaf)) { throw "File non trovato: $Path" }
        $conn = Get-TDConnection
        $file = Get-Item $Path
        if (-not $BatchUid) {
            $hash = (Get-FileHash -Path $Path -Algorithm SHA256).Hash.Substring(0, 16).ToLower()
            $BatchUid = ('file-{0}-{1}' -f $hash, ($file.Name -replace '[^A-Za-z0-9_.-]', '_')).Substring(0, [math]::Min(120, 22 + $file.Name.Length))
        }
        $uri = $conn.BaseUrl.TrimEnd('/') + '/api/ingest/files'
        Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue
        $attempt = 0
        while ($true) {
            $attempt++
            $client = $null; $content = $null; $stream = $null
            try {
                $client = New-Object System.Net.Http.HttpClient
                $client.Timeout = [TimeSpan]::FromMinutes(10)
                $client.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', (ConvertFrom-TDSecureString $conn.ApiKey))
                $client.DefaultRequestHeaders.UserAgent.ParseAdd($script:TDUserAgent)
                $content = New-Object System.Net.Http.MultipartFormDataContent
                $content.Add((New-Object System.Net.Http.StringContent($BatchUid)), 'batch_uid')
                if ($Folder) { $content.Add((New-Object System.Net.Http.StringContent($Folder)), 'folder') }
                $stream = [System.IO.File]::OpenRead($file.FullName)
                $fc = New-Object System.Net.Http.StreamContent($stream)
                $fc.Headers.ContentType = New-Object System.Net.Http.Headers.MediaTypeHeaderValue((Get-TDMime $file.Extension))
                $content.Add($fc, 'file', $file.Name)
                Write-TDLog "Upload $($file.Name) ($([math]::Round($file.Length / 1KB)) KB) in $Folder, lotto $BatchUid"
                $resp = $client.PostAsync($uri, $content).GetAwaiter().GetResult()
                $text = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                $status = [int]$resp.StatusCode
                $json = $null; try { $json = $text | ConvertFrom-Json } catch { }
                if ($resp.IsSuccessStatusCode) { Write-TDLog "Esito upload $BatchUid: $($json.status)"; return $json }
                if (($status -ge 500 -and $status -ne 503) -or $status -eq 429) { throw [System.Net.WebException]::new("Stato $status") }
                $msg = if ($json -and $json.error) { $json.error } else { $text }
                Write-TDLog "Upload rifiutato ($status): $msg" 'ERROR'
                throw "Suite TD ha rifiutato il file (stato $status): $msg"
            } catch [System.Net.WebException], [System.Net.Http.HttpRequestException], [System.Threading.Tasks.TaskCanceledException] {
                if ($attempt -lt 3) { $wait = [math]::Pow(2, $attempt) * 2; Write-TDLog "Upload tentativo $attempt fallito: $($_.Exception.Message). Riprovo tra $wait s" 'WARN'; Start-Sleep -Seconds $wait; continue }
                Write-TDLog "Upload fallito dopo 3 tentativi: $($_.Exception.Message)" 'ERROR'
                throw
            } finally {
                if ($stream) { $stream.Dispose() }
                if ($content) { $content.Dispose() }
                if ($client) { $client.Dispose() }
            }
        }
    }
}

function Get-TDBatchStatus {
    <#
    .SYNOPSIS
        Legge lo stato di un lotto inviato (GET /api/ingest/status/<batch_uid>).
    .EXAMPLE
        Get-TDBatchStatus -BatchUid hr-2026-10-24
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory, ValueFromPipelineByPropertyName)][Alias('batch_uid')][string]$BatchUid)
    process { Invoke-TDRequest -Method GET -Path ('status/' + [uri]::EscapeDataString($BatchUid)) }
}

function Register-TDScheduledTask {
    <#
    .SYNOPSIS
        Crea (o sostituisce) un'attività pianificata di Windows che esegue uno script PowerShell a un'ora data, con riprova in caso di errore.
    .DESCRIPTION
        L'attività gira con l'utente indicato (predefinito: l'utente corrente), quindi ritrova la connessione salvata con
        Connect-TDSuite -Save dallo stesso utente. In caso di esito negativo Windows riprova ogni 15 minuti per 3 volte.
        Richiede Windows e privilegi sufficienti per creare attività pianificate.
    .PARAMETER Name
        Nome dell'attività (sotto la cartella \Toscana Diagnostica\).
    .PARAMETER ScriptPath
        Script .ps1 da eseguire (es. C:\TDSuite\Invia-Dipendenti.ps1).
    .PARAMETER At
        Ora di esecuzione giornaliera (es. '06:30').
    .PARAMETER DaysOfWeek
        Se indicato, esecuzione settimanale nei giorni scelti anziché giornaliera.
    .PARAMETER User
        Account con cui eseguire. Predefinito: utente corrente (chiede la password se non si usa -Interactive).
    .EXAMPLE
        Register-TDScheduledTask -Name 'Suite TD - Dipendenti' -ScriptPath 'C:\TDSuite\Invia-Dipendenti.ps1' -At '06:30'
    .EXAMPLE
        Register-TDScheduledTask -Name 'Suite TD - Chiusure cassa' -ScriptPath 'C:\TDSuite\Invia-Chiusure.ps1' -At '20:15' -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday,Saturday
    #>
    [CmdletBinding(SupportsShouldProcess)]
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$ScriptPath,
        [Parameter(Mandatory)][ValidatePattern('^\d{1,2}:\d{2}$')][string]$At,
        [System.DayOfWeek[]]$DaysOfWeek,
        [string]$User = ("{0}\{1}" -f $env:USERDOMAIN, $env:USERNAME),
        [System.Security.SecureString]$Password,
        [switch]$Interactive
    )
    if (-not (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)) { throw 'Register-ScheduledTask non disponibile: questo cmdlet funziona solo su Windows.' }
    if (-not (Test-Path $ScriptPath)) { throw "Script non trovato: $ScriptPath" }
    $pwsh = if ($PSVersionTable.PSEdition -eq 'Core') { 'pwsh.exe' } else { 'powershell.exe' }
    $logDir = Join-Path (Get-TDAppDataPath) 'logs'
    $arg = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" *>> "{1}\task-{2}.log"' -f $ScriptPath, $logDir, ($Name -replace '[^A-Za-z0-9_-]', '_')
    $action = New-ScheduledTaskAction -Execute $pwsh -Argument $arg -WorkingDirectory (Split-Path $ScriptPath -Parent)
    $trigger = if ($DaysOfWeek) { New-ScheduledTaskTrigger -Weekly -DaysOfWeek $DaysOfWeek -At $At } else { New-ScheduledTaskTrigger -Daily -At $At }
    $settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 15) -ExecutionTimeLimit (New-TimeSpan -Hours 2) -StartWhenAvailable -MultipleInstances IgnoreNew -WakeToRun:$false
    $taskPath = '\Toscana Diagnostica\'
    if ($PSCmdlet.ShouldProcess("$taskPath$Name", 'Registrazione attività pianificata')) {
        $params = @{ TaskName = $Name; TaskPath = $taskPath; Action = $action; Trigger = $trigger; Settings = $settings; Force = $true; Description = "Suite TD: esegue $ScriptPath alle $At con riprova automatica" }
        if ($Interactive) { $params.Principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited }
        else {
            if (-not $Password) { $Password = Read-Host -AsSecureString "Password di $User (necessaria per eseguire l'attività anche senza utente collegato)" }
            $params.User = $User; $params.Password = (ConvertFrom-TDSecureString $Password)
        }
        $task = Register-ScheduledTask @params
        Write-TDLog "Attività pianificata registrata: $taskPath$Name alle $At ($ScriptPath)"
        return $task
    }
}

# ------------------------------------------------------------------ funzioni di supporto (non esportate)
function Import-TDCsv {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path $Path)) { throw "File non trovato: $Path" }
    $first = Get-Content -Path $Path -TotalCount 1 -Encoding UTF8
    $delim = if (($first -split ';').Count -ge ($first -split ',').Count) { ';' } else { ',' }
    return @(Import-Csv -Path $Path -Delimiter $delim -Encoding UTF8)
}

function Rename-TDColumns {
    param($Row, [hashtable]$Map)
    $h = @{}
    $props = if ($Row -is [hashtable]) { $Row.Keys } else { $Row.PSObject.Properties.Name }
    foreach ($p in $props) {
        $v = if ($Row -is [hashtable]) { $Row[$p] } else { $Row.$p }
        $k = ([string]$p).Trim()
        $norm = ($k -replace '[\s_-]', '').ToLowerInvariant()
        if ($Map.ContainsKey($norm)) { $k = $Map[$norm] }
        if ($v -is [string]) { $v = $v.Trim(); if ($v -eq '') { $v = $null } }
        if ($v -is [datetime]) { $v = $v.ToString('yyyy-MM-dd') }
        if ($null -ne $v -or -not $h.ContainsKey($k)) { $h[$k] = $v }
    }
    foreach ($k in @('kind', 'status')) { if ($h.ContainsKey($k) -and $h[$k] -is [string]) { $h[$k] = $h[$k].ToUpperInvariant() } }
    if ($h.ContainsKey('tax_code') -and $h['tax_code'] -is [string]) { $h['tax_code'] = $h['tax_code'].ToUpperInvariant() }
    return $h
}

function Get-TDMime {
    param([string]$Extension)
    switch ($Extension.ToLowerInvariant()) {
        '.pdf' { 'application/pdf' } '.csv' { 'text/csv' } '.xlsx' { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
        '.xls' { 'application/vnd.ms-excel' } '.docx' { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
        '.png' { 'image/png' } '.jpg' { 'image/jpeg' } '.jpeg' { 'image/jpeg' } '.txt' { 'text/plain' } '.json' { 'application/json' } '.xml' { 'application/xml' } '.zip' { 'application/zip' }
        default { 'application/octet-stream' }
    }
}

Export-ModuleMember -Function Connect-TDSuite, Disconnect-TDSuite, Test-TDSuite, Send-TDBatch, Send-TDPeople, Send-TDSites, Send-TDEvents, Send-TDFile, Get-TDBatchStatus, Register-TDScheduledTask

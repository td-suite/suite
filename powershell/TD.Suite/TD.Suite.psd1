@{
    RootModule        = 'TD.Suite.psm1'
    ModuleVersion     = '0.1.0'
    GUID              = '7f3c2b1e-6d0a-4a3e-9b7c-2c1e5a8d4f60'
    Author            = 'Toscana Diagnostica'
    CompanyName       = 'Toscana Diagnostica S.r.l.'
    Copyright         = '(c) Toscana Diagnostica. Tutti i diritti riservati.'
    Description       = 'Client PowerShell per l''API di ingestione di Suite TD (intranet e operating suite di Toscana Diagnostica): invio di persone, sedi, eventi e file da automatismi pianificati.'
    PowerShellVersion = '5.1'
    CompatiblePSEditions = @('Desktop', 'Core')
    FunctionsToExport = @(
        'Connect-TDSuite', 'Disconnect-TDSuite', 'Test-TDSuite', 'Send-TDBatch', 'Send-TDPeople', 'Send-TDSites', 'Send-TDEvents',
        'Send-TDFile', 'Get-TDBatchStatus', 'Register-TDScheduledTask'
    )
    CmdletsToExport   = @()
    VariablesToExport = @()
    AliasesToExport   = @()
    PrivateData       = @{
        PSData = @{
            Tags         = @('ToscanaDiagnostica', 'SuiteTD', 'Ingest', 'Automazione')
            ProjectUri   = 'https://suite.toscanadiagnostica.it'
            ReleaseNotes = 'Prima versione: connessione con chiave API, invio lotti con suddivisione automatica e riprova, upload file, attività pianificate.'
        }
    }
}

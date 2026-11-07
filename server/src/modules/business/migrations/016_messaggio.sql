-- 07/11/2026: tipo di contatto "WhatsApp/SMS" nel diario (richiesta del CEO) e indirizzo del portale referti fisso
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_tipo_check;
ALTER TABLE activities ADD CONSTRAINT activities_tipo_check
  CHECK (tipo IN ('CHIAMATA','EMAIL_IN','EMAIL_OUT','INCONTRO','SOPRALLUOGO','NOTA','OFFERTA','CRITICITA','SISTEMA','PACCHETTO',
                  'LISTINO','OFFERTA_ECONOMICA','ACCESSO','KIT','FORM_B2B','CONTRATTO_FIRMATO','ATTIVAZIONE','AVVIO',
                  'MESSAGGIO'));

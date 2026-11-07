-- Business Hub · contratto Service MOD230, Allegato 1 = Offerta economica impaginata (seconda richiesta del CEO del 07/11/2026: "credo
-- che l'allegato 1 e la lettera di offerta siano un doppione ... sostituisci l'allegato 1 con la lettera di offerta"). Il PDF generato del
-- contratto (GENERATO_PDF) contiene le pagine dell'offerta economica della versione corrente del listino: meta registra quale versione
-- c'è dentro, così il pacchetto e il kit di proposta non allegano una seconda volta gli stessi prezzi.
-- meta = { "allegato1_offerta": { "listino_id", "versione", "documento_id", "pagine", "pagina" } } (pagina = prima pagina dell'offerta nel
-- PDF del contratto, 1-based). NULL = PDF generato prima di questa modifica o senza offerta dentro. Docs: docs/BUSINESS_HUB.md.
ALTER TABLE contract_files ADD COLUMN IF NOT EXISTS meta JSONB;

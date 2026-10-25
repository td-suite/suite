-- Origine dell'incarico: AFFERENZA = creato dalla scheda persona (segue l'afferenza e si sposta con lei); MANUAL = inserito in Organizzazione o dal file
ALTER TABLE org_positions ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','AFFERENZA'));
-- gli incarichi senza ruolo e senza flag responsabile nati finora dall'afferenza
UPDATE org_positions op SET source='AFFERENZA' FROM people p WHERE p.id=op.person_id AND op.unit_id=p.unit_id AND NOT op.is_head AND op.source='MANUAL' AND (op.role_id IS NOT DISTINCT FROM p.role_id);

-- Gestione del Personale v0.86.0 (richiesta del CEO del 18/11/2026): il datore di lavoro non va considerato tra le scadenze di
-- sorveglianza sanitaria, formazione ed ECM. Il nome sta nelle impostazioni (Impostazioni > Scadenze) e si può cambiare.
-- Idempotente: si scrive solo se l'impostazione non esiste ancora.
INSERT INTO app_settings (key, value) VALUES ('datore_lavoro', 'Epifani Francesco') ON CONFLICT (key) DO NOTHING;

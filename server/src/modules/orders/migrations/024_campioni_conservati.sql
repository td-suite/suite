-- v0.99.13: giorno da cui la copia Synclab conserva i campioni delle accettazioni chiuse (prima li perdeva alla chiusura).
-- La produzione misurata dalle etichette e il consumo dai campioni valgono da questo giorno. Scritto una volta sola, alla pubblicazione.
INSERT INTO public.app_settings (key, value) VALUES ('synclab.campioni_dal', to_jsonb(current_date::text)) ON CONFLICT (key) DO NOTHING;

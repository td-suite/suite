-- Anagrafica unica della Suite (docs/ANAGRAFICA.md): le sedi e le strutture clienti esistono una volta sola in public.sites,
-- i clienti Service in public.organizations. La tabella strutture dell'app sparisce; resta site_ext con i soli campi
-- operativi di Ordini e Magazzino. Ogni colonna che referenziava strutture ora punta a public.sites(id).
-- La struttura dell'utente (profili CLIENTE/SEDE/LAB) viene dall'ambito del grant Suite (req.user.site_ids), non più da users.
-- La Suite parte vuota: nessun travaso delle anagrafiche dell'app di origine. I dati del modulo sono di prova e vengono
-- azzerati qui, così le chiavi esterne verso public.sites si creano su tabelle coerenti.

DROP TABLE IF EXISTS strutture CASCADE;
ALTER TABLE users DROP COLUMN IF EXISTS struttura_id;

TRUNCATE orders, order_lines, packages, stock_counts, stock_count_lines, stock_count_extras, order_events, issues, production, email_log CASCADE;

-- Impostazioni Ordini della sede. kind = ruolo della struttura nel flusso ordini (CLIENTE Service, SEDE del network, LAB TD);
-- se manca la riga vale quello dedotto dal tipo di sede (SERVICE -> CLIENTE, LABORATORIO -> LAB, altrimenti SEDE).
CREATE TABLE site_ext (
  site_id            INT PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
  kind               TEXT CHECK (kind IN ('CLIENTE','SEDE','LAB')),
  silva_code         TEXT,                                   -- codice cliente / destinazione nel magazzino Silva
  stock_deadline_day INT CHECK (stock_deadline_day BETWEEN 1 AND 31),  -- giorno limite per la giacenza mensile
  referente          TEXT,                                   -- referente per le consegne
  referente_phone    TEXT,
  delivery_mode      TEXT NOT NULL DEFAULT 'GIRO' CHECK (delivery_mode IN ('GIRO','RITIRO')),
  delivery_notes     TEXT,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX site_ext_silva_code_uq ON site_ext (upper(silva_code)) WHERE silva_code IS NOT NULL AND silva_code <> '';

-- Chiavi esterne verso l'anagrafica unica (il DROP CASCADE le ha tolte)
ALTER TABLE orders       ADD CONSTRAINT orders_struttura_id_fkey       FOREIGN KEY (struttura_id) REFERENCES public.sites(id);
ALTER TABLE production   ADD CONSTRAINT production_struttura_id_fkey   FOREIGN KEY (struttura_id) REFERENCES public.sites(id);
ALTER TABLE packages     ADD CONSTRAINT packages_struttura_id_fkey     FOREIGN KEY (struttura_id) REFERENCES public.sites(id);
ALTER TABLE stock_counts ADD CONSTRAINT stock_counts_struttura_id_fkey FOREIGN KEY (struttura_id) REFERENCES public.sites(id);
ALTER TABLE issues       ADD CONSTRAINT issues_struttura_id_fkey       FOREIGN KEY (struttura_id) REFERENCES public.sites(id);
ALTER TABLE email_log    ADD CONSTRAINT email_log_struttura_id_fkey    FOREIGN KEY (struttura_id) REFERENCES public.sites(id) ON DELETE SET NULL;

-- Vista con le colonne che il codice dell'app si aspetta dalla vecchia tabella strutture: tutte le sedi dell'anagrafica unica
-- con le impostazioni Ordini (riga di site_ext se presente, altrimenti i valori dedotti). Per le strutture clienti (SERVICE)
-- la PEC e la partita IVA vengono dall'organizzazione cliente. Le FK restano su public.sites.
CREATE VIEW sites_v AS
  SELECT s.id, s.code, s.name, s.short_name, s.kind AS site_kind, k.kind,
         s.address, s.zip, s.city, s.province, s.phone, s.email, o.pec, o.vat_number,
         s.organization_id, o.name AS organization_name,
         s.studiolab_code, e.silva_code,
         coalesce(e.stock_deadline_day, CASE WHEN k.kind = 'LAB' THEN 30 ELSE 15 END) AS stock_deadline_day,
         e.referente, e.referente_phone, coalesce(e.delivery_mode, 'GIRO') AS delivery_mode, e.delivery_notes, e.notes,
         (e.site_id IS NOT NULL) AS configured,
         s.active, s.sort_order, s.created_at, coalesce(e.updated_at, s.updated_at) AS updated_at
    FROM public.sites s
    LEFT JOIN site_ext e ON e.site_id = s.id
    LEFT JOIN public.organizations o ON o.id = s.organization_id
    CROSS JOIN LATERAL (SELECT coalesce(e.kind, CASE s.kind WHEN 'SERVICE' THEN 'CLIENTE' WHEN 'LABORATORIO' THEN 'LAB' ELSE 'SEDE' END) AS kind) k;

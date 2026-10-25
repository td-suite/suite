-- Anagrafica unica della Suite (docs/ANAGRAFICA.md): le sedi esistono una volta sola in public.sites e le persone in
-- public.people, caricate da Amministrazione. La tabella sedi dell'app e il personale di sede (site_staff) spariscono;
-- restano site_ext (impostazioni Retail della sede: perimetro del network, area TuoTempo, codici nei gestionali, parametri per
-- budget e mercato, scheda struttura, note) e person_ext (piano di lavoro Retail della persona: ruolo in sede, ore, giorni).
-- Ogni colonna che referenziava sites ora punta a public.sites(id). Il perimetro del profilo SEDE viene dagli scope del grant
-- Suite (req.user.site_ids), non più da users.site_id.
-- La Suite parte vuota: nessuna copia delle anagrafiche dall'app di origine, nessuna traduzione con legacy_refs.

DROP TABLE IF EXISTS site_staff CASCADE;
DROP TABLE IF EXISTS sites CASCADE;
ALTER TABLE users DROP COLUMN IF EXISTS site_id;

-- Impostazioni Retail della sede (la riga nasce alla prima scrittura: upsert). Codice, nome, tipologia, indirizzo, contatti,
-- site manager, insegna precedente, orario ufficiale e stato attivo vengono da public.sites e si modificano in Amministrazione.
CREATE TABLE site_ext (
  site_id           INT PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
  in_network        BOOLEAN,                 -- sede del network Retail (budget, esposizione, vendite); NULL = automatico dalla tipologia
  -- Connettori e import dai gestionali
  tuotempo_area_id  TEXT,                    -- area TuoTempo abbinata (sincronizzazione Key Entities)
  gipo_site_code    TEXT,                    -- codice sede negli export GIPO (riconoscimento della colonna sede negli import)
  studiolab_code    TEXT,                    -- codice sede negli export StudioLab, se diverso da public.sites.studiolab_code
  -- Parametri per budget e scostamenti
  saturday_open     BOOLEAN NOT NULL DEFAULT TRUE,   -- giorni lavorabili del calendario di Budget
  catchment_cities  TEXT,                    -- comuni del bacino (separati da virgola) per i dati di mercato
  -- Scheda struttura (book retail e scheda sede)
  sqm_waiting       INT,                     -- mq sala d'attesa
  surface_sqm       INT,
  rooms             INT,
  boxes             INT,                     -- box prelievo / postazioni
  parking           TEXT,
  accessibility     TEXT,
  services          TEXT,                    -- descrizione dei servizi offerti
  description       TEXT,
  opened_at         DATE,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX site_ext_tuotempo_idx ON site_ext (tuotempo_area_id) WHERE tuotempo_area_id IS NOT NULL;

-- Piano di lavoro Retail della persona (nome, ruolo contrattuale, contatti, sede e stato vengono da public.people)
CREATE TABLE person_ext (
  person_id     INT PRIMARY KEY REFERENCES public.people(id) ON DELETE CASCADE,
  retail_role   TEXT,                        -- ruolo in sede per Retail: Site manager, Accettazione, Infermiere, Tecnico, Medico...
  weekly_hours  NUMERIC(5,2),                -- ore settimanali in sede (per il calcolo FTE)
  days          TEXT,                        -- es. lun-ven, mar/gio
  notes         TEXT,
  sort_order    INT NOT NULL DEFAULT 100,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chiavi esterne verso l'anagrafica unica (il DROP CASCADE le ha tolte)
ALTER TABLE customers       ADD CONSTRAINT customers_home_site_id_fkey FOREIGN KEY (home_site_id) REFERENCES public.sites(id) ON DELETE SET NULL;
ALTER TABLE sales           ADD CONSTRAINT sales_site_id_fkey           FOREIGN KEY (site_id)      REFERENCES public.sites(id);
ALTER TABLE exposure_items  ADD CONSTRAINT exposure_items_site_id_fkey  FOREIGN KEY (site_id)      REFERENCES public.sites(id) ON DELETE CASCADE;
ALTER TABLE exposure_photos ADD CONSTRAINT exposure_photos_site_id_fkey FOREIGN KEY (site_id)      REFERENCES public.sites(id) ON DELETE CASCADE;
ALTER TABLE working_days    ADD CONSTRAINT working_days_site_id_fkey    FOREIGN KEY (site_id)      REFERENCES public.sites(id) ON DELETE CASCADE;
ALTER TABLE budgets         ADD CONSTRAINT budgets_site_id_fkey         FOREIGN KEY (site_id)      REFERENCES public.sites(id) ON DELETE CASCADE;
ALTER TABLE variance_notes  ADD CONSTRAINT variance_notes_site_id_fkey  FOREIGN KEY (site_id)      REFERENCES public.sites(id) ON DELETE CASCADE;
ALTER TABLE site_hours      ADD CONSTRAINT site_hours_site_id_fkey      FOREIGN KEY (site_id)      REFERENCES public.sites(id) ON DELETE CASCADE;
ALTER TABLE site_assets     ADD CONSTRAINT site_assets_site_id_fkey     FOREIGN KEY (site_id)      REFERENCES public.sites(id) ON DELETE CASCADE;

-- Clienti B2B: collegamento facoltativo all'organizzazione dell'anagrafica unica (società del gruppo, clienti service, partner)
ALTER TABLE customers ADD COLUMN organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL;
CREATE INDEX customers_org_idx ON customers (organization_id) WHERE organization_id IS NOT NULL;

-- Vista con le colonne che il codice dell'app si aspetta dalla vecchia tabella sites: tutte le sedi dell'anagrafica unica con
-- le impostazioni Retail se presenti. in_network: sedi del network commerciale (per tipologia, salvo scelta esplicita in site_ext).
-- Le FK restano su public.sites.
CREATE VIEW sites_v AS
  SELECT s.id, s.code, s.name, s.short_name, s.kind, s.address, s.city, s.province, s.zip, s.lat, s.lng,
         s.manager_name AS manager, s.legacy_brand, s.phone, s.email, s.opening_hours, s.active, s.sort_order,
         s.organization_id, s.notes AS suite_notes, coalesce(e.studiolab_code, s.studiolab_code) AS studiolab_code, e.studiolab_code AS ext_studiolab_code, s.studiolab_code AS suite_studiolab_code,
         coalesce(e.in_network, s.kind NOT IN ('HEADQUARTER', 'SERVICE', 'ALTRO')) AS in_network,
         (e.site_id IS NOT NULL) AS configured,
         e.tuotempo_area_id, e.gipo_site_code, coalesce(e.saturday_open, TRUE) AS saturday_open, e.catchment_cities,
         e.sqm_waiting, e.surface_sqm, e.rooms, e.boxes, e.parking, e.accessibility, e.services, e.description, e.opened_at,
         e.notes, e.updated_at AS ext_updated_at
    FROM public.sites s LEFT JOIN site_ext e ON e.site_id = s.id;

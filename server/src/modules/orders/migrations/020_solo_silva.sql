-- Ordini v0.91.2 (CEO, 20/11/2026): "elimina articoli creati da zero; devono vedersi solo quelli sincronizzati con Silva".
-- Una tantum: gli articoli NON provenienti dal catalogo Silva (source <> 'SILVA': caricati a mano o dal vecchio MOD252) si ELIMINANO
-- se nessun dato li usa; quelli usati da ordini, confezioni, giacenze, dotazioni consegnate o correlazioni esami NON si possono
-- eliminare senza perdere quello storico: si disattivano e si nascondono (le pagine non li mostrano più). Non tocca gli articoli Silva.
-- Protezione: non fa nulla se il catalogo Silva non è mai stato letto (nessun articolo Silva attivo). La traccia resta in audit_log.
-- Gli articoli creati a mano DOPO questa migrazione (source 'MANUALE') restano visibili: la creazione resta permessa.
-- prima della pulizia: dopo le eliminazioni la tabella ha controlli di integrità in sospeso e non si può più alterare nella stessa transazione
ALTER TABLE articles ALTER COLUMN source SET DEFAULT 'MANUALE';
DO $$
DECLARE n_del INT := 0; n_off INT := 0; elenco JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM articles WHERE source = 'SILVA' AND active) THEN
    INSERT INTO audit_log (action, entity, data) VALUES ('CATALOGO_SOLO_SILVA', 'article', jsonb_build_object('saltata', true, 'motivo', 'nessun articolo Silva attivo'));
    RETURN;
  END IF;
  CREATE TEMP TABLE _non_silva ON COMMIT DROP AS
    SELECT a.id, a.code, a.name,
           (EXISTS (SELECT 1 FROM order_lines x WHERE x.article_id = a.id) OR EXISTS (SELECT 1 FROM packages x WHERE x.article_id = a.id)
            OR EXISTS (SELECT 1 FROM stock_count_lines x WHERE x.article_id = a.id) OR EXISTS (SELECT 1 FROM stock_count_extras x WHERE x.article_id = a.id)
            OR EXISTS (SELECT 1 FROM startup_load_lines x WHERE x.article_id = a.id) OR EXISTS (SELECT 1 FROM exam_mappings x WHERE x.article_id = a.id)) AS usato
      FROM articles a WHERE a.source <> 'SILVA';
  SELECT coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'esito', CASE WHEN usato THEN 'disattivato' ELSE 'eliminato' END) ORDER BY code), '[]'::jsonb) INTO elenco FROM _non_silva;
  UPDATE articles a SET active = FALSE, visible_all = FALSE, visible_sedi = FALSE, visible_poli = FALSE, visible_lab = FALSE, visible_service = FALSE, updated_at = now()
    FROM _non_silva n WHERE n.id = a.id AND n.usato;
  GET DIAGNOSTICS n_off = ROW_COUNT;
  DELETE FROM warehouse_stock w USING _non_silva n WHERE w.article_id = n.id AND NOT n.usato;
  DELETE FROM articles a USING _non_silva n WHERE a.id = n.id AND NOT n.usato;   -- le righe dei modelli di dotazione vanno via a cascata
  GET DIAGNOSTICS n_del = ROW_COUNT;
  INSERT INTO audit_log (action, entity, data) VALUES ('CATALOGO_SOLO_SILVA', 'article', jsonb_build_object('eliminati', n_del, 'disattivati', n_off, 'articoli', elenco));
END $$;

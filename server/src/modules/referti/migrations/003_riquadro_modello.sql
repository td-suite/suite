-- 29/10/2026, seconda correzione sul modello del CEO (ref_user.pdf): i riferimenti di accettazione/referto del laboratorio esterno
-- RESTANO nel riquadro anagrafico del referto TD (Accettazione n°, Data Acc.; per Bianalisi Referto e Accettazione con codice e data).
-- La migrazione 002 li aveva descritti come "mai nel DOCX" per un'interpretazione errata: qui si correggono solo i commenti.
-- luogo_nascita e indirizzo restano colonne facoltative: compaiono nel riquadro solo se presenti nella sorgente.
COMMENT ON COLUMN schede.accettazione IS 'Codice di accettazione del laboratorio esterno: nel riquadro anagrafico del referto TD e nel registro';
COMMENT ON COLUMN schede.data_acc IS 'Data di accettazione del laboratorio esterno: nel riquadro anagrafico del referto TD e nel registro';
COMMENT ON COLUMN schede.referto_codice IS 'Codice del referto del laboratorio esterno (Bianalisi): nel riquadro anagrafico del referto TD e nel registro';
COMMENT ON COLUMN schede.luogo_nascita IS 'Luogo di nascita: facoltativo, nel riquadro solo se presente nella sorgente';
COMMENT ON COLUMN schede.indirizzo IS 'Indirizzo: facoltativo, nel riquadro solo se presente nella sorgente';

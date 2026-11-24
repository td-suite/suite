-- Lab Control v0.97.0 · replica dell'etichetta di StudioLab (richiesta del CEO del 24/11/2026, accettazione P26-008223).
-- 1) modelli.zpl_paziente: disegno del tagliando del paziente (ultima etichetta della striscia, come in StudioLab); NULL = non si stampa.
-- 2) impostazione `provette`: tabella delle provette (nome sull'etichetta, materiale, esami) nell'ordine di stampa di StudioLab.
--    Le 8 righe iniziali sono quelle LETTE sulla striscia di StudioLab dell'accettazione P26-008223: vanno completate dal laboratorio.
-- 3) modello "StudioLab 50x25 (replica)": ricostruito dalla foto della striscia; diventa predefinito solo se il predefinito in uso è
--    ancora il modello iniziale mai validato. Misure del rotolo e posizioni vanno confermate con una stampa di prova.
-- Idempotente, non distruttiva.
ALTER TABLE modelli ADD COLUMN IF NOT EXISTS zpl_paziente TEXT;

INSERT INTO impostazioni (key, value)
SELECT 'provette', to_jsonb($t$# Nome sull'etichetta = Materiale del gestionale | codici d'esame (facoltativi)
# Le righe sono nell'ordine di stampa. Una riga con i codici vale solo per i campioni che hanno uno di quegli esami.
T.Viola Alinity = Sangue Inter EDTA | 205
T.Viola = Sangue Inter EDTA
T.Oliva Urine = Urine
T.Grigio = Plasma
T.Giallo Elettroforesi = Siero | 260
T.Giallo Alinity = Siero
T.Bianco Cong. = Siero congelato
T.Azzurro = Plasma Citrato$t$::text)
WHERE NOT EXISTS (SELECT 1 FROM impostazioni WHERE key = 'provette');

INSERT INTO modelli (nome, larghezza_mm, altezza_mm, dpi, zpl, zpl_paziente, attivo, predefinito, note)
SELECT 'StudioLab 50x25 (replica)', 50, 25, 203, $zpl$^XA
^FX Replica dell'etichetta di StudioLab, ricostruita dalla foto della striscia P26-008223: confermare con stampa di prova
^CI28
^PW400
^LL200
^LH0,0
^FO12,6^A0N,22,20^FD{ACCETTAZIONE:14}  {DATA}^FS
^FO374,8^A0N,18,18^FD{SESSO:1}^FS
^FO12,30^A0N,26,20^FB286,1,0,L^FD{COGNOME:18} {NOME:14}^FS
^FO300,36^A0N,18,16^FB88,1,0,R^FD{NASCITA}^FS
^FO12,58^GB376,2,2^FS
^FO12,64^A0N,28,28^FD{ETICHETTA:24}^FS
^FO12,94^A0N,18,18^FD{ESAMIV:38}^FS
^FO40,114^BY2,3,50^BCN,50,Y,N,N,A^FD{BARCODE}^FS
^FO328,180^A0N,18,18^FB60,1,0,R^FD{CODCLIENTE:6}^FS
^XZ$zpl$, $zpl$^XA
^FX Tagliando del paziente (ultima etichetta della striscia di StudioLab)
^CI28
^PW400
^LL200
^LH0,0
^FO12,10^GB376,1,1^FS
^FO12,26^A0N,30,26^FD{COGNOME:22}^FS
^FO12,60^A0N,30,26^FD{NOME:18}^FS
^FO12,96^A0N,22,20^FD{NASCITA}^FS
^FO12,126^A0N,24,22^FDAcc. {ACCETTAZIONE:14}^FS
^FO12,158^A0N,24,22^FD{RITIRO}^FS
^XZ$zpl$, TRUE, FALSE, 'Ricostruito dalla foto della striscia di StudioLab (accettazione P26-008223, 24/11/2026). Mancano il numero nel riquadro e la data di ritiro: il gestionale non li fornisce. Misure del rotolo da confermare.'
WHERE NOT EXISTS (SELECT 1 FROM modelli WHERE nome = 'StudioLab 50x25 (replica)');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM modelli WHERE predefinito AND nome = 'TD 50x25 (da validare)' AND validato_il IS NULL)
     AND EXISTS (SELECT 1 FROM modelli WHERE nome = 'StudioLab 50x25 (replica)' AND attivo) THEN
    UPDATE modelli SET predefinito = FALSE WHERE predefinito;
    UPDATE modelli SET predefinito = TRUE, updated_at = now() WHERE nome = 'StudioLab 50x25 (replica)';
  END IF;
END $$;

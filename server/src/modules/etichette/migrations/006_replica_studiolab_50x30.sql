-- Lab Control v0.97.1 · replica dell'etichetta di StudioLab rifatta sulla foto del 25/11/2026 (striscia StudioLab accanto a quella di
-- Lab Control, stessa accettazione). Correzioni rispetto alla 005:
--  - in produzione il modello iniziale "TD 50x25" risultava validato dall'11/11/2026, quindi la 005 non aveva reso predefinita la
--    replica e la stampa usciva ancora con il vecchio disegno (materiale sotto il codice a barre). Il CEO ha chiesto il formato di
--    StudioLab: la replica diventa il modello predefinito in ogni caso;
--  - rotolo 50 × 30 mm (400 × 240 dot a 203 dpi), misurato sulla foto dalle proporzioni della stampa di Lab Control;
--  - caratteri a passo fisso della Zebra come StudioLab (D per le righe piccole e il nome, F per la provetta), numero del campione
--    sotto il codice a barre allineato a sinistra, codice del cliente in basso a destra, esami tagliati a 30 caratteri.
-- Il disegno si aggiorna solo se nessuno lo ha modificato dalla Suite (updated_by vuoto). Idempotente, non distruttiva.
UPDATE modelli SET nome = 'StudioLab 50x30 (replica)', larghezza_mm = 50, altezza_mm = 30, updated_at = now(),
  note = 'Ricostruito dalla foto della striscia di StudioLab del 25/11/2026 (accettazione P26-008223). Non stampati perché il gestionale non li fornisce: numero nel riquadro in alto a destra, numero e data di ritiro del tagliando. Da confermare con una stampa di prova accanto a una striscia di StudioLab.',
  zpl = $zpl$^XA
^FX Replica dell'etichetta di StudioLab (50 x 30 mm), ricostruita dalla foto del 25/11/2026
^CI28
^PW400
^LL240
^LH0,0
^FO12,8^ADN,18,10^FD{ACCETTAZIONE:12}^FS
^FO168,8^ADN,18,10^FD{DATA}^FS
^FO384,38^ABN,11,7^FD{SESSO:1}^FS
^FO10,30^ADN,36,10^FD{COGNOME:13} {NOME:9}^FS
^FO298,52^ABN,11,7^FD{NASCITA}^FS
^FO10,68^GB384,2,2^FS
^FO10,76^AFN,26,13^FD{ETICHETTA:24}^FS
^FO10,104^ADN,18,10^FD{ESAMIV:30}^FS
^FO66,126^BY2,3,78^BCN,78,N,N,N,A^FD{BARCODE}^FS
^FO62,210^ADN,18,10^FD{BARCODE}^FS
^FO318,214^ABN,11,7^FD{CODCLIENTE:6}^FS
^XZ$zpl$,
  zpl_paziente = $zpl$^XA
^FX Tagliando del paziente (ultima etichetta della striscia di StudioLab)
^CI28
^PW400
^LL240
^LH0,0
^FO14,22^GB30,2,2^FS
^FO58,22^GB30,2,2^FS
^FO102,22^GB30,2,2^FS
^FO146,22^GB30,2,2^FS
^FO190,22^GB30,2,2^FS
^FO234,22^GB30,2,2^FS
^FO278,22^GB30,2,2^FS
^FO322,22^GB30,2,2^FS
^FO366,22^GB20,2,2^FS
^FO0,48^AFN,26,13^FB400,1,0,C^FD{COGNOME:22}^FS
^FO0,82^AFN,26,13^FB400,1,0,C^FD{NOME:22}^FS
^FO0,116^AFN,26,13^FB400,1,0,C^FD{NASCITA}^FS
^FO8,196^ABN,11,7^FDAcc.^FS
^FO8,212^ABN,11,7^FD{ACCETTAZIONE:12}^FS
^FO246,212^ABN,11,7^FD{RITIRO}^FS
^XZ$zpl$
 WHERE nome IN ('StudioLab 50x25 (replica)', 'StudioLab 50x30 (replica)') AND updated_by IS NULL AND validato_il IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM modelli WHERE nome = 'StudioLab 50x30 (replica)' AND attivo AND NOT predefinito)
     AND NOT EXISTS (SELECT 1 FROM impostazioni WHERE key = 'replica_studiolab_predefinita') THEN
    UPDATE modelli SET predefinito = FALSE WHERE predefinito;
    UPDATE modelli SET predefinito = TRUE WHERE nome = 'StudioLab 50x30 (replica)';
  END IF;
  -- una volta sola: se poi l'amministratore sceglie un altro predefinito, i riavvii non lo cambiano
  INSERT INTO impostazioni (key, value) VALUES ('replica_studiolab_predefinita', 'true'::jsonb) ON CONFLICT (key) DO NOTHING;
END $$;

# Vedi come profilo

Dalla v0.90.0. Riservata al titolare della Suite (livello OWNER).

- Dove: nel menu laterale di ogni widget, voce "Vedi come profilo". Si sceglie il profilo e, per i widget a perimetro di sede, la sede.
- Cosa fa: la pagina si ricarica e il widget si presenta come a un utente ordinario con quel profilo: menu, pagine, dati nel perimetro.
  In testa resta la fascia "Stai guardando questo widget come …" con il pulsante "Torna al tuo profilo".
- Sola lettura: il server rifiuta ogni modifica fatta dalla vista (403 VEDI_COME). La vista si chiude uscendo dal widget o chiudendo la scheda.
- Traccia: ogni attivazione è nel registro (VEDI_COME_ATTIVATA, con widget, profilo e sede).
- Come funziona: il browser aggiunge l'intestazione `X-Vedi-Come: chiave:PROFILO[:idSede]` alle sole richieste `/api/<chiave>/...`
  (web/src/lib/vediCome.js); il server la accetta solo dal titolare e sostituisce, per quella richiesta, livello e grant
  (server/src/lib/vediCome.js). Il ruolo salvato nella riga utente del modulo non viene toccato.
- Limiti: i dati legati alla persona (proprie ferie, propri rimborsi, portale del professionista) restano quelli del titolare; i widget
  che non sono moduli (Cockpit, Amministrazione, Rubrica, Comunicazione) non hanno la voce; i file scaricati con un link diretto
  escono con il profilo reale; alcune letture hanno effetti propri (registro delle letture, auto-audit del mese).

# Guida alla Suite (modulo `suiteguida`) e link "Guida al widget"

Dalla v0.89.0.

- Widget **Guida alla Suite**, area Direzione, aperto a tutti i profili (esterni compresi). Contiene il Manuale d'Uso della Suite TD
  (TD-SGI-MAN009_00) diviso in capitoli e risponde alle domande sul funzionamento della Suite usando solo quel testo.
- In ogni widget, nel menu laterale sopra "Torna alla Home", il link **Guida al widget** apre `/suiteguida/widget/<chiave>`:
  capitoli del widget, campo per fare una domanda, pulsante per scaricare l'estratto PDF (TD-SGI-MAN009_NN).
- Contenuti: `server/src/modules/suiteguida/content/*.md`, una sezione per "a cosa serve", "accesso", "profili", "uso".
  Mappa widget → capitolo ed estratto in `widget.json`. PDF in `assets/` (`manuale.pdf`, `widget-<chiave>.pdf`).
- Aggiornamento: a ogni revisione del MAN009 si rigenerano contenuti e PDF dal sorgente della guida e si sostituiscono i file
  di `content/` e `assets/`. Il test `server/test/suiteguida.test.mjs` fallisce se un widget del catalogo non ha il suo capitolo.
- Le risposte usano il servizio AI già configurato per la Guida GIPO (stessa chiave, nessuna nuova variabile d'ambiente).

v0.89.1: la pagina Guida al widget ha il formato di Chiedi (campo unico per cercare o chiedere, riferito al widget, e PDF del widget da scaricare).
Corretto ModuleFrame: modulo e stato restano legati alla chiave caricata, altrimenti passando da un widget all'altro il widget di
partenza riportava alla propria pagina iniziale e il link non funzionava da nessun widget.

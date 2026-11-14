# Contratti del personale: profilo "Solo liberi professionisti" (LP)

Dalla v0.73.0 (CEO, 14/11/2026). Profilo del widget Contratti del personale, chiave `LP`, da assegnare in Amministrazione > Utenti.

- **Sola lettura dei soli LP** (persone di tipo LP, MEDICO, SANITARIO: `resources_v.kind = 'LP'`), compensi compresi.
- **Nessun dato dei dipendenti, per costruzione**: `lib/access.js` `lpGuard` è un elenco CHIUSO. Passano solo: elenco persone (forzato
  sugli LP qualunque filtro arrivi), scheda e allegati di una persona se è un LP, documenti generati di un LP, scadenze degli LP,
  estratto Excel degli LP, nomi delle aree e delle sedi. Tutto il resto risponde 403, comprese le route future: cruscotto e costi
  dell'organico, CCNL, simulatore busta paga, organigramma, CV Box, lettere di impegno, Casella People, benefit, impostazioni, registro,
  import e ogni scrittura.
- Nello Scadenzario della Suite le righe di Contratti del personale non compaiono a chi ha questo profilo.
- Menu: solo "Elenco LP" e "Calendario delle scadenze".

## Estratto Excel (`GET /api/contracts/stats/costs.xlsx`)

- Segue l'elenco da cui parte: `?kind=LP` solo LP, `?kind=DIPENDENTE` solo dipendenti, senza parametro tutto l'organico. Prima
  l'estratto dell'Elenco LP conteneva anche i dipendenti.
- Estratto LP: foglio "Liberi professionisti" (fisso mensile, tariffe orarie, numero di compensi a prestazione e variabili, costo
  stimato) e foglio "Compensi" con una riga per ogni compenso dell'incarico, di qualunque tipo. Prima compariva solo chi aveva un fisso.
- L'elenco LP mostra la colonna "Compensi" con tutte le forme di compenso. Il costo annuo stimato resta quello indicato nell'incarico
  (`est_monthly_cost`): per orari e variabili non c'è un costo certo senza le ore o i volumi.
- Test: `server/test/contracts-profilo-lp.test.mjs`.

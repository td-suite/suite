# Magazzino TD (v0.99.14, 28/11/2026)

Magazzino interno di Toscana Diagnostica, gestito dall'Area Operations. Contiene articoli interni che non sono e non saranno nel magazzino di Silva.

## Regole decise dal CEO
1. Un ordine con articoli Silva e articoli interni si divide da solo all'approvazione: la parte Silva prosegue verso Silva, la parte interna diventa l'ordine `<numero>-TD` (canale TD) e parte per email verso `acquisti@toscanadiagnostica.it`. Un ordine di soli articoli interni cambia canale senza dividersi.
2. La giacenza scala quando la merce esce verso il destinatario ("Registra uscita"), non all'approvazione né alla consegna.
3. Gestione: Area Operations (profili Procurement e Super amministratore).

## Dove
Ordini e Magazzino › Set up › Magazzino TD (`/orders/magazzino-td`), tre schede:
- Ordini da evadere: ordini TD approvati (uscita, anche parziale; nuovo invio dell'email) e ordini usciti in attesa di consegna.
- Giacenze e articoli: articoli interni (codice TD-0001, TD-0002, … assegnato da solo), giacenza, impegnate, disponibili, scorta minima, carico e rettifica.
- Movimenti: carichi, uscite e rettifiche.

## Flusso dell'ordine TD
APPROVATO (email al magazzino, confezioni impegnate) → uscita registrata: SPEDITO e giacenza scalata → CONSEGNATO con le quantità uscite → carico della struttura come ogni altro ordine. La consegna non si registra prima dell'uscita. L'uscita si registra una volta sola: ciò che non esce non viene più evaso da quell'ordine.

## Dati
- `articles.source = 'TD'`; `orders.channel` ('SILVA' | 'TD'), `orders.parent_order_id`, `orders.td_email_at`.
- `td_stock_movements` (CARICO, USCITA, RETTIFICA; confezioni con segno): la giacenza è la somma dei movimenti e non scende sotto zero.
- Impostazione `td_warehouse_email` (PUT `/api/orders/td/email`, solo Super amministratore).
- Contatore di menu `magazzino_td` = ordini TD da evadere; "3 · Trasmissione al magazzino" conta e mostra i soli ordini Silva.

## Limiti noti
- Nessuna gestione per lotto in uscita: lotto e scadenza si annotano al carico.
- Una confezione uscita e poi segnalata mancante dalla struttura non rientra da sola in giacenza: si corregge con una rettifica.
- Annullare un ordine TD è possibile solo prima dell'uscita.

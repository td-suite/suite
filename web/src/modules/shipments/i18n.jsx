import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { suiteApi } from './api.js';

// Dizionario bilingue: [italiano, inglese]
const D = {
  app: ['Shipments', 'Shipments'],
  'nav.dashboard': ['Cruscotto', 'Dashboard'],
  'nav.inbox': ['Richieste in arrivo', 'Incoming requests'],
  'nav.stock': ['Immagazzinamento dei kit', 'Kit stock intake'],
  'nav.ship': ['Invio dei kit', 'Kit dispatch'],
  'nav.shipKit': ['Invio dei kit', 'Kit dispatch'],
  'nav.shipKitExam': ['Invio dei kit + esame', 'Kit + exam dispatch'],
  'nav.returns': ['Ricezione dei campioni', 'Sample receipt'],
  'nav.lab': ['Spedizione a Endeavor DNA', 'Shipment to Endeavor DNA'],
  'nav.qty': ['Rendicontazione quantitativa', 'Quantitative reporting'],
  'nav.billing': ['Rendicontazione economica', 'Financial reporting'],
  'nav.orders': ['Tutte le richieste', 'All requests'],
  'nav.system': ['Sistema', 'System'],
  'nav.users': ['Utenti', 'Users'],
  'nav.settings': ['Impostazioni e tariffario', 'Settings and tariffs'],
  'nav.audit': ['Registro attività', 'Activity log'],
  'nav.emails': ['Registro email', 'Email log'],
  'nav.switch': ['Cambia progetto', 'Switch project'],
  'nav.profile': ['Profilo', 'Profile'],
  'nav.logout': ['Esci', 'Sign out'],
  'nav.process': ['Processo', 'Process'],
  'nav.reports': ['Rendicontazione', 'Reporting'],
  'proj.ENDEAVOR': ['Progetto Endeavor DNA', 'Endeavor DNA project'],
  'proj.LIFESTYLE': ['Progetto Lifestyle', 'Lifestyle project'],
  'proj.ENDEAVOR.desc': ['Kit genetici Endeavor DNA: magazzino, invio al paziente con SDA, rientro del campione, spedizione FedEx al laboratorio, rendiconto economico mensile.', 'Endeavor DNA genetic kits: stock, SDA dispatch to the patient, sample return, FedEx shipment to the laboratory, monthly financial statement.'],
  'proj.LIFESTYLE.desc': ['Kit e kit + esame acquistati sull\'e-commerce Toscana Diagnostica: invio al cliente, tracciamento, ricezione del campione.', 'Kits and kit + exam bought on the Toscana Diagnostica e-commerce: dispatch to the customer, tracking, sample receipt.'],
  'home.title': ['Scegli il progetto', 'Choose the project'],
  'home.sub': ['Ogni progetto ha il suo processo e il suo menu. Puoi cambiare in qualsiasi momento dal menu laterale.', 'Each project has its own process and menu. You can switch at any time from the side menu.'],
  'home.open': ['Apri', 'Open'],
  'home.stock': ['kit in magazzino', 'kits in stock'],
  'home.open_req': ['richieste aperte', 'open requests'],
  // stati
  'st.NEW': ['Da assegnare', 'To assign'],
  'st.ASSIGNED': ['Kit assegnato', 'Kit assigned'],
  'st.SHIPPED': ['Spedito al paziente', 'Shipped to patient'],
  'st.DELIVERED': ['Consegnato', 'Delivered'],
  'st.SAMPLE_RECEIVED': ['Campione ricevuto', 'Sample received'],
  'st.SHIPPED_TO_LAB': ['Spedito al laboratorio', 'Shipped to laboratory'],
  'st.CLOSED': ['Chiuso', 'Closed'],
  'st.CANCELLED': ['Annullato', 'Cancelled'],
  'kst.IN_STOCK': ['In magazzino', 'In stock'],
  'kst.ASSIGNED': ['Assegnato', 'Assigned'],
  'kst.SHIPPED': ['Spedito', 'Shipped'],
  'kst.DELIVERED': ['Consegnato', 'Delivered'],
  'kst.SAMPLE_RECEIVED': ['Campione ricevuto', 'Sample received'],
  'kst.SHIPPED_TO_LAB': ['Al laboratorio', 'To laboratory'],
  'kst.CLOSED': ['Chiuso', 'Closed'],
  'kst.DISCARDED': ['Scartato', 'Discarded'],
  'tr.PENDING': ['In attesa', 'Pending'],
  'tr.IN_TRANSIT': ['In viaggio', 'In transit'],
  'tr.OUT_FOR_DELIVERY': ['In consegna', 'Out for delivery'],
  'tr.DELIVERED': ['Consegnato', 'Delivered'],
  'tr.EXCEPTION': ['Anomalia', 'Exception'],
  'tr.UNKNOWN': ['Sconosciuto', 'Unknown'],
  'lab.PREPARING': ['In preparazione', 'Preparing'],
  'lab.SHIPPED': ['Spedita', 'Shipped'],
  'lab.DELIVERED': ['Consegnata', 'Delivered'],
  'bill.OPEN': ['Provvisorio', 'Provisional'],
  'bill.CLOSED': ['Chiuso', 'Closed'],
  'bill.INVOICED': ['Fatturato', 'Invoiced'],
  'type.ENDEAVOR': ['Endeavor DNA', 'Endeavor DNA'],
  'type.KIT_ONLY': ['Solo kit', 'Kit only'],
  'type.KIT_AND_EXAM': ['Kit + esame', 'Kit + exam'],
  'role.SUPERADMIN': ['Super amministratore', 'Super administrator'],
  'role.ADMIN': ['Amministratore', 'Administrator'],
  'role.VIEWER': ['Amministrazione (sola lettura)', 'Administration (read only)'],
  'role.ENDEAVOR': ['Endeavor DNA (rendiconti)', 'Endeavor DNA (reports)'],
  'role.help.ADMIN': ['Opera su tutto il processo: magazzino, richieste, spedizioni, campioni, rendiconti.', 'Operates the whole process: stock, requests, shipments, samples, reports.'],
  'role.help.VIEWER': ['Vede tutto in sola lettura.', 'Sees everything, read only.'],
  'role.help.ENDEAVOR': ['Vede solo la rendicontazione quantitativa ed economica del progetto Endeavor DNA.', 'Sees only the quantitative and financial reporting of the Endeavor DNA project.'],
  // comuni
  'c.save': ['Salva', 'Save'], 'c.cancel': ['Annulla', 'Cancel'], 'c.close': ['Chiudi', 'Close'], 'c.confirm': ['Conferma', 'Confirm'], 'c.edit': ['Modifica', 'Edit'], 'c.delete': ['Elimina', 'Delete'],
  'c.search': ['Cerca', 'Search'], 'c.all': ['Tutti', 'All'], 'c.none': ['Nessun elemento', 'No items'], 'c.loading': ['Caricamento…', 'Loading…'], 'c.date': ['Data', 'Date'], 'c.actions': ['Azioni', 'Actions'],
  'c.status': ['Stato', 'Status'], 'c.notes': ['Note', 'Notes'], 'c.yes': ['Sì', 'Yes'], 'c.no': ['No', 'No'], 'c.from': ['Dal', 'From'], 'c.to': ['Al', 'To'], 'c.month': ['Mese', 'Month'], 'c.total': ['Totale', 'Total'],
  'c.reason': ['Motivazione', 'Reason'], 'c.undo': ['Annulla ultimo passaggio', 'Undo last step'], 'c.print': ['Stampa', 'Print'], 'c.download': ['Scarica', 'Download'], 'c.refresh': ['Aggiorna', 'Refresh'],
  'c.saved': ['Salvato', 'Saved'], 'c.scan': ['Scansiona', 'Scan'], 'c.barcode': ['Codice a barre', 'Barcode'], 'c.kit': ['Kit', 'Kit'], 'c.patient': ['Paziente', 'Patient'], 'c.ref': ['Riferimento', 'Reference'],
  'c.mode': ['Modalità', 'Mode'], 'c.type': ['Tipo', 'Type'], 'c.city': ['Città', 'City'], 'c.created': ['Creata il', 'Created on'], 'c.project': ['Progetto', 'Project'], 'c.quantity': ['Quantità', 'Quantity'],
  'c.amount': ['Importo', 'Amount'], 'c.export': ['Esporta', 'Export'], 'c.new': ['Nuovo', 'New'], 'c.optional': ['facoltativo', 'optional'], 'c.required': ['obbligatorio', 'required'], 'c.open': ['Apri', 'Open'],
  'c.today': ['Oggi', 'Today'], 'c.days': ['giorni', 'days'], 'c.lang': ['Lingua', 'Language'], 'c.name': ['Nome', 'Name'], 'c.email': ['Email', 'Email'], 'c.phone': ['Telefono', 'Phone'], 'c.active': ['Attivo', 'Active'], 'c.inactive': ['Disattivo', 'Inactive'],
  // login
  'login.title': ['Accedi', 'Sign in'], 'login.sub': ['Personale interno con account Microsoft 365, utenti esterni con email e password.', 'Internal staff with Microsoft 365 account, external users with email and password.'],
  'login.ms': ['Accedi con Microsoft 365', 'Sign in with Microsoft 365'], 'login.or': ['oppure con email e password', 'or with email and password'], 'login.password': ['Password', 'Password'],
  'login.totp': ['Verifica in due passaggi', 'Two-step verification'], 'login.totpSub': ["Inserisci il codice a 6 cifre dell'app di autenticazione.", 'Enter the 6-digit code from your authenticator app.'], 'login.code': ['Codice', 'Code'],
  'login.back': ['Torna al login', 'Back to sign in'], 'login.verifying': ['Verifica…', 'Verifying…'],
  'login.claim': ['Ogni kit, ogni campione, <b>tracciato</b> dal magazzino al laboratorio.', 'Every kit, every sample, <b>tracked</b> from stock to laboratory.'],
  'login.foot': ['Shipments · Area e-commerce Toscana Diagnostica · accesso riservato', 'Shipments · Toscana Diagnostica e-commerce area · restricted access'],
  'onb.pwd': ['Imposta la tua password', 'Set your password'], 'onb.pwdSub': ['La password temporanea va sostituita. Minimo 12 caratteri, con maiuscole, minuscole e numeri.', 'The temporary password must be replaced. Minimum 12 characters, with upper and lower case letters and numbers.'],
  'onb.totp': ['Attiva la verifica in due passaggi', 'Enable two-step verification'], 'onb.totpSub': ['Obbligatoria per gli amministratori che accedono con password. Usa Microsoft Authenticator o un\'app equivalente.', 'Required for administrators signing in with a password. Use Microsoft Authenticator or an equivalent app.'],
  'onb.claim': ['Primo accesso: <b>mettiamo in sicurezza</b> il tuo account.', 'First access: <b>let\'s secure</b> your account.'],
  'prof.title': ['Profilo', 'Profile'], 'prof.access': ['Accesso', 'Access'], 'prof.method': ['Metodo di questa sessione', 'Method of this session'], 'prof.2fa': ['Verifica in due passaggi', 'Two-step verification'],
  'prof.on': ['attiva', 'enabled'], 'prof.off': ['non attiva', 'not enabled'], 'prof.msNote': ['Con l\'accesso Microsoft la sicurezza (password, MFA) è gestita dal tenant Office 365 aziendale.', 'With Microsoft sign-in, security (password, MFA) is managed by the company Office 365 tenant.'],
  'prof.changePwd': ['Cambia password', 'Change password'], 'prof.enable2fa': ['Attiva verifica in due passaggi', 'Enable two-step verification'], 'prof.current': ['Password attuale', 'Current password'], 'prof.newPwd': ['Nuova password', 'New password'],
  'prof.pwdHelp': ['Minimo 12 caratteri, almeno una maiuscola, una minuscola e un numero', 'Minimum 12 characters, at least one upper case, one lower case and one digit'], 'prof.repeat': ['Ripeti la nuova password', 'Repeat the new password'],
  'prof.mismatch': ['Le due password non coincidono', 'The two passwords do not match'], 'prof.savePwd': ['Salva password', 'Save password'], 'prof.qr': ['Genera codice QR', 'Generate QR code'], 'prof.manual': ['Chiave manuale', 'Manual key'],
  'prof.code6': ['Codice a 6 cifre generato dall\'app', '6-digit code from the app'], 'prof.activate': ['Attiva', 'Enable'], 'prof.pwdOk': ['Password aggiornata', 'Password updated'], 'prof.2faOk': ['Verifica in due passaggi attivata', 'Two-step verification enabled'],
  'prof.lang': ['Lingua dell\'interfaccia', 'Interface language'],
  // dashboard
  'dash.title': ['Cruscotto', 'Dashboard'], 'dash.stock': ['Kit in magazzino', 'Kits in stock'], 'dash.lowStock': ['sotto la soglia di', 'below the threshold of'], 'dash.inbox': ['Email da elaborare', 'Emails to process'],
  'dash.toAssign': ['Richieste da assegnare', 'Requests to assign'], 'dash.toShip': ['Kit da spedire', 'Kits to ship'], 'dash.inTransit': ['In viaggio verso il paziente', 'On the way to the patient'], 'dash.waitingSample': ['In attesa del campione', 'Waiting for the sample'],
  'dash.awaitingLab': ['Campioni da spedire a Endeavor', 'Samples to ship to Endeavor'], 'dash.month': ['Questo mese', 'This month'], 'dash.created': ['richieste', 'requests'], 'dash.shipped': ['kit spediti', 'kits shipped'], 'dash.samples': ['campioni ricevuti', 'samples received'],
  'dash.toLab': ['campioni al laboratorio', 'samples to laboratory'], 'dash.revenue': ['competenza del mese', 'month revenue'], 'dash.overdue': ['Campioni in ritardo', 'Overdue samples'], 'dash.overdueSub': ['Kit consegnato da più di {d} giorni senza campione rientrato', 'Kit delivered more than {d} days ago, sample not returned'],
  'dash.awb': ['In attesa di lettera di vettura', 'Waiting for airway bill'], 'dash.awbSub': ['Campioni in sede da più di {d} giorni', 'Samples on site for more than {d} days'], 'dash.trackIssues': ['Anomalie di tracciamento', 'Tracking exceptions'],
  'dash.recent': ['Ultime attività', 'Recent activity'], 'dash.trend': ['Andamento ultimi 6 mesi', 'Last 6 months'], 'dash.allGood': ['Nessuna segnalazione', 'Nothing to report'], 'dash.deliveredOn': ['consegnato il', 'delivered on'], 'dash.receivedOn': ['ricevuto il', 'received on'],
  // inbox
  'inbox.title': ['Richieste in arrivo', 'Incoming requests'], 'inbox.sub': ['Email di Endeavor DNA / Affinity lette dalla casella shipments@ oppure incollate a mano. Ogni richiesta va controllata e confermata prima di diventare operativa.', 'Endeavor DNA / Affinity emails read from the shipments@ mailbox or pasted by hand. Each request is checked and confirmed before it becomes operational.'],
  'inbox.paste': ['Incolla una email', 'Paste an email'], 'inbox.pasteHelp': ['Incolla il testo completo della email "Kits to send out". L\'app riconosce codice, modalità, nome, indirizzo e telefono.', 'Paste the full text of the "Kits to send out" email. The app recognises reference, mode, name, address and phone.'],
  'inbox.manual': ['Nuova richiesta manuale', 'New manual request'], 'inbox.pending': ['Da elaborare', 'To process'], 'inbox.done': ['Elaborate', 'Processed'], 'inbox.ignored': ['Ignorate', 'Ignored'], 'inbox.ignore': ['Ignora', 'Ignore'],
  'inbox.reparse': ['Rileggi', 'Re-read'], 'inbox.received': ['Ricevuta', 'Received'], 'inbox.from': ['Da', 'From'], 'inbox.subject': ['Oggetto', 'Subject'], 'inbox.kits': ['kit riconosciuti', 'kits recognised'], 'inbox.noKits': ['Nessun kit riconosciuto nel testo', 'No kit recognised in the text'],
  'inbox.review': ['Controlla e conferma', 'Check and confirm'], 'inbox.confirmN': ['Conferma {n} richieste', 'Confirm {n} requests'], 'inbox.confirm1': ['Conferma la richiesta', 'Confirm the request'], 'inbox.warn.mode': ['Modalità non riconosciuta: scegliila', 'Mode not recognised: choose it'],
  'inbox.warn.kit_unknown': ['Codice non presente in magazzino: carica il kit o correggi il codice', 'Code not in stock: load the kit or correct the code'], 'inbox.warn.kit_not_available': ['Kit già usato o non disponibile', 'Kit already used or not available'],
  'inbox.kitsInStock': ['kit in magazzino', 'kits in stock'], 'inbox.kitNotInStock': ['Kit non in magazzino', 'Kit not in stock'], 'inbox.kitsNotInStock': ['Kit non in magazzino', 'Kits not in stock'], 'inbox.kitsPartial': ['{a} di {b} kit in magazzino', '{a} of {b} kits in stock'],
  'inbox.warn.mode_no_tariff': ['Tratte lette: andata {o}, ritorno {r}. Nessuna modalità del tariffario le copre: scegli la più vicina o aggiungila in Impostazioni', 'Legs read: outbound {o}, return {r}. No tariff mode covers them: choose the closest or add it in Settings'],
  'set.notifyAffinityShip': ['Email ad Affinity / Endeavor alla spedizione del kit con i numeri di tracciamento (andata e ritorno)', 'Email to Affinity / Endeavor on kit dispatch with the tracking numbers (outbound and return)'],
  'inbox.reparseAll': ['Rileggi tutte', 'Re-read all'], 'inbox.inStock': ['in magazzino', 'in stock'], 'inbox.notInStock': ['non in magazzino', 'not in stock'],
  'inbox.warn.address': ['Indirizzo da verificare', 'Address to check'], 'inbox.warn.city': ['Città da verificare', 'City to check'], 'inbox.warn.name': ['Nome da verificare', 'Name to check'], 'inbox.modeText': ['Testo nella email', 'Text in the email'],
  'inbox.assignNow': ['Assegna subito il kit (facoltativo)', 'Assign the kit now (optional)'], 'inbox.body': ['Testo della email', 'Email text'], 'inbox.created': ['Richieste create', 'Requests created'], 'inbox.source.GRAPH': ['casella', 'mailbox'], 'inbox.source.PASTE': ['incollata', 'pasted'],
  'inbox.graphOff': ['Lettura automatica della casella non attiva: finché Microsoft 365 non è configurato, incolla qui le email.', 'Automatic mailbox reading is not active: until Microsoft 365 is configured, paste the emails here.'],
  'inbox.graphOn': ['Casella {m} letta ogni {n} minuti. Ultima lettura: {t}.', 'Mailbox {m} read every {n} minutes. Last read: {t}.'], 'inbox.readNow': ['Leggi ora', 'Read now'],
  // ordini
  'ord.title': ['Richiesta', 'Request'], 'ord.new': ['Nuova richiesta', 'New request'], 'ord.patient': ['Dati del paziente', 'Patient details'], 'ord.title_': ['Titolo', 'Title'], 'ord.first': ['Nome', 'First name'], 'ord.last': ['Cognome', 'Last name'],
  'ord.addr1': ['Indirizzo', 'Address'], 'ord.addr2': ['Indirizzo (riga 2)', 'Address (line 2)'], 'ord.zip': ['CAP', 'Postcode'], 'ord.prov': ['Provincia', 'Province'], 'ord.country': ['Paese', 'Country'], 'ord.langP': ['Lingua del paziente', 'Patient language'],
  'ord.extRef': ['Riferimento ordine', 'Order reference'], 'ord.extRefHelp': ['Es. AFF298672IT oppure numero ordine e-commerce', 'E.g. AFF298672IT or e-commerce order number'], 'ord.type': ['Tipo di acquisto', 'Purchase type'],
  'ord.mode': ['Modalità di spedizione', 'Shipping mode'], 'ord.kit': ['Kit assegnato', 'Assigned kit'], 'ord.assign': ['Assegna kit', 'Assign kit'], 'ord.assignHelp': ['Scansiona o digita il codice a barre del kit prelevato dal magazzino', 'Scan or type the barcode of the kit taken from stock'],
  'ord.unassign': ['Sgancia il kit', 'Release the kit'], 'ord.ship': ['Registra l\'invio', 'Record dispatch'], 'ord.shipTitle': ['Invio del kit', 'Kit dispatch'], 'ord.outTracking': ['Lettera di vettura SDA (andata)', 'SDA waybill (outbound)'],
  'ord.retTracking': ['Etichetta di ritorno prepagata (numero)', 'Prepaid return label (number)'], 'ord.retHelp': ['Numero stampato sull\'etichetta precompilata inserita in busta', 'Number printed on the pre-filled label placed in the envelope'],
  'ord.shipDate': ['Data di consegna al corriere', 'Date handed to the courier'], 'ord.handover': ['Questa modalità non prevede l\'andata con SDA: il kit viene consegnato a mano con l\'etichetta di ritorno.', 'This mode has no SDA outbound leg: the kit is handed over with the return label.'],
  'ord.handoverNote': ['Nota sulla consegna', 'Handover note'], 'ord.sheet': ['Foglio di spedizione', 'Shipping sheet'], 'ord.deliver': ['Segna consegnato', 'Mark delivered'], 'ord.deliverDate': ['Data di consegna', 'Delivery date'],
  'ord.sample': ['Registra ricezione campione', 'Record sample receipt'], 'ord.sampleDate': ['Data di ricezione', 'Receipt date'], 'ord.site': ['Centro di consegna', 'Delivery centre'], 'ord.cancel': ['Annulla richiesta', 'Cancel request'],
  'ord.legs': ['Tratte', 'Legs'], 'ord.out': ['Andata', 'Outbound'], 'ord.ret': ['Ritorno', 'Return'], 'ord.lab': ['Laboratorio', 'Laboratory'], 'ord.noLeg': ['non prevista', 'not included'], 'ord.tracking': ['Tracciamento', 'Tracking'],
  'ord.refreshTracking': ['Aggiorna tracciamento', 'Refresh tracking'], 'ord.noProvider': ['Tracciamento automatico non configurato: registra la consegna a mano.', 'Automatic tracking not configured: record the delivery manually.'], 'ord.editTracking': ['Modifica numero', 'Edit number'],
  'ord.timeline': ['Cronologia', 'History'], 'ord.emails': ['Email inviate', 'Emails sent'], 'ord.fees': ['Competenze', 'Fees'], 'ord.feeShip': ['Spedizione', 'Shipping'], 'ord.feeSample': ['Campione al laboratorio', 'Sample to laboratory'],
  'ord.source.EMAIL': ['da email', 'from email'], 'ord.source.MANUAL': ['manuale', 'manual'], 'ord.labLink': ['Spedizione al laboratorio', 'Laboratory shipment'], 'ord.deliveredOn': ['Consegnato il', 'Delivered on'], 'ord.shippedOn': ['Spedito il', 'Shipped on'],
  'ord.sampleOn': ['Campione ricevuto il', 'Sample received on'], 'ord.closedOn': ['Chiuso il', 'Closed on'], 'ord.cancelledOn': ['Annullato il', 'Cancelled on'], 'ord.anonymized': ['Dati del paziente rimossi per scadenza del periodo di conservazione', 'Patient data removed after the retention period'],
  'ord.next': ['Prossimo passo', 'Next step'], 'ord.next.NEW': ['Preleva un kit dal magazzino e assegnalo scansionando il codice a barre.', 'Take a kit from stock and assign it by scanning the barcode.'],
  'ord.next.ASSIGNED': ['Stampa l\'etichetta SDA sul portale, prepara la busta (kit, foglio, etichetta di ritorno) e registra l\'invio.', 'Print the SDA label on the portal, prepare the envelope (kit, sheet, return label) and record the dispatch.'],
  'ord.next.SHIPPED': ['In viaggio verso il paziente. Alla consegna lo stato si aggiorna dal tracciamento, oppure segnalo a mano.', 'On the way to the patient. On delivery the status updates from tracking, or mark it manually.'],
  'ord.next.DELIVERED': ['In attesa che il paziente rispedisca il campione. Alla ricezione scansiona il kit.', 'Waiting for the patient to return the sample. On receipt scan the kit.'],
  'ord.next.SAMPLE_RECEIVED': ['Campione in sede: inseriscilo in una spedizione verso Endeavor DNA quando arriva la lettera di vettura.', 'Sample on site: add it to a shipment to Endeavor DNA when the airway bill arrives.'],
  'ord.next.SHIPPED_TO_LAB': ['In viaggio verso il laboratorio con FedEx.', 'On the way to the laboratory with FedEx.'], 'ord.next.CLOSED': ['Processo concluso.', 'Process completed.'], 'ord.next.CANCELLED': ['Richiesta annullata.', 'Request cancelled.'],
  // stock
  'stock.title': ['Immagazzinamento dei kit', 'Kit stock intake'], 'stock.sub': ['Carico dei kit ricevuti dal fornitore, un lotto per consegna, un codice a barre per kit.', 'Intake of kits received from the supplier, one lot per delivery, one barcode per kit.'],
  'stock.new': ['Nuovo carico', 'New intake'], 'stock.inStock': ['In magazzino', 'In stock'], 'stock.lots': ['Lotti ricevuti', 'Lots received'], 'stock.kits': ['Kit', 'Kits'], 'stock.supplier': ['Fornitore', 'Supplier'], 'stock.receivedAt': ['Data di ricezione', 'Receipt date'],
  'stock.reference': ['Riferimento (DDT, ordine)', 'Reference (delivery note, order)'], 'stock.kitType': ['Tipo di kit', 'Kit type'], 'stock.codes': ['Codici a barre', 'Barcodes'], 'stock.codesHelp': ['Scansiona i kit uno dopo l\'altro (il lettore invia un invio dopo ogni codice) oppure incolla l\'elenco, un codice per riga.', 'Scan the kits one after the other (the reader sends Enter after each code) or paste the list, one code per line.'],
  'stock.count': ['{n} codici', '{n} codes'], 'stock.load': ['Carica {n} kit', 'Load {n} kits'], 'stock.discard': ['Scarta', 'Discard'], 'stock.discardTitle': ['Scarta il kit', 'Discard the kit'], 'stock.discardHelp': ['Danneggiato, scaduto, smarrito. Il kit esce dal magazzino.', 'Damaged, expired, lost. The kit leaves stock.'],
  'stock.restore': ['Ripristina', 'Restore'], 'stock.byStatus': ['Kit per stato', 'Kits by status'], 'stock.lookup': ['Cerca un kit', 'Find a kit'], 'stock.filter': ['Filtra per stato', 'Filter by status'], 'stock.addToLot': ['Aggiungi kit al lotto', 'Add kits to lot'], 'stock.loaded': ['Caricati {n} kit', '{n} kits loaded'],
  // invio
  'ship.title': ['Invio dei kit', 'Kit dispatch'], 'ship.sub': ['Richieste con kit assegnato pronte per la spedizione, e kit in viaggio.', 'Requests with an assigned kit ready for dispatch, and kits in transit.'], 'ship.ready': ['Da spedire', 'To ship'], 'ship.toAssign': ['Senza kit', 'Without kit'],
  'ship.inTransit': ['In viaggio', 'In transit'], 'ship.delivered': ['Consegnati, in attesa del campione', 'Delivered, waiting for sample'], 'ship.tracking': ['Tracciamento', 'Tracking'], 'ship.shippedAt': ['Spedito il', 'Shipped on'],
  // returns
  'ret.title': ['Ricezione dei campioni', 'Sample receipt'], 'ret.sub': ['Scansiona il codice del kit rientrato: la richiesta passa a "campione ricevuto" e, per Endeavor, entra in coda per la spedizione al laboratorio.', 'Scan the barcode of the returned kit: the request moves to "sample received" and, for Endeavor, queues for the laboratory shipment.'],
  'ret.scan': ['Scansiona il kit rientrato', 'Scan the returned kit'], 'ret.register': ['Registra ricezione', 'Record receipt'], 'ret.waiting': ['In attesa di rientro', 'Awaiting return'], 'ret.received': ['Ricevuti', 'Received'], 'ret.site': ['Centro in cui è stato consegnato', 'Centre where it was delivered'],
  'ret.ok': ['Campione {b} registrato: {p}', 'Sample {b} recorded: {p}'], 'ret.todayList': ['Ricevuti di recente', 'Recently received'],
  // lab
  'labp.title': ['Spedizione dei campioni a Endeavor DNA', 'Sample shipment to Endeavor DNA'], 'labp.sub': ['I campioni partono con FedEx solo con la lettera di vettura inviata da Endeavor. Una spedizione può contenere più kit.', 'Samples leave with FedEx only with the airway bill sent by Endeavor. One shipment can contain several kits.'],
  'labp.queue': ['Campioni in attesa', 'Samples waiting'], 'labp.new': ['Nuova spedizione', 'New shipment'], 'labp.list': ['Spedizioni', 'Shipments'], 'labp.awb': ['Lettera di vettura FedEx (AWB)', 'FedEx airway bill (AWB)'], 'labp.awbDate': ['Ricevuta il', 'Received on'],
  'labp.awbFile': ['File della lettera di vettura', 'Airway bill file'], 'labp.upload': ['Carica PDF', 'Upload PDF'], 'labp.ship': ['Registra la partenza', 'Record departure'], 'labp.shipDate': ['Data di ritiro FedEx', 'FedEx pickup date'], 'labp.deliver': ['Segna consegnata al laboratorio', 'Mark delivered to laboratory'],
  'labp.kits': ['Kit nella spedizione', 'Kits in the shipment'], 'labp.add': ['Aggiungi', 'Add'], 'labp.remove': ['Togli', 'Remove'], 'labp.select': ['Seleziona i campioni', 'Select the samples'], 'labp.create': ['Crea spedizione con {n} kit', 'Create shipment with {n} kits'],
  'labp.notify': ['Email ad Affinity / Endeavor', 'Email to Affinity / Endeavor'], 'labp.resend': ['Reinvia email', 'Resend email'], 'labp.packing': ['Packing list', 'Packing list'], 'labp.consignee': ['Destinatario', 'Consignee'], 'labp.noAwb': ['Lettera di vettura non ancora ricevuta', 'Airway bill not yet received'],
  'labp.createdNote': ['Alla creazione parte in automatico l\'email in inglese a Affinity / Endeavor con i kit in partenza; alla registrazione della partenza, la seconda con la lettera di vettura.', 'On creation the English email to Affinity / Endeavor with the departing kits is sent automatically; on departure, the second one with the airway bill.'],
  'labp.scanAdd': ['Scansiona un kit per aggiungerlo', 'Scan a kit to add it'],
  // report quantitativo
  'qty.title': ['Rendicontazione quantitativa', 'Quantitative reporting'], 'qty.sub': ['Volumi per fase e per mese, tempi medi del processo, situazione aperta.', 'Volumes per phase and per month, average process times, open position.'],
  'qty.perMonth': ['Volumi per mese', 'Volumes per month'], 'qty.stockIn': ['Kit caricati', 'Kits loaded'], 'qty.requests': ['Richieste', 'Requests'], 'qty.shipped': ['Spediti', 'Shipped'], 'qty.delivered': ['Consegnati', 'Delivered'], 'qty.samples': ['Campioni ricevuti', 'Samples received'],
  'qty.toLab': ['Al laboratorio', 'To laboratory'], 'qty.closed': ['Chiusi', 'Closed'], 'qty.cancelled': ['Annullati', 'Cancelled'], 'qty.byMode': ['Spedizioni per modalità', 'Shipments by mode'], 'qty.times': ['Tempi medi (giorni)', 'Average times (days)'],
  'qty.t.req_to_assign': ['Richiesta → kit assegnato', 'Request → kit assigned'], 'qty.t.req_to_ship': ['Richiesta → spedizione', 'Request → dispatch'], 'qty.t.ship_to_deliver': ['Spedizione → consegna', 'Dispatch → delivery'], 'qty.t.deliver_to_sample': ['Consegna → campione rientrato', 'Delivery → sample returned'],
  'qty.t.sample_to_lab': ['Campione → partenza FedEx', 'Sample → FedEx departure'], 'qty.t.total': ['Richiesta → chiusura', 'Request → closure'], 'qty.open': ['Richieste aperte per stato', 'Open requests by status'], 'qty.stock': ['Kit per stato', 'Kits by status'], 'qty.bySite': ['Campioni consegnati per centro', 'Samples delivered per centre'],
  'qty.csv': ['Esporta richieste (CSV)', 'Export requests (CSV)'],
  // billing
  'bil.title': ['Rendicontazione economica', 'Financial reporting'], 'bil.sub': ['Competenze mensili verso Endeavor DNA: spedizioni per modalità e campioni inviati al laboratorio. Il mese si chiude a fine periodo, poi si emette la fattura sul gestionale.', 'Monthly fees to Endeavor DNA: shipments by mode and samples sent to the laboratory. The month is closed at period end, then the invoice is issued in the accounting system.'],
  'bil.shipments': ['Spedizioni', 'Shipments'], 'bil.samples': ['Campioni', 'Samples'], 'bil.closeMonth': ['Chiudi il mese', 'Close the month'], 'bil.reopen': ['Riapri', 'Reopen'], 'bil.invoice': ['Registra fattura', 'Record invoice'], 'bil.invoiceRef': ['Numero fattura', 'Invoice number'],
  'bil.invoiceDate': ['Data fattura', 'Invoice date'], 'bil.summary': ['Riepilogo', 'Summary'], 'bil.unit': ['Prezzo unitario', 'Unit price'], 'bil.sampleLine': ['Campioni spediti a Endeavor DNA (FedEx)', 'Samples shipped to Endeavor DNA (FedEx)'], 'bil.detailShip': ['Dettaglio spedizioni', 'Shipments detail'],
  'bil.detailSmp': ['Dettaglio campioni', 'Samples detail'], 'bil.xlsx': ['Excel', 'Excel'], 'bil.pdf': ['Rendiconto PDF', 'Statement PDF'], 'bil.closeConfirm': ['Chiudere il mese {m}? Le righe vengono congelate e non cambiano più con modifiche successive.', 'Close month {m}? The lines are frozen and no longer change with later edits.'],
  'bil.closedBy': ['Chiuso da', 'Closed by'], 'bil.provisional': ['Mese in corso o non ancora chiuso: i totali sono provvisori.', 'Current or not yet closed month: totals are provisional.'], 'bil.months': ['Mesi', 'Months'],
  // users
  'usr.title': ['Utenti', 'Users'], 'usr.sub': ['Credenziali, ruolo e lingua di ciascun utente', 'Credentials, role and language of each user'], 'usr.new': ['Nuovo utente', 'New user'], 'usr.role': ['Ruolo', 'Role'], 'usr.auth': ['Metodo di accesso', 'Sign-in method'],
  'usr.auth.LOCAL': ['Email e password', 'Email and password'], 'usr.auth.ENTRA': ['Solo Microsoft 365', 'Microsoft 365 only'], 'usr.auth.BOTH': ['Microsoft 365 o password', 'Microsoft 365 or password'], 'usr.last': ['Ultimo accesso', 'Last sign-in'], 'usr.never': ['mai', 'never'],
  'usr.locked': ['bloccato', 'locked'], 'usr.resetPwd': ['Reset pwd', 'Reset pwd'], 'usr.reset2fa': ['Reset 2FA', 'Reset 2FA'], 'usr.tempPwd': ['password temporanea', 'temporary password'], 'usr.2faOn': ['2FA attiva', '2FA on'], 'usr.2faOff': ['2FA no', '2FA off'],
  'usr.emailHelp': ['Per l\'accesso Microsoft deve coincidere con l\'account Office 365', 'For Microsoft sign-in it must match the Office 365 account'], 'usr.tempTitle': ['Password temporanea', 'Temporary password'],
  'usr.tempText': ['Comunica queste credenziali a {e} per un canale sicuro. La password non sarà più visibile.', 'Give these credentials to {e} through a secure channel. The password will not be shown again.'], 'usr.copied': ['Ho copiato la password', 'I copied the password'],
  'usr.createNote': ['Alla creazione viene generata una password temporanea da consegnare all\'utente, che dovrà cambiarla al primo accesso.', 'A temporary password is generated on creation; the user must change it at first sign-in.'], 'usr.confirmReset': ['Generare una nuova password temporanea per {e}?', 'Generate a new temporary password for {e}?'],
  'usr.confirm2fa': ['Disattivare la verifica in due passaggi di {e}?', 'Disable two-step verification for {e}?'],
  // settings
  'set.title': ['Impostazioni e tariffario', 'Settings and tariffs'], 'set.tariffs': ['Tariffario Endeavor DNA', 'Endeavor DNA tariffs'], 'set.tariffsSub': ['Prezzo per spedizione in base alla modalità. Gli alias servono a riconoscere la modalità nel testo delle email.', 'Price per shipment by mode. Aliases are used to recognise the mode in the email text.'],
  'set.sampleFee': ['Tariffa per campione spedito in America (€)', 'Fee per sample shipped to the USA (€)'], 'set.customer': ['Intestatario del rendiconto', 'Statement addressee'], 'set.customerAddr': ['Indirizzo intestatario', 'Addressee address'],
  'set.notify': ['Destinatari email Affinity / Endeavor', 'Affinity / Endeavor email recipients'], 'set.senderFilter': ['Domini mittente riconosciuti (casella)', 'Recognised sender domains (mailbox)'], 'set.consignee': ['Destinatario FedEx (laboratorio)', 'FedEx consignee (laboratory)'],
  'set.returnAddr': ['Indirizzo di ritorno dei campioni', 'Sample return address'], 'set.sites': ['Centri Toscana Diagnostica (consegna campioni Lifestyle)', 'Toscana Diagnostica centres (Lifestyle sample drop-off)'], 'set.alertReturn': ['Allarme campione non rientrato dopo (giorni)', 'Alert when sample not returned after (days)'],
  'set.alertAwb': ['Allarme lettera di vettura mancante dopo (giorni)', 'Alert when airway bill missing after (days)'], 'set.alertStock': ['Soglia minima di magazzino (kit)', 'Minimum stock threshold (kits)'], 'set.notifyPatient': ['Email al paziente alla spedizione (se ha un indirizzo email)', 'Email to the patient on dispatch (if an email is available)'],
  'set.adminsEmail': ['Altri destinatari del controllo giornaliero', 'Other recipients of the daily check'], 'set.retention': ['Conservazione dati paziente dopo la chiusura (mesi)', 'Patient data retention after closure (months)'], 'set.inbox': ['Lettura automatica della casella', 'Automatic mailbox reading'],
  'set.mail': ['Comunicazioni email', 'Email communications'], 'set.mailOn': ['attivo · Microsoft 365', 'active · Microsoft 365'], 'set.mailSmtp': ['attivo · SMTP', 'active · SMTP'], 'set.mailOff': ['non configurato: le email vengono solo registrate', 'not configured: emails are only logged'],
  'set.testEmail': ['Invia una email di prova', 'Send a test email'], 'set.trackingSda': ['Tracciamento SDA', 'SDA tracking'], 'set.trackingFedex': ['Tracciamento FedEx', 'FedEx tracking'], 'set.trackingOff': ['manuale', 'manual'], 'set.jobs': ['Esecuzioni', 'Jobs'], 'set.runInbox': ['Leggi casella ora', 'Read mailbox now'],
  'set.runTracking': ['Aggiorna tracciamenti', 'Refresh tracking'], 'set.runAlerts': ['Esegui controllo giornaliero', 'Run daily check'], 'set.general': ['Parametri', 'Parameters'], 'set.aliases': ['Alias email', 'Email aliases'], 'set.price': ['Prezzo €', 'Price €'], 'set.legs': ['Tratte', 'Legs'],
  'set.env': ['Le credenziali Microsoft 365, FedEx e del servizio di tracciamento si impostano nelle variabili d\'ambiente del server (vedi README).', 'Microsoft 365, FedEx and tracking service credentials are set in the server environment variables (see README).'],
  'set.kitTypes': ['Tipi di kit', 'Kit types'], 'set.lastRun': ['ultima esecuzione', 'last run'], 'set.dailyAlerts': ['Controllo giornaliero via email agli amministratori', 'Daily email check to the administrators'],
  // audit
  'aud.title': ['Registro attività', 'Activity log'], 'aud.who': ['Utente', 'User'], 'aud.action': ['Azione', 'Action'], 'aud.entity': ['Oggetto', 'Object'], 'aud.data': ['Dati', 'Data'],
  'em.title': ['Registro email', 'Email log'], 'em.to': ['Destinatari', 'Recipients'], 'em.kind': ['Tipo', 'Kind'],
};

const LangCtx = createContext({ lang: 'it', t: (k) => k, setLang: () => {} });

export function LangProvider({ children, initial }) {
  // Lingua per utente: arriva dal profilo Suite (suiteUser.lang); il cambio viene salvato sul profilo Suite
  const [lang, setLangState] = useState(() => (initial === 'en' ? 'en' : 'it'));
  const setLang = useCallback(async (l, persist) => {
    setLangState(l);
    if (persist) { try { await suiteApi.put('/auth/me', { lang: l }); } catch { /* */ } }
  }, []);
  const t = useCallback((key, params) => {
    const e = D[key];
    let s = e ? e[lang === 'en' ? 1 : 0] : key;
    if (params) for (const [k, v] of Object.entries(params)) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    return s;
  }, [lang]);
  const value = useMemo(() => ({ lang, t, setLang }), [lang, t, setLang]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}
export const useT = () => useContext(LangCtx);

export function LangToggle({ persist = true, dark }) {
  const { lang, setLang } = useT();
  return (
    <div className={`langtoggle ${dark ? 'dark' : ''}`} role="group" aria-label="Language">
      {['it', 'en'].map((l) => <button key={l} type="button" className={lang === l ? 'on' : ''} onClick={() => setLang(l, persist)}>{l.toUpperCase()}</button>)}
    </div>
  );
}

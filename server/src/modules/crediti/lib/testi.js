// Recupero Crediti · testi delle comunicazioni. Modelli predefiniti dal memo "Modello di sollecito clienti B2B" (sezioni 2, 3, 4 e 6),
// parola per parola; ogni modello si modifica in Impostazioni. Segnaposto fra parentesi quadre: [referente], [numero], [data],
// [data scadenza], [importo], [descrizione], [iban], [codice cliente], [tabella fatture], [totale], [entro], [data 1° sollecito],
// [data 2° sollecito], [data chiamata], [ragione sociale], [firma], [telefono], [email], [firma raf], [ruolo raf], [interessi].
import { layout } from '../../../lib/mailer.js';
import { compila } from './regole.js';

export const MODELLI = {
  modello_1_oggetto: 'Promemoria scadenza fattura n. [numero] del [data] – Toscana Diagnostica',
  modello_1_testo: `Gentile [referente],

le ricordiamo che il [data scadenza] scade la fattura n. [numero] del [data], di importo pari a € [importo][descrizione].

[tabella fatture]

Può effettuare il pagamento tramite bonifico bancario:
IBAN: [iban]
Causale: Fattura n. [numero] – [codice cliente]

Se il pagamento è già stato disposto, non tenga conto di questo messaggio. Per qualsiasi chiarimento sulla fattura restiamo a disposizione.

Cordiali saluti,
[firma]
[telefono] · [email]`,
  modello_2_oggetto: 'Sollecito di pagamento – fattura n. [numero] scaduta il [data scadenza]',
  modello_2_testo: `Gentile [referente],

dalle nostre verifiche non risulta ancora pervenuto il pagamento delle seguenti fatture:

[tabella fatture]

Le chiediamo di provvedere al saldo entro il [entro] tramite bonifico all'IBAN [iban], indicando in causale i numeri di fattura. In alternativa, la invitiamo a comunicarci la data prevista di pagamento o eventuali contestazioni sulle fatture indicate.

Se il pagamento è già stato effettuato, le chiediamo di inviarci la contabile per consentirci l'abbinamento.

Cordiali saluti,
[firma]
[telefono] · [email]`,
  modello_3_oggetto: 'Secondo sollecito di pagamento – posizione scaduta [codice cliente]',
  modello_3_testo: `Gentile [referente],

facciamo seguito al nostro sollecito del [data 1° sollecito], rimasto senza riscontro. Ad oggi risultano scadute e non pagate le seguenti fatture:

[tabella fatture]

Le chiediamo di saldare l'importo entro e non oltre il [entro]. Le ricordiamo che, ai sensi del D.Lgs. 231/2002 e del contratto in essere, sugli importi scaduti decorrono gli interessi di mora e l'importo forfettario per i costi di recupero, che ci riserviamo di addebitare.

In mancanza di pagamento o di un riscontro entro tale termine, sarà contattato dal suo referente commerciale e, successivamente, la posizione potrà essere trasmessa al nostro ufficio legale per le opportune azioni di tutela del credito.

Se il pagamento è già stato effettuato, la preghiamo di inviarci la contabile.

Distinti saluti,
[firma raf]
[ruolo raf] – Toscana Diagnostica`,
  modello_5_oggetto: 'Messa in mora e diffida ad adempiere – [ragione sociale]',
  modello_5_testo: `Spett.le [ragione sociale],

per conto di Toscana Diagnostica S.r.l. vi comunichiamo che risultano tuttora non pagate le seguenti fatture, per un importo complessivo di € [totale], nonostante i solleciti del [data 1° sollecito], del [data 2° sollecito] e il contatto telefonico del [data chiamata]:

[tabella fatture]

Con la presente vi costituiamo formalmente in mora e vi diffidiamo a corrispondere entro 15 giorni dal ricevimento:
- la sorte capitale di € [totale];
- gli interessi di mora ai sensi del D.Lgs. 231/2002, dalla scadenza al saldo;
- l'importo forfettario per i costi di recupero previsto dalla stessa norma.

In mancanza, procederemo senza ulteriore avviso al recupero giudiziale del credito, con aggravio di spese a vostro carico.

Distinti saluti,
Area legale per Toscana Diagnostica`,
  modello_ricevuta_testo: `Gentile [referente],

abbiamo ricevuto il suo messaggio e lo abbiamo preso in carico: le risponderemo al più presto.

Cordiali saluti,
[firma]`,
};

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const eur = (n) => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
export const itData = (d) => { const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10); const [y, m, g] = s.split('-'); return y && m && g ? `${g}/${m}/${y}` : ''; };

/** Tabella delle fatture: HTML per l'email, testo allineato per la versione semplice. conRitardo aggiunge i giorni di ritardo (2° sollecito). */
export function tabellaFatture(righe, { conRitardo = false } = {}) {
  const tot = righe.reduce((s, r) => s + Number(r.residuo), 0);
  const th = (t, a = 'left') => `<th style="text-align:${a};padding:6px 10px;background:#1C505E;color:#fff;font-size:12px">${t}</th>`;
  const td = (t, a = 'left', b = false) => `<td style="text-align:${a};padding:6px 10px;border-bottom:1px solid #D9E3E5;font-size:13px${b ? ';font-weight:700' : ''}">${t}</td>`;
  const html = `<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:8px 0"><tr>${th('Fattura n.')}${th('Data')}${th('Scadenza')}${conRitardo ? th('Giorni di ritardo', 'right') : ''}${th('Importo (€)', 'right')}</tr>`
    + righe.map((r) => `<tr>${td(esc(r.numero))}${td(itData(r.data))}${td(itData(r.scadenza))}${conRitardo ? td(String(Math.max(0, r.giorni)), 'right') : ''}${td(eur(r.residuo), 'right')}</tr>`).join('')
    + `<tr>${td('Totale', 'left', true)}${td('')}${td('')}${conRitardo ? td('') : ''}${td(eur(tot), 'right', true)}</tr></table>`;
  const testo = righe.map((r) => `- fattura n. ${r.numero} del ${itData(r.data)}, scadenza ${itData(r.scadenza)}${conRitardo ? `, ${Math.max(0, r.giorni)} giorni di ritardo` : ''}: € ${eur(r.residuo)}`).join('\n') + `\nTotale: € ${eur(tot)}`;
  return { html, testo, totale: Math.round(tot * 100) / 100 };
}

/**
 * Compone una comunicazione. fase: 1, 2, 3, 5 o 'ricevuta'. v = valori dei segnaposto (testo); righe = fatture.
 * Ritorna { oggetto, html, testo, mancanti } dove mancanti = segnaposto rimasti senza valore (la comunicazione non parte da sola).
 */
export function componi(fase, imp, v, righe, rif) {
  const chiaveO = `modello_${fase}_oggetto`, chiaveT = fase === 'ricevuta' ? 'modello_ricevuta_testo' : `modello_${fase}_testo`;
  const tab = tabellaFatture(righe, { conRitardo: fase === 3 });
  const unica = righe.length === 1;
  const valori = { ...v, totale: eur(tab.totale), numero: unica ? righe[0].numero : righe.map((r) => r.numero).join(', '), data: unica ? itData(righe[0].data) : righe.map((r) => itData(r.data)).join(', '),
    'data scadenza': righe.length ? itData([...righe].map((r) => String(r.scadenza).slice(0, 10)).sort()[0]) : '', importo: eur(tab.totale) };
  let modello = String(imp[chiaveT] || MODELLI[chiaveT] || '').replace('[descrizione]', v.descrizione ? `, relativa a ${v.descrizione}` : '');
  // avviso per una sola fattura: la tabella non serve (il testo la descrive già), come nel modello del memo
  if (fase === 1 && unica) modello = modello.replace(/\n\[tabella fatture\]\n/, '');
  const segno = '\u0000TABELLA\u0000';
  const testoBase = compila(modello.replace('[tabella fatture]', segno), valori);
  const mancanti = [...new Set([...testoBase.matchAll(/\[([^\]\n]{1,40})\]/g)].map((m) => m[1]))];
  const corpoHtml = testoBase.split(/\n{2,}/).map((par) => (par.includes(segno) ? tab.html : `<p style="margin:0 0 12px">${esc(par).replace(/\n/g, '<br>')}</p>`)).join('');
  const oggettoBase = fase === 'ricevuta' ? `Re: ${v.oggetto_originale || 'la sua comunicazione'}` : compila(String(imp[chiaveO] || MODELLI[chiaveO] || ''), valori);
  const oggetto = `${oggettoBase}${rif ? ` [TD-CRED-${rif}]` : ''}`.slice(0, 250);
  const html = layout(fase === 3 ? 'Secondo sollecito di pagamento' : fase === 2 ? 'Sollecito di pagamento' : fase === 5 ? 'Messa in mora' : fase === 1 ? 'Promemoria di scadenza' : 'Messaggio ricevuto', corpoHtml,
    { footer: `Amministrazione · Toscana Diagnostica. Può rispondere a questa email${rif ? `: il riferimento TD-CRED-${rif} nell'oggetto ci permette di abbinare la sua risposta` : ''}.` });
  return { oggetto, html, testo: testoBase.replace(segno, tab.testo), mancanti, totale: tab.totale };
}

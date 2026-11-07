// Business Hub · Impostazioni del processo Service (06/11/2026): validità dell'offerta e del collegamento alla form, destinatari delle
// comunicazioni della contrattualizzazione, giorni lavorativi per i volumi giornalieri, richiamo dei prospect (interruttore, ogni N
// giorni, limite giornaliero, recapiti), modelli dei testi con i segnaposto, allegati del contratto richiesti nella form, mapping salvato
// delle colonne del listino StudioLAB. I campi semplici si salvano con "Salva impostazioni"; modelli e allegati con i loro pulsanti.
import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApi, Card, Field, Badge, useToast } from './ui.jsx';
import { itDateTime, LINEE } from '../format.js';

export function ProcessoService({ f, setF }) {
  const toast = useToast();
  const mapping = useApi('/hub/listino/mapping');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const esegui = async () => { try { const r = await api.post('/hub/richiamo/esegui', {}); toast(`Richiamo: ${r.inviati} inviati, ${r.falliti} non riusciti, ${r.in_coda} in coda`); } catch (e) { toast(e.message, 'err'); } };
  const azzera = async () => { try { await api.del('/hub/listino/mapping'); toast('Mapping azzerato: il prossimo listino si riconosce dalle intestazioni'); mapping.reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Card title="Business Hub · processo Service (proposta, form online, contratto, richiamo)" className="mt" id="processo">
      <div className="small muted" style={{ marginBottom: 10 }}>Da prospect a cliente: listino StudioLAB e offerta economica, kit di proposta da service@ con il collegamento alla form online, contratto firmato in ascolto, comunicazioni automatiche e attivazione dei servizi della Suite, richiamo periodico di chi non è cliente. Si salva con "Salva impostazioni".</div>
      <div className="form-grid">
        <Field label="Validità predefinita dell'offerta economica (giorni)"><input value={f.hub_offerta_validita_giorni ?? ''} onChange={set('hub_offerta_validita_giorni')} /></Field>
        <Field label="Validità del collegamento alla form online (giorni)" help="Rinnovabile dalla scheda account"><input value={f.hub_b2b_token_giorni ?? ''} onChange={set('hub_b2b_token_giorni')} /></Field>
        <Field label="Giorni lavorativi all'anno" help="Volumi giornalieri = volume annuo atteso / giorni, se il campo dell'account è vuoto"><input value={f.hub_giorni_lavorativi ?? ''} onChange={set('hub_giorni_lavorativi')} /></Field>
        <Field label="Avvenuta contrattualizzazione: destinatari" className="span2"><input value={f.hub_dest_contrattualizzazione ?? ''} onChange={set('hub_dest_contrattualizzazione')} /></Field>
        <Field label="Nuovo cliente: destinatari del laboratorio" className="span2"><input value={f.hub_dest_laboratorio ?? ''} onChange={set('hub_dest_laboratorio')} /></Field>
        <Field label="Accessi al portale" className="span2" help="Al kit di proposta e alla contrattualizzazione: un accesso con invito per ogni referente con email (chi ce l'ha resta com'è), oppure solo per il referente principale come prima"><select value={f.hub_accessi_portale || 'TUTTI'} onChange={set('hub_accessi_portale')}><option value="TUTTI">Tutti i referenti</option><option value="PRINCIPALE">Solo il principale</option></select></Field>
      </div>
      <h4 style={{ margin: '18px 0 6px' }}>Richiamo periodico dei prospect</h4>
      <div className="small muted" style={{ marginBottom: 8 }}>Il CEO ha scritto "ogni 60 mesi": è stato inteso come <b>ogni 60 giorni (modificabile)</b>. Ai prospect Service (fasi 0-5, non clienti, non "non contattare", con un'email) che non hanno ricevuto un richiamo né un'altra email negli ultimi N giorni parte da service@, con le copie fisse, l'email di presentazione con il pacchetto di presentazione in allegato. Il job controlla ogni ora e invia una volta al giorno dopo le 9.</div>
      <div className="form-grid">
        <label className="f inline"><input type="checkbox" checked={String(f.hub_richiamo_attivo) === 'true'} onChange={(e) => setF({ ...f, hub_richiamo_attivo: e.target.checked ? 'true' : 'false' })} />Richiamo acceso {String(f.hub_richiamo_attivo) === 'true' ? <Badge tone="green">acceso</Badge> : <Badge tone="grey">spento</Badge>}</label>
        <Field label="Ogni quanti giorni"><input value={f.hub_richiamo_giorni ?? ''} onChange={set('hub_richiamo_giorni')} /></Field>
        <Field label="Massimo di invii al giorno"><input value={f.hub_richiamo_limite ?? ''} onChange={set('hub_richiamo_limite')} /></Field>
        <Field label="Recapiti nell'email (indirizzi: nome, ruolo e telefono dall'anagrafica)" className="span2" help="Il primo è anche l'indirizzo a cui scrivere oltre a service@"><input value={f.hub_richiamo_recapiti ?? ''} onChange={set('hub_richiamo_recapiti')} /></Field>
      </div>
      <div className="row" style={{ marginTop: 10 }}><button className="btn sm ghost" onClick={esegui}>Esegui ora il richiamo di oggi</button><span className="small muted">Solo con l'interruttore acceso (salvato); il limite giornaliero vale anche qui. L'anteprima è nel Cruscotto.</span></div>
      <h4 style={{ margin: '18px 0 6px' }}>Listino StudioLAB: colonne</h4>
      <div className="small">{mapping.data ? <>Mapping salvato il {itDateTime(mapping.data.salvato_at)}: {Object.entries(mapping.data.mapping || {}).map(([k, i]) => `${k} = "${mapping.data.intestazioni?.[i] || `colonna ${i + 1}`}"`).join(', ')} <button className="btn sm ghost" onClick={azzera}>Azzera</button></> : <span className="muted">Nessun mapping salvato: le colonne si riconoscono dalle intestazioni (sinonimi). Se un file non si riconosce, il mapping scelto a video si salva qui.</span>}</div>
    </Card>
  );
}

// Processo Punti Prelievo (06/11/2026): destinatari interni dell'avvio del punto prelievi ed elenco della dotazione. Si salva con
// "Salva impostazioni". Mittente sempre network@ con le copie fisse della linea; i testi sono nei modelli qui sotto (schede "PP ·").
export function ProcessoPuntiPrelievo({ f, setF }) {
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Card title="Business Hub · processo Punti Prelievo (contratto al partner, avvio del punto prelievi)" className="mt" id="processo-pp">
      <div className="small muted" style={{ marginBottom: 10 }}>Corner: contratto al partner da network@ con la form del partner; al contratto firmato (form, risposta a network@ o caricamento) partono credenziali e benvenuto al partner, conferma interna e i passi dell'avvio. Flagship: "Avvia il punto prelievi" con la data. Destinatari predefiniti come indicato dal CEO, modificabili (indirizzi separati da virgola). Si salva con "Salva impostazioni".</div>
      <div className="form-grid">
        <Field label="b) Contratto firmato: conferma interna" className="span2"><input value={f.hub_pp_dest_conferma ?? ''} onChange={set('hub_pp_dest_conferma')} /></Field>
        <Field label="c) Avvio del nuovo punto prelievi (laboratorio)" className="span2"><input value={f.hub_pp_dest_avvio ?? ''} onChange={set('hub_pp_dest_avvio')} /></Field>
        <Field label="e) Dotazione (PC, stampante, boccione)" className="span2"><input value={f.hub_pp_dest_dotazione ?? ''} onChange={set('hub_pp_dest_dotazione')} /></Field>
        <Field label="f) Fondo cassa e POS (amministrazione)" className="span2"><input value={f.hub_pp_dest_amministrazione ?? ''} onChange={set('hub_pp_dest_amministrazione')} /></Field>
        <Field label="g) Rifiuti speciali" className="span2"><input value={f.hub_pp_dest_rifiuti ?? ''} onChange={set('hub_pp_dest_rifiuti')} /></Field>
        <Field label="Elenco della dotazione (una voce per riga)" className="span2" help="Va nell'email e nell'oggetto della dotazione: niente prezzi né fornitori se non li scrivete qui"><textarea style={{ minHeight: 80 }} value={f.hub_pp_dotazione_elenco ?? ''} onChange={set('hub_pp_dotazione_elenco')} /></Field>
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>Fondo cassa nell'email all'amministrazione: quello della sede in Cash Management; se la sede non è ancora configurata, il "Fondo cassa predefinito" delle Impostazioni di Cash (indicato come predefinito). Primo ordine: quantità 1 di ogni articolo del Magazzino Centrale con la visibilità Punti Prelievo, in bozza per l'Area Operations.</div>
    </Card>
  );
}

export function FlussoModelli() {
  const toast = useToast();
  const q = useApi('/hub/flusso/modelli');
  const [m, setM] = useState(null);
  const [k, setK] = useState('kit');
  useEffect(() => { if (q.data) setM({ ...q.data.modelli }); }, [q.data]);
  if (!q.data || !m) return null;
  const d = q.data;
  const salva = async (rip = false) => { try { const r = await api.put('/hub/flusso/modelli', rip ? { ripristina: true } : { modelli: m }); toast(r.avvisi?.length ? r.avvisi.join(' · ') : rip ? 'Testi predefiniti ripristinati' : 'Modelli salvati', r.avvisi?.length ? 'err' : 'ok'); q.reload(); } catch (e) { toast(e.message, 'err'); } };
  const oggetto = `${k}_oggetto`; const testo = k === 'lettera_presentazione' ? k : `${k}_testo`;
  return (
    <Card title="Processi Service e Punti Prelievo · modelli dei testi" className="mt" actions={<button className="btn sm ghost" onClick={() => salva(true)}>Ripristina i testi predefiniti</button>}>
      <div className="small muted" style={{ marginBottom: 10 }}>Email del kit di proposta, comunicazioni della contrattualizzazione, richiamo dei prospect e lettera di presentazione del pacchetto; per i Punti Prelievo (schede "PP ·") contratto al partner, benvenuto con le credenziali e comunicazioni dell'avvio. Segnaposto tra doppie graffe; una riga i cui segnaposto restano vuoti non compare (nessun dato inventato). Mittente sempre la casella della linea, con le copie fisse.</div>
      <div className="tabs" style={{ marginBottom: 8 }}>{Object.entries(d.etichette).map(([x, l]) => <button key={x} className={k === x ? 'on' : ''} onClick={() => setK(x)}>{l}{d.personalizzati.some((p) => p.startsWith(x)) ? ' •' : ''}</button>)}</div>
      <div className="small" style={{ marginBottom: 6 }}>Segnaposto: {(d.segnaposto[k] || []).map((x) => `{{${x}}}`).join(' ')}{k === 'lettera_presentazione' ? ' · {{referenti}} su una riga da sola = blocco dei contatti; la firma la aggiunge il pacchetto' : ''}</div>
      {k !== 'lettera_presentazione' && <Field label="Oggetto"><input value={m[oggetto] || ''} onChange={(e) => setM({ ...m, [oggetto]: e.target.value })} /></Field>}
      <Field label="Testo" className="mt"><textarea style={{ minHeight: 300 }} value={m[testo] || ''} onChange={(e) => setM({ ...m, [testo]: e.target.value })} /></Field>
      {(k === 'kit' || k === 'pp_contratto') && <div className="small muted" style={{ marginTop: 6 }}>All'oggetto si aggiunge sempre il riferimento [TD-B2B-…], che abbina la risposta all'account.</div>}
      <div className="row end" style={{ marginTop: 10 }}><button className="btn" onClick={() => salva()}>Salva i modelli</button></div>
    </Card>
  );
}

export function B2bAllegati() {
  const toast = useToast();
  const q = useApi('/hub/b2b/allegati');
  const [x, setX] = useState(null);
  const [l, setL] = useState('SRV');
  useEffect(() => { if (q.data) setX(Object.fromEntries(Object.entries(q.data).map(([k, v]) => [k, v.filter((a) => !a.contratto)]))); }, [q.data]);
  if (!q.data || !x) return null;
  const salva = async () => { try { await api.put('/hub/b2b/allegati', x); toast('Allegati del contratto salvati'); q.reload(); } catch (e) { toast(e.message, 'err'); } };
  const lista = x[l] || [];
  const upd = (i, patch) => setX({ ...x, [l]: lista.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  return (
    <Card title="Form online · allegati del contratto richiesti" className="mt">
      <div className="small muted" style={{ marginBottom: 10 }}>Il contratto firmato (PDF) c'è sempre ed è obbligatorio (il cliente può indicare che lo invia per email). Qui gli altri allegati, per linea: titolo e obbligatorio sì/no.</div>
      <div className="tabs" style={{ marginBottom: 8 }}>{Object.keys(x).map((k) => <button key={k} className={l === k ? 'on' : ''} onClick={() => setL(k)}>{LINEE[k].label}</button>)}</div>
      <div className="small" style={{ marginBottom: 6 }}>1. {q.data[l][0].titolo} <Badge tone="teal">sempre, obbligatorio</Badge></div>
      {lista.map((a, i) => <div key={i} className="row" style={{ gap: 8, marginBottom: 6 }}>
        <input value={a.titolo} onChange={(e) => upd(i, { titolo: e.target.value })} style={{ flex: 1 }} />
        <label className="f inline"><input type="checkbox" checked={a.obbligatorio} onChange={(e) => upd(i, { obbligatorio: e.target.checked })} />obbligatorio</label>
        <button className="iconbtn" onClick={() => setX({ ...x, [l]: lista.filter((_, j) => j !== i) })}>×</button>
      </div>)}
      <div className="row" style={{ marginTop: 6 }}><button className="btn sm ghost" onClick={() => setX({ ...x, [l]: [...lista, { titolo: '', obbligatorio: false }] })}>+ Allegato</button><span className="spacer" /><button className="btn" onClick={salva}>Salva gli allegati</button></div>
    </Card>
  );
}

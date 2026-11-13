// Scheda mensile della nota spese: dati generali, sezione A Spese (MOD025), sezione B Chilometri (MOD029), riepilogo con il saldo,
// controlli prima dell'invio, azioni secondo il ruolo (dipendente, responsabile, P&C), storico, PDF, ZIP dei giustificativi, modulistica.
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, Empty, Loading, PageHead, Modal, Field, ErrorBox, ConfirmModal, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { api, apiBase, base, useApi } from '../api.js';
import { useAuth } from '../auth.jsx';
import { StatoBadge, ModuliCartacei, SpesaModal, ViaggioModal, Riepilogo, Storico, Allegati } from '../components.jsx';
import { nomeMese, eur, km, tariffa, itData, itDataOra, oggiIso, num } from '../format.js';

export default function Nota() {
  const { id } = useParams();
  const toast = useToast();
  const { user } = useAuth();
  const d = useApi(`/note/${id}`, [id]);
  const [sc, setSc] = useState(null);
  const [modal, setModal] = useState(null);
  useEffect(() => { if (d.data) setSc(d.data); }, [d.data]);
  if (d.error) return <div className="page"><Empty icon="alert" title="Nota non disponibile">{d.error.message}</Empty></div>;
  if (!sc) return <div className="page"><Loading /></div>;
  const n = sc.nota;
  const az = n.azioni;
  const mia = n.mia;
  const modifica = az.modifica;
  const aggiorna = (r) => { if (r?.nota) setSc(r); else d.reload(); window.dispatchEvent(new Event('suite:badges')); };
  const esegui = async (fn, msg) => { try { const r = await fn(); aggiorna(r); if (msg) toast(msg); return r; } catch (e) { toast(e.message, 'err'); throw e; } };
  const eliminaAllegato = (a) => setModal({ tipo: 'conferma', titolo: 'Eliminare il giustificativo?', testo: a.filename, ok: async () => { await api.del(`/allegati/${a.id}`); d.reload(); } });
  const pedaggiParcheggi = (s) => ['PEDAGGIO', 'PARCHEGGIO'].includes(s.categoria_tipo);
  const speseA = sc.spese.filter((s) => !pedaggiParcheggi(s));
  const speseB = sc.spese.filter(pedaggiParcheggi);
  const titolo = `Nota spese · ${nomeMese(n.anno, n.mese)}`;
  const inv = sc.invio_approvazione || {};
  const elencoDest = (inv.destinatari || []).map((x) => (x.nome ? `${x.nome} <${x.email}>` : x.email)).join(', ');
  const auto = Boolean(sc.responsabile_previsto?.automatica);
  const approvata = ['APPROVATA', 'IN_LIQUIDAZIONE', 'LIQUIDATA', 'ARCHIVIATA'].includes(n.stato);

  const RigaSpesa = ({ s, i }) => (
    <div className={`rs-riga ${s.esclusa ? 'esclusa' : ''} ${s.avvisi.length && modifica ? 'avviso' : ''}`}>
      <div className="rs-c-n">{i + 1}</div>
      <div className="rs-c-data">{itData(s.data)}</div>
      <div className="rs-c-desc">
        <div className="strong">{s.descrizione}</div>
        <div className="small muted">{[s.categoria, s.motivazione, s.cliente && `cliente ${s.cliente}`, s.progetto && `progetto ${s.progetto}`].filter(Boolean).join(' · ')}</div>
        {s.metodo !== 'DIPENDENTE' && <div className="small rs-carta">{s.metodo_label}{s.fuel_card ? ` ${s.fuel_card.circuito} ${s.fuel_card.numero}` : ''}: non rimborsabile</div>}
        {s.esclusa && <div className="small rs-neg">Esclusa da {s.esclusa_da_nome || 'responsabile'}: {s.esclusa_motivo}</div>}
        {s.doppione_di.length > 0 && <div className="small rs-warn">Possibile doppione: stessa data, importo e categoria{s.doppione_di.some((x) => x.nota_id !== n.id) ? ` (anche nella nota ${s.doppione_di.filter((x) => x.nota_id !== n.id).map((x) => x.mese).join(', ')})` : ''}</div>}
        {modifica && s.avvisi.filter((a) => !/doppione/.test(a)).map((a) => <div key={a} className="small rs-warn"><Icon name="alert" /> {a}</div>)}
        <Allegati allegati={s.allegati} modificabile={modifica} onElimina={eliminaAllegato} />
      </div>
      <div className="rs-c-imp">{s.esclusa ? <s>{eur(s.importo)}</s> : eur(s.importo)}</div>
      <div className="rs-c-az">
        {modifica && <><button className="btn sm ghost" onClick={() => setModal({ tipo: 'spesa', spesa: s })}><Icon name="edit" />Modifica</button>
          <button className="iconbtn" aria-label="Elimina la spesa" onClick={() => setModal({ tipo: 'conferma', titolo: 'Eliminare la spesa?', testo: `${s.descrizione} · ${eur(s.importo)} e i suoi giustificativi`, ok: () => esegui(() => api.del(`/note/${n.id}/spese/${s.id}`), 'Spesa eliminata') })}><Icon name="trash" /></button></>}
        {az.escludi && (s.esclusa ? <button className="btn sm ghost" onClick={() => esegui(() => api.post(`/note/${n.id}/includi`, { tipo: 'SPESA', riga_id: s.id }), 'Riga di nuovo inclusa')}>Includi</button>
          : <button className="btn sm danger" onClick={() => setModal({ tipo: 'escludi', riga: { tipo: 'SPESA', riga_id: s.id, testo: `${s.descrizione} · ${eur(s.importo)}` } })}>Escludi</button>)}
      </div>
    </div>
  );

  return (
    <div className="page rs-page">
      <PageHead title={titolo} icon="doc" crumb={<Link to={mia ? base : `${base}/archivio`}>{mia ? 'Le mie note spese' : 'Archivio'}</Link>}
        sub={<span className="row" style={{ gap: 8 }}><StatoBadge stato={n.stato} />{!mia && <strong>{sc.persona.nome}</strong>}<span>{[sc.persona.role_name || sc.persona.job_title, sc.persona.site_name].filter(Boolean).join(' · ')}</span></span>}
        actions={<>
          <a className="btn ghost" href={`${apiBase}/note/${n.id}/pdf?inline=1`} target="_blank" rel="noreferrer"><Icon name="pdf" />PDF{['ARCHIVIATA'].includes(n.stato) ? ' definitivo' : ''}</a>
          <a className="btn ghost" href={`${apiBase}/note/${n.id}/giustificativi.zip`}><Icon name="zip" />ZIP giustificativi</a>
          {az.invia && <button className="btn" onClick={() => setModal({ tipo: 'invia' })}><Icon name="send" />{auto ? 'Conferma e approva' : 'Invia al responsabile'}</button>}
        </>} />

      {n.stato === 'BOZZA' && mia && sc.responsabile_previsto && <div className="alert info rs-gap"><Icon name="info" /><span>{auto ? `Sei il vertice dell'organigramma: alla conferma la nota è approvata automaticamente e passa a P&C per la liquidazione.${inv.attivo ? ` Il PDF di approvazione viene inviato a: ${elencoDest}.` : ''}` : sc.responsabile_previsto.al_pc ? 'Non hai un superiore raggiungibile in organigramma: la nota andrà a P&C come secondo controllo.' : `La nota andrà a ${sc.responsabile_previsto.nome} (${sc.responsabile_previsto.origine}).`}</span></div>}
      {n.stato === 'INVIATA' && <div className="alert warn rs-gap"><Icon name="clock" /><span>Inviata il {itDataOra(n.inviata_at)}{n.in_ritardo ? ' (in ritardo)' : ''}: in attesa di {n.al_pc ? 'P&C (secondo controllo: vertice dell\'organigramma)' : n.responsabile_nome}. {n.responsabile_origine && !n.al_pc ? `Responsabile: ${n.responsabile_origine}.` : ''}</span></div>}
      {az.approva && inv.attivo && <div className="alert warn rs-gap"><Icon name="mail" /><span>All'approvazione il PDF viene inviato a: {elencoDest} (destinatari esterni all'azienda, mittente {inv.mittente}).</span></div>}
      {approvata && inv.esito === 'ERRORE' && <div className="alert err rs-gap"><Icon name="alert" /><span>Email al consulente non inviata: {inv.errore}</span>{(user?.isPC || user?.isTitolare) && <button className="btn sm" onClick={() => esegui(() => api.post(`/note/${n.id}/reinvia-approvazione`), 'Reinvio eseguito: vedi l\'esito nella scheda')}><Icon name="refresh" />Reinvia</button>}</div>}
      {approvata && inv.esito === 'INVIATA' && <div className="alert ok rs-gap"><Icon name="mail" /><span>PDF di approvazione inviato a {elencoDest} il {itDataOra(inv.at)}.</span></div>}
      {approvata && inv.esito === 'SALTATA' && (user?.isPC || user?.isTitolare) && <div className="alert info rs-gap"><Icon name="info" /><span>PDF di approvazione non inviato: {inv.errore}</span><button className="btn sm ghost" onClick={() => esegui(() => api.post(`/note/${n.id}/reinvia-approvazione`), 'Invio eseguito')}>Invia ora</button></div>}
      {modifica && sc.controlli.bloccanti.length > 0 && <div className="alert err rs-gap"><Icon name="alert" /><div><strong>Prima di inviare:</strong><ul className="rs-ul">{sc.controlli.bloccanti.map((b) => <li key={b}>{b}</li>)}</ul></div></div>}
      {modifica && sc.controlli.avvisi.length > 0 && <div className="alert warn rs-gap"><Icon name="info" /><ul className="rs-ul">{sc.controlli.avvisi.map((b) => <li key={b}>{b}</li>)}</ul></div>}
      {!modifica && !mia && (az.approva || az.escludi) && sc.spese.some((s) => s.doppione_di.length) && <div className="alert warn rs-gap"><Icon name="alert" /><span>Ci sono possibili doppioni: controlla le righe segnate prima di approvare.</span></div>}

      {(az.approva || az.liquida || az.prendi_in_carico || az.rimanda || az.archivia || az.ricalcola_responsabile) && (
        <Card className="rs-decisione rs-gap" title={az.approva ? (n.al_pc ? 'Approvazione di P&C (secondo controllo)' : 'Approvazione del responsabile') : 'Liquidazione P&C'} icon="check">
          <div className="row">
            {az.approva && <button className="btn" onClick={() => setModal({ tipo: 'approva' })}><Icon name="check" />Approva</button>}
            {az.respingi && <button className="btn danger" onClick={() => setModal({ tipo: 'respingi' })}><Icon name="x" />Respingi</button>}
            {az.escludi && <span className="small muted">Puoi escludere una riga con il motivo (pulsante Escludi sulla riga) e poi approvare il resto.</span>}
            {az.prendi_in_carico && <button className="btn ghost" onClick={() => esegui(() => api.post(`/note/${n.id}/prendi-in-carico`), 'Nota in liquidazione')}>Prendi in carico</button>}
            {az.liquida && <button className="btn" onClick={() => setModal({ tipo: 'liquida' })}><Icon name="check" />Registra la liquidazione</button>}
            {az.rimanda && <button className="btn ghost" onClick={() => setModal({ tipo: 'rimanda' })}><Icon name="refresh" />Rimanda</button>}
            {az.archivia && <button className="btn" onClick={() => esegui(() => api.post(`/note/${n.id}/archivia`), 'Nota archiviata con il PDF definitivo')}><Icon name="folder" />Archivia con PDF definitivo</button>}
            {az.ricalcola_responsabile && <button className="btn ghost sm" onClick={() => esegui(() => api.post(`/note/${n.id}/ricalcola-responsabile`), 'Responsabile ricalcolato')}>Ricalcola il responsabile</button>}
          </div>
        </Card>)}

      <Card className="rs-gap" title="Dati della nota" icon="user" actions={modifica && <button className="btn sm ghost" onClick={() => setModal({ tipo: 'dati' })}><Icon name="edit" />Modifica</button>}>
        <dl className="rs-dl">
          <dt>Richiedente</dt><dd>{sc.persona.nome}</dd>
          <dt>Funzione / area</dt><dd>{[sc.persona.role_name || sc.persona.job_title, sc.persona.unit_name].filter(Boolean).join(' · ') || '-'}</dd>
          <dt>Sede di lavoro</dt><dd>{sc.persona.site_name || '-'}</dd>
          <dt>Periodo</dt><dd>{nomeMese(n.anno, n.mese)}</dd>
          <dt>Motivazione</dt><dd>{n.motivazione || <span className="muted">indicata sulle singole righe</span>}</dd>
          <dt>Anticipi ricevuti</dt><dd>{eur(n.anticipi)}</dd>
          {n.note && <><dt>Note</dt><dd className="rs-pre">{n.note}</dd></>}
        </dl>
      </Card>

      <Card className="rs-gap" title="A · Spese (MOD025)" icon="file" flush
        actions={modifica && <button className="btn sm" onClick={() => setModal({ tipo: 'spesa' })}><Icon name="plus" />Nuova spesa</button>}>
        {!speseA.length ? <Empty compact icon="file">Nessuna spesa</Empty> : <div className="rs-righe">{speseA.map((s, i) => <RigaSpesa key={s.id} s={s} i={i} />)}</div>}
        <div className="rs-nota-fissa">{sc.eccezione ? 'Per te il giustificativo è facoltativo (eccezione stabilita dalla direzione). ' : ''}{sc.testo_giustificativo}</div>
      </Card>

      <Card className="rs-gap" title="B · Chilometri (MOD029)" icon="pin" flush
        actions={modifica && <button className="btn sm" onClick={() => setModal({ tipo: 'viaggio' })}><Icon name="plus" />Nuovo viaggio</button>}>
        {sc.vettura_aziendale && <div className="alert info rs-in"><Icon name="info" /><span>Hai una vettura aziendale ({sc.vettura_aziendale.marca} {sc.vettura_aziendale.modello} {sc.vettura_aziendale.targa}): i chilometri non sono rimborsabili. I viaggi qui sotto sono il registro facoltativo dei viaggi di servizio.</span></div>}
        {!sc.vettura_aziendale && mia && modifica && !sc.veicoli.length && <div className="alert warn rs-in"><Icon name="info" /><span>Per il rimborso chilometrico aggiungi il tuo veicolo (marca, modello, targa e tariffa ACI) in <Link to={`${base}/veicoli`}>Veicoli e fuel card</Link>.</span></div>}
        {!sc.viaggi.length ? <Empty compact icon="pin">Nessun viaggio</Empty> : <div className="rs-righe">{sc.viaggi.map((v, i) => (
          <div key={v.id} className={`rs-riga ${v.esclusa ? 'esclusa' : ''} ${!v.rimborsabile ? 'registro' : ''}`}>
            <div className="rs-c-n">{i + 1}</div>
            <div className="rs-c-data">{itData(v.data)}</div>
            <div className="rs-c-desc">
              <div className="strong">{v.partenza} - {v.arrivo}{v.andata_ritorno ? ' (andata e ritorno)' : ''}</div>
              <div className="small muted">{[v.motivazione, v.veicolo_testo, `${km(v.km_totali)}`, v.rimborsabile ? tariffa(v.tariffa) : 'non rimborsabile', v.tariffa_fonte && `fonte: ${v.tariffa_fonte}`].filter(Boolean).join(' · ')}</div>
              {v.esclusa && <div className="small rs-neg">Escluso da {v.esclusa_da_nome || 'responsabile'}: {v.esclusa_motivo}</div>}
              {modifica && v.avvisi.map((a) => <div key={a} className="small rs-warn"><Icon name="alert" /> {a}</div>)}
              {sc.spese.filter((s) => s.viaggio_id === v.id).map((s) => <div key={s.id} className="small">{s.categoria}: {eur(s.importo)}</div>)}
            </div>
            <div className="rs-c-imp">{!v.rimborsabile ? '-' : v.esclusa ? <s>{eur(v.importo)}</s> : eur(v.importo)}</div>
            <div className="rs-c-az">
              {modifica && <><button className="btn sm ghost" onClick={() => setModal({ tipo: 'viaggio', viaggio: v })}><Icon name="edit" />Modifica</button>
                <button className="iconbtn" aria-label="Elimina il viaggio" onClick={() => setModal({ tipo: 'conferma', titolo: 'Eliminare il viaggio?', testo: `${v.partenza} - ${v.arrivo}`, ok: () => esegui(() => api.del(`/note/${n.id}/viaggi/${v.id}`), 'Viaggio eliminato') })}><Icon name="trash" /></button></>}
              {az.escludi && v.rimborsabile && (v.esclusa ? <button className="btn sm ghost" onClick={() => esegui(() => api.post(`/note/${n.id}/includi`, { tipo: 'VIAGGIO', riga_id: v.id }), 'Riga di nuovo inclusa')}>Includi</button>
                : <button className="btn sm danger" onClick={() => setModal({ tipo: 'escludi', riga: { tipo: 'VIAGGIO', riga_id: v.id, testo: `${v.partenza} - ${v.arrivo} · ${eur(v.importo)}` } })}>Escludi</button>)}
            </div>
          </div>))}</div>}
        {speseB.length > 0 && <>
          <div className="rs-sub">Pedaggi autostradali e parcheggi (con ricevute)</div>
          <div className="rs-righe">{speseB.map((s, i) => <RigaSpesa key={s.id} s={s} i={i} />)}</div>
        </>}
        {modifica && <div className="rs-in small muted">Pedaggi e parcheggi si registrano con "Nuova spesa" (categoria Pedaggi o Parcheggi) e si collegano al viaggio.</div>}
      </Card>

      <Card className="rs-gap" title="Riepilogo" icon="stats"><Riepilogo r={sc.riepilogo} nota={n} /></Card>

      <div className="grid g2 rs-gap rs-due-col">
        <Card title="Firme elettroniche e storico" icon="clock">
          <div className="rs-firme">
            <div><span className="muted small">Dipendente</span><div>{n.inviata_at ? `Inviata da ${n.inviata_da_nome || sc.persona.nome} il ${itDataOra(n.inviata_at)}` : 'non ancora inviata'}</div></div>
            <div><span className="muted small">Responsabile</span><div>{n.approvata_at && n.approvazione_automatica ? `Approvazione automatica (vertice dell'organigramma) il ${itDataOra(n.approvata_at)}` : n.approvata_at ? `Approvata da ${n.approvata_da_nome} il ${itDataOra(n.approvata_at)}` : n.stato === 'INVIATA' ? `in attesa di ${n.al_pc ? 'P&C' : n.responsabile_nome}` : '-'}</div></div>
            <div><span className="muted small">P&C</span><div>{n.liquidata_at ? `Liquidata da ${n.liquidata_da_nome} il ${itDataOra(n.liquidata_at)}` : '-'}</div></div>
          </div>
          <Storico eventi={sc.eventi} />
        </Card>
        <Card title="Modulistica cartacea" icon="file"><ModuliCartacei /></Card>
      </div>

      {modal?.tipo === 'spesa' && <SpesaModal spesa={modal.spesa} nota={n} scheda={sc} categorie={sc.categorie} fuelCard={sc.benefit.fuel_card} eccezione={sc.eccezione} onClose={() => setModal(null)} onSalvata={() => { setModal(null); d.reload(); toast('Spesa salvata'); }} />}
      {modal?.tipo === 'viaggio' && <ViaggioModal viaggio={modal.viaggio} nota={n} veicoli={sc.veicoli} vettura={sc.vettura_aziendale} tariffaDefault={sc.tariffa_default} onClose={() => setModal(null)} onSalvata={() => { setModal(null); d.reload(); toast('Viaggio salvato'); }} />}
      {modal?.tipo === 'dati' && <DatiModal n={n} onClose={() => setModal(null)} onSalva={(b) => esegui(() => api.put(`/note/${n.id}`, b), 'Dati salvati').then(() => setModal(null))} />}
      {modal?.tipo === 'conferma' && <ConfirmModal title={modal.titolo} text={modal.testo} danger confirmText="Elimina" onConfirm={modal.ok} onClose={() => setModal(null)} />}
      {modal?.tipo === 'invia' && <ConfirmModal title={auto ? 'Confermare la nota?' : 'Inviare la nota al responsabile?'} confirmText={auto ? 'Conferma e approva' : 'Invia'} text={`${auto ? `Sei il vertice dell'organigramma: la nota è approvata automaticamente.${inv.attivo ? ` Il PDF parte verso ${elencoDest}.` : ''}` : sc.responsabile_previsto?.al_pc ? 'La nota va a P&C.' : `La nota va a ${sc.responsabile_previsto?.nome || 'il responsabile'}.`} Totale rimborsabile ${eur(sc.riepilogo.tot_rimborsabile)}. Dopo l'invio non si modifica più, salvo respingimento.${sc.controlli.avvisi.length ? ` Avvisi: ${sc.controlli.avvisi.join('; ')}.` : ''}`} onConfirm={() => esegui(() => api.post(`/note/${n.id}/invia`), 'Nota inviata')} onClose={() => setModal(null)} />}
      {modal?.tipo === 'approva' && <ConfirmModal title="Approvare la nota?" text={`Totale rimborsabile ${eur(sc.riepilogo.tot_rimborsabile)}${sc.riepilogo.tot_escluso ? ` (righe escluse per ${eur(sc.riepilogo.tot_escluso)})` : ''}. La nota passa a P&C per la liquidazione.${inv.attivo ? ` Il PDF di approvazione viene inviato a: ${elencoDest}.` : ''}`} confirmText="Approva" onConfirm={() => esegui(() => api.post(`/note/${n.id}/approva`), 'Nota approvata')} onClose={() => setModal(null)} />}
      {modal?.tipo === 'respingi' && <MotivoModal titolo="Respingere la nota?" aiuto="La nota torna in bozza al dipendente con il motivo." onClose={() => setModal(null)} onOk={(motivo) => esegui(() => api.post(`/note/${n.id}/respingi`, { motivo }), 'Nota respinta')} />}
      {modal?.tipo === 'escludi' && <MotivoModal titolo="Escludere la riga?" aiuto={`${modal.riga.testo}. La riga resta nella nota ma non viene rimborsata; il dipendente vede il motivo.`} onClose={() => setModal(null)} onOk={(motivo) => esegui(() => api.post(`/note/${n.id}/escludi`, { ...modal.riga, motivo }), 'Riga esclusa')} />}
      {modal?.tipo === 'rimanda' && <MotivoModal titolo="Rimandare la nota?" scelta={n.al_pc ? null : true} aiuto="Al responsabile torna da approvare; al dipendente torna in bozza." onClose={() => setModal(null)} onOk={(motivo, a) => esegui(() => api.post(`/note/${n.id}/rimanda`, { motivo, a: n.al_pc ? 'DIPENDENTE' : a }), 'Nota rimandata')} />}
      {modal?.tipo === 'liquida' && <LiquidaModal sc={sc} onClose={() => setModal(null)} onOk={(b) => esegui(() => api.post(`/note/${n.id}/liquida`, b), 'Liquidazione registrata')} />}
    </div>
  );
}

function DatiModal({ n, onClose, onSalva }) {
  const [v, setV] = useState({ motivazione: n.motivazione || '', anticipi: num(n.anticipi).replace(/\./g, ''), note: n.note || '' });
  const [err, setErr] = useState(null);
  const go = async () => { try { await onSalva(v); } catch (e) { setErr(e); } };
  return (
    <Modal title="Dati della nota" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={go}>Salva</button></>}>
      <ErrorBox error={err} />
      <div className="rs-form">
        <Field label="Motivazione della trasferta (generale)" help="Vale per le righe senza una motivazione propria"><textarea rows={2} value={v.motivazione} onChange={(e) => setV({ ...v, motivazione: e.target.value })} /></Field>
        <Field label="Anticipi ricevuti (EUR)"><input inputMode="decimal" value={v.anticipi} onChange={(e) => setV({ ...v, anticipi: e.target.value.replace(/[^\d,.]/g, '') })} /></Field>
        <Field label="Note"><textarea rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function MotivoModal({ titolo, aiuto, scelta, onClose, onOk }) {
  const [m, setM] = useState('');
  const [a, setA] = useState('DIPENDENTE');
  const [err, setErr] = useState(null);
  const go = async () => { try { await onOk(m.trim(), a); onClose(); } catch (e) { setErr(e); } };
  return (
    <Modal title={titolo} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={m.trim().length < 3} onClick={go}>Conferma</button></>}>
      <ErrorBox error={err} />
      <p className="small">{aiuto}</p>
      {scelta && <Field label="A chi"><select value={a} onChange={(e) => setA(e.target.value)}><option value="DIPENDENTE">Al dipendente (torna in bozza)</option><option value="RESPONSABILE">Al responsabile (torna da approvare)</option></select></Field>}
      <Field label="Motivo" required><textarea rows={3} autoFocus value={m} onChange={(e) => setM(e.target.value)} /></Field>
    </Modal>
  );
}

function LiquidaModal({ sc, onClose, onOk }) {
  const [v, setV] = useState({ data: oggiIso(), importo: num(Math.max(0, sc.riepilogo.saldo)).replace(/\./g, ''), riferimento: '' });
  const [err, setErr] = useState(null);
  const go = async () => { try { await onOk(v); onClose(); } catch (e) { setErr(e); } };
  return (
    <Modal title="Registra la liquidazione" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={!v.data || !v.riferimento.trim()} onClick={go}>Registra</button></>}>
      <ErrorBox error={err} />
      <p className="small">Saldo della nota: {eur(sc.riepilogo.saldo)} ({sc.riepilogo.saldo >= 0 ? 'a favore del dipendente' : 'a favore dell\'azienda: va recuperato'}). TeamSystem HR non è collegato: il pagamento si fa nel cedolino o con un bonifico e qui si registra il riferimento.</p>
      <div className="rs-tre">
        <Field label="Data del pagamento" required><input type="date" value={v.data} onChange={(e) => setV({ ...v, data: e.target.value })} /></Field>
        <Field label="Importo (EUR)" required><input inputMode="decimal" value={v.importo} onChange={(e) => setV({ ...v, importo: e.target.value.replace(/[^\d,.]/g, '') })} /></Field>
        <Field label="Riferimento" required><input value={v.riferimento} placeholder="cedolino o bonifico" onChange={(e) => setV({ ...v, riferimento: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

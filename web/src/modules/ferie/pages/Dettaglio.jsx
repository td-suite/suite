// Dettaglio di un periodo del piano o di una variazione: periodo, giorni, stato, piano, avviso di copertura (ricalcolato per chi
// decide), saldo della persona (a chi può vederlo), cronologia; azioni sulla variazione in attesa: Approva, Rifiuta (con motivo), Ritira.
import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, base, useApi } from '../api.js';
import { Card, Loading, Empty, PageHead, Modal, Field, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { StatoBadge, Saldo } from '../components.jsx';
import { periodo, quantita, itData, itDataOra, descriviEvento, num } from '../format.js';

export default function Dettaglio() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data: r, loading, error, reload } = useApi(`/richieste/${id}`, [id]);
  const [modal, setModal] = useState(null);
  const [nota, setNota] = useState('');
  const [busy, setBusy] = useState(false);
  const act = async (path, body, ok) => { setBusy(true); try { await api.post(`/variazioni/${id}/${path}`, body); toast(ok); setModal(null); setNota(''); window.dispatchEvent(new Event('suite:badges')); await reload(); } catch (e) { toast(e, 'err'); } setBusy(false); };
  if (error) return <div className="page"><Empty icon="alert" title="Richiesta non disponibile">{error.message}</Empty></div>;
  if (!r && loading) return <div className="page"><Loading /></div>;
  if (!r) return null;
  const cop = r.copertura || [];
  return (
    <div className="page">
      <PageHead title={`${r.tipo === 'ROL' ? 'Permesso' : r.variazione ? 'Variazione al piano' : 'Periodo del piano'} · ${r.persona}`} icon="calendar" crumb={<a href="#" onClick={(e) => { e.preventDefault(); nav(-1); }}>← Indietro</a>}
        sub={`${periodo(r)} · ${quantita(r)} · ${r.gruppo_nome}`}
        actions={<>
          {r.azioni?.approva && <button className="btn primary" disabled={busy} onClick={() => setModal('approva')}><Icon name="check" />Approva</button>}
          {r.azioni?.rifiuta && <button className="btn" disabled={busy} onClick={() => setModal('rifiuta')}><Icon name="x" />Rifiuta</button>}
          {r.azioni?.ritira && <button className="btn ghost danger" disabled={busy} onClick={() => setModal('ritira')}><Icon name="x" />Ritira la variazione</button>}
          {r.piano && <Link className="btn ghost" to={r.mia ? `${base}?anno=${r.piano.anno}` : `${base}/area?gruppo=${encodeURIComponent(r.gruppo || '')}&anno=${r.piano.anno}`}><Icon name="calendar" />Piano {r.piano.anno}</Link>}
        </>} />
      {r.variazione_proposta && <div className="alert warn"><Icon name="refresh" /><span>Variazione proposta: {r.variazione_proposta.tipo === 'RIMOZIONE' ? 'togliere il periodo' : `spostarlo al ${itData(r.variazione_proposta.data_inizio)} → ${itData(r.variazione_proposta.data_fine)} (${num(r.variazione_proposta.giorni)} giorni)`}{r.variazione_proposta.note ? ` · ${r.variazione_proposta.note}` : ''}</span></div>}
      {cop.length > 0 && ['PIANIFICATA', 'RICHIESTA', 'APPROVATA'].includes(r.stato) && (
        <div className="alert warn fe-cop"><Icon name="alert" /><div><b>Sotto la copertura minima in {cop.length} {cop.length === 1 ? 'giorno' : 'giorni'}</b> (avviso, non blocca l'approvazione):
          <ul>{cop.map((c, i) => <li key={i}>{itData(c.data)}: {c.ruolo} presenti {num(c.presenti)} su un minimo di {c.minimo}</li>)}</ul></div></div>
      )}
      <div className="fe-two">
        <div className="grid">
          <Card title="Richiesta" icon="list">
            <dl className="fe-dl">
              <dt>Stato</dt><dd><StatoBadge stato={r.stato} /></dd>
              <dt>Periodo</dt><dd>{periodo(r)}</dd>
              <dt>Quantità</dt><dd>{quantita(r)}</dd>
              <dt>Area</dt><dd>{r.gruppo_nome}</dd>
              {r.piano && <><dt>Piano</dt><dd>{r.piano.anno} · {r.piano.stato_label} (versione {r.piano.versione})</dd></>}
              {r.variazione && <><dt>Origine</dt><dd>Variazione al piano approvato</dd></>}
              <dt>Approva</dt><dd>{r.approvatore_nome || 'Amministratore o nessuno (vertice)'}</dd>
              {r.chiusura_descrizione && <><dt>Chiusura</dt><dd>{r.chiusura_descrizione}</dd></>}
              {r.note && <><dt>Note</dt><dd className="fe-pre">{r.note}</dd></>}
              {r.deciso_at && <><dt>Decisione</dt><dd>{r.deciso_da_nome} · {itDataOra(r.deciso_at)}{r.nota_decisione ? <div className="fe-pre">{r.nota_decisione}</div> : null}</dd></>}
              {r.inserita_da_nome && <><dt>Inserita da</dt><dd>{r.inserita_da_nome} · {itDataOra(r.created_at)}</dd></>}
            </dl>
          </Card>
          <Card title="Cronologia" icon="clock">
            <ul className="fe-timeline">{(r.eventi || []).map((e) => <li key={e.id}><div className="small muted">{itDataOra(e.created_at)} · {e.user_nome || 'Sistema'}</div><div>{descriviEvento(e)}</div></li>)}</ul>
          </Card>
        </div>
        {r.saldo && <Card title={`Saldo ${r.anno} di ${r.persona}`} icon="stats"><Saldo s={r.saldo} compatto /></Card>}
      </div>
      {modal && (
        <Modal title={modal === 'approva' ? 'Approva la variazione' : modal === 'rifiuta' ? 'Rifiuta la variazione' : 'Ritira la variazione'} onClose={() => setModal(null)}
          footer={<><button className="btn ghost" onClick={() => setModal(null)}>Chiudi</button>
            <button className={`btn ${modal === 'approva' ? 'primary' : 'danger'}`} disabled={busy || (modal === 'rifiuta' && nota.trim().length < 3)}
              onClick={() => (modal === 'approva' ? act('approva', { nota }, 'Variazione approvata') : modal === 'rifiuta' ? act('rifiuta', { nota }, 'Variazione non accolta') : act('ritira', {}, 'Variazione ritirata'))}>
              {modal === 'approva' ? 'Approva' : modal === 'rifiuta' ? 'Rifiuta' : 'Ritira'}</button></>}>
          {modal === 'approva' && cop.length > 0 && <div className="alert warn"><Icon name="alert" /><span>Approvando, {cop.length === 1 ? 'un giorno resta' : `${cop.length} giorni restano`} sotto la copertura minima.</span></div>}
          {modal !== 'ritira' && <Field label={modal === 'rifiuta' ? 'Motivo (obbligatorio, lo legge il dipendente)' : 'Nota per il dipendente (facoltativa)'}><textarea rows={3} value={nota} onChange={(e) => setNota(e.target.value)} maxLength={1000} /></Field>}
        </Modal>
      )}
    </div>
  );
}

// Il mio piano <anno>: calendario dei 12 mesi in cui il dipendente aggiunge i periodi cliccando o trascinando, riepilogo dei giorni
// (spettanti, residuo dell'anno precedente, pianificati, da pianificare, goduti), chiusure collettive proposte, "Invia al responsabile",
// stato del piano con la cronologia. Dopo l'approvazione si propongono solo variazioni. Sotto, "Il piano della mia area" (persone ×
// mesi, solo periodi: trasparente a tutta l'area e solo all'area).
import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, base, useApi } from '../api.js';
import { useAuth, isApprovatore } from '../auth.jsx';
import { Card, Loading, Empty, PageHead, Seg, Modal, Field, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { Saldo, Avvisi, StatoBadge, StatoPianoBadge, CalendarioAnno, PeriodoModal, GrigliaMesi, Legenda } from '../components.jsx';
import { itData, itDataOra, num, oggiIso, periodo, quantita, descriviEventoPiano, STATO_PIANO } from '../format.js';

const SPIEGA = {
  BOZZA: 'Il piano è in bozza: aggiungi i periodi trascinando sul calendario, poi premi "Invia al responsabile".',
  PROPOSTO: 'Il piano è stato inviato al responsabile. Finché non lo prende in carico puoi ancora modificarlo.',
  IN_REVISIONE: 'Il responsabile sta rivedendo il piano: le modifiche ora le fa lui. Riceverai una notifica.',
  APPROVATO: 'Il piano è approvato. Per cambiare un periodo proponi una variazione: clicca il periodo o trascina su giorni liberi.',
  DEFINITIVO: 'Il piano è definitivo. Per cambiare un periodo proponi una variazione: il responsabile la approva o la rifiuta.',
};

export default function MioPiano() {
  const { user } = useAuth();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const anno0 = Number(oggiIso().slice(0, 4));
  const anno = Number(sp.get('anno')) || anno0;
  const setAnno = (a) => setSp({ anno: String(a) });
  const { data, loading, error, reload } = useApi(`/mio-piano?anno=${anno}`, [anno]);
  const area = useApi(data?.persona ? `/area?anno=${anno}&gruppo=${encodeURIComponent(data.persona.gruppo)}` : null, [anno, data?.persona?.gruppo]);
  const [modal, setModal] = useState(null);
  const [invio, setInvio] = useState(false);
  const ricarica = () => { reload(); area.reload(); window.dispatchEvent(new Event('suite:badges')); };
  if (error) return <div className="page"><Empty icon="alert" title="Errore">{error.message}</Empty></div>;
  if (!data && loading) return <div className="page"><Loading /></div>;
  if (!data) return null;
  if (data.fuori_perimetro) {
    return (
      <div className="page">
        <PageHead title="Piano Ferie" icon="calendar" sub="Piano ferie annuale per area: il dipendente lo compila, il responsabile dell'area lo approva e lo rende definitivo." />
        <Card><Empty icon="info" title="Non hai un piano ferie in questo modulo">{data.motivo}</Empty>
          <div className="row" style={{ justifyContent: 'center', marginTop: 8 }}>
            {isApprovatore(user) && <Link className="btn" to={`${base}/area`}><Icon name="calendar" />Piano dell'area</Link>}
          </div>
        </Card>
      </div>
    );
  }
  const p = data.persona;
  const s = data.saldo;
  const piano = data.piano;
  const az = piano?.azioni || {};
  const g = data.oggi;
  const scrive = az.modifica || az.variazione;
  const chiudi = () => setModal(null);
  const fatto = (msg) => { toast(msg); chiudi(); ricarica(); };

  // Selezione di giorni liberi sul calendario: nuovo periodo (piano aperto) o variazione (piano approvato)
  const nuovo = (da, a, chiusura) => {
    if (!piano) return;
    if (az.modifica) setModal({ tipo: 'nuovo', iniziale: { data_inizio: da, data_fine: a }, chiusura });
    else if (az.variazione) setModal({ tipo: 'var_aggiunta', iniziale: { data_inizio: da, data_fine: a } });
    else toast(SPIEGA[piano.stato], 'err');
  };
  // Clic su un periodo esistente
  const apri = (x) => {
    if (x.stato === 'RICHIESTA' || x.variazione_proposta) return setModal({ tipo: 'attesa', periodo: x });
    if (az.modifica && x.data_inizio >= g) return setModal({ tipo: 'modifica', periodo: x });
    if (az.variazione && x.stato === 'APPROVATA' && x.data_inizio > g) return setModal({ tipo: 'var_modifica', periodo: x });
    return setModal({ tipo: 'info', periodo: x });
  };
  const pid = piano?.id;
  return (
    <div className="page">
      <PageHead title={`Il mio piano ${anno}`} icon="calendar" sub={`${p.nome} · ${p.gruppo_nome}${p.approvatore ? ` · responsabile: ${p.approvatore}` : ' · approva l\'amministratore'}`}
        actions={<>
          <Seg value={anno} onChange={setAnno} items={data.anni.map((a) => ({ value: a, label: String(a) }))} label="Anno" />
          {az.invia && <button className="btn primary" onClick={() => setInvio(true)}><Icon name="send" />Invia al responsabile</button>}
        </>} />
      {data.settings.avviso_dipendenti && <div className="alert info"><Icon name="info" /><span>{data.settings.avviso_dipendenti}</span></div>}
      {piano && (
        <div className={`fe-stato-piano st-${piano.stato}`}>
          <StatoPianoBadge stato={piano.stato} />
          <span>{SPIEGA[piano.stato]}</span>
          {data.scadenza && ['BOZZA'].includes(piano.stato) && <span className={`small ${g > data.scadenza ? 'fe-neg' : ''}`}><Icon name="clock" /> da inviare entro il {itData(data.scadenza)}</span>}
          {piano.nota_approvatore && <span className="small muted">Nota del responsabile: {piano.nota_approvatore}</span>}
        </div>
      )}
      <Saldo s={s} />
      <Avvisi avvisi={s.avvisi} />
      <Card title={`Calendario ${anno}`} icon="calendar" actions={<span className="small muted">{scrive ? (az.modifica ? 'Trascina sui giorni per aggiungere un periodo · clicca un periodo per spostarlo o toglierlo' : 'Trascina su giorni liberi per proporre una variazione · clicca un periodo per proporre di spostarlo o toglierlo') : 'Sola lettura'}</span>}>
        <CalendarioAnno anno={anno} periodi={data.periodi} festivi={data.festivi} settimana={data.settimana_giorni} chiusure={data.chiusure}
          selezionabile={scrive} minData={g} onSeleziona={nuovo} onPeriodo={apri} />
        <Legenda />
      </Card>
      <div className="fe-two">
        <Card title="I miei periodi" icon="list" flush>
          {!data.periodi.length ? <Empty icon="calendar" title={`Nessun periodo nel piano ${anno}`} compact>{scrive ? 'Trascina sul calendario per aggiungere il primo.' : null}</Empty> : (
            <div className="table-wrap"><table className="t fe-table"><thead><tr><th>Periodo</th><th className="num">Giorni</th><th>Stato</th><th>Note</th></tr></thead>
              <tbody>{data.periodi.map((x) => <tr key={x.id} className="click" onClick={() => apri(x)}><td style={{ whiteSpace: 'nowrap' }}>{periodo(x)}{x.variazione && <div className="small muted">variazione</div>}</td><td className="num">{quantita(x)}</td>
                <td><StatoBadge stato={x.stato} />{x.variazione_proposta && <div className="small fe-warn">{x.variazione_proposta.tipo === 'RIMOZIONE' ? 'proposta: togliere' : `proposta: ${itData(x.variazione_proposta.data_inizio)} → ${itData(x.variazione_proposta.data_fine)}`}</div>}</td>
                <td className="small">{x.note}{x.nota_decisione && <div className="muted">{x.nota_decisione}</div>}</td></tr>)}</tbody></table></div>)}
          {data.storico.length > 0 && <details className="small" style={{ padding: '8px 14px' }}><summary>Periodi tolti e variazioni non accolte ({data.storico.length})</summary>
            <ul className="fe-fest">{data.storico.map((x) => <li key={x.id}><Link to={`${base}/richieste/${x.id}`}>{periodo(x)}</Link> · {x.stato === 'RIFIUTATA' ? 'non accolta' : 'tolto'}{x.nota_decisione ? ` · ${x.nota_decisione}` : ''}</li>)}</ul></details>}
        </Card>
        <div className="grid">
          {data.chiusure.length > 0 && (
            <Card title="Chiusure collettive della tua area" icon="building">
              <ul className="fe-list">{data.chiusure.map((c) => (
                <li key={c.id}><div><div className="strong">{itData(c.data_inizio)} → {itData(c.data_fine)}</div><div className="small muted">{c.descrizione || 'Chiusura collettiva'}</div></div>
                  {c.nel_piano ? <span className="small muted">nel piano</span> : c.data_inizio < g ? <span className="small muted">passata</span> : scrive ? <button type="button" className="btn sm" onClick={() => nuovo(c.data_inizio, c.data_fine, c.id)}>{az.modifica ? 'Aggiungi al piano' : 'Proponi'}</button> : null}</li>))}</ul>
            </Card>
          )}
          <Card title="Stato del piano e cronologia" icon="clock">
            {piano ? <>
              <dl className="fe-dl">
                <dt>Stato</dt><dd><StatoPianoBadge stato={piano.stato} /> <span className="small muted">versione {piano.versione}</span></dd>
                {piano.inviato_at && <><dt>Inviato</dt><dd>{itDataOra(piano.inviato_at)}</dd></>}
                {piano.approvato_at && <><dt>Approvato</dt><dd>{itDataOra(piano.approvato_at)}{piano.approvato_da_nome ? ` · ${piano.approvato_da_nome}` : ''}</dd></>}
                {piano.definitivo_at && <><dt>Definitivo</dt><dd>{itDataOra(piano.definitivo_at)}{piano.definitivo_da_nome ? ` · ${piano.definitivo_da_nome}` : ''}</dd></>}
                <dt>Settimana</dt><dd>{data.settimana}</dd>
                <dt>Spettanza</dt><dd>{num(s.giorni_annui)} giorni l'anno <span className="muted small">· {s.spettanza_fonte}</span></dd>
              </dl>
              <ul className="fe-timeline">{(piano.eventi || []).slice(0, 12).map((e) => <li key={e.id}><div className="small muted">{itDataOra(e.created_at)} · {e.user_nome || 'Sistema'}</div><div className="small">{descriviEventoPiano(e)}</div></li>)}</ul>
            </> : <div className="small muted">Nessun piano per il {anno}.</div>}
          </Card>
        </div>
      </div>
      <Card title={`Il piano della mia area · ${p.gruppo_nome} ${anno}`} icon="users" flush actions={<span className="small muted">Nomi e periodi dei colleghi della tua area; saldi e note restano riservati</span>}>
        {area.error ? <Empty icon="alert" title="Errore">{area.error.message}</Empty> : !area.data ? <Loading /> : <GrigliaMesi piano={area.data} periodi={area.data.periodi} anno={anno} mostraTotale={false} />}
        <Legenda variazioni={false} />
      </Card>

      {invio && <InvioModal piano={piano} saldo={s} onClose={() => setInvio(false)} onDone={() => { setInvio(false); toast('Piano inviato al responsabile'); ricarica(); }} />}
      {modal?.tipo === 'nuovo' && <PeriodoModal pianoId={pid} titolo="Nuovo periodo nel piano" iniziale={modal.iniziale} chiusuraId={modal.chiusura} onClose={chiudi}
        onSalva={async (b) => { await api.post(`/piani/${pid}/periodi`, b); fatto('Periodo aggiunto al piano'); }} />}
      {modal?.tipo === 'modifica' && <PeriodoModal pianoId={pid} titolo="Periodo del piano" iniziale={modal.periodo} esistente={modal.periodo} onClose={chiudi}
        onSalva={async (b) => { await api.put(`/piani/${pid}/periodi/${modal.periodo.id}`, b); fatto('Periodo aggiornato'); }}
        onTogli={async () => { await api.del(`/piani/${pid}/periodi/${modal.periodo.id}`, {}); fatto('Periodo tolto dal piano'); }} />}
      {modal?.tipo === 'var_aggiunta' && <PeriodoModal pianoId={pid} titolo="Variazione al piano: aggiungi un periodo" modo="variazione" iniziale={modal.iniziale} onClose={chiudi}
        avviso="Il piano è approvato: il nuovo periodo va al responsabile, che lo approva o lo rifiuta."
        onSalva={async (b) => { await api.post(`/piani/${pid}/variazioni`, { tipo: 'AGGIUNTA', ...b }); fatto('Variazione inviata al responsabile'); }} />}
      {modal?.tipo === 'var_modifica' && <PeriodoModal pianoId={pid} titolo="Variazione al piano: sposta o togli il periodo" modo="variazione" iniziale={modal.periodo} esistente={modal.periodo} onClose={chiudi}
        avviso={`Periodo approvato: ${periodo(modal.periodo)}. Cambia le date per proporre lo spostamento, oppure proponi di toglierlo.`}
        onSalva={async (b) => { await api.post(`/piani/${pid}/variazioni`, { tipo: 'SPOSTAMENTO', periodo_id: modal.periodo.id, ...b }); fatto('Spostamento proposto al responsabile'); }}
        onTogli={async (nota) => { await api.post(`/piani/${pid}/variazioni`, { tipo: 'RIMOZIONE', periodo_id: modal.periodo.id, note: nota }); fatto('Proposta di togliere il periodo inviata'); }} />}
      {modal?.tipo === 'attesa' && (
        <Modal title="Variazione in attesa" onClose={chiudi} footer={<><Link className="btn ghost" to={`${base}/richieste/${modal.periodo.id}`}>Dettaglio</Link>
          <button className="btn danger" onClick={async () => { try { await api.post(`/variazioni/${modal.periodo.id}/ritira`); fatto('Variazione ritirata'); } catch (e) { toast(e, 'err'); } }}>Ritira la variazione</button></>}>
          <p>{periodo(modal.periodo)} · {modal.periodo.variazione_proposta ? (modal.periodo.variazione_proposta.tipo === 'RIMOZIONE' ? 'proposta di togliere il periodo' : `proposta di spostarlo al ${itData(modal.periodo.variazione_proposta.data_inizio)} → ${itData(modal.periodo.variazione_proposta.data_fine)}`) : 'nuovo periodo proposto'}: in attesa del responsabile.</p>
        </Modal>
      )}
      {modal?.tipo === 'info' && (
        <Modal title="Periodo del piano" onClose={chiudi} footer={<><Link className="btn ghost" to={`${base}/richieste/${modal.periodo.id}`}>Dettaglio e cronologia</Link><button className="btn" onClick={chiudi}>Chiudi</button></>}>
          <p>{periodo(modal.periodo)} · {quantita(modal.periodo)} · <StatoBadge stato={modal.periodo.stato} /></p>
          <p className="small muted">{modal.periodo.data_inizio <= g ? 'Il periodo è già iniziato: per cambiarlo rivolgiti al responsabile.' : SPIEGA[piano?.stato]}</p>
        </Modal>
      )}
    </div>
  );
}

function InvioModal({ piano, saldo, onClose, onDone }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const invia = async () => { setBusy(true); try { await api.post(`/piani/${piano.id}/invia`, { note }); onDone(); } catch (e) { toast(e, 'err'); } setBusy(false); };
  return (
    <Modal title={`Invia il piano ${piano.anno} al responsabile`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Chiudi</button><button className="btn primary" disabled={busy} onClick={invia}><Icon name="send" />Invia</button></>}>
      <div className="fe-form">
        <p className="small">Il responsabile della tua area riceve il piano, può modificarlo, approvarlo e renderlo definitivo. Finché non lo prende in carico puoi ancora cambiarlo.</p>
        <div className="small">Pianificati <b>{num(saldo.pianificato_totale)}</b> giorni · da pianificare <b className={saldo.da_pianificare < 0 ? 'fe-neg' : ''}>{num(saldo.da_pianificare)}</b></div>
        {saldo.da_pianificare > 0 && <div className="alert warn"><Icon name="alert" /><span>Restano {num(saldo.da_pianificare)} giorni non pianificati: puoi inviare lo stesso e completarli dopo con il responsabile.</span></div>}
        <Field label="Note per il responsabile"><textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Facoltative" /></Field>
        <div className="small muted">Stato attuale: {STATO_PIANO[piano.stato]?.label}</div>
      </div>
    </Modal>
  );
}

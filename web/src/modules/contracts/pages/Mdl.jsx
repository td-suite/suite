// Medicina del lavoro (v0.77.0): calendario della sorveglianza sanitaria di dipendenti e tirocinanti, convocazioni e protocolli sanitari.
// Le convocazioni le fanno gli amministratori del widget selezionando il personale in scadenza; HR vede e registra le visite.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, BASE } from '../api.js';
import { useApi, Card, Field, ErrorBox, Loading, Empty, Badge, KindBadge, Kpi, Modal, useToast, Icon } from '../components/ui.jsx';
import { useAuth, canWrite } from '../auth.jsx';
import { MDL_STATO, GIUDIZIO_TONE } from '../components/Sviluppo.jsx';
import { itDate, itDateTime, today } from '../format.js';

const ESITO = { INVIATO: ['inviata', 'green'], REGISTRATO: ['solo registro email', 'amber'], FALLITO: ['invio fallito', 'red'], SENZA_EMAIL: ['senza email', 'red'], SENZA_INVIO: ['non inviata', 'grey'] };

export default function Mdl() {
  const toast = useToast();
  const { user } = useAuth();
  const writer = canWrite(user);
  const d = useApi('/mdl');
  const [filtro, setFiltro] = useState('scadenza');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(new Set());
  const [modal, setModal] = useState(null);
  const [conv, setConv] = useState(null);
  const [prot, setProt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const anticipo = d.data?.predefiniti?.anticipo_giorni || 60;
  const righe = useMemo(() => (d.data?.elenco || []).filter((x) => {
    if (q && !`${x.nome} ${x.mansione || ''} ${x.sede || ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (filtro === 'scadenza') return x.sorveglianza && x.impostata && x.giorni != null && x.giorni <= anticipo;
    if (filtro === 'impostare') return x.stato === 'DA_IMPOSTARE';
    if (filtro === 'prescrizioni') return Boolean(x.prescrizioni) || ['NON_IDONEO_TEMPORANEO', 'NON_IDONEO_PERMANENTE'].includes(x.giudizio);
    return true;
  }), [d.data, filtro, q, anticipo]);
  if (d.error) return <div className="page"><ErrorBox error={d.error} /></div>;
  if (!d.data) return <div className="page"><Loading /></div>;
  const { elenco, fissate, convocazioni, protocolli, giudizi, tipi, predefiniti, puo_convocare: puoConvocare } = d.data;
  const sogg = elenco.filter((x) => x.sorveglianza);
  const inScad = sogg.filter((x) => x.impostata && x.giorni != null && x.giorni <= anticipo);
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const tutti = righe.length > 0 && righe.every((x) => sel.has(x.id));
  const apriConv = () => { setErr(null); setConv({ data: '', ora: '', luogo: predefiniti.luogo, medico: predefiniti.medico, note: '', invia: true }); setModal('convoca'); };
  const convoca = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post('/mdl/convocazioni', { ...conv, ids: [...sel] });
      const ok = r.esiti.filter((e) => ['INVIATO', 'REGISTRATO'].includes(e.stato)).length;
      toast(`${r.esiti.length} persone convocate${conv.invia ? `, ${ok} email ${r.esiti.some((e) => e.stato === 'REGISTRATO') ? 'registrate (posta in modalità registro)' : 'inviate'}` : ''}`);
      setModal({ esiti: r.esiti }); setSel(new Set()); d.reload();
    } catch (e) { setErr(e); }
    setBusy(false);
  };
  const salvaProt = async () => { try { if (prot.id) await api.put(`/mdl/protocolli/${prot.id}`, prot); else await api.post('/mdl/protocolli', prot); toast('Protocollo salvato'); setModal(null); d.reload(); } catch (e) { setErr(e); } };
  const selezionati = elenco.filter((x) => sel.has(x.id));
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Medicina del lavoro</h1><div className="sub">Sorveglianza sanitaria di dipendenti e tirocinanti: giudizi di idoneità, calendario delle visite, protocolli sanitari e convocazioni.</div></div>
        {puoConvocare && <button className="btn" disabled={!sel.size} onClick={apriConv}><Icon name="mail" />Convoca i selezionati ({sel.size})</button>}
      </div>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi label="Soggetti a sorveglianza" value={sogg.length} foot={`${elenco.length - sogg.length} non soggetti`} />
        <Kpi label={`In scadenza entro ${anticipo} giorni`} value={inScad.length} accent foot={`${inScad.filter((x) => x.giorni < 0).length} già scadute o mai fatte`} />
        <Kpi label="Visite fissate" value={fissate.length} foot="programmate o convocate" />
        <Kpi label="Posizioni da impostare" value={elenco.filter((x) => x.stato === 'DA_IMPOSTARE').length} foot="senza scheda né visite: nessuna scadenza" />
      </div>
      <div className="filters">
        <Field label="Mostra"><select value={filtro} onChange={(e) => { setFiltro(e.target.value); setSel(new Set()); }}><option value="scadenza">In scadenza entro {anticipo} giorni</option><option value="tutti">Tutto il personale</option><option value="impostare">Posizioni da impostare</option><option value="prescrizioni">Con prescrizioni o non idoneità</option></select></Field>
        <Field label="Cerca"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Persona, mansione, sede" /></Field>
      </div>
      <Card title={`Personale · ${righe.length}`} flush>
        {!righe.length ? <Empty>{filtro === 'scadenza' ? `Nessuna visita in scadenza entro ${anticipo} giorni` : 'Nessuna persona'}</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr>{puoConvocare && <th style={{ width: 34 }}><input type="checkbox" aria-label="Seleziona tutti" checked={tutti} onChange={() => setSel(tutti ? new Set() : new Set(righe.filter((x) => x.sorveglianza).map((x) => x.id)))} /></th>}<th>Persona</th><th>Mansione e sede</th><th>Ultimo giudizio</th><th>Prossima visita</th><th>Stato</th><th>Visita fissata</th></tr></thead>
            <tbody>{righe.map((x) => { const st = MDL_STATO[x.stato]; return (
              <tr key={x.id}>
                {puoConvocare && <td><input type="checkbox" aria-label={`Seleziona ${x.nome}`} disabled={!x.sorveglianza} checked={sel.has(x.id)} onChange={() => toggle(x.id)} /></td>}
                <td className="strong"><Link to={`${BASE}/risorse/${x.id}?tab=mdl`}>{x.nome}</Link> <KindBadge kind={x.kind} />{!x.email && <div className="small"><Badge tone="red">senza email</Badge></div>}</td>
                <td>{x.mansione || '–'}<div className="small muted">{[x.sede, x.protocollo && `protocollo ${x.protocollo}`].filter(Boolean).join(' · ')}</div></td>
                <td>{x.giudizio ? <Badge tone={GIUDIZIO_TONE[x.giudizio]}>{giudizi[x.giudizio]}</Badge> : <span className="muted">–</span>}{x.ultima_visita && <div className="small muted">visita del {itDate(x.ultima_visita)}</div>}</td>
                <td>{x.sorveglianza && x.impostata && x.prossima ? <><span className="strong">{itDate(x.prossima)}</span><div className="small muted">{x.giorni < 0 ? `da ${-x.giorni} giorni` : `tra ${x.giorni} giorni`} · {x.motivo.toLowerCase()}</div></> : <span className="muted">–</span>}</td>
                <td><Badge tone={st.tone}>{st.label}</Badge></td>
                <td>{x.fissata ? <><span className="strong">{itDate(x.fissata.data)}</span>{x.fissata.ora ? ` ore ${x.fissata.ora}` : ''}<div className="small muted">{x.fissata.stato === 'CONVOCATA' ? 'convocata' : 'programmata'}</div></> : <span className="muted">–</span>}</td>
              </tr>); })}</tbody>
          </table></div>)}
      </Card>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <Card title={`Protocolli sanitari (${protocolli.length})`} flush actions={writer && <button className="btn sm" onClick={() => { setErr(null); setProt({ nome: '', mansioni: '', rischi: '', accertamenti: '', periodicita_mesi: 12, attivo: true }); setModal('prot'); }}><Icon name="plus" />Nuovo protocollo</button>}>
          {!protocolli.length ? <Empty>Nessun protocollo: si inseriscono quelli definiti dal medico competente per mansione e rischio</Empty> : (
            <div className="table-wrap"><table className="t"><thead><tr><th>Protocollo</th><th>Accertamenti</th><th className="num">Periodicità</th><th /></tr></thead>
              <tbody>{protocolli.map((x) => <tr key={x.id}><td className="strong">{x.nome}{!x.attivo && <> <Badge>non attivo</Badge></>}<div className="small muted">{[x.mansioni, x.rischi].filter(Boolean).join(' · ')}</div></td><td className="small" style={{ whiteSpace: 'pre-wrap' }}>{x.accertamenti || '–'}</td><td className="num">{x.periodicita_mesi} mesi</td>
                <td className="num">{writer && <button className="iconbtn" aria-label="Modifica" onClick={() => { setErr(null); setProt({ ...x, mansioni: x.mansioni || '', rischi: x.rischi || '', accertamenti: x.accertamenti || '' }); setModal('prot'); }}><Icon name="edit" /></button>}</td></tr>)}</tbody></table></div>)}
        </Card>
        <Card title="Ultime convocazioni" flush>
          {!convocazioni.length ? <Empty>Nessuna convocazione</Empty> : (
            <div className="table-wrap"><table className="t"><thead><tr><th>Visita del</th><th>Dove</th><th className="num">Persone</th><th className="num">Email</th><th>Fatta da</th></tr></thead>
              <tbody>{convocazioni.map((c) => <tr key={c.id} className="click" onClick={() => setModal({ esiti: c.esiti })}><td className="strong">{itDate(c.data)}{c.ora ? ` ore ${c.ora}` : ''}</td><td>{c.luogo || '–'}<div className="small muted">{c.medico}</div></td><td className="num">{c.persone}</td><td className="num">{c.inviate}</td><td className="small">{c.created_by_name}<div className="muted">{itDateTime(c.created_at)}</div></td></tr>)}</tbody></table></div>)}
        </Card>
      </div>

      {modal === 'convoca' && conv && (
        <Modal wide title={`Convocazione alla visita · ${selezionati.length} ${selezionati.length === 1 ? 'persona' : 'persone'}`} onClose={() => setModal(null)}
          footer={<><button className="btn ghost" onClick={() => setModal(null)}>Annulla</button><button className="btn" disabled={busy || !conv.data || conv.data < today()} onClick={convoca}>{busy ? 'Convocazione…' : conv.invia ? 'Convoca e invia le email' : 'Convoca senza inviare'}</button></>}>
          <ErrorBox error={err} />
          <div className="form-grid">
            <Field label="Data della visita *"><input type="date" min={today()} value={conv.data} onChange={(e) => setConv({ ...conv, data: e.target.value })} /></Field>
            <Field label="Ora" help="La stessa per tutti: per orari scaglionati fai più convocazioni"><input value={conv.ora} placeholder="09:00" onChange={(e) => setConv({ ...conv, ora: e.target.value })} /></Field>
            <Field label="Luogo" className="span2"><input value={conv.luogo} onChange={(e) => setConv({ ...conv, luogo: e.target.value })} /></Field>
            <Field label="Medico competente" className="span2"><input value={conv.medico} onChange={(e) => setConv({ ...conv, medico: e.target.value })} /></Field>
            <Field label="Indicazioni per i convocati" className="span2" help="Per esempio: presentarsi a digiuno, portare gli occhiali in uso. Nessun dato sanitario."><textarea rows={2} value={conv.note} onChange={(e) => setConv({ ...conv, note: e.target.value })} /></Field>
          </div>
          <label className="f inline" style={{ marginTop: 10 }}><input type="checkbox" checked={conv.invia} onChange={(e) => setConv({ ...conv, invia: e.target.checked })} /> Invia la convocazione a ciascuno dalla casella People, con l'ufficio People in copia</label>
          <p className="small muted" style={{ marginTop: 10 }}>Convocati: {selezionati.map((x) => `${x.nome}${x.email ? '' : ' (senza email)'}`).join(', ')}. Ognuno riceve un'email personale: gli altri convocati non compaiono. La visita entra nel calendario e nello scadenzario.</p>
        </Modal>)}
      {modal?.esiti && (
        <Modal title="Esito della convocazione" onClose={() => setModal(null)} footer={<button className="btn" onClick={() => setModal(null)}>Chiudi</button>}>
          <table className="t"><tbody>{modal.esiti.map((e) => { const [l, t] = ESITO[e.stato] || [e.stato, 'grey']; return <tr key={e.id}><td className="strong">{e.nome}<div className="small muted">{e.email || 'nessuna email in anagrafica'}</div></td><td className="num"><Badge tone={t}>{l}</Badge>{e.errore && <div className="small muted">{e.errore}</div>}</td></tr>; })}</tbody></table>
        </Modal>)}
      {modal === 'prot' && prot && (
        <Modal title={prot.id ? 'Protocollo sanitario' : 'Nuovo protocollo sanitario'} onClose={() => setModal(null)} footer={<><button className="btn ghost" onClick={() => setModal(null)}>Annulla</button><button className="btn" disabled={!prot.nome.trim()} onClick={salvaProt}>Salva</button></>}>
          <ErrorBox error={err} />
          <div className="form-grid">
            <Field label="Nome *" className="span2"><input value={prot.nome} placeholder="es. Videoterminalisti" onChange={(e) => setProt({ ...prot, nome: e.target.value })} /></Field>
            <Field label="Mansioni interessate" className="span2"><input value={prot.mansioni} onChange={(e) => setProt({ ...prot, mansioni: e.target.value })} /></Field>
            <Field label="Rischi" className="span2"><input value={prot.rischi} onChange={(e) => setProt({ ...prot, rischi: e.target.value })} /></Field>
            <Field label="Accertamenti previsti" className="span2" help="Come definiti dal medico competente"><textarea rows={3} value={prot.accertamenti} onChange={(e) => setProt({ ...prot, accertamenti: e.target.value })} /></Field>
            <Field label="Periodicità (mesi)"><input type="number" min="1" max="120" value={prot.periodicita_mesi} onChange={(e) => setProt({ ...prot, periodicita_mesi: Number(e.target.value) })} /></Field>
            <Field label="Attivo"><select value={prot.attivo ? '1' : '0'} onChange={(e) => setProt({ ...prot, attivo: e.target.value === '1' })}><option value="1">Sì</option><option value="0">No</option></select></Field>
          </div>
        </Modal>)}
    </div>
  );
}

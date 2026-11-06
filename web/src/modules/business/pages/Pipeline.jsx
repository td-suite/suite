// Business Hub · Pipeline: kanban a 7 colonne (più i prospect censiti, ripiegati) con trascinamento tra le fasi. Il rilascio chiede la
// data della fase (oggi per default) e registra l'attività di avanzamento nel diario. La fase 7 richiede il cliente attivo.
import React, { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, BASE } from '../api.js';
import { useAuth, canEditKind } from '../auth.jsx';
import { useApi, Loading, ErrorBox, Badge, Modal, Field, useToast } from '../components/ui.jsx';
import { FASI, LINEE, PRIORITA, eurK, itDate, today } from '../format.js';
import { FiltriAccount, useFiltri, filtra } from './Clienti.jsx';

export default function Pipeline() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useFiltri();
  const q = useApi('/hub/accounts');
  const owners = useApi('/hub/utenti');
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const [sposta, setSposta] = useState(null);
  const [censiti, setCensiti] = useState(false);
  const righe = useMemo(() => filtra(q.data?.righe || [], f), [q.data, f]);
  if (q.error) return <div className="page"><ErrorBox error={q.error} /></div>;
  if (!q.data) return <div className="page"><Loading /></div>;
  const col = (n) => righe.filter((a) => a.fase_corrente === n);
  const drop = (n) => {
    setOver(null);
    const a = righe.find((x) => x.id === drag); setDrag(null);
    if (!a || a.fase_corrente === n) return;
    if (!canEditKind(user, a.linea)) return toast(`Non gestisci la linea ${LINEE[a.linea].label}`, 'err');
    if (n === 7 && !a.cliente_attivo) return toast('La fase 7 richiede il cliente attivo: lo imposta il CEO o un Admin del modulo dalla scheda account', 'err');
    setSposta({ a, n, data: today(), nota: '' });
  };
  const conferma = async () => {
    try { await api.put(`/hub/accounts/${sposta.a.id}/fase`, { fase: sposta.n, data: sposta.data, nota: sposta.nota }); toast(`${sposta.a.org_name}: ${FASI[sposta.n].label}`); setSposta(null); q.reload(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const tot = (l) => l.reduce((s, a) => s + Number(a.fatturato_fy_atteso || 0), 0);
  const colonna = (n) => {
    const l = col(n);
    const vis = n === 0 && !censiti ? [] : n === 0 ? l.slice(0, 120) : l;
    return (
      <div key={n} className={`kcol ${over === n ? 'over' : ''} ${n === 0 ? 'k0' : ''} ${n === 0 && !censiti ? 'chiusa' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(n); }} onDragLeave={() => setOver((o) => (o === n ? null : o))} onDrop={() => drop(n)}>
        <div className="khd">
          <div><span className="kt">{FASI[n].short}</span><span className="kn">{l.length}</span></div>
          {n > 0 ? <div className="small muted">{tot(l) ? eurK(tot(l)) : '–'}</div> : <button className="btn link small" onClick={() => setCensiti((x) => !x)}>{censiti ? 'Ripiega' : 'Mostra'}</button>}
        </div>
        <div className="kbody">
          {vis.map((a) => (
            <div key={a.id} className={`kcard ${a.stallo ? 'stallo' : ''}`} draggable onDragStart={() => setDrag(a.id)} onDragEnd={() => { setDrag(null); setOver(null); }} onClick={() => nav(`${BASE}/account/${a.id}`)}>
              <div className="kname">{a.org_name}</div>{a.punto_nome && a.punto_nome !== a.org_name ? <div className="small muted">{a.punto_nome}</div> : null}
              <div className="kmeta">{[a.citta, a.prov && `(${a.prov})`].filter(Boolean).join(' ')}{a.n_sedi > 0 ? ` · ${a.n_sedi} strutture` : ''}</div>
              <div className="kbadges">
                <Badge tone={LINEE[a.linea].tone}>{LINEE[a.linea].short}</Badge>
                {a.priorita && <Badge tone={PRIORITA[a.priorita].tone}>{PRIORITA[a.priorita].label}</Badge>}
                {a.stallo && <Badge tone="red">stallo {a.giorni_da_avanzamento} gg</Badge>}
                {a.da_confermare && <Badge tone="mauve">attivo? da confermare</Badge>}
                {a.cliente_attivo && <Badge tone="teal">cliente attivo</Badge>}
              </div>
              <div className="kfoot"><span>{a.fatturato_fy_atteso ? eurK(a.fatturato_fy_atteso) : ''}</span><span className="muted">{a.owner_name || ''}</span></div>
              {a.prossima_azione && <div className={`small ${a.azione_scaduta ? 'red' : 'muted'}`}>→ {a.prossima_azione}{a.data_prossima_azione ? ` (${itDate(a.data_prossima_azione)})` : ''}</div>}
            </div>
          ))}
          {n === 0 && censiti && l.length > vis.length && <div className="small muted" style={{ padding: 8 }}>Altri {l.length - vis.length}: usa la ricerca o <Link to={`${BASE}/clienti?linea=${f.linea}&fase=0`}>l'elenco</Link></div>}
          {n === 0 && !censiti && <div className="small muted" style={{ padding: 10 }}>{l.length} strutture censite senza contatti. Trascina qui per riportare un account a prospect.</div>}
        </div>
      </div>
    );
  };
  return (
    <div className="page wide">
      <div className="page-head">
        <div><h1>Pipeline · {LINEE[f.linea].label}</h1><div className="sub">Trascina una scheda nella fase raggiunta: la data e il passaggio finiscono nel diario dell'account. Stallo = nessun avanzamento da oltre {q.data.soglia_stallo} giorni.</div></div>
        <Link className="btn" to={`${BASE}/clienti?linea=${f.linea}&nuovo=1`}>+ Nuovo prospect</Link>
      </div>
      <FiltriAccount f={f} setF={setF} righe={q.data.righe} owners={owners.data || []} />
      <div className="kanban">{FASI.map((x) => colonna(x.n))}</div>
      {sposta && <Modal title={`${sposta.a.org_name}: ${FASI[sposta.a.fase_corrente].label} → ${FASI[sposta.n].label}`} onClose={() => setSposta(null)} footer={<><button className="btn ghost" onClick={() => setSposta(null)}>Annulla</button><button className="btn" onClick={conferma}>Registra l'avanzamento</button></>}>
        {sposta.n < sposta.a.fase_corrente && <div className="alert warn small" style={{ marginBottom: 10 }}>Ritorno a una fase precedente: le date delle fasi successive si tolgono e restano nel diario.</div>}
        <div className="form-grid">
          {sposta.n > 0 && <Field label={`Data della fase "${FASI[sposta.n].label}"`}><input type="date" value={sposta.data} onChange={(e) => setSposta({ ...sposta, data: e.target.value })} /></Field>}
          <Field label="Nota (facoltativa)" className="span2"><textarea value={sposta.nota} onChange={(e) => setSposta({ ...sposta, nota: e.target.value })} placeholder="Cosa è successo" /></Field>
        </div>
      </Modal>}
    </div>
  );
}

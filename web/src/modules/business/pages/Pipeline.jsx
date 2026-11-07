// Business Hub · Pipeline: kanban a 7 colonne (più i prospect censiti, ripiegati) con trascinamento tra le fasi. Il rilascio chiede la
// data della fase (oggi per default) e registra l'attività di avanzamento nel diario. La fase 7 richiede il cliente attivo.
import React, { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, BASE } from '../api.js';
import { StampaDB } from '../components/StampaDB.jsx';
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
  const [censiti, setCensiti] = useState(true);
  // Censiti (fase 0): si vedono TUTTI, in righe compatte raggruppate (provincia, tipologia, priorità o alfabeto), gruppi ripiegabili.
  // Il CEO (07/11/2026): "devo poterli vedere tutti, la ricerca è stupida se non ricordo i nomi".
  const [gruppo, setGruppo] = useState(() => { try { return localStorage.getItem('hub.censiti.gruppo') || 'prov'; } catch { return 'prov'; } });
  const [chiusi, setChiusi] = useState({});
  const cambiaGruppo = (g) => { setGruppo(g); setChiusi({}); try { localStorage.setItem('hub.censiti.gruppo', g); } catch { /* niente */ } };
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
    const vis = n === 0 ? [] : l;
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
          {n === 0 && censiti && <Censiti l={l} gruppo={gruppo} setGruppo={cambiaGruppo} chiusi={chiusi} setChiusi={setChiusi} setDrag={setDrag} setOver={setOver} nav={nav} />}
          {n === 0 && !censiti && <div className="small muted" style={{ padding: 10 }}>{l.length} strutture censite senza contatti. Trascina qui per riportare un account a prospect.</div>}
        </div>
      </div>
    );
  };
  return (
    <div className="page wide">
      <div className="page-head">
        <div><h1>Pipeline · {LINEE[f.linea].label}</h1><div className="sub">Trascina una scheda nella fase raggiunta: la data e il passaggio finiscono nel diario dell'account. Stallo = nessun avanzamento da oltre {q.data.soglia_stallo} giorni.</div></div>
        <div className="row" style={{ gap: 6 }}>
          <StampaDB righe={righe} f={f} />
          <Link className="btn" to={`${BASE}/clienti?linea=${f.linea}&nuovo=1`}>+ Nuovo prospect</Link>
        </div>
      </div>
      <FiltriAccount f={f} setF={setF} righe={q.data.righe} owners={owners.data || []} />
      <div className={`kanban ${censiti ? 'censiti-aperti' : ''}`}>{FASI.map((x) => colonna(x.n))}</div>
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

// Elenco completo dei censiti in righe compatte, raggruppate e ripiegabili; ogni riga si trascina in una fase come una scheda.
const GRUPPI = { prov: 'Provincia', tipologia: 'Tipologia', priorita: 'Priorità', alfa: 'Alfabetico' };
const ORD_PRIO = { ALTA: 0, MEDIA: 1, BASSA: 2 };
function Censiti({ l, gruppo, setGruppo, chiusi, setChiusi, setDrag, setOver, nav }) {
  const chiave = (a) => gruppo === 'prov' ? (a.prov ? a.prov.toUpperCase() : 'Provincia non indicata')
    : gruppo === 'tipologia' ? (a.tipologia || 'Tipologia non indicata')
      : gruppo === 'priorita' ? (a.priorita ? PRIORITA[a.priorita]?.label || a.priorita : 'Senza priorità')
        : (a.org_name || '?').trim().charAt(0).toUpperCase().replace(/[^A-Z]/, '#');
  const m = new Map();
  for (const a of l) { const k = chiave(a); if (!m.has(k)) m.set(k, []); m.get(k).push(a); }
  const gruppi = [...m.entries()].sort((x, y) => gruppo === 'priorita' ? (ORD_PRIO[l.find((a) => chiave(a) === x[0])?.priorita] ?? 9) - (ORD_PRIO[l.find((a) => chiave(a) === y[0])?.priorita] ?? 9) : x[0].localeCompare(y[0]));
  for (const [, v] of gruppi) v.sort((a, b) => (a.citta || '').localeCompare(b.citta || '') || a.org_name.localeCompare(b.org_name));
  const tutti = (aperti) => setChiusi(aperti ? {} : Object.fromEntries(gruppi.map(([k]) => [k, true])));
  return (
    <div className="censiti">
      <div className="ctool">
        <select value={gruppo} onChange={(e) => setGruppo(e.target.value)} title="Raggruppa per">{Object.entries(GRUPPI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <button className="btn link small" onClick={() => tutti(true)}>Apri tutti</button>
        <button className="btn link small" onClick={() => tutti(false)}>Chiudi tutti</button>
      </div>
      {gruppi.length === 0 && <div className="small muted" style={{ padding: 8 }}>Nessun censito con i filtri attuali.</div>}
      {gruppi.map(([k, v]) => (
        <div key={k} className="cgrp">
          <button className="cghd" onClick={() => setChiusi((c) => ({ ...c, [k]: !c[k] }))} aria-expanded={!chiusi[k]}><span className="car">{chiusi[k] ? '▸' : '▾'}</span><span className="ct">{k}</span><span className="kn">{v.length}</span></button>
          {!chiusi[k] && v.map((a) => (
            <div key={a.id} className={`crow ${a.stallo ? 'stallo' : ''}`} draggable onDragStart={() => setDrag(a.id)} onDragEnd={() => { setDrag(null); setOver(null); }} onClick={() => nav(`${BASE}/account/${a.id}`)} title={[a.tipologia, a.segmento_lab, a.gruppo && `gruppo ${a.gruppo}`].filter(Boolean).join(' · ')}>
              <div className="cn">{a.org_name}</div>
              <div className="cm">{[a.citta, gruppo !== 'prov' && a.prov && `(${a.prov})`].filter(Boolean).join(' ')}{a.n_sedi > 0 ? ` · ${a.n_sedi} strutture` : ''}</div>
              {a.priorita && gruppo !== 'priorita' && <Badge tone={PRIORITA[a.priorita].tone}>{PRIORITA[a.priorita].label}</Badge>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}


// Business Hub · Pipeline (ridisegnata il 07/11/2026 sulla bozza approvata dal CEO): pannello laterale dei censiti (tutti, in righe
// compatte raggruppate per provincia, tipologia, priorità o alfabeto, con salto rapido e pallino di priorità; si nasconde) e kanban
// delle 7 fasi con schede compatte (nome, città e importo sulla stessa riga, priorità, stallo, "da confermare"), barra proporzionale al
// fatturato della fase, nessun badge di linea (la sezione è già della linea). Trascinamento tra le fasi: il rilascio chiede la data
// (oggi per default) e registra l'avanzamento nel diario. La fase 7 richiede il cliente attivo. Elimina dalla scheda account (Admin).
import React, { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, BASE } from '../api.js';
import { StampaDB } from '../components/StampaDB.jsx';
import { useAuth, canEditKind } from '../auth.jsx';
import { useApi, Loading, ErrorBox, Modal, Field, useToast } from '../components/ui.jsx';
import { FASI, LINEE, PRIORITA, itDate, today } from '../format.js';
import { useFiltri, filtra } from './Clienti.jsx';

const kE = (n) => (n == null || !Number(n) ? '' : Number(n) >= 1000 ? `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(Number(n) / 1000)} k€` : `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(Number(n))} €`);
const eur = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n || 0));
const GRUPPI = { prov: 'Provincia', tipologia: 'Tipologia', priorita: 'Priorità', alfa: 'A–Z' };
const ORD_PRIO = { ALTA: 0, MEDIA: 1, BASSA: 2 };
const NOMI_PROV = { AR: 'Arezzo', FI: 'Firenze', GR: 'Grosseto', LI: 'Livorno', LU: 'Lucca', MS: 'Massa-Carrara', PI: 'Pisa', PO: 'Prato', PT: 'Pistoia', SI: 'Siena' };

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
  const [pannello, setPannello] = useState(() => { try { return localStorage.getItem('hub.censiti.pannello') !== '0'; } catch { return true; } });
  const [gruppo, setGruppo] = useState(() => { try { return localStorage.getItem('hub.censiti.gruppo') || 'prov'; } catch { return 'prov'; } });
  const mostraPannello = (v) => { setPannello(v); try { localStorage.setItem('hub.censiti.pannello', v ? '1' : '0'); } catch { /* niente */ } };
  const cambiaGruppo = (g) => { setGruppo(g); try { localStorage.setItem('hub.censiti.gruppo', g); } catch { /* niente */ } };
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
  const fasi = FASI.filter((x) => x.n > 0);
  const maxTot = Math.max(1, ...fasi.map((x) => tot(col(x.n))));
  const dnd = (n) => ({ onDragOver: (e) => { e.preventDefault(); setOver(n); }, onDragLeave: () => setOver((o) => (o === n ? null : o)), onDrop: () => drop(n) });
  const trascina = (a) => ({ draggable: true, onDragStart: () => setDrag(a.id), onDragEnd: () => { setDrag(null); setOver(null); } });
  const censiti = col(0);
  const prov = [...new Set(q.data.righe.filter((a) => a.linea === f.linea).map((a) => a.prov).filter(Boolean))].sort();
  const segmenti = [...new Set(q.data.righe.filter((a) => a.linea === f.linea).map((a) => a.segmento_lab).filter(Boolean))].sort();
  const attivi = ['q', 'priorita', 'owner', 'prov', 'segmento', 'stallo', 'fase', 'attivo'].some((k) => f[k]);
  return (
    <div className="page wide pipe">
      <div className="page-head">
        <div><h1>Pipeline · {LINEE[f.linea].label}</h1><div className="sub">Trascina una scheda nella fase raggiunta: la data e il passaggio finiscono nel diario dell'account. Stallo = nessun avanzamento da oltre {q.data.soglia_stallo} giorni.</div></div>
        <div className="row" style={{ gap: 6 }}>
          <StampaDB righe={righe} f={f} />
          <Link className="btn" to={`${BASE}/clienti?linea=${f.linea}&nuovo=1`}>+ Nuovo prospect</Link>
        </div>
      </div>

      <div className="pipe-filtri">
        <input value={f.q} onChange={(e) => setF({ q: e.target.value })} placeholder="Cerca nome, gruppo, città" />
        <div className="seg">{[['', 'Tutte'], ...Object.entries(PRIORITA).map(([k, v]) => [k, v.label])].map(([k, l]) => <label key={k} className={f.priorita === k ? 'on' : ''}><input type="radio" checked={f.priorita === k} onChange={() => setF({ priorita: k })} />{l}</label>)}</div>
        <select value={f.owner} onChange={(e) => setF({ owner: e.target.value })}><option value="">Owner: tutti</option>{(owners.data || []).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
        <select value={f.prov} onChange={(e) => setF({ prov: e.target.value })}><option value="">Provincia: tutte</option>{prov.map((p) => <option key={p} value={p}>{NOMI_PROV[p] || p}</option>)}</select>
        <select value={f.segmento} onChange={(e) => setF({ segmento: e.target.value })}><option value="">Segmento: tutti</option>{segmenti.map((s) => <option key={s}>{s}</option>)}</select>
        <label className="chk"><input type="checkbox" checked={f.stallo === '1'} onChange={(e) => setF({ stallo: e.target.checked ? '1' : '' })} />Solo in stallo</label>
        {attivi && <button className="btn link small" onClick={() => setF({ q: '', priorita: '', owner: '', prov: '', segmento: '', stallo: '', fase: '', attivo: '' })}>Azzera filtri</button>}
      </div>

      <div className={`pipe-layout ${pannello ? 'con-pannello' : ''}`}>
        {pannello
          ? <Censiti l={censiti} gruppo={gruppo} setGruppo={cambiaGruppo} dnd={dnd(0)} over={over === 0} trascina={trascina} nav={nav} onNascondi={() => mostraPannello(false)} />
          : <button className="pipe-apri" {...dnd(0)} onClick={() => mostraPannello(true)} title="Mostra i censiti"><span className="n">{censiti.length}</span><span className="t">Censiti ›</span></button>}
        <div className="kan">
          {fasi.map((x) => { const l = col(x.n); const t = tot(l); return (
            <div key={x.n} className={`kcol ${over === x.n ? 'over' : ''}`} {...dnd(x.n)}>
              <div className="khd">
                <div className="kt"><span>{x.n}. {x.label}</span><span className="kn">{l.length}</span></div>
                <div className="ke">{t ? eur(t) : '–'}</div>
                <div className="kbar"><i className={x.n === 7 ? 'ok' : ''} style={{ width: `${Math.round((t / maxTot) * 100)}%` }} /></div>
              </div>
              <div className="kbody">
                {l.map((a) => (
                  <div key={a.id} className={`kcard ${a.stallo ? 'stallo' : ''} ${a.cliente_attivo ? 'attivo' : ''}`} {...trascina(a)} onClick={() => nav(`${BASE}/account/${a.id}`)}>
                    <div className="kname">{a.org_name}{a.punto_nome && a.punto_nome !== a.org_name ? <span className="muted"> · {a.punto_nome}</span> : null}</div>
                    <div className="kmeta"><span>{[a.citta, a.prov && `(${a.prov})`].filter(Boolean).join(' ')}{a.n_sedi > 0 ? ` · ${a.n_sedi} str.` : ''}</span><b>{kE(a.fatturato_fy_atteso)}</b></div>
                    <div className="kfoot">
                      {a.priorita && <span className={`pill p-${a.priorita.toLowerCase()}`}>{PRIORITA[a.priorita].label}</span>}
                      {a.stallo && <span className="red">stallo {a.giorni_da_avanzamento} gg</span>}
                      {a.da_confermare && <span className="pill p-silk">attivo? da confermare</span>}
                      {a.cliente_attivo && <span className="pill p-ok">cliente attivo</span>}
                      {a.owner_name && <span className="muted ow">{a.owner_name}</span>}
                    </div>
                    {a.prossima_azione && <div className={`small ${a.azione_scaduta ? 'red' : 'muted'}`}>→ {a.prossima_azione}{a.data_prossima_azione ? ` (${itDate(a.data_prossima_azione)})` : ''}</div>}
                  </div>
                ))}
                {!l.length && <div className="kvuota">Nessun account</div>}
              </div>
            </div>
          ); })}
        </div>
      </div>

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

// Pannello dei censiti: tutti, raggruppati; salto rapido ai gruppi; ogni riga si trascina in una fase come una scheda.
function Censiti({ l, gruppo, setGruppo, dnd, over, trascina, nav, onNascondi }) {
  const chiave = (a) => gruppo === 'prov' ? (a.prov ? a.prov.toUpperCase() : '—')
    : gruppo === 'tipologia' ? (a.tipologia || 'Tipologia non indicata')
      : gruppo === 'priorita' ? (a.priorita ? PRIORITA[a.priorita]?.label || a.priorita : 'Senza priorità')
        : (a.org_name || '?').trim().charAt(0).toUpperCase().replace(/[^A-Z]/, '#');
  const etichetta = (k) => (gruppo === 'prov' ? (k === '—' ? 'Provincia non indicata' : NOMI_PROV[k] || k) : k);
  const m = new Map();
  for (const a of l) { const k = chiave(a); if (!m.has(k)) m.set(k, []); m.get(k).push(a); }
  const gruppi = [...m.entries()].sort((x, y) => gruppo === 'priorita' ? (ORD_PRIO[x[1][0]?.priorita] ?? 9) - (ORD_PRIO[y[1][0]?.priorita] ?? 9) : x[0].localeCompare(y[0]));
  for (const [, v] of gruppi) v.sort((a, b) => (a.citta || '').localeCompare(b.citta || '') || a.org_name.localeCompare(b.org_name));
  const salta = (k) => document.getElementById(`cens-${k}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  return (
    <aside className={`cens ${over ? 'over' : ''}`} {...dnd}>
      <div className="ch"><div><b>Censiti</b><span className="kn">{l.length}</span></div><button className="btn link small" onClick={onNascondi}>Nascondi ‹</button></div>
      <div className="ctabs">{Object.entries(GRUPPI).map(([k, v]) => <button key={k} className={gruppo === k ? 'on' : ''} onClick={() => setGruppo(k)}>{v}</button>)}</div>
      {gruppi.length > 1 && <div className="csalta">{gruppi.map(([k, v]) => <button key={k} onClick={() => salta(k)}>{k === '—' ? 'n.d.' : k.length > 14 ? `${k.slice(0, 13)}…` : k} <span>{v.length}</span></button>)}</div>}
      <div className="clist">
        {gruppi.length === 0 && <div className="kvuota">Nessun censito con i filtri attuali.</div>}
        {gruppi.map(([k, v]) => (
          <div key={k} id={`cens-${k}`}>
            <div className="cg"><span>{etichetta(k)}</span><span>{v.length}</span></div>
            {v.map((a) => (
              <div key={a.id} className="crow" {...trascina(a)} onClick={() => nav(`${BASE}/account/${a.id}`)} title={[a.segmento_lab, a.gruppo && `gruppo ${a.gruppo}`].filter(Boolean).join(' · ')}>
                <div><div className="cn">{a.org_name}</div><div className="cm">{[a.citta, gruppo !== 'tipologia' && a.tipologia, a.n_sedi > 0 && `${a.n_sedi} strutture`].filter(Boolean).join(' · ')}</div></div>
                {a.priorita && <i className={`dot d-${a.priorita.toLowerCase()}`} title={`Priorità ${PRIORITA[a.priorita].label.toLowerCase()}`} />}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="cleg"><i className="dot d-alta" /> alta <i className="dot d-media" /> media <i className="dot d-bassa" /> bassa priorità · trascina una riga in una fase</div>
    </aside>
  );
}

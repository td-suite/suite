// Barra "Visualizza come" del personale TD (richiesta del CEO, 01/11/2026: "se ci clicca un utente di TD, fai scegliere con quale legal
// entity visualizzare, altrimenti versione standard come Toscana Diagnostica S.r.l."). Sottile, sopra il contenuto del portale, con le classi
// del sito (.btn, .searchbox, .badge). Elenco: Legal entity CLIENTE con almeno una sede SERVICE attiva (GET /api/service/clienti).
// Scelta: ?org=<id> (link condivisibile) e sessionStorage (vista.js); ?scegli=1 apre il selettore (dal menu della card in Home).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApi } from '../../../components/ui.jsx';
import { salvaVista } from '../vista.js';
import { base, norm } from '../dati.js';
import { Ico, Ricerca } from './comuni.jsx';

const STANDARD = 'Toscana Diagnostica S.r.l.';

export default function VistaCome({ vista, onScelta }) {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [aperto, setAperto] = useState(params.get('scegli') === '1');
  const [q, setQ] = useState('');
  const clienti = useApi('/service/clienti');
  const rif = useRef(null);
  const elenco = clienti.data || [];
  const scelta = vista ? (elenco.find((c) => c.id === vista.id) || { id: vista.id, name: vista.name || `Legal entity ${vista.id}` }) : null;
  // il nome arriva dall'elenco anche quando la vista nasce da un link condiviso (?org=<id>)
  useEffect(() => { if (vista && !vista.name && scelta?.code !== undefined) { salvaVista(scelta); onScelta({ id: scelta.id, name: scelta.name }); } }, [vista, scelta, onScelta]);
  useEffect(() => {
    if (params.get('scegli') !== '1') return;
    setAperto(true);
    const p = new URLSearchParams(params); p.delete('scegli'); setParams(p, { replace: true });
  }, [params, setParams]);
  useEffect(() => {
    if (!aperto) return undefined;
    const fuori = (e) => { if (rif.current && !rif.current.contains(e.target)) setAperto(false); };
    const esc = (e) => e.key === 'Escape' && setAperto(false);
    document.addEventListener('mousedown', fuori); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fuori); document.removeEventListener('keydown', esc); };
  }, [aperto]);
  const filtrati = useMemo(() => {
    const t = norm(q).split(/\s+/).filter(Boolean);
    return elenco.filter((c) => t.every((x) => norm(`${c.name} ${c.code || ''} ${c.city || ''}`).includes(x)));
  }, [elenco, q]);

  const scegli = (c) => {
    setAperto(false); setQ('');
    if (c) { const v = { id: c.id, name: c.name }; salvaVista(v); onScelta(v); nav(`${base}?org=${c.id}`); }
    else { salvaVista(null); onScelta(null); nav(base); }
  };

  return (
    <div className={`vista-bar${scelta ? ' on' : ''}`} ref={rif}>
      <Ico n="users" s={16} />
      <span className="lbl">Visualizza come:</span>
      <button type="button" className="sel" aria-haspopup="listbox" aria-expanded={aperto} onClick={() => setAperto((x) => !x)}>
        <strong>{scelta ? scelta.name : STANDARD}</strong>{!scelta && <span className="muted"> (standard)</span>}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {scelta && <span className="nota">Vista del personale TD: come la vede il cliente</span>}
      <span className="spacer" />
      {scelta && <button type="button" className="btn sm ghost" onClick={() => scegli(null)}>Torna alla versione standard</button>}
      {aperto && (
        <div className="vista-pop" role="listbox" aria-label="Legal entity cliente service">
          <Ricerca value={q} onChange={setQ} placeholder="Cerca la Legal entity (nome, codice, città)" autoFocus />
          <div className="vista-list">
            <button type="button" className={`vista-item${!scelta ? ' on' : ''}`} role="option" aria-selected={!scelta} onClick={() => scegli(null)}>
              <span className="nome">{STANDARD}</span><span className="badge b-grey">standard</span>
            </button>
            {clienti.loading && <div className="small muted" style={{ padding: '8px 12px' }}>Carico le Legal entity…</div>}
            {clienti.error && <div className="small muted" style={{ padding: '8px 12px' }}>Elenco non disponibile: {clienti.error.message}</div>}
            {filtrati.map((c) => (
              <button key={c.id} type="button" className={`vista-item${scelta?.id === c.id ? ' on' : ''}`} role="option" aria-selected={scelta?.id === c.id} onClick={() => scegli(c)}>
                <span className="nome">{c.name}{c.city ? <span className="muted"> · {c.city}</span> : null}</span>
                <span className="badge b-teal" title="Sedi SERVICE attive">{c.sedi_service} {c.sedi_service === 1 ? 'punto' : 'punti'}</span>
                <span className="badge b-blue" title="Accessi esterni della Legal entity">{c.accessi_esterni} {c.accessi_esterni === 1 ? 'accesso' : 'accessi'}</span>
              </button>
            ))}
            {!clienti.loading && !filtrati.length && <div className="small muted" style={{ padding: '8px 12px' }}>{elenco.length ? 'Nessuna Legal entity corrisponde alla ricerca.' : 'Nessuna Legal entity cliente service (CLIENTE con sedi SERVICE attive).'}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, BASE } from '../api.js';
import { useAuth, canEdit } from '../auth.jsx';
import { useToast, Loading, ErrorBox } from '../components/ui.jsx';
import IPM from '../lib/ipm-engine.js';

// Il motore GANTT (vanilla JS) disegna nav, cruscotto e schede target dentro #ipm-main; React tiene solo cornice e finestra di stampa.
// Anagrafica unica: le target sono organizzazioni della Suite (tipo Target) e gli owner sono persone della Suite; il motore
// riceve `navigate` per i pulsanti "Apri in Amministrazione" (/admin/organizations, /people/:id).
export default function Plan({ mode }) {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const root = useRef(null);
  const [state, setState] = useState({ loading: true, error: null });
  const [lang, setLang] = useState('it');

  useEffect(() => {
    let alive = true;
    window.__TDI_CLIENT_ID = IPM.clientId;
    IPM.mount({
      root: root.current,
      eventsUrl: `${BASE}/events`,
      api: { get: (u) => api.get(u, { silent: true }), post: api.post, put: api.put, patch: api.patch, del: api.del },
      user,
      readOnly: !canEdit(user) || mode === 'MIRROR',   // in MIRROR le scritture sono bloccate dalla Suite (423)
      roMsg: canEdit(user) && mode === 'MIRROR' ? { it: 'Modulo in collaudo (copia dei dati dell\'app): le modifiche si fanno ancora nell\'app originale.', en: 'Module under test (copy of the app data): changes are still made in the original app.' } : null,
      onToast: (msg, kind) => toast(msg, kind === 'err' ? 'err' : 'ok'),
      navigate: (path) => navigate(path),
      onState: () => {},
    }).then(() => { if (alive) { setLang(IPM.getLang()); setState({ loading: false, error: null }); } })
      .catch((e) => { if (alive) setState({ loading: false, error: e }); });
    return () => { alive = false; IPM.unmount(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchLang = (l) => { IPM.setLang(l); setLang(l); };

  return (
    <div className="page ipm" id="ipm-root" ref={root}>
      <div className="page-head">
        <div>
          <h1>Integration Plan Management</h1>
          <div className="sub">{lang === 'it' ? 'Gestione e coordinamento del piano di integrazione post closing. Le società target e le persone del team vengono dall\'anagrafica unica della Suite; ogni modifica viene salvata subito e condivisa in tempo reale.' : 'Post-closing integration plan management. Target companies and team members come from the Suite shared registry; every change is saved immediately and shared in real time.'}</div>
        </div>
        <div className="lang"><button id="lang-it" className={lang === 'it' ? 'on' : ''} onClick={() => switchLang('it')}>IT</button><button id="lang-en" className={lang === 'en' ? 'on' : ''} onClick={() => switchLang('en')}>EN</button></div>
      </div>
      <ErrorBox error={state.error} />
      {state.loading && !state.error && <Loading text="Caricamento del piano…" />}
      <nav className="nav" id="ipm-nav" />
      <div id="td-banner" />
      <div id="ipm-main" />
      <div className="ipm-modal" id="printmodal">
        <div className="mbox">
          <h3 id="pm_t">Stampa PDF</h3>
          <div className="mrow"><div className="fld"><label id="pm_l1">Perimetro</label>
            <select id="pr_scope" defaultValue="this"><option value="this" id="pm_o1">Questa società</option><option value="all" id="pm_o2">Tutte le società</option></select></div></div>
          <div className="mrow"><div className="fld"><label id="pm_l2">Vista</label>
            <select id="pr_mode" defaultValue="full" onChange={(e) => { document.getElementById('pr_ownrow').style.display = e.target.value === 'owner' ? 'block' : 'none'; }}>
              <option value="full" id="pm_o3">GANTT totale per società</option>
              <option value="owner" id="pm_o4">GANTT per owner (una pagina per persona)</option></select></div></div>
          <div className="mrow" id="pr_ownrow" style={{ display: 'none' }}><div className="fld"><label>Owner</label><select id="pr_owner" /></div></div>
          <div className="mrow" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn ghost" id="pm_c" onClick={() => document.getElementById('printmodal').classList.remove('show')}>Annulla</button>
            <button className="btn canary" id="pm_go" onClick={() => IPM.doPrint()}>Genera e stampa</button>
          </div>
        </div>
      </div>
      <div id="printarea" />
    </div>
  );
}

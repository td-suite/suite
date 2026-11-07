// Cerca nelle rubriche (richiesta del CEO del 07/11/2026): un campo di ricerca che interroga insieme la Suite (persone e referenti
// già presenti), i contatti Outlook di francesco.epifani@ e la rubrica Google di fraepi@gmail.com; i risultati sono raggruppati per
// fonte e il clic compila i campi del form che lo ospita (nome, cognome, email, telefono, cellulare, azienda, ruolo), che restano
// modificabili prima del salvataggio. Si salva solo il contatto scelto: nulla delle rubriche viene copiato in massa nella Suite.
// Usato in: Business Hub > Referenti (nuovo e modifica), Registra contatto (Con chi), Amministrazione > Persone e Legal entity >
// Accessi. Mai nelle pagine pubbliche. Componente autonomo (solo il client API della Suite): funziona anche dentro i moduli.
// SuggerimentoEmail: quando l'email scritta a mano coincide con un contatto Outlook (o Gmail) propone i dati per completare.
import React, { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api.js';
import { Icon } from './Icons.jsx';

export const FONTI = { SUITE: 'Suite', OUTLOOK: 'Outlook', GOOGLE: 'Gmail' };

// stato delle rubriche letto una volta per pagina: null = non disponibile per l'utente (403) o errore
let statoPromessa = null;
function useStatoRubriche() {
  const [s, setS] = useState(undefined);
  useEffect(() => {
    let vivo = true;
    if (!statoPromessa) statoPromessa = api.get('/rubriche/stato', { silent: true }).catch(() => null);
    statoPromessa.then((x) => { if (vivo) setS(x); });
    return () => { vivo = false; };
  }, []);
  return s;
}
export const azzeraStatoRubriche = () => { statoPromessa = null; };

/** Campi pronti per i form a partire da un contatto in formato comune */
export function campiDaContatto(c) {
  const tel = (c.telefoni || []).find((t) => t.tipo !== 'cellulare' && t.tipo !== 'fax')?.numero || '';
  const cell = (c.telefoni || []).find((t) => t.tipo === 'cellulare')?.numero || '';
  return {
    nome: c.nome || '', nome_proprio: c.nome_proprio || '', cognome: c.cognome || '', email: (c.email || [])[0] || '',
    telefono: tel, cellulare: cell, telefoni_testo: [tel, cell && `cell. ${cell}`].filter(Boolean).join(' · ').slice(0, 60),
    azienda: c.azienda || '', ruolo: c.ruolo || '', fonte: c.fonte, origine: c.origine || FONTI[c.fonte] || c.fonte, person_id: c.person_id || null,
  };
}

function Riga({ c, onClick }) {
  const tel = (c.telefoni || []).map((t) => `${t.tipo === 'cellulare' ? 'cell. ' : ''}${t.numero}`).slice(0, 2).join(' · ');
  return (
    <button type="button" className="cr-item" onClick={onClick}>
      <span className="cr-nome">{c.nome}{c.origine && c.fonte === 'SUITE' ? <span className="cr-tag">{c.origine}</span> : null}</span>
      <span className="cr-sub">{[c.azienda, c.ruolo].filter(Boolean).join(' · ')}</span>
      <span className="cr-sub">{[(c.email || [])[0], tel].filter(Boolean).join(' · ') || 'senza email né telefono'}</span>
    </button>
  );
}

export default function CercaRubrica({ onScegli, etichetta = 'Cerca in rubrica', placeholder = 'Nome, cognome, email o azienda', suite = true, autoFocus = false }) {
  const st = useStatoRubriche();
  const [testo, setTesto] = useState('');
  const [res, setRes] = useState(null);
  const [errore, setErrore] = useState(null);
  const [carica, setCarica] = useState(false);
  const [scelto, setScelto] = useState(null);
  const ultimo = useRef(0);
  const idInput = useId();
  useEffect(() => {
    const t = testo.trim();
    if (t.length < 2) { setRes(null); setErrore(null); return undefined; }
    const n = ++ultimo.current;
    const h = setTimeout(async () => {
      setCarica(true);
      try { const r = await api.get(`/rubriche/cerca?q=${encodeURIComponent(t)}${suite ? '' : '&suite=0'}`, { silent: true }); if (n === ultimo.current) { setRes(r); setErrore(null); } }
      catch (e) { if (n === ultimo.current) { setRes(null); setErrore(e.message); } }
      finally { if (n === ultimo.current) setCarica(false); }
    }, 350);
    return () => clearTimeout(h);
  }, [testo, suite]);
  if (st === undefined || st === null) return null;   // in caricamento, oppure rubriche non disponibili per questo utente
  const scegli = (c) => { const campi = campiDaContatto(c); setScelto(campi); setTesto(''); setRes(null); onScegli?.(campi, c); };
  const gruppi = [suite && ['suite', 'Suite', 'persone e referenti già presenti'], ['outlook', 'Outlook', st.outlook?.casella], ['google', 'Gmail', st.google?.account || st.google?.account_atteso]].filter(Boolean);
  const vuoto = res && gruppi.every(([k]) => !(res[k] || []).length);
  return (
    <div className="cr-box" onKeyDown={(e) => { if (e.key === 'Escape' && res) { e.stopPropagation(); setRes(null); } }}>
      <label className="cr-label" htmlFor={idInput}><Icon name="search" />{etichetta}<span className="cr-fonti">{gruppi.map(([k, l]) => <span key={k} className={`cr-fonte ${k === 'suite' || st[k]?.configurata ? 'on' : 'off'}`} title={k !== 'suite' && !st[k]?.configurata ? st[k]?.errore || 'non configurata' : ''}>{l}</span>)}</span></label>
      <input id={idInput} type="search" value={testo} onChange={(e) => setTesto(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} autoComplete="off" aria-label={etichetta}
        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
      {carica && <div className="cr-nota">Ricerca in corso…</div>}
      {errore && <div className="cr-nota cr-err">{errore}</div>}
      {res && <div className="cr-res" role="listbox" aria-label="Risultati delle rubriche">
        {gruppi.map(([k, l, dett]) => (
          <div key={k} className="cr-grp">
            <div className="cr-grp-h"><span>{l}</span>{dett && <span className="cr-grp-d">{dett}</span>}<span className="cr-n">{(res[k] || []).length}</span></div>
            {(res[k] || []).map((c) => <Riga key={c.id} c={c} onClick={() => scegli(c)} />)}
            {!(res[k] || []).length && <div className="cr-nota">{res.errori?.[k] || 'Nessun contatto'}</div>}
          </div>
        ))}
        {vuoto && <div className="cr-nota">Nessun risultato per "{res.q}": compila i campi a mano.</div>}
      </div>}
      {scelto && !res && <div className="cr-scelto"><Icon name="check" />Campi compilati da {scelto.origine}: <b>{scelto.nome}</b>. Controlla e modifica prima di salvare.</div>}
    </div>
  );
}

/** Avviso "trovato in Outlook" sotto un campo email scritto a mano, con il pulsante per completare gli altri campi */
export function SuggerimentoEmail({ email, onCompleta }) {
  const st = useStatoRubriche();
  const [c, setC] = useState(null);
  const [usato, setUsato] = useState('');
  useEffect(() => {
    const e = String(email || '').trim().toLowerCase();
    setC(null);
    if (!st || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e) || e === usato) return undefined;
    let vivo = true;
    const h = setTimeout(async () => { try { const r = await api.get(`/rubriche/email?indirizzo=${encodeURIComponent(e)}`, { silent: true }); if (vivo) setC(r.trovato); } catch { /* rubriche non raggiungibili: nessun avviso */ } }, 600);
    return () => { vivo = false; clearTimeout(h); };
  }, [email, st, usato]);
  if (!c) return null;
  const tel = (c.telefoni || []).map((t) => `${t.tipo === 'cellulare' ? 'cell. ' : ''}${t.numero}`).slice(0, 2).join(' · ');
  return (
    <div className="cr-trovato">
      <Icon name="info" /><span>Trovato in {FONTI[c.fonte] || c.fonte}: <b>{c.nome}</b>{[c.azienda, c.ruolo, tel].filter(Boolean).length ? ` · ${[c.azienda, c.ruolo, tel].filter(Boolean).join(' · ')}` : ''}</span>
      <button type="button" className="cr-btn" onClick={() => { setUsato(String(email).trim().toLowerCase()); setC(null); onCompleta?.(campiDaContatto(c), c); }}>Completa i campi</button>
    </div>
  );
}

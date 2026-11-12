// Lab Control · componenti comuni: formati (date locali del gestionale, ore, euro), barra delle fasi, linea del tempo, nome del cliente con
// il menu dei collegamenti (Business Hub, Retail, Listino, Ordini, NC, Lab Control: link costruiti e verificati dal server), "copia
// aggiornata alle", filtri (cliente, sede, periodo), stato di Lab Control (GET /lab/stato).
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Popover } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { api, useApi, qs, base } from '../api.js';

// ---------------------------------------------------------------- formati
// le date *AtLocal del gestionale sono già in ora di Roma ("AAAA-MM-GGTHH:MM:SS"): si formattano senza conversioni di fuso
export const gg = (d) => (d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}/${String(d).slice(0, 4)}` : '');
export const ggBreve = (d) => (d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}` : '');
export const ora = (t) => (t ? String(t).slice(11, 16) : '');
export const dataOra = (t, oggi = null) => (!t ? '' : oggi && String(t).slice(0, 10) === oggi ? `oggi ${ora(t)}` : `${ggBreve(t)} ${ora(t)}`);
export const durata = (min) => {
  if (min == null) return '';
  const m = Math.max(0, Math.round(Number(min)));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 48) return r && h < 10 ? `${h} h ${r} min` : `${h} h`;
  const g = Math.floor(h / 24), hh = h % 24;
  return hh ? `${g} g ${hh} h` : `${g} g`;
};
export const ore = (v) => (v == null ? '–' : `${Number(v).toLocaleString('it-IT', { maximumFractionDigits: 1 })} h`);
export const eur = (v) => (v == null ? '–' : Number(v).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }));
export const num = (v) => (v == null ? '–' : Number(v).toLocaleString('it-IT'));
export const pct = (v) => (v == null ? '–' : `${Number(v).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`);
/** "aggiornata alle 14:05" (oggi) oppure "aggiornata al 11/11 14:05", da un istante ISO (UTC) */
export function aggiornata(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const o = d.toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' });
  const g = d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  const oggi = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  return g === oggi ? `alle ${o}` : `al ${gg(g)} ${o}`;
}

/** Stato di Lab Control (sedi del filtro, fasi, soglie, copia): una lettura per pagina. */
export const useStatoLab = () => useApi('/lab/stato');

/** "Copia Synclab aggiornata alle HH:MM" (fonte dei dati, delta orario di giorno). */
export function CopiaInfo({ copia, extra }) {
  const a = aggiornata(copia?.checkpoint_at);
  return (
    <span className="lc-copia" title="Le accettazioni arrivano dalla copia Synclab della Suite: stati e date si aggiornano ogni ora dalle 7 alle 21">
      <Icon name="refresh" />{a ? `Copia Synclab aggiornata ${a}` : 'Copia Synclab: nessun aggiornamento registrato'}{extra ? ` · ${extra}` : ''}
    </span>
  );
}

// ---------------------------------------------------------------- fasi
export const FASI_UI = [
  { key: 'PRENOTATA', label: 'Prenotata', breve: 'Prenot.' }, { key: 'ACCETTATA', label: 'Accettata / in attesa', breve: 'Accett.' },
  { key: 'PRELIEVO', label: 'Prelievo eseguito', breve: 'Prelievo' }, { key: 'LAVORAZIONE', label: 'In lavorazione', breve: 'Lavoraz.' },
  { key: 'FIRMA', label: 'In firma', breve: 'Firma' }, { key: 'REFERTO', label: 'Referto pronto', breve: 'Referto' }, { key: 'CHIUSO', label: 'Chiuso', breve: 'Chiuso' },
];

/** Barra a 7 tacche della fase (compatta per l'elenco): tacche piene fino alla fase corrente; NC (11) rossa fuori linea. */
export function FaseBar({ fase, tappe, compatta = false }) {
  if (!fase) return null;
  const idx = fase.indice;
  if (fase.key === 'NC') return <span className="lc-fase nc" title="NC, campione mai arrivato (stato 11)"><span className="lc-tacche nc">{FASI_UI.map((f) => <i key={f.key} />)}</span><b>NC mai arrivato</b></span>;
  return (
    <span className={`lc-fase ${compatta ? 'compatta' : ''}`} title={FASI_UI.map((f, i) => `${i <= (idx ?? -1) ? '●' : '○'} ${f.label}${tappe?.[i]?.data ? ` (${gg(tappe[i].data)} ${ora(tappe[i].data)})` : ''}`).join('\n')}>
      <span className={`lc-tacche f${idx ?? 'x'}`} aria-hidden="true">{FASI_UI.map((f, i) => <i key={f.key} className={idx != null && i < idx ? 'ok' : i === idx ? 'cur' : ''} />)}</span>
      <b>{fase.label}</b>
    </span>
  );
}

/** Linea del tempo delle fasi con date e durate (scheda). */
export function LineaTempo({ fase, oggi }) {
  return (
    <ol className={`lc-linea ${fase.key === 'NC' ? 'nc' : ''}`}>
      {fase.tappe.map((t, i) => (
        <li key={t.key} className={`${t.raggiunta ? 'ok' : ''} ${t.corrente ? 'cur' : ''}`}>
          <span className="pallino" aria-hidden="true">{t.raggiunta && (!t.corrente || t.key === 'CHIUSO') ? <Icon name="check" /> : i + 1}</span>
          <div className="txt">
            <b>{t.label}</b>
            <span>{t.data ? dataOra(t.data, oggi) : t.key === 'PRENOTATA' && t.raggiunta && !t.corrente ? 'nessuna prenotazione distinta' : t.raggiunta ? 'data non fornita dal gestionale' : '–'}</span>
            {t.durata_min != null && <em>{durata(t.durata_min)} alla fase successiva</em>}
          </div>
        </li>
      ))}
      {fase.key === 'NC' && <li className="ncx"><span className="pallino">!</span><div className="txt"><b>NC, campione mai arrivato</b><span>stato 11 del gestionale, fuori dalla linea</span></div></li>}
    </ol>
  );
}

// ---------------------------------------------------------------- cliente con i collegamenti
/**
 * Nome del cliente: il clic apre il Business Hub (link già verificato dal server: row.link_cliente.href); la freccia apre il menu con
 * tutti i collegamenti (GET /lab/collegamenti), con le voci disattivate e il motivo.
 */
export function ClienteLink({ r, nome = null }) {
  const [aperto, setAperto] = useState(false);
  const [dati, setDati] = useState(null);
  const [err, setErr] = useState(null);
  const testo = nome || r.cliente || r.client_code || 'Cliente non indicato';
  const apri = async (e) => {
    e.stopPropagation(); e.preventDefault();
    setAperto((x) => !x);
    if (!dati) { try { setDati(await api.get(`/lab/collegamenti${qs({ instance_id: r.instance_id, client_id: r.client_id })}`, { silent: true })); } catch (x) { setErr(x); } }
  };
  const p = r.link_cliente;
  return (
    <span className="lc-cli" onClick={(e) => e.stopPropagation()}>
      {p?.href ? <Link to={p.href} title={`${p.titolo}: ${testo}`}>{testo}</Link> : <span title={p?.titolo || ''}>{testo}{p?.da_abbinare && <em className="lc-nonabb"> da abbinare</em>}</span>}
      {r.client_id && <button type="button" className="lc-cli-menu" onClick={apri} aria-label={`Collegamenti di ${testo}`} aria-expanded={aperto}><Icon name="chevronDown" /></button>}
      <Popover open={aperto} onClose={() => setAperto(false)} className="lc-pop">
        <Voci dati={dati} err={err} titolo={testo} />
      </Popover>
    </span>
  );
}

/** Voci di un menu di collegamenti (client, sede o accettazione). */
export function Voci({ dati, err, titolo }) {
  if (err) return <div className="lc-pop-msg">{err.message}</div>;
  if (!dati) return <div className="lc-pop-msg">Carico i collegamenti…</div>;
  if (!dati.trovato) return <div className="lc-pop-msg">Nessun collegamento disponibile</div>;
  return (
    <>
      {titolo && <div className="who"><div className="name">{titolo}</div>{dati.client_code && <div className="small muted">Codice StudioLab {dati.client_code}{dati.sede ? ` · ${dati.sede}` : ''}</div>}</div>}
      {dati.voci.flatMap((v) => (v.opzioni?.length ? v.opzioni.map((o) => ({ ...v, etichetta: o.etichetta, href: o.href, chiave: `${v.chiave}-${o.href}` })) : [v])).map((v) => (v.attivo
        ? <Link key={v.chiave} to={v.href}><Icon name="external" />{v.etichetta}</Link>
        : <span key={v.chiave} className="lc-voce-off" title={v.motivo}><Icon name="lock" /><span>{v.etichetta}<small>{v.motivo}</small></span></span>))}
    </>
  );
}

/** Pulsante con il menu dei collegamenti di una sede. */
export function SedeLink({ siteId, nome }) {
  const [aperto, setAperto] = useState(false);
  const [dati, setDati] = useState(null);
  const [err, setErr] = useState(null);
  if (!siteId) return <span className="muted">{nome || 'non abbinata'}</span>;
  const apri = async (e) => {
    e.stopPropagation(); setAperto((x) => !x);
    if (!dati) { try { setDati(await api.get(`/lab/collegamenti${qs({ site: siteId })}`, { silent: true })); } catch (x) { setErr(x); } }
  };
  return (
    <span className="lc-cli" onClick={(e) => e.stopPropagation()}>
      <Link to={`${base}/accettazioni?sede=${siteId}`} title="Accettazioni della sede">{nome}</Link>
      <button type="button" className="lc-cli-menu" onClick={apri} aria-label={`Collegamenti di ${nome}`} aria-expanded={aperto}><Icon name="chevronDown" /></button>
      <Popover open={aperto} onClose={() => setAperto(false)} className="lc-pop"><Voci dati={dati} err={err} titolo={nome} /></Popover>
    </span>
  );
}

// ---------------------------------------------------------------- filtri
export const PERIODI = [
  { value: 'oggi', label: 'Oggi' }, { value: 'ieri', label: 'Ieri' }, { value: '7g', label: '7 giorni' }, { value: '30g', label: '30 giorni' },
  { value: 'mese', label: 'Mese' }, { value: 'intervallo', label: 'Intervallo' },
];

/** Periodo: pulsanti rapidi + date dell'intervallo. f = { periodo, da, a }; onChange(patch). */
export function FiltroPeriodo({ f, onChange, predefinito = '7g', tutto = false }) {
  const v = f.periodo || predefinito;
  return (
    <div className="lc-periodo">
      <div className="seg" role="group" aria-label="Periodo">
        {[...PERIODI, ...(tutto ? [{ value: 'tutto', label: 'Tutto' }] : [])].map((p) => <button key={p.value} type="button" className={v === p.value ? 'on' : ''} onClick={() => onChange({ periodo: p.value, ...(p.value === 'intervallo' ? {} : { da: '', a: '' }) })}>{p.label}</button>)}
      </div>
      {v === 'intervallo' && <span className="lc-date"><input type="date" aria-label="Dal" value={f.da || ''} onChange={(e) => onChange({ da: e.target.value })} /><span>→</span><input type="date" aria-label="Al" value={f.a || ''} onChange={(e) => onChange({ a: e.target.value })} /></span>}
    </div>
  );
}

/** Cliente: ricerca per nome o codice StudioLab (GET /lab/clienti/cerca), con il filtro scelto come etichetta rimovibile. */
export function FiltroCliente({ value, etichetta, onChange }) {
  const [t, setT] = useState('');
  const [ris, setRis] = useState([]);
  const [aperto, setAperto] = useState(false);
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    if (t.trim().length < 2) { setRis([]); return undefined; }
    timer.current = setTimeout(async () => { try { setRis(await api.get(`/lab/clienti/cerca${qs({ q: t.trim() })}`, { silent: true })); setAperto(true); } catch { setRis([]); } }, 220);
    return () => clearTimeout(timer.current);
  }, [t]);
  if (value) return <span className="lc-chip" title="Filtro cliente">{etichetta || value}<button type="button" onClick={() => onChange('', null)} aria-label="Togli il filtro cliente"><Icon name="x" /></button></span>;
  return (
    <span className="lc-clicerca">
      <input type="search" value={t} onChange={(e) => setT(e.target.value)} onFocus={() => ris.length && setAperto(true)} placeholder="Cliente (nome o codice StudioLab)" aria-label="Cliente" />
      <Popover open={aperto && ris.length > 0} onClose={() => setAperto(false)} className="lc-pop lc-pop-cli">
        {ris.map((c) => <button key={c.value} type="button" className="item" onClick={() => { onChange(c.value, `${c.cliente}${c.client_code ? ` (${c.client_code})` : ''}`); setT(''); setAperto(false); }}>
          <span><b>{c.cliente}</b><small>{[c.client_code, c.sede, c.org_name && c.org_name !== c.cliente ? c.org_name : null].filter(Boolean).join(' · ')}</small></span></button>)}
      </Popover>
    </span>
  );
}

/** Sede: elenco delle sedi abbinate ai client (nel perimetro). */
export function FiltroSede({ sedi = [], value, onChange, tutte = true }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)} aria-label="Sede" className="lc-sel">
      <option value="">Tutte le sedi</option>
      {sedi.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
      {tutte && <option value="ND">Client senza sede</option>}
    </select>
  );
}

/** Parametri della pagina nell'indirizzo (i link dagli altri widget li impostano): get, set (patch, torna a pagina 1). */
export function useFiltriUrl(sp, setSp) {
  const f = Object.fromEntries(sp.entries());
  const set = (patch, { pagina = true } = {}) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null || v === false) n.delete(k); else n.set(k, String(v)); }
    if (pagina && !('pagina' in patch)) n.delete('pagina');
    setSp(n, { replace: true });
  };
  return [f, set];
}

/** Barre orizzontali semplici (andamento settimanale), senza librerie. */
export function Barre({ righe, valore, etichetta, formato = num, titolo }) {
  const max = Math.max(1, ...righe.map((r) => Number(valore(r)) || 0));
  return (
    <div className="lc-barre" role="img" aria-label={titolo}>
      {righe.map((r, i) => (
        <div key={i} className="riga"><span className="et">{etichetta(r)}</span><span className="bar"><i style={{ width: `${Math.max(1, ((Number(valore(r)) || 0) / max) * 100)}%` }} /></span><span className="v">{formato(valore(r))}</span></div>
      ))}
      {!righe.length && <div className="muted small">Nessun dato nel periodo</div>}
    </div>
  );
}

// Intorno: cosa c'è intorno a una sede o a un indirizzo valutato (richiesta del CEO del 07/11/2026, docs/RETAIL_INTORNO.md).
// Tre numeri di sintesi (concorrenti entro 1 km, prescrittori + attrattori entro 1 km, attrattività con le componenti), mappa Google
// (solo con la chiave browser: senza resta la tabella), tabella filtrabile con export XLSX, storico delle rilevazioni.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Empty, Badge, Kpi, Icon } from './ui.jsx';
import { apiBase } from '../api.js';
import { num, itDate, itDateTime } from '../format.js';

export const STATO_ATTIVITA = { OPERATIONAL: null, CLOSED_TEMPORARILY: { label: 'chiuso temporaneamente', tone: 'mauve' }, CLOSED_PERMANENTLY: { label: 'chiuso definitivamente', tone: 'red' } };
const NOVITA = { NUOVO: { label: 'nuovo', tone: 'green' }, SCOMPARSO: { label: 'scomparso', tone: 'red' }, CAMBIATO: { label: 'cambiato', tone: 'blue' } };
const STATO_RIL = { COMPLETATA: { label: 'completata', tone: 'green' }, PARZIALE: { label: 'parziale', tone: 'mauve' }, INTERROTTA: { label: 'interrotta dal tetto', tone: 'red' }, ERRORE: { label: 'errore', tone: 'red' }, IN_CORSO: { label: 'in corso', tone: 'grey' } };
const ORIGINE = { MANUALE: 'a mano', JOB: 'mensile automatica', VALUTAZIONE: 'indirizzo valutato' };
export const metri = (m) => (m == null ? '–' : m < 1000 ? `${num(m)} m` : `${(m / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} km`);
const punti = (n) => Number(n).toLocaleString('it-IT', { maximumFractionDigits: 1, signDisplay: 'exceptZero' });

// Orari di oggi dalla descrizione settimanale di Google (lunedì per primo)
export function orariOggi(orari) {
  const w = orari?.weekdayDescriptions;
  if (!Array.isArray(w) || w.length < 7) return null;
  const t = w[(new Date().getDay() + 6) % 7] || '';
  return t.replace(/^[^:]+:\s*/, '');
}

/** Punteggio con le componenti: mai il numero da solo */
export function Punteggio({ p, compatto }) {
  if (!p) return <span className="muted">–</span>;
  const comp = p.componenti || [];
  if (compatto) {
    return (
      <span title={p.formula}>
        <b>{punti(p.totale)}</b>
        <span className="small muted"> = {comp.map((c) => `${punti(c.punti)} ${c.categoria === 'CONCORRENTE' ? 'conc.' : c.categoria === 'PRESCRITTORE' ? 'prescr.' : c.categoria === 'ATTRATTORE' ? 'attr.' : 'cont.'}`).join(' ')}</span>
      </span>
    );
  }
  return (
    <div>
      <table className="t small" style={{ marginTop: 4 }}>
        <tbody>{comp.map((c) => <tr key={c.categoria}><td>{c.etichetta}</td><td className="num">{num(c.n)} × {String(c.peso).replace('.', ',')}{c.limitato ? ` (max ${c.massimo})` : ''}</td><td className="num strong">{punti(c.punti)}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={2} className="strong">Attrattività</td><td className="num strong">{punti(p.totale)}</td></tr></tfoot>
      </table>
      <div className="small muted" style={{ marginTop: 6 }}>{p.formula}</div>
    </div>
  );
}

// ---- Mappa Google (Maps JavaScript API, chiave browser dalla config). Lo script si carica una volta sola.
let caricamento = null;
function caricaGoogleMaps(chiave) {
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  if (caricamento) return caricamento;
  caricamento = new Promise((resolve, reject) => {
    const cb = `__tdMappeIntorno${Date.now()}`;
    window[cb] = () => { resolve(window.google.maps); delete window[cb]; };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(chiave)}&v=weekly&language=it&region=IT&loading=async&callback=${cb}`;
    s.async = true;
    s.onerror = () => { caricamento = null; reject(new Error('Mappa Google non caricata (rete o chiave browser)')); };
    document.head.appendChild(s);
  });
  return caricamento;
}
const escapeHtml = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function MappaIntorno({ chiave, centro, luoghi, cerchi, raggio, categorie, sotto, etichetta }) {
  const ref = useRef(null);
  const [errore, setErrore] = useState(null);
  useEffect(() => {
    let annullato = false;
    caricaGoogleMaps(chiave).then((gm) => {
      if (annullato || !ref.current) return;
      const map = new gm.Map(ref.current, { center: centro, zoom: raggio > 5000 ? 12 : 14, mapTypeControl: false, streetViewControl: false, clickableIcons: false });
      const info = new gm.InfoWindow();
      new gm.Marker({ map, position: centro, title: etichetta, zIndex: 1000, icon: { path: gm.SymbolPath.CIRCLE, scale: 9, fillColor: '#01212C', fillOpacity: 1, strokeColor: '#FFFAE3', strokeWeight: 3 } });
      for (const r of [...new Set([...cerchi, raggio])].sort((a, b) => a - b)) {
        new gm.Circle({ map, center: centro, radius: r, strokeColor: '#1C505E', strokeOpacity: 0.55, strokeWeight: r === raggio ? 2 : 1, fillOpacity: 0, clickable: false });
      }
      for (const l of luoghi) {
        if (l.lat == null || l.lng == null) continue;
        const colore = categorie[l.categoria]?.colore || '#666';
        const m = new gm.Marker({ map, position: { lat: l.lat, lng: l.lng }, title: l.nome,
          icon: { path: gm.SymbolPath.CIRCLE, scale: 6, fillColor: colore, fillOpacity: l.presente ? 0.95 : 0.25, strokeColor: '#ffffff', strokeWeight: 1.5 } });
        m.addListener('click', () => {
          const oggi = orariOggi(l.orari);
          info.setContent(`<div style="font:13px/1.4 system-ui,sans-serif;max-width:260px"><b>${escapeHtml(l.nome)}</b><br><span style="color:#5B6F75">${escapeHtml(sotto[l.sottocategoria] || l.sottocategoria)} · ${escapeHtml(metri(l.distanza_m))}</span>`
            + `${l.indirizzo ? `<br>${escapeHtml(l.indirizzo)}` : ''}${l.rating != null ? `<br>★ ${escapeHtml(String(l.rating).replace('.', ','))} (${escapeHtml(l.n_recensioni ?? 0)} recensioni)` : ''}`
            + `${oggi ? `<br>Oggi: ${escapeHtml(oggi)}` : ''}${l.telefono ? `<br>${escapeHtml(l.telefono)}` : ''}${l.sito && /^https?:\/\//.test(l.sito) ? `<br><a href="${escapeHtml(l.sito)}" target="_blank" rel="noopener noreferrer">Sito</a>` : ''}`
            + `${l.novita ? `<br><b>${escapeHtml(NOVITA[l.novita]?.label || '')}</b> rispetto alla rilevazione precedente` : ''}</div>`);
          info.open({ map, anchor: m });
        });
      }
    }).catch((e) => !annullato && setErrore(e.message));
    return () => { annullato = true; };
  }, [chiave, centro.lat, centro.lng, luoghi, raggio]);
  if (errore) return <div className="alert">{errore}: resta la tabella.</div>;
  return <div ref={ref} style={{ height: 460, borderRadius: 10, border: '1px solid var(--line, #dbe5e7)' }} aria-label="Mappa dei luoghi intorno" />;
}

/**
 * @param rilevazione dettaglio (con luoghi) o null
 * @param storico elenco delle rilevazioni dello stesso punto
 * @param config da /intorno/config
 * @param azioni pulsanti (Rileva adesso, …)
 * @param onApri apre una rilevazione dello storico
 */
export default function Intorno({ rilevazione, storico = [], config, azioni, onApri, vuoto }) {
  const [cat, setCat] = useState('');
  const [sc, setSc] = useState('');
  const [entro, setEntro] = useState('');
  const [nov, setNov] = useState('');
  const sotto = useMemo(() => Object.fromEntries((config?.sottocategorie || []).map((s) => [s.chiave, s.etichetta])), [config]);
  const categorie = config?.categorie || {};
  const luoghi = rilevazione?.luoghi || [];
  const filtrati = luoghi.filter((l) => (!cat || l.categoria === cat) && (!sc || l.sottocategoria === sc) && (!entro || (l.distanza_m != null && l.distanza_m <= Number(entro))) && (!nov || (nov === 'NOVITA' ? l.novita : l.novita === nov)));
  const sin = rilevazione?.sintesi?.categorie || {};
  const conf = rilevazione?.confronto;
  const centro = rilevazione ? { lat: Number(rilevazione.lat), lng: Number(rilevazione.lng) } : null;
  if (!rilevazione) {
    return <Card title="Intorno" actions={azioni}>{vuoto || <Empty>Nessuna rilevazione: premi "Rileva adesso".</Empty>}</Card>;
  }
  const pa = (sin.PRESCRITTORE?.entro_1000 || 0) + (sin.ATTRATTORE?.entro_1000 || 0);
  return (
    <div>
      {rilevazione.prova && <div className="alert" style={{ marginBottom: 12 }}><span>Rilevazione con risposte di prova (INTORNO_MOCK): luoghi finti dichiarati di prova, nessun dato reale.</span></div>}
      <div className="grid g3" style={{ marginBottom: 16 }}>
        <Kpi accent label="Concorrenti diretti entro 1 km" value={num(sin.CONCORRENTE?.entro_1000 || 0)} foot={`${num(sin.CONCORRENTE?.entro_500 || 0)} entro 500 m · ${num(sin.CONCORRENTE?.totale || 0)} entro ${metri(rilevazione.raggio_m)}`} />
        <Kpi label="Prescrittori e attrattori entro 1 km" value={num(pa)} foot={`${num(sin.PRESCRITTORE?.entro_1000 || 0)} prescrittori · ${num(sin.ATTRATTORE?.entro_1000 || 0)} attrattori · ${num(sin.CONTESTO?.entro_1000 || 0)} di contesto`} />
        <div className="card kpi"><div className="lbl">Attrattività (componenti)</div><Punteggio p={rilevazione.punteggio} /></div>
      </div>
      <Card title={`Intorno entro ${metri(rilevazione.raggio_m)}`} actions={<>
        <span className="small muted">Rilevazione del {itDate(rilevazione.data)} ({ORIGINE[rilevazione.origine] || rilevazione.origine}{rilevazione.creata_da_nome ? `, ${rilevazione.creata_da_nome}` : ''}) · {num(rilevazione.n_chiamate)} chiamate</span>
        <a className="btn sm ghost" href={`${apiBase}/intorno/rilevazioni/${rilevazione.id}/export.xlsx`}><Icon name="download" />XLSX</a>
        {azioni}
      </>}>
        {rilevazione.stato === 'PARZIALE' && rilevazione.errori && <div className="alert" style={{ marginBottom: 10 }}>Alcune categorie non sono state lette: {Object.entries(rilevazione.errori).map(([k, v]) => `${sotto[k] || k} (${v})`).join('; ')}</div>}
        {conf?.confrontabile ? <p className="small" style={{ marginTop: 0 }}>Rispetto alla rilevazione del {itDate(conf.precedente_data)}: <Badge tone="green">{num(conf.nuovi)} {conf.nuovi === 1 ? 'nuovo' : 'nuovi'}</Badge> <Badge tone="red">{num(conf.scomparsi)} {conf.scomparsi === 1 ? 'scomparso' : 'scomparsi'}</Badge> <Badge tone="blue">{num(conf.cambiati)} {conf.cambiati === 1 ? 'cambiato' : 'cambiati'}</Badge></p>
          : <p className="small muted" style={{ marginTop: 0 }}>Prima rilevazione di questo punto: il confronto (nuovi, scomparsi, cambiati) parte dalla prossima.</p>}
        {config?.chiave_browser && centro
          ? <MappaIntorno chiave={config.chiave_browser} centro={centro} luoghi={filtrati} cerchi={config.cerchi || [500, 1000, 3000]} raggio={rilevazione.raggio_m} categorie={categorie} sotto={sotto} etichetta={rilevazione.etichetta || rilevazione.site_name || ''} />
          : <p className="small muted">Mappa non disponibile: manca la chiave delle mappe nel browser (GOOGLE_MAPS_BROWSER_KEY). Tutti i dati sono nella tabella.</p>}
        <div className="row" style={{ gap: 8, margin: '12px 0', flexWrap: 'wrap', alignItems: 'center' }}>
          {Object.entries(categorie).map(([k, c]) => <span key={k} className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><i style={{ width: 10, height: 10, borderRadius: 10, background: c.colore, display: 'inline-block' }} />{c.etichetta}</span>)}
          <span className="spacer" style={{ flex: 1 }} />
          <select value={cat} onChange={(e) => { setCat(e.target.value); setSc(''); }} style={{ width: 'auto' }} aria-label="Categoria"><option value="">Tutte le categorie</option>{Object.entries(categorie).map(([k, c]) => <option key={k} value={k}>{c.etichetta}</option>)}</select>
          <select value={sc} onChange={(e) => setSc(e.target.value)} style={{ width: 'auto' }} aria-label="Sottocategoria"><option value="">Tutte le sottocategorie</option>{(config?.sottocategorie || []).filter((s) => !cat || s.categoria === cat).map((s) => <option key={s.chiave} value={s.chiave}>{s.etichetta}</option>)}</select>
          <select value={entro} onChange={(e) => setEntro(e.target.value)} style={{ width: 'auto' }} aria-label="Distanza"><option value="">Qualsiasi distanza</option><option value="500">entro 500 m</option><option value="1000">entro 1 km</option><option value="3000">entro 3 km</option></select>
          <select value={nov} onChange={(e) => setNov(e.target.value)} style={{ width: 'auto' }} aria-label="Novità"><option value="">Tutti</option><option value="NOVITA">Solo novità</option><option value="NUOVO">Nuovi</option><option value="SCOMPARSO">Scomparsi</option><option value="CAMBIATO">Cambiati</option></select>
        </div>
        {!filtrati.length ? <Empty>Nessun luogo con questi filtri</Empty> : <div className="table-wrap"><table className="t">
          <thead><tr><th>Luogo</th><th>Categoria</th><th className="num">Distanza</th><th className="num">Rating</th><th className="num">Recensioni</th><th>Oggi</th><th>Contatti</th><th>Stato</th></tr></thead>
          <tbody>{filtrati.map((l) => {
            const st = STATO_ATTIVITA[l.stato_attivita];
            return (
              <tr key={l.place_id} className={l.presente ? '' : 'muted'}>
                <td><div className="strong">{l.nome}</div><div className="small muted">{l.indirizzo || ''}</div></td>
                <td className="small"><i style={{ width: 8, height: 8, borderRadius: 8, background: categorie[l.categoria]?.colore, display: 'inline-block', marginRight: 5 }} />{sotto[l.sottocategoria] || l.sottocategoria}</td>
                <td className="num">{metri(l.distanza_m)}</td>
                <td className="num">{l.rating != null ? String(l.rating).replace('.', ',') : '–'}</td>
                <td className="num">{l.n_recensioni != null ? num(l.n_recensioni) : '–'}</td>
                <td className="small">{orariOggi(l.orari) || <span className="muted">–</span>}</td>
                <td className="small">{l.telefono && <div>{l.telefono}</div>}{l.sito && /^https?:\/\//.test(l.sito) && <a href={l.sito} target="_blank" rel="noopener noreferrer">Sito</a>}</td>
                <td className="small">{l.novita && <Badge tone={NOVITA[l.novita].tone}>{NOVITA[l.novita].label}</Badge>} {st && <Badge tone={st.tone}>{st.label}</Badge>}
                  {l.cambiamenti?.length > 0 && <div className="muted">{l.cambiamenti.map((c) => c.etichetta).join(', ')}</div>}
                  {!l.presente && l.chiuso_at && <div className="muted">dal {itDate(l.chiuso_at)}</div>}
                  {l.presente && l.prima_vista && l.prima_vista !== rilevazione.data && <div className="muted">visto dal {itDate(l.prima_vista)}</div>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>}
        <p className="small muted" style={{ marginBottom: 0 }}>{num(filtrati.length)} luoghi su {num(luoghi.length)}. Dati di Google Places; i luoghi "scomparsi" erano nella rilevazione precedente e non in questa. Fonti per categoria: {(config?.sottocategorie || []).filter((s) => s.attiva).map((s) => `${s.etichetta} (${s.fonti.join(' + ')})`).join('; ')}.</p>
      </Card>
      {storico.length > 0 && <div style={{ marginTop: 16 }}><Card title="Storico delle rilevazioni" flush>
        <table className="t"><thead><tr><th>Data</th><th>Origine</th><th>Stato</th><th className="num">Raggio</th><th className="num">Luoghi</th><th className="num">Chiamate</th><th>Novità</th><th className="num">Attrattività</th><th /></tr></thead>
          <tbody>{storico.map((s) => <tr key={s.id} className={s.id === rilevazione.id ? 'strong' : ''}>
            <td>{itDateTime(s.eseguita_at)}{s.prova && <> <Badge tone="grey">prova</Badge></>}</td><td className="small">{ORIGINE[s.origine] || s.origine}</td>
            <td><Badge tone={STATO_RIL[s.stato]?.tone || 'grey'}>{STATO_RIL[s.stato]?.label || s.stato}</Badge></td><td className="num">{metri(s.raggio_m)}</td><td className="num">{num(s.n_luoghi)}</td><td className="num">{num(s.n_chiamate)}</td>
            <td className="small">{s.confronto?.confrontabile ? `+${s.confronto.nuovi} / −${s.confronto.scomparsi} / ${s.confronto.cambiati} cambiati` : '–'}</td>
            <td className="num">{s.punteggio != null ? punti(s.punteggio) : '–'}</td>
            <td className="num">{s.id !== rilevazione.id && ['COMPLETATA', 'PARZIALE'].includes(s.stato) && onApri && <button className="btn sm ghost" onClick={() => onApri(s.id)}>Apri</button>}</td>
          </tr>)}</tbody></table>
      </Card></div>}
    </div>
  );
}

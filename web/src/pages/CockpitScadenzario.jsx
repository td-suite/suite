import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useApi, Card, Badge, Skeleton, ErrorBox, Empty, SearchInput, useToast } from '../components/ui.jsx';
import { Icon } from '../components/Icons.jsx';
import { fmtDateTime, fmtMoney, AREA_COLORS } from '../format.js';

// Scadenzario unico di direzione (decisione del CEO, 08/11/2026): le scadenze vere dei moduli e dell'anagrafica in una tabella sola,
// sopra le card del Cockpit. Dati da GET /api/cockpit/scadenzario (server/src/lib/scadenzario.js, fonti in docs/COCKPIT.md): ogni fonte
// si legge solo se il modulo è LIVE; una fonte non disponibile è dichiarata in fondo, mai contata come zero.
const AREE = [['DIREZIONE', 'Direzione'], ['FINANCE', 'Finance'], ['RETAIL_FLOW', 'Retail e Flow'], ['OPERATIONS', 'Operations'], ['HQS', 'HQS'], ['PEOPLE', 'People']];
const GRAV_TONE = { CRITICA: 'red', ALTA: 'amber', MEDIA: 'blue', BASSA: 'grey' };
const GRAV_LABEL = { CRITICA: 'Critica', ALTA: 'Alta', MEDIA: 'Media', BASSA: 'Bassa' };
const RIEP = [['SCADUTA', 'Scadute', 'red'], ['OGGI', 'Oggi', 'red'], ['ENTRO_7', 'Entro 7 giorni', 'amber'], ['ENTRO_30', 'Entro 30 giorni', 'mauve']];
const itD = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
const addG = (d, n) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const oggiRoma = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
const settimana = (d) => { const t = new Date(`${d}T12:00:00Z`); const lun = addG(d, -((t.getUTCDay() + 6) % 7)); return { chiave: lun, etichetta: `Settimana dal ${itD(lun).slice(0, 5)} al ${itD(addG(lun, 6))}` }; };

function Quando({ r }) {
  if (r.stato === 'SCADUTA') return <Badge tone="red">scaduta da {-r.giorni} gg</Badge>;
  if (r.stato === 'OGGI') return <Badge tone="red">oggi</Badge>;
  return <Badge tone={r.stato === 'ENTRO_7' ? 'amber' : r.stato === 'ENTRO_30' ? 'mauve' : 'grey'}>tra {r.giorni} gg</Badge>;
}

export default function CockpitScadenzario() {
  const toast = useToast();
  const oggi = oggiRoma();
  const [da, setDa] = useState(addG(oggi, -30));
  const [a, setA] = useState(addG(oggi, 90));
  const [aree, setAree] = useState([]);
  const [modulo, setModulo] = useState('');
  const [testo, setTesto] = useState('');
  const [q, setQ] = useState('');
  const [stati, setStati] = useState([]);
  const [viste, setViste] = useState(false);
  const [busy, setBusy] = useState(null);
  useEffect(() => { const t = setTimeout(() => setQ(testo.trim()), 300); return () => clearTimeout(t); }, [testo]);
  const filtri = { da, a, area: aree.join(','), modulo, q, stati: stati.join(','), viste: viste ? '1' : '' };
  const url = `/cockpit/scadenzario${qs(filtri)}`;
  const { data, loading, error, reload } = useApi(url);
  const settimane = useMemo(() => {
    const m = new Map();
    for (const r of data?.righe || []) { const s = settimana(r.data); if (!m.has(s.chiave)) m.set(s.chiave, { ...s, righe: [] }); m.get(s.chiave).righe.push(r); }
    return [...m.values()];
  }, [data]);
  const exportQs = qs({ da, a, area: aree.join(','), modulo, q, stati: stati.join(',') });
  const toggle = (list, set, v) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const segna = async (r) => {
    setBusy(r.id);
    try { const out = await api.post('/cockpit/scadenzario/viste', { chiave: r.id, data: r.data }); toast(`Scadenza nascosta fino al ${itD(out.fino_a)}`); reload(); } catch (e) { toast(e, 'err'); }
    setBusy(null);
  };
  const ripristina = async (r) => {
    setBusy(r.id);
    try { await api.del(`/cockpit/scadenzario/viste?chiave=${encodeURIComponent(r.id)}`); toast('Scadenza di nuovo visibile'); reload(); } catch (e) { toast(e, 'err'); }
    setBusy(null);
  };
  const fontiOff = (data?.fonti || []).filter((f) => f.stato !== 'OK');
  const rip = data?.riepilogo;
  return (
    <Card id="scadenzario" className="scad mb" title="Scadenzario di direzione" icon="calendar"
      actions={<div className="row tight">
        <a className="btn sm ghost" href={`/api/cockpit/scadenzario/export.xlsx${exportQs}`} download><Icon name="sheet" />XLSX</a>
        <a className="btn sm ghost" href={`/api/cockpit/scadenzario/export.pdf${exportQs}`} download><Icon name="pdf" />PDF</a>
        <button className="iconbtn" onClick={reload} disabled={loading} aria-label="Aggiorna lo scadenzario" title="Aggiorna"><Icon name="refresh" /></button>
      </div>}>
      <div className="scad-riep" role="group" aria-label="Riepilogo delle scadenze: clic per filtrare">
        {RIEP.map(([k, label, tone]) => (
          <button key={k} type="button" className={`scad-tile t-${tone} ${stati.includes(k) ? 'on' : ''}`} onClick={() => toggle(stati, setStati, k)} aria-pressed={stati.includes(k)}>
            <span className="n">{rip ? rip[k] : <Skeleton lines={1} />}</span><span className="l">{label}</span>
          </button>
        ))}
      </div>
      <div className="scad-filtri">
        <div className="row tight wrap" role="group" aria-label="Aree">
          <button type="button" className={`chip-btn ${aree.length ? '' : 'on'}`} onClick={() => setAree([])}>Tutte le aree</button>
          {AREE.map(([k, n]) => <button key={k} type="button" className={`chip-btn ${aree.includes(k) ? 'on' : ''}`} style={{ '--area': AREA_COLORS[k] }} onClick={() => toggle(aree, setAree, k)} aria-pressed={aree.includes(k)}>{n}</button>)}
        </div>
        <div className="row tight wrap">
          <select value={modulo} onChange={(e) => setModulo(e.target.value)} aria-label="Modulo">
            <option value="">Tutti i moduli</option>
            {(data?.moduli || []).map((m) => <option key={m.key} value={m.key}>{m.nome}</option>)}
          </select>
          <label className="small muted">Dal <input type="date" value={da} max={a} onChange={(e) => e.target.value && setDa(e.target.value)} /></label>
          <label className="small muted">al <input type="date" value={a} min={da} onChange={(e) => e.target.value && setA(e.target.value)} /></label>
          <div className="scad-cerca"><SearchInput value={testo} onChange={setTesto} placeholder="Cerca scadenza, sede, persona" /></div>
          <label className="small row tight" title="Mostra anche le scadenze segnate come viste"><input type="checkbox" checked={viste} onChange={(e) => setViste(e.target.checked)} />Viste{data?.nascoste ? ` (${data.nascoste})` : ''}</label>
          {(aree.length || modulo || q || stati.length || da !== addG(oggi, -30) || a !== addG(oggi, 90)) ? <button className="btn sm ghost" onClick={() => { setAree([]); setModulo(''); setTesto(''); setStati([]); setDa(addG(oggi, -30)); setA(addG(oggi, 90)); }}>Azzera i filtri</button> : null}
        </div>
      </div>
      <ErrorBox error={error} />
      {loading && !data && <Skeleton lines={6} />}
      {data && !data.righe.length && <Empty compact icon="calendar" title="Nessuna scadenza">Nessuna scadenza nell'intervallo con i filtri scelti.</Empty>}
      {data?.righe?.length > 0 && (
        <div className="table-wrap scad-tab">
          <table className="t">
            <thead><tr><th>Data</th><th>Gravità</th><th>Scadenza</th><th>Oggetto</th><th className="num">Importo</th><th>Responsabile</th><th aria-label="Azioni" /></tr></thead>
            {settimane.map((s) => (
              <tbody key={s.chiave}>
                <tr className="scad-sett"><td colSpan={7}>{s.etichetta} <span className="muted">· {s.righe.length} {s.righe.length === 1 ? 'scadenza' : 'scadenze'}</span></td></tr>
                {s.righe.map((r) => (
                  <tr key={r.id} className={`${r.vista_fino_a ? 'vista' : ''} st-${r.stato}`}>
                    <td className="nowrap"><div className="strong">{itD(r.data)}</div><Quando r={r} /></td>
                    <td><Badge tone={GRAV_TONE[r.gravita]}>{GRAV_LABEL[r.gravita]}</Badge></td>
                    <td className="scad-tit">
                      <div className="strong">{r.titolo}</div>
                      {r.descrizione && <div className="small muted">{r.descrizione}</div>}
                      <div className="tiny"><span className="scad-area" style={{ '--area': AREA_COLORS[r.area] }}>{r.tipo}</span> · {r.modulo_nome}{r.vista_fino_a ? ` · vista fino al ${itD(r.vista_fino_a)}` : ''}</div>
                    </td>
                    <td>{r.oggetto || <span className="muted">–</span>}</td>
                    <td className="num nowrap">{r.importo != null ? <>{r.stima && <span title="Importo stimato">~ </span>}{fmtMoney(r.importo)}</> : ''}</td>
                    <td className="small">{r.responsabile || <span className="muted">–</span>}</td>
                    <td className="actions"><div className="scad-azioni">
                      {r.link && (r.link.startsWith('/') ? <Link className="btn sm" to={r.link}>Apri</Link> : <a className="btn sm" href={r.link}>Apri</a>)}
                      {r.vista_fino_a
                        ? <button className="btn sm ghost" disabled={busy === r.id} onClick={() => ripristina(r)}>Ripristina</button>
                        : <button className="btn sm ghost" disabled={busy === r.id} onClick={() => segna(r)} title={r.data > oggi ? `Nascondi fino al ${itD(r.data)}` : 'Nascondi per 7 giorni'}><Icon name="eye" />Segna come vista</button>}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      )}
      {data && (
        <details className="scad-fonti small">
          <summary>{data.fonti.length - fontiOff.length} fonti lette su {data.fonti.length}{fontiOff.length ? `, ${fontiOff.length} non disponibili` : ''} · aggiornato il {fmtDateTime(data.generated_at)}</summary>
          <ul>
            {data.fonti.map((f) => <li key={f.key}><Badge tone={f.stato === 'OK' ? 'green' : f.stato === 'ERRORE' ? 'red' : 'grey'}>{f.stato === 'OK' ? `${f.righe} righe` : f.stato === 'ERRORE' ? 'errore' : f.stato === 'RISERVATA' ? 'riservata' : 'non disponibile'}</Badge> <b>{f.nome}</b>{f.nota ? ` · ${f.nota}` : ''}<div className="tiny muted">{f.campi}</div></li>)}
          </ul>
          <div className="strong mt">Moduli senza scadenze da leggere</div>
          <ul>{data.scartate.map((x) => <li key={x.nome}><b>{x.nome}</b>: {x.motivo}</li>)}</ul>
          <div className="tiny muted">Soglie dichiarate (Amministrazione &gt; Impostazioni): proposte senza risposta dopo {data.soglie.proposte_giorni} giorni, ordini da approvare dopo {data.soglie.ordini_giorni}, presa visione delle circolari dopo {data.soglie.circolari_giorni}.</div>
        </details>
      )}
    </Card>
  );
}

// Conto economico di sede (P&L) nel Controllo di gestione di Finance Management (programma "anagrafica unica", decisioni 11 e 12 del CEO,
// 08/11/2026). Ricavi = produzione (Retail per sede, Service al Laboratorio), Incassi Cash come controllo, costi diretti di sede, quota dei
// costi centrali ripartita sui ricavi, margine e confronto con lo stesso periodo dell'anno precedente. Ogni cella apre le righe che la
// compongono con il modulo di provenienza; una fonte non disponibile si vede come tale (mai uno zero). Calcoli sul server
// (GET /api/finance/controllo/conto-economico).
import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { qs, fileUrl } from '../api.js';
import { useApi, Card, Kpi, Modal, Badge, Icon, Loading, ErrorBox } from '../components/ui.jsx';
import { eur } from '../format.js';

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const pct = (v) => (v == null ? '' : `${Number(v).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`);
const delta = (v) => (v == null ? null : <span className={v >= 0 ? 'green' : 'red'}>{v > 0 ? '+' : ''}{pct(v)}</span>);
const NonDisp = ({ nota }) => <span title={nota}><Badge tone="red">non disponibile</Badge></span>;

// Dettaglio di una cella: le righe che la compongono, con modulo di provenienza e collegamento
function Dettaglio({ titolo, righe, nota, onClose }) {
  const tot = righe.reduce((a, r) => a + (r.importo || 0), 0);
  const daInd = righe.filter((r) => r.importo == null).length;
  return (
    <Modal title={titolo} wide onClose={onClose} footer={<button className="btn" onClick={onClose}>Chiudi</button>}>
      {nota && <p className="small muted" style={{ marginTop: 0 }}>{nota}</p>}
      {righe.length ? (
        <div className="table-wrap"><table className="t" data-testid="pl-dettaglio">
          <thead><tr><th>Modulo</th><th>Data / periodo</th><th>Descrizione</th><th className="num">Importo</th></tr></thead>
          <tbody>
            {righe.map((r, i) => <tr key={i}><td className="small">{r.modulo}{r.sede ? <div className="muted">{r.sede}</div> : null}{r.centrale ? <div className="muted">{r.centrale}</div> : null}</td><td className="small mono">{r.data}</td>
              <td className="small">{r.link ? (r.link.startsWith('/finance') ? <Link to={r.link}>{r.descrizione}</Link> : <a href={r.link}>{r.descrizione}</a>) : r.descrizione}{r.stima ? <> <Badge tone="mauve">stima</Badge></> : null}</td>
              <td className="num">{r.importo == null ? <Badge tone="mauve">da indicare</Badge> : eur(r.importo)}</td></tr>)}
            <tr><td colSpan={3} className="strong">Totale{daInd ? ` (${daInd} da indicare)` : ''}</td><td className="num strong">{eur(tot)}</td></tr>
          </tbody>
        </table></div>
      ) : <div className="empty">Nessuna riga nel periodo.</div>}
    </Modal>
  );
}

export default function ContoEconomico() {
  const [sp, setSp] = useSearchParams();
  const oggi = new Date();
  const anno = Number(sp.get('anno') || oggi.getFullYear());
  const mese = sp.has('mese') ? sp.get('mese') : String(oggi.getMonth() + 1);
  const sede = sp.get('sede') || '';
  const set = (k, v) => { const n = new URLSearchParams(sp); if (v === '' || v == null) { if (k === 'mese') n.set('mese', ''); else n.delete(k); } else n.set(k, v); setSp(n, { replace: true }); };
  const q = qs({ anno, mese, site_id: sede });
  const d = useApi(`/controllo/conto-economico${q}`);
  const [det, setDet] = useState(null);
  const x = d.data;
  const anni = [oggi.getFullYear() + 1, oggi.getFullYear(), oggi.getFullYear() - 1, oggi.getFullYear() - 2, oggi.getFullYear() - 3];
  const disp = (k) => x?.fonti?.[k]?.disponibile !== false;
  const label = (k) => x.righe.find((r) => r.key === k)?.label || k;
  const apri = (k, c) => setDet({ titolo: `${label(k)} · ${c ? c.sede.name : 'tutte le sedi'} · ${x.periodo.etichetta}`, nota: x.fonti[k]?.nota, righe: c ? c.voci[k].righe : x.colonne.flatMap((cc) => cc.voci[k].righe.map((r) => ({ ...r, sede: cc.sede.name }))) });
  const apriCentrali = (k) => setDet({ titolo: `Costi centrali · ${label(k)} · ${x.periodo.etichetta}`, nota: x.fonti[k]?.nota, righe: x.centrali.voci[k].righe });
  const Cell = ({ k, c }) => {
    if (!disp(k)) return <td className="num"><NonDisp nota={x.fonti[k]?.nota} /></td>;
    const v = c ? c.voci[k] : null;
    const imp = c ? v.importo : x.totale.voci[k];
    const daInd = c ? v.da_indicare : x.colonne.reduce((a, cc) => a + cc.voci[k].da_indicare, 0);
    const n = c ? v.righe.length : x.colonne.reduce((a, cc) => a + cc.voci[k].righe.length, 0);
    return <td className="num"><button className="linklike" onClick={() => apri(k, c)} title={n ? `${n} righe: apri il dettaglio` : 'Nessuna riga'}>{eur(imp)}</button>{daInd ? <div><Badge tone="mauve">{daInd} da indicare</Badge></div> : null}</td>;
  };
  const cols = x?.colonne || [];
  const tot = x?.totale;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Conto economico di sede</h1><div className="sub">Ricavi di produzione, costi diretti, quota dei costi centrali ripartita sui ricavi e margine per sede, con il confronto dell'anno precedente.</div></div>
        <div className="row">
          <select style={{ width: "auto" }} value={anno} onChange={(e) => set('anno', e.target.value)} aria-label="Anno">{anni.map((a) => <option key={a} value={a}>{a}</option>)}</select>
          <select style={{ width: "auto" }} value={mese} onChange={(e) => set('mese', e.target.value)} aria-label="Mese"><option value="">Anno intero</option>{MESI.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          <select style={{ width: "auto" }} value={sede} onChange={(e) => set('sede', e.target.value)} aria-label="Sede"><option value="">Tutte le sedi</option>{(x?.sedi || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <a className="btn ghost" href={fileUrl(`/controllo/conto-economico/export.xlsx${q}`)}><Icon name="download" />XLSX</a>
          <a className="btn ghost" href={fileUrl(`/controllo/conto-economico/export.pdf${q}`)} target="_blank" rel="noreferrer"><Icon name="print" />PDF</a>
        </div>
      </div>
      {d.error && <ErrorBox error={d.error} />}
      {!x ? (!d.error && <Loading />) : (
        <>
          {x.righe.filter((r) => !disp(r.key)).length > 0 && (
            <div className="alert warn" style={{ marginBottom: 12, flexDirection: 'column', gap: 2 }}>
              <b>Fonti non disponibili (righe segnate "non disponibile", non contate come zero):</b>
              {x.righe.filter((r) => !disp(r.key)).map((r) => <div key={r.key} className="small">· {r.label}: {x.fonti[r.key].nota}</div>)}
            </div>
          )}
          {(x.avvisi || []).map((a, i) => <div key={i} className="alert warn small" style={{ marginBottom: 8 }}>{a}</div>)}
          <div className="grid g4" style={{ marginBottom: 16 }}>
            <Kpi label={`Ricavi · ${x.periodo.etichetta}`} value={eur(tot.ricavi)} foot={<>{x.precedente.etichetta}: {eur(tot.precedente?.ricavi)} {delta(tot.variazione_ricavi)}</>} />
            <Kpi label="Costi diretti di sede" value={eur(tot.costi_diretti)} foot={`Margine prima dei centrali ${eur(tot.margine_prima_dei_centrali)}`} />
            <Kpi label="Costi centrali" value={eur(tot.costi_centrali)} foot={x.ripartizione.ripartibile ? 'ripartiti sui ricavi delle sedi' : x.ripartizione.motivo} />
            <Kpi accent label="Margine" value={tot.margine == null ? 'n.d.' : eur(tot.margine)} foot={<>{pct(tot.margine_pct)} · {x.precedente.etichetta}: {eur(tot.precedente?.margine)} {delta(tot.variazione_margine)}</>} />
          </div>
          <Card title={`Conto economico · ${x.periodo.etichetta}${x.filtro_sede ? ` · ${cols[0]?.sede.name || ''}` : ''}`} flush>
            <div className="table-wrap"><table className="t pl" data-testid="conto-economico">
              <thead><tr><th>Voce</th>{cols.map((c) => <th key={c.sede.id} className="num">{c.sede.name}{x.laboratorio?.id === c.sede.id ? <div className="small muted">Laboratorio</div> : null}</th>)}{!x.filtro_sede && <th className="num">Totale</th>}</tr></thead>
              <tbody>
                <tr className="pl-group"><td colSpan={cols.length + 2}>Ricavi (produzione)</td></tr>
                {['ricavi_retail', 'ricavi_service'].map((k) => <tr key={k}><td>{label(k)}</td>{cols.map((c) => <Cell key={c.sede.id} k={k} c={c} />)}{!x.filtro_sede && <Cell k={k} c={null} />}</tr>)}
                <tr className="pl-sum"><td>Totale ricavi</td>{cols.map((c) => <td key={c.sede.id} className="num">{eur(c.ricavi)}</td>)}{!x.filtro_sede && <td className="num">{eur(tot.ricavi)}</td>}</tr>
                <tr className="pl-control"><td>Incassi Cash <span className="small muted">(controllo, non sommati)</span></td>{cols.map((c) => <Cell key={c.sede.id} k="incassi_cash" c={c} />)}{!x.filtro_sede && <Cell k="incassi_cash" c={null} />}</tr>
                {disp('incassi_cash') && <tr className="pl-control"><td>Differenza Cash − Retail</td>{cols.map((c) => <td key={c.sede.id} className="num small">{c.controllo_cash ? eur(c.controllo_cash.differenza) : <span className="muted">nessun rendiconto</span>}</td>)}{!x.filtro_sede && <td className="num small">{tot.controllo_cash ? <span title={`Solo le ${tot.controllo_cash.sedi} sedi con rendiconti Cash`}>{eur(tot.controllo_cash.differenza)}</span> : ''}</td>}</tr>}
                <tr className="pl-group"><td colSpan={cols.length + 2}>Costi diretti di sede</td></tr>
                {x.righe.filter((r) => r.gruppo === 'COSTI').map((r) => <tr key={r.key}><td>{r.label}</td>{cols.map((c) => <Cell key={c.sede.id} k={r.key} c={c} />)}{!x.filtro_sede && <Cell k={r.key} c={null} />}</tr>)}
                <tr className="pl-sum"><td>Totale costi diretti</td>{cols.map((c) => <td key={c.sede.id} className="num">{eur(c.costi_diretti)}</td>)}{!x.filtro_sede && <td className="num">{eur(tot.costi_diretti)}</td>}</tr>
                <tr><td>Margine prima dei costi centrali</td>{cols.map((c) => <td key={c.sede.id} className="num">{eur(c.margine_prima_dei_centrali)}</td>)}{!x.filtro_sede && <td className="num">{eur(tot.margine_prima_dei_centrali)}</td>}</tr>
                <tr><td>Quota costi centrali</td>{cols.map((c) => <td key={c.sede.id} className="num">{c.quota_centrali == null ? <span className="small muted">non ripartibile</span> : <>{eur(c.quota_centrali)}<div className="small muted">{pct(c.quota_pct)} dei ricavi</div></>}</td>)}{!x.filtro_sede && <td className="num">{eur(tot.quota_centrali)}</td>}</tr>
                <tr className="pl-total"><td>Margine di sede</td>{cols.map((c) => <td key={c.sede.id} className="num">{c.margine == null ? 'n.d.' : eur(c.margine)}{c.parziale ? <div><span title={[c.mancanti.length ? `Fonti mancanti: ${c.mancanti.join(', ')}` : '', c.da_indicare ? `${c.da_indicare} importi da indicare` : ''].filter(Boolean).join(' · ') || 'Costi centrali parziali'}><Badge tone="mauve">parziale</Badge></span></div> : null}</td>)}{!x.filtro_sede && <td className="num">{tot.margine == null ? 'n.d.' : eur(tot.margine)}</td>}</tr>
                <tr><td>Margine %</td>{cols.map((c) => <td key={c.sede.id} className="num">{pct(c.margine_pct)}</td>)}{!x.filtro_sede && <td className="num">{pct(tot.margine_pct)}</td>}</tr>
                <tr className="pl-prev"><td>Margine {x.precedente.etichetta}</td>{cols.map((c) => <td key={c.sede.id} className="num">{eur(c.precedente?.margine)}<div className="small">{delta(c.variazione_margine)}</div></td>)}{!x.filtro_sede && <td className="num">{eur(tot.precedente?.margine)}<div className="small">{delta(tot.variazione_margine)}</div></td>}</tr>
              </tbody>
            </table></div>
          </Card>
          <div className="grid g2 mt">
            <Card title="Costi centrali (decisione 11)" flush>
              <table className="t"><tbody>
                {x.righe.filter((r) => r.gruppo === 'COSTI').map((r) => <tr key={r.key}><td>{r.label}</td><td className="num">{!disp(r.key) ? <NonDisp nota={x.fonti[r.key]?.nota} /> : <button className="linklike" onClick={() => apriCentrali(r.key)}>{eur(x.centrali.voci[r.key].importo)}</button>}{x.centrali.voci[r.key].da_indicare ? <div><Badge tone="mauve">{x.centrali.voci[r.key].da_indicare} da indicare</Badge></div> : null}</td></tr>)}
                <tr className="pl-sum"><td>Totale costi centrali</td><td className="num">{eur(x.centrali.totale)}</td></tr>
                <tr><td colSpan={2} className="small muted">Sedi centrali: {x.centrali.sedi.map((s) => s.name).join(', ') || 'nessuna'}{x.impostazioni.sedi_centrali_predefinite ? ' (predefinite: sedi di tipo Sede direzionale)' : ''}. {x.ripartizione.ripartibile ? `Ripartiti in proporzione ai ricavi delle sedi (totale ${eur(x.ripartizione.totale_ricavi)}).` : x.ripartizione.motivo}</td></tr>
              </tbody></table>
            </Card>
            <Card title="Come è calcolato">
              <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }} data-testid="come-calcolato">
                {(x.come_calcolato || []).map((t, i) => <li key={i}>{t}</li>)}
              </ul>
              <div className="small muted" style={{ marginTop: 8 }}>Ipotesi in Impostazioni &gt; Controllo di gestione: coefficiente oneri {String(x.impostazioni.coefficiente).replace('.', ',')}, IVA sui costi {x.impostazioni.iva_costi === 'COSTO' ? 'come costo (indetraibile)' : 'esclusa'}, chiave di ripartizione {x.impostazioni.chiave}.</div>
            </Card>
          </div>
        </>
      )}
      {det && <Dettaglio {...det} onClose={() => setDet(null)} />}
    </div>
  );
}

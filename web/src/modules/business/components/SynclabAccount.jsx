// Business Hub · "Dal gestionale (Synclab)" nella scheda account Service/MdL (richiesta del CEO del 09/11/2026 sera, v0.68.1): per i
// clienti con la Legal entity abbinata a un client Synclab (synclab.clients_td) fatturato maturato e produzione dell'anno, ultimo mese,
// confronto con il fatturato dichiarato nella scheda (pro quota dell'anno e run rate dell'anno seguente) e collegamento alla scheda B2B
// di Retail. Regole e fonti in server/src/modules/business/lib/synclabAccount.js; nessun numero inventato: senza dati la voce lo dice.
import React from 'react';
import { useApi, Card, Badge } from './ui.jsx';
import { eurK, num, itDate, itDateTime } from '../format.js';

export const SEMAFORO = { VERDE: ['green', 'in linea'], GIALLO: ['amber', 'in ritardo'], ROSSO: ['red', 'molto in ritardo'] };
const segno = (n) => (n == null ? '' : n > 0 ? '+' : '');
const pctTxt = (n) => (n == null ? '–' : `${segno(n)}${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(n)}%`);

export function Semaforo({ s, pct }) {
  if (!s) return <span className="small muted">–</span>;
  const [tone, label] = SEMAFORO[s];
  return <span title={`Scostamento sul pro quota ${pctTxt(pct)} · verde entro ±10%, giallo fino a −25%, rosso oltre`}><Badge tone={tone}>{label}</Badge></span>;
}

export default function SynclabAccount({ a }) {
  const q = useApi(`/hub/accounts/${a.id}/synclab`);
  const d = q.data;
  if (!d || !d.applicabile) return null;
  const x = d.confronto;
  const anno = x?.anno || new Date().getFullYear();
  return (
    <div style={{ marginBottom: 16 }}><Card title="Dal gestionale (Synclab)" className="mt" actions={<a className="btn sm ghost" href={`/retail/b2b/clienti/${encodeURIComponent(d.chiave_b2b)}`} title="Scheda del cliente nella sezione B2B di Retail (produzione, documenti, prezzi applicati)">Scheda B2B in Retail</a>}>
      <div data-testid="hub-synclab">
        {!x ? <div className="small muted">{d.nota || 'Nessun dato Synclab per questa Legal entity.'}</div> : (
          <>
            <div className="grid g4">
              <div className="kpi card accent">
                <div className="lbl">Maturato {anno} (Synclab)</div>
                <div className="val">{x.maturato == null ? '–' : eurK(x.maturato)}</div>
                <div className="foot">{x.documenti} documenti · contributo netto, una volta per documento, data nel {anno}</div>
              </div>
              <div className="kpi card">
                <div className="lbl">Pro quota {anno} del dichiarato</div>
                <div className="val">{x.pro_quota ? eurK(x.pro_quota.importo) : '–'}</div>
                <div className="foot">{x.pro_quota ? <>FY atteso {eurK(x.dichiarato)} × {x.pro_quota.nota}</> : 'Fatturato FY atteso non indicato nei Dati economici'}</div>
              </div>
              <div className="kpi card">
                <div className="lbl">Scostamento sul pro quota</div>
                <div className={`val ${x.scostamento != null && x.scostamento < 0 ? 'red' : ''}`}>{x.scostamento == null ? '–' : `${segno(x.scostamento)}${eurK(x.scostamento)}`}</div>
                <div className="foot"><Semaforo s={x.semaforo} pct={x.scostamento_pct} /> {pctTxt(x.scostamento_pct)}</div>
              </div>
              <div className="kpi card">
                <div className="lbl">Run rate FY {x.run_rate.anno}</div>
                <div className="val">{x.run_rate.calcolabile ? eurK(x.run_rate.importo) : 'n.d.'}</div>
                <div className="foot">{x.run_rate.calcolabile ? <>media {eurK(x.run_rate.media_mensile)}/mese × 12 · vs dichiarato {pctTxt(x.run_rate.scostamento_pct)}</> : null}
                  <div className={x.run_rate.mesi.length < 3 ? 'amber' : 'muted'} data-testid="hub-synclab-runrate-nota">{x.run_rate.nota}{x.run_rate.senza_avvio && x.run_rate.inizio ? ` (senza data di avvio: dal primo documento del ${itDate(x.run_rate.inizio)})` : ''}</div></div>
              </div>
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ marginBottom: 8 }}>
                <div className="small strong" style={{ marginBottom: 4 }}>Produzione {anno}: {num(x.produzione.esami)} esami{x.produzione.valore != null ? ` · valore netto ${eurK(x.produzione.valore)}` : ''}</div>
                <div className="small muted">Ultimo mese con dati: {x.ultimo_mese ? `${x.ultimo_mese.etichetta}${x.ultimo_mese.in_corso ? ' (in corso)' : ''} · fatturato ${x.ultimo_mese.fatturato == null ? '–' : eurK(x.ultimo_mese.fatturato)} · ${num(x.ultimo_mese.esami)} esami` : 'nessuno nel ' + anno}</div>
                <div className="small muted" style={{ marginTop: 6 }}>Avvio considerato: {x.avvio ? itDate(x.avvio) : 'non indicato (pro quota dal 1° gennaio)'}. Client Synclab: {d.clients.map((c) => c.client_code || c.client_id).join(', ')}.</div>
              </div>
              <div className="table-wrap" style={{ maxHeight: 260 }}>
                <table className="t" data-testid="hub-synclab-mesi"><thead><tr><th>Mese</th><th className="num">Fatturato</th><th className="num">Doc.</th><th className="num">Esami</th><th className="num">Valore netto</th></tr></thead>
                  <tbody>{[...x.mesi].reverse().map((m) => <tr key={m.mese} className={x.ultimo_mese?.mese === m.mese ? 'strong' : ''}><td>{m.etichetta}{m.in_corso ? <span className="small muted"> (in corso)</span> : null}</td><td className="num">{m.fatturato == null ? '–' : eurK(m.fatturato)}</td><td className="num">{m.documenti || '–'}</td><td className="num">{m.esami ? num(m.esami) : '–'}</td><td className="num">{m.valore == null ? '–' : eurK(m.valore)}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          </>
        )}
        <div className="small muted" style={{ marginTop: 10 }}>Fonte: {d.fonte?.testo || 'Synclab Data API'}{d.fonte?.checkpoint_documenti ? ` · documenti al ${itDateTime(d.fonte.checkpoint_documenti)}` : ''}{d.fonte?.checkpoint_accettazioni ? ` · accettazioni al ${itDateTime(d.fonte.checkpoint_accettazioni)}` : ''}. Dichiarato: {d.fonte?.dichiarato || 'Dati economici'}.</div>
      </div>
    </Card></div>
  );
}

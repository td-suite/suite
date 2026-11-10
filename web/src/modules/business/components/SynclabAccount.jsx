// Business Hub · "Dal gestionale (Synclab)" nella scheda account Service/MdL (richiesta del CEO del 09/11/2026 sera, v0.68.1; rivisto il
// 10/11/2026, v0.68.5: "Maturato 2026: NON il fatturato ma il valore netto, cioè il valore della produzione accettata per mese, aggiornato
// per singolo giorno"). Per i clienti con la Legal entity abbinata a un client Synclab (synclab.clients_td): maturato dell'anno = produzione
// accettata (accettazioni negli stati della produzione, importi di riga e sconto di testata come da impostazioni), progressione giornaliera del mese e mensile dell'anno, pro
// quota e run rate calcolati sulla produzione accettata, documenti emessi come dato secondario (mai sommato). Regole e fonti in
// server/src/modules/business/lib/synclabAccount.js; nessun numero inventato: senza dati la voce lo dice.
import React from 'react';
import { useApi, Card, Badge } from './ui.jsx';
import { eurK, num, itDate, itDateTime } from '../format.js';

export const SEMAFORO = { VERDE: ['green', 'in linea'], GIALLO: ['amber', 'in ritardo'], ROSSO: ['red', 'molto in ritardo'] };
const segno = (n) => (n == null ? '' : n > 0 ? '+' : '');
const pctTxt = (n) => (n == null ? '–' : `${segno(n)}${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(n)}%`);
const GG = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

export function Semaforo({ s, pct }) {
  if (!s) return <span className="small muted">–</span>;
  const [tone, label] = SEMAFORO[s];
  return <span title={`Scostamento sul pro quota ${pctTxt(pct)} · verde entro ±10%, giallo fino a −25%, rosso oltre`}><Badge tone={tone}>{label}</Badge></span>;
}

/** Barre della produzione accettata giorno per giorno (mese in corso). */
function Giorni({ g }) {
  if (!g?.giorni?.length) return null;
  const max = Math.max(1, ...g.giorni.map((x) => Number(x.valore) || 0));
  return (
    <div data-testid="hub-synclab-giorni">
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 74 }} aria-hidden="true">
        {g.giorni.map((x) => {
          const fest = [0, 6].includes(new Date(`${x.giorno}T12:00:00Z`).getUTCDay());
          return <span key={x.giorno} title={`${GG[new Date(`${x.giorno}T12:00:00Z`).getUTCDay()]} ${itDate(x.giorno)}: ${eurK(x.valore || 0)} · ${num(x.esami)} esami`}
            style={{ flex: 1, minWidth: 0, borderRadius: '2px 2px 0 0', height: `${Math.max(x.valore ? 4 : 1, (Number(x.valore || 0) / max) * 100)}%`, background: fest ? 'var(--blue-200)' : 'var(--teal)' }} />;
        })}
      </div>
      <div className="small muted" style={{ display: 'flex', justifyContent: 'space-between' }}><span>{itDate(g.giorni[0].giorno).slice(0, 5)}</span><span>{itDate(g.giorni[g.giorni.length - 1].giorno).slice(0, 5)}</span></div>
    </div>
  );
}

export default function SynclabAccount({ a }) {
  const q = useApi(`/hub/accounts/${a.id}/synclab`);
  const d = q.data;
  if (!d || !d.applicabile) return null;
  const x = d.confronto;
  const anno = x?.anno || new Date().getFullYear();
  const meseCorrente = x?.mesi?.[x.mesi.length - 1];
  return (
    <div style={{ marginBottom: 16 }}><Card title="Dal gestionale (Synclab)" className="mt" actions={<><span className="small muted" style={{ marginRight: 8 }}>{d.fonte?.aggiornato || ''}</span><a className="btn sm ghost" href={`/retail/b2b/clienti/${encodeURIComponent(d.chiave_b2b)}`} title="Scheda del cliente nella sezione B2B di Retail (produzione, documenti, prezzi applicati)">Scheda B2B in Retail</a></>}>
      <div data-testid="hub-synclab">
        {!x ? <div className="small muted">{d.nota || 'Nessun dato Synclab per questa Legal entity.'}</div> : (
          <>
            <div className="grid g4">
              <div className="kpi card accent" data-testid="hub-synclab-maturato">
                <div className="lbl">Maturato {anno} (produzione accettata)</div>
                <div className="val">{x.maturato == null ? '–' : eurK(x.maturato)}</div>
                <div className="foot">{num(x.produzione.esami)} esami nel {anno} · importi di riga e sconto di testata come da impostazioni{x.produzione.righe_senza_prezzo ? ` · ${num(x.produzione.righe_senza_prezzo)} senza prezzo` : ''}</div>
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
                <div className="foot">{x.run_rate.calcolabile ? <>produzione media {eurK(x.run_rate.media_mensile)}/mese × 12 · vs dichiarato {pctTxt(x.run_rate.scostamento_pct)}</> : null}
                  <div className={x.run_rate.mesi.length < 3 ? 'amber' : 'muted'} data-testid="hub-synclab-runrate-nota">{x.run_rate.nota}{x.run_rate.senza_avvio && x.run_rate.inizio ? ` (senza data di avvio: dalla prima accettazione erogata del ${itDate(x.run_rate.inizio)})` : ''}</div></div>
              </div>
            </div>
            <div className="grid g2" style={{ marginTop: 12, alignItems: 'start' }}>
              <div>
                <div className="small strong" style={{ marginBottom: 6 }}>{meseCorrente ? `${meseCorrente.etichetta[0].toUpperCase()}${meseCorrente.etichetta.slice(1)}` : 'Mese in corso'} giorno per giorno: {eurK(d.giornaliero?.totale?.valore ?? 0)}{d.giornaliero?.totale ? ` · ${num(d.giornaliero.totale.esami)} esami` : ''}</div>
                {d.giornaliero ? <Giorni g={d.giornaliero} /> : <div className="small muted">Progressione giornaliera non disponibile</div>}
                <div className="small muted" style={{ marginTop: 8 }}>Ultimo mese con dati: {x.ultimo_mese ? `${x.ultimo_mese.etichetta}${x.ultimo_mese.in_corso ? ' (in corso)' : ''} · produzione ${x.ultimo_mese.produzione == null ? '–' : eurK(x.ultimo_mese.produzione)} · ${num(x.ultimo_mese.esami)} esami` : `nessuno nel ${anno}`}</div>
                <div className="small muted" style={{ marginTop: 4 }}>Avvio considerato: {x.avvio ? itDate(x.avvio) : 'non indicato (pro quota dal 1° gennaio)'}. Client Synclab: {d.clients.map((c) => c.client_code || c.client_id).join(', ')}.</div>
                <div className="small muted" style={{ marginTop: 4 }}>Documenti emessi nel {anno} (secondario, non sommati): {x.documenti_emessi?.importo == null ? '–' : eurK(x.documenti_emessi.importo)}{x.documenti_emessi?.documenti ? ` in ${num(x.documenti_emessi.documenti)} documenti` : ''}.</div>
              </div>
              <div className="table-wrap" style={{ maxHeight: 260 }}>
                <table className="t" style={{ minWidth: 0 }} data-testid="hub-synclab-mesi"><thead><tr><th>Mese</th><th className="num" title="Produzione accettata: accettazioni negli stati della produzione, importi di riga e sconto di testata come da impostazioni">Produzione</th><th className="num">Esami</th><th className="num" title="Accettazioni">Acc.</th><th className="num" title="Documenti emessi: dato secondario, non sommato">Doc. emessi</th></tr></thead>
                  <tbody>{[...x.mesi].reverse().map((m) => <tr key={m.mese} className={x.ultimo_mese?.mese === m.mese ? 'strong' : ''}><td>{m.etichetta}{m.in_corso ? <span className="small muted"> (in corso)</span> : null}</td><td className="num">{m.produzione == null ? '–' : eurK(m.produzione)}</td><td className="num">{m.esami ? num(m.esami) : '–'}</td><td className="num">{m.accettazioni ? num(m.accettazioni) : '–'}</td><td className="num muted">{m.documenti_emessi == null ? '–' : eurK(m.documenti_emessi)}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          </>
        )}
        <div className="small muted" style={{ marginTop: 10 }} data-testid="hub-synclab-fonte">Fonte: {d.fonte?.testo || 'Synclab Data API'}. Stati della produzione accettata e sconto di testata in Amministrazione &gt; Connettori &gt; Dati Synclab &gt; Impostazioni (la scheda Quadratura li confronta con il report del gestionale). {d.fonte?.documenti ? `${d.fonte.documenti}${d.fonte.checkpoint_documenti ? ` (copia al ${itDateTime(d.fonte.checkpoint_documenti)})` : ''}. ` : ''}Dichiarato: {d.fonte?.dichiarato || 'Dati economici'}.</div>
      </div>
    </Card></div>
  );
}

// Lab Control · documento economico (fattura o nota di credito) dalla copia Synclab: numero, data, tipo, stato, totali, righe, altre
// accettazioni collegate. La Data API non fornisce il PDF: si dice nel pannello, nessun pulsante di download.
import React from 'react';
import { Link } from 'react-router-dom';
import { Modal, ErrorBox, Skeleton, Badge } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useApi, base } from '../api.js';
import { gg, eur, num } from './comuni.jsx';

export default function Documento({ instanceId, id, onClose }) {
  const q = useApi(`/lab/documenti/${encodeURIComponent(instanceId)}/${encodeURIComponent(id)}`);
  const d = q.data;
  return (
    <Modal title={d ? `${d.tipo} ${d.numero || ''}` : 'Documento economico'} onClose={onClose} wide>
      <ErrorBox error={q.error} />
      {!d && !q.error && <Skeleton lines={6} />}
      {d && (
        <div className="lc-doc" data-testid="lc-documento">
          <div className="alert info"><Icon name="info" /><span>{d.pdf} Per stamparlo o inviarlo usa StudioLab.</span></div>
          <dl className="lc-dl">
            <dt>Numero</dt><dd><b>{d.numero || '–'}</b> {d.annullato && <Badge tone="grey">annullato</Badge>} {d.proforma && <Badge tone="grey">proforma</Badge>}</dd>
            <dt>Data</dt><dd>{gg(d.data) || '–'}{d.competenza?.da ? ` · competenza ${gg(d.competenza.da)} → ${gg(d.competenza.a)}` : ''}</dd>
            <dt>Tipo</dt><dd>{d.tipo} · {d.origine}{d.registro_iva ? ` · registro ${d.registro_iva}` : ''}</dd>
            <dt>Stato</dt><dd>{d.stato ?? '–'} <span className="small muted">(codice del gestionale)</span></dd>
            <dt>Cliente</dt><dd>{d.cliente}</dd>
          </dl>
          <div className="lc-totdoc">
            <div><span>Imponibile</span><b>{eur(d.totali.imponibile_netto ?? d.totali.imponibile_lordo)}</b></div>
            <div><span>IVA</span><b>{eur(d.totali.iva)}</b></div>
            {d.totali.bollo ? <div><span>Bollo</span><b>{eur(d.totali.bollo)}</b></div> : null}
            <div className="tot"><span>Totale</span><b>{eur(d.totali.totale)}</b></div>
          </div>
          <h3 className="lc-h3">Righe ({num(d.righe.length)})</h3>
          <div className="table-wrap"><table className="t lc-t-stretta">
            <thead><tr><th>Codice</th><th>Descrizione</th><th className="num">Q.tà</th><th className="num">Importo</th><th className="num">Sconto</th><th className="num">IVA</th></tr></thead>
            <tbody>{d.righe.map((r, i) => <tr key={i}><td className="mono">{r.codice || '–'}</td><td>{r.descrizione || <span className="muted">non indicata</span>}</td><td className="num">{num(r.quantita)}</td><td className="num">{eur(r.importo ?? r.netto)}</td><td className="num">{r.sconto_pct ? `${num(r.sconto_pct)}%` : '–'}</td><td className="num">{r.iva_pct != null ? `${num(r.iva_pct)}%` : '–'}</td></tr>)}
              {!d.righe.length && <tr><td colSpan={6} className="muted">Nessuna riga nella copia</td></tr>}</tbody>
          </table></div>
          <h3 className="lc-h3">Accettazioni collegate ({num(d.accettazioni.length)})</h3>
          <div className="lc-accdoc">
            {d.accettazioni.map((a) => (a.visibile ? <Link key={a.id} className="lc-chip" to={`${base}/accettazioni/${encodeURIComponent(d.instance_id)}/${encodeURIComponent(a.id)}`} onClick={onClose}>{a.numero} · {gg(a.data)}</Link>
              : <span key={a.id} className="lc-chip off" title="Fuori dal tuo perimetro di sedi">{a.numero}</span>))}
            {d.accettazioni_non_nella_copia > 0 && <span className="small muted">{d.accettazioni_non_nella_copia} non ancora nella copia</span>}
          </div>
        </div>
      )}
    </Modal>
  );
}

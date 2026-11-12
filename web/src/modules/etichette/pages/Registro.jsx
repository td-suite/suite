// Lab Control > Label · Registro stampe (ADMIN): chi, quando, sede, accettazione, etichette, copie, stampante, esito, ristampa. Nessun dato del paziente.
import React, { useState } from 'react';
import { Badge, Card, ErrorBox, PageHead, Pager } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { qs, useApi } from '../api.js';
import { itDataOra } from '../format.js';

const METODO = { ZEBRA: 'Zebra', PDF: 'PDF', PROVA: 'Prova' };

export default function Registro() {
  const [f, setF] = useState({ da: '', a: '', esito: '', q: '' });
  const [pagina, setPagina] = useState(1);
  const r = useApi(`/registro${qs({ ...f, pagina })}`, [], { silent: true });
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setPagina(1); };
  return (
    <div className="page et-page">
      <PageHead title="Registro stampe" icon="list" sub="Ogni stampa e ogni tentativo, senza dati del paziente: utente, sede, accettazione, etichette, stampante, esito" />
      <div className="row et-filtri">
        <label className="f"><span>Dal</span><input type="date" value={f.da} onChange={(e) => set('da', e.target.value)} /></label>
        <label className="f"><span>Al</span><input type="date" value={f.a} onChange={(e) => set('a', e.target.value)} /></label>
        <label className="f"><span>Esito</span><select value={f.esito} onChange={(e) => set('esito', e.target.value)}><option value="">Tutti</option><option value="OK">Riuscite</option><option value="ERRORE">Non riuscite</option></select></label>
        <label className="f"><span>Accettazione o stampante</span><input value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="Cerca" /></label>
      </div>
      <ErrorBox error={r.error} />
      <Card flush title={r.data ? `${r.data.totale} registrazion${r.data.totale === 1 ? 'e' : 'i'} · ${r.data.etichette} etichette stampate` : 'Registro'} icon="printer">
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Quando</th><th>Utente</th><th>Sede</th><th>Accettazione</th><th className="num">Etichette</th><th className="num">Copie</th><th>Stampante</th><th>Esito</th></tr></thead>
            <tbody>
              {(r.data?.righe || []).map((x) => (
                <tr key={x.id}>
                  <td>{itDataOra(x.at)}</td>
                  <td>{x.utente || '—'}</td>
                  <td>{x.sede_code ? `${x.sede_code} ${x.sede_name || ''}` : x.metodo === 'PROVA' ? <span className="faint">prova del modello</span> : <span className="faint">non abbinata</span>}</td>
                  <td>{x.request_number || '—'}{x.ristampa && <> <Badge tone="amber">ristampa</Badge></>}</td>
                  <td className="num">{x.n_etichette}</td>
                  <td className="num">{x.copie}</td>
                  <td>{x.metodo === 'ZEBRA' ? x.stampante || '—' : METODO[x.metodo]}{x.metodo === 'PROVA' && x.stampante ? ` · ${x.stampante}` : ''}{x.modello && <div className="small muted">{x.modello}</div>}</td>
                  <td>{x.esito === 'OK' ? <Badge tone="green">Riuscita</Badge> : <Badge tone="red" title={x.errore || ''}>Non riuscita</Badge>}{x.errore && <div className="small muted">{x.errore}</div>}</td>
                </tr>
              ))}
              {r.data && !r.data.righe.length && <tr><td colSpan={8} className="muted"><Icon name="info" /> Nessuna stampa registrata con questi filtri.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      {r.data?.totale > 100 && <Pager page={pagina} pageSize={100} total={r.data.totale} onChange={setPagina} />}
    </div>
  );
}

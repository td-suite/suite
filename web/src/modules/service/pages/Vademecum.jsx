// Vademecum (richiesta del CEO, 01/11/2026): la pagina INGLOBA il Vademecum online (https://referti.toscanadiagnostica.it/vademecum)
// in un iframe a tutta altezza. Prima il server della Suite verifica se il sito lo consente (GET /api/service/vademecum/embeddabile:
// X-Frame-Options e CSP frame-ancestors, cache 1 ora): se è vietato o il sito non risponde, la pagina mostra il PDF del Vademecum
// dallo specchio e il pulsante "Apri il Vademecum online" in una nuova scheda.
import React, { useState } from 'react';
import { PageHead, Loading, useApi, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useServizio } from '../index.jsx';
import { fileUrl, copiaLink } from '../dati.js';

export default function Vademecum() {
  const { user } = useServizio();
  const [rinnova, setRinnova] = useState(0);
  const v = useApi(`/service/vademecum/embeddabile${rinnova ? `?rinnova=1&n=${rinnova}` : ''}`, [rinnova]);
  const toast = useToast();
  const d = v.data;
  const apri = d && <a className="btn" href={d.url} target="_blank" rel="noopener"><Icon name="external" />Apri il Vademecum online</a>;
  return (
    <div className="page sv-page sv-vademecum">
      <PageHead title="Vademecum degli esami" icon="doc"
        sub="La guida completa agli esami del Laboratorio di Analisi: per ogni analita codice, metodo, tempo di refertazione, tipo di campione, sezione e valori di riferimento."
        actions={d && <>{d.consentito && apri}
          <button className="btn ghost" onClick={async () => { if (await copiaLink(d.url, 'Vademecum degli esami')) toast(`Link copiato: ${d.url}`); }}><Icon name="copy" />Copia il link</button>
          {user?.editor && <button className="btn ghost" title="Ripete subito la verifica dell'incorporamento (altrimenti vale per un'ora)" onClick={() => setRinnova((n) => n + 1)}><Icon name="refresh" />Verifica di nuovo</button>}</>} />
      {!d ? (v.error ? <div className="sv-alert warn"><Icon name="alert" className="ico" /><div>{v.error.message}</div></div> : <Loading text="Verifico il Vademecum online" />) : d.consentito ? (
        <div className="sv-viewer"><iframe src={d.url} title="Vademecum degli esami (online)" /></div>
      ) : (
        <>
          <div className="sv-alert warn"><Icon name="info" className="ico" /><div>
            <strong>Il Vademecum online non si può incorporare qui</strong> ({d.motivo}). Lo apri in una nuova scheda con il pulsante "Apri il Vademecum online"; qui sotto la versione PDF pubblicata sul Portale Service.
          </div></div>
          {d.pdf?.disponibile ? (
            <>
              <div className="sv-actions start" style={{ marginBottom: 12 }}>
                {apri}
                <a className="btn ghost" href={fileUrl(d.pdf.pdf, true)}><Icon name="download" />Scarica il PDF</a>
                <a className="btn ghost" href={fileUrl(d.pdf.pdf)} target="_blank" rel="noopener"><Icon name="pdf" />Apri il PDF a schermo intero</a>
              </div>
              <div className="sv-viewer"><iframe src={`${fileUrl(d.pdf.pdf)}#toolbar=1&navpanes=0&view=FitH`} title="Vademecum degli esami (PDF)" /></div>
            </>
          ) : <div className="sv-alert warn"><Icon name="alert" className="ico" /><div>Anche il PDF del Vademecum non è disponibile nello specchio ({d.pdf?.errore || 'file mancante'}). Usa il pulsante "Apri il Vademecum online".</div></div>}
        </>
      )}
      <div className="sv-alert mt"><Icon name="info" className="ico" /><div>Il vademecum è un documento in continuo aggiornamento: fa fede la versione pubblicata. Per esami non presenti o per dubbi su campione e trasporto contatta il laboratorio allo 055 7765108 o a laboratorio@toscanadiagnostica.it.</div></div>
      {d && <div className="small faint" style={{ marginTop: 8 }}>Verifica dell'incorporamento: {new Date(d.verificato_at).toLocaleString('it-IT')} · {d.motivo}</div>}
    </div>
  );
}

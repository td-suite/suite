// Vademecum degli esami nel SGI (richiesta del CEO, 03/11/2026): sotto Preparazioni agli esami, incorpora il Vademecum online
// https://referti.toscanadiagnostica.it/vademecum come fa il Portale Service. Riusa la verifica del server del Portale Service
// (GET /api/service/vademecum/embeddabile: X-Frame-Options e CSP frame-ancestors, cache 1 ora, aperta a tutti gli autenticati):
// se il sito consente l'incorporamento, iframe a tutta altezza; altrimenti il PDF pubblicato sul Portale Service e il pulsante
// "Apri il Vademecum online" in una nuova scheda. Nessuna copia dei dati: una sola fonte per i due widget.
import React, { useEffect, useState } from 'react';
import { Loading, useApi, useToast } from '../../../components/ui.jsx';
import { useSgi } from '../index.jsx';
import { useDati, copiaLink } from '../dati.js';
import { Piede, Ico, Ricerca } from './comuni.jsx';

// File del Portale Service (specchio di service.toscanadiagnostica.it): il PDF del Vademecum sta lì
const servicePdf = (p, dl) => `/api/service/file/${String(p).split('/').map(encodeURIComponent).join('/')}${dl ? '?dl=1' : ''}`;

export default function Vademecum() {
  const { user } = useSgi();
  const [rinnova, setRinnova] = useState(0);
  const v = useApi(`/service/vademecum/embeddabile${rinnova ? `?rinnova=1&n=${rinnova}` : ''}`, [rinnova]);
  const st = useDati('meta');
  const toast = useToast();
  const [q, setQ] = useState('');
  const [cerca, setCerca] = useState('');
  useEffect(() => { const t = setTimeout(() => setCerca(q.trim()), 500); return () => clearTimeout(t); }, [q]);
  const d = v.data;
  const pdf = d && !d.consentito && d.pdf?.disponibile ? servicePdf(d.pdf.pdf) : null;
  const copia = async () => { if (d && await copiaLink(d.url, 'Vademecum degli esami')) toast(`Link copiato: ${d.url}`); };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Vademecum degli esami</h1>
          <div className="sub">La guida completa agli esami del Laboratorio di Analisi: per ogni analita codice, metodo, tempo di refertazione, tipo di campione, sezione e valori di riferimento. Completa le Preparazioni agli esami: lì cosa dire al paziente, qui cosa fa il laboratorio.</div>
        </div>
      </div>
      <div className="grid g4">
        <div className="card kpi accent"><div className="lbl">Vademecum degli esami</div><div className="val" style={{ fontSize: 20 }}>Edizione corrente</div><div className="foot">{d?.consentito ? 'versione online, sempre aggiornata' : 'versione pubblicata sul Portale Service'}</div></div>
        <div className="card kpi"><div className="lbl">Contenuto per ogni esame</div><div className="val" style={{ fontSize: 20 }}>6 campi</div><div className="foot">codice · metodo · TAT · campione · sezione · valori di riferimento</div></div>
        <div className="card kpi"><div className="lbl">Come cercare</div><div className="val" style={{ fontSize: 20 }}>Ctrl + F</div><div className="foot">nel visualizzatore{pdf ? ', oppure la casella qui sotto' : ''}</div></div>
        <div className="card kpi"><div className="lbl">Formato</div><div className="val" style={{ fontSize: 20 }}>{d?.consentito ? 'Online' : 'PDF'}</div><div className="foot">{d?.consentito ? 'incorporato dal sito referti.toscanadiagnostica.it' : 'scaricabile e stampabile'}</div></div>
      </div>
      <div className="card mt">
        <div className="bd tools">
          {pdf && <Ricerca value={q} onChange={setQ} placeholder="Cerca un esame nel vademecum (es. creatinina, HbA1c, tampone)…" />}
          {pdf && <a className="btn" href={servicePdf(d.pdf.pdf, true)}>Scarica il PDF</a>}
          {pdf && <a className="btn ghost" href={pdf} target="_blank" rel="noopener">Apri a schermo intero</a>}
          {d && <a className={pdf ? 'btn ghost' : 'btn'} href={d.url} target="_blank" rel="noopener">Apri il Vademecum online <Ico n="external" s={15} /></a>}
          {d && <button className="btn ghost" onClick={copia}>Copia il link</button>}
          {!d && (v.error ? <span className="help">{v.error.message}</span> : <span className="help">Verifico il Vademecum online…</span>)}
        </div>
      </div>
      {d && !d.consentito && <div className="alert warn mt" style={{ marginTop: 16 }}><Ico n="info" s={18} /><div><strong>Il Vademecum online non si può incorporare qui</strong> ({d.motivo}). Lo apri in una nuova scheda con il pulsante "Apri il Vademecum online"; qui sotto la versione PDF pubblicata sul Portale Service.</div></div>}
      <div className="viewer mt">
        {!d ? <Loading text="Verifico il Vademecum online" />
          : d.consentito ? <iframe src={d.url} title="Vademecum degli esami (online)" />
            : pdf ? <iframe key={cerca} src={`${pdf}#toolbar=1&navpanes=0&view=FitH${cerca ? `&search=${encodeURIComponent(cerca)}` : ''}`} title="Vademecum degli esami" />
              : <div className="nopdf">Anche il PDF del Vademecum non è disponibile ({d.pdf?.errore || 'file mancante nello specchio del Portale Service'}). Usa il pulsante "Apri il Vademecum online".</div>}
      </div>
      <div className="alert info mt" style={{ marginTop: 16 }}>Il vademecum è un documento in continuo aggiornamento: fa fede la versione pubblicata qui. Per esami non presenti o per dubbi su campione e trasporto contatta il laboratorio allo 055 7765108 o a laboratorio@toscanadiagnostica.it.</div>
      {d && <div className="small muted">Verifica dell'incorporamento: {new Date(d.verificato_at).toLocaleString('it-IT')} · {d.motivo}
        {user?.editor && <> · <button className="btn sm ghost" title="Ripete subito la verifica dell'incorporamento (altrimenti vale per un'ora)" onClick={() => setRinnova((n) => n + 1)}>Verifica di nuovo</button></>}</div>}
      <Piede meta={st.data?.meta} />
    </div>
  );
}

// Scheda del documento: anteprima inline (PDF e immagini), download, dettagli, storico delle versioni
import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi, apiBase, base } from '../api.js';
import { Card, Loading, Empty, PageHead, Badge } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { TipoIcon, downloadUrl, anteprimaUrl, folderTo } from '../components.jsx';
import { Breadcrumb } from './Sfoglia.jsx';
import { itDate, itDateTime, kb, tipoDi } from '../format.js';

export default function Documento() {
  const { id } = useParams();
  const { data: d, loading, error } = useApi(`/documenti/${id}`, [id]);
  const versioni = useApi(`/documenti/${id}/versioni`, [id]);
  if (error) return <div className="page"><PageHead title="Documento" icon="file" /><Empty icon="alert" title={error.status === 404 ? 'Documento non trovato' : 'Dati non disponibili'}>{error.message} <Link to={base}>Torna alla cartella</Link></Empty></div>;
  if (loading || !d) return <div className="page"><Loading /></div>;
  const t = tipoDi(d);
  const img = /^image\//.test(d.mime);
  return (
    <div className="page cf-page">
      <PageHead title={d.nome} icon={t.icon} crumb={<Breadcrumb percorso={d.percorso_catena || []} />}
        sub={d.descrizione || `${t.label} · ${kb(d.size)} · versione ${d.versione}`}
        actions={<><a className="btn" href={downloadUrl(d)}><Icon name="download" />Scarica</a>{d.anteprima && <a className="btn ghost" href={anteprimaUrl(d)} target="_blank" rel="noopener"><Icon name="external" />Apri in una scheda</a>}</>} />
      <div className="cf-doc">
        <div className="cf-doc-main">
          {d.anteprima ? (img ? <div className="cf-preview img"><img src={anteprimaUrl(d)} alt={d.nome} /></div> : <div className="cf-preview pdf"><iframe title={d.nome} src={anteprimaUrl(d)} /></div>)
            : <Empty icon={t.icon} title="Anteprima non disponibile">I file {t.label} si aprono con il programma del computer: usa Scarica.</Empty>}
        </div>
        <div className="cf-doc-side">
          <Card title="Dettagli" icon="info">
            <dl className="cf-meta">
              <dt>Tipo</dt><dd><TipoIcon doc={d} size={16} /> {t.label}</dd>
              <dt>File</dt><dd>{d.filename}</dd>
              <dt>Dimensione</dt><dd>{kb(d.size)}</dd>
              <dt>Cartella</dt><dd><Link to={folderTo(d.cartella_id)}>{d.percorso || 'Cartella principale'}</Link></dd>
              <dt>Versione</dt><dd>{d.versione}</dd>
              <dt>Caricato da</dt><dd>{d.caricato_da_nome || '-'}</dd>
              <dt>Aggiornato</dt><dd>{itDateTime(d.updated_at)}</dd>
              <dt>Prima versione</dt><dd>{itDateTime(d.created_at)}</dd>
              <dt>Letto da</dt><dd>{d.n_letture} {d.n_letture === 1 ? 'persona' : 'persone'}</dd>
              {d.in_evidenza && <><dt>Evidenza</dt><dd><Badge tone={d.evidenza_attiva ? 'amber' : 'grey'} dot={false}>{d.evidenza_attiva ? 'in evidenza' : 'scaduta'}</Badge> {d.evidenza_fino ? `fino al ${itDate(d.evidenza_fino)}` : 'senza scadenza'}</dd></>}
            </dl>
          </Card>
          <Card title="Versioni" icon="clock" flush>
            {!versioni.data ? <Loading /> : (
              <ul className="cf-versioni">
                <li className="cur"><span className="strong">Versione {versioni.data.corrente.versione}</span><span className="small muted">{versioni.data.corrente.filename} · {kb(versioni.data.corrente.size)} · {itDateTime(versioni.data.corrente.created_at)}{versioni.data.corrente.caricato_da_nome ? ` · ${versioni.data.corrente.caricato_da_nome}` : ''}</span><a className="btn sm ghost" href={downloadUrl(d)}><Icon name="download" />Scarica</a></li>
                {versioni.data.precedenti.map((v) => <li key={v.id}><span>Versione {v.versione}</span><span className="small muted">{v.filename} · {kb(v.size)} · {itDateTime(v.created_at)}{v.caricato_da_nome ? ` · ${v.caricato_da_nome}` : ''}</span><a className="btn sm ghost" href={`${apiBase}/documenti/${d.id}/versioni/${v.versione}/download`}><Icon name="download" />Scarica</a></li>)}
                {!versioni.data.precedenti.length && <li className="small muted">Nessuna versione precedente.</li>}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

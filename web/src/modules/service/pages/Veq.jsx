// VEQ · Valutazione Esterna di Qualità: stessa pagina del sito (/veq), dati da veq.json e docs.json; contratto CRRVEQ e calendario
// QCMD dalla cache della Suite, documenti SGI collegati dai link stabili.
import React from 'react';
import { Card, Kpi, PageHead, Badge } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useDati, fileUrl, docUrl } from '../dati.js';
import { Piede, StatoDati } from './comuni.jsx';

const PASSI = [
  ['Campioni a titolo ignoto', 'Il CRRVEQ invia al laboratorio campioni di controllo secondo il calendario di ogni programma (più spedizioni l\'anno).'],
  ['Analisi in routine', 'I campioni sono analizzati con gli stessi strumenti, reagenti e operatori dei campioni dei pazienti.'],
  ['Confronto interlaboratorio', 'Il centro confronta i risultati con il valore assegnato e con quelli degli altri laboratori, applicando limiti di accettabilità per analita.'],
  ['Report e azioni', 'Ogni report è valutato dal Direttore Tecnico; uno scostamento genera analisi delle cause e azione correttiva tracciata (TD-SGI-PRO045, PRO082).'],
];

export default function Veq() {
  const st = useDati('veq', 'docs', 'meta');
  const blocco = StatoDati({ st });
  if (blocco) return blocco;
  const V = st.data.veq; const docs = st.data.docs;
  const prov = V.provider || {}; const qcmd = prov.QCMD;
  const acc = V.programmi.filter((p) => p.accreditato).length;
  const aree = [...new Set(V.programmi.map((p) => p.area))];
  const nProv = new Set(V.programmi.map((p) => p.provider || 'CRRVEQ')).size;
  const find = (c) => docs.find((d) => d.code.startsWith(`${c}_`));
  return (
    <div className="page sv-page">
      <PageHead title="VEQ · Valutazione Esterna di Qualità" icon="stats" sub={V.intro} />
      <div className="grid g4">
        <Kpi accent label={`Programmi VEQ · ciclo ${V.ciclo}`} value={V.programmi.length} foot={`${aree.length} aree analitiche`} />
        <Kpi label="Programmi accreditati ISO/IEC 17043" value={acc} foot="provider accreditato ACCREDIA" />
        <Kpi label="Provider VEQ" value={nProv === 1 ? 'CRRVEQ' : 'CRRVEQ + QCMD'} foot="AOU Careggi (Regione Toscana) · QCMD per la diagnostica molecolare" />
        <Kpi label="Report per laboratorio" value="per esercizio" foot="più elaborazione finale di ciclo e attestato" />
      </div>
      <Card className="mt" title="Come funziona">
        <div className="sv-steps">{PASSI.map(([t, d], i) => <div key={t} className="sv-step"><div className="n">{i + 1}</div><div className="strong">{t}</div><div className="small muted">{d}</div></div>)}</div>
      </Card>
      <div className="grid g2 mt sv-top">
        <Card title={`Programmi VEQ · ciclo ${V.ciclo}`} actions={<Badge tone="teal" dot={false}>{V.programmi.length}</Badge>}>
          {aree.map((a) => (
            <div key={a}>
              <h3 className="sv-h3">{a}</h3>
              {V.programmi.filter((p) => p.area === a).map((p) => (
                <div key={p.nome} className="sv-prog">
                  <span><span className="strong">{p.nome}</span>{p.nota && <div className="small muted">{p.nota}</div>}</span>
                  <span className="sv-actions">{p.provider && p.provider !== 'CRRVEQ' && <Badge tone="mauve" dot={false}>{p.provider}</Badge>}{p.accreditato ? <Badge tone="green" dot={false}>accreditato ISO/IEC 17043</Badge> : <Badge tone="grey" dot={false}>programma non accreditato</Badge>}</span>
                </div>
              ))}
            </div>
          ))}
          <p className="small muted" style={{ margin: '14px 0 0' }}>{V.note_ciclo}</p>
        </Card>
        <div>
          <Card title="Perché conta per chi lavora con noi"><p>{V.perche}</p></Card>
          <Card className="mt" title="Il centro VEQ">
            <p><strong>{V.centro.nome}</strong><br />{V.centro.ente}</p>
            <p className="muted">{V.centro.descrizione}</p>
            <p className="small">{V.centro.indirizzo} · tel. {V.centro.telefono} · <a href={`mailto:${V.centro.email}`}>{V.centro.email}</a> · <a href={V.centro.sito} target="_blank" rel="noopener">{V.centro.sito.replace('https://', '')}</a></p>
            {qcmd && <>
              <hr className="sv-hr" />
              <p><strong>{qcmd.nome}</strong></p>
              <p className="muted">{qcmd.descr}</p>
              <p className="small">{qcmd.sito && <a href={qcmd.sito} target="_blank" rel="noopener">{qcmd.sito.replace('https://', '')}</a>}{qcmd.calendario_pdf && <> · <a href={fileUrl(`certificati/${qcmd.calendario_pdf}`)} target="_blank" rel="noopener">Calendario programmi QCMD {V.ciclo}</a></>}</p>
            </>}
            <div className="sv-actions start">
              {V.contratto_pdf && <a className="btn sm ghost" href={fileUrl(`certificati/${V.contratto_pdf}`)} target="_blank" rel="noopener"><Icon name="doc" />Contratto CRRVEQ {V.ciclo} (firmato)</a>}
              <a className="btn sm ghost" href={V.centro.sito} target="_blank" rel="noopener"><Icon name="external" />Sito CRRVEQ Careggi</a>
            </div>
          </Card>
          <Card className="mt" title="Documenti del Sistema di Gestione">
            <div className="sv-tiles one">{V.documenti_sgi.map(find).filter(Boolean).map((d) => <a key={d.code} className="sv-tile" href={docUrl(d) || '#'} target="_blank" rel="noopener"><div className="code">{d.code}</div><div className="name">{d.title}</div></a>)}</div>
          </Card>
        </div>
      </div>
      <Piede meta={st.data.meta} />
    </div>
  );
}

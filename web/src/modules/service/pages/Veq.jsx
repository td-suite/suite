// VEQ · Valutazione Esterna di Qualità: copia conforme di veq.html del sito (riquadri .kpi, "Come funziona" a .steps, programmi
// .veq-prog con badge, perché conta, centro VEQ, documenti SGI a tessere), dati da veq.json e docs.json. Le scorciatoie della barra del
// sito (sito CRRVEQ e QCMD, contratto firmato, calendario QCMD) sono in fondo al riquadro "Il centro VEQ".
import React from 'react';
import { useDati, fileUrl, docUrl } from '../dati.js';
import { Piede, StatoDati, Ico } from './comuni.jsx';

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
  const prov = V.provider || {}; const q = prov.QCMD;
  const acc = V.programmi.filter((p) => p.accreditato).length;
  const aree = [...new Set(V.programmi.map((p) => p.area))];
  const nProv = new Set(V.programmi.map((p) => p.provider || 'CRRVEQ')).size;
  const find = (c) => docs.find((d) => d.code.startsWith(`${c}_`));
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>VEQ · Valutazione Esterna di Qualità</h1>
          <div className="sub">{V.intro}</div>
        </div>
      </div>
      <div className="grid g4">
        <div className="card kpi accent"><div className="lbl">Programmi VEQ · ciclo {V.ciclo}</div><div className="val">{V.programmi.length}</div><div className="foot">{aree.length} aree analitiche</div></div>
        <div className="card kpi"><div className="lbl">Programmi accreditati ISO/IEC 17043</div><div className="val">{acc}</div><div className="foot">provider accreditato ACCREDIA</div></div>
        <div className="card kpi"><div className="lbl">Provider VEQ</div><div className="val" style={{ fontSize: 20 }}>{nProv === 1 ? 'CRRVEQ' : 'CRRVEQ + QCMD'}</div><div className="foot">AOU Careggi (Regione Toscana) · QCMD per la diagnostica molecolare</div></div>
        <div className="card kpi"><div className="lbl">Report per laboratorio</div><div className="val" style={{ fontSize: 20 }}>per esercizio</div><div className="foot">più elaborazione finale di ciclo e attestato</div></div>
      </div>
      <div className="card mt">
        <div className="hd"><h2>Come funziona</h2></div>
        <div className="bd"><div className="steps">
          {PASSI.map(([t, d], i) => <div key={t} className="step"><div className="n">{i + 1}</div><div className="t">{t}</div><div className="d">{d}</div></div>)}
        </div></div>
      </div>
      <div className="grid g2 mt">
        <div className="card">
          <div className="hd"><h2>Programmi VEQ · ciclo {V.ciclo}</h2><span className="spacer" /><span className="badge b-teal">{V.programmi.length}</span></div>
          <div className="bd">
            {aree.map((a) => (
              <React.Fragment key={a}>
                <h3 style={{ margin: '10px 0 4px' }}>{a}</h3>
                {V.programmi.filter((p) => p.area === a).map((p) => (
                  <div key={p.nome} className="veq-prog"><span><span className="strong">{p.nome}</span>{p.nota && <div className="small muted">{p.nota}</div>}</span>
                    <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{p.provider && p.provider !== 'CRRVEQ' && <span className="badge b-mauve">{p.provider}</span>}{p.accreditato ? <span className="badge b-green">accreditato ISO/IEC 17043</span> : <span className="badge b-grey">programma non accreditato</span>}</span></div>
                ))}
              </React.Fragment>
            ))}
            <p className="small muted" style={{ margin: '14px 0 0' }}>{V.note_ciclo}</p>
          </div>
        </div>
        <div>
          <div className="card">
            <div className="hd"><h2>Perché conta per chi lavora con noi</h2></div>
            <div className="bd prose"><p>{V.perche}</p></div>
          </div>
          <div className="card mt">
            <div className="hd"><h2>Il centro VEQ</h2></div>
            <div className="bd prose">
              <p><strong>{V.centro.nome}</strong><br />{V.centro.ente}</p>
              <p className="muted">{V.centro.descrizione}</p>
              <p className="small">{V.centro.indirizzo} · tel. {V.centro.telefono} · <a href={`mailto:${V.centro.email}`}>{V.centro.email}</a> · <a href={V.centro.sito} target="_blank" rel="noopener">{V.centro.sito.replace('https://', '')}</a></p>
              {q && <>
                <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '14px 0' }} />
                <p><strong>{q.nome}</strong></p>
                <p className="muted">{q.descr}</p>
                <p className="small">{q.sito && <a href={q.sito} target="_blank" rel="noopener">{q.sito.replace('https://', '')}</a>}{q.calendario_pdf && <> · <a href={fileUrl(`certificati/${q.calendario_pdf}`)} target="_blank" rel="noopener">Calendario programmi QCMD 2026</a></>}</p>
              </>}
              {V.contratto_pdf && <p className="small"><a href={fileUrl(`certificati/${V.contratto_pdf}`)} target="_blank" rel="noopener"><Ico n="doc" s={14} /> Contratto CRRVEQ {V.ciclo} (firmato)</a></p>}
            </div>
          </div>
          <div className="card mt">
            <div className="hd"><h2>Documenti del Sistema di Gestione</h2></div>
            <div className="bd"><div className="tiles" style={{ gridTemplateColumns: '1fr' }}>
              {V.documenti_sgi.map(find).filter(Boolean).map((d) => <a key={d.code} className="tile" href={docUrl(d) || '#'} target="_blank" rel="noopener"><div className="code">{d.code}</div><div className="name">{d.title}</div></a>)}
            </div></div>
          </div>
        </div>
      </div>
      <Piede meta={st.data.meta} />
    </div>
  );
}

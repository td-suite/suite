// Certificazioni di qualità: copia conforme di certificazioni.html del sito (riquadri .kpi, card .cert con logo 150 px, campo di
// applicazione, altri requisiti, organismo), dati da certificazioni.json. Certificati PDF e loghi dalla cache della Suite; la Politica
// Integrata apre sempre la revisione in vigore (/service/doc/TD-SGI-POL001).
import React from 'react';
import { useDati, fileUrl, linkSuite } from '../dati.js';
import { Piede, StatoDati, Ico } from './comuni.jsx';

export default function Certificazioni() {
  const st = useDati('certificazioni', 'meta');
  const blocco = StatoDati({ st });
  if (blocco) return blocco;
  const C = st.data.certificazioni;
  const emessi = C.certificazioni.filter((c) => c.numero);
  const hrefAltro = (a) => (a.doc ? linkSuite('doc', a.doc) : a.pdf ? fileUrl(`certificati/${a.pdf}`) : '');
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Certificazioni di qualità</h1>
          <div className="sub">{C.intro}</div>
        </div>
      </div>
      <div className="grid g4">
        <div className="card kpi accent"><div className="lbl">Norme del Sistema di Gestione Integrato</div><div className="val">{C.certificazioni.length}</div><div className="foot">qualità, sicurezza, ambiente, anticorruzione, sanità, sociale, informazioni, inclusione, parità</div></div>
        <div className="card kpi"><div className="lbl">Certificati scaricabili</div><div className="val">{emessi.length}</div><div className="foot">{emessi[0] ? `emessi il ${emessi[0].prima_emissione} · validità triennale` : ''}</div></div>
        <div className="card kpi"><div className="lbl">Organismo di certificazione</div><div className="val" style={{ fontSize: 20 }}>EuCI</div><div className="foot">accreditato ESYD n. 831 · settore IAF 38</div></div>
        <div className="card kpi"><div className="lbl">Sedi certificate</div><div className="val" style={{ fontSize: 20 }}>2</div><div className="foot">unità operativa Sesto Fiorentino · sede legale come da certificato</div></div>
      </div>
      <div className="grid g2 mt">
        {C.certificazioni.map((c) => (
          <div key={c.norma} className="card"><div className="bd cert">
            {c.logo ? <img src={fileUrl(`static/${c.logo}`)} alt={`Logo certificazione ${c.norma}`} /> : <div className="nologo">{c.norma}</div>}
            <div>
              <div className="norma">{c.norma}</div>
              <div className="titolo">{c.titolo}</div>
              <div className="cosa">{c.cosa}</div>
              {c.numero && <>
                <dl><dt>Certificato n.</dt><dd>{c.numero}</dd><dt>Prima emissione</dt><dd>{c.prima_emissione}</dd><dt>Scadenza</dt><dd>{c.scadenza}</dd><dt>Organismo</dt><dd>EuCI · accreditamento ESYD 831</dd></dl>
                <div className="actions"><a className="btn sm" href={fileUrl(`certificati/${c.pdf}`)} target="_blank" rel="noopener"><Ico n="doc" s={14} /> Apri il certificato</a><a className="btn sm ghost" href={C.organismo.verifica} target="_blank" rel="noopener">Verifica validità su EuCI</a></div>
              </>}
            </div>
          </div></div>
        ))}
      </div>
      <div className="card mt">
        <div className="hd"><h2>Campo di applicazione certificato</h2></div>
        <div className="bd prose"><p>{C.campo}</p><p className="small muted">{C.sedi.nota}: {C.sedi.legale} · unità operativa {C.sedi.operativa} · Settore IAF {C.organismo.settore_iaf}</p></div>
      </div>
      <div className="grid g3 mt">
        {C.altri_requisiti.map((a) => (
          <div key={a.titolo} className="card"><div className="hd"><h2>{a.titolo}</h2></div><div className="bd">
            <p style={{ margin: `0 0 ${hrefAltro(a) ? '10px' : '0'}` }} className="muted">{a.testo}</p>
            {hrefAltro(a) && <a className="btn sm" href={hrefAltro(a)} target="_blank" rel="noopener"><Ico n="doc" s={14} /> Apri il documento</a>}
          </div></div>
        ))}
      </div>
      <div className="card mt">
        <div className="hd"><h2>Organismo di certificazione</h2></div>
        <div className="bd prose">
          <p><strong>{C.organismo.nome}</strong> · {C.organismo.sede}</p>
          <p className="muted">{C.organismo.accreditamento}</p>
          <p className="small muted">La validità di ogni certificato è verificabile tramite il QR code stampato sul certificato o su <a href={C.organismo.verifica} target="_blank" rel="noopener">{C.organismo.verifica.replace('https://', '')}</a>.</p>
        </div>
      </div>
      <Piede meta={st.data.meta} />
    </div>
  );
}

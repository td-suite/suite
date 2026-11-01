// Certificazioni di qualità: stessa pagina del sito (/certificazioni), dati da certificazioni.json; certificati PDF e loghi dalla
// cache della Suite; la Politica Integrata apre sempre la revisione in vigore (/service/doc/TD-SGI-POL001).
import React from 'react';
import { Card, Kpi, PageHead } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useDati, fileUrl, linkSuite } from '../dati.js';
import { Piede, StatoDati } from './comuni.jsx';

export default function Certificazioni() {
  const st = useDati('certificazioni', 'meta');
  const blocco = StatoDati({ st });
  if (blocco) return blocco;
  const C = st.data.certificazioni;
  const emessi = C.certificazioni.filter((c) => c.numero);
  const hrefAltro = (a) => (a.doc ? linkSuite('doc', a.doc) : a.pdf ? fileUrl(`certificati/${a.pdf}`) : '');
  return (
    <div className="page sv-page">
      <PageHead title="Certificazioni di qualità" icon="shield" sub={C.intro} />
      <div className="grid g4">
        <Kpi accent label="Norme del Sistema di Gestione Integrato" value={C.certificazioni.length} foot="qualità, sicurezza, ambiente, anticorruzione, sanità, sociale, informazioni, inclusione, parità" />
        <Kpi label="Certificati scaricabili" value={emessi.length} foot={emessi[0] ? `emessi il ${emessi[0].prima_emissione} · validità triennale` : ''} />
        <Kpi label="Organismo di certificazione" value="EuCI" foot="accreditato ESYD n. 831 · settore IAF 38" />
        <Kpi label="Sedi certificate" value="2" foot="unità operativa Sesto Fiorentino · sede legale come da certificato" />
      </div>
      <div className="grid g2 mt">
        {C.certificazioni.map((c) => (
          <div key={c.norma} className="card"><div className="bd sv-cert">
            {c.logo ? <img src={fileUrl(`static/${c.logo}`)} alt={`Logo certificazione ${c.norma}`} /> : <div className="sv-nologo">{c.norma}</div>}
            <div>
              <div className="sv-norma">{c.norma}</div>
              <div className="strong">{c.titolo}</div>
              <div className="small muted" style={{ marginTop: 4 }}>{c.cosa}</div>
              {c.numero && <>
                <dl className="sv-dl"><dt>Certificato n.</dt><dd>{c.numero}</dd><dt>Prima emissione</dt><dd>{c.prima_emissione}</dd><dt>Scadenza</dt><dd>{c.scadenza}</dd><dt>Organismo</dt><dd>EuCI · accreditamento ESYD 831</dd></dl>
                <div className="sv-actions start"><a className="btn sm" href={fileUrl(`certificati/${c.pdf}`)} target="_blank" rel="noopener"><Icon name="doc" />Apri il certificato</a><a className="btn sm ghost" href={C.organismo.verifica} target="_blank" rel="noopener">Verifica validità su EuCI</a></div>
              </>}
            </div>
          </div></div>
        ))}
      </div>
      <Card className="mt" title="Campo di applicazione certificato">
        <p>{C.campo}</p>
        <p className="small muted">{C.sedi.nota}: {C.sedi.legale} · unità operativa {C.sedi.operativa} · Settore IAF {C.organismo.settore_iaf}</p>
      </Card>
      <div className="grid g3 mt">
        {C.altri_requisiti.map((a) => (
          <Card key={a.titolo} title={a.titolo}>
            <p className="muted" style={{ margin: hrefAltro(a) ? '0 0 10px' : 0 }}>{a.testo}</p>
            {hrefAltro(a) && <a className="btn sm" href={hrefAltro(a)} target="_blank" rel="noopener"><Icon name="doc" />Apri il documento</a>}
          </Card>
        ))}
      </div>
      <Card className="mt" title="Organismo di certificazione">
        <p><strong>{C.organismo.nome}</strong> · {C.organismo.sede}</p>
        <p className="muted">{C.organismo.accreditamento}</p>
        <p className="small muted">La validità di ogni certificato è verificabile tramite il QR code stampato sul certificato o su <a href={C.organismo.verifica} target="_blank" rel="noopener">{C.organismo.verifica.replace('https://', '')}</a>.</p>
      </Card>
      <Piede meta={st.data.meta} />
    </div>
  );
}

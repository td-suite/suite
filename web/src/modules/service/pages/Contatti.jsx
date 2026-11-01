// Contatti: copia conforme di contatti.html del sito (gruppi con h3, card .contact, la card primaria scura del Laboratorio,
// riquadro dell'azienda), dati da contatti.json.
import React from 'react';
import { useDati } from '../dati.js';
import { Piede, StatoDati, Ico } from './comuni.jsx';

const tel = (t) => `tel:+39${String(t).replace(/\s+/g, '')}`;

export default function Contatti() {
  const st = useDati('contatti', 'meta');
  const blocco = StatoDati({ st });
  if (blocco) return blocco;
  const C = st.data.contatti; const a = C.azienda;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Contatti</h1>
          <div className="sub">Per campioni, richieste, referti e preparazioni il riferimento è il Laboratorio di Analisi. Gli altri contatti servono per gli aspetti sanitari, operativi, contrattuali e amministrativi del rapporto di service.</div>
        </div>
      </div>
      <div>{C.gruppi.map((g) => (
        <React.Fragment key={g.titolo}>
          <h3 style={{ margin: '18px 0 4px' }}>{g.titolo}</h3>
          <div className="small muted" style={{ marginBottom: 10 }}>{g.sub}</div>
          <div className="grid g3">{g.contatti.map((c) => (
            <div key={`${c.ruolo}-${c.email}-${c.nome}`} className={`card contact${c.primario ? ' primary' : ''}`}><div className="bd">
              <div className="ruolo">{c.ruolo}</div>
              <div className="nome">{c.nome || 'Toscana Diagnostica'}</div>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {c.email && <a href={`mailto:${c.email}`}><Ico n="mail" />{c.email}</a>}
                {c.email2 && <a href={`mailto:${c.email2}`}><Ico n="mail" />{c.email2}</a>}
                {c.tel && <a href={tel(c.tel)}><Ico n="phone" />{c.tel}</a>}
                {c.cell && <a href={tel(c.cell)}><Ico n="phone" />{c.cell} <span className="small muted">cellulare</span></a>}
              </div>
            </div></div>
          ))}</div>
        </React.Fragment>
      ))}</div>
      <div className="card mt">
        <div className="hd"><h2>Toscana Diagnostica S.r.l.</h2></div>
        <div className="bd prose">
          <p>{a.sede_legale === a.sede_operativa
            ? <><Ico n="pin" s={15} /> <strong>Sede legale, operativa e laboratorio:</strong> {a.sede_operativa}</>
            : <><Ico n="pin" s={15} /> <strong>Sede operativa e laboratorio:</strong> {a.sede_operativa}<br /><Ico n="pin" s={15} /> <strong>Sede legale:</strong> {a.sede_legale}</>}</p>
          <p className="muted">P. IVA e C.F. {a.piva} · PEC <a href={`mailto:${a.pec}`}>{a.pec}</a> · <a href={a.sito} target="_blank" rel="noopener">{a.sito.replace('https://', '')}</a></p>
          <p><a className="btn ghost sm" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.sede_operativa)}`} target="_blank" rel="noopener"><Ico n="map" s={14} /> Apri in Google Maps</a></p>
        </div>
      </div>
      <Piede meta={st.data.meta} />
    </div>
  );
}

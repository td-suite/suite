// Contatti: stessa pagina del sito (/contatti), dati da contatti.json.
import React from 'react';
import { Card, PageHead } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useDati } from '../dati.js';
import { Piede, StatoDati } from './comuni.jsx';

const tel = (t) => `tel:+39${String(t).replace(/\s+/g, '')}`;

export default function Contatti() {
  const st = useDati('contatti', 'meta');
  const blocco = StatoDati({ st });
  if (blocco) return blocco;
  const C = st.data.contatti; const a = C.azienda;
  return (
    <div className="page sv-page">
      <PageHead title="Contatti" icon="users" sub="Per campioni, richieste, referti e preparazioni il riferimento è il Laboratorio di Analisi. Gli altri contatti servono per gli aspetti sanitari, operativi, contrattuali e amministrativi del rapporto di service." />
      {C.gruppi.map((g) => (
        <div key={g.titolo}>
          <h3 className="sv-h3" style={{ marginTop: 18 }}>{g.titolo}</h3>
          <div className="small muted" style={{ marginBottom: 10 }}>{g.sub}</div>
          <div className="grid g3">{g.contatti.map((c) => (
            <div key={`${c.ruolo}-${c.email}`} className={`card sv-contact ${c.primario ? 'primary' : ''}`}><div className="bd">
              <div className="sv-ruolo">{c.ruolo}</div>
              <div className="strong">{c.nome || 'Toscana Diagnostica'}</div>
              <div className="sv-recapiti">
                {c.email && <a href={`mailto:${c.email}`}><Icon name="mail" />{c.email}</a>}
                {c.email2 && <a href={`mailto:${c.email2}`}><Icon name="mail" />{c.email2}</a>}
                {c.tel && <a href={tel(c.tel)}><Icon name="phone" />{c.tel}</a>}
                {c.cell && <a href={tel(c.cell)}><Icon name="phone" />{c.cell} <span className="small muted">cellulare</span></a>}
              </div>
            </div></div>
          ))}</div>
        </div>
      ))}
      <Card className="mt" title={a.ragione_sociale || 'Toscana Diagnostica S.r.l.'}>
        <p>{a.sede_legale === a.sede_operativa ? <><Icon name="pin" /> <strong>Sede legale, operativa e laboratorio:</strong> {a.sede_operativa}</> : <><Icon name="pin" /> <strong>Sede operativa e laboratorio:</strong> {a.sede_operativa}<br /><Icon name="pin" /> <strong>Sede legale:</strong> {a.sede_legale}</>}</p>
        <p className="muted">P. IVA e C.F. {a.piva} · PEC <a href={`mailto:${a.pec}`}>{a.pec}</a> · <a href={a.sito} target="_blank" rel="noopener">{a.sito.replace('https://', '')}</a></p>
        <p><a className="btn ghost sm" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.sede_operativa)}`} target="_blank" rel="noopener"><Icon name="pin" />Apri in Google Maps</a></p>
      </Card>
      <Piede meta={st.data.meta} />
    </div>
  );
}

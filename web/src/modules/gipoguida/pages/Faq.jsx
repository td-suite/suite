// Guida GIPO · FAQ pubblicate, divise per capitolo, con ricerca (full text, sinonimi). ?voce=ID apre e mostra una FAQ (link delle
// notifiche "c'è la risposta alla tua domanda" e dei risultati della ricerca).
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorBox, PageHead, Skeleton } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { sanitizeSnippet } from '../../../format.js';
import { base, qs, useApi } from '../api.js';
import { Bollino, TestoGuida } from '../components.jsx';

const RUOLO = { accettazione: 'Accettazione', medico: 'Medico', amministrazione: 'Amministrazione' };

export default function Faq() {
  const [sp] = useSearchParams();
  const voce = Number(sp.get('voce')) || null;
  const [q, setQ] = useState('');
  const [qd, setQd] = useState('');
  const [ruolo, setRuolo] = useState('');
  useEffect(() => { const h = setTimeout(() => setQd(q.trim()), 250); return () => clearTimeout(h); }, [q]);
  const faq = useApi(`/faq${qs({ q: qd.length >= 2 ? qd : '' })}`, [], { silent: true });
  const voci = useMemo(() => (faq.data?.voci || []).filter((f) => !ruolo || f.ruolo === ruolo), [faq.data, ruolo]);
  const gruppi = useMemo(() => {
    if (qd.length >= 2) return [{ chiave: 'r', titolo: `${voci.length} risultat${voci.length === 1 ? 'o' : 'i'} per "${qd}"`, voci }];
    const m = new Map();
    for (const f of voci) {
      const k = f.capitolo ?? 'altro';
      if (!m.has(k)) m.set(k, { chiave: k, titolo: f.capitolo != null ? `${f.capitolo}. ${f.capitolo_titolo}` : 'Altre domande', voci: [] });
      m.get(k).voci.push(f);
    }
    return [...m.values()];
  }, [voci, qd]);
  useEffect(() => { if (voce && faq.data) setTimeout(() => document.getElementById(`faq-${voce}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80); }, [voce, faq.data]);

  return (
    <div className="page gg-page gg-faq">
      <PageHead title="Domande frequenti" icon="list" sub={faq.data ? `${faq.data.totale} domande, con il rimando alla sezione della guida. Le nuove nascono dalle domande del personale.` : 'Le domande più comuni su GipoNext'}
        actions={<Link className="btn ghost" to={base}><Icon name="comment" />Non trovi la risposta? Chiedi</Link>} />
      <div className="gg-faq-filtri">
        <div className="gg-indice-cerca gg-faq-cerca"><Icon name="search" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca tra le FAQ (es. cassa, storno, ricetta)" aria-label="Cerca tra le FAQ" /></div>
        <div className="seg" role="group" aria-label="Ruolo">
          {[['', 'Tutti'], ['accettazione', 'Accettazione'], ['medico', 'Medico'], ['amministrazione', 'Amministrazione']].map(([v, l]) => <button key={v} type="button" className={ruolo === v ? 'on' : ''} onClick={() => setRuolo(v)}>{l}</button>)}
        </div>
      </div>
      <ErrorBox error={faq.error} />
      {!faq.data && faq.loading && <Skeleton lines={8} />}
      {faq.data && !voci.length && <div className="gg-vuoto muted"><Icon name="info" /> Nessuna FAQ trovata. Prova con altre parole oppure fai la domanda nella pagina Chiedi: arriverà alla redazione.</div>}
      {gruppi.map((g) => (
        <section key={g.chiave} className="gg-faq-gruppo">
          <h2>{g.titolo}</h2>
          {g.voci.map((f) => (
            <details key={f.id} id={`faq-${f.id}`} open={f.id === voce} className={`gg-faq-voce card ${f.id === voce ? 'evid' : ''}`}>
              <summary>
                <span className="gg-faq-d">{f.domanda}</span>
                {f.origine === 'DOMANDA_UTENTE' && <span className="badge b-teal nodot">dalla redazione</span>}
                {f.ruolo && <span className="badge b-grey nodot">{RUOLO[f.ruolo]}</span>}
              </summary>
              {f.snippet && qd && <div className="small muted gg-snip" dangerouslySetInnerHTML={{ __html: sanitizeSnippet(f.snippet) }} />}
              <TestoGuida source={f.risposta} />
              {f.sezione_slug && <div className="gg-faq-sez small"><Icon name="doc" /><Link to={`${base}/guida/${f.sezione_slug}`}>Sezione: {f.sezione_titolo}</Link><Bollino stato={f.sezione_stato} compatto /></div>}
            </details>
          ))}
        </section>
      ))}
    </div>
  );
}

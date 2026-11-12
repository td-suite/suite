// Guida GIPO · Guida: indice a sinistra (capitoli e sezioni, con ricerca immediata), sezione a destra con bollino di stato, percorso in GIPO,
// "Apri in GIPO" (solo pagine di consultazione, scheda nuova), FAQ collegate, precedente e successiva. In alto "Scarica la guida PDF" e
// l'anteprima del PDF completo.
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Card, ErrorBox, Modal, PageHead, Skeleton } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { api, base, qs, useApi } from '../api.js';
import { useAuth, isAdmin } from '../auth.jsx';
import { Bollino, Risultati, TestoGuida, itData } from '../components.jsx';

function Indice({ indice, slug, onScelta }) {
  const [q, setQ] = useState('');
  const [ris, setRis] = useState(null);
  const capCorrente = indice?.capitoli?.find((k) => k.sezioni.some((s) => s.slug === slug))?.numero;
  const [aperti, setAperti] = useState(() => new Set());
  useEffect(() => { if (capCorrente != null) setAperti((a) => new Set(a).add(capCorrente)); }, [capCorrente]);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setRis(null); return undefined; }
    const h = setTimeout(() => api.get(`/cerca${qs({ q: t })}`, { silent: true }).then((r) => setRis(r.risultati)).catch(() => setRis([])), 220);
    return () => clearTimeout(h);
  }, [q]);
  const apri = (n) => setAperti((a) => { const x = new Set(a); if (x.has(n)) x.delete(n); else x.add(n); return x; });
  return (
    <nav className="gg-indice card" aria-label="Indice della guida">
      <div className="gg-indice-cerca"><Icon name="search" /><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca nella guida" aria-label="Cerca nella guida" /></div>
      {ris ? <Risultati risultati={ris} vuoto="Nessuna sezione o FAQ con queste parole." onApri={() => { setQ(''); onScelta?.(); }} /> : (
        <ol className="gg-capitoli">
          {(indice?.capitoli || []).map((k) => (
            <li key={k.numero} className={aperti.has(k.numero) ? 'aperto' : ''}>
              <button type="button" className="gg-cap" onClick={() => apri(k.numero)} aria-expanded={aperti.has(k.numero)}>
                <span className="gg-cap-n">{k.numero}</span><span className="gg-cap-t">{k.titolo}</span><Icon name="chevron" />
              </button>
              {aperti.has(k.numero) && (
                <ol className="gg-sezioni">
                  {k.sezioni.map((s) => (
                    <li key={s.slug}><Link to={`${base}/guida/${s.slug}`} className={s.slug === slug ? 'on' : ''} onClick={onScelta}>
                      <span className="gg-sez-n">{s.numero}</span><span>{s.titolo}</span>{s.stato !== 'VALIDATA' && <i className="gg-dot" title="da validare" />}
                    </Link></li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ol>
      )}
    </nav>
  );
}

function Panoramica({ indice }) {
  const t = indice?.totali;
  return (
    <div className="gg-panoramica">
      <Card title="Come è fatta la guida" icon="info">
        <p>La guida descrive GipoNext come configurato per Toscana Diagnostica: {t?.sezioni} sezioni in {indice?.capitoli?.length} capitoli e {t?.faq} domande frequenti. Ogni sezione dice a cosa serve una funzione, dove si trova nel menu, cosa c'è nella schermata, come si fa e a cosa fare attenzione.</p>
        <div className="alert warn"><Icon name="alert" /><span><b>{t?.da_validare} sezioni su {t?.sezioni} sono da validare.</b> Sono state scritte dall'analisi dell'interfaccia del 12/11/2026: nomi di menu, campi e pulsanti sono reali, le procedure vanno confermate da chi usa GIPO ogni giorno.</span></div>
      </Card>
      <div className="gg-cap-griglia">
        {(indice?.capitoli || []).map((k) => (
          <Link key={k.numero} className="gg-cap-card card" to={`${base}/guida/${k.sezioni[0]?.slug || ''}`}>
            <span className="gg-cap-n">{k.numero}</span>
            <b>{k.titolo}</b>
            {k.intro && <span className="small muted">{k.intro}</span>}
            <span className="small faint">{k.sezioni.length} sezion{k.sezioni.length === 1 ? 'e' : 'i'}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Sezione({ slug }) {
  const { user } = useAuth();
  const s = useApi(`/sezioni/${encodeURIComponent(slug)}`, [slug]);
  useEffect(() => { document.querySelector('.gg-sezione')?.scrollIntoView?.({ block: 'start' }); }, [slug]);
  if (s.error) return <ErrorBox error={s.error} />;
  if (!s.data) return <Card><Skeleton lines={10} /></Card>;
  const x = s.data;
  return (
    <article className="gg-sezione card">
      <header className="gg-sez-hd">
        <div className="gg-sez-cap small muted">Capitolo {x.capitolo} · {x.capitolo_titolo}</div>
        <h2><span className="gg-sez-num">{x.numero}</span>{x.titolo}</h2>
        <div className="gg-sez-meta">
          <Bollino stato={x.stato} />
          {x.percorso_gipo && <span className="small muted">Percorso in GIPO: <code>{x.percorso_gipo}</code></span>}
          {x.link_gipo && <a className="btn sm ghost" href={x.link_gipo} target="_blank" rel="noopener noreferrer"><Icon name="external" />Apri in GIPO</a>}
          {isAdmin(user) && <Link className="btn sm ghost" to={`${base}/redazione/sezioni/${x.id}`}><Icon name="edit" />Modifica</Link>}
        </div>
        {x.stato === 'VALIDATA' && x.validata_il && <div className="small muted">Validata il {itData(x.validata_il)}{x.validata_da_nome ? ` da ${x.validata_da_nome}` : ''}</div>}
      </header>
      <TestoGuida source={x.corpo} />
      {x.faq?.length > 0 && (
        <section className="gg-sez-faq">
          <h3><Icon name="comment" />Domande frequenti su questo argomento</h3>
          {x.faq.map((f) => (
            <details key={f.id}><summary>{f.domanda}{f.origine === 'DOMANDA_UTENTE' && <span className="badge b-teal nodot">dalla redazione</span>}</summary><TestoGuida source={f.risposta} /></details>
          ))}
        </section>
      )}
      <footer className="gg-sez-ft">
        {x.precedente ? <Link className="btn ghost sm" to={`${base}/guida/${x.precedente.slug}`}><Icon name="back" />{x.precedente.numero} {x.precedente.titolo}</Link> : <span />}
        <span className="small faint">Aggiornata il {itData(x.aggiornata_il)}{x.aggiornata_da_nome ? ` da ${x.aggiornata_da_nome}` : ''}</span>
        {x.successiva ? <Link className="btn ghost sm" to={`${base}/guida/${x.successiva.slug}`}>{x.successiva.numero} {x.successiva.titolo}<Icon name="chevron" /></Link> : <span />}
      </footer>
    </article>
  );
}

export default function Guida() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const indice = useApi('/indice', [], { silent: true });
  const [anteprima, setAnteprima] = useState(false);
  const [indiceMobile, setIndiceMobile] = useState(false);
  const esiste = useMemo(() => !slug || indice.data?.capitoli?.some((k) => k.sezioni.some((s) => s.slug === slug)), [slug, indice.data]);
  useEffect(() => { if (indice.data && !esiste) navigate(`${base}/guida`, { replace: true }); }, [esiste, indice.data, navigate]);
  return (
    <div className="page gg-page gg-guida">
      <PageHead title="Guida GipoNext" icon="doc" sub={indice.data ? `${indice.data.totali.sezioni} sezioni, ${indice.data.totali.faq} FAQ · aggiornata il ${itData(indice.data.totali.aggiornata_il)}` : 'Indice, sezioni e PDF'}
        actions={<>
          <button type="button" className="btn ghost gg-solo-mobile" onClick={() => setIndiceMobile((v) => !v)}><Icon name="list" />Indice</button>
          <button type="button" className="btn ghost" onClick={() => setAnteprima(true)}><Icon name="eye" />Anteprima PDF</button>
          <a className="btn" href="/api/gipoguida/guida.pdf?scarica=1"><Icon name="download" />Scarica la guida PDF</a>
        </>} />
      <ErrorBox error={indice.error} />
      <div className={`gg-layout ${indiceMobile ? 'indice-aperto' : ''}`}>
        <Indice indice={indice.data} slug={slug} onScelta={() => setIndiceMobile(false)} />
        <div className="gg-contenuto">{slug ? <Sezione slug={slug} /> : <Panoramica indice={indice.data} />}</div>
      </div>
      {anteprima && (
        <Modal title="Anteprima della guida PDF" onClose={() => setAnteprima(false)} wide
          footer={<><span className="small muted">Il PDF si genera dalle sezioni correnti: ogni modifica della redazione è subito inclusa.</span><a className="btn" href="/api/gipoguida/guida.pdf?scarica=1"><Icon name="download" />Scarica</a></>}>
          <iframe className="gg-pdf" title="Guida GipoNext in PDF" src="/api/gipoguida/guida.pdf#view=FitH" />
        </Modal>
      )}
    </div>
  );
}

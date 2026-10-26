import React, { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi, Card, Badge, Skeleton, Empty, Coming, ErrorBox } from '../components/ui.jsx';
import { Icon } from '../components/Icons.jsx';
import SearchBar from '../components/SearchBar.jsx';
import { sanitizeSnippet } from '../format.js';

const KIND = {
  news: { label: 'News', tone: 'teal', icon: 'news' }, circolare: { label: 'Circolare', tone: 'mauve', icon: 'file' }, circolare_td: { label: 'Circolare aziendale', tone: 'mauve', icon: 'doc' }, ticket: { label: 'Ticket', tone: 'teal', icon: 'ticket' }, blog: { label: 'Blog', tone: 'amber', icon: 'edit' },
  post: { label: 'Bacheca', tone: 'blue', icon: 'comment' }, event: { label: 'Evento', tone: 'green', icon: 'calendar' }, person: { label: 'Persona', tone: 'mauve', icon: 'user' },
  site: { label: 'Sede', tone: 'grey', icon: 'building' }, org: { label: 'Legal entity', tone: 'grey', icon: 'folder' }, module: { label: 'Modulo', tone: 'teal', icon: 'grid' },
  file: { label: 'File', tone: 'grey', icon: 'file' },
};
const kindOf = (k = '') => KIND[String(k).toLowerCase()] || { label: k, tone: 'grey', icon: 'info' };

function ResultLink({ r, children, index }) {
  const cls = 'result';
  if (!r.link) return <div className={cls} id={`src-${index}`}>{children}</div>;
  if (/^https?:/.test(r.link) || r.link.startsWith('/go/') || r.link.startsWith('/api/')) return <a className={cls} href={r.link} id={`src-${index}`}>{children}</a>;
  return <Link className={cls} to={r.link} id={`src-${index}`}>{children}</Link>;
}

export default function Search() {
  const [sp] = useSearchParams();
  const q = sp.get('q') || '';
  const kind = sp.get('kind') || '';
  const { data, loading, error, unavailable } = useApi(q ? `/search?q=${encodeURIComponent(q)}${kind ? `&kind=${encodeURIComponent(kind)}` : ''}` : null, [q, kind]);
  useEffect(() => { document.title = q ? `${q} · Ricerca · Suite TD` : 'Ricerca · Suite TD'; return () => { document.title = 'Suite TD'; }; }, [q]);

  const groups = useMemo(() => {
    const g = new Map();
    (data?.results || []).forEach((r, i) => { const k = String(r.kind || 'altro').toLowerCase(); if (!g.has(k)) g.set(k, []); g.get(k).push({ ...r, index: i + 1 }); });
    return [...g.entries()];
  }, [data]);

  return (
    <div className="page narrow">
      <SearchBar key={q} initial={q} autoFocus={!q} compact={Boolean(q)} />
      {!q && <Empty icon="search" title="Cerca in tutta Toscana Diagnostica">News, circolari, bacheca, eventi, colleghi, sedi e moduli. Puoi anche fare una domanda in linguaggio naturale.</Empty>}
      {q && loading && <Card><Skeleton lines={4} /></Card>}
      {q && unavailable && <Card><Coming what="La ricerca globale" /></Card>}
      {q && error && !unavailable && <ErrorBox error={error} />}
      {q && data && (
        <>
          {data.answer?.text && (
            <Card className="answer" title="Risposta" icon="sparkle">
              <div className="ans">{data.answer.text}</div>
              {data.answer.sources?.length > 0 && (
                <div className="src">
                  {data.answer.sources.map((s, i) => {
                    const idx = typeof s === 'number' ? s : s.index ?? i + 1;
                    const r = data.results[idx - 1] || (typeof s === 'object' ? s : null);
                    const label = r?.title || `Fonte ${idx}`;
                    return <a key={i} href={`#src-${idx}`}><b>{idx}</b>{label}</a>;
                  })}
                </div>
              )}
              <div className="tiny muted mt">La risposta considera solo i contenuti che puoi vedere. I dati dei pazienti sono esclusi.</div>
            </Card>
          )}
          {!data.results?.length && <Empty icon="search" title="Nessun risultato">Prova con altre parole oppure controlla l'ortografia.</Empty>}
          {groups.map(([k, rows]) => {
            const meta = kindOf(k);
            return (
              <Card key={k} className="mt2" flush title={<><Badge tone={meta.tone}>{meta.label}</Badge><span className="small muted">{rows.length}</span></>}>
                {rows.map((r) => (
                  <ResultLink key={r.index} r={r} index={r.index}>
                    <span className="num-src" aria-hidden="true">{r.index}</span>
                    <div style={{ minWidth: 0 }}>
                      <div className="t">{r.title}</div>
                      {r.snippet && <div className="sn" dangerouslySetInnerHTML={{ __html: sanitizeSnippet(r.snippet) }} />}
                      {r.module_key && <div className="tiny faint mt" style={{ marginTop: 2 }}>Modulo: {r.module_key}</div>}
                    </div>
                    <Icon name="chevron" style={{ color: 'var(--faint)', marginLeft: 'auto', alignSelf: 'center' }} />
                  </ResultLink>
                ))}
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}

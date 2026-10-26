// Ricerca nei documenti (nome, descrizione, nome originale, percorso) e nelle cartelle
import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../api.js';
import { Card, Loading, Empty, PageHead, SearchInput } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { folderTo } from '../components.jsx';
import { TabellaDocumenti } from './Elenco.jsx';

export default function Cerca() {
  const [sp, setSp] = useSearchParams();
  const [text, setText] = useState(sp.get('q') || '');
  const [q, setQ] = useState(text.trim());
  useEffect(() => { const t = setTimeout(() => { const v = text.trim(); setQ(v); setSp(v ? { q: v } : {}, { replace: true }); }, 350); return () => clearTimeout(t); }, [text, setSp]);
  const { data, loading, error } = useApi(q.length >= 2 ? `/cerca?q=${encodeURIComponent(q)}` : null, [q]);
  return (
    <div className="page cf-page">
      <PageHead title="Cerca" icon="search" sub="Cerca per nome del documento, descrizione, nome del file originale o cartella. La ricerca generale della Suite (tasto /) trova gli stessi documenti." />
      <div className="cf-search"><SearchInput value={text} onChange={setText} placeholder="Cerca un documento o una cartella" autoFocus /></div>
      {q.length < 2 ? <Empty icon="search" title="Scrivi almeno due caratteri" compact /> : error ? <Empty icon="alert" title="Ricerca non disponibile">{error.message}</Empty> : loading && !data ? <Loading /> : (
        <>
          {data?.cartelle?.length > 0 && <Card title={`Cartelle (${data.cartelle.length})`} icon="folder"><div className="cf-chips">{data.cartelle.map((c) => <Link key={c.id} className="cf-chip" to={folderTo(c.id)}><Icon name="folder" />{c.percorso}<span className="muted">· {c.n_documenti} doc.</span></Link>)}</div></Card>}
          {data?.documenti?.length ? <TabellaDocumenti rows={data.documenti} /> : <Empty icon="search" title="Nessun documento trovato">Prova con una parola diversa o più corta.</Empty>}
        </>
      )}
    </div>
  );
}

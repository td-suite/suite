// Agorà · il blog: elenco degli articoli e articolo (/service/agora/<slug>) da blog.json; newsletter come sul sito: il form Brevo in
// iframe se brevo_url c'è, altrimenti il pulsante mailto a fallback_email.
import React from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { PageHead, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useDati, base, copiaLink } from '../dati.js';
import { Piede, StatoDati } from './comuni.jsx';

const ord = (d) => String(d || '').split('/').reverse().join('');

export default function Agora() {
  const { slug } = useParams();
  const st = useDati('blog', 'meta');
  const toast = useToast();
  const blocco = StatoDati({ st });
  if (blocco) return blocco;
  const B = st.data.blog;
  const posts = (B.post || []).slice().sort((a, b) => ord(b.data).localeCompare(ord(a.data)));
  const post = slug ? posts.find((p) => p.slug === slug) : null;
  if (slug && !post) return <Navigate to={`${base}/agora`} replace />;
  const N = B.newsletter || {};
  const ini = (n) => String(n || '').split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="page sv-page">
      {post ? (
        <>
          <div className="small" style={{ marginBottom: 14 }}><Link to={`${base}/agora`}><Icon name="news" /> Agorà</Link> <span className="muted">· {post.data}</span></div>
          <article className="card sv-article"><div className="bd">
            <h1>{post.titolo}</h1>
            <div className="sv-byline"><span className="sv-av">{ini(post.autore)}</span><span><strong>{post.autore}</strong><br />{post.ruolo || ''}</span><span className="spacer" /><span className="small muted">{post.data}{post.tempo ? ` · lettura ${post.tempo}` : ''}</span></div>
            <div className="sv-body">{post.corpo.map((p, i) => <p key={i}>{p}</p>)}</div>
            <div className="sv-actions start">
              <button className="btn sm ghost" onClick={async () => { if (await copiaLink(window.location.href, post.titolo)) toast('Link copiato'); }}><Icon name="copy" />Copia il link all'articolo</button>
              <a className="btn sm ghost" href={`mailto:?subject=${encodeURIComponent(`${post.titolo} · Agorà Toscana Diagnostica`)}&body=${encodeURIComponent(window.location.href)}`}><Icon name="mail" />Invia per e-mail</a>
            </div>
          </div></article>
        </>
      ) : (
        <>
          <PageHead title={B.titolo} icon="news" sub={B.sottotitolo} />
          <div className="sv-posts">{posts.map((p) => (
            <Link key={p.slug} className="sv-tile post" to={`${base}/agora/${p.slug}`}><div className="name">{p.titolo}</div><div className="small muted">{p.sommario}</div><div className="small faint">{p.autore} · {p.data}{p.tempo ? ` · ${p.tempo}` : ''}</div></Link>
          ))}</div>
        </>
      )}
      <div className="card mt sv-newsletter"><div className="bd">
        <div><h2>{N.titolo || 'Newsletter'}</h2><p className="muted">{N.testo || ''}</p></div>
        {N.brevo_url ? <iframe src={N.brevo_url} title="Iscrizione newsletter" loading="lazy" />
          : <a className="btn" href={`mailto:${N.fallback_email || 'service@toscanadiagnostica.it'}?subject=${encodeURIComponent('Iscrizione newsletter Agorà')}`}><Icon name="mail" />Iscriviti</a>}
      </div></div>
      <Piede meta={st.data.meta} />
    </div>
  );
}

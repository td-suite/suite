// Agorà · il blog: copia conforme di agora.html del sito (elenco .tiles.post-list, articolo .article con .byline, fascia scura
// .newsletter), dati da blog.json. Articolo su /service/agora/<slug>.
// Newsletter (richiesta del CEO, 01/11/2026): fascia scura come il sito; dentro, il form Brevo in iframe se si carica entro 4 secondi
// (prima il server della Suite verifica che Brevo risponda e ne consenta l'incorporamento: GET /api/service/newsletter/embeddabile;
// l'evento load da solo non basta, scatta anche sulle pagine d'errore), altrimenti campo e-mail + "Iscriviti" che apre la pagina Brevo (brevo_url) in una scheda nuova con l'e-mail precompilata, oppure il
// programma di posta verso fallback_email se brevo_url manca. Finché l'iframe non risponde si vede già il campo e-mail: mai un riquadro
// bianco vuoto.
import React, { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useApi, useToast } from '../../../components/ui.jsx';
import { useDati, base, copiaLink } from '../dati.js';
import { Piede, StatoDati, Ico } from './comuni.jsx';

const ord = (d) => String(d || '').split('/').reverse().join('');
const ATTESA_MS = 4000;

/** Pagina Brevo con l'e-mail precompilata (parametro EMAIL, come il campo del form Brevo) */
export const urlBrevo = (url, email) => {
  if (!email) return url;
  try { const u = new URL(url); u.searchParams.set('EMAIL', email); return u.toString(); } catch { return url; }
};

function Newsletter({ N }) {
  const fallback = N.fallback_email || 'service@toscanadiagnostica.it';
  const prova = useApi('/service/newsletter/embeddabile');
  const [iframe, setIframe] = useState(N.brevo_url ? 'verifica' : 'no');   // verifica | attesa | ok | no
  useEffect(() => {
    if (iframe !== 'verifica' || (!prova.data && !prova.error)) return;
    setIframe(prova.data?.consentito ? 'attesa' : 'no');
  }, [prova.data, prova.error, iframe]);
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    if (iframe !== 'attesa') return undefined;
    const t = setTimeout(() => setIframe((s) => (s === 'attesa' ? 'no' : s)), ATTESA_MS);
    return () => clearTimeout(t);
  }, [iframe]);
  const iscriviti = (e) => {
    e.preventDefault();
    const v = email.trim();
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { setMsg({ ok: false, t: 'Inserisci un indirizzo e-mail valido.' }); return; }
    if (N.brevo_url) {
      window.open(urlBrevo(N.brevo_url, v), '_blank', 'noopener');
      setMsg({ ok: true, t: 'Si è aperta la pagina di iscrizione in una nuova scheda: completa lì l\'iscrizione.' });
    } else {
      window.location.href = `mailto:${fallback}?subject=${encodeURIComponent('Iscrizione newsletter Agorà')}${v ? `&body=${encodeURIComponent(`Vorrei iscrivermi alla newsletter di Agorà con l'indirizzo ${v}.`)}` : ''}`;
    }
  };
  return (
    <div className="newsletter">
      <div><h2>{N.titolo || 'Newsletter'}</h2><p>{N.testo || ''}</p></div>
      {iframe !== 'ok' && (
        <form className="nlf" noValidate onSubmit={iscriviti}>
          <div className="row1"><input type="email" name="EMAIL" placeholder="La tua e-mail" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /><button className="btn" type="submit">Iscriviti</button></div>
          <div className="ck" style={{ display: 'block', marginTop: 12, fontSize: 12.5, color: '#dbe9ec', lineHeight: 1.4 }}>{N.brevo_url ? 'Si apre il modulo di iscrizione in una nuova scheda: lì accetti l\'' : 'Si apre il tuo programma di posta. Iscrivendoti accetti l\''}<a href={N.privacy_url || '#'} target="_blank" rel="noopener" style={{ color: 'var(--silk)', textDecoration: 'underline' }}>Informativa Privacy</a>.</div>
          {msg && <div className={`msg ${msg.ok ? 'ok' : 'err'}`}>{msg.t}</div>}
        </form>
      )}
      {N.brevo_url && (iframe === 'attesa' || iframe === 'ok') && <iframe src={N.brevo_url} title="Iscrizione newsletter" scrolling="auto" className={iframe === 'attesa' ? 'attesa' : ''} onLoad={() => setIframe((s) => (s === 'attesa' ? 'ok' : s))} />}
    </div>
  );
}

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
  const ini = (n) => String(n || '').split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div className="page">
      <div>
        {post ? (
          <>
            <div className="small" style={{ marginBottom: 14 }}><Link to={`${base}/agora`}><Ico n="book" s={14} /> Agorà</Link> <span className="muted">· {post.data}</span></div>
            <article className="article">
              <h1>{post.titolo}</h1>
              <div className="byline"><span className="av">{ini(post.autore)}</span><span><strong>{post.autore}</strong><br />{post.ruolo || ''}</span><span className="spacer" /><span>{post.data}{post.tempo ? ` · lettura ${post.tempo}` : ''}</span></div>
              <div className="body">{post.corpo.map((p, i) => <p key={i}>{p}</p>)}</div>
              <div className="row mt">
                <button className="btn sm ghost" onClick={async () => { if (await copiaLink(window.location.href, post.titolo)) toast('Link copiato'); }}><Ico n="link" s={14} /> Copia il link all'articolo</button>
                <a className="btn sm ghost" href={`mailto:?subject=${encodeURIComponent(`${post.titolo} · Agorà Toscana Diagnostica`)}&body=${encodeURIComponent(window.location.href)}`}><Ico n="mail" s={14} /> Invia per e-mail</a>
              </div>
            </article>
          </>
        ) : (
          <>
            <div className="page-head"><div><h1>{B.titolo}</h1><div className="sub">{B.sottotitolo}</div></div></div>
            <div className="tiles post-list" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))' }}>
              {posts.map((p) => <Link key={p.slug} className="tile" to={`${base}/agora/${p.slug}`}><div className="name">{p.titolo}</div><div className="sub">{p.sommario}</div><div className="meta">{p.autore} · {p.data}{p.tempo ? ` · ${p.tempo}` : ''}</div></Link>)}
            </div>
          </>
        )}
      </div>
      <div className="mt"><Newsletter N={B.newsletter || {}} /></div>
      <Piede meta={st.data.meta} />
    </div>
  );
}

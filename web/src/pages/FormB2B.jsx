// Form online PUBBLICA del Business Hub per il cliente (processo Service, richiesta del CEO del 06/11/2026): /b2b/<token>, senza login.
// Anagrafica Clienti B2B (modulo TD-SGI-MOD173, precompilato con quello che la Suite sa del cliente), caricamento del contratto firmato in
// PDF e degli altri allegati richiesti (Impostazioni del Business Hub), invio con riepilogo degli errori campo per campo.
// API: /api/business/b2b/<token> (server/src/modules/business/routes/b2b.js). Grafica della Suite (classi globali di styles.css).
// Linea Punti Prelievo (06/11/2026): variante PARTNER per il partner che ospita il punto prelievi: dati del referente e contratto firmato,
// senza MOD173 (sezioni e campi arrivano dal server).
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

const API = '/api/business/b2b';
const dataIt = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '');

// Cornice della pagina (fuori dal componente: ridefinita a ogni render farebbe perdere il fuoco ai campi)
const Pagina = ({ children, titolo = 'Anagrafica cliente e contratto' }) => (
  <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
    <div style={{ background: 'var(--jet)', color: '#fff', padding: '18px 16px' }}>
      <div style={{ maxWidth: 980, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <img src="/logo-light.svg" alt="Toscana Diagnostica" style={{ height: 34 }} />
        <div style={{ fontWeight: 700, opacity: 0.9 }}>{titolo}</div>
      </div>
    </div>
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '22px 16px 48px' }}>{children}</div>
  </div>
);

export default function FormB2B() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [v, setV] = useState({});
  const [files, setFiles] = useState({});        // { contratto: File, allegato_1: File }
  const [perEmail, setPerEmail] = useState(false);
  const [errori, setErrori] = useState([]);
  const [busy, setBusy] = useState(false);
  const [fatto, setFatto] = useState(null);
  useEffect(() => {
    document.title = 'Anagrafica e contratto · Toscana Diagnostica';
    fetch(`${API}/${encodeURIComponent(token)}`).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Errore ${r.status}`); setD(j); setV(j.valori || {}); if (j.variante === 'PARTNER') document.title = 'Contratto del punto prelievi · Toscana Diagnostica'; })
      .catch((e) => setErr(e.message));
  }, [token]);
  const campiPer = useMemo(() => (d ? Object.fromEntries(d.sezioni.map((s) => [s.key, d.campi.filter((c) => c.s === s.key)])) : {}), [d]);
  const errDi = (k) => errori.find((e) => e.campo === k)?.messaggio;
  const invia = async (e) => {
    e.preventDefault();
    setBusy(true); setErrori([]);
    try {
      const fd = new FormData();
      fd.append('dati', JSON.stringify(v));
      fd.append('contratto_per_email', perEmail ? 'true' : 'false');
      for (const [k, f] of Object.entries(files)) if (f) fd.append(k, f);
      const r = await fetch(`${API}/${encodeURIComponent(token)}`, { method: 'POST', body: fd, headers: { 'X-Requested-With': 'td-suite' } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErrori(j.details || []); throw new Error(j.error || `Errore ${r.status}`); }
      setFatto(j); window.scrollTo(0, 0);
    } catch (x) { setErr(null); setErrori((p) => (p.length ? p : [{ campo: '', messaggio: x.message }])); window.scrollTo(0, 0); } finally { setBusy(false); }
  };
  if (err && !d) return <Pagina><div className="card" style={{ padding: 24 }}><h2 style={{ marginTop: 0 }}>Collegamento non disponibile</h2><p>{err}</p></div></Pagina>;
  if (!d) return <Pagina><div className="empty">Caricamento…</div></Pagina>;
  const partner = d?.variante === 'PARTNER';
  const titolo = partner ? 'Contratto del punto prelievi' : undefined;
  if (fatto) return (
    <Pagina titolo={titolo}><div className="card" style={{ padding: 28 }}>
      <h1 style={{ marginTop: 0, color: 'var(--teal)' }}>Grazie, abbiamo ricevuto i vostri dati</h1>
      {partner ? <p>I dati del referente di <b>{d.cliente}</b> per il punto prelievi {d.punto} sono registrati{fatto.file ? ` con ${fatto.file} documenti` : ''}.</p>
        : <p>L'Anagrafica Clienti B2B di <b>{d.cliente}</b> è registrata (versione {fatto.versione}){fatto.file ? ` con ${fatto.file} documenti` : ''}.</p>}
      {fatto.contrattualizzato ? <p>{partner ? 'Abbiamo ricevuto il contratto firmato: a breve riceverete un\'email con le credenziali della Suite di Toscana Diagnostica, dove potrete consultare le royalties del punto prelievi.' : 'Abbiamo ricevuto il contratto firmato: a breve riceverete un\'email di benvenuto con le istruzioni per accedere ai servizi della Suite di Toscana Diagnostica.'}</p>
        : perEmail ? <p>Attendiamo il contratto firmato all'indirizzo <a href={`mailto:${d.casella}`}>{d.casella}</a>.</p> : null}
      <p className="muted">Per correggere un dato potete riaprire questa pagina dallo stesso collegamento fino al {dataIt(d.scade)} e inviarla di nuovo. Per qualunque domanda scrivete a <a href={`mailto:${d.casella}`}>{d.casella}</a>.</p>
    </div></Pagina>
  );
  const campo = (c) => {
    const val = v[c.k] ?? '';
    const on = (x) => setV({ ...v, [c.k]: x });
    // etichetta in un solo elemento: label.f è una colonna flessibile e l'asterisco andrebbe a capo
    const lab = <span>{c.label}{c.obbligatorio && <span className="req"> *</span>}</span>;
    const e = errDi(c.k);
    const stile = e ? { borderColor: 'var(--red)' } : undefined;
    if (c.t === 'm') return <label key={c.k} className="f" style={{ gridColumn: '1 / -1' }}>{lab}<textarea rows={4} value={val} onChange={(x) => on(x.target.value)} style={stile} />{e && <span className="small" style={{ color: 'var(--red)' }}>{e}</span>}</label>;
    if (c.t === 's' || c.t === 'b') {
      const opz = c.t === 'b' ? ['Sì', 'No'] : c.opzioni;
      return <label key={c.k} className="f">{lab}<select value={val} onChange={(x) => on(x.target.value)} style={stile}><option value="">–</option>{opz.map((o) => <option key={o}>{o}</option>)}</select>{e && <span className="small" style={{ color: 'var(--red)' }}>{e}</span>}</label>;
    }
    return <label key={c.k} className="f">{lab}<input type={c.t === 'e' ? 'email' : 'text'} value={val} onChange={(x) => on(x.target.value)} style={stile} autoComplete="off" />{e && <span className="small" style={{ color: 'var(--red)' }}>{e}</span>}</label>;
  };
  return (
    <Pagina titolo={titolo}>
      <div className="card" style={{ padding: 22, marginBottom: 16 }}>
        <div className="small muted" style={{ fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}>{d.linea_label}</div>
        <h1 style={{ margin: '4px 0 6px', color: 'var(--teal)' }}>{d.cliente}</h1>
        {partner ? <>
          <p style={{ margin: 0 }}>Punto prelievi <b>{d.punto}</b>: verificate i dati del referente e caricate il contratto firmato in PDF. Il collegamento è personale e vale fino al <b>{dataIt(d.scade)}</b>.</p>
          <p className="small muted" style={{ marginBottom: 0 }}>In alternativa potete rispondere all'email ricevuta da <a href={`mailto:${d.casella}`}>{d.casella}</a> allegando il contratto firmato.{d.ultimo_invio ? ` Ultimo invio da questa pagina: ${new Date(d.ultimo_invio.at).toLocaleString('it-IT')}.` : ''}</p>
        </> : <>
          <p style={{ margin: 0 }}>Per diventare clienti di Toscana Diagnostica completate l'Anagrafica Clienti B2B (modulo TD-SGI-MOD173: abbiamo già inserito i dati che conosciamo, verificateli) e caricate il contratto firmato in PDF. Il collegamento è personale e vale fino al <b>{dataIt(d.scade)}</b>.</p>
          <p className="small muted" style={{ marginBottom: 0 }}>Preferite il modulo PDF? <a href={`${API}/${encodeURIComponent(token)}/mod173.pdf`}>Scaricate il MOD173 compilabile</a> e inviatelo firmato a <a href={`mailto:${d.casella}`}>{d.casella}</a>.{d.ultimo_invio ? ` Ultimo invio da questa pagina: ${new Date(d.ultimo_invio.at).toLocaleString('it-IT')} (versione ${d.ultimo_invio.versione}).` : ''}</p>
        </>}
        {d.contrattualizzato && <div className="alert info small" style={{ marginTop: 10 }}>Il contratto firmato risulta già ricevuto: potete comunque aggiornare {partner ? 'i dati del referente' : 'l\'anagrafica'} o caricare altri allegati.</div>}
      </div>
      {errori.length > 0 && <div className="alert err" style={{ marginBottom: 16 }}><b>Controllate i dati:</b><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{errori.map((x, i) => <li key={i}>{x.messaggio}</li>)}</ul></div>}
      <form onSubmit={invia}>
        {d.sezioni.map((s) => (campiPer[s.key] || []).length ? (
          <div key={s.key} className="card" style={{ marginBottom: 14, overflow: 'hidden' }}>
            <div style={{ background: '#0c3512', color: '#fff', padding: '8px 16px', fontWeight: 700, fontSize: 13, letterSpacing: '.03em', textTransform: 'uppercase' }}>{s.titolo}</div>
            <div className="form-grid" style={{ padding: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>{campiPer[s.key].map(campo)}</div>
          </div>) : null)}
        <div className="card" style={{ marginBottom: 14, overflow: 'hidden' }}>
          <div style={{ background: '#0c3512', color: '#fff', padding: '8px 16px', fontWeight: 700, fontSize: 13, letterSpacing: '.03em', textTransform: 'uppercase' }}>Contratto firmato e allegati</div>
          <div style={{ padding: 16, display: 'grid', gap: 14 }}>
            {d.allegati.map((a) => {
              const k = a.contratto ? 'contratto' : `allegato_${a.indice}`;
              const e = errDi(k);
              return <div key={k}>
                <label className="f"><span>{a.titolo}{a.obbligatorio && !a.ricevuto && !(a.contratto && perEmail) && <span className="req"> *</span>}{a.ricevuto && <span className="small" style={{ color: 'var(--green)', fontWeight: 600 }}> · già ricevuto il {dataIt(a.ricevuto)}</span>}</span>
                  <input type="file" accept={a.contratto ? 'application/pdf,.pdf' : '.pdf,.jpg,.jpeg,.png,.doc,.docx'} onChange={(x) => setFiles({ ...files, [k]: x.target.files[0] || null })} style={e ? { borderColor: 'var(--red)' } : undefined} /></label>
                {a.contratto && <label className="f inline" style={{ marginTop: 6 }}><input type="checkbox" checked={perEmail} onChange={(x) => setPerEmail(x.target.checked)} />Invierò il contratto firmato per email a {d.casella}</label>}
                {e && <div className="small" style={{ color: 'var(--red)' }}>{e}</div>}
              </div>;
            })}
            <div className="small muted">PDF fino a 10 MB per file. {partner ? 'Il contratto firmato è quello del punto prelievi ricevuto per email, firmato dal legale rappresentante.' : 'Il contratto firmato è la lettera di offerta ricevuta con la nostra proposta, firmata dal legale rappresentante.'}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn" type="submit" disabled={busy} style={{ minWidth: 200 }}>{busy ? 'Invio in corso…' : 'Invia a Toscana Diagnostica'}</button>
          <span className="small muted">I dati servono alla gestione del rapporto commerciale e del servizio. {d.societa?.nome}{d.societa?.email ? ` · ${d.societa.email}` : ''}{d.societa?.telefono ? ` · tel. ${d.societa.telefono}` : ''}</span>
        </div>
      </form>
    </Pagina>
  );
}

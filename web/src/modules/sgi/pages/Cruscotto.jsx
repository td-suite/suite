// Cruscotto documentale del SGI: copia conforme della pagina "/" del sito sgi.toscanadiagnostica.it (static/index.html + app.js), stessa
// struttura HTML e stessi nomi di classe (stile in sito.css). Quattro riquadri-filtro .kpi (Documenti attivi, Procedure e istruzioni,
// Moduli/informative/doc. esterni, Governo del sistema; un secondo clic li disattiva), ricerca full-text (codice, titolo, sintesi, area e
// testo integrale dei PDF: fulltext.json caricato alla prima ricerca), area e famiglia (.seg), Azzera; senza filtri: documenti cardine,
// le 18 aree, link stabili. Le scorciatoie Ultime emissioni, Documenti cardine e Versioni stampabili della barra del sito sono voci del
// menu del widget (prop `speciale`).
// Adattamento alla Suite: i PDF si aprono dalla cache della Suite; copia link ed e-mail usano i link pubblici del sito (chi li riceve
// può non avere un account della Suite).
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useToast } from '../../../components/ui.jsx';
import { useDati, caricaDati, useStato, docUrl, stampabileUrl, fileUrl, linkPubblico, senzaNumero, copiaLink, mailtoDoc, copiaLinkDoc, base } from '../dati.js';
import { FAMIGLIE, RIQUADRI, LIMITE_RISULTATI, codiceBase, filtraDocumenti, haFiltri, conteggi, documentiCardine, titoloRisultati } from '../filtri.js';
import { Piede, StatoDati, Ico, Evid, Ricerca } from './comuni.jsx';

export default function Cruscotto({ speciale = null }) {
  const st = useDati('docs', 'meta');
  const stato = useStato();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const [fulltext, setFulltext] = useState(null);
  const [famiglia, setFamiglia] = useState('all');
  const [area, setArea] = useState(params.get('area') || 'all');
  const [riquadro, setRiquadro] = useState(null);
  const origine = stato?.origine;

  const DOCS = st.data?.docs || [];
  const META = st.data?.meta || null;
  const query = q.trim();
  const caricaTesto = () => { if (!fulltext) caricaDati('fulltext').then(setFulltext).catch(() => setFulltext({})); };
  useEffect(() => { if (query) caricaTesto(); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const x = params.get('q'); if (x != null) setQ(x); }, [params]);

  const der = useMemo(() => {
    const c = conteggi(DOCS);
    return { ...c, aree: (META?.aree || []).map((a) => ({ name: a, count: c.perArea[a] || 0 })), cardine: documentiCardine(DOCS) };
  }, [DOCS, META]);

  const filtri = { q, riquadro, famiglia, area, speciale };
  const mostra = haFiltri(filtri);
  const documenti = useMemo(() => filtraDocumenti(DOCS, filtri, fulltext), [DOCS, q, riquadro, famiglia, area, speciale, fulltext]); // eslint-disable-line react-hooks/exhaustive-deps

  const blocco = StatoDati({ st });
  if (blocco) return blocco;

  const nonTrovato = params.get('nontrovato');
  const scegliRiquadro = (k) => { if (riquadro === k) { setRiquadro(null); setFamiglia('all'); } else { setRiquadro(k); setFamiglia(RIQUADRI[k].fam ? '' : 'all'); } };
  const tasti = (k) => (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); scegliRiquadro(k); } };
  const scegliArea = (a) => { setArea(a); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const azzera = () => { setFamiglia('all'); setArea('all'); setRiquadro(null); setQ(''); setParams({}, { replace: true }); if (speciale) navigate(base); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const copia = async (url, testo) => { if (await copiaLink(url, testo)) toast(`Link copiato come collegamento: ${url}`); };
  const n = META?.n_docs ?? DOCS.length;
  const pct = (v) => (n ? Math.round((v / n) * 100) : 0);
  const pf = der.perFam;
  const famSeg = riquadro ? (RIQUADRI[riquadro].fam ? '' : 'all') : famiglia;
  const riquadri = [
    ['tutti', 'Documenti attivi', n, `REG006 rev. ${META?.reg006_rev} del ${META?.reg006_data}`, 'Mostra tutti', null, true],
    ['operativi', 'Procedure e istruzioni', der.gruppo('operativi'), `${pf.PRO || 0} PRO · ${pf.IDL || 0} IDL`, 'Filtra', pct(der.gruppo('operativi'))],
    ['moduli', 'Moduli, informative, doc. esterni', der.gruppo('moduli'), `${META?.n_stampabili ?? 0} in versione stampabile`, 'Filtra', pct(der.gruppo('moduli'))],
    ['governo', 'Governo del sistema', der.gruppo('governo'), `${pf.POL || 0} POL · ${pf.MAN || 0} MAN · ${pf.PLN || 0} PLN · ${pf.REG || 0} REG · ${pf.RPT || 0} RPT`, 'Filtra', pct(der.gruppo('governo'))],
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Cruscotto documentale</h1>
          <div className="sub">Tutti i documenti attivi del Sistema di Gestione Integrato, nella revisione in vigore. La ricerca opera su codice, titolo, sintesi, area e sul testo integrale dei PDF.</div>
        </div>
        <Link className="btn" to={`${base}/preparazioni`}>Preparazioni agli esami</Link>
      </div>

      {nonTrovato && <div className="alert warn"><Ico n="info" s={18} /><div>Il documento <strong>{nonTrovato}</strong> non esiste o non è più in vigore. Cercalo per codice o titolo qui sotto.</div></div>}

      <div className="grid g4">
        {riquadri.map(([k, lbl, val, foot, act, bar, accent]) => (
          <div key={k} className={`card kpi${accent ? ' accent' : ''} clickable${riquadro === k ? ' on' : ''}`} role="button" tabIndex={0} aria-pressed={riquadro === k} onClick={() => scegliRiquadro(k)} onKeyDown={tasti(k)}>
            <div className="lbl">{lbl}</div><div className="val">{val}</div><div className="foot">{foot}</div>
            {bar != null && <div className="bar"><i style={{ width: `${bar}%` }} /></div>}
            <div className="act">{act}</div>
          </div>
        ))}
      </div>

      <div className="card mt">
        <div className="bd">
          <div className="filters">
            <label className="f" style={{ flex: '1 1 340px' }}>Cerca
              <Ricerca value={q} onChange={setQ} autoFocus onFocus={caricaTesto} placeholder="Es. consenso informato, Just Culture, privacy, breath test, PRO042…" />
            </label>
            <label className="f" style={{ flex: '0 1 300px' }}>Area SGI<select value={area} onChange={(e) => scegliArea(e.target.value)}>
              <option value="all">Tutte le aree ({(META?.aree || []).length})</option>{(META?.aree || []).map((a) => <option key={a} value={a}>{a}</option>)}
            </select></label>
          </div>
          <div className="row">
            <div className="seg">{FAMIGLIE.map(([k, l]) => <button key={k} className={famSeg === k ? 'on' : ''} onClick={() => { setRiquadro(null); setFamiglia(k); }}>{l}</button>)}</div>
            <span className="help">{mostra ? `${documenti.length}${documenti.length === 1 ? ' documento' : ' documenti'}${query && !fulltext ? ' · carico l\'indice full-text…' : ''}` : ''}</span>
          </div>
        </div>
      </div>

      <div className="card mt" style={mostra ? undefined : { display: 'none' }}>
        <div className="hd"><h2>{titoloRisultati(filtri)}</h2><span className="spacer" /><span className="badge b-teal">{documenti.length}</span><button className="btn sm ghost" title="Annulla filtri e ricerca" onClick={azzera}>Azzera</button></div>
        <div className="bd flush table-wrap"><table className="t"><thead><tr><th>Codice</th><th>Documento</th><th>Area</th><th>Rev. · data</th><th className="num">Apri</th></tr></thead><tbody>
          {!documenti.length ? <tr><td colSpan={5} className="empty">Nessun documento corrisponde ai criteri.</td></tr> : documenti.slice(0, LIMITE_RISULTATI).map((d) => {
            const pdf = docUrl(d); const stp = stampabileUrl(d); const b = codiceBase(d.code);
            return (
              <tr key={d.code} className="click" onClick={(e) => { if (e.target.closest('a,button')) return; if (pdf) window.open(pdf, '_blank', 'noopener'); else toast('PDF non disponibile per questo documento.', 'err'); }}>
                <td><span className="doc-code"><Evid t={d.code} q={query} /></span><div className="small muted">{d.famiglia_nome}{d.pagine ? ` · ${d.pagine} pag.` : ''}</div></td>
                <td><div className="doc-title"><Evid t={d.title} q={query} /></div>{d.sintesi && d.sintesi !== d.title && <div className="doc-sintesi"><Evid t={d.sintesi.length > 200 ? `${d.sintesi.slice(0, 200)}…` : d.sintesi} q={query} /></div>}</td>
                <td><span className="badge b-blue">{senzaNumero(d.area)}</span></td>
                <td className="small muted" style={{ whiteSpace: 'nowrap' }}>rev {d.rev}<br />{d.data}</td>
                <td><div className="doc-actions">
                  {pdf ? <a className="btn sm" href={pdf} target="_blank" rel="noopener">PDF</a> : <span className="badge b-red">PDF assente</span>}
                  {stp && <a className="btn sm ghost" href={stp} target="_blank" rel="noopener" title="Versione stampabile senza cover">Stampabile</a>}
                  {(d.allegati || []).map((a) => <a key={a} className="btn sm ghost" href={fileUrl(`docs/${a}`)} target="_blank" rel="noopener" title={a.split('/').pop()}>Allegato</a>)}
                  <a className="iconbtn" href={mailtoDoc(d, origine)} onClick={() => copiaLinkDoc(d, origine).then(() => toast('E-mail aperta. I link sono anche negli appunti come collegamenti: Ctrl+V nel messaggio se compaiono come testo'))} title="Invia per e-mail (apre il tuo client di posta con i link al documento; i link vengono anche copiati come collegamenti)"><Ico n="mail" s={16} /></a>
                  <button className="iconbtn" title="Copia il link stabile (incollabile come collegamento cliccabile)" onClick={() => copia(linkPubblico(origine, 'doc', b))}><Ico n="link" s={16} /></button>
                </div></td>
              </tr>
            );
          })}
        </tbody></table></div>
        <div>{documenti.length > LIMITE_RISULTATI && <div className="empty small">Mostrati i primi {LIMITE_RISULTATI} risultati su {documenti.length}. Affina la ricerca o scegli un'area.</div>}</div>
      </div>

      <div className="grid g2 mt" style={mostra ? { display: 'none' } : undefined}>
        <div className="card"><div className="hd"><h2>Documenti cardine</h2></div><div className="bd"><div className="tiles">
          {der.cardine.map((d) => <a key={d.code} className="tile" href={docUrl(d) || '#'} target="_blank" rel="noopener"><div className="code">{d.code}</div><div className="name">{d.title}</div></a>)}
        </div></div></div>
        <div className="card"><div className="hd"><h2>Le {der.aree.length} aree del SGI</h2></div><div className="bd"><div className="tiles">
          {der.aree.map((a) => <div key={a.name} className="tile area" role="button" tabIndex={0} onClick={() => scegliArea(a.name)} onKeyDown={(e) => e.key === 'Enter' && scegliArea(a.name)}><span className="name">{a.name}</span><span className="count">{a.count}</span></div>)}
        </div></div></div>
      </div>

      <div className="card mt" style={mostra ? { display: 'none' } : undefined}>
        <div className="hd"><h2>Link stabili</h2></div>
        <div className="bd small muted">Ogni documento ha un indirizzo che non cambia con la revisione: <span className="chip">/doc/TD-SGI-XXXNNN</span> apre il PDF corrente, <span className="chip">/m/TD-SGI-XXXNNN</span> apre la versione stampabile senza cover (moduli, informative, documenti esterni), <span className="chip">/p/&lt;codice shortcut&gt;</span> (es. /p/ECO003) apre la preparazione della prestazione. Il pulsante con la busta apre il tuo programma di posta con i link al documento già scritti; il pulsante con la catena copia il link stabile negli appunti. I riquadri in alto filtrano l'elenco per tipologia.</div>
      </div>

      <Piede meta={META} />
    </div>
  );
}

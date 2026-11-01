// Preparazioni e documenti (home del Portale Service): copia conforme della pagina "/" del sito (static/index.html + app.js), stessa
// struttura HTML e stessi nomi di classe (stile in sito.css): fascia .hero con ricerca e pillole, quattro riquadri-filtro .kpi, sezione
// prestazioni, documentazione del laboratorio per area e tipologia con ricerca anche sul testo integrale dei PDF (fulltext.json,
// caricato alla prima ricerca), istruzioni di preparazione per il paziente, link stabili, piè di pagina.
// Adattamento alla Suite: i PDF si aprono dalla cache della Suite; copia link ed e-mail usano i link pubblici del sito (chi li riceve,
// clienti e pazienti, non ha un account della Suite). Le scorciatoie della barra laterale del sito sono voci del menu del modulo (meta.js).
// Collegamento tra widget: un documento che esiste anche nello specchio del SGI Management ha il rimando alla scheda SGI (/sgi?q=<codice>).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useDati, caricaDati, useStato, docUrl, stampabileUrl, fileUrl, codiceBase, linkPubblico, norm, slug, senzaNumero, gruppo, copiaLink, mailtoDoc, copiaLinkDoc, useCodiciSgi } from '../dati.js';
import { Piede, StatoDati, Ico, Evid, Ricerca } from './comuni.jsx';

const FAMIGLIE = [['all', 'Tutte'], ['PRO', 'Procedure'], ['IDL', 'Istruzioni di lavoro'], ['MAN', 'Manuali'], ['REG', 'Registri'], ['PLN', 'Piani'], ['MOD', 'Moduli'], ['INF', 'Informative'], ['DEX', 'Doc. esterni']];
const KPI = {
  prep: { label: 'Prestazioni con preparazione' },
  inf: { label: 'Istruzioni di preparazione per il paziente', fam: ['INF'], withPrepOnly: true },
  moduli: { label: 'Moduli di richiesta e consenso', fam: ['MOD', 'DEX'] },
  operativi: { label: 'Procedure, istruzioni e manuali del laboratorio', fam: ['PRO', 'IDL', 'MAN', 'REG', 'PLN'] },
};
const PILLS = ['Curva glicemica', 'Urine 24h', 'Tampone', 'Breath test', 'Feci', 'Sostanze d\'abuso', 'Anatomia patologica', 'Valori critici', 'Trasporto campioni', 'Consenso'];
const LIMITE = 150;

export default function Home() {
  const st = useDati('docs', 'preparazioni', 'meta');
  const stato = useStato();
  const codiciSgi = useCodiciSgi();   // documenti presenti anche nello specchio del SGI Management (rimando alla scheda SGI)
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || params.get('codice') || '');
  const [fulltext, setFulltext] = useState(null);
  const [fam, setFam] = useState('all');
  const [area, setArea] = useState('all');
  const [kpi, setKpi] = useState(null);
  const [grp, setGrp] = useState('all');
  const prepRef = useRef(null);
  const docRef = useRef(null);
  const origine = stato?.origine;

  const DOCS = st.data?.docs || [];
  const ROWS = st.data?.preparazioni?.righe || [];
  const META = st.data?.meta || null;
  const query = q.trim();
  const caricaTesto = () => { if (!fulltext) caricaDati('fulltext').then(setFulltext).catch(() => setFulltext({})); };
  useEffect(() => { if (query) caricaTesto(); }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const der = useMemo(() => {
    const main = DOCS.filter((d) => !d.prep_only);
    const perArea = {}; main.forEach((d) => { perArea[d.area] = (perArea[d.area] || 0) + 1; });
    const perFam = {}; main.forEach((d) => { perFam[d.famiglia] = (perFam[d.famiglia] || 0) + 1; });
    return {
      aree: (META?.aree || []).map((a) => ({ name: a, count: perArea[a] || 0 })), perFam,
      nInf: DOCS.filter((d) => d.famiglia === 'INF').length,
      nPrep: ROWS.filter((r) => r.link && r.link.length).length,
      gruppi: [...new Set(ROWS.map(gruppo).filter(Boolean))].sort(),
      infs: DOCS.filter((d) => d.famiglia === 'INF' && d.stampabile).sort((a, b) => a.title.localeCompare(b.title, 'it')),
    };
  }, [DOCS, ROWS, META]);

  const famAttive = kpi && kpi !== 'prep' ? KPI[kpi].fam || null : fam === 'all' || fam === '' ? null : [fam];
  const anyDoc = query.length > 0 || Boolean(famAttive) || area !== 'all' || Boolean(kpi && kpi !== 'prep');
  const showPrep = query.length > 0 || grp !== 'all' || kpi === 'prep';
  const home = !anyDoc && !showPrep;

  const prest = useMemo(() => {
    if (!showPrep) return [];
    const terms = norm(query).split(/\s+/).filter(Boolean);
    return ROWS.filter((r) => (grp === 'all' || gruppo(r) === grp) && (!terms.length || terms.every((t) =>
      norm(`${r.codice} ${r.shortcut || ''} ${r.descrizione} ${Object.values(r.extra || {}).join(' ')} ${(r.link || []).map((l) => `${l.title} ${l.code}`).join(' ')}`).includes(t))));
  }, [ROWS, query, grp, showPrep]);

  const documenti = useMemo(() => {
    if (!anyDoc) return [];
    const terms = norm(query).split(/\s+/).filter(Boolean);
    const withPrepOnly = kpi && KPI[kpi].withPrepOnly;
    const qq = norm(query);
    return DOCS.filter((d) => {
      if (d.prep_only && !withPrepOnly) return false;
      if (famAttive && !famAttive.includes(d.famiglia)) return false;
      if (area !== 'all' && d.area !== area) return false;
      if (!terms.length) return true;
      const hay = norm(`${d.code} ${d.title} ${d.sintesi} ${d.area} ${d.famiglia_nome}`);
      const body = fulltext ? norm(fulltext[d.code] || '') : '';
      return terms.every((t) => hay.includes(t) || body.includes(t));
    }).sort((a, b) => {
      const qa = qq && norm(`${a.code} ${a.title}`).includes(qq) ? 0 : 1; const qb = qq && norm(`${b.code} ${b.title}`).includes(qq) ? 0 : 1;
      return qa - qb || a.code.localeCompare(b.code);
    });
  }, [DOCS, query, famAttive, area, kpi, fulltext, anyDoc]);

  const codice = params.get('codice');
  const nonTrovato = params.get('nontrovato');
  const codiceAssente = codice && ROWS.length && !ROWS.some((r) => slug(r.shortcut || r.codice).toLowerCase() === slug(codice).toLowerCase() || slug(r.codice).toLowerCase() === slug(codice).toLowerCase());

  const blocco = StatoDati({ st });
  if (blocco) return blocco;

  // setKpi() del sito: secondo clic disattiva; la sezione interessata scorre in vista
  const scegliKpi = (k) => {
    if (kpi === k) { setKpi(null); setFam('all'); return; }
    setKpi(k); setFam(KPI[k].fam ? '' : 'all');
    setTimeout(() => (k === 'prep' ? prepRef : docRef).current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  const tastiKpi = (k) => (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); scegliKpi(k); } };
  const azzera = () => { setFam('all'); setArea('all'); setKpi(null); setGrp('all'); setQ(''); setParams({}, { replace: true }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const copia = async (url, testo) => { if (await copiaLink(url, testo)) toast(`Link copiato come collegamento: ${url}`); };
  const titoloDoc = [kpi && kpi !== 'prep' ? KPI[kpi].label : famAttive ? (FAMIGLIE.find((f) => f[0] === famAttive[0]) || [])[1] : null, area !== 'all' ? senzaNumero(area) : null, query ? `"${query}"` : null].filter(Boolean).join(' · ') || 'Documentazione del laboratorio';
  const pf = der.perFam;
  const riquadri = [
    ['prep', 'Prestazioni con preparazione', der.nPrep, `${ROWS.length} prestazioni a catalogo · link stabile per ciascuna`, 'Sfoglia', true],
    ['inf', 'Istruzioni per il paziente', der.nInf, 'informative di preparazione, versione stampabile', 'Mostra'],
    ['moduli', 'Moduli di richiesta e consenso', (pf.MOD || 0) + (pf.DEX || 0), `${pf.MOD || 0} moduli · ${pf.DEX || 0} documenti esterni`, 'Mostra'],
    ['operativi', 'Procedure e istruzioni', (pf.PRO || 0) + (pf.IDL || 0) + (pf.MAN || 0) + (pf.REG || 0) + (pf.PLN || 0), `${pf.PRO || 0} PRO · ${pf.IDL || 0} IDL · ${pf.MAN || 0} MAN`, 'Mostra'],
  ];

  return (
    <div className="page">
      <div className="hero">
        <h1>Service di Laboratorio</h1>
        <div className="sub">Tutto ciò che serve ai laboratori e alle strutture che affidano a Toscana Diagnostica le proprie analisi: istruzioni di preparazione per i pazienti, moduli di richiesta e di consenso, procedure e istruzioni di lavoro del laboratorio. Sempre nella revisione in vigore.</div>
        <Ricerca value={q} onChange={setQ} autoFocus onFocus={caricaTesto}
          placeholder="Cerca una prestazione (es. ECO003, curva glicemica) o un documento (es. valori critici, trasporto campioni, consenso)…" />
        <div className="pills">{PILLS.map((p) => <button key={p} className={`pill ${norm(p) === norm(query) ? 'on' : ''}`} type="button" onClick={() => setQ(norm(p) === norm(query) ? '' : p)}>{p}</button>)}</div>
      </div>

      <div>{(codiceAssente || nonTrovato) && <div className="alert warn"><Ico n="info" s={18} /><div>Il codice <strong>{codice || nonTrovato}</strong> non è presente {nonTrovato ? 'tra i documenti pubblicati' : 'nell\'elenco delle preparazioni pubblicate'}. Usa la ricerca per nome dell'esame oppure contatta il laboratorio.</div></div>}</div>
      <div className="grid g4">
        {riquadri.map(([k, lbl, val, foot, act, accent]) => (
          <div key={k} className={`card kpi${accent ? ' accent' : ''} clickable${kpi === k ? ' on' : ''}`} role="button" tabIndex={0} onClick={() => scegliKpi(k)} onKeyDown={tastiKpi(k)}>
            <div className="lbl">{lbl}</div><div className="val">{val}</div><div className="foot">{foot}</div><div className="act">{act}</div>
          </div>
        ))}
      </div>

      <div className="card mt" ref={prepRef} style={showPrep ? undefined : { display: 'none' }}>
        <div className="hd"><h2>{query ? `Prestazioni per "${query}"` : 'Prestazioni con preparazione'}</h2><span className="spacer" />
          <label className="f" style={{ flex: '0 1 240px', fontSize: '11.5px' }}>Gruppo<select value={grp} onChange={(e) => { setGrp(e.target.value); if (!kpi && !query) setKpi('prep'); }}><option value="all">Tutti i gruppi</option>{der.gruppi.map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
          <span className="badge b-teal">{prest.length}</span></div>
        <div className="bd flush table-wrap"><table className="t"><thead><tr><th>Codice</th><th>Prestazione</th><th>Preparazione</th><th>Link stabile</th></tr></thead><tbody>
          {!prest.length ? <tr><td colSpan={4} className="empty">Nessuna prestazione corrisponde alla ricerca.</td></tr> : prest.slice(0, LIMITE).map((r) => {
            const ex = r.extra || {};
            const url = r.url && origine ? `${origine.replace(/\/+$/, '')}${r.url}` : null;
            return (
              <tr key={`${r.codice}-${r.shortcut}`}>
                <td><span className="doc-code"><Evid t={r.shortcut || r.codice} q={query} /></span>{r.shortcut && r.shortcut !== r.codice && <div className="small muted">GIPO {r.codice}</div>}</td>
                <td><div className="doc-title"><Evid t={r.descrizione} q={query} /></div><div className="doc-sintesi">{[gruppo(r), ex['Specialità']].filter(Boolean).join(' · ')}</div></td>
                <td><div className="doc-actions" style={{ justifyContent: 'flex-start' }}>{(r.link || []).length ? r.link.map((l) => <a key={l.code} className="btn sm" href={fileUrl(l.file)} target="_blank" rel="noopener"><Ico n="doc" s={14} /> {l.title}</a>) : <span className="badge b-grey">nessuna preparazione</span>}</div></td>
                <td>{url && <span className="url" title="Copia il link (incollabile come collegamento cliccabile)" onClick={() => copia(url)}>{url}</span>}</td>
              </tr>
            );
          })}
        </tbody></table></div>
        <div>{prest.length > LIMITE && <div className="empty small">Mostrate le prime {LIMITE} prestazioni su {prest.length}. Affina la ricerca.</div>}</div>
      </div>

      <div className="card mt" ref={docRef} style={anyDoc ? undefined : { display: 'none' }}>
        <div className="hd"><h2>{titoloDoc}</h2><span className="spacer" /><span className="badge b-teal">{documenti.length}</span><button className="btn sm ghost" title="Annulla filtri e ricerca" onClick={azzera}>Azzera</button></div>
        <div className="bd" style={{ paddingBottom: 8 }}>
          <div className="filters" style={{ marginBottom: 8 }}>
            <label className="f" style={{ flex: '0 1 300px' }}>Area<select value={area} onChange={(e) => { setArea(e.target.value); if (kpi === 'prep') setKpi(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
              <option value="all">Tutte le aree ({der.aree.length})</option>{der.aree.map((a) => <option key={a.name} value={a.name}>{senzaNumero(a.name)} ({a.count})</option>)}</select></label>
            <div className="f" style={{ flex: '1 1 400px' }}>Tipologia<div className="seg">
              {FAMIGLIE.filter(([k]) => k === 'all' || pf[k]).map(([k, l]) => (
                <button key={k} className={(kpi && kpi !== 'prep' ? '' : fam) === k ? 'on' : ''} onClick={() => { setKpi(null); setFam(k); }}>{l}{k !== 'all' && <> <span className="muted">{pf[k]}</span></>}</button>
              ))}
            </div></div>
          </div>
          <span className="help">{documenti.length}{documenti.length === 1 ? ' documento' : ' documenti'}{query && !fulltext ? ' · carico l\'indice full-text…' : ''}{query ? ' · la ricerca opera anche sul testo integrale dei PDF' : ''}</span>
        </div>
        <div className="bd flush table-wrap"><table className="t"><thead><tr><th>Codice</th><th>Documento</th><th>Area</th><th>Rev. · data</th><th className="num">Apri</th></tr></thead><tbody>
          {!documenti.length ? <tr><td colSpan={5} className="empty">Nessun documento corrisponde ai criteri.</td></tr> : documenti.slice(0, LIMITE).map((d) => {
            const pdf = docUrl(d); const stp = stampabileUrl(d); const b = codiceBase(d.code);
            return (
              <tr key={d.code} className="click" onClick={(e) => { if (e.target.closest('a,button,[data-stop]')) return; if (pdf) window.open(pdf, '_blank', 'noopener'); else toast('PDF non disponibile per questo documento.', 'err'); }}>
                <td><span className="doc-code"><Evid t={d.code} q={query} /></span><div className="small muted">{d.famiglia_nome}{d.pagine ? ` · ${d.pagine} pag.` : ''}</div></td>
                <td><div className="doc-title"><Evid t={d.title} q={query} /></div>{d.sintesi && d.sintesi !== d.title && <div className="doc-sintesi"><Evid t={d.sintesi.length > 200 ? `${d.sintesi.slice(0, 200)}…` : d.sintesi} q={query} /></div>}</td>
                <td><span className="badge b-blue">{senzaNumero(d.area)}</span></td>
                <td className="small muted" style={{ whiteSpace: 'nowrap' }}>rev {d.rev}<br />{d.data}</td>
                <td><div className="doc-actions">
                  {pdf ? <a className="btn sm" href={pdf} target="_blank" rel="noopener">PDF</a> : <span className="badge b-red">PDF assente</span>}
                  {stp && <a className="btn sm ghost" href={stp} target="_blank" rel="noopener" title="Versione stampabile senza cover">Stampabile</a>}
                  {(d.allegati || []).map((a) => <a key={a} className="btn sm ghost" href={fileUrl(`docs/${a}`)} target="_blank" rel="noopener" title={a.split('/').pop()}>Allegato</a>)}
                  <a className="iconbtn" href={mailtoDoc(d, origine)} onClick={() => copiaLinkDoc(d, origine).then(() => toast('E-mail aperta. I link sono anche negli appunti come collegamenti: Ctrl+V nel messaggio se compaiono come testo'))} title="Invia per e-mail (apre il tuo programma di posta con i link al documento; i link vengono anche copiati come collegamenti)"><Ico n="mail" s={16} /></a>
                  <button className="iconbtn" title="Copia il link stabile (incollabile come collegamento cliccabile)" onClick={() => copia(linkPubblico(origine, 'doc', b))}><Ico n="link" s={16} /></button>
                  {codiciSgi?.has(b) && <Link className="iconbtn" to={`/sgi?q=${encodeURIComponent(b)}`} title={`Apri la scheda nel SGI Management (${b})`}><Icon name="sgi" size={16} /></Link>}
                </div></td>
              </tr>
            );
          })}
        </tbody></table></div>
        <div>{documenti.length > LIMITE && <div className="empty small">Mostrati i primi {LIMITE} documenti su {documenti.length}. Affina la ricerca.</div>}</div>
      </div>

      <div className="card mt" style={home ? undefined : { display: 'none' }}>
        <div className="hd"><h2>Istruzioni di preparazione per il paziente</h2><span className="spacer" /><span className="help">versioni stampabili, senza frontespizio: da consegnare o inviare al paziente</span></div>
        <div className="bd"><div className="tiles">{der.infs.map((d) => <a key={d.code} className="tile" href={stampabileUrl(d)} target="_blank" rel="noopener"><div className="code">{codiceBase(d.code)}{/_0[a-z]$/.test(d.code) ? d.code.slice(-3) : ''}</div><div className="name">{d.title}</div></a>)}</div></div>
      </div>

      <div className="card mt" style={home ? undefined : { display: 'none' }}>
        <div className="hd"><h2>Link stabili e invio</h2></div>
        <div className="bd small muted">Ogni documento ha un indirizzo che non cambia con la revisione: <span className="chip">/p/&lt;codice prestazione&gt;</span> (es. /p/ECO003) apre la preparazione della prestazione, <span className="chip">/m/TD-SGI-XXXNNN</span> la versione stampabile di un modulo o informativa, <span className="chip">/doc/TD-SGI-XXXNNN</span> il PDF corrente di un documento. Il pulsante con la busta apre il tuo programma di posta con i link già scritti; quello con la catena copia il link come collegamento cliccabile, da incollare nel gestionale, in una e-mail o in un SMS al paziente.</div>
      </div>

      <Piede meta={META} />
    </div>
  );
}

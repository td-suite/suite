// Preparazioni e documenti (home del Portale Service): stessa struttura e stessi testi della pagina "/" del sito.
// Prestazioni GIPO con la preparazione collegata e il link stabile, documentazione del laboratorio per area e tipologia con ricerca
// anche sul testo integrale dei PDF (fulltext.json, caricato alla prima ricerca), istruzioni di preparazione per il paziente.
// Adattamento alla Suite: i PDF si aprono dalla cache della Suite; copia link ed e-mail usano i link pubblici del sito (chi li riceve,
// clienti e pazienti, non ha un account della Suite); il codice del link stabile apre la versione interna /service/p/<codice>.
import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, Badge, Seg, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useDati, caricaDati, useStato, docUrl, stampabileUrl, fileUrl, codiceBase, linkSuite, linkPubblico, norm, slug, senzaNumero, gruppo, copiaLink, mailtoDoc, copiaLinkDoc } from '../dati.js';
import { Piede, StatoDati } from './comuni.jsx';

const FAMIGLIE = [['all', 'Tutte'], ['PRO', 'Procedure'], ['IDL', 'Istruzioni di lavoro'], ['MAN', 'Manuali'], ['REG', 'Registri'], ['PLN', 'Piani'], ['MOD', 'Moduli'], ['INF', 'Informative'], ['DEX', 'Doc. esterni']];
const KPI = {
  prep: { label: 'Prestazioni con preparazione' },
  inf: { label: 'Istruzioni di preparazione per il paziente', fam: ['INF'], withPrepOnly: true },
  moduli: { label: 'Moduli di richiesta e consenso', fam: ['MOD', 'DEX'] },
  operativi: { label: 'Procedure, istruzioni e manuali del laboratorio', fam: ['PRO', 'IDL', 'MAN', 'REG', 'PLN'] },
};
const PILLS = ['Curva glicemica', 'Urine 24h', 'Tampone', 'Breath test', 'Feci', 'Sostanze d\'abuso', 'Anatomia patologica', 'Valori critici', 'Trasporto campioni', 'Consenso'];
const LIMITE = 150;

function Evid({ t, q }) {
  if (!q) return <>{t}</>;
  const s = String(t ?? '');
  const parti = s.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return <>{parti.map((p, i) => (i % 2 ? <mark key={i} className="sv-mark">{p}</mark> : p))}</>;
}

export default function Home() {
  const st = useDati('docs', 'preparazioni', 'meta');
  const stato = useStato();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || params.get('codice') || '');
  const [fulltext, setFulltext] = useState(null);
  const [fam, setFam] = useState('all');
  const [area, setArea] = useState('all');
  const [kpi, setKpi] = useState(null);
  const [grp, setGrp] = useState('all');
  const origine = stato?.origine;

  const DOCS = st.data?.docs || [];
  const ROWS = st.data?.preparazioni?.righe || [];
  const META = st.data?.meta || null;
  const query = q.trim();
  useEffect(() => { if (query && !fulltext) caricaDati('fulltext').then(setFulltext).catch(() => setFulltext({})); }, [query, fulltext]);

  const derivati = useMemo(() => {
    const main = DOCS.filter((d) => !d.prep_only);
    const perArea = {}; main.forEach((d) => { perArea[d.area] = (perArea[d.area] || 0) + 1; });
    const perFam = {}; main.forEach((d) => { perFam[d.famiglia] = (perFam[d.famiglia] || 0) + 1; });
    const find = (c) => DOCS.find((d) => d.code.startsWith(`${c}_`));
    return {
      aree: (META?.aree || []).map((a) => ({ name: a, count: perArea[a] || 0 })), perFam,
      nInf: DOCS.filter((d) => d.famiglia === 'INF').length,
      nPrep: ROWS.filter((r) => r.link && r.link.length).length,
      gruppi: [...new Set(ROWS.map(gruppo).filter(Boolean))].sort(),
      infs: DOCS.filter((d) => d.famiglia === 'INF' && d.stampabile).sort((a, b) => a.title.localeCompare(b.title, 'it')),
      scorciatoie: [
        ['TD-SGI-IDL011', 'Prelievo e trasporto campioni', 'doc'], ['TD-SGI-PRO042', 'Fase preanalitica', 'doc'], ['TD-SGI-IDL013', 'Tabella valori critici', 'doc'],
        ['TD-SGI-IDL014', 'Invio campioni Anatomia Patologica', 'doc'], ['TD-SGI-INF001', 'Informativa raccolta campioni', 'm'], ['TD-SGI-MOD252', 'Richiesta materiale', 'm'],
      ].map(([c, label, tipo]) => ({ c, label, tipo, d: find(c) })).filter((x) => x.d && (x.tipo === 'm' || x.d.pdf)),
    };
  }, [DOCS, ROWS, META]);

  const famAttive = kpi && kpi !== 'prep' ? KPI[kpi].fam || null : fam === 'all' ? null : [fam];
  const anyDoc = query.length > 0 || Boolean(famAttive) || area !== 'all' || (kpi && kpi !== 'prep');
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

  const scegliKpi = (k) => { if (kpi === k) { setKpi(null); setFam('all'); } else { setKpi(k); setFam(KPI[k].fam ? '' : 'all'); } };
  const azzera = () => { setFam('all'); setArea('all'); setKpi(null); setGrp('all'); setQ(''); setParams({}, { replace: true }); };
  const copia = async (url, testo) => { if (await copiaLink(url, testo)) toast(`Link copiato come collegamento: ${url}`); };
  const titoloDoc = [kpi && kpi !== 'prep' ? KPI[kpi].label : famAttive ? (FAMIGLIE.find((f) => f[0] === famAttive[0]) || [])[1] : null, area !== 'all' ? senzaNumero(area) : null, query ? `"${query}"` : null].filter(Boolean).join(' · ') || 'Documentazione del laboratorio';

  return (
    <div className="page sv-page">
      <div className="sv-hero">
        <h1>Service di Laboratorio</h1>
        <div className="sub">Tutto ciò che serve ai laboratori e alle strutture che affidano a Toscana Diagnostica le proprie analisi: istruzioni di preparazione per i pazienti, moduli di richiesta e di consenso, procedure e istruzioni di lavoro del laboratorio. Sempre nella revisione in vigore.</div>
        <div className="sv-search">
          <Icon name="search" />
          <input type="text" value={q} autoFocus onChange={(e) => setQ(e.target.value)} onFocus={() => !fulltext && caricaDati('fulltext').then(setFulltext).catch(() => setFulltext({}))}
            onKeyDown={(e) => e.key === 'Escape' && setQ('')} placeholder="Cerca una prestazione (es. ECO003, curva glicemica) o un documento (es. valori critici, trasporto campioni, consenso)…" aria-label="Cerca" />
          {q && <button className="iconbtn" onClick={() => setQ('')} aria-label="Cancella ricerca"><Icon name="x" /></button>}
        </div>
        <div className="sv-pills">{PILLS.map((p) => <button key={p} type="button" className={`sv-pill ${norm(p) === norm(query) ? 'on' : ''}`} onClick={() => setQ(norm(p) === norm(query) ? '' : p)}>{p}</button>)}</div>
      </div>

      {(codiceAssente || nonTrovato) && <div className="sv-alert warn"><Icon name="alert" className="ico" /><div>Il codice <strong>{codice || nonTrovato}</strong> non è presente {nonTrovato ? 'tra i documenti pubblicati' : 'nell\'elenco delle preparazioni pubblicate'}. Usa la ricerca per nome dell'esame oppure contatta il laboratorio.</div></div>}

      <div className="grid g4">
        {[
          ['prep', 'Prestazioni con preparazione', derivati.nPrep, `${ROWS.length} prestazioni a catalogo · link stabile per ciascuna`, 'Sfoglia', true],
          ['inf', 'Istruzioni per il paziente', derivati.nInf, 'informative di preparazione, versione stampabile', 'Mostra'],
          ['moduli', 'Moduli di richiesta e consenso', (derivati.perFam.MOD || 0) + (derivati.perFam.DEX || 0), `${derivati.perFam.MOD || 0} moduli · ${derivati.perFam.DEX || 0} documenti esterni`, 'Mostra'],
          ['operativi', 'Procedure e istruzioni', ['PRO', 'IDL', 'MAN', 'REG', 'PLN'].reduce((a, k) => a + (derivati.perFam[k] || 0), 0), `${derivati.perFam.PRO || 0} PRO · ${derivati.perFam.IDL || 0} IDL · ${derivati.perFam.MAN || 0} MAN`, 'Mostra'],
        ].map(([k, lbl, val, foot, act, accent]) => (
          <button key={k} type="button" className={`card kpi sv-kpi ${accent ? 'accent' : ''} ${kpi === k ? 'on' : ''}`} onClick={() => scegliKpi(k)}>
            <div className="lbl">{lbl}</div><div className="val">{val}</div><div className="foot">{foot}</div><div className="sv-act">{act}</div>
          </button>
        ))}
      </div>

      {showPrep && (
        <Card className="mt" title={query ? `Prestazioni per "${query}"` : 'Prestazioni con preparazione'} icon="heart" flush
          actions={<><label className="sv-inline">Gruppo<select value={grp} onChange={(e) => { setGrp(e.target.value); if (!kpi && !query) setKpi('prep'); }}><option value="all">Tutti i gruppi</option>{derivati.gruppi.map((g) => <option key={g} value={g}>{g}</option>)}</select></label><Badge tone="teal" dot={false}>{prest.length}</Badge></>}>
          {!prest.length ? <div className="empty">Nessuna prestazione corrisponde alla ricerca.</div> : (
            <div className="table-wrap"><table className="t sv-table">
              <thead><tr><th>Codice</th><th>Prestazione</th><th>Preparazione</th><th>Link stabile</th></tr></thead>
              <tbody>{prest.slice(0, LIMITE).map((r) => {
                const ex = r.extra || {}; const cod = r.shortcut || r.codice;
                const pub = r.url && origine ? `${origine.replace(/\/+$/, '')}${r.url}` : null;
                return (
                  <tr key={`${r.codice}-${r.shortcut}`}>
                    <td><span className="sv-code"><Evid t={cod} q={query} /></span>{r.shortcut && r.shortcut !== r.codice && <div className="small muted">GIPO {r.codice}</div>}</td>
                    <td><div className="strong"><Evid t={r.descrizione} q={query} /></div><div className="small muted">{[gruppo(r), ex['Specialità']].filter(Boolean).join(' · ')}</div></td>
                    <td><div className="sv-actions start">{(r.link || []).length ? r.link.map((l) => <a key={l.code} className="btn sm" href={fileUrl(l.file)} target="_blank" rel="noopener"><Icon name="doc" />{l.title}</a>) : <Badge tone="grey">nessuna preparazione</Badge>}</div></td>
                    <td className="nowrap">{(r.link || []).length > 0 && <>
                      <a className="sv-url" href={linkSuite('p', cod)} target="_blank" rel="noopener" title="Apri il PDF dal link stabile della Suite">/service/p/{cod}</a>
                      {pub && <button className="iconbtn" title={`Copia il link pubblico ${pub} (incollabile come collegamento cliccabile, per pazienti e clienti)`} onClick={() => copia(pub)}><Icon name="copy" /></button>}
                    </>}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>)}
          {prest.length > LIMITE && <div className="empty small">Mostrate le prime {LIMITE} prestazioni su {prest.length}. Affina la ricerca.</div>}
        </Card>
      )}

      {anyDoc && (
        <Card className="mt" title={titoloDoc} icon="folder" flush actions={<><Badge tone="teal" dot={false}>{documenti.length}</Badge><button className="btn sm ghost" onClick={azzera} title="Annulla filtri e ricerca">Azzera</button></>}>
          <div className="sv-filters">
            <label className="sv-inline">Area<select value={area} onChange={(e) => { setArea(e.target.value); if (kpi === 'prep') setKpi(null); }}>
              <option value="all">Tutte le aree ({derivati.aree.length})</option>{derivati.aree.map((a) => <option key={a.name} value={a.name}>{senzaNumero(a.name)} ({a.count})</option>)}</select></label>
            <Seg value={kpi && kpi !== 'prep' ? '' : fam} onChange={(v) => { setKpi(null); setFam(v); }} label="Tipologia"
              items={FAMIGLIE.filter(([k]) => k === 'all' || derivati.perFam[k]).map(([k, l]) => ({ value: k, label: k === 'all' ? l : `${l} ${derivati.perFam[k]}` }))} />
            <span className="small muted">{documenti.length} {documenti.length === 1 ? 'documento' : 'documenti'}{query && !fulltext ? ' · carico l\'indice full-text…' : ''}{query ? ' · la ricerca opera anche sul testo integrale dei PDF' : ''}</span>
          </div>
          {!documenti.length ? <div className="empty">Nessun documento corrisponde ai criteri.</div> : (
            <div className="table-wrap"><table className="t sv-table">
              <thead><tr><th>Codice</th><th>Documento</th><th>Area</th><th>Rev. · data</th><th className="num">Apri</th></tr></thead>
              <tbody>{documenti.slice(0, LIMITE).map((d) => {
                const pdf = docUrl(d); const stp = stampabileUrl(d);
                return (
                  <tr key={d.code} className="sv-click" onClick={(e) => { if (e.target.closest('a,button')) return; if (pdf) window.open(pdf, '_blank', 'noopener'); else toast('PDF non disponibile per questo documento.', 'err'); }}>
                    <td><span className="sv-code"><Evid t={d.code} q={query} /></span><div className="small muted">{d.famiglia_nome}{d.pagine ? ` · ${d.pagine} pag.` : ''}</div></td>
                    <td><div className="strong"><Evid t={d.title} q={query} /></div>{d.sintesi && d.sintesi !== d.title && <div className="small muted"><Evid t={d.sintesi.length > 200 ? `${d.sintesi.slice(0, 200)}…` : d.sintesi} q={query} /></div>}</td>
                    <td><Badge tone="blue" dot={false}>{senzaNumero(d.area)}</Badge></td>
                    <td className="small muted nowrap">rev {d.rev}<br />{d.data}</td>
                    <td><div className="sv-actions">
                      {pdf ? <a className="btn sm" href={pdf} target="_blank" rel="noopener">PDF</a> : <Badge tone="red">PDF assente</Badge>}
                      {stp && <a className="btn sm ghost" href={stp} target="_blank" rel="noopener" title="Versione stampabile senza cover">Stampabile</a>}
                      {(d.allegati || []).map((a) => <a key={a} className="btn sm ghost" href={fileUrl(`docs/${a}`)} target="_blank" rel="noopener" title={a.split('/').pop()}>Allegato</a>)}
                      <a className="iconbtn" href={mailtoDoc(d, origine)} onClick={() => copiaLinkDoc(d, origine).then(() => toast('E-mail aperta. I link sono anche negli appunti come collegamenti: Ctrl+V nel messaggio se compaiono come testo'))} title="Invia per e-mail (apre il tuo programma di posta con i link pubblici al documento; i link vengono anche copiati come collegamenti)"><Icon name="mail" /></a>
                      <button className="iconbtn" title="Copia il link stabile pubblico (incollabile come collegamento cliccabile)" onClick={() => copia(linkPubblico(origine, 'doc', codiceBase(d.code)))}><Icon name="copy" /></button>
                      <a className="iconbtn" href={linkSuite('doc', codiceBase(d.code))} target="_blank" rel="noopener" title={`Link stabile nella Suite: /service/doc/${codiceBase(d.code)}`}><Icon name="external" /></a>
                    </div></td>
                  </tr>
                );
              })}</tbody>
            </table></div>)}
          {documenti.length > LIMITE && <div className="empty small">Mostrati i primi {LIMITE} documenti su {documenti.length}. Affina la ricerca.</div>}
        </Card>
      )}

      {home && <>
        <Card className="mt" title="Documenti più richiesti" icon="star">
          <div className="sv-actions start">{derivati.scorciatoie.map((s) => <a key={s.c} className="btn sm ghost" href={linkSuite(s.tipo, s.c)} target="_blank" rel="noopener"><Icon name={s.tipo === 'm' ? 'file' : 'doc'} />{s.label}</a>)}</div>
        </Card>
        <Card className="mt" title="Istruzioni di preparazione per il paziente" icon="heart" actions={<span className="small muted">versioni stampabili, senza frontespizio: da consegnare o inviare al paziente</span>}>
          <div className="sv-tiles">{derivati.infs.map((d) => <a key={d.code} className="sv-tile" href={stampabileUrl(d)} target="_blank" rel="noopener"><div className="code">{codiceBase(d.code)}{/_0[a-z]$/.test(d.code) ? d.code.slice(-3) : ''}</div><div className="name">{d.title}</div></a>)}</div>
        </Card>
        <Card className="mt" title="Link stabili e invio" icon="copy">
          <div className="small muted">Ogni documento ha un indirizzo che non cambia con la revisione: <span className="sv-chip">/p/&lt;codice prestazione&gt;</span> (es. /p/ECO003) apre la preparazione della prestazione, <span className="sv-chip">/m/TD-SGI-XXXNNN</span> la versione stampabile di un modulo o informativa, <span className="sv-chip">/doc/TD-SGI-XXXNNN</span> il PDF corrente di un documento. Il pulsante con la busta apre il tuo programma di posta con i link già scritti; quello di copia copia il link come collegamento cliccabile, da incollare nel gestionale, in una e-mail o in un SMS al paziente.
            <br /><br />Nella Suite gli stessi indirizzi valgono sotto <span className="sv-chip">/service/p/…</span>, <span className="sv-chip">/service/m/…</span>, <span className="sv-chip">/service/doc/…</span> (accesso con il proprio account); copia ed e-mail usano i link pubblici del sito <span className="sv-chip">{(origine || 'https://service.toscanadiagnostica.it').replace(/^https?:\/\//, '')}</span>, apribili da chiunque.</div>
        </Card>
      </>}
      <Piede meta={META} />
    </div>
  );
}

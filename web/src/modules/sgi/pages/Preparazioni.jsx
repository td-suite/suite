// Preparazioni agli esami: copia conforme di /preparazioni del sito (preparazioni.html), stessa struttura e stesse classi. Ricerca per
// codice prestazione o nome dell'esame, gruppo, elenco con la preparazione collegata e il link per GIPO (.url, un clic lo copia), tutte
// le istruzioni di preparazione (INF in versione stampabile), avviso finale e piè di pagina. ?codice= come il sito (arriva anche dai
// link stabili /sgi/p/<codice> con più preparazioni o sconosciuti).
// Nella Suite il link per GIPO resta quello PUBBLICO del sito (va ai pazienti via SMS).
import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useToast } from '../../../components/ui.jsx';
import { useDati, useStato, fileUrl, stampabileUrl, copiaLink, ORIGINE_PUBBLICA } from '../dati.js';
import { filtraPrestazioni, gruppoPrestazione, prestazioneDaCodice, codiceBase } from '../filtri.js';
import { Piede, StatoDati, Ico, Ricerca } from './comuni.jsx';

const LIMITE = 200;

export default function Preparazioni() {
  const st = useDati('preparazioni', 'docs', 'meta');
  const stato = useStato();
  const toast = useToast();
  const [params] = useSearchParams();
  const codice = params.get('codice') || params.get('q') || '';
  const [q, setQ] = useState(codice);
  const [gruppo, setGruppo] = useState('all');
  const origine = (stato?.origine || ORIGINE_PUBBLICA).replace(/\/+$/, '');

  const ROWS = st.data?.preparazioni?.righe || [];
  const DOCS = st.data?.docs || [];
  const der = useMemo(() => ({
    gruppi: [...new Set(ROWS.map(gruppoPrestazione).filter(Boolean))].sort(),
    // /api/informative del sito: informative (INF) con versione stampabile, nell'ordine di docs.json
    infs: DOCS.filter((d) => d.famiglia === 'INF' && d.stampabile),
  }), [ROWS, DOCS]);
  const res = useMemo(() => filtraPrestazioni(ROWS, { q, gruppo }), [ROWS, q, gruppo]);

  const blocco = StatoDati({ st });
  if (blocco) return blocco;
  const META = st.data.meta;
  const termini = q.trim().length > 0;
  const assente = codice && ROWS.length && !prestazioneDaCodice(ROWS, codice);
  const copia = async (url) => { if (await copiaLink(url)) toast(`Link copiato come collegamento: ${url}`); };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Preparazioni agli esami</h1>
          <div className="sub">Cerca la prestazione prenotata con il codice riportato nella conferma ricevuta via SMS (es. ECO003) oppure con il nome dell'esame: troverai le istruzioni da seguire prima di presentarti in sede. Ogni istruzione è un documento ufficiale del Sistema di Gestione Integrato di Toscana Diagnostica, sempre nella versione in vigore.</div>
        </div>
      </div>

      <div>{assente && <div className="alert warn"><Ico n="info" s={18} /><div>Il codice <strong>{codice}</strong> non è presente nell'elenco delle preparazioni pubblicate. Usa la ricerca per nome dell'esame oppure contatta il centro di prenotazione.</div></div>}</div>

      <div className="card">
        <div className="bd">
          <div className="filters" style={{ marginBottom: 6 }}>
            <label className="f" style={{ flex: '1 1 400px' }}>Cerca la tua prestazione
              <Ricerca value={q} onChange={setQ} autoFocus placeholder="Codice prestazione o nome dell'esame (es. ecografia addome, curva glicemica, RM…)" />
            </label>
            <label className="f" style={{ flex: '0 1 260px' }}>Gruppo<select value={gruppo} onChange={(e) => setGruppo(e.target.value)}>
              <option value="all">Tutti i gruppi</option>{der.gruppi.map((g) => <option key={g} value={g}>{g}</option>)}
            </select></label>
          </div>
          <span className="help">{termini || gruppo !== 'all' ? `${res.length} prestazioni trovate` : `${ROWS.length} prestazioni con preparazione pubblicata`}</span>
        </div>
      </div>

      <div className="card mt">
        <div className="hd"><h2>Prestazioni e preparazione</h2><span className="spacer" /><span className="badge b-teal">{res.length}</span></div>
        <div className="bd flush table-wrap"><table className="t"><thead><tr><th>Codice</th><th>Prestazione</th><th>Preparazione</th><th>Link per GIPO</th></tr></thead><tbody>
          {!ROWS.length ? <tr><td colSpan={4} className="empty">L'elenco delle prestazioni non è ancora stato pubblicato.</td></tr>
            : !res.length ? <tr><td colSpan={4} className="empty">Nessuna prestazione corrisponde alla ricerca.</td></tr>
              : res.slice(0, LIMITE).map((r) => {
                const ex = r.extra || {};
                const url = r.url ? `${origine}${r.url}` : null;
                return (
                  <tr key={`${r.codice}-${r.shortcut}`}>
                    <td><span className="doc-code">{r.shortcut || r.codice}</span>{r.shortcut && r.shortcut !== r.codice && <div className="small muted">GIPO {r.codice}</div>}</td>
                    <td><div className="doc-title">{r.descrizione}</div><div className="doc-sintesi">{[gruppoPrestazione(r), ex['Specialità']].filter(Boolean).join(' · ')}</div></td>
                    <td><div className="doc-actions" style={{ justifyContent: 'flex-start' }}>{(r.link || []).length ? r.link.map((l) => <a key={l.code} className="btn sm" href={fileUrl(l.file)} target="_blank" rel="noopener"><Ico n="doc" s={14} /> {l.title}</a>) : <span className="badge b-grey">nessuna preparazione</span>}</div></td>
                    <td>{url && <span className="url" title="Copia il link da inserire in GIPO (incollabile come collegamento cliccabile)" onClick={() => copia(url)}>{url}</span>}</td>
                  </tr>
                );
              })}
        </tbody></table></div>
        <div>{res.length > LIMITE && <div className="empty small">Mostrate le prime {LIMITE} prestazioni su {res.length}. Affina la ricerca.</div>}</div>
      </div>

      {der.infs.length > 0 && (
        <div className="card mt">
          <div className="hd"><h2>Tutte le istruzioni di preparazione</h2><span className="spacer" /><span className="help">versioni stampabili, senza frontespizio</span></div>
          <div className="bd"><div className="tiles">{der.infs.map((d) => <a key={d.code} className="tile" href={stampabileUrl(d)} target="_blank" rel="noopener"><div className="code">{codiceBase(d.code)}</div><div className="name">{d.title}</div></a>)}</div></div>
        </div>
      )}

      <div className="alert info mt" style={{ marginTop: 16 }}>Per ogni dubbio contatta il centro dove hai prenotato: la preparazione corretta garantisce un esame affidabile e ti evita di dover tornare.</div>
      <Piede meta={META} preparazioni />
    </div>
  );
}

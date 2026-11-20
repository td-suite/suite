// Lab Control · Impostazioni (ADMIN): soglia di ritardo e soglie per fase, ore dei campioni in viaggio, finestra dei conteggi, giorni delle
// identità recenti (impostazione di Label), colonne predefinite dell'elenco. Le altre impostazioni di Label sono in "Impostazioni Label".
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, ErrorBox, Field, PageHead, Skeleton, useToast } from '../../../components/ui.jsx';
import { api, useApi, base } from '../api.js';

const NOMI_COL = { numero: 'Numero', data: 'Data e ora', cliente: 'Cliente', sede: 'Sede', paziente: 'Paziente', tipo: 'Tipo paziente', esami: 'Esami', campioni: 'Campioni', fase: 'Fase', aggiornata: 'Ultimo aggiornamento', valore: 'Valore', fattura: 'Fattura', nc: 'NC', ritardo: 'Ritardo' };

export default function ImpostazioniLab() {
  const toast = useToast();
  const imp = useApi('/lab/impostazioni');
  const label = useApi('/impostazioni');
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { if (imp.data) setF({ ...imp.data, soglie: Object.fromEntries(imp.data.stati_soglia.map((s) => [s.stato, imp.data.soglie_fase?.[s.stato] ?? ''])), colonne: imp.data.colonne_predefinite || imp.data.colonne.filter((c) => !['tipo', 'campioni', 'aggiornata'].includes(c)) }); }, [imp.data]);
  const [giorni, setGiorni] = useState('');
  useEffect(() => { if (label.data) setGiorni(label.data.giorni_identita); }, [label.data]);
  if (!f) return <div className="page lc-page"><ErrorBox error={imp.error} /><Skeleton lines={6} /></div>;
  const salva = async () => {
    setErr(null);
    try {
      await api.put('/lab/impostazioni', {
        ore_ritardo: Number(f.ore_ritardo), giorni_refertazione: Number(f.giorni_refertazione), ore_campioni: Number(f.ore_campioni), giorni_finestra: Number(f.giorni_finestra),
        soglie_fase: Object.fromEntries(Object.entries(f.soglie).map(([k, v]) => [k, v === '' || v == null ? null : Number(v)])),
        colonne_predefinite: f.colonne.length === imp.data.colonne.length ? null : f.colonne,
      });
      if (label.data && Number(giorni) !== Number(label.data.giorni_identita)) await api.put('/impostazioni', { giorni_identita: Number(giorni) });
      toast('Impostazioni salvate'); imp.reload(); label.reload();
    } catch (e) { setErr(e); }
  };
  const tutte = imp.data.colonne;
  return (
    <div className="page lc-page">
      <PageHead title="Impostazioni di Lab Control" icon="gear" sub="Soglie dei ritardi, campioni in viaggio, identità recenti, colonne predefinite"
        actions={<><Link className="btn ghost" to={`${base}/label/impostazioni`}>Impostazioni Label</Link><button className="btn" onClick={salva}>Salva</button></>} />
      <ErrorBox error={err} />
      <div className="lc-due">
        <Card title="Ritardi" icon="alert">
          <p className="small muted" style={{ marginTop: 0 }}>Un esame è in ritardo quando oggi è oltre la data di accettazione + i suoi giorni di refertazione - 1 e non è ancora validato. L'accettazione è in ritardo quando lo è almeno un suo esame. Giorni di calendario.</p>
          <Field label="Giorni di refertazione degli esami senza un valore proprio" help="Predefinito 3. Vale per i codici che non sono nella tabella dei giorni di refertazione qui sotto.">
            <input type="number" min="1" max="365" value={f.giorni_refertazione} onChange={(e) => setF({ ...f, giorni_refertazione: e.target.value })} style={{ maxWidth: 120 }} />
          </Field>
          <Field label="Soglia della pagina Tempi (ore dall'accettazione al referto)" help="Predefinito 72. Serve solo alla pagina Tempi per contare i referti fuori soglia: non decide più i ritardi.">
            <input type="number" min="1" max="2000" value={f.ore_ritardo} onChange={(e) => setF({ ...f, ore_ritardo: e.target.value })} style={{ maxWidth: 120 }} />
          </Field>
          <div className="lc-soglie">
            <div className="small muted">Soglie per fase (facoltative): ore dall'ultimo aggiornamento del gestionale in quello stato. Vuoto = spenta.</div>
            {imp.data.stati_soglia.map((s) => (
              <label key={s.stato} className="f inline"><span>{s.stato} · {s.label}</span>
                <input type="number" min="1" max="2000" value={f.soglie[s.stato]} onChange={(e) => setF({ ...f, soglie: { ...f.soglie, [s.stato]: e.target.value } })} placeholder="spenta" style={{ maxWidth: 110 }} /></label>
            ))}
          </div>
          <Field label="Finestra (giorni)" help="Predefinito 60: in lavorazione, ritardi e campioni in viaggio contano solo le accettazioni degli ultimi N giorni (le più vecchie mai chiuse nel gestionale restano nell'elenco).">
            <input type="number" min="7" max="365" value={f.giorni_finestra} onChange={(e) => setF({ ...f, giorni_finestra: e.target.value })} style={{ maxWidth: 120 }} />
          </Field>
        </Card>
        <Card title="Campioni e identità" icon="tag">
          <Field label="Campioni raccolti e non arrivati da più di (ore)" help="Predefinito 24: il cruscotto e la pagina Campioni li evidenziano.">
            <input type="number" min="1" max="720" value={f.ore_campioni} onChange={(e) => setF({ ...f, ore_campioni: e.target.value })} style={{ maxWidth: 120 }} />
          </Field>
          <Field label="Giorni per cui si vede il nome del paziente (da 1 a 3.650)" help="Predefinito 3.650: il nome per tutte le accettazioni. I nomi mancanti vengono letti dal gestionale un po' alla volta (50 ogni 15 minuti, prima le accettazioni in corso). Il codice fiscale non si conserva. Riducendo il valore le identità più vecchie si cancellano subito.">
            <input type="number" min="1" max={label.data?.giorni_max || 3650} value={giorni} onChange={(e) => setGiorni(e.target.value)} style={{ maxWidth: 120 }} disabled={!label.data} />
          </Field>
        </Card>
      </div>
      <TempiEsame predefinito={f.giorni_refertazione} />
      <Card title="Colonne predefinite dell'elenco" icon="list">
        <p className="small muted" style={{ marginTop: 0 }}>Per chi non ha ancora scelto le sue colonne (ognuno le cambia dall'elenco con "Colonne"; la scelta resta nel suo browser).</p>
        <div className="lc-colonne">
          {tutte.map((c) => <label key={c} className="lc-check"><input type="checkbox" checked={f.colonne.includes(c)} onChange={(e) => setF({ ...f, colonne: e.target.checked ? tutte.filter((x) => x === c || f.colonne.includes(x)) : f.colonne.filter((x) => x !== c) })} />{NOMI_COL[c] || c}</label>)}
        </div>
      </Card>
    </div>
  );
}

// Giorni di refertazione per esame (v0.91.1): il gestionale non li espone, si caricano da file (codice esame + giorni) o a mano.
function TempiEsame({ predefinito }) {
  const toast = useToast();
  const [cerca, setCerca] = useState('');
  const t = useApi(`/lab/tempi?cerca=${encodeURIComponent(cerca)}`, [cerca]);
  const [senza, setSenza] = useState(null);
  const [err, setErr] = useState(null);
  const [nuovo, setNuovo] = useState({ codice: '', giorni: '' });
  const [prova, setProva] = useState(null);
  const [file, setFile] = useState(null);
  const invia = async (f, soloProva) => {
    setErr(null);
    try {
      const fd = new FormData(); fd.append('file', f);
      const j = await api.post(`/lab/tempi/importa${soloProva ? '?prova=1' : ''}`, fd);
      if (soloProva) setProva(j); else { setProva(null); setFile(null); toast(`Giorni di refertazione caricati: ${j.lette} esami`); t.reload(); }
    } catch (e) { setErr(e); }
  };
  const salva = async (codice, giorni) => {
    setErr(null);
    try { await api.put(`/lab/tempi/${encodeURIComponent(codice)}`, { giorni: Number(giorni) }); toast(`${String(codice).toUpperCase()}: ${giorni} giorni`); setNuovo({ codice: '', giorni: '' }); t.reload(); if (senza) setSenza(senza.filter((x) => x.codice !== String(codice).toUpperCase())); } catch (e) { setErr(e); }
  };
  const togli = async (codice) => { setErr(null); try { await api.del(`/lab/tempi/${encodeURIComponent(codice)}`); t.reload(); } catch (e) { setErr(e); } };
  const vediSenza = async () => { try { setSenza((await api.get('/lab/tempi/senza')).righe); } catch (e) { setErr(e); } };
  const d = t.data;
  return (
    <Card title="Giorni di refertazione per esame" icon="clock">
      <p className="small muted" style={{ marginTop: 0 }}>Il gestionale non fornisce i giorni di refertazione: caricali qui da un file Excel o CSV con una colonna del codice esame (CodEsame, Codice) e una dei giorni (GiorniRefertazione, Giorni). Va bene la Tabella esami del gestionale così com'è. Gli esami che non sono in tabella usano {predefinito} giorni.
        {d ? ` In tabella: ${d.totale} esami${d.catalogo_senza_giorni != null ? `; codici del catalogo senza giorni: ${d.catalogo_senza_giorni}` : ''}.` : ''}</p>
      <ErrorBox error={err || t.error} />
      <div className="row tight" style={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="file" accept=".xlsx,.csv,.txt" data-testid="lc-tempi-file" onChange={(e) => { const f = e.target.files?.[0] || null; setFile(f); setProva(null); if (f) invia(f, true); }} />
        {prova && file && <button className="btn" data-testid="lc-tempi-carica" onClick={() => invia(file, false)}>Carica {prova.lette} esami</button>}
        {d?.catalogo_senza_giorni > 0 && <button className="btn ghost" onClick={vediSenza}>Vedi i codici senza giorni</button>}
      </div>
      {prova && <div className="small" style={{ margin: '8px 0' }}>Nel file: {prova.lette} esami validi ({prova.nuove} nuovi, {prova.cambiate} con giorni diversi, {prova.invariate} invariati){prova.scartate_totale ? `; ${prova.scartate_totale} righe scartate perché senza giorni validi (da 1 a 365): ${prova.scartate.slice(0, 8).map((x) => x.codice).join(', ')}${prova.scartate_totale > 8 ? '…' : ''}` : ''}. Niente è stato ancora salvato.</div>}
      <div className="row tight" style={{ margin: '10px 0', flexWrap: 'wrap' }}>
        <input placeholder="Cerca codice o descrizione" value={cerca} onChange={(e) => setCerca(e.target.value)} style={{ maxWidth: 260 }} />
        <input placeholder="Codice esame" value={nuovo.codice} onChange={(e) => setNuovo({ ...nuovo, codice: e.target.value })} style={{ maxWidth: 140 }} />
        <input type="number" min="1" max="365" placeholder="Giorni" value={nuovo.giorni} onChange={(e) => setNuovo({ ...nuovo, giorni: e.target.value })} style={{ maxWidth: 90 }} />
        <button className="btn ghost" disabled={!nuovo.codice.trim() || !(Number(nuovo.giorni) >= 1)} onClick={() => salva(nuovo.codice, nuovo.giorni)}>Aggiungi o correggi</button>
      </div>
      {senza && <div className="table-wrap" style={{ maxHeight: 260, overflow: 'auto', marginBottom: 10 }}><table className="t lc-t-stretta"><thead><tr><th>Codice senza giorni</th><th>Descrizione</th><th className="num">Giorni</th></tr></thead>
        <tbody>{senza.map((x) => <tr key={x.codice}><td className="mono">{x.codice}</td><td className="small">{x.descrizione || '–'}</td><td className="num"><input type="number" min="1" max="365" placeholder={String(predefinito)} style={{ maxWidth: 80 }} onKeyDown={(e) => { if (e.key === 'Enter' && Number(e.target.value) >= 1) salva(x.codice, e.target.value); }} /></td></tr>)}
          {!senza.length && <tr><td colSpan={3} className="muted">Tutti i codici del catalogo hanno i giorni.</td></tr>}</tbody></table><div className="small muted">Scrivi i giorni e premi Invio.</div></div>}
      {d && <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}><table className="t lc-t-stretta" data-testid="lc-tempi"><thead><tr><th>Codice</th><th>Descrizione</th><th className="num">Giorni</th><th>Scadenza</th><th></th></tr></thead>
        <tbody>{d.righe.map((x) => <tr key={x.codice}><td className="mono">{x.codice}</td><td className="small">{x.descrizione || '–'}</td><td className="num">{x.giorni}</td><td className="small muted">{x.giorni === 1 ? 'il giorno stesso' : `accettazione + ${x.giorni - 1} gg`}</td><td className="num"><button className="btn ghost small" title="Togli: l'esame torna ai giorni predefiniti" onClick={() => togli(x.codice)}>Togli</button></td></tr>)}
          {!d.righe.length && <tr><td colSpan={5} className="muted">{cerca ? 'Nessun esame trovato.' : `Nessun esame in tabella: tutti usano ${predefinito} giorni.`}</td></tr>}</tbody></table></div>}
    </Card>
  );
}

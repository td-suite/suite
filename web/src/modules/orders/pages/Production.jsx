import React, { useMemo, useState } from 'react';
import { api, qs, API_BASE } from '../api.js';
import { useAuth, isOps } from '../auth.jsx';
import { useApi, Field, Loading, Empty, Card, ErrorBox, Modal, Icon, Badge, useToast, StrutturaOptions } from '../components/ui.jsx';
import { monthLabel, currentMonth, dec, itDateTime } from '../format.js';

// Produzione mensile per struttura (StudioLab). v0.68.4: vista principale = pivot per ARTICOLO di magazzino dai campioni Synclab (etichetta
// → articolo, un campione = un contenitore); seconda scheda "Per esame" (esami × mesi, correlati ai materiali) com'era prima.
export default function Production() {
  const { user } = useAuth();
  const ops = isOps(user);
  const toast = useToast();
  const [sid, setSid] = useState('');
  const [scheda, setScheda] = useState('articoli');
  const [err, setErr] = useState(null);
  const [manual, setManual] = useState(null);
  const strutture = useApi(ops ? '/strutture' : null);
  const settings = useApi(ops ? '/settings' : null);
  const syn = useApi(ops ? '/production/synclab' : null);
  const [synBusy, setSynBusy] = useState(false);
  const aggiornaSynclab = async () => {
    setErr(null); setSynBusy(true);
    try { const r = await api.post('/production/synclab/aggiorna'); toast(`Produzione da Synclab: ${r.nuove} righe nuove, ${r.aggiornate} aggiornate, ${r.invariate} invariate${r.manuali_mantenute ? `, ${r.manuali_mantenute} lasciate alle righe manuali o importate` : ''}`); syn.reload(); reload(); piv.reload(); }
    catch (e) { setErr(e); } finally { setSynBusy(false); }
  };
  const target = ops ? sid : user.struttura_id;
  const { data, reload } = useApi(target ? `/production${qs({ struttura_id: ops ? sid : undefined, months: 6 })}` : null, [sid]);
  const cons = useApi(target ? `/stock/consumption${qs({ struttura_id: ops ? sid : undefined })}` : null, [sid, data]);
  const piv = useApi(target ? `/production/articoli${qs({ struttura_id: ops ? sid : undefined, months: 6 })}` : null, [sid, data]);
  const months = useMemo(() => [...new Set((data || []).map((r) => r.month.slice(0, 7)))].sort().reverse(), [data]);
  const exams = useMemo(() => { const m = new Map(); for (const r of data || []) { const e = m.get(r.exam_code) || { code: r.exam_code, name: r.exam_name, materials: r.materials, by: {} }; e.by[r.month.slice(0, 7)] = r; m.set(r.exam_code, e); } return [...m.values()].sort((a, b) => a.code.localeCompare(b.code)); }, [data]);
  const importFile = async (f) => {
    setErr(null);
    const fd = new FormData(); fd.append('file', f);
    try { const r = await api.upload('/production/import', fd); toast(`Importate ${r.rows} righe su ${r.months} mesi`); reload(); } catch (e) { setErr(e); }
  };
  const testSl = async () => { setErr(null); try { const r = await api.get('/production/studiolab/test'); toast(`ServiceNET risponde: ${JSON.stringify(r.whoami).slice(0, 120)}`); } catch (e) { setErr(e); } };
  const syncExams = async () => { setErr(null); try { const r = await api.post('/production/studiolab/sync-exams'); toast(`Catalogo esami sincronizzato: ${r.exams} esami`); } catch (e) { setErr(e); } };
  const sl = settings.data?.studiolab;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Produzione{ops ? ' StudioLab' : ''}</h1><div className="sub">Per articolo di magazzino: campioni (provette e contenitori) del gestionale per mese, dall'etichetta abbinata all'articolo. Per esame: esami per mese, correlati ai materiali attraverso la tabella esame → articolo</div></div>
        <div className="row">
          {ops && <Field label="Struttura"><select value={sid} onChange={(e) => setSid(e.target.value)} style={{ minWidth: 260 }}><option value="">Scegli…</option><StrutturaOptions strutture={strutture.data} filter={(s) => s.kind !== 'LAB'} /></select></Field>}
          {ops && <a className="btn ghost" href={`${API_BASE}/production/import/template.xlsx`}><Icon name="download" size={16} />Modello</a>}
          {ops && <label className="btn ghost"><Icon name="upload" size={16} />Importa file<input type="file" accept=".csv,.xlsx" style={{ display: 'none' }} onChange={(e) => e.target.files[0] && importFile(e.target.files[0])} /></label>}
          {ops && sid && <button className="btn ghost" onClick={() => setManual({ month: currentMonth(), items: [{ examCode: '', examName: '', qty: '' }] })}><Icon name="plus" size={16} />Inserisci mese</button>}
          {ops && <button className="btn" disabled={!syn.data?.disponibile || synBusy} title={syn.data && !syn.data.disponibile ? syn.data.motivo : 'Ricalcola la produzione di tutti i mesi presenti nella copia Synclab'} onClick={aggiornaSynclab}><Icon name="flask" size={16} />{synBusy ? 'Aggiornamento…' : 'Aggiorna da Synclab'}</button>}
          {ops && <button className="btn ghost" disabled={!sl?.configured} title={!sl?.configured ? 'STUDIOLAB_API_KEY non impostata nella Suite' : ''} onClick={testSl}><Icon name="link" size={16} />Prova ServiceNET</button>}
          {ops && <button className="btn ghost" disabled={!sl?.configured} onClick={syncExams}><Icon name="link" size={16} />Sincronizza catalogo esami</button>}
        </div>
      </div>
      <ErrorBox error={err} />
      {ops && <div className="alert info" style={{ marginBottom: 14 }}><div>La produzione arriva dalla copia Synclab del gestionale (ultimo aggiornamento: {syn.data?.ultimo?.at ? `${itDateTime(syn.data.ultimo.at)}, ${syn.data.ultimo.strutture} strutture, mesi ${syn.data.ultimo.dal ? `${monthLabel(syn.data.ultimo.dal)} – ${monthLabel(syn.data.ultimo.al)}` : '–'}` : 'mai'}), dai messaggi HL7 (ultimo: {sl?.last_hl7_at ? itDateTime(sl.last_hl7_at) : 'nessuno'}) e dai file importati.
        <div className="small" style={{ marginTop: 4 }}>Regola: per lo stesso mese ed esame una riga inserita a mano o importata da file vince sul conteggio di Synclab, che non la sovrascrive. Synclab conta le righe d'esame non cancellate delle accettazioni attive dei client abbinati a una struttura; ricalcola tutti i mesi, il mese in corso compreso, ogni ora e con "Aggiorna da Synclab".{syn.data?.client_senza_struttura ? ` ${syn.data.client_senza_struttura} client Synclab con accettazioni non sono abbinati a una sede o Legal entity (Amministrazione > Connettori > StudioLAB > Dati Synclab): la loro produzione non è contata.` : ''}{syn.data && !syn.data.disponibile ? ` Synclab non disponibile: ${syn.data.motivo}.` : ''}</div></div></div>}
      {target && <div className="tabs" role="tablist">{[['articoli', 'Per articolo di magazzino'], ['esami', 'Per esame']].map(([k, l]) => <button key={k} role="tab" aria-selected={scheda === k} className={scheda === k ? 'on' : ''} onClick={() => setScheda(k)}>{l}</button>)}</div>}
      {!target ? <Card><Empty>Scegli una struttura</Empty></Card> : scheda === 'articoli' ? <PivotArticoli piv={piv.data} exportHref={`${API_BASE}/production/articoli.xlsx${qs({ struttura_id: ops ? sid : undefined, months: 6 })}`} ops={ops} /> : !data ? <Loading /> : (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)' }}>
          <Card title="Esami per mese" flush>
            {!exams.length ? <Empty>Nessuna produzione registrata</Empty> : (
              <div className="table-wrap"><table className="t">
                <thead><tr><th>Esame</th><th>Materiale correlato</th>{months.map((m) => <th key={m} className="num">{monthLabel(m)}</th>)}</tr></thead>
                <tbody>{exams.map((e) => <tr key={e.code}><td><span className="mono">{e.code}</span> {e.name}</td><td className="small">{e.materials ? e.materials.map((m) => `${m.article}${Number(m.qty_per_exam) !== 1 ? ` ×${m.qty_per_exam}` : ''}`).join(', ') : <Badge tone="red">non correlato</Badge>}</td>{months.map((m) => <td key={m} className="num">{e.by[m]?.qty ?? <span className="muted">–</span>}</td>)}</tr>)}</tbody>
              </table></div>
            )}
          </Card>
          <Consumo cons={cons.data} />
        </div>
      )}
      {target && scheda === 'articoli' && <div style={{ marginTop: 14 }}><Consumo cons={cons.data} /></div>}
      {manual && (
        <Modal title="Inserimento manuale della produzione" onClose={() => setManual(null)} wide footer={<><button className="btn ghost" onClick={() => setManual(null)}>Annulla</button><button className="btn" onClick={async () => { setErr(null); try { await api.post('/production', { struttura_id: Number(sid), month: manual.month, items: manual.items.filter((i) => i.examCode).map((i) => ({ ...i, qty: Number(i.qty) || 0 })) }); toast('Produzione salvata'); setManual(null); reload(); } catch (e) { setErr(e); } }}>Salva</button></>}>
          <Field label="Mese"><input type="month" value={manual.month} onChange={(e) => setManual({ ...manual, month: e.target.value })} style={{ width: 200 }} /></Field>
          <div style={{ marginTop: 10 }}>{manual.items.map((it, i) => (
            <div key={i} className="row" style={{ marginBottom: 6 }}>
              <input placeholder="codice esame" value={it.examCode} onChange={(e) => setManual({ ...manual, items: manual.items.map((x, j) => (j === i ? { ...x, examCode: e.target.value } : x)) })} style={{ width: 140 }} />
              <input placeholder="descrizione" value={it.examName} onChange={(e) => setManual({ ...manual, items: manual.items.map((x, j) => (j === i ? { ...x, examName: e.target.value } : x)) })} style={{ flex: 1 }} />
              <input type="number" min="0" placeholder="n." value={it.qty} onChange={(e) => setManual({ ...manual, items: manual.items.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)) })} style={{ width: 100 }} />
            </div>))}
            <button className="btn sm ghost" onClick={() => setManual({ ...manual, items: [...manual.items, { examCode: '', examName: '', qty: '' }] })}>+ Esame</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ArticleName({ id }) {
  const { data } = useApi('/articles');
  const a = (data || []).find((x) => x.id === id);
  return a ? <>{a.name}<div className="small muted">{a.pack_label}</div></> : <span className="muted">#{id}</span>;
}

// Consumo medio mensile usato dalla verifica degli ordini: per articolo, con la fonte (campioni Synclab o esami × correlazione)
function Consumo({ cons }) {
  return (
    <Card title={`Consumo medio mensile (${cons?.months || 0} mesi)`} flush>
      {!cons?.items?.length ? <Empty>Nessun consumo calcolabile: servono campioni Synclab con etichette abbinate, oppure produzione e correlazioni</Empty> : (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Articolo</th><th>Fonte</th><th className="num">Unità/mese</th><th className="num">Confezioni/mese</th></tr></thead>
          <tbody>{cons.items.map((it) => <tr key={it.article_id}><td><ArticleName id={it.article_id} /></td><td>{it.fonte === 'CAMPIONI' ? <Badge tone="teal">campioni</Badge> : <Badge tone="grey">esami × correlazione</Badge>}</td><td className="num">{dec(it.units, 0)}</td><td className="num strong">{dec(it.packs, 1)}</td></tr>)}</tbody>
        </table></div>
      )}
      <div className="small muted" style={{ padding: '8px 12px' }}>Con i campioni Synclab della struttura, gli articoli abbinati a un'etichetta si misurano dai campioni (un campione = un contenitore, anche se serve più esami); esami × correlazione resta per le strutture senza campioni e per gli articoli che nessuna etichetta rappresenta.</div>
    </Card>
  );
}

// Pivot per articolo di magazzino: colonne mesi, riga per articolo con i campioni, totale e media mensile; etichette non abbinate a parte
function PivotArticoli({ piv, exportHref, ops }) {
  const [aperte, setAperte] = useState(false);
  if (!piv) return <Loading />;
  if (!piv.disponibile) return <Card><Empty>Pivot per articolo non disponibile: {piv.motivo}. Usa la scheda "Per esame".</Empty></Card>;
  const mesi = piv.mesi || [];
  const N = (v) => (v ? Number(v).toLocaleString('it-IT') : <span className="muted">–</span>);
  const totMese = (m) => piv.articoli.reduce((t, a) => t + (a.mesi[m] || 0), 0) + (piv.non_abbinate.mesi[m] || 0);
  return (
    <Card flush title={`Campioni per articolo di magazzino (${mesi.length} mesi con dati)`} actions={<a className="btn sm ghost" href={exportHref}><Icon name="download" size={16} />Excel</a>}>
      {!piv.campioni ? <Empty>Nessun campione Synclab per questa struttura negli ultimi mesi: la produzione per esame resta nella scheda "Per esame"</Empty> : (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Articolo di magazzino</th>{mesi.map((m) => <th key={m} className="num">{monthLabel(m)}</th>)}<th className="num">Totale</th><th className="num">Media mensile</th></tr></thead>
          <tbody>
            {piv.articoli.map((a) => <tr key={a.article_id}>
              <td><div className="strong">{a.name}</div><div className="small muted">{a.etichette.map((e) => `${e.etichetta || 'etichetta non indicata'} (${e.totale.toLocaleString('it-IT')})`).join(' · ')}{a.pack_label ? ` · ${a.pack_label}` : ''}</div></td>
              {mesi.map((m) => <td key={m} className="num">{N(a.mesi[m])}</td>)}
              <td className="num strong">{N(a.totale)}</td><td className="num">{dec(a.media, 1)}{a.confezioni_mese != null && <div className="small muted">{dec(a.confezioni_mese, 2)} conf.</div>}</td></tr>)}
            {piv.non_abbinate.totale > 0 && <tr className="warnrow">
              <td><button className="btn sm link" style={{ padding: 0 }} onClick={() => setAperte(!aperte)}>{aperte ? '▾' : '▸'} Etichette non abbinate a un articolo ({piv.non_abbinate.etichette.length})</button>{ops && <div className="small muted">Abbinale in Correlazione esami e materiali › Etichette viste nel gestionale</div>}</td>
              {mesi.map((m) => <td key={m} className="num">{N(piv.non_abbinate.mesi[m])}</td>)}
              <td className="num strong">{N(piv.non_abbinate.totale)}</td><td className="num">{dec(piv.non_abbinate.media, 1)}</td></tr>}
            {aperte && piv.non_abbinate.etichette.map((e) => <tr key={`n-${e.chiave}`} className="small">
              <td style={{ paddingLeft: 28 }}>{e.etichetta || <span className="muted">etichetta non indicata</span>}</td>
              {mesi.map((m) => <td key={m} className="num">{N(e.mesi[m])}</td>)}
              <td className="num">{N(e.totale)}</td><td className="num">{dec(e.media, 1)}</td></tr>)}
            <tr><td className="strong">Totale campioni</td>{mesi.map((m) => <td key={m} className="num strong">{N(totMese(m))}</td>)}<td className="num strong">{N(piv.campioni)}</td><td /></tr>
          </tbody>
        </table></div>
      )}
      <div className="small muted" style={{ padding: '8px 12px' }}>Quantità = numero di campioni (provette e contenitori) con quell'etichetta nel mese, dalle accettazioni attive della copia Synclab dei client abbinati alla struttura: un campione conta una volta anche quando serve più esami. Media mensile = totale / mesi con campioni. L'etichetta porta all'articolo con l'abbinamento in Correlazione esami e materiali.</div>
    </Card>
  );
}


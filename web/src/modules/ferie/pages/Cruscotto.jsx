// Cruscotto (amministratore: tutte le aree; responsabile: la propria catena dall'anagrafica, diretti e livelli sotto): piani per stato per area, piani
// e variazioni da approvare, residui a rischio, non goduto da smaltire, saldi negativi, saldo per persona con il residuo dell'anno
// precedente modificabile (amministratore) e importazione dei residui da XLSX (prima la prova, poi l'importazione).
import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, apiBase, base, qs, useApi } from '../api.js';
import { useAuth, isHr } from '../auth.jsx';
import { Card, Loading, Empty, PageHead, Field, Modal, Seg, SearchInput, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { StatoPianoBadge } from '../components.jsx';
import { num, periodo, quantita, oggiIso, itData, STATO_PIANO } from '../format.js';

export default function Cruscotto() {
  const { user } = useAuth();
  const hr = isHr(user);
  const toast = useToast();
  const nav = useNavigate();
  const anno0 = Number(oggiIso().slice(0, 4));
  const [anno, setAnno] = useState(anno0);
  const [filtro, setFiltro] = useState('');
  const [area, setArea] = useState('');
  const [edit, setEdit] = useState(null);
  const [imp, setImp] = useState(false);
  const { data, loading, error, reload } = useApi(`/cruscotto?anno=${anno}`, [anno]);
  const saldi = useMemo(() => (data?.saldi || []).filter((s) => (!area || s.gruppo === area) && (!filtro || s.persona.toLowerCase().includes(filtro.toLowerCase()))), [data, area, filtro]);
  if (error) return <div className="page"><Empty icon="alert" title="Errore">{error.message}</Empty></div>;
  if (!data) return <div className="page"><Loading /></div>;
  const salva = async (b) => { try { await api.put(`/saldi/${edit.person_id}/${anno}`, b); toast('Saldo aggiornato'); setEdit(null); reload(); } catch (e) { toast(e, 'err'); } };
  return (
    <div className="page">
      <PageHead title={hr ? 'Cruscotto' : 'Cruscotto della mia area'} icon="stats" sub={hr ? 'Piani per stato in ogni area, approvazioni, residui a rischio, non goduto da smaltire e saldo di ogni dipendente.' : 'I dipendenti delle aree che gestisci: piani, variazioni e saldi.'}
        actions={<><Seg value={anno} onChange={setAnno} items={[anno0 - 1, anno0, anno0 + 1].map((a) => ({ value: a, label: String(a) }))} label="Anno" />
          {hr && <><a className="btn ghost" href={`${apiBase}/saldi/modello.xlsx?anno=${anno}`} target="_blank" rel="noopener"><Icon name="sheet" />Modello residui</a><button className="btn" onClick={() => setImp(true)}><Icon name="upload" />Importa residui</button></>}</>} />
      <div className="fe-kpis">
        <div className="fe-kpi"><div className="l">Dipendenti</div><div className="v">{data.persone}</div></div>
        {Object.entries(STATO_PIANO).map(([k, v]) => <div key={k} className={`fe-kpi ${['PROPOSTO', 'IN_REVISIONE'].includes(k) && data.piani_per_stato[k] ? 'warn' : ''}`}><div className="l">Piani: {v.breve.toLowerCase()}</div><div className="v">{data.piani_per_stato[k] || 0}</div></div>)}
        <Link className={`fe-kpi click ${data.variazioni.length ? 'warn' : ''}`} to={`${base}/variazioni`}><div className="l">Variazioni da decidere</div><div className="v">{data.variazioni.length}</div></Link>
        <div className={`fe-kpi ${data.a_rischio.length ? 'warn' : ''}`}><div className="l">Residui a rischio</div><div className="v">{data.a_rischio.length}</div><div className="f">molti giorni ancora da pianificare</div></div>
        <div className={`fe-kpi ${data.ap_da_smaltire.length ? 'neg' : ''}`}><div className="l">Non goduto da smaltire</div><div className="v">{data.ap_da_smaltire.length}</div><div className="f">anno precedente, entro la scadenza</div></div>
        {hr && <div className={`fe-kpi ${data.senza_residuo_ap ? 'warn' : ''}`}><div className="l">Residuo AP non inserito</div><div className="v">{data.senza_residuo_ap}</div><div className="f">a mano o da XLSX</div></div>}
      </div>
      {data.da_assegnare?.length > 0 && <div className="alert warn"><Icon name="alert" /><span>{data.da_assegnare.length} {data.da_assegnare.length === 1 ? 'persona non ha' : 'persone non hanno'} un'area ricavabile dall'organigramma ({data.da_assegnare.map((x) => x.persona).join(', ')}): assegnala in Impostazioni &gt; Aree forzate.</span></div>}
      <Card title="Piani per stato in ogni area" icon="grid" flush>
        <div className="table-wrap"><table className="t fe-table"><thead><tr><th>Area</th><th className="num">Persone</th>{Object.values(STATO_PIANO).map((v) => <th key={v.breve} className="num">{v.breve}</th>)}<th className="num">Pianificati</th><th className="num">Da pianificare</th><th className="num">Goduti</th><th /></tr></thead>
          <tbody>{data.per_area.map((a) => <tr key={a.gruppo}><td className="strong">{a.nome}</td><td className="num">{a.persone}</td>{Object.keys(STATO_PIANO).map((k) => <td key={k} className={`num ${['PROPOSTO', 'IN_REVISIONE'].includes(k) && a.stati[k] ? 'fe-warn strong' : ''}`}>{a.stati[k] || ''}</td>)}
            <td className="num">{num(a.goduto + a.pianificato)}</td><td className="num strong">{num(a.da_pianificare)}</td><td className="num">{num(a.goduto)}</td>
            <td><Link className="btn ghost sm" to={`${base}/area?gruppo=${encodeURIComponent(a.gruppo)}&anno=${anno}`}>Apri<Icon name="arrowRight" /></Link></td></tr>)}</tbody></table></div>
      </Card>
      <div className="fe-two">
        <Card title="Piani da approvare" icon="check" flush>
          {!data.da_approvare.length ? <Empty icon="check" title="Nessun piano in attesa" compact /> : (
            <div className="table-wrap"><table className="t fe-table"><thead><tr><th>Persona</th><th>Stato</th><th>Inviato</th></tr></thead>
              <tbody>{data.da_approvare.slice(0, 20).map((r) => <tr key={r.piano_id} className="click" onClick={() => nav(`${base}/area?gruppo=${encodeURIComponent(r.gruppo)}&anno=${anno}`)}><td className="strong">{r.persona}<div className="small muted">{r.gruppo_nome}</div></td><td><StatoPianoBadge stato={r.stato} breve /></td><td className={r.giorni_attesa > 3 ? 'fe-neg small' : 'small'}>{r.inviato_at ? `${itData(String(r.inviato_at).slice(0, 10))} · ${r.giorni_attesa} gg` : ''}</td></tr>)}</tbody></table></div>)}
        </Card>
        <Card title="Variazioni in attesa" icon="refresh" flush actions={<Link className="btn ghost sm" to={`${base}/variazioni`}>Tutte<Icon name="arrowRight" /></Link>}>
          {!data.variazioni.length ? <Empty icon="check" title="Nessuna variazione in attesa" compact /> : (
            <div className="table-wrap"><table className="t fe-table"><thead><tr><th>Persona</th><th>Periodo</th><th className="num">Quantità</th></tr></thead>
              <tbody>{data.variazioni.slice(0, 10).map((r) => <tr key={r.id} className="click" onClick={() => nav(`${base}/richieste/${r.id}`)}><td className="strong">{r.persona}<div className="small muted">{r.gruppo_nome}</div></td><td>{periodo(r)}{r.variazione_proposta && <div className="small fe-warn">{r.variazione_proposta.tipo === 'RIMOZIONE' ? 'da togliere' : 'da spostare'}</div>}</td><td className="num">{quantita(r)}</td></tr>)}</tbody></table></div>)}
        </Card>
      </div>
      {(data.a_rischio.length > 0 || data.ap_da_smaltire.length > 0) && (
        <div className="fe-two">
          <Card title="Residui a rischio" icon="alert">{!data.a_rischio.length ? <div className="small muted">Nessuno (controllo attivo nei mesi impostati, predefiniti ottobre e novembre).</div> : <ul className="fe-list">{data.a_rischio.map((s) => <li key={s.person_id}><span className="strong">{s.persona}</span><span className="small">{num(s.disponibile)} giorni da pianificare · {s.gruppo_nome}</span></li>)}</ul>}</Card>
          <Card title="Anno precedente da smaltire" icon="clock">{!data.ap_da_smaltire.length ? <div className="small muted">Nessuno.</div> : <ul className="fe-list">{data.ap_da_smaltire.map((s) => <li key={s.person_id}><span className="strong">{s.persona}</span><span className="small">{s.avvisi.find((a) => a.tipo === 'AP_SCADENZA')?.testo}</span></li>)}</ul>}</Card>
        </div>
      )}
      <Card title={`Saldo per persona ${anno}`} icon="users" flush actions={<div className="row tight"><div style={{ width: 220 }}><SearchInput value={filtro} onChange={setFiltro} placeholder="Cerca persona" /></div>
        <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area"><option value="">Tutte le aree</option>{data.per_area.map((a) => <option key={a.gruppo} value={a.gruppo}>{a.nome}</option>)}</select></div>}>
        <div className="table-wrap"><table className="t fe-table">
          <thead><tr><th>Persona</th><th>Area</th><th>Piano</th><th>Responsabile</th><th className="num">Annui</th><th className="num">Spettanza</th><th className="num">Maturato</th><th className="num">Anno prec.</th><th className="num">Goduti</th><th className="num">Pianificati</th><th className="num">Variaz.</th><th className="num">Da pianificare</th><th>Avvisi</th>{hr && <th />}</tr></thead>
          <tbody>{saldi.map((s) => (
            <tr key={s.person_id}>
              <td className="strong">{s.persona}<div className="small muted">{s.ruolo}</div></td><td className="small">{s.gruppo_nome}</td><td><StatoPianoBadge stato={s.piano_stato} breve /></td><td className="small">{s.approvatore || 'Amministratore'}</td>
              <td className="num">{num(s.giorni_annui)}</td><td className="num">{num(s.spettanza)}{s.mesi < 12 && <div className="small muted">{s.mesi}/12</div>}</td><td className="num">{num(s.maturato)}</td>
              <td className="num">{num(s.residuo_ap)}{!s.residuo_ap_fonte && <div className="small muted">da inserire</div>}</td><td className="num">{num(s.goduto)}</td><td className="num">{num(s.pianificato_totale)}</td><td className="num">{num(s.in_attesa)}</td>
              <td className={`num strong ${s.da_pianificare < 0 ? 'fe-neg' : ''}`}>{num(s.da_pianificare)}</td>
              <td className="small" style={{ minWidth: 150 }}>{s.avvisi.map((a, i) => <div key={i} className={a.grave ? 'fe-neg' : 'fe-warn'} title={a.testo}>{breve(a)}</div>)}</td>
              {hr && <td><button className="btn ghost sm" onClick={() => setEdit(s)} title="Residuo anno precedente e forzature"><Icon name="edit" /></button></td>}
            </tr>))}</tbody>
        </table></div>
      </Card>
      {edit && <SaldoModal s={edit} anno={anno} onClose={() => setEdit(null)} onSave={salva} />}
      {imp && <ImportModal anno={anno} onClose={() => setImp(false)} onDone={() => { setImp(false); reload(); }} />}
    </div>
  );
}

// Avviso in forma breve per la tabella dei saldi (il testo completo resta nel title)
const breve = (a) => (a.tipo === 'RISCHIO' ? `${num(a.giorni)} gg da pianificare` : a.tipo === 'NEGATIVO' ? 'saldo negativo' : a.grave ? `${num(a.giorni)} gg anno prec. scaduti` : `${num(a.giorni)} gg anno prec. entro la scadenza`);

function SaldoModal({ s, anno, onClose, onSave }) {
  const [f, setF] = useState({ residuo_ap: s.residuo_ap ?? 0, giorni_annui: '', note: s.note || '' });
  return (
    <Modal title={`Saldo ${anno} · ${s.persona}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Chiudi</button><button className="btn primary" onClick={() => onSave({ residuo_ap: Number(String(f.residuo_ap).replace(',', '.')), giorni_annui: f.giorni_annui === '' ? undefined : Number(String(f.giorni_annui).replace(',', '.')), note: f.note })}>Salva</button></>}>
      <div className="fe-form">
        <Field label={`Residuo ferie al 31/12/${anno - 1} (giorni)`} help="Dal cedolino o dal consulente del lavoro"><input type="text" inputMode="decimal" value={f.residuo_ap} onChange={(e) => setF({ ...f, residuo_ap: e.target.value })} /></Field>
        <Field label="Forzatura dei giorni annui (facoltativa)" help={`Oggi ${num(s.giorni_annui)} giorni (${s.spettanza_fonte}). Vuoto = invariato.`}><input type="text" inputMode="decimal" value={f.giorni_annui} onChange={(e) => setF({ ...f, giorni_annui: e.target.value })} /></Field>
        <Field label="Note"><textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={500} /></Field>
      </div>
    </Modal>
  );
}

function ImportModal({ anno, onClose, onDone }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [rap, setRap] = useState(null);
  const [busy, setBusy] = useState(false);
  const invia = async (prova) => {
    if (!file) return;
    setBusy(true);
    try { const fd = new FormData(); fd.append('file', file); const r = await api.upload(`/saldi/import${qs({ prova: prova ? '1' : '', anno })}`, fd); setRap(r); if (!prova) { toast(`${r.scritte} residui importati`); onDone(); } }
    catch (e) { toast(e, 'err'); } setBusy(false);
  };
  return (
    <Modal title="Importa i residui dell'anno precedente" onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Chiudi</button><button className="btn" disabled={!file || busy} onClick={() => invia(true)}>Prova (nessuna scrittura)</button><button className="btn primary" disabled={!file || busy || !rap?.prova || rap.abbinate === 0} onClick={() => invia(false)}>Importa</button></>}>
      <p className="small">Scarica il modello (precompilato con i dipendenti del perimetro), compila la colonna dei giorni residui e ricaricalo. Le persone si riconoscono da codice fiscale, email o Cognome Nome.</p>
      <input type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] || null); setRap(null); }} />
      {rap && (
        <div className="fe-rapporto">
          <div className="small"><b>{rap.prova ? 'Prova' : 'Importazione'}</b>: {rap.righe} righe, {rap.abbinate} abbinate{rap.prova ? '' : `, ${rap.scritte} scritte`}, {rap.saltate.length} saltate, {rap.errori.length} errori.</div>
          {rap.errori.length > 0 && <ul className="small fe-neg">{rap.errori.slice(0, 20).map((e, i) => <li key={i}>Riga {e.riga} · {e.persona}: {e.motivo}</li>)}</ul>}
          {rap.dettaglio.length > 0 && <ul className="small">{rap.dettaglio.slice(0, 20).map((d) => <li key={d.riga}>{d.persona} · {d.anno}: {num(d.residuo_ap)} giorni</li>)}</ul>}
        </div>
      )}
    </Modal>
  );
}

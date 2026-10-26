import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Loading, ErrorBox, Modal, Badge, Field, useToast, Card } from '../components/ui.jsx';
import { itDateTime } from '../format.js';
import { sedeLabel } from './Sedi.jsx';
import { meseTxt, thisMonth, addMonths, daysOf, dow, itD, ore, oreTxt, DAYS, DAYS_S, pdfTurni } from '../lib/personale.js';

export default function Turni() {
  const { user } = useAuth(); const toast = useToast();
  const gest = ['ADMIN', 'RESP_SAN'].includes(user.role);
  const [mese, setMese] = useState(thisMonth()); const [sede, setSede] = useState('');
  const sedi = useApi('/strutture'); const profs = useApi('/personale/professionisti?pianificabili=1');   // solo persone attive e non escluse dalla pianificazione
  const { data, error, reload } = useApi(`/personale/turni?mese=${mese}${sede ? '&sede_id=' + sede : ''}`, [mese, sede]);
  const [edit, setEdit] = useState(null); const [gen, setGen] = useState(false);
  const sm = useMemo(() => Object.fromEntries((sedi.data || []).map((s) => [s.id, sedeLabel(s)])), [sedi.data]);
  const byDay = useMemo(() => { const m = {}; (data?.turni || []).forEach((t) => (m[t.data] ||= []).push(t)); return m; }, [data]);
  const days = daysOf(mese); const pad = dow(days[0]);
  const tot = (data?.turni || []).reduce((a, t) => a + ore(t.ora_da, t.ora_a), 0), scoperti = (data?.turni || []).filter((t) => !t.prof_id).length;
  const conferma = async () => { if (!window.confirm(`Confermare i turni di ${meseTxt(mese)}? Diventano visibili a tutti e ai professionisti (che ricevono una email se configurata).`)) return; try { const r = await api.post(`/personale/turni/mesi/${mese}/conferma`, {}); toast(`Mese confermato · ${r.professionisti} professionisti coinvolti${r.notificati ? `, ${r.notificati} avvisati via email` : ''}`); reload(); } catch (e) { toast(e.message, 'err'); } };
  const riapri = async () => { if (!window.confirm('Riaprire il mese in bozza? I professionisti non lo vedranno più finché non viene riconfermato.')) return; try { await api.post(`/personale/turni/mesi/${mese}/riapri`); reload(); } catch (e) { toast(e.message, 'err'); } };
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Turni</h1><div className="sub">Pianificazione mensile del personale medico e sanitario per sede. Il mese diventa visibile a tutti quando viene confermato.</div></div>
        <div className="row">
          <button className="btn ghost sm" onClick={() => setMese(addMonths(mese, -1))}>‹</button><b style={{ minWidth: 130, textAlign: 'center' }}>{meseTxt(mese)}</b><button className="btn ghost sm" onClick={() => setMese(addMonths(mese, 1))}>›</button>
          <select value={sede} onChange={(e) => setSede(e.target.value)} style={{ width: 'auto' }}><option value="">Tutte le sedi</option>{(sedi.data || []).map((s) => <option key={s.id} value={s.id}>{sedeLabel(s)}</option>)}</select>
        </div></div>
      <ErrorBox error={error} />
      {!data || !sedi.data ? <Loading /> : (<>
        <div className="row" style={{ marginBottom: 12, gap: 10 }}>
          {data.mese.stato === 'CONFERMATO' ? <Badge tone="green">confermato {data.mese.confermato_at ? itDateTime(data.mese.confermato_at) : ''}{data.mese.confermato_da_nome ? ' da ' + data.mese.confermato_da_nome : ''}</Badge> : <Badge tone="amber">bozza{gest ? '' : ': non ancora pubblicato'}</Badge>}
          <span className="small muted">{data.turni.length} turni · {oreTxt(tot)}{scoperti ? ` · ${scoperti} scoperti` : ''}</span>
          <span className="spacer" />
          {data.turni.length > 0 && <button className="btn ghost sm" onClick={() => { const { doc, filename } = pdfTurni(mese, data.turni, sede ? sm[sede] : 'tutte le sedi', sm); doc.save(filename); }}>PDF</button>}
          {gest && <><button className="btn ghost sm" onClick={() => setGen(true)}>Genera dalla pianificazione…</button><button className="btn sm" onClick={() => setEdit({ sede_id: sede || sedi.data[0].id, data: today.startsWith(mese) ? today : days[0], ora_da: '08:00', ora_a: '14:00', prof_id: '', profilo: '', attivita: '', nota: '' })}>+ Turno</button>
            {data.mese.stato === 'CONFERMATO' ? <button className="btn ghost sm" onClick={riapri}>Riapri in bozza</button> : <button className="btn sm dark" onClick={conferma}>Conferma il mese</button>}</>}
        </div>
        {!gest && data.mese.stato !== 'CONFERMATO' ? <div className="card"><div className="bd empty">I turni di {meseTxt(mese)} non sono ancora stati confermati.</div></div> : (
          <div className="turni-grid">
            {DAYS_S.map((d) => <div key={d} className="small strong muted" style={{ textAlign: 'center' }}>{d}</div>)}
            {Array.from({ length: pad }).map((_, i) => <div key={'p' + i} />)}
            {days.map((d) => { const g = dow(d); const list = byDay[d] || []; return (
              <div key={d} className={`turni-day ${g === 6 ? 'off' : ''} ${d === today ? 'today' : ''}`}>
                <div className="dn"><span>{Number(d.slice(8))}</span>{gest && <button className="iconbtn" title="Aggiungi turno" onClick={() => setEdit({ sede_id: sede || sedi.data[0].id, data: d, ora_da: '08:00', ora_a: '14:00', prof_id: '', profilo: '', attivita: '', nota: '' })}>+</button>}</div>
                {list.map((t) => <div key={t.id} className={`turno ${!t.prof_id ? 'scoperto' : t.prof_tipo === 'medico' ? 'medico' : ''}`} title={`${sm[t.sede_id] || t.sede_id} · ${t.attivita || ''}`} onClick={() => gest && setEdit({ ...t, prof_id: t.prof_id || '', profilo: t.profilo || '', attivita: t.attivita || '', nota: t.nota || '' })}>
                  <div className="who">{t.ora_da}–{t.ora_a} {t.prof_nome || `SCOPERTO${t.profilo ? ' · ' + t.profilo : ''}`}</div>{!sede && <div style={{ opacity: .8 }}>{(sm[t.sede_id] || '').split(' · ').pop()}</div>}</div>)}
              </div>); })}
          </div>)}
      </>)}
      {edit && <TurnoModal t={edit} sedi={sedi.data} profs={(profs.data || []).filter((p) => p.attivo !== false)} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} toast={toast} />}
      {gen && <GeneraModal mese={mese} sedi={sedi.data} onClose={() => setGen(false)} onDone={() => { setGen(false); reload(); }} toast={toast} />}
    </div>
  );
}

function TurnoModal({ t, sedi, profs, onClose, onSaved, toast }) {
  const [f, setF] = useState(t); const [disp, setDisp] = useState(null);
  useEffect(() => { api.get(`/personale/fabbisogno?mese=${f.data.slice(0, 7)}`, { silent: true }).then((r) => setDisp(r)).catch(() => {}); }, []);
  const save = async () => { try { const body = { sede_id: f.sede_id, data: f.data, ora_da: f.ora_da, ora_a: f.ora_a, prof_id: f.prof_id ? Number(f.prof_id) : null, profilo: f.profilo || null, attivita: f.attivita || null, nota: f.nota || null }; if (f.id) await api.put(`/personale/turni/${f.id}`, body); else await api.post('/personale/turni', body); toast('Turno salvato'); onSaved(); } catch (e) { toast(e.message, 'err'); } };
  const del = async () => { if (!window.confirm('Eliminare il turno?')) return; try { await api.del(`/personale/turni/${f.id}`); onSaved(); } catch (e) { toast(e.message, 'err'); } };
  const apri = async () => { try { await api.post('/personale/posizioni', { titolo: `${f.profilo || 'Professionista'} · ${itD(f.data)} ${f.ora_da}–${f.ora_a}`, sede_id: f.sede_id, profilo: f.profilo || null, dal: f.data, al: f.data, ora_da: f.ora_da, ora_a: f.ora_a, descrizione: f.attivita || '', turno_id: f.id || null }); toast('Pubblicato in bacheca'); } catch (e) { toast(e.message, 'err'); } };
  const sugg = (disp?.turniScoperti || []).find((x) => x.turnoId === f.id)?.candidati || [];
  return (
    <Modal title={f.id ? 'Turno' : 'Nuovo turno'} onClose={onClose} footer={<>{f.id && <button className="btn ghost" style={{ color: 'var(--red)' }} onClick={del}>Elimina</button>}{f.id && !f.prof_id && <button className="btn ghost" onClick={apri}>Pubblica in bacheca</button>}<span className="spacer" /><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}>
      <div className="form-grid">
        <Field label="Sede"><select value={f.sede_id} onChange={(e) => setF({ ...f, sede_id: e.target.value })}>{sedi.map((s) => <option key={s.id} value={s.id}>{sedeLabel(s)}</option>)}</select></Field>
        <Field label="Data"><input type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></Field>
        <Field label="Dalle"><input type="time" value={f.ora_da} onChange={(e) => setF({ ...f, ora_da: e.target.value })} /></Field>
        <Field label="Alle"><input type="time" value={f.ora_a} onChange={(e) => setF({ ...f, ora_a: e.target.value })} /></Field>
        <Field label="Professionista (vuoto = turno scoperto)"><select value={f.prof_id} onChange={(e) => setF({ ...f, prof_id: e.target.value })}><option value="">— scoperto —</option>{profs.map((p) => <option key={p.id} value={p.id}>{p.nome} · {p.profilo || p.tipo}</option>)}</select></Field>
        <Field label="Profilo richiesto (per i turni scoperti)"><input value={f.profilo} list="profili-turno" onChange={(e) => setF({ ...f, profilo: e.target.value })} /><datalist id="profili-turno">{['Medico', 'Infermiere', 'Tecnico di radiologia', 'Ostetrica', 'OSS'].map((p) => <option key={p} value={p} />)}</datalist></Field>
        <Field label="Attività"><input value={f.attivita} placeholder="es. Punto prelievi, supporto ambulatorio…" onChange={(e) => setF({ ...f, attivita: e.target.value })} /></Field>
        <Field label="Nota"><input value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} /></Field>
      </div>
      {!f.prof_id && sugg.length > 0 && <div className="alert info" style={{ marginTop: 10 }}>Disponibili per questa fascia: {sugg.map((c) => <button key={c.prof_id} className="btn sm ghost" style={{ marginRight: 6 }} onClick={() => setF({ ...f, prof_id: String(c.prof_id) })}>{c.nome} ({c.profilo}, {c.ora_da}–{c.ora_a})</button>)}</div>}
    </Modal>
  );
}

function GeneraModal({ mese, sedi, onClose, onDone, toast }) {
  const [f, setF] = useState({ sede_id: '', tipo: 'tutti', sovrascrivi: false }); const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { const r = await api.post('/personale/turni/genera', { mese, sede_id: f.sede_id || null, tipo: f.tipo, sovrascrivi: f.sovrascrivi }); toast(`Creati ${r.created} turni${r.skipped ? `, ${r.skipped} già presenti` : ''}${r.nonCensiti.length ? ` · non censiti come professionisti: ${r.nonCensiti.join(', ')}` : ''}`); onDone(); } catch (e) { toast(e.message, 'err'); } setBusy(false); };
  return (
    <Modal title={`Genera i turni di ${meseTxt(mese)} dalla pianificazione`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy} onClick={run}>{busy ? 'Genero…' : 'Genera'}</button></>}>
      <p>Applica la settimana-tipo di ogni sede (assegnazioni medico → ambulatorio e sanitario di supporto) ai giorni del mese, saltando le chiusure di sede. I turni già esistenti nella stessa fascia non vengono duplicati. Le persone non ancora censite come professionisti vengono segnalate: importale dalla pagina Professionisti e rigenera.</p>
      <div className="form-grid">
        <Field label="Sede"><select value={f.sede_id} onChange={(e) => setF({ ...f, sede_id: e.target.value })}><option value="">Tutte</option>{sedi.map((s) => <option key={s.id} value={s.id}>{sedeLabel(s)}</option>)}</select></Field>
        <Field label="Chi"><select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}><option value="tutti">Medici e sanitari</option><option value="sanitari">Solo personale sanitario</option><option value="medici">Solo medici</option></select></Field>
      </div>
      <label className="f inline" style={{ marginTop: 8 }}><input type="checkbox" checked={f.sovrascrivi} onChange={(e) => setF({ ...f, sovrascrivi: e.target.checked })} />Rigenera: elimina prima i turni generati in precedenza (non quelli con presenze confermate)</label>
    </Modal>
  );
}

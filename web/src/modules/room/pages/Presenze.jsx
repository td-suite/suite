import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Loading, ErrorBox, Badge, Field, useToast, Card } from '../components/ui.jsx';
import { itDateTime } from '../format.js';
import { itD, ore, oreTxt, DAYS, dow, thisMonth, addMonths, meseTxt } from '../lib/personale.js';

const today = () => new Date().toISOString().slice(0, 10);
const addD = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export default function Presenze() {
  const { user } = useAuth(); const toast = useToast();
  const gest = ['ADMIN', 'RESP_SAN'].includes(user.role);
  const sedi = useApi('/personale/presenze/sedi-gestite');
  const [sede, setSede] = useState(''); const [data, setData] = useState(today());
  useEffect(() => { if (sedi.data?.length && !sede) setSede(sedi.data[0].id); }, [sedi.data]);
  const [view, setView] = useState('giorno');
  return (
    <div className="page">
      <div className="page-head"><div><h1>Presenze</h1><div className="sub">Conferma giornaliera della presenza del personale sanitario e medico per sede (dalle ore, alle ore): è la base del calcolo dei compensi.</div></div>
        <div className="row">
          <select value={sede} onChange={(e) => setSede(e.target.value)} style={{ width: 'auto' }}>{(sedi.data || []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          <div className="seg">{[['giorno', 'Giornata'], ['mese', 'Riepilogo mese']].map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}</div>
        </div></div>
      {!sedi.data ? <Loading /> : !sedi.data.length ? <div className="card"><div className="bd empty">Nessuna sede da gestire. Il gestore di sede è l'utente la cui email è indicata come "Email del site manager" nell'Anagrafica della sede.</div></div>
        : view === 'giorno' ? <Giornata sede={sede} data={data} setData={setData} toast={toast} gest={gest} /> : <Riepilogo sede={sede} sedi={sedi.data} />}
    </div>
  );
}

function Giornata({ sede, data, setData, toast, gest }) {
  const { data: g, error, reload } = useApi(sede ? `/personale/presenze/giorno?sede_id=${sede}&data=${data}` : null, [sede, data]);
  const [rows, setRows] = useState([]); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!g) return;
    const r = g.presenze.map((p) => ({ id: p.id, prof_id: p.prof_id, nome: p.prof_nome, profilo: p.prof_profilo, ora_da: p.ora_da, ora_a: p.ora_a, stato: p.stato, origine: p.origine, turno_id: p.turno_id, attivita: p.attivita || '', nota: p.nota || '', locked: !!p.rendiconto_id, confermato: `${p.confermato_da_nome || ''} ${itDateTime(p.confermato_at)}`, sel: true }));
    const has = (pid, da) => r.some((x) => x.prof_id === pid && x.ora_da === da);
    for (const t of g.turni.filter((t) => t.prof_id)) if (!has(t.prof_id, t.ora_da)) r.push({ prof_id: t.prof_id, nome: t.prof_nome, profilo: t.prof_profilo, ora_da: t.ora_da, ora_a: t.ora_a, stato: 'CONFERMATA', origine: 'TURNO', turno_id: t.id, attivita: t.attivita || '', nota: '', sel: false, previsto: 'turno' });
    for (const p of g.pianificati.filter((p) => p.prof_id)) if (!has(p.prof_id, p.ora_da) && !r.some((x) => x.prof_id === p.prof_id && x.ora_da <= p.ora_da && x.ora_a >= p.ora_a)) r.push({ prof_id: p.prof_id, nome: p.nome, profilo: '', ora_da: p.ora_da, ora_a: p.ora_a, stato: 'CONFERMATA', origine: 'PIANIFICAZIONE', attivita: p.attivita || '', nota: '', sel: false, previsto: 'pianificazione' });
    setRows(r.sort((a, b) => a.ora_da.localeCompare(b.ora_da) || a.nome.localeCompare(b.nome)));
  }, [g]);
  const upd = (i, patch) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const salva = async () => {
    const items = rows.filter((x) => x.sel && !x.locked).map((x) => ({ id: x.id || null, prof_id: x.prof_id, ora_da: x.ora_da, ora_a: x.ora_a, stato: x.stato, turno_id: x.turno_id || null, origine: x.origine, attivita: x.attivita || null, nota: x.nota || null }));
    if (!items.length) { toast('Seleziona almeno una presenza', 'err'); return; }
    setBusy(true); try { await api.post('/personale/presenze/conferma', { sede_id: sede, data, items }); toast(`Presenze confermate: ${items.length}`); reload(); } catch (e) { toast(e.message, 'err'); } setBusy(false);
  };
  const rimuovi = async (x, i) => { if (x.id) { if (!window.confirm('Rimuovere la presenza registrata?')) return; try { await api.del(`/personale/presenze/${x.id}`); reload(); } catch (e) { toast(e.message, 'err'); } } else setRows((rs) => rs.filter((_, j) => j !== i)); };
  const [extra, setExtra] = useState('');
  const addExtra = () => { const p = g.professionisti.find((q) => String(q.id) === extra); if (!p) return; setRows((rs) => [...rs, { prof_id: p.id, nome: p.nome, profilo: p.profilo, ora_da: '08:00', ora_a: '14:00', stato: 'CONFERMATA', origine: 'EXTRA', attivita: '', nota: '', sel: true, previsto: 'extra' }]); setExtra(''); };
  const totOre = rows.filter((x) => x.sel && x.stato === 'CONFERMATA').reduce((a, x) => a + ore(x.ora_da, x.ora_a), 0);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn ghost sm" onClick={() => setData(addD(data, -1))}>‹</button><input type="date" value={data} onChange={(e) => setData(e.target.value)} style={{ width: 'auto' }} /><button className="btn ghost sm" onClick={() => setData(addD(data, 1))}>›</button>
        <b>{DAYS[dow(data)]} {itD(data)}</b>{data === today() && <Badge tone="teal">oggi</Badge>}
        <span className="spacer" /><span className="small muted">{rows.filter((x) => x.sel).length} selezionate · {oreTxt(totOre)}</span>
        <button className="btn" disabled={busy || !g} onClick={salva}>{busy ? 'Salvo…' : 'Conferma le presenze selezionate'}</button>
      </div>
      <ErrorBox error={error} />
      {!g ? <Loading /> : (
        <Card flush>
          <div className="table-wrap"><table className="t">
            <thead><tr><th /><th>Professionista</th><th>Previsto da</th><th>Dalle</th><th>Alle</th><th className="num">Ore</th><th>Esito</th><th>Attività</th><th>Nota</th><th>Registrata</th><th /></tr></thead>
            <tbody>{rows.map((x, i) => (
              <tr key={i} className={`pres-row ${x.stato === 'ASSENTE' ? 'assente' : ''}`}>
                <td><input type="checkbox" checked={x.sel} disabled={x.locked} onChange={(e) => upd(i, { sel: e.target.checked })} /></td>
                <td className="strong">{x.nome}<div className="small muted" style={{ fontWeight: 400 }}>{x.profilo}</div></td>
                <td className="small">{x.id ? <Badge tone="green">registrata</Badge> : x.previsto === 'turno' ? <Badge tone="teal">turno</Badge> : x.previsto === 'pianificazione' ? <Badge>pianificazione</Badge> : <Badge tone="mauve">extra</Badge>}</td>
                <td><input type="time" value={x.ora_da} disabled={x.locked} onChange={(e) => upd(i, { ora_da: e.target.value })} style={{ width: 110 }} /></td>
                <td><input type="time" value={x.ora_a} disabled={x.locked} onChange={(e) => upd(i, { ora_a: e.target.value })} style={{ width: 110 }} /></td>
                <td className="num mono">{oreTxt(ore(x.ora_da, x.ora_a))}</td>
                <td><select value={x.stato} disabled={x.locked} onChange={(e) => upd(i, { stato: e.target.value })} style={{ width: 'auto' }}><option value="CONFERMATA">Presente</option><option value="ASSENTE">Assente</option></select></td>
                <td><input value={x.attivita} disabled={x.locked} onChange={(e) => upd(i, { attivita: e.target.value })} style={{ width: 180 }} /></td>
                <td><input value={x.nota} disabled={x.locked} onChange={(e) => upd(i, { nota: e.target.value })} style={{ width: 160 }} /></td>
                <td className="small muted">{x.locked ? <Badge tone="amber">in rendiconto</Badge> : x.confermato}</td>
                <td className="num">{!x.locked && <button className="btn sm ghost" onClick={() => rimuovi(x, i)}>×</button>}</td>
              </tr>))}
            {!rows.length && <tr><td colSpan={11} className="empty">Nessun turno previsto in questa sede per il giorno: aggiungi una presenza non prevista qui sotto.</td></tr>}
            </tbody>
          </table></div>
          <div className="bd row" style={{ borderTop: '1px solid var(--line)' }}>
            <Field label="Aggiungi una presenza non prevista"><div className="row"><select value={extra} onChange={(e) => setExtra(e.target.value)} style={{ width: 320 }}><option value="">— professionista —</option>{g.professionisti.map((p) => <option key={p.id} value={p.id}>{p.nome} · {p.profilo || p.tipo}</option>)}</select><button className="btn sm ghost" disabled={!extra} onClick={addExtra}>Aggiungi</button></div></Field>
            <span className="spacer" /><span className="small muted">{gest ? 'Gestione: puoi confermare per tutte le sedi.' : 'Sei il gestore di questa sede: le presenze confermate alimentano i rendiconti mensili.'}</span>
          </div>
        </Card>)}
    </>
  );
}

function Riepilogo({ sede, sedi }) {
  const [mese, setMese] = useState(thisMonth());
  const dal = `${mese}-01`, al = `${mese}-31`;
  const { data, error } = useApi(sede ? `/personale/presenze?sede_id=${sede}&dal=${dal}&al=${al}` : null, [sede, mese]);
  const perProf = useMemo(() => { const m = {}; (data || []).filter((p) => p.stato === 'CONFERMATA').forEach((p) => { const x = (m[p.prof_id] ||= { nome: p.prof_nome, profilo: p.prof_profilo, n: 0, ore: 0 }); x.n++; x.ore += ore(p.ora_da, p.ora_a); }); return Object.values(m).sort((a, b) => b.ore - a.ore); }, [data]);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}><button className="btn ghost sm" onClick={() => setMese(addMonths(mese, -1))}>‹</button><b style={{ minWidth: 130, textAlign: 'center' }}>{meseTxt(mese)}</b><button className="btn ghost sm" onClick={() => setMese(addMonths(mese, 1))}>›</button><span className="small muted">{sedi.find((s) => s.id === sede)?.label}</span></div>
      <ErrorBox error={error} />
      {!data ? <Loading /> : (
        <div className="grid g2">
          <Card title="Ore confermate per professionista" flush><div className="table-wrap"><table className="t"><thead><tr><th>Professionista</th><th className="num">Presenze</th><th className="num">Ore</th></tr></thead><tbody>{perProf.map((x, i) => <tr key={i}><td className="strong">{x.nome}<div className="small muted" style={{ fontWeight: 400 }}>{x.profilo}</div></td><td className="num">{x.n}</td><td className="num">{oreTxt(x.ore)}</td></tr>)}{!perProf.length && <tr><td colSpan={3} className="empty">Nessuna presenza confermata nel mese</td></tr>}</tbody></table></div></Card>
          <Card title="Dettaglio" flush><div className="table-wrap" style={{ maxHeight: 520, overflow: 'auto' }}><table className="t"><thead><tr><th>Data</th><th>Professionista</th><th>Orario</th><th>Esito</th><th>Attività</th><th>Da</th></tr></thead><tbody>{data.map((p) => <tr key={p.id}><td>{itD(p.data)}</td><td className="strong">{p.prof_nome}</td><td className="mono">{p.ora_da}–{p.ora_a}</td><td>{p.stato === 'CONFERMATA' ? <Badge tone="green">presente</Badge> : <Badge tone="red">assente</Badge>}{p.rendiconto_id ? <Badge tone="amber">rendicontata</Badge> : null}</td><td className="small">{p.attivita}</td><td className="small muted">{p.confermato_da_nome}</td></tr>)}</tbody></table></div></Card>
        </div>)}
    </>
  );
}

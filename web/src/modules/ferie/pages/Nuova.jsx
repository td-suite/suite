// Nuova richiesta: periodo con mezze giornate, note, conteggio automatico dei giorni lavorativi (festivi italiani, patrono della sede,
// settimana del contratto), saldo dopo la richiesta, chiusure collettive proposte. HR può inserire per conto di un dipendente e
// registrare direttamente come approvata (anche per giorni passati).
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, base, useApi } from '../api.js';
import { useAuth, isHr } from '../auth.jsx';
import { Card, Field, PageHead, Empty, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { itData, num, oggiIso } from '../format.js';

export default function Nuova() {
  const { user } = useAuth();
  const hr = isHr(user);
  const nav = useNavigate();
  const toast = useToast();
  const [sp] = useSearchParams();
  const [f, setF] = useState({ tipo: 'FERIE', data_inizio: sp.get('da') || '', data_fine: sp.get('a') || '', mezza_inizio: false, mezza_fine: false, ore: '', note: '', chiusura_id: sp.get('chiusura') ? Number(sp.get('chiusura')) : null, person_id: '', approva_subito: false });
  const [calc, setCalc] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const me = useApi('/me');
  const cat = useApi(hr ? '/catalogo' : null);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const unGiorno = f.data_inizio && f.data_inizio === f.data_fine;
  const body = () => ({ ...f, person_id: f.person_id ? Number(f.person_id) : undefined, ore: f.tipo === 'ROL' ? Number(f.ore) || null : null, data_fine: f.tipo === 'ROL' ? f.data_inizio : f.data_fine, chiusura_id: f.chiusura_id || null });
  useEffect(() => {
    setErr(null); setCalc(null);
    if (!f.data_inizio || (f.tipo === 'FERIE' && !f.data_fine) || (f.tipo === 'ROL' && !f.ore)) return;
    if (!hr && !me.data?.persona) return;
    const t = setTimeout(() => api.post('/calcola', body(), { silent: true }).then(setCalc).catch((e) => setErr(e.message)), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.tipo, f.data_inizio, f.data_fine, f.mezza_inizio, f.mezza_fine, f.ore, f.person_id]);
  const invia = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const r = await api.post('/richieste', body()); toast?.(r.stato === 'RICHIESTA' ? 'Richiesta inviata all\'approvatore' : 'Ferie registrate'); window.dispatchEvent(new Event('suite:badges')); nav(`${base}/richieste/${r.id}`); }
    catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };
  if (me.data?.fuori_perimetro && !hr) return <div className="page"><PageHead title="Nuova richiesta" icon="plus" /><Card><Empty icon="info" title="Non puoi inserire richieste">{me.data.motivo}</Empty></Card></div>;
  const rol = me.data?.settings?.rol_attivi;
  const chiusure = me.data?.chiusure || [];
  return (
    <div className="page">
      <PageHead title="Nuova richiesta" icon="plus" sub="Scegli il periodo: i giorni lavorativi si contano da soli (festivi nazionali, santo patrono della sede e la tua settimana lavorativa)." />
      {me.data?.settings?.avviso_dipendenti && <div className="alert info"><Icon name="info" /><span>{me.data.settings.avviso_dipendenti}</span></div>}
      <div className="fe-two">
        <Card>
          <form className="fe-form" onSubmit={invia}>
            {hr && (
              <div className="fe-hr">
                <Field label="Per conto di (HR)" help="Vuoto = per te stesso"><select value={f.person_id} onChange={(e) => set('person_id', e.target.value)}><option value="">Me stesso</option>{(cat.data?.persone || []).map((p) => <option key={p.id} value={p.id}>{p.nome} · {p.gruppo_nome}</option>)}</select></Field>
                <label className="fe-check"><input type="checkbox" checked={f.approva_subito} onChange={(e) => set('approva_subito', e.target.checked)} /> Registra già approvata (anche giorni passati)</label>
              </div>
            )}
            {rol && <Field label="Tipo"><select value={f.tipo} onChange={(e) => set('tipo', e.target.value)}><option value="FERIE">Ferie (giorni)</option><option value="ROL">ROL o permesso (ore)</option></select></Field>}
            <div className="two">
              <Field label={f.tipo === 'ROL' ? 'Giorno' : 'Dal'} required><input type="date" value={f.data_inizio} min={hr ? undefined : oggiIso()} onChange={(e) => { set('data_inizio', e.target.value); if (!f.data_fine || f.data_fine < e.target.value) set('data_fine', e.target.value); }} required /></Field>
              {f.tipo === 'FERIE' ? <Field label="Al" required><input type="date" value={f.data_fine} min={f.data_inizio || undefined} onChange={(e) => set('data_fine', e.target.value)} required /></Field>
                : <Field label="Ore" required><input type="number" min="0.5" max="24" step="0.5" value={f.ore} onChange={(e) => set('ore', e.target.value)} required /></Field>}
            </div>
            {f.tipo === 'FERIE' && (
              <div className="fe-mezze">
                <label className="fe-check"><input type="checkbox" checked={f.mezza_inizio} disabled={unGiorno && f.mezza_fine} onChange={(e) => set('mezza_inizio', e.target.checked)} /> {unGiorno ? 'Solo il pomeriggio' : 'Il primo giorno solo il pomeriggio'}</label>
                <label className="fe-check"><input type="checkbox" checked={f.mezza_fine} disabled={unGiorno && f.mezza_inizio} onChange={(e) => set('mezza_fine', e.target.checked)} /> {unGiorno ? 'Solo la mattina' : 'L\'ultimo giorno solo la mattina'}</label>
              </div>
            )}
            <Field label="Note per l'approvatore"><textarea rows={3} maxLength={1000} value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="Facoltative" /></Field>
            {err && <div className="alert err"><Icon name="alert" /><span>{err}</span></div>}
            <div className="row"><button className="btn primary" disabled={busy || !calc || Boolean(err)} type="submit"><Icon name="send" />{f.approva_subito ? 'Registra' : 'Invia la richiesta'}</button><button type="button" className="btn ghost" onClick={() => nav(base)}>Annulla</button></div>
          </form>
        </Card>
        <div className="grid">
          <Card title="Conteggio" icon="calendar">
            {!calc ? <div className="small muted">Scegli le date per vedere i giorni lavorativi e il saldo dopo la richiesta.</div> : (
              <div className="fe-calc">
                <div className="big">{f.tipo === 'ROL' ? `${num(calc.ore)} ore` : `${num(calc.giorni)} ${calc.giorni === 1 ? 'giorno' : 'giorni'} lavorativi`}</div>
                {f.tipo === 'FERIE' && <div className="small">Disponibili ora {num(calc.disponibile)} · dopo la richiesta <b className={calc.saldo_dopo < 0 ? 'fe-neg' : ''}>{num(calc.saldo_dopo)}</b></div>}
                <div className="small muted">Settimana: {calc.settimana}</div>
                {calc.festivi?.length > 0 && <div className="small">Festivi nel periodo (non contati): {calc.festivi.map((x) => `${itData(x.data)} ${x.festivo}`).join(', ')}</div>}
                {calc.avvisi?.map((a, i) => <div key={i} className="alert warn"><Icon name="alert" /><span>{a}</span></div>)}
                {calc.conflitti?.length > 0 && <div className="alert err"><Icon name="alert" /><span>Si sovrappone a una richiesta già presente</span></div>}
                {f.tipo === 'FERIE' && calc.dettaglio?.length > 0 && <details className="small"><summary>Giorno per giorno</summary><ul className="fe-fest">{calc.dettaglio.map((d) => <li key={d.data}>{itData(d.data)} · {d.festivo ? `festivo (${d.festivo})` : d.quota === 1 ? 'giornata intera' : 'mezza giornata'}</li>)}</ul></details>}
              </div>
            )}
          </Card>
          {chiusure.length > 0 && (
            <Card title="Chiusure collettive proposte" icon="building">
              <ul className="fe-list">{chiusure.map((c) => (
                <li key={c.id}><div><div className="strong">{itData(c.data_inizio)} → {itData(c.data_fine)}</div><div className="small muted">{c.descrizione || 'Chiusura collettiva'}</div></div>
                  <button type="button" className="btn sm ghost" disabled={c.gia_richiesta} onClick={() => setF((x) => ({ ...x, tipo: 'FERIE', data_inizio: c.data_inizio, data_fine: c.data_fine, mezza_inizio: false, mezza_fine: false, chiusura_id: c.id }))}>{c.gia_richiesta ? 'Già richiesta' : 'Usa queste date'}</button></li>))}</ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

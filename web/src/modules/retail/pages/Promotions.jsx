import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, canWrite } from '../auth.jsx';
import { useApi, Card, Loading, ErrorBox, Field, Badge, ToneBadge, Modal, useToast, Kpi, Icon, Progress } from '../components/ui.jsx';
import { api, base, apiBase } from '../api.js';
import { eur0, num, MONTHS, PROMO_STATUS, DISCOUNT } from '../format.js';

export default function Promotions() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const list = useApi(`/promotions?year=${year}`, [year]);
  const [create, setCreate] = useState(null);
  const rows = list.data || [];
  const byMonth = Object.fromEntries(rows.map((p) => [p.month, p]));
  const tot = rows.reduce((a, p) => ({ revenue: a.revenue + Number(p.revenue || 0), tickets: a.tickets + Number(p.tickets || 0), customers: a.customers + Number(p.new_customers || 0), target: a.target + Number(p.kpi_target?.revenue || 0) }), { revenue: 0, tickets: 0, customers: 0, target: 0 });
  const save = async () => {
    try { const r = await api.post('/promotions', { ...create, year, month: Number(create.month), discount_value: create.discount_value === '' || create.discount_value == null ? null : Number(create.discount_value) }); toast('Promozione creata'); setCreate(null); nav(`${base}/promozioni/${r.id}`); } catch (e) { toast(e.message, 'err'); }
  };
  const clone = async () => { try { const r = await api.post('/promotions/clone-year', { from: year - 1, to: year }); toast(`${r.created} promozioni copiate come bozze dal ${year - 1}`); list.reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Calendario promozionale {year}</h1><div className="sub">Una promozione al mese su scala annuale: tema, claim, meccanica, prestazioni, sedi, piano di spinta per canale e materiali. I risultati arrivano dalle vendite con il codice promo.</div></div>
        <div className="row">
          <div className="period"><button onClick={() => setYear(year - 1)}>‹ {year - 1}</button><button className="on">{year}</button><button onClick={() => setYear(year + 1)}>{year + 1} ›</button></div>
          <a className="btn ghost" href={`${apiBase}/promotions/calendar.pptx?year=${year}`}><Icon name="download" />Calendario PPTX</a>
          {canWrite(user) && !rows.length && <button className="btn ghost" onClick={clone}>Copia dal {year - 1}</button>}
          {canWrite(user) && <button className="btn" onClick={() => setCreate({ month: String(now.getMonth() + 1), channel_scope: 'B2C', discount_type: 'PREZZO_FISSO' })}>+ Nuova promozione</button>}
        </div>
      </div>
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi accent label="Fatturato da promozioni" value={eur0(tot.revenue)} foot={tot.target ? `obiettivo annuo ${eur0(tot.target)} · ${Math.round((tot.revenue / tot.target) * 100)}%` : `${rows.length} promozioni pianificate`} />
        <Kpi label="Prenotazioni con codice promo" value={num(tot.tickets)} foot="accettazioni collegate" />
        <Kpi label="Nuovi pazienti da promo" value={num(tot.customers)} foot="prima visita durante la promozione" />
        <Kpi label="Mesi coperti" value={`${Object.keys(byMonth).length}/12`} foot={`${rows.filter((p) => p.status === 'BOZZA').length} in bozza · ${rows.filter((p) => p.status === 'APPROVATA').length} approvate`} />
      </div>
      <ErrorBox error={list.error} />
      {!list.data ? <Loading /> : (
        <div className="calendar">
          {MONTHS.map((m, i) => {
            const p = byMonth[i + 1];
            const isNow = year === now.getFullYear() && i === now.getMonth();
            const past = new Date(year, i + 1, 0) < now;
            if (!p) return <div key={m} className={`card month empty-month ${isNow ? 'now' : ''}`} onClick={() => canWrite(user) && setCreate({ month: String(i + 1), channel_scope: 'B2C', discount_type: 'PREZZO_FISSO' })}><div><div className="mname" style={{ justifyContent: 'center' }}>{m}</div><div className="small" style={{ marginTop: 8 }}>{canWrite(user) ? '+ pianifica' : 'da pianificare'}</div></div></div>;
            const target = p.kpi_target?.revenue;
            return (
              <div key={m} className={`card month ${isNow ? 'now' : ''} ${past ? 'past' : ''}`} onClick={() => nav(`${base}/promozioni/${p.id}`)}>
                <div className="mname"><span>{m}</span><ToneBadge map={PROMO_STATUS} value={p.status} /></div>
                <div className="pname">{p.name}</div>
                <div className="claim">{p.claim ? `“${p.claim}”` : <span className="muted">claim da definire</span>}</div>
                <div className="small muted" style={{ marginTop: 4 }}>{p.discount_label}{p.target ? ` · ${p.target}` : ''}</div>
                <div className="meta">
                  {p.revenue > 0 || target ? <div style={{ width: '100%' }}><div className="row" style={{ justifyContent: 'space-between' }}><span>{eur0(p.revenue)}{target ? ` / ${eur0(target)}` : ''}</span><span>{num(p.tickets)} pren.</span></div>{target ? <Progress value={p.revenue} max={target} /> : null}</div> : null}
                  <span title="piano di spinta">{p.plan_done}/{p.plan_total} azioni</span><span>·</span><span title="materiali">{p.materials_done}/{p.materials_total} materiali</span>{p.exposure_total ? <><span>·</span><span title="esposizione in sede">{p.exposure_ok}/{p.exposure_total} esposti</span></> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {create && <Modal title={`Nuova promozione · ${MONTHS[Number(create.month) - 1]} ${year}`} onClose={() => setCreate(null)} footer={<><button className="btn ghost" onClick={() => setCreate(null)}>Annulla</button><button className="btn" disabled={!create.name} onClick={save}>Crea</button></>}>
        <div className="form-grid">
          <Field label="Mese"><select value={create.month} onChange={(e) => setCreate({ ...create, month: e.target.value })}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Field>
          <Field label="Nome *"><input value={create.name || ''} placeholder="es. Ottobre rosa" onChange={(e) => setCreate({ ...create, name: e.target.value })} /></Field>
          <Field label="Tema" className="span2"><input value={create.theme || ''} placeholder="es. prevenzione senologica" onChange={(e) => setCreate({ ...create, theme: e.target.value })} /></Field>
          <Field label="Meccanica"><select value={create.discount_type} onChange={(e) => setCreate({ ...create, discount_type: e.target.value })}>{Object.entries(DISCOUNT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Valore (% o €)"><input type="number" step="0.5" value={create.discount_value ?? ''} onChange={(e) => setCreate({ ...create, discount_value: e.target.value })} /></Field>
          <Field label="Target"><input value={create.target || ''} placeholder="es. donne 40-69" onChange={(e) => setCreate({ ...create, target: e.target.value })} /></Field>
          <Field label="Canale"><select value={create.channel_scope} onChange={(e) => setCreate({ ...create, channel_scope: e.target.value })}><option value="B2C">B2C</option><option value="B2B">B2B</option><option value="ENTRAMBI">Entrambi</option></select></Field>
        </div>
        <p className="small muted">Claim, prestazioni, sedi, piano di spinta e materiali si completano nella scheda della promozione. Il piano di spinta standard e la checklist dei materiali vengono precompilati.</p>
      </Modal>}
    </div>
  );
}

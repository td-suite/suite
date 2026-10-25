import React, { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Loading, ErrorBox, Badge, useToast, Card, Kpi } from '../components/ui.jsx';
import { meseTxt, thisMonth, addMonths, itD, oreTxt, DAYS } from '../lib/personale.js';

export default function Fabbisogno() {
  const { user } = useAuth(); const toast = useToast();
  const gest = ['ADMIN', 'RESP_SAN'].includes(user.role);
  const [mese, setMese] = useState(thisMonth());
  const { data, error, reload } = useApi(`/personale/fabbisogno?mese=${mese}`, [mese]);
  const assegna = async (t, c) => { if (!window.confirm(`Assegnare il turno ${itD(t.data)} ${t.ora_da}–${t.ora_a} (${t.sede}) a ${c.nome}?`)) return; try { await api.put(`/personale/turni/${t.turnoId}`, { sede_id: t.sedeId, data: t.data, ora_da: t.ora_da, ora_a: t.ora_a, prof_id: c.prof_id, profilo: t.profilo || null, attivita: t.attivita || null }); toast('Turno assegnato'); reload(); } catch (e) { toast(e.message, 'err'); } };
  const pubblica = async (t) => { try { await api.post('/personale/posizioni', { titolo: `${t.profilo || 'Professionista'} · ${t.sede} · ${itD(t.data)} ${t.ora_da}–${t.ora_a}`, sede_id: t.sedeId, profilo: t.profilo || null, dal: t.data, al: t.data, ora_da: t.ora_da, ora_a: t.ora_a, descrizione: t.attivita || '', turno_id: t.turnoId }); toast('Pubblicato in bacheca'); } catch (e) { toast(e.message, 'err'); } };
  const oreScop = (data?.turniScoperti || []).reduce((a, t) => a + t.ore, 0);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Fabbisogno</h1><div className="sub">Attività da coprire (turni scoperti e sessioni della pianificazione senza supporto sanitario) confrontate con le disponibilità offerte dai professionisti.</div></div>
        <div className="row"><button className="btn ghost sm" onClick={() => setMese(addMonths(mese, -1))}>‹</button><b style={{ minWidth: 130, textAlign: 'center' }}>{meseTxt(mese)}</b><button className="btn ghost sm" onClick={() => setMese(addMonths(mese, 1))}>›</button></div></div>
      <ErrorBox error={error} />
      {!data ? <Loading /> : (<>
        <div className="grid g4" style={{ marginBottom: 14 }}>
          <Kpi label="Turni scoperti" value={data.turniScoperti.length} accent={data.turniScoperti.length > 0} foot={`${oreTxt(oreScop)} da coprire`} />
          <Kpi label="Con candidati disponibili" value={data.turniScoperti.filter((t) => t.candidati.length).length} foot="dalle disponibilità offerte" />
          <Kpi label="Sessioni senza sanitario" value={data.pianificazione.length} foot="nella settimana-tipo delle sedi" />
          <Kpi label="Offerta settimanale" value={oreTxt(data.offerta.reduce((a, o) => a + o.oreSettimana, 0))} foot={data.offerta.map((o) => `${o.profilo}: ${o.professionisti}`).join(' · ') || 'nessuna disponibilità inserita'} />
        </div>
        <div className="grid g2" style={{ marginBottom: 14 }}>
          <Card title="Fabbisogno per profilo (turni scoperti del mese)" flush><div className="table-wrap"><table className="t"><thead><tr><th>Profilo</th><th className="num">Turni</th><th className="num">Ore</th><th className="num">Con candidati</th></tr></thead><tbody>{data.perProfilo.map((p) => <tr key={p.profilo}><td className="strong">{p.profilo}</td><td className="num">{p.turni}</td><td className="num">{oreTxt(p.ore)}</td><td className="num">{p.conCandidati}</td></tr>)}{!data.perProfilo.length && <tr><td colSpan={4} className="empty">Nessun turno scoperto</td></tr>}</tbody></table></div></Card>
          <Card title="Offerta di disponibilità ricorrenti per profilo" flush><div className="table-wrap"><table className="t"><thead><tr><th>Profilo</th><th className="num">Professionisti</th><th className="num">Ore/settimana offerte</th></tr></thead><tbody>{data.offerta.map((o) => <tr key={o.profilo}><td className="strong">{o.profilo}</td><td className="num">{o.professionisti}</td><td className="num">{oreTxt(o.oreSettimana)}</td></tr>)}{!data.offerta.length && <tr><td colSpan={3} className="empty">Nessuna disponibilità ricorrente inserita dai professionisti</td></tr>}</tbody></table></div></Card>
        </div>
        <Card title="Turni scoperti e candidati disponibili" flush>
          <div className="table-wrap"><table className="t"><thead><tr><th>Data</th><th>Sede</th><th>Orario</th><th>Profilo</th><th>Attività</th><th>Disponibili nella fascia</th>{gest && <th />}</tr></thead>
            <tbody>{data.turniScoperti.map((t) => <tr key={t.turnoId}><td>{DAYS[(new Date(t.data + 'T12:00:00Z').getUTCDay() + 6) % 7].slice(0, 3)} {itD(t.data)}</td><td className="strong">{t.sede}</td><td className="mono">{t.ora_da}–{t.ora_a}</td><td>{t.profilo || '—'}</td><td className="small">{t.attivita}</td>
              <td>{t.candidati.length ? t.candidati.map((c) => <span key={c.prof_id} className="chip" style={{ cursor: gest ? 'pointer' : 'default' }} title={`disponibile ${c.ora_da}–${c.ora_a}`} onClick={() => gest && assegna(t, c)}>{c.nome} ({c.profilo})</span>) : <span className="muted small">nessuno</span>}</td>
              {gest && <td className="num"><button className="btn sm ghost" onClick={() => pubblica(t)}>In bacheca</button></td>}</tr>)}
              {!data.turniScoperti.length && <tr><td colSpan={7} className="empty">Nessun turno scoperto in {meseTxt(mese)}: crea turni scoperti dalla pagina Turni (professionista vuoto) per far emergere il fabbisogno.</td></tr>}</tbody></table></div>
        </Card>
        {data.pianificazione.length > 0 && <Card title="Sessioni della pianificazione senza supporto sanitario (settimana-tipo)" flush className="mt">
          <div className="table-wrap"><table className="t"><thead><tr><th>Sede</th><th>Giorno</th><th>Orario</th><th>Medico</th><th>Motivo</th></tr></thead><tbody>{data.pianificazione.map((p, i) => <tr key={i}><td className="strong">{p.sede}</td><td>{DAYS[p.giorno]}</td><td className="mono">{p.ora_da}–{p.ora_a}</td><td>{p.medico}</td><td className="small">{p.motivo}</td></tr>)}</tbody></table></div>
          <div className="bd small muted" style={{ borderTop: '1px solid var(--line)' }}>Queste sessioni mediche richiedono un sanitario di supporto che la sede non ha nella settimana-tipo: sono fabbisogno strutturale, da coprire con nuove disponibilità o personale aggiuntivo.</div>
        </Card>}
      </>)}
    </div>
  );
}

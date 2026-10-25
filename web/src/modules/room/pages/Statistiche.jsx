import React, { useState } from 'react';
import { useApi, Loading, ErrorBox, Card, Kpi } from '../components/ui.jsx';
import * as XLSX from 'xlsx';
import { mkDoc, table, section } from '../lib/exports.js';
import { oreTxt, eur, meseTxt } from '../lib/personale.js';

const y = new Date().getFullYear();
export default function Statistiche() {
  const [dal, setDal] = useState(`${y}-01-01`); const [al, setAl] = useState(new Date().toISOString().slice(0, 10));
  const { data, error } = useApi(`/personale/statistiche?dal=${dal}&al=${al}`, [dal, al]);
  const Bar = ({ v, max }) => <div className="stat-bar"><div style={{ width: `${max ? Math.min(100, v / max * 100) : 0}%` }} /></div>;
  const xlsx = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.perSede.map((s) => ({ Sede: s.sede, Ore: s.ore, Costo: s.costo, Presenze: s.presenze, Professionisti: s.professionisti }))), 'Per sede');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.perProf.map((p) => ({ Professionista: p.nome, Profilo: p.profilo, Ore: p.ore, Costo: p.costo, Presenze: p.presenze, Sedi: p.sedi }))), 'Per professionista');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.perProfilo.map((p) => ({ Profilo: p.profilo, Ore: p.ore, Costo: p.costo, Professionisti: p.professionisti }))), 'Per profilo');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.perMese.map((m) => ({ Mese: m.mese, 'Ore presenze': m.ore, 'Ore turni': m.oreTurni, 'Turni scoperti': m.turniScoperti, Costo: m.costo }))), 'Per mese');
    XLSX.writeFile(wb, `Statistiche_personale_${dal}_${al}.xlsx`);
  };
  const pdf = () => {
    const doc = mkDoc('Statistiche personale sanitario', `dal ${dal} al ${al}`); let yy = 28;
    yy = section(doc, 'Totali', yy); yy = table(doc, ['Ore presenze', 'Ore turni', 'Copertura', 'Turni scoperti', 'Costo orario', 'Fissi mensili', 'Professionisti attivi'], [[oreTxt(data.totali.orePresenze), oreTxt(data.totali.oreTurni), data.totali.copertura != null ? data.totali.copertura + '%' : '—', String(data.totali.turniScoperti), eur(data.totali.costo), eur(data.totali.fissiMensili), String(data.totali.professionisti)]], yy) + 8;
    yy = section(doc, 'Per sede', yy); yy = table(doc, ['Sede', 'Ore', 'Costo', 'Presenze', 'Professionisti'], data.perSede.map((s) => [s.sede, oreTxt(s.ore), eur(s.costo), String(s.presenze), String(s.professionisti)]), yy) + 8;
    yy = section(doc, 'Per profilo', yy); yy = table(doc, ['Profilo', 'Ore', 'Costo', 'Professionisti'], data.perProfilo.map((s) => [s.profilo, oreTxt(s.ore), eur(s.costo), String(s.professionisti)]), yy) + 8;
    yy = section(doc, 'Per professionista', yy); yy = table(doc, ['Professionista', 'Profilo', 'Ore', 'Costo', 'Presenze', 'Sedi'], data.perProf.map((p) => [p.nome, p.profilo || '', oreTxt(p.ore), eur(p.costo), String(p.presenze), String(p.sedi)]), yy) + 8;
    yy = section(doc, 'Per mese', yy); table(doc, ['Mese', 'Ore presenze', 'Ore turni', 'Turni scoperti', 'Costo'], data.perMese.map((m) => [meseTxt(m.mese), oreTxt(m.ore), oreTxt(m.oreTurni), String(m.turniScoperti), eur(m.costo)]), yy);
    doc.save(`Statistiche_personale_${dal}_${al}.pdf`);
  };
  return (
    <div className="page">
      <div className="page-head"><div><h1>Statistiche e report</h1><div className="sub">Utilizzo delle risorse: ore pianificate e confermate, copertura dei turni, costo per sede, profilo e professionista, andamento mensile.</div></div>
        <div className="row"><input type="date" value={dal} onChange={(e) => setDal(e.target.value)} style={{ width: 'auto' }} /><span>→</span><input type="date" value={al} onChange={(e) => setAl(e.target.value)} style={{ width: 'auto' }} />{data && <><button className="btn ghost sm" onClick={pdf}>PDF</button><button className="btn ghost sm" onClick={xlsx}>Excel</button></>}</div></div>
      <ErrorBox error={error} />
      {!data ? <Loading /> : (<>
        <div className="grid g4" style={{ marginBottom: 14 }}>
          <Kpi label="Ore confermate" value={oreTxt(data.totali.orePresenze)} foot={`su ${oreTxt(data.totali.oreTurni)} pianificate a turni`} bar={data.totali.copertura ?? 0} />
          <Kpi label="Copertura turni" value={data.totali.copertura != null ? `${data.totali.copertura}%` : '—'} foot={`${data.totali.turniScoperti} turni scoperti su ${data.totali.turni}`} accent={data.totali.turniScoperti > 0} />
          <Kpi label="Costo del personale a ore" value={eur(data.totali.costo)} foot={`+ fissi mensili ${eur(data.totali.fissiMensili)} (dai rendiconti)`} />
          <Kpi label="Professionisti attivi" value={data.totali.professionisti} foot={`offerta disponibilità ${oreTxt(data.totali.disponibilitaOreSett)}/settimana`} />
        </div>
        <div className="grid g2">
          <Card title="Per sede" flush><div className="table-wrap"><table className="t"><thead><tr><th>Sede</th><th className="num">Ore</th><th style={{ width: 120 }} /><th className="num">Costo</th><th className="num">Prof.</th></tr></thead><tbody>{data.perSede.map((s) => <tr key={s.sedeId}><td className="strong">{s.sede}</td><td className="num">{oreTxt(s.ore)}</td><td><Bar v={s.ore} max={data.perSede[0]?.ore} /></td><td className="num">{eur(s.costo)}</td><td className="num">{s.professionisti}</td></tr>)}{!data.perSede.length && <tr><td colSpan={5} className="empty">Nessuna presenza confermata nel periodo</td></tr>}</tbody></table></div></Card>
          <Card title="Per profilo professionale" flush><div className="table-wrap"><table className="t"><thead><tr><th>Profilo</th><th className="num">Ore</th><th style={{ width: 120 }} /><th className="num">Costo</th><th className="num">Prof.</th></tr></thead><tbody>{data.perProfilo.map((s) => <tr key={s.profilo}><td className="strong">{s.profilo}</td><td className="num">{oreTxt(s.ore)}</td><td><Bar v={s.ore} max={data.perProfilo[0]?.ore} /></td><td className="num">{eur(s.costo)}</td><td className="num">{s.professionisti}</td></tr>)}</tbody></table></div></Card>
          <Card title="Per professionista" flush><div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}><table className="t"><thead><tr><th>Professionista</th><th>Profilo</th><th className="num">Ore</th><th className="num">Costo</th><th className="num">Presenze</th><th className="num">Sedi</th></tr></thead><tbody>{data.perProf.map((p) => <tr key={p.prof_id}><td className="strong">{p.nome}</td><td className="small">{p.profilo}</td><td className="num">{oreTxt(p.ore)}</td><td className="num">{eur(p.costo)}</td><td className="num">{p.presenze}</td><td className="num">{p.sedi}</td></tr>)}</tbody></table></div></Card>
          <Card title="Andamento mensile" flush><div className="table-wrap"><table className="t"><thead><tr><th>Mese</th><th className="num">Ore presenze</th><th className="num">Ore turni</th><th className="num">Copertura</th><th className="num">Scoperti</th><th className="num">Costo</th></tr></thead><tbody>{data.perMese.map((m) => <tr key={m.mese}><td className="strong">{meseTxt(m.mese)}</td><td className="num">{oreTxt(m.ore)}</td><td className="num">{oreTxt(m.oreTurni)}</td><td className="num">{m.oreTurni ? Math.round(m.ore / m.oreTurni * 100) + '%' : '—'}</td><td className="num">{m.turniScoperti}</td><td className="num">{eur(m.costo)}</td></tr>)}</tbody></table></div></Card>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>Lettura: una copertura bassa con molti turni scoperti indica fabbisogno di personale; ore confermate molto sotto le ore a turno indicano turni non effettuati o presenze non registrate dai gestori; un'offerta di disponibilità alta e poco usata suggerisce margine per riorganizzare senza assumere.</p>
      </>)}
    </div>
  );
}

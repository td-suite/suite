import React, { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Loading, ErrorBox, Badge, Field, useToast, Card, Kpi } from '../components/ui.jsx';
import { itDateTime } from '../format.js';
import { DisponibilitaProf } from './Professionisti.jsx';
import { RendicontoModal } from './Rendiconti.jsx';
import { meseTxt, thisMonth, addMonths, itD, ore, oreTxt, eur, STATO_REND, DAYS, dow, pdfTurni } from '../lib/personale.js';

export function PortaleHome() {
  const { user } = useAuth(); const toast = useToast();
  const { data: me, error, reload } = useApi('/portale/me');
  const [f, setF] = useState(null);
  const mese = thisMonth();
  const turni = useApi(`/portale/turni?mese=${mese}`); const pres = useApi(`/portale/presenze?mese=${addMonths(mese, -1)}`); const rend = useApi('/portale/rendiconti'); const pos = useApi('/portale/posizioni');
  const save = async () => { try { await api.put('/portale/me', f); toast('Dati aggiornati'); setF(null); reload(); } catch (e) { toast(e.message, 'err'); } };
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!me) return <Loading />;
  const prossimi = (turni.data?.turni || []).filter((t) => t.data >= new Date().toISOString().slice(0, 10)).slice(0, 5);
  return (
    <div className="page">
      <div className="portale-hero"><h1>Ciao, {me.nome}</h1><div>{me.profilo}{me.professionale?.discipline?.length ? ' · ' + me.professionale.discipline.join(', ') : ''} · portale del personale sanitario di Toscana Diagnostica</div></div>
      <div className="grid g4 mt">
        <Kpi label={`Turni di ${meseTxt(mese)}`} value={turni.data?.confermato ? turni.data.turni.length : '—'} foot={turni.data?.confermato ? oreTxt(turni.data.turni.reduce((a, t) => a + ore(t.ora_da, t.ora_a), 0)) : 'mese non ancora confermato'} />
        <Kpi label={`Presenze ${meseTxt(addMonths(mese, -1))}`} value={pres.data ? oreTxt(pres.data.filter((p) => p.stato === 'CONFERMATA').reduce((a, p) => a + ore(p.ora_da, p.ora_a), 0)) : '—'} foot={`${pres.data?.length || 0} registrate dalle sedi`} />
        <Kpi label="Rendiconti disponibili" value={rend.data?.length || 0} foot={rend.data?.[0] ? `ultimo: ${meseTxt(rend.data[0].mese)} · ${eur(rend.data[0].importo)}` : 'nessuno'} />
        <Kpi label="Posizioni aperte" value={(pos.data || []).filter((p) => p.stato === 'APERTA').length} foot="in bacheca" accent={(pos.data || []).some((p) => p.stato === 'APERTA' && !p.mia_candidatura)} />
      </div>
      <div className="grid g2 mt">
        <Card title="Prossimi turni" flush>{!turni.data ? <Loading /> : !turni.data.confermato ? <div className="empty">I turni di {meseTxt(mese)} non sono ancora stati confermati dalla struttura.</div> : !prossimi.length ? <div className="empty">Nessun turno in programma nel mese</div> : <div className="table-wrap"><table className="t"><tbody>{prossimi.map((t) => <tr key={t.id}><td className="strong">{DAYS[dow(t.data)].slice(0, 3)} {itD(t.data)}</td><td className="mono">{t.ora_da}–{t.ora_a}</td><td>{t.sede}</td><td className="small muted">{t.attivita}</td></tr>)}</tbody></table></div>}</Card>
        <Card title="I miei dati" actions={f ? <><button className="btn sm ghost" onClick={() => setF(null)}>Annulla</button><button className="btn sm" onClick={save}>Salva</button></> : <button className="btn sm ghost" onClick={() => setF(Object.fromEntries(me.selfFields.map((k) => [k, me.anagrafica[k] || ''])))}>Modifica contatti</button>}>
          <div className="small"><b>Email di accesso:</b> {me.email} · <b>Compenso:</b> {me.compenso.tipo === 'FISSO' ? `fisso mensile ${eur(me.compenso.fissoMensile)}` : `${me.compenso.tariffaOraria ? eur(me.compenso.tariffaOraria) + '/h' : 'tariffa oraria da definire'}${me.compenso.eccezioniSede.length ? ' (' + me.compenso.eccezioniSede.map((e) => `${e.sede}: ${eur(e.tariffaOraria)}/h`).join(', ') + ')' : ''}`}{me.sediAbilitate.length ? <> · <b>Sedi:</b> {me.sediAbilitate.map((s) => s.label).join(', ')}</> : null}</div>
          {f ? <div className="form-grid mt">{me.selfFields.map((k) => <Field key={k} label={{ telefono: 'Telefono', cellulare: 'Cellulare', indirizzo: 'Indirizzo', cap: 'CAP', citta: 'Città', provincia: 'Provincia', pec: 'PEC', iban: 'IBAN', intestatarioConto: 'Intestatario del conto' }[k] || k}><input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}</div>
            : <div className="small muted mt">{[me.anagrafica.cellulare || me.anagrafica.telefono, me.anagrafica.indirizzo && `${me.anagrafica.indirizzo} ${me.anagrafica.cap || ''} ${me.anagrafica.citta || ''}`, me.anagrafica.pec && `PEC ${me.anagrafica.pec}`, me.anagrafica.iban && `IBAN ${me.anagrafica.iban}`].filter(Boolean).join(' · ') || 'Contatti non ancora inseriti: usa "Modifica contatti".'}{me.assicurazione?.scadenza && <div>Polizza RC in scadenza il {itD(me.assicurazione.scadenza)}</div>}{me.docs?.length ? <div>{me.docs.length} documenti in archivio presso la struttura</div> : null}</div>}
          <p className="small muted" style={{ marginTop: 8 }}>Per variazioni di dati fiscali, contratto o compenso contatta il Responsabile del personale sanitario.</p>
        </Card>
      </div>
    </div>
  );
}

export function PortaleDisponibilita() {
  const toast = useToast(); const sedi = useApi('/portale/sedi');
  return <div className="page"><div className="page-head"><div><h1>Le mie disponibilità</h1><div className="sub">Giorni, orari e sedi in cui sei disponibile oltre ai turni già programmati: la struttura le usa per proporti nuove attività.</div></div></div>{!sedi.data ? <Loading /> : <DisponibilitaProf portale sedi={sedi.data} toast={toast} />}</div>;
}

export function PortaleTurni() {
  const [mese, setMese] = useState(thisMonth());
  const turni = useApi(`/portale/turni?mese=${mese}`, [mese]); const pres = useApi(`/portale/presenze?mese=${mese}`, [mese]);
  const { user } = useAuth();
  return (
    <div className="page">
      <div className="page-head"><div><h1>Turni e presenze</h1><div className="sub">I turni confermati dalla struttura e le presenze registrate dai gestori di sede (base del rendiconto).</div></div>
        <div className="row"><button className="btn ghost sm" onClick={() => setMese(addMonths(mese, -1))}>‹</button><b style={{ minWidth: 130, textAlign: 'center' }}>{meseTxt(mese)}</b><button className="btn ghost sm" onClick={() => setMese(addMonths(mese, 1))}>›</button>{turni.data?.turni?.length > 0 && <button className="btn ghost sm" onClick={() => { const { doc, filename } = pdfTurni(mese, turni.data.turni.map((t) => ({ ...t, nome: user.full_name })), user.full_name); doc.save(filename); }}>PDF turni</button>}</div></div>
      <div className="grid g2">
        <Card title="Turni" flush>{!turni.data ? <Loading /> : !turni.data.confermato ? <div className="empty">Mese non ancora confermato dalla struttura.</div> : !turni.data.turni.length ? <div className="empty">Nessun turno nel mese</div> : <div className="table-wrap"><table className="t"><thead><tr><th>Giorno</th><th>Orario</th><th>Sede</th><th>Attività</th></tr></thead><tbody>{turni.data.turni.map((t) => <tr key={t.id}><td className="strong">{DAYS[dow(t.data)].slice(0, 3)} {itD(t.data)}</td><td className="mono">{t.ora_da}–{t.ora_a}</td><td>{t.sede}</td><td className="small">{t.attivita}{t.nota ? ` · ${t.nota}` : ''}</td></tr>)}<tr><td colSpan={4} className="small muted">Totale {oreTxt(turni.data.turni.reduce((a, t) => a + ore(t.ora_da, t.ora_a), 0))}{turni.data.confermatoAt ? ` · confermato ${itDateTime(turni.data.confermatoAt)}` : ''}</td></tr></tbody></table></div>}</Card>
        <Card title="Presenze registrate" flush>{!pres.data ? <Loading /> : !pres.data.length ? <div className="empty">Nessuna presenza registrata nel mese</div> : <div className="table-wrap"><table className="t"><thead><tr><th>Giorno</th><th>Orario</th><th>Sede</th><th>Esito</th></tr></thead><tbody>{pres.data.map((p) => <tr key={p.id}><td className="strong">{itD(p.data)}</td><td className="mono">{p.ora_da}–{p.ora_a}</td><td>{p.sede}</td><td>{p.stato === 'CONFERMATA' ? <Badge tone="green">presente</Badge> : <Badge tone="red">assente</Badge>}{p.rendiconto_id ? <Badge tone="amber">rendicontata</Badge> : null}</td></tr>)}<tr><td colSpan={4} className="small muted">Totale {oreTxt(pres.data.filter((p) => p.stato === 'CONFERMATA').reduce((a, p) => a + ore(p.ora_da, p.ora_a), 0))}. Se una presenza manca o è errata, segnalalo al gestore della sede.</td></tr></tbody></table></div>}</Card>
      </div>
    </div>
  );
}

export function PortaleRendiconti() {
  const { user } = useAuth(); const toast = useToast();
  const { data } = useApi('/portale/rendiconti'); const [open, setOpen] = useState(null);
  return (
    <div className="page">
      <div className="page-head"><div><h1>I miei rendiconti</h1><div className="sub">Rendiconti mensili approvati dal Responsabile del personale sanitario: scarica il PDF da allegare alla fattura.</div></div></div>
      {!data ? <Loading /> : !data.length ? <div className="card"><div className="bd empty">Nessun rendiconto approvato finora.</div></div> : <Card flush><div className="table-wrap"><table className="t"><thead><tr><th>Mese</th><th className="num">Ore</th><th className="num">Imponibile</th><th className="num">Totale fattura</th><th>Stato</th><th>Approvato</th><th /></tr></thead><tbody>{data.map((r) => <tr key={r.id}><td className="strong">{meseTxt(r.mese)}</td><td className="num">{oreTxt(Number(r.ore))}</td><td className="num">{eur(r.importo)}</td><td className="num">{eur(r.totale_fattura)}</td><td><Badge tone={STATO_REND[r.stato]?.[1]}>{STATO_REND[r.stato]?.[0]}</Badge></td><td className="small">{itDateTime(r.approvato_at)}</td><td className="num"><button className="btn sm ghost" onClick={() => setOpen(r.id)}>Apri / PDF</button></td></tr>)}</tbody></table></div></Card>}
      {open && <RendicontoModal id={open} user={user} portale onClose={() => setOpen(null)} toast={toast} />}
    </div>
  );
}

// La pagina pubblica di accettazione invito (/invito/:token) non si porta: l'accesso del professionista lo crea la Suite (Amministrazione > Utenti).

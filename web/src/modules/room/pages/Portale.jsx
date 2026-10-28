import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Loading, ErrorBox, Badge, Field, useToast, Card, Kpi } from '../components/ui.jsx';
import { itDateTime } from '../format.js';
import { DisponibilitaProf } from './Professionisti.jsx';
import { RendicontoModal } from './Rendiconti.jsx';
import { meseTxt, thisMonth, addMonths, itD, ore, oreTxt, eur, STATO_REND, DAYS, dow, pdfTurni } from '../lib/personale.js';

// ---------------------------------------------------------------- scelta del professionista (Amministratore e Planner)
// Richiesta del CEO (28/10/2026): Amministratore e Planner vedono riepilogo e disponibilità di un professionista a scelta.
// Il professionista (PROF) resta sul proprio portale senza tendina. La persona scelta vive nell'indirizzo (?persona=, condivisibile)
// e nella sessione del browser, così passando da Riepilogo a Disponibilità dal menu resta la stessa; in assenza, la persona
// dell'utente se ha la scheda Room, altrimenti la prima dell'elenco.
const PORTALE_INTERNI = ['ADMIN', 'PLANNER'];
const SS_KEY = 'room.portale.persona';
const ssGet = () => { try { return Number(sessionStorage.getItem(SS_KEY)) || null; } catch { return null; } };
const ssSet = (id) => { try { if (id) sessionStorage.setItem(SS_KEY, String(id)); else sessionStorage.removeItem(SS_KEY); } catch { /* storage non disponibile */ } };
export function usePortalePersona() {
  const { user } = useAuth();
  const interno = PORTALE_INTERNI.includes(user?.role);
  const [sp, setSp] = useSearchParams();
  const { data: list, error } = useApi(interno ? '/portale/professionisti' : null);
  const fromUrl = Number(sp.get('persona')) || null;
  const personId = useMemo(() => {
    if (!interno || !list) return null;
    const has = (id) => id && list.some((p) => p.id === id);
    if (has(fromUrl)) return fromUrl;
    const saved = ssGet(); if (has(saved)) return saved;
    if (has(user?.person_id)) return user.person_id;
    return list[0]?.id || null;
  }, [interno, list, fromUrl, user?.person_id]);
  // l'indirizzo riflette sempre la persona in uso (anche quella ripresa dalla sessione o scelta in automatico)
  useEffect(() => {
    if (!interno || !personId) return;
    ssSet(personId);
    if (fromUrl !== personId) { const n = new URLSearchParams(sp); n.set('persona', String(personId)); setSp(n, { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interno, personId, fromUrl]);
  const setPersonId = (id) => { ssSet(id); const n = new URLSearchParams(sp); if (id) n.set('persona', String(id)); else n.delete('persona'); setSp(n, { replace: true }); };
  // suffisso per le API del portale: vuoto per il professionista, ?person_id= per gli interni
  const pq = interno && personId ? `?person_id=${personId}` : '';
  const and = interno && personId ? `&person_id=${personId}` : '';
  const persona = interno ? (list || []).find((p) => p.id === personId) || null : null;
  return { interno, list, error, personId, persona, setPersonId, pq, and, ready: !interno || (list != null && personId != null) || (list != null && !list.length) };
}

// Tendina cercabile "Professionista": campo di testo che filtra l'elenco (nome, profilo, disciplina), elenco a comparsa, frecce e Invio
export function PersonaPicker({ list, personId, onChange, label = 'Professionista' }) {
  const sel = (list || []).find((p) => p.id === personId) || null;
  const [txt, setTxt] = useState(''); const [open, setOpen] = useState(false); const [hi, setHi] = useState(0);
  const box = useRef(null);
  useEffect(() => { const h = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const norm = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const q = norm(txt.trim());
  const items = (list || []).filter((p) => !q || norm(`${p.nome} ${p.profilo || ''} ${(p.discipline || []).join(' ')} ${p.email || ''}`).includes(q));
  const pick = (p) => { onChange(p.id); setTxt(''); setOpen(false); };
  const onKey = (e) => {
    if (!open && ['ArrowDown', 'Enter'].includes(e.key)) { setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(items.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[hi]) pick(items[hi]); }
    else if (e.key === 'Escape') { setOpen(false); setTxt(''); }
  };
  if (!list) return <div className="persona-picker"><label className="pp-label">{label}</label><Loading /></div>;
  return (
    <div className="persona-picker" ref={box}>
      <label className="pp-label" htmlFor="pp-input">{label}</label>
      <div className="pp-field">
        <input id="pp-input" role="combobox" aria-expanded={open} aria-controls="pp-list" aria-autocomplete="list" autoComplete="off"
          placeholder={sel ? sel.nome : 'Cerca per nome, profilo o disciplina'} value={open ? txt : (sel ? sel.nome : '')}
          onFocus={() => { setOpen(true); setHi(0); }} onChange={(e) => { setTxt(e.target.value); setOpen(true); setHi(0); }} onKeyDown={onKey} />
        <span className="pp-caret" aria-hidden="true">▾</span>
        {open && <ul id="pp-list" role="listbox" className="pp-list">
          {!items.length ? <li className="pp-empty">Nessun professionista corrisponde</li> : items.map((p, i) => (
            <li key={p.id} role="option" aria-selected={p.id === personId} className={`pp-item${i === hi ? ' hi' : ''}${p.id === personId ? ' on' : ''}`} onMouseDown={(e) => { e.preventDefault(); pick(p); }} onMouseEnter={() => setHi(i)}>
              <span className="pp-nome">{p.nome}</span>
              <span className="pp-sub">{[p.profilo, (p.discipline || []).join(', '), p.sede].filter(Boolean).join(' · ')}{p.pianificabile === false ? ' · escluso dalla pianificazione' : ''}</span>
            </li>))}
        </ul>}
      </div>
      {sel && <span className="small muted pp-hint">{list.length} professionisti con scheda Room Planning</span>}
    </div>
  );
}

// Intestazione comune delle due pagine per gli interni: tendina + stato
function PortaleTesta({ pp, children }) {
  if (!pp.interno) return children || null;
  if (pp.error) return <div className="page"><ErrorBox error={pp.error} /></div>;
  return (
    <>
      <PersonaPicker list={pp.list} personId={pp.personId} onChange={pp.setPersonId} />
      {pp.list && !pp.list.length ? <div className="card"><div className="bd empty">Nessun professionista con scheda Room Planning: compila le schede dalla voce "Professionisti".</div></div> : (pp.personId ? children : <Loading />)}
    </>
  );
}

export function PortaleHome() {
  const toast = useToast();
  const pp = usePortalePersona();
  const on = pp.ready && (!pp.interno || pp.personId);   // per gli interni le API partono solo con un professionista scelto
  const { data: me, error, reload } = useApi(on ? `/portale/me${pp.pq}` : null, [pp.pq]);
  const [f, setF] = useState(null);
  const mese = thisMonth();
  const turni = useApi(on ? `/portale/turni?mese=${mese}${pp.and}` : null, [pp.and]); const pres = useApi(on ? `/portale/presenze?mese=${addMonths(mese, -1)}${pp.and}` : null, [pp.and]); const rend = useApi(on ? `/portale/rendiconti${pp.pq}` : null, [pp.pq]); const pos = useApi(on ? `/portale/posizioni${pp.pq}` : null, [pp.pq]);
  useEffect(() => { setF(null); }, [pp.personId]);
  const save = async () => { try { await api.put('/portale/me', f); toast('Dati aggiornati'); setF(null); reload(); } catch (e) { toast(e.message, 'err'); } };
  const body = () => {
    if (error) return <ErrorBox error={error} />;
    if (!me) return <Loading />;
    const prossimi = (turni.data?.turni || []).filter((t) => t.data >= new Date().toISOString().slice(0, 10)).slice(0, 5);
    return <>
      <div className="portale-hero"><h1>{pp.interno ? me.nome : `Ciao, ${me.nome}`}</h1><div>{me.profilo}{me.professionale?.discipline?.length ? ' · ' + me.professionale.discipline.join(', ') : ''} · {pp.interno ? 'riepilogo del portale del professionista' : 'portale del personale sanitario di Toscana Diagnostica'}</div></div>
      <div className="grid g4 mt">
        <Kpi label={`Turni di ${meseTxt(mese)}`} value={turni.data?.confermato ? turni.data.turni.length : '—'} foot={turni.data?.confermato ? oreTxt(turni.data.turni.reduce((a, t) => a + ore(t.ora_da, t.ora_a), 0)) : 'mese non ancora confermato'} />
        <Kpi label={`Presenze ${meseTxt(addMonths(mese, -1))}`} value={pres.data ? oreTxt(pres.data.filter((p) => p.stato === 'CONFERMATA').reduce((a, p) => a + ore(p.ora_da, p.ora_a), 0)) : '—'} foot={`${pres.data?.length || 0} registrate dalle sedi`} />
        <Kpi label="Rendiconti disponibili" value={rend.data?.length || 0} foot={rend.data?.[0] ? `ultimo: ${meseTxt(rend.data[0].mese)} · ${eur(rend.data[0].importo)}` : 'nessuno'} />
        <Kpi label="Posizioni aperte" value={(pos.data || []).filter((p) => p.stato === 'APERTA').length} foot="in bacheca" accent={(pos.data || []).some((p) => p.stato === 'APERTA' && !p.mia_candidatura)} />
      </div>
      <div className="grid g2 mt">
        <Card title="Prossimi turni" flush>{!turni.data ? <Loading /> : !turni.data.confermato ? <div className="empty">I turni di {meseTxt(mese)} non sono ancora stati confermati dalla struttura.</div> : !prossimi.length ? <div className="empty">Nessun turno in programma nel mese</div> : <div className="table-wrap"><table className="t"><tbody>{prossimi.map((t) => <tr key={t.id}><td className="strong">{DAYS[dow(t.data)].slice(0, 3)} {itD(t.data)}</td><td className="mono">{t.ora_da}–{t.ora_a}</td><td>{t.sede}</td><td className="small muted">{t.attivita}</td></tr>)}</tbody></table></div>}</Card>
        <Card title={pp.interno ? 'Dati del professionista' : 'I miei dati'} actions={pp.interno ? null : f ? <><button className="btn sm ghost" onClick={() => setF(null)}>Annulla</button><button className="btn sm" onClick={save}>Salva</button></> : <button className="btn sm ghost" onClick={() => setF(Object.fromEntries(me.selfFields.map((k) => [k, me.anagrafica[k] || ''])))}>Modifica contatti</button>}>
          <div className="small"><b>Email:</b> {me.email || '—'}{me.telefono ? <> · <b>Telefono:</b> {me.telefono}</> : null} · <b>Compenso:</b> {me.compenso.tipo === 'FISSO' ? `fisso mensile ${eur(me.compenso.fissoMensile)}` : `${me.compenso.tariffaOraria ? eur(me.compenso.tariffaOraria) + '/h' : 'tariffa oraria da definire'}${me.compenso.eccezioniSede.length ? ' (' + me.compenso.eccezioniSede.map((e) => `${e.sede}: ${eur(e.tariffaOraria)}/h`).join(', ') + ')' : ''}`}{me.sediAbilitate.length ? <> · <b>Sedi:</b> {me.sediAbilitate.map((s) => s.label).join(', ')}</> : null}</div>
          {f ? <div className="form-grid mt">{me.selfFields.map((k) => <Field key={k} label={{ indirizzo: 'Indirizzo', cap: 'CAP', citta: 'Città', provincia: 'Provincia', pec: 'PEC', iban: 'IBAN', intestatarioConto: 'Intestatario del conto' }[k] || k}><input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}</div>
            : <div className="small muted mt">{[me.anagrafica.indirizzo && `${me.anagrafica.indirizzo} ${me.anagrafica.cap || ''} ${me.anagrafica.citta || ''}`, me.anagrafica.pec && `PEC ${me.anagrafica.pec}`, me.anagrafica.iban && `IBAN ${me.anagrafica.iban}`].filter(Boolean).join(' · ') || (pp.interno ? 'Recapiti integrativi non ancora inseriti dal professionista.' : 'Recapiti non ancora inseriti: usa "Modifica contatti".')}{me.assicurazione?.scadenza && <div>Polizza RC in scadenza il {itD(me.assicurazione.scadenza)}</div>}{me.docs?.length ? <div>{me.docs.length} documenti in archivio presso la struttura</div> : null}</div>}
          <p className="small muted" style={{ marginTop: 8 }}>{pp.interno ? 'PEC, IBAN e intestatario del conto li aggiorna il professionista dal proprio portale; anagrafica, contratto e compenso si gestiscono da "Professionisti" e in Amministrazione > Persone.' : 'Nome, email, telefono, codice fiscale, residenza, luogo di nascita e partita IVA sono nell\'anagrafica unica della Suite: per cambiarli, come per dati fiscali, contratto o compenso, contatta il Responsabile del personale sanitario.'}</p>
        </Card>
      </div>
    </>;
  };
  return (
    <div className="page">
      {pp.interno && <div className="page-head"><div><h1>Riepilogo</h1><div className="sub">Il portale del professionista visto da chi pianifica: turni confermati, presenze, rendiconti e bacheca della persona scelta.</div></div></div>}
      <PortaleTesta pp={pp}>{body()}</PortaleTesta>
    </div>
  );
}

export function PortaleDisponibilita() {
  const toast = useToast();
  const pp = usePortalePersona();
  const on = pp.ready && (!pp.interno || pp.personId);
  const sedi = useApi(on ? `/portale/sedi${pp.pq}` : null, [pp.pq]);
  return (
    <div className="page">
      <div className="page-head"><div><h1>{pp.interno ? 'Disponibilità' : 'Le mie disponibilità'}</h1><div className="sub">{pp.interno ? 'Giorni, orari e sedi in cui il professionista scelto si rende disponibile: le modifiche fatte da qui restano nel registro attività con il nome della persona.' : 'Giorni, orari e sedi in cui sei disponibile oltre ai turni già programmati: la struttura le usa per proporti nuove attività.'}</div></div></div>
      <PortaleTesta pp={pp}>{!sedi.data ? <Loading /> : <DisponibilitaProf key={pp.personId || 'me'} portale personId={pp.personId} sedi={sedi.data} toast={toast} />}</PortaleTesta>
    </div>
  );
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

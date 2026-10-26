import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useApi, Loading, ErrorBox, Modal, Badge, Field, useToast } from '../components/ui.jsx';
import { durTxt } from '../planner/planner.jsx';
import { buildNetwork, simulate, DAYS, DAYS_S, m2t } from '../lib/network.js';
import { pdfAgendaSpecialista, pdfProposta, pdfPianoDisponibilita, pdfBase64 } from '../lib/exports.js';

const SEDE_COLORS = ['#1C505E', '#35768A', '#7A4E9E', '#2F8F5B', '#B7791F', '#B03A2E', '#4A6FA5', '#6B8E23'];
const emptyWin = () => ({ 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] });
const pianoOf = (net, x) => simulate(net, x.key, 'tutto', { minDur: 60 });
const sediOf = (x) => [...new Set(x.sedi.map((z) => z.sede))];
const pianoText = (x, p) => `Gentile ${x.nome},\n\nin allegato trovi il piano delle disponibilità nelle strutture del network Toscana Diagnostica, costruito in rapporto agli impegni che hai già in calendario con noi (${durTxt(x.ore)} a settimana${sediOf(x).length ? ', ' + sediOf(x).join(', ') : ''}).\n\nNella prima parte sono riepilogati i tuoi impegni attuali; nella seconda gli spazi ambulatoriali liberi e compatibili con la tua attività (${x.discipline.join(', ') || x.profili.join(', ')}) nelle nostre sedi, al di fuori delle fasce in cui sei già impegnato con noi: ${p.perSede.length ? p.perSede.map((q) => `${q.sede} (${durTxt(q.min)})`).join(', ') : 'al momento nessuno spazio libero compatibile'}.\n\nSe alcune di queste fasce fossero di tuo interesse per ampliare la collaborazione, rispondi a questa email indicando giorni e orari preferiti: definiremo insieme l'inserimento.\n\nCordiali saluti`;
const PIANO_SUBJECT = 'Piano delle disponibilità nelle strutture Toscana Diagnostica';

const KIND_LABEL = { DIPENDENTE: 'Dipendente', LP: 'Libero professionista', MEDICO: 'Medico', SANITARIO: 'Professionista sanitario', ESTERNO: 'Esterno', DIRIGENTE: 'Dirigente' };
const KIND_TONE = { MEDICO: 'teal', SANITARIO: 'mauve', LP: 'green', DIPENDENTE: 'grey', ESTERNO: 'amber', DIRIGENTE: 'grey' };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Tutte le persone dell'anagrafica unica (public.people, stato ATTIVO) con i filtri sul modello attuale: tipo (people.kind), sede di lavoro,
// ruolo del catalogo, disciplina, testo su cognome e nome, pianificabili / esclusi. Per chi compare nella settimana-tipo delle sedi
// si mostrano impegni, agenda e simulatore di proposta (dati del network, agganciati per chiave del nome).
export default function Specialisti() {
  const { user } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useApi('/strutture');
  const persone = useApi('/personale/professionisti');
  const opz = useApi('/personale/professionisti/opzioni');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [sedeF, setSedeF] = useState('');
  const [ruoloF, setRuoloF] = useState('');
  const [discF, setDiscF] = useState('');
  const [pian, setPian] = useState('pianificabili');   // pianificabili | esclusi | tutti
  const [sel, setSel] = useState(null);
  const [checked, setChecked] = useState(() => new Set());
  const [bulk, setBulk] = useState(false);
  const [busy, setBusy] = useState(false);
  const toggle = (k) => setChecked((c) => { const n = new Set(c); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const net = useMemo(() => (data ? buildNetwork(data) : null), [data]);
  const colorOf = useMemo(() => { const m = {}; (data || []).forEach((s, i) => { m[s.id] = SEDE_COLORS[i % SEDE_COLORS.length]; }); return m; }, [data]);
  const canEdit = user.role !== 'VIEWER';
  const canPlan = ['ADMIN', 'PLANNER', 'RESP_SAN'].includes(user.role);
  // Persone attive dell'anagrafica, con il profilo del network (se la persona compare nella settimana-tipo di qualche sede)
  const attive = useMemo(() => (persone.data || []).filter((p) => p.status === 'ATTIVO').map((p) => ({ ...p, net: net?.byKey[p.personaKey] || null })), [persone.data, net]);
  const discipline = useMemo(() => [...new Set([...(opz.data?.discipline || []), ...attive.flatMap((p) => [...(p.discipline || []), ...(p.net?.discipline || [])])].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it')), [opz.data, attive]);
  const list = useMemo(() => attive.filter((p) =>
    (!kind || p.kind === kind)
    && (!sedeF || String(p.siteId) === String(sedeF))
    && (!ruoloF || String(p.roleId) === String(ruoloF))
    && (!discF || (p.discipline || []).includes(discF) || (p.net?.discipline || []).includes(discF))
    && (pian === 'tutti' || (pian === 'esclusi' ? p.planningExcluded : !p.planningExcluded))
    && (!q || norm(`${p.lastName} ${p.firstName} ${p.nome}`).includes(norm(q)))), [attive, q, kind, sedeF, ruoloF, discF, pian]);
  const nEsclusi = attive.filter((p) => p.planningExcluded).length;
  // Persone della settimana-tipo delle sedi che non esistono nell'anagrafica unica: si segnalano, non si perdono
  const nonInAnagrafica = useMemo(() => { const keys = new Set(attive.map((p) => p.personaKey)); return (net?.specialisti || []).filter((x) => !x.attivita && !keys.has(x.key)); }, [net, attive]);
  const p = sel ? attive.find((z) => z.id === sel) : null;
  const sediOpz = opz.data?.sedi || [];
  const sedeNome = (id) => { const s = sediOpz.find((z) => String(z.id) === String(id)); return s ? (s.short_name || s.name) : ''; };
  const setExcluded = async (persona, excluded) => {
    setBusy(true);
    try { await api.put(`/personale/professionisti/${persona.id}/pianificazione`, { excluded }); toast(excluded ? `${persona.nome} esclusa dalla pianificazione` : `${persona.nome} di nuovo pianificabile`); persone.reload(); } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  const massa = async (azione) => {
    const msg = azione === 'ESCLUDI_NON_SANITARI' ? 'Escludere dalla pianificazione tutte le persone di tipo Dipendente, Esterno o Dirigente senza disciplina e senza ruolo sanitario? Medici, professionisti sanitari e liberi professionisti restano dentro. Chiunque si può riportare tra i pianificabili dalla sua scheda.' : 'Riportare tra i pianificabili tutte le persone escluse?';
    if (!window.confirm(msg)) return;
    setBusy(true);
    try { const r = await api.post('/personale/professionisti/pianificazione/massa', { azione }); toast(azione === 'ESCLUDI_NON_SANITARI' ? `Escluse ${r.n} persone` : `Riportate tra i pianificabili ${r.n} persone`); persone.reload(); } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  const checkedNet = (net?.specialisti || []).filter((x) => checked.has(x.key));
  const listNet = list.filter((z) => z.net).map((z) => z.net);
  const ambito = checked.size ? `${checked.size} professionisti selezionati a mano` : [kind && KIND_LABEL[kind], sedeF && `sede ${sedeNome(sedeF)}`, ruoloF && (opz.data?.ruoli || []).find((r) => String(r.id) === String(ruoloF))?.name, discF, pian !== 'tutti' && pian, q && `ricerca "${q}"`].filter(Boolean).join(' · ') || 'tutte le persone pianificabili';
  return (
    <div className="page">
      <div className="page-head"><div><h1>Tutti i professionisti</h1><div className="sub">Tutte le persone dell'anagrafica unica della Suite (stato attivo): impegni settimanali nelle sedi, agenda, simulatore di proposta e scelta di chi è pianificabile. Nome e dati anagrafici si modificano in Rubrica.</div></div>
        <div className="row">
          {canPlan && <button className="btn ghost" disabled={busy || !persone.data} onClick={() => massa('ESCLUDI_NON_SANITARI')} title="Esclude dalla pianificazione dipendenti, esterni e dirigenti senza disciplina né ruolo sanitario; medici e sanitari restano dentro">Escludi tutti i non sanitari</button>}
          {canPlan && nEsclusi > 0 && <button className="btn ghost" disabled={busy} onClick={() => massa('INCLUDI_TUTTI')}>Includi tutti ({nEsclusi})</button>}
          {canEdit && net && <button className="btn ghost" onClick={() => setBulk(true)}>{checked.size ? `Invia il piano disponibilità ai ${checked.size} selezionati…` : 'Invio massivo del piano disponibilità…'}</button>}
        </div></div>
      {bulk && net && <BulkModal net={net} list={checked.size ? checkedNet : listNet} ambito={ambito} onClose={() => setBulk(false)} toast={toast} />}
      <ErrorBox error={error || persone.error} />
      {!net || !persone.data ? <Loading /> : (
        <div className="spec-layout">
          <div className="card spec-list">
            <div className="bd" style={{ padding: 12, borderBottom: '1px solid var(--line)' }}>
              <input placeholder="Cerca cognome o nome…" value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="seg" style={{ marginTop: 8 }}>{[['pianificabili', 'Pianificabili'], ['esclusi', 'Esclusi'], ['tutti', 'Tutti']].map(([k, l]) => <button key={k} className={pian === k ? 'on' : ''} onClick={() => setPian(k)}>{l}</button>)}</div>
              <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ marginTop: 8 }}><option value="">Tutti i tipi di persona</option>{(opz.data?.kinds || Object.entries(KIND_LABEL).map(([k, label]) => ({ k, label }))).map((k) => <option key={k.k} value={k.k}>{k.label}</option>)}</select>
              <select value={sedeF} onChange={(e) => setSedeF(e.target.value)} style={{ marginTop: 6 }}><option value="">Tutte le sedi di lavoro</option>{sediOpz.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              <select value={ruoloF} onChange={(e) => setRuoloF(e.target.value)} style={{ marginTop: 6 }}><option value="">Tutti i ruoli</option>{(opz.data?.ruoli || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
              <select value={discF} onChange={(e) => setDiscF(e.target.value)} style={{ marginTop: 6 }}><option value="">Tutte le discipline</option>{discipline.map((d) => <option key={d} value={d}>{d}</option>)}</select>
              <div className="row small muted" style={{ marginTop: 6, gap: 6 }}><span>{list.length} persone{nEsclusi ? ` · ${nEsclusi} escluse` : ''}</span><span className="spacer" />
                {canEdit && <><button className="btn sm ghost" onClick={() => setChecked(new Set([...checked, ...listNet.map((x) => x.key)]))} title="Seleziona per l'invio massivo tutte le persone in elenco presenti nelle sedi">Sel. tutti</button>{checked.size > 0 && <button className="btn sm ghost" onClick={() => setChecked(new Set())}>Nessuno ({checked.size})</button>}</>}</div>
            </div>
            <div className="spec-items">{list.map((z) => (
              <button key={z.id} className={`spec-item ${sel === z.id ? 'on' : ''} ${z.net && checked.has(z.net.key) ? 'checked' : ''}`} onClick={() => setSel(z.id)}>
                <div className="strong row" style={{ gap: 8 }}>{canEdit && z.net && <input type="checkbox" checked={checked.has(z.net.key)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(z.net.key)} title="Seleziona per l'invio massivo" />}<span>{z.lastName} {z.firstName}</span>{z.planningExcluded && <span className="small muted" style={{ fontWeight: 400 }}>esclusa</span>}{!z.email && <span className="small muted" style={{ fontWeight: 400 }}>senza email</span>}</div>
                <div className="small muted">{KIND_LABEL[z.kind] || z.kind}{z.roleName ? ` · ${z.roleName}` : ''}{(z.discipline || []).length ? ` · ${z.discipline.join(', ')}` : z.net?.discipline?.length ? ` · ${z.net.discipline.join(', ')}` : ''}</div>
                <div className="small">{z.siteName ? <span>{sedeNome(z.siteId) || z.siteName}</span> : <span className="muted">sede non indicata</span>}{z.net ? <span> · {z.net.nSedi} {z.net.nSedi === 1 ? 'sede' : 'sedi'} · {durTxt(z.net.ore)}/sett.{z.net.sessioni.some((w) => !w.room) ? <span className="red"> · non allocate</span> : null}</span> : <span className="muted"> · non nelle sedi</span>}</div>
              </button>))}
              {!list.length && <div className="empty">Nessuna persona con questi filtri.</div>}
              {nonInAnagrafica.length > 0 && <div className="bd small muted" style={{ borderTop: '1px solid var(--line)' }} title={nonInAnagrafica.map((x) => x.nome).join(', ')}>Nella settimana-tipo delle sedi ma non in anagrafica: {nonInAnagrafica.length} ({nonInAnagrafica.slice(0, 4).map((x) => x.nome).join(', ')}{nonInAnagrafica.length > 4 ? '…' : ''}). Si creano in Rubrica con la stessa grafia.</div>}
            </div>
          </div>
          <div style={{ minWidth: 0 }}>
            {!p ? <div className="card"><div className="bd empty">Seleziona una persona per vedere i suoi dati, gli impegni su tutte le sedi e simulare una proposta.</div></div>
              : <div className="grid" style={{ gap: 16 }}>
                <SchedaPersona p={p} sedeNome={sedeNome} canPlan={canPlan} busy={busy} onExcluded={(v) => setExcluded(p, v)} />
                {p.net ? <Dettaglio key={p.net.key} x={p.net} net={net} colorOf={colorOf} canEdit={canEdit} toast={toast} reload={reload} persona={p} />
                  : <div className="card"><div className="bd empty">La persona non compare nella settimana-tipo di nessuna sede: niente impegni da mostrare. Si inserisce dal personale della sede in "Sedi e ambulatori".</div></div>}
              </div>}
          </div>
        </div>
      )}
    </div>
  );
}

// Dati anagrafici in sola lettura (vengono dalla Rubrica) e scelta "pianificabile / esclusa"
function SchedaPersona({ p, sedeNome, canPlan, busy, onExcluded }) {
  return (
    <div className="card"><div className="bd">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 18 }}>{p.lastName} {p.firstName} <Badge tone={KIND_TONE[p.kind] || 'grey'}>{KIND_LABEL[p.kind] || p.kind}</Badge> {p.planningExcluded ? <Badge tone="red">esclusa dalla pianificazione</Badge> : <Badge tone="green">pianificabile</Badge>}{p.inRoom && <> <Badge tone="teal">scheda Room</Badge></>}</h2>
          <div className="small muted">{[p.roleName, p.siteName ? `sede ${sedeNome(p.siteId) || p.siteName}` : 'sede di lavoro non indicata', (p.discipline || []).join(', '), p.email || 'senza email'].filter(Boolean).join(' · ')}</div>
          <div className="small muted" style={{ marginTop: 4 }}>Nome, contatti, sede di lavoro, ruolo e disciplina sono dell'anagrafica unica: si modificano in Rubrica. Tariffe, disponibilità e contratto stanno nella scheda Room (pagina Professionisti).</div>
        </div>
        <div className="row">
          <Link className="btn ghost sm" to={`/people/${p.id}`}>Apri in Rubrica</Link>
          {canPlan && (p.planningExcluded
            ? <button className="btn sm" disabled={busy} onClick={() => onExcluded(false)}>Riporta tra i pianificabili</button>
            : <button className="btn sm ghost" disabled={busy} onClick={() => onExcluded(true)} title="La persona non comparirà più nei selettori di turni, disponibilità, presenze e calendario">Escludi dalla pianificazione</button>)}
        </div>
      </div>
    </div></div>
  );
}

function Dettaglio({ x, net, colorOf, canEdit, toast, reload, persona }) {
  const [win, setWin] = useState(emptyWin());
  const [soloAltre, setSoloAltre] = useState(false);
  const [minDur, setMinDur] = useState(60);
  const [sim, setSim] = useState(null);
  const [mail, setMail] = useState(null); // {kind:'agenda'|'proposta'}
  const [email, setEmail] = useState(persona?.email || x.email || '');
  const sedi = [...new Map(x.sedi.map((z) => [z.sedeId, z])).values()];
  const run = () => { const r = simulate(net, x.key, win, { soloAltreSedi: soloAltre, minDur: Number(minDur) || 60 }); setSim(r); if (!r.proposte.length) toast('Nessuno spazio compatibile nelle fasce indicate', 'err'); };
  const fill = (from, to, days = [0, 1, 2, 3, 4, 5]) => setWin((w) => { const n = { ...w }; days.forEach((d) => { n[d] = [{ from, to }]; }); return n; });
  const saveEmail = async () => {
    try {
      for (const z of sedi) {
        const r = await api.get(`/strutture/${z.sedeId}`);
        const s = r.struttura; const p = s.personale.find((q) => q.id === z.persona.id); if (!p) continue;
        p.email = email;
        const lite = { ...s }; delete lite.logo; lite.plan = { markers: s.plan.markers };
        await api.put(`/strutture/${z.sedeId}`, { data: lite, version: r.version });
      }
      toast('Email salvata nelle schede di sede'); reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  const sedeList = [...new Set(x.sedi.map((z) => z.sede))];
  const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => x.sessioni.some((q) => q.d === d) || d < 6);
  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card"><div className="bd">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 18 }}>Nelle sedi come {x.nome} <Badge tone={x.tipo === 'medico' ? 'teal' : 'mauve'}>{x.tipo === 'medico' ? 'medico' : x.profili.join(', ') || 'sanitario'}</Badge></h2>
            <div className="muted">{x.discipline.join(', ')}{x.attrezzature.length ? ` · richiede ${x.attrezzature.join(', ')}` : ''}</div>
            <div className="row small" style={{ marginTop: 6, gap: 14 }}><span><b>{durTxt(x.ore)}</b>/settimana</span><span><b>{x.sessioni.filter((q) => q.room).length}</b> sessioni</span><span>sedi: {sedeList.map((n, i) => <span key={n} className="chip" style={{ background: colorOf[x.sedi.find((z) => z.sede === n)?.sedeId] + '22' }}>{n}</span>)}</span></div>
          </div>
          <div className="row">
            <button className="btn ghost sm" onClick={() => { const { doc, filename } = pdfAgendaSpecialista(x); doc.save(filename); }}>Scarica PDF agenda</button>
            {canEdit && <button className="btn sm ghost" onClick={() => setMail({ kind: 'agenda' })}>Invia l'agenda al professionista</button>}
            <button className="btn ghost sm" onClick={() => { const p = pianoOf(net, x); const { doc, filename } = pdfPianoDisponibilita(x, p, pianoText(x, p)); doc.save(filename); }}>Scarica PDF piano disponibilità</button>
            {canEdit && <button className="btn sm" onClick={() => setMail({ kind: 'piano', sim: pianoOf(net, x) })}>Invia al professionista il piano delle disponibilità</button>}
          </div>
        </div>
        {canEdit && <div className="row" style={{ marginTop: 10 }}><Field label={persona?.email ? 'Email del professionista (dall\'anagrafica unica)' : 'Email del professionista (per gli invii, nelle schede di sede)'}><div className="row"><input type="email" value={email} readOnly={Boolean(persona?.email)} onChange={(e) => setEmail(e.target.value)} placeholder="nome@esempio.it" style={{ width: 280 }} />{!persona?.email && email !== (x.email || '') && <button className="btn sm ghost" onClick={saveEmail}>Salva</button>}</div></Field></div>}
      </div></div>

      <div className="card"><div className="hd"><h2>Impegni settimanali su tutte le sedi</h2></div><div className="bd">
        <div className="agenda-grid">
          {days.map((d) => (
            <div key={d} className="agenda-col">
              <div className="agenda-day">{DAYS[d]}</div>
              {x.sessioni.filter((q) => q.d === d).map((q, i) => (
                <div key={i} className={`agenda-blk ${q.room ? '' : 'un'}`} style={q.room ? { background: colorOf[q.sedeId] } : undefined} title={q.reason || ''}>
                  <div className="t">{m2t(q.s)}–{m2t(q.e)}</div>
                  <div className="s">{q.sede}</div>
                  <div className="r">{q.room ? `${q.room} · ${q.ruolo === 'titolare' ? q.disciplina : q.ruolo}` : `non allocata: ${q.reason}`}</div>
                </div>))}
              {!x.sessioni.some((q) => q.d === d) && <div className="agenda-free">libero</div>}
            </div>))}
        </div>
      </div></div>

      <div className="card"><div className="hd"><h2>Simulatore di proposta</h2><span className="spacer" /><span className="small muted">Usa solo gli spazi liberi delle sedi: nessuna attività già pianificata viene toccata.</span></div><div className="bd">
        <p className="small muted" style={{ marginTop: 0 }}>Inserisci le fasce in cui il professionista si rende disponibile in aggiunta agli impegni già in calendario con noi. Il simulatore cerca, in tutte le sedi, gli ambulatori liberi compatibili con disciplina e attrezzature e li propone.</p>
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="btn sm ghost" onClick={() => fill('08:00', '19:00')}>Lun–Sab 08–19</button>
          <button className="btn sm ghost" onClick={() => fill('08:00', '13:00')}>Mattine</button>
          <button className="btn sm ghost" onClick={() => fill('14:00', '19:00')}>Pomeriggi</button>
          <button className="btn sm ghost" onClick={() => setWin(emptyWin())}>Azzera</button>
          <span className="spacer" />
          <label className="f inline"><input type="checkbox" checked={soloAltre} onChange={(e) => setSoloAltre(e.target.checked)} />Solo sedi dove non lavora già</label>
          <label className="f inline">Durata minima <select value={minDur} onChange={(e) => setMinDur(e.target.value)} style={{ width: 'auto' }}><option value={60}>1 h</option><option value={120}>2 h</option><option value={180}>3 h</option><option value={240}>4 h</option></select></label>
        </div>
        <div className="win-grid">{[0, 1, 2, 3, 4, 5, 6].map((d) => (
          <div key={d} className="win-day">
            <div className="small strong">{DAYS_S[d]}</div>
            {(win[d] || []).map((r, i) => (
              <div key={i} className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                <input type="time" value={r.from} onChange={(e) => setWin((w) => ({ ...w, [d]: w[d].map((z, j) => (j === i ? { ...z, from: e.target.value } : z)) }))} />
                <input type="time" value={r.to} onChange={(e) => setWin((w) => ({ ...w, [d]: w[d].map((z, j) => (j === i ? { ...z, to: e.target.value } : z)) }))} />
                <button className="btn sm ghost" onClick={() => setWin((w) => ({ ...w, [d]: w[d].filter((_, j) => j !== i) }))}>×</button>
              </div>))}
            <button className="btn sm ghost" onClick={() => setWin((w) => ({ ...w, [d]: [...(w[d] || []), { from: '09:00', to: '13:00' }] }))}>+ fascia</button>
          </div>))}</div>
        <div className="row" style={{ marginTop: 12 }}><button className="btn" onClick={run}>Calcola la proposta</button>
          {sim && sim.proposte.length > 0 && <><button className="btn ghost" onClick={() => { const { doc, filename } = pdfProposta(x, sim, win, introText(x, sim)); doc.save(filename); }}>Scarica PDF proposta</button>{canEdit && <button className="btn" onClick={() => setMail({ kind: 'proposta' })}>Invia la proposta via email</button>}</>}
        </div>
        {sim && sim.proposte.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="row" style={{ gap: 10, marginBottom: 8 }}>{sim.perSede.map((p) => <span key={p.sedeId} className="chip" style={{ background: colorOf[p.sedeId] + '22' }}>{p.sede}: {durTxt(p.min)} in {p.n} fasce</span>)}<span className="spacer" /><b>{durTxt(sim.totale)} proponibili</b></div>
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Sede</th><th>Giorno</th><th>Orario</th><th className="num">Durata</th><th>Ambulatorio</th><th>Dedicato a</th><th>Attrezzature</th><th /></tr></thead>
              <tbody>{sim.proposte.map((p, i) => <tr key={i}><td className="strong"><span className="dot" style={{ background: colorOf[p.sedeId], display: 'inline-block', width: 8, height: 8, borderRadius: 4, marginRight: 6 }} />{p.sede}{p.giaPresente ? <span className="small muted"> (già presente)</span> : <Badge tone="mauve">nuova sede</Badge>}<div className="small muted" style={{ fontWeight: 400 }}>{p.indirizzo}</div></td><td>{DAYS[p.d]}</td><td className="mono">{m2t(p.s)}–{m2t(p.e)}</td><td className="num">{durTxt(p.min)}</td><td>{p.room}</td><td className="small">{p.dedicato}</td><td className="small">{p.attrezzature.join(', ')}</td><td /></tr>)}</tbody>
            </table></div>
          </div>)}
      </div></div>
      {mail && <MailModal x={x} kind={mail.kind} email={email} onClose={() => setMail(null)} build={() => (mail.kind === 'agenda' ? pdfAgendaSpecialista(x) : mail.kind === 'piano' ? pdfPianoDisponibilita(x, mail.sim, pianoText(x, mail.sim)) : pdfProposta(x, sim, win, introText(x, sim)))} defaults={mail.kind === 'piano' ? { subject: PIANO_SUBJECT, body: pianoText(x, mail.sim) } : mail.kind === 'agenda' ? { subject: `La tua agenda settimanale nelle sedi Toscana Diagnostica`, body: `Gentile ${x.nome},\n\nin allegato trovi il riepilogo della tua programmazione settimanale nelle sedi del network Toscana Diagnostica (${durTxt(x.ore)} a settimana, ${sedeList.join(', ')}).\n\nPer qualsiasi variazione di disponibilità rispondi a questa email.\n\nCordiali saluti` } : { subject: `Proposta di collaborazione nelle sedi Toscana Diagnostica`, body: introText(x, sim) }} toast={toast} />}
    </div>
  );
}

function introText(x, sim) {
  if (!sim) return '';
  return `Gentile ${x.nome},\n\nsulla base delle disponibilità che ci hai comunicato abbiamo individuato ${durTxt(sim.totale)} settimanali di spazi ambulatoriali liberi nelle nostre sedi, compatibili con la tua attività (${x.discipline.join(', ') || x.profili.join(', ')}): ${sim.perSede.map((p) => `${p.sede} (${durTxt(p.min)})`).join(', ')}.\n\nIn allegato il dettaglio per sede, giorno e ambulatorio. Si tratta di spazi aggiuntivi rispetto agli impegni già in calendario con noi: saremmo lieti di integrare la collaborazione secondo le tue preferenze.\n\nRestiamo a disposizione per definire insieme giorni e orari.`;
}

function MailModal({ x, kind, email, onClose, build, defaults, toast }) {
  const [to, setTo] = useState(email || '');
  const [subject, setSubject] = useState(defaults.subject);
  const [body, setBody] = useState(defaults.body);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/comms/status', { silent: true }).then(setStatus).catch(() => {}); }, []);
  const send = async () => {
    setBusy(true);
    try {
      const { doc, filename } = build();
      const r = await api.post('/comms/invia', { kind: kind === 'agenda' ? 'AGENDA_MEDICO' : kind === 'piano' ? 'PIANO_DISPONIBILITA' : 'PROPOSTA', to: to.split(/[;,]/).map((s) => s.trim()).filter(Boolean), subject, body, attachment: { filename, base64: pdfBase64(doc) } });
      if (r.status === 'INVIATA') { toast('Email inviata'); onClose(); } else toast(r.status === 'NON_CONFIGURATA' ? 'Invio email non configurato: la comunicazione è stata registrata ma non spedita' : `Invio non riuscito: ${r.error}`, 'err');
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  return (
    <Modal title={kind === 'agenda' ? `Invia l'agenda a ${x.nome}` : kind === 'piano' ? `Invia il piano delle disponibilità a ${x.nome}` : `Invia la proposta a ${x.nome}`} onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy || !to} onClick={send}>{busy ? 'Invio…' : 'Invia con allegato PDF'}</button></>}>
      {status && !status.configured && <div className="alert err" style={{ marginBottom: 10 }}>L'invio email non è ancora configurato (GRAPH_SENDER e permesso Mail.Send su Entra): il messaggio verrà solo registrato. Puoi comunque scaricare il PDF e inviarlo a mano.</div>}
      {status?.configured && <div className="small muted" style={{ marginBottom: 10 }}>Mittente: {status.from} (Microsoft 365). Nessuna email parte senza il pulsante Invia.</div>}
      <div className="form-grid">
        <Field label="Destinatario"><input type="text" value={to} onChange={(e) => setTo(e.target.value)} placeholder="email del professionista (più indirizzi separati da virgola)" /></Field>
        <Field label="Oggetto"><input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
      </div>
      <Field label="Testo"><textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
    </Modal>
  );
}

function BulkModal({ net, list, ambito, onClose, toast }) {
  const withMail = list.filter((x) => x.email);
  const [chosen, setChosen] = useState(() => new Set(withMail.map((x) => x.key)));
  const [subject, setSubject] = useState(PIANO_SUBJECT);
  const [status, setStatus] = useState(null);
  const [prog, setProg] = useState(null); // {done, tot, ok, ko, log:[]}
  const [confirm, setConfirm] = useState('');
  useEffect(() => { api.get('/comms/status', { silent: true }).then(setStatus).catch(() => {}); }, []);
  const toggle = (k) => setChosen((c) => { const n = new Set(c); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const run = async () => {
    const targets = withMail.filter((x) => chosen.has(x.key));
    const p = { done: 0, tot: targets.length, ok: 0, ko: 0, log: [] }; setProg({ ...p });
    for (const x of targets) {
      try {
        const sim = pianoOf(net, x); const { doc, filename } = pdfPianoDisponibilita(x, sim, pianoText(x, sim));
        const r = await api.post('/comms/invia', { kind: 'PIANO_DISPONIBILITA', to: [x.email], subject, body: pianoText(x, sim), attachment: { filename, base64: pdfBase64(doc) } });
        if (r.status === 'INVIATA') p.ok++; else { p.ko++; p.log.push(`${x.nome}: ${r.status === 'NON_CONFIGURATA' ? 'invio non configurato (registrata)' : r.error || r.status}`); }
      } catch (e) { p.ko++; p.log.push(`${x.nome}: ${e.message}`); }
      p.done++; setProg({ ...p });
    }
    toast(p.ko ? `Inviate ${p.ok}, non riuscite ${p.ko}` : `Inviate ${p.ok} email`, p.ko ? 'err' : undefined);
  };
  const n = withMail.filter((x) => chosen.has(x.key)).length;
  return (
    <Modal title="Invio massivo del piano delle disponibilità" onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>{prog && prog.done === prog.tot ? 'Chiudi' : 'Annulla'}</button><button className="btn" disabled={!n || confirm !== 'INVIA' || (prog && prog.done < prog.tot)} onClick={run}>{prog ? `${prog.done}/${prog.tot}` : `Invia ${n} email`}</button></>}>
      {status && !status.configured && <div className="alert err" style={{ marginBottom: 10 }}>L'invio email non è configurato (GRAPH_SENDER e permesso Mail.Send): i messaggi verrebbero solo registrati, non spediti.</div>}
      <div className="alert info" style={{ marginBottom: 10 }}>Ambito dell'invio: <b>{ambito}</b> · {list.length} professionisti, di cui {withMail.length} con email.</div>
      <p className="small muted" style={{ marginTop: 0 }}>Ogni professionista selezionato riceve una email personale con in allegato il proprio PDF: impegni già in calendario con noi e spazi liberi compatibili nelle nostre strutture. Nulla parte finché non confermi qui sotto. Professionisti senza email: {list.length - withMail.length} (si inseriscono dalla scheda del professionista).</p>
      <Field label="Oggetto"><input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
      <div className="row" style={{ margin: '8px 0' }}><button className="btn sm ghost" onClick={() => setChosen(new Set(withMail.map((x) => x.key)))}>Seleziona tutti</button><button className="btn sm ghost" onClick={() => setChosen(new Set())}>Nessuno</button><span className="small muted">{n} selezionati su {withMail.length} con email</span></div>
      <div className="table-wrap" style={{ maxHeight: 300, overflow: 'auto' }}><table className="t"><thead><tr><th /><th>Professionista</th><th>Attività</th><th>Email</th><th className="num">Ore/sett.</th></tr></thead>
        <tbody>{withMail.map((x) => <tr key={x.key}><td><input type="checkbox" checked={chosen.has(x.key)} onChange={() => toggle(x.key)} /></td><td className="strong">{x.nome}</td><td className="small">{x.discipline.join(', ') || x.profili.join(', ')}</td><td className="small">{x.email}</td><td className="num">{durTxt(x.ore)}</td></tr>)}</tbody></table></div>
      {prog && <div className="alert info" style={{ marginTop: 10 }}>Inviate {prog.ok} · non riuscite {prog.ko} · {prog.done}/{prog.tot}{prog.log.length ? <ul>{prog.log.map((l, i) => <li key={i}>{l}</li>)}</ul> : null}</div>}
      {!prog && <Field label={`Per confermare l'invio a ${n} professionisti scrivi INVIA`}><input value={confirm} onChange={(e) => setConfirm(e.target.value.toUpperCase())} style={{ width: 160 }} /></Field>}
    </Modal>
  );
}

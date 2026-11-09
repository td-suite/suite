// TuoTempo, Fase 1 (CEO, 09/11/2026: "Le sedi sono sedi, su Retail, ovunque. E devono quadrare con TuoTempo"). Componenti condivisi tra
// Retail > Connettori e Amministrazione (Sedi e Persone): stessi dati e stesse API del modulo Retail (/api/retail/tuotempo/*, lib/tuotempo.js).
//   - AreeTuotempo: tabella "Aree TuoTempo" con titolo, indirizzo, città, telefono, visibilità online, sede TD proposta e le azioni
//     "Abbina a <sede>", "Scegli sede", "Crea la sede", "Non nostra / ignora", differenze con l'anagrafica e "Copia da TuoTempo";
//   - RiepilogoAree: la riga "13 aree, 4 abbinate, 9 da abbinare" con il link alla tabella;
//   - RisorseTuotempo: tabella "Risorse TuoTempo" con la persona proposta (email, poi nome) e la conferma.
// Le scritture passano dalle funzioni del core (saveSite per le sedi, legacy_refs con audit per le persone).
import React, { useState } from 'react';
import { api } from '../api.js';
import { useApi, Card, Badge, Modal, ErrorBox, Empty, Field, Loading, useToast } from './ui.jsx';
import { Icon } from './Icons.jsx';

const KIND = { PUNTO_PRELIEVI: 'Punto prelievi', CENTRO_MEDICO: 'Centro medico', CENTRO_DIAGNOSTICO: 'Centro diagnostico', POLIAMBULATORIO: 'Poliambulatorio' };
const CAMPO = { indirizzo: 'Indirizzo', cap: 'CAP', citta: 'Città', telefono: 'Telefono', orari: 'Orari' };
const STATO = { ABBINATA: ['teal', 'abbinata'], PROPOSTA: ['mauve', 'proposta'], DA_ABBINARE: ['amber', 'da abbinare'], IGNORATA: ['grey', 'non nostra'] };
const dt = (d) => (d ? new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }) : '–');

/** Riepilogo "N aree, X abbinate, Y da abbinare" (al posto del vecchio messaggio rosso "aree senza sede"). */
export function RiepilogoAree({ r, href = '#aree-tuotempo' }) {
  if (!r) return null;
  return (
    <span data-testid="riepilogo-aree">{r.aree} {r.aree === 1 ? 'area' : 'aree'}, {r.abbinate} {r.abbinate === 1 ? 'abbinata' : 'abbinate'}, {r.da_abbinare} da abbinare{r.ignorate ? `, ${r.ignorate} ${r.ignorate === 1 ? 'non nostra' : 'non nostre'}` : ''}
      {r.con_differenze ? `, ${r.con_differenze} con dati diversi` : ''} · <a href={href}>vai alla tabella Aree TuoTempo</a></span>
  );
}

export function AreeTuotempo({ puoScrivere = true, titolo = 'Aree TuoTempo', onChange }) {
  const toast = useToast();
  const q = useApi('/retail/tuotempo/aree');
  const [scegli, setScegli] = useState(null);
  const [crea, setCrea] = useState(null);
  const [copia, setCopia] = useState(null);
  const [busy, setBusy] = useState(false);
  const d = q.data;
  const run = async (fn, ok) => { setBusy(true); try { const r = await fn(); toast(typeof ok === 'function' ? ok(r) : ok); q.reload(); onChange?.(); } catch (e) { toast(e, 'err'); } finally { setBusy(false); } };
  const abbina = (a, siteId) => run(() => api.post(`/retail/tuotempo/aree/${encodeURIComponent(a.areaid)}/abbina`, { site_id: siteId }), 'Area abbinata alla sede');
  const ignora = (a, ignorata) => run(() => api.post(`/retail/tuotempo/aree/${encodeURIComponent(a.areaid)}/ignora`, { ignorata }), ignorata ? 'Area segnata "non nostra"' : 'Area ripresa tra quelle da abbinare');
  const scollega = (a) => window.confirm(`Togliere l'abbinamento dell'area "${a.titolo}" dalla sede ${a.sede?.code}? La sede resta com'è.`) && run(() => api.post(`/retail/tuotempo/aree/${encodeURIComponent(a.areaid)}/scollega`, {}), 'Abbinamento tolto');
  const allinea = () => run(() => api.post('/retail/tuotempo/allinea', {}), (r) => r.message || 'Allineamento eseguito');
  return (
    <Card id="aree-tuotempo" title={titolo} flush actions={<><span className="small muted">{d?.riepilogo?.ultimo_allineamento ? `ultimo allineamento ${dt(d.riepilogo.ultimo_allineamento)}` : 'mai allineato'}</span><button className="btn sm ghost" disabled={busy} onClick={allinea} data-testid="allinea-adesso"><Icon name="refresh" />Allinea adesso</button></>}>
      <ErrorBox error={q.error} />
      {!d ? <Loading /> : !d.righe.length ? <Empty title="Nessuna area: esegui &quot;Allinea adesso&quot; (connettore TuoTempo in Amministrazione > Connettori)" /> : <>
        <div className="small" style={{ padding: '8px 14px' }}><RiepilogoAree r={d.riepilogo} href="#aree-tuotempo" /></div>
        <div className="table-wrap"><table className="t" data-testid="tabella-aree">
          <thead><tr><th>Area TuoTempo</th><th>Indirizzo</th><th>Telefono</th><th>Online</th><th>Sede TD</th><th>Differenze con l'anagrafica</th><th /></tr></thead>
          <tbody>{d.righe.map((a) => {
            const [tone, label] = STATO[a.stato];
            return (
              <tr key={a.areaid} style={a.is_hidden || !a.presente || a.stato === 'IGNORATA' ? { opacity: 0.55 } : undefined} data-area={a.areaid}>
                <td><div className="strong">{a.titolo || a.areaid}</div><div className="small muted mono">{a.areaid}{a.legacyid ? ` · legacyid ${a.legacyid}` : ''}</div>{!a.presente && <Badge tone="red">non più su TuoTempo</Badge>}</td>
                <td className="small">{a.indirizzo}<div className="muted">{[a.cap, a.citta, a.provincia && `(${a.provincia})`].filter(Boolean).join(' ')}</div></td>
                <td className="small">{a.telefono || <span className="muted">–</span>}</td>
                <td className="small">{a.is_hidden ? <Badge tone="grey">nascosta</Badge> : <Badge tone="green">visibile</Badge>}{a.n_attivita ? <div className="muted">{a.n_attivita} prestazioni</div> : null}</td>
                <td className="small"><Badge tone={tone}>{label}</Badge>
                  {a.sede && <div><b>{a.sede.code}</b> {a.sede.name}{a.stato === 'PROPOSTA' && a.metodo_label && <div className="muted">per {a.metodo_label}{a.punteggio ? ` (${Math.round(a.punteggio * 100)}%)` : ''}</div>}</div>}
                  {a.stato === 'IGNORATA' && a.ignorata_nota && <div className="muted">{a.ignorata_nota}</div>}</td>
                <td className="small">{a.stato !== 'ABBINATA' ? <span className="muted">–</span> : a.differenze.length ? <>
                  {a.differenze.map((x) => <div key={x.campo}><b>{CAMPO[x.campo]}</b>: TuoTempo "{x.tuotempo || '–'}" · anagrafica "{x.anagrafica || '–'}"</div>)}
                  {puoScrivere && <button className="btn sm ghost" style={{ marginTop: 4 }} onClick={() => setCopia(a)} data-testid={`copia-${a.areaid}`}>Copia da TuoTempo</button>}</>
                  : <Badge tone="green">dati uguali</Badge>}{a.stato === 'ABBINATA' && a.orari_non_interpretabili && <div className="muted">orari di TuoTempo non interpretabili: "{a.opening_hrs}"</div>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{puoScrivere && <div style={{ display: 'grid', gap: 4 }}>
                  {a.stato === 'PROPOSTA' && <button className="btn sm" disabled={busy} onClick={() => abbina(a, a.sede.id)} data-testid={`abbina-${a.areaid}`}>Abbina a {a.sede.code}</button>}
                  {a.stato !== 'ABBINATA' && <button className="btn sm ghost" disabled={busy} onClick={() => setScegli(a)}>Scegli sede</button>}
                  {a.stato !== 'ABBINATA' && <button className="btn sm ghost" disabled={busy} onClick={() => setCrea(a)} data-testid={`crea-${a.areaid}`}>Crea la sede</button>}
                  {a.stato !== 'ABBINATA' && (a.stato === 'IGNORATA' ? <button className="btn sm ghost" disabled={busy} onClick={() => ignora(a, false)}>Riprendi</button> : <button className="btn sm ghost" disabled={busy} onClick={() => ignora(a, true)} data-testid={`ignora-${a.areaid}`}>Non nostra / ignora</button>)}
                  {a.stato === 'ABBINATA' && <button className="btn sm ghost" disabled={busy} onClick={() => scollega(a)}>Scollega</button>}
                </div>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </>}
      {scegli && <ScegliSede area={scegli} sedi={d.sedi} onClose={() => setScegli(null)} onScegli={(id) => { const a = scegli; setScegli(null); abbina(a, id); }} />}
      {crea && <CreaSede area={crea} tipi={d.tipi} onClose={() => setCrea(null)} onDone={() => { setCrea(null); q.reload(); onChange?.(); }} />}
      {copia && <CopiaDaTuotempo area={copia} onClose={() => setCopia(null)} onDone={() => { setCopia(null); q.reload(); onChange?.(); }} />}
    </Card>
  );
}

function ScegliSede({ area, sedi, onClose, onScegli }) {
  const [id, setId] = useState('');
  const [f, setF] = useState('');
  const norm = (x) => String(x || '').toLowerCase();
  const libere = sedi.filter((s) => !s.areaid && (!f || norm(`${s.code} ${s.name} ${s.city}`).includes(norm(f))));
  return (
    <Modal title={`Scegli la sede per "${area.titolo}"`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={!id} onClick={() => onScegli(Number(id))}>Abbina</button></>}>
      <p className="small muted">{[area.indirizzo, area.cap, area.citta].filter(Boolean).join(' ')}</p>
      <Field label="Filtra"><input value={f} onChange={(e) => setF(e.target.value)} placeholder="codice, nome o città" autoFocus /></Field>
      <Field label="Sede TD (non ancora abbinata)"><select value={id} onChange={(e) => setId(e.target.value)} size={Math.min(10, libere.length + 1)}><option value="">Scegli…</option>{libere.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}{s.city ? ` · ${s.city}` : ''}{s.active ? '' : ' (in apertura)'}</option>)}</select></Field>
      {!libere.length && <p className="small muted">Nessuna sede libera: crea la sede dall'area oppure scollega l'area da un'altra sede.</p>}
    </Modal>
  );
}

// "Crea la sede": saveSite del core con i dati dell'area; codice e tipo li sceglie l'utente (proposto il legacyid)
function CreaSede({ area, tipi, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ code: area.legacyid || '', kind: 'PUNTO_PRELIEVI', name: area.titolo || '' });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.post(`/retail/tuotempo/aree/${encodeURIComponent(area.areaid)}/crea-sede`, f); toast(`Sede ${r.code} creata in Amministrazione > Sedi`); if (r.avvisi?.length) toast(r.avvisi.join(' · '), 'warn'); onDone(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Crea la sede dall'area "${area.titolo}"`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy || f.code.trim().length < 2} onClick={go} data-testid="crea-sede-conferma">Crea la sede</button></>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="Codice della sede" required><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="es. PP-LIV" data-testid="crea-sede-codice" /></Field>
        <Field label="Tipo"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} data-testid="crea-sede-tipo">{tipi.map((k) => <option key={k} value={k}>{KIND[k] || k}</option>)}</select></Field>
        <Field label="Nome" className="span2"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>Dall'area: indirizzo {[area.indirizzo, area.cap, area.citta, area.provincia].filter(Boolean).join(' ') || '–'}, telefono {area.telefono || '–'}, coordinate, orari {area.orari_norm ? `"${area.orari_norm}"` : area.opening_hrs ? '(non interpretabili: da inserire a mano)' : '(non pubblicati)'}. Legal entity: Toscana Diagnostica (Dati aziendali). La sede nasce in Amministrazione &gt; Sedi, attiva, abbinata a questa area.</p>
    </Modal>
  );
}

// "Copia da TuoTempo": scelta dei dati da portare nella sede, con conferma esplicita
function CopiaDaTuotempo({ area, onClose, onDone }) {
  const toast = useToast();
  const disponibili = [...new Set(area.differenze.map((x) => (['cap', 'citta'].includes(x.campo) ? 'indirizzo' : x.campo)))];
  const [campi, setCampi] = useState(disponibili);
  const [conf, setConf] = useState('');
  const [err, setErr] = useState(null);
  const go = async () => {
    setErr(null);
    try { const r = await api.post(`/retail/tuotempo/sedi/${area.sede.id}/copia`, { campi, conferma: 'COPIA' }); toast(`Copiato da TuoTempo: ${r.copiati.join(', ')}`); if (r.non_copiati?.length) toast(r.non_copiati.join('; '), 'warn'); onDone(); }
    catch (e) { setErr(e); }
  };
  return (
    <Modal title={`Copia da TuoTempo · ${area.sede.code} ${area.sede.name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={!campi.length || conf !== 'COPIA'} onClick={go} data-testid="copia-conferma">Copia nella sede</button></>}>
      <ErrorBox error={err} />
      {area.differenze.map((x) => <div key={x.campo} className="small"><b>{CAMPO[x.campo]}</b>: anagrafica "{x.anagrafica || '–'}" → TuoTempo "{x.tuotempo || '–'}"</div>)}
      <div style={{ margin: '10px 0', display: 'grid', gap: 4 }}>{disponibili.map((c) => <label key={c} className="row small" style={{ gap: 6 }}><input type="checkbox" checked={campi.includes(c)} onChange={(e) => setCampi(e.target.checked ? [...campi, c] : campi.filter((y) => y !== c))} />{c === 'indirizzo' ? 'Indirizzo, CAP e città' : CAMPO[c]}</label>)}</div>
      <Field label="Per confermare scrivi COPIA"><input value={conf} onChange={(e) => setConf(e.target.value)} data-testid="copia-testo" /></Field>
      <p className="small muted">Il dato di TuoTempo sostituisce quello di Amministrazione &gt; Sedi (saveSite, con audit). TuoTempo non viene modificato.</p>
    </Modal>
  );
}

export function RisorseTuotempo({ puoScrivere = true, soloDaAbbinare = false }) {
  const toast = useToast();
  const q = useApi('/retail/tuotempo/risorse');
  const persone = useApi(puoScrivere ? '/people?status=ATTIVO' : null);
  const [scegli, setScegli] = useState(null);
  const [busy, setBusy] = useState(false);
  const d = q.data;
  const run = async (fn, ok) => { setBusy(true); try { await fn(); toast(ok); q.reload(); } catch (e) { toast(e, 'err'); } finally { setBusy(false); } };
  const conferma = (r, personId) => run(() => api.post(`/retail/tuotempo/risorse/${encodeURIComponent(r.resourceid)}/conferma`, { person_id: personId }), 'Risorsa abbinata alla persona');
  const scollega = (r) => run(() => api.post(`/retail/tuotempo/risorse/${encodeURIComponent(r.resourceid)}/scollega`, {}), 'Abbinamento tolto');
  const righe = (d?.righe || []).filter((r) => r.presente && (!soloDaAbbinare || ['PROPOSTA', 'DA_ABBINARE'].includes(r.stato)));
  return (
    <Card id="risorse-tuotempo" title="Risorse TuoTempo" flush actions={d && <span className="small muted">{d.riepilogo.persone} persone · {d.riepilogo.abbinate} abbinate · {d.riepilogo.proposte} proposte · {d.riepilogo.da_abbinare} da abbinare · {d.riepilogo.macchine} macchine</span>}>
      <ErrorBox error={q.error} />
      {!d ? <Loading /> : !righe.length ? <Empty compact title={soloDaAbbinare ? 'Nessuna risorsa TuoTempo da abbinare' : 'Nessuna risorsa: esegui "Allinea adesso"'} /> : <div className="table-wrap"><table className="t" data-testid="tabella-risorse">
        <thead><tr><th>Risorsa</th><th>Contatti</th><th>Aree</th><th>Stato TuoTempo</th><th>Soddisfazione</th><th>Persona in anagrafica</th><th /></tr></thead>
        <tbody>{righe.map((r) => <tr key={r.resourceid} style={r.is_hidden || r.status !== 'a' ? { opacity: 0.6 } : undefined}>
          <td><div className="strong">{r.name}</div><div className="small muted mono">{r.resourceid}{r.is_machine ? ' · macchina' : ''}</div></td>
          <td className="small">{r.email || <span className="muted">–</span>}{r.phone && <div className="muted">{r.phone}</div>}</td>
          <td className="small">{r.aree_nomi || <span className="muted">–</span>}</td>
          <td className="small">{r.status === 'a' ? <Badge tone="green">attiva</Badge> : <Badge tone="grey">{r.status || '–'}</Badge>}{r.is_hidden && <div className="muted">nascosta online</div>}</td>
          <td className="small">{r.satisfaction != null ? Number(r.satisfaction).toLocaleString('it-IT') : <span className="muted">–</span>}</td>
          <td className="small">{r.stato === 'MACCHINA' ? <span className="muted">macchina (nessuna persona)</span> : r.stato === 'ABBINATA' ? <><Badge tone="teal">abbinata</Badge> {r.persona_nome}</> : r.stato === 'PROPOSTA' ? <><Badge tone="mauve">proposta</Badge> {r.proposta_nome} <span className="muted">per {r.proposta_come === 'EMAIL' ? 'email' : 'nome'}</span></> : <Badge tone="amber">da abbinare</Badge>}</td>
          <td style={{ whiteSpace: 'nowrap' }}>{puoScrivere && r.stato !== 'MACCHINA' && <>
            {r.stato === 'PROPOSTA' && <button className="btn sm" disabled={busy} onClick={() => conferma(r, r.proposta_person_id)} data-testid={`conferma-${r.resourceid}`}>Conferma</button>}
            {r.stato !== 'ABBINATA' && <button className="btn sm ghost" disabled={busy} style={{ marginLeft: 4 }} onClick={() => setScegli(r)}>Scegli persona</button>}
            {r.stato === 'ABBINATA' && <button className="btn sm ghost" disabled={busy} onClick={() => scollega(r)}>Scollega</button>}
          </>}</td>
        </tr>)}</tbody>
      </table></div>}
      {scegli && <ScegliPersona risorsa={scegli} persone={persone.data || []} onClose={() => setScegli(null)} onScegli={(id) => { const r = scegli; setScegli(null); conferma(r, id); }} />}
    </Card>
  );
}

function ScegliPersona({ risorsa, persone, onClose, onScegli }) {
  const [id, setId] = useState('');
  const [f, setF] = useState('');
  const norm = (x) => String(x || '').toLowerCase();
  const el = persone.filter((p) => !f || norm(`${p.last_name} ${p.first_name} ${p.email || ''}`).includes(norm(f))).slice(0, 200);
  return (
    <Modal title={`Persona per la risorsa "${risorsa.name}"`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={!id} onClick={() => onScegli(Number(id))}>Abbina</button></>}>
      <Field label="Cerca"><input value={f} onChange={(e) => setF(e.target.value)} placeholder="cognome, nome o email" autoFocus /></Field>
      <Field label="Persona (Amministrazione > Persone)"><select value={id} onChange={(e) => setId(e.target.value)} size={Math.min(10, el.length + 1)}><option value="">Scegli…</option>{el.map((p) => <option key={p.id} value={p.id}>{p.last_name} {p.first_name}{p.email ? ` · ${p.email}` : ''}</option>)}</select></Field>
    </Modal>
  );
}

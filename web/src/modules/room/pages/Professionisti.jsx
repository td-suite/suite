import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiBase } from '../api.js';
import { useApi, Loading, ErrorBox, Modal, Badge, Field, useToast, Card } from '../components/ui.jsx';
import { itDateTime } from '../format.js';
import { sedeLabel } from './Sedi.jsx';
import { RAPPORTO, REGIME, DOC_LABEL, DAYS, itD, eur } from '../lib/personale.js';
import { DISC, EQUIP } from '../planner/planner.jsx';

const DISCIPLINE = (Array.isArray(DISC) ? DISC : Object.keys(DISC || {})).map((d) => (typeof d === 'string' ? d : d.n || d.nome || String(d)));
const ATTREZZ = (Array.isArray(EQUIP) ? EQUIP : Object.keys(EQUIP || {})).map((d) => (typeof d === 'string' ? d : d.n || d.nome || String(d)));
const TABS = [['anagrafica', 'Anagrafica'], ['professionale', 'Professionale'], ['contratto', 'Contratto e assicurazione'], ['compenso', 'Compenso'], ['documenti', 'Documenti'], ['accesso', 'Accesso'], ['disponibilita', 'Disponibilità']];
// Scheda Room vuota: le persone vivono nell'anagrafica unica della Suite (public.people), qui si compilano solo i dati operativi
const empty = (tipo = 'sanitario') => ({ tipo, profilo: tipo === 'medico' ? 'Medico' : 'Infermiere', dati: { anagrafica: {}, professionale: { discipline: [], attrezzature: [], specializzazioni: [] }, contratto: { rapporto: 'LP' }, assicurazione: {}, compenso: { tipo: 'ORARIO', eccezioniSede: [], regime: 'FORFETTARIO' }, sediAbilitate: [], note: '' } });
const KIND = { MEDICO: 'Medico', SANITARIO: 'Professionista sanitario', LP: 'Libero professionista', DIPENDENTE: 'Dipendente', ESTERNO: 'Esterno', DIRIGENTE: 'Dirigente' };
const STATUS = { ATTIVO: ['Attivo', 'green'], IMPEGNO: ['In impegno', 'teal'], CANDIDATO: ['Candidato', 'amber'], CESSATO: ['Cessato', 'red'] };
export const personaHref = (id) => `/people/${id}`;

export default function Professionisti() {
  const toast = useToast();
  const { data, error, reload } = useApi('/personale/professionisti');
  const sedi = useApi('/strutture');
  const opz = useApi('/personale/professionisti/opzioni');
  const [q, setQ] = useState(''); const [tipo, setTipo] = useState('tutti'); const [soloAttivi, setSoloAttivi] = useState(true); const [soloRoom, setSoloRoom] = useState(true);
  const [sel, setSel] = useState(null);
  const list = useMemo(() => (data || []).filter((p) => (!soloAttivi || p.attivo) && (!soloRoom || p.inRoom) && (tipo === 'tutti' || p.tipo === tipo) && (!q || `${p.nome} ${p.profilo || ''} ${p.email || ''}`.toLowerCase().includes(q.toLowerCase()))), [data, q, tipo, soloAttivi, soloRoom]);
  const importa = async () => {
    try { const r = await api.post('/personale/professionisti/importa-da-sedi'); toast(r.created ? `Create ${r.created} schede Room per il personale sanitario delle sedi` : 'Il personale sanitario delle sedi presente in anagrafica ha già la scheda Room'); if (r.nonCensiti?.length) toast(`Non in anagrafica (da creare in Amministrazione > Persone): ${r.nonCensiti.join(', ')}`, 'err'); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const scad = (p) => p.prossimaScadenza && p.prossimaScadenza < new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Professionisti</h1><div className="sub">Persone dell'anagrafica unica della Suite con la scheda Room Planning: contratto, compenso, competenze, documenti, accesso al portale e disponibilità. Nome, contatti e stato si modificano in Rubrica o in Contratti del personale; chi è pianificabile si decide in "Tutti i professionisti".</div></div>
        <div className="row"><button className="btn ghost" onClick={importa} title="Crea la scheda Room per il personale sanitario censito nelle sedi e già presente in anagrafica; segnala chi manca">Collega i sanitari delle sedi</button><Link className="btn" to="/people">Apri in Amministrazione</Link></div></div>
      <ErrorBox error={error} />
      {!data || !sedi.data ? <Loading /> : (
        <div className="spec-layout">
          <div className="card spec-list">
            <div className="bd" style={{ padding: 12, borderBottom: '1px solid var(--line)' }}>
              <input placeholder="Cerca nome, profilo, email…" value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="seg" style={{ marginTop: 8 }}>{[['tutti', 'Tutti'], ['medico', 'Medici'], ['sanitario', 'Sanitari']].map(([k, l]) => <button key={k} className={tipo === k ? 'on' : ''} onClick={() => setTipo(k)}>{l}</button>)}</div>
              <div className="row small" style={{ marginTop: 6, gap: 10 }}><label className="f inline small"><input type="checkbox" checked={soloAttivi} onChange={(e) => setSoloAttivi(e.target.checked)} />solo attivi</label><label className="f inline small" title="Spegni per vedere tutte le persone dell'anagrafica (qualunque tipo) e compilare una nuova scheda Room"><input type="checkbox" checked={soloRoom} onChange={(e) => setSoloRoom(e.target.checked)} />solo con scheda Room</label></div>
              <div className="small muted">{list.length} professionisti</div>
            </div>
            <div className="spec-items">{list.map((p) => (
              <button key={p.id} className={`spec-item ${sel === p.id ? 'on' : ''}`} onClick={() => setSel(p.id)}>
                <div className="strong">{p.nome}{!p.attivo && <Badge>non attivo</Badge>}{!p.inRoom && <Badge tone="amber">senza scheda Room</Badge>}{p.planningExcluded && <Badge tone="red">esclusa</Badge>}</div>
                <div className="small muted">{p.profilo || (p.tipo === 'medico' ? 'Medico' : 'Sanitario')}{p.discipline?.length ? ' · ' + p.discipline.join(', ') : ''}</div>
                <div className="small">{p.email ? <span>{p.email}</span> : <span className="red">senza email</span>}{p.userId ? <span> · <Badge tone="green">portale</Badge></span> : null}{scad(p) ? <span> · <Badge tone="amber">documento in scadenza</Badge></span> : null}</div>
              </button>))}</div>
          </div>
          <div style={{ minWidth: 0 }}>
            {!sel ? <div className="card"><div className="bd empty">Seleziona una persona. Per aggiungere un professionista nuovo: crealo in Amministrazione &gt; Persone (o in Contratti del personale), poi spegni "solo con scheda Room", aprilo e salva la scheda. "Collega i sanitari delle sedi" crea la scheda Room per il personale sanitario già censito nelle sedi.</div></div>
              : <Scheda key={sel} id={sel} sedi={sedi.data} opz={opz.data} toast={toast} reloadList={reload} onDeleted={() => { setSel(null); reload(); }} />}
          </div>
        </div>
      )}
    </div>
  );
}

const PROFILI_SAN = ['Infermiere', 'Tecnico di radiologia', 'Tecnico di laboratorio', 'Ostetrica', 'Fisioterapista', 'Biologo', 'Psicologo', 'Dietista', 'Logopedista', 'OSS', 'Altro'];
function ProfiloInput({ value, tipo, onChange }) {
  if (tipo === 'medico') return <input value={value || 'Medico'} onChange={(e) => onChange(e.target.value)} />;
  return <><input list="profili-san" value={value || ''} onChange={(e) => onChange(e.target.value)} /><datalist id="profili-san">{PROFILI_SAN.map((p) => <option key={p} value={p} />)}</datalist></>;
}

function Scheda({ id, sedi, opz, toast, reloadList, onDeleted }) {
  const [p, setP] = useState(null); const [orig, setOrig] = useState(null); const [tab, setTab] = useState('anagrafica'); const [busy, setBusy] = useState(false);
  const load = async () => { const r = await api.get(`/personale/professionisti/${id}`); const base = empty(r.tipo); const d = { ...base.dati, ...r.dati, anagrafica: { ...r.dati?.anagrafica }, professionale: { ...base.dati.professionale, ...r.dati?.professionale }, contratto: { ...base.dati.contratto, ...r.dati?.contratto }, assicurazione: { ...r.dati?.assicurazione }, compenso: { ...base.dati.compenso, ...r.dati?.compenso } }; const v = { ...r, dati: d }; setP(v); setOrig(JSON.stringify({ tipo: v.tipo, profilo: v.profilo, dati: v.dati })); };
  useEffect(() => { load().catch((e) => toast(e.message, 'err')); }, [id]);
  if (!p) return <Loading />;
  const payload = { tipo: p.tipo, profilo: p.profilo, dati: p.dati };
  const dirty = JSON.stringify(payload) !== orig;
  const set = (patch) => setP((x) => ({ ...x, ...patch }));
  const setD = (sec, patch) => setP((x) => ({ ...x, dati: { ...x.dati, [sec]: { ...(x.dati[sec] || {}), ...patch } } }));
  const save = async () => { setBusy(true); try { const r = await api.put(`/personale/professionisti/${id}`, payload); toast(r.sediAggiornate ? `Scheda salvata · aggiornata anche in ${r.sediAggiornate} ${r.sediAggiornate === 1 ? 'sede' : 'sedi'}` : 'Scheda Room salvata'); await load(); reloadList(); } catch (e) { toast(e.message, 'err'); } setBusy(false); };
  const pianificazione = async () => { setBusy(true); try { await api.put(`/personale/professionisti/${id}/pianificazione`, { excluded: !p.planning_excluded }); toast(p.planning_excluded ? 'Persona di nuovo pianificabile' : 'Persona esclusa dalla pianificazione'); await load(); reloadList(); } catch (e) { toast(e.message, 'err'); } setBusy(false); };
  const elimina = async () => { if (!window.confirm(`Rimuovere la scheda Room di ${p.nome} (compenso, contratto, documenti e disponibilità)? La persona resta nell'anagrafica della Suite e nelle schede di sede.`)) return; try { await api.del(`/personale/professionisti/${id}`); toast('Scheda Room rimossa'); onDeleted(); } catch (e) { toast(e.message, 'err'); } };
  const PR = p.dati.professionale, C = p.dati.contratto, AS = p.dati.assicurazione, CO = p.dati.compenso;
  const scadenzaCls = (d) => (d && d < new Date().toISOString().slice(0, 10) ? 'red' : d && d < new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10) ? 'amber' : '');
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="card"><div className="bd">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 18 }}>{p.nome} <Badge tone={p.tipo === 'medico' ? 'teal' : 'mauve'}>{p.profilo || p.tipo}</Badge> <Badge tone={STATUS[p.status]?.[1]}>{STATUS[p.status]?.[0] || p.status}</Badge> {!p.in_room && <Badge tone="amber">senza scheda Room</Badge>} {p.planning_excluded && <Badge tone="red">esclusa dalla pianificazione</Badge>}</h2>
            <div className="small muted">{KIND[p.kind] || p.kind}{p.discipline?.length ? ' · ' + p.discipline.join(', ') : ''} · {p.sediPresente?.length ? 'nelle schede di sede: ' + p.sediPresente.map((s) => s.label).join(', ') : 'non presente nelle schede di sede'}{p.updated_at ? ` · scheda Room aggiornata ${itDateTime(p.updated_at)}` : ''}</div>
          </div>
          <div className="row">{dirty && <span className="small amber">modifiche non salvate</span>}<Link className="btn ghost sm" to={personaHref(p.id)} title="Scheda della persona nell'anagrafica unica (nome, contatti, stato)">Apri in Rubrica</Link><button className="btn ghost sm" disabled={busy} onClick={pianificazione} title="Chi è escluso non compare nei selettori di turni, disponibilità, presenze e calendario">{p.planning_excluded ? 'Riporta tra i pianificabili' : 'Escludi dalla pianificazione'}</button>{p.in_room && <button className="btn ghost sm" style={{ color: 'var(--red)' }} onClick={elimina} title="Possibile solo senza turni, presenze, rendiconti o candidature collegati">Rimuovi scheda Room</button>}<button className="btn" disabled={!dirty || busy} onClick={save}>{busy ? 'Salvo…' : p.in_room ? 'Salva scheda' : 'Crea scheda Room'}</button></div>
        </div>
        <div className="seg" style={{ marginTop: 12, flexWrap: 'wrap' }}>{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      </div></div>

      {tab === 'anagrafica' && <><Card title="Anagrafica unica della Suite" actions={<Link className="btn sm ghost" to={personaHref(p.id)}>Apri in Rubrica</Link>}>
        <p className="small muted" style={{ marginTop: 0 }}>Questi dati vengono da Amministrazione &gt; Persone (o da Contratti del personale) e valgono per tutta la Suite: qui si consultano soltanto.</p>
        <div className="form-grid">
          <Ro label="Cognome" v={p.last_name} /><Ro label="Nome" v={p.first_name} /><Ro label="Titolo" v={p.title} /><Ro label="Tipo di persona" v={KIND[p.kind] || p.kind} />
          <Ro label="Stato" v={STATUS[p.status]?.[0] || p.status} /><Ro label="Sesso" v={p.sex} /><Ro label="Data di nascita" v={p.birth_date ? itD(p.birth_date) : ''} /><Ro label="Codice fiscale" v={p.tax_code} />
          <Ro label="Email (accesso al portale e invii)" v={p.email} /><Ro label="Telefono" v={p.phone} /><Ro label="Telefono ufficio" v={p.phone_office} /><Ro label="Disciplina" v={p.discipline?.join(', ')} />
          <Ro label="Sede di lavoro" v={p.site_name} /><Ro label="Ruolo" v={p.role_name} />
          <Ro label="Luogo di nascita" v={p.birth_place} /><Ro label="Partita IVA" v={p.vat_number} />
          <Ro label="Residenza" v={[p.address, [p.zip, p.city].filter(Boolean).join(' '), p.province && `(${p.province})`].filter(Boolean).join(', ')} />
        </div>
      </Card>
      <Card title="Scheda Room Planning" className="mt"><div className="form-grid">
        <Field label="Tipo in pianificazione" help="Medico (titolare di ambulatorio) o professionista sanitario (supporto, prelievi, tecnico)"><select value={p.tipo} onChange={(e) => set({ tipo: e.target.value, profilo: e.target.value === 'medico' ? 'Medico' : p.profilo === 'Medico' ? 'Infermiere' : p.profilo })}><option value="medico">Medico</option><option value="sanitario">Professionista sanitario</option></select></Field>
        <Field label="Profilo professionale" help="Riportato anche nelle schede di sede dove la persona compare"><ProfiloInput value={p.profilo} tipo={p.tipo} onChange={(v) => set({ profilo: v })} /></Field>
        <In p={p} setD={setD} sec="anagrafica" k="pec" label="PEC" type="email" />
        <In p={p} setD={setD} sec="anagrafica" k="iban" label="IBAN" /><In p={p} setD={setD} sec="anagrafica" k="intestatarioConto" label="Intestatario del conto" />
        <In p={p} setD={setD} sec="anagrafica" k="contattoEmergenza" label="Contatto di emergenza" />
      </div><Field label="Note operative"><textarea rows={3} value={p.dati.note || ''} onChange={(e) => setP({ ...p, dati: { ...p.dati, note: e.target.value } })} /></Field></Card></>}

      {tab === 'professionale' && <Card title="Profilo professionale">
        <div className="form-grid">
          <In p={p} setD={setD} sec="professionale" k="titoloStudio" label="Titolo di studio" /><In p={p} setD={setD} sec="professionale" k="annoLaurea" label="Anno di conseguimento" />
          <In p={p} setD={setD} sec="professionale" k="alboOrdine" label="Albo / Ordine (es. OMCeO, OPI, TSRM)" /><In p={p} setD={setD} sec="professionale" k="alboProvincia" label="Provincia dell'albo" /><In p={p} setD={setD} sec="professionale" k="alboNumero" label="Numero di iscrizione" /><In p={p} setD={setD} sec="professionale" k="alboData" label="Data di iscrizione" type="date" />
          <In p={p} setD={setD} sec="professionale" k="ecmCrediti" label="Crediti ECM (triennio corrente)" type="number" /><In p={p} setD={setD} sec="professionale" k="ecmTriennio" label="Triennio ECM" placeholder="2026-2028" />
          <In p={p} setD={setD} sec="professionale" k="anniEsperienza" label="Anni di esperienza" type="number" /><In p={p} setD={setD} sec="professionale" k="lingue" label="Lingue" />
        </div>
        <TagPicker label={`Discipline / specialità${p.discipline?.length && p.discipline[0] && !(PR.discipline || []).includes(p.discipline[0]) ? ` (dall'anagrafica: ${p.discipline[0]})` : ''}`} options={DISCIPLINE} value={PR.discipline || []} onChange={(v) => setD('professionale', { discipline: v })} />
        <TagPicker label="Specializzazioni e master (testo libero)" options={[]} value={PR.specializzazioni || []} onChange={(v) => setD('professionale', { specializzazioni: v })} />
        <TagPicker label="Competenze su attrezzature" options={ATTREZZ} value={PR.attrezzature || []} onChange={(v) => setD('professionale', { attrezzature: v })} />
        <TagPicker label="Altre competenze (es. prelievi pediatrici, ECG, BLSD)" options={['Prelievi', 'Prelievi pediatrici', 'ECG', 'Holter', 'BLSD', 'Medicazioni', 'Terapia infusionale', 'Vaccinazioni', 'Spirometria', 'Gestione accettazione']} value={PR.competenze || []} onChange={(v) => setD('professionale', { competenze: v })} />
        <SediPicker label="Sedi abilitate (dove può lavorare)" sedi={sedi} value={p.dati.sediAbilitate || []} onChange={(v) => setP({ ...p, dati: { ...p.dati, sediAbilitate: v } })} />
      </Card>}

      {tab === 'contratto' && <><Card title="Rapporto di collaborazione"><div className="form-grid">
        <Field label="Tipo di rapporto"><select value={C.rapporto || 'LP'} onChange={(e) => setD('contratto', { rapporto: e.target.value })}>{Object.entries(RAPPORTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <In p={p} setD={setD} sec="contratto" k="dal" label="Inizio collaborazione" type="date" /><In p={p} setD={setD} sec="contratto" k="al" label="Scadenza contratto (se a termine)" type="date" />
        <In p={p} setD={setD} sec="contratto" k="preavvisoGiorni" label="Preavviso (giorni)" type="number" /><In p={p} setD={setD} sec="contratto" k="oreSettimanaliPreviste" label="Ore settimanali previste" type="number" />
        <In p={p} setD={setD} sec="contratto" k="riferimentoContratto" label="Riferimento contratto / protocollo" /><In p={p} setD={setD} sec="contratto" k="societa" label="Società / cooperativa (se tramite terzi)" />
        <Field label="Privacy e consensi firmati"><select value={C.privacyFirmata ? '1' : '0'} onChange={(e) => setD('contratto', { privacyFirmata: e.target.value === '1' })}><option value="0">No</option><option value="1">Sì</option></select></Field>
        <In p={p} setD={setD} sec="contratto" k="privacyData" label="Data firma privacy" type="date" />
      </div><Field label="Note sul contratto"><textarea rows={2} value={C.note || ''} onChange={(e) => setD('contratto', { note: e.target.value })} /></Field></Card>
      <Card title="Assicurazione RC professionale" className="mt"><div className="form-grid">
        <In p={p} setD={setD} sec="assicurazione" k="compagnia" label="Compagnia" /><In p={p} setD={setD} sec="assicurazione" k="polizza" label="Numero polizza" /><In p={p} setD={setD} sec="assicurazione" k="massimale" label="Massimale (€)" type="number" />
        <Field label={<span className={scadenzaCls(AS.scadenza)}>Scadenza polizza</span>}><input type="date" value={AS.scadenza || ''} onChange={(e) => setD('assicurazione', { scadenza: e.target.value })} /></Field>
        <Field label="Copertura"><select value={AS.copertura || ''} onChange={(e) => setD('assicurazione', { copertura: e.target.value })}><option value="">—</option><option value="PROPRIA">Polizza propria del professionista</option><option value="STRUTTURA">Coperto dalla polizza della struttura</option><option value="ENTRAMBE">Entrambe</option></select></Field>
      </div></Card></>}

      {tab === 'compenso' && <Card title="Modalità di compenso">
        <div className="form-grid">
          <Field label="Tipo di compenso"><select value={CO.tipo || 'ORARIO'} onChange={(e) => setD('compenso', { tipo: e.target.value })}><option value="ORARIO">A ore</option><option value="FISSO">Fisso mensile</option></select></Field>
          {CO.tipo !== 'FISSO' ? <Field label="Tariffa oraria base (€/h)"><input type="number" step="0.01" min="0" value={CO.tariffaOraria ?? ''} onChange={(e) => setD('compenso', { tariffaOraria: e.target.value })} /></Field>
            : <Field label="Compenso fisso mensile (€)"><input type="number" step="0.01" min="0" value={CO.fissoMensile ?? ''} onChange={(e) => setD('compenso', { fissoMensile: e.target.value })} /></Field>}
          <Field label="Regime fiscale"><select value={CO.regime || ''} onChange={(e) => setD('compenso', { regime: e.target.value, ...(e.target.value === 'FORFETTARIO' ? { ivaPercent: 0, ritenutaAcconto: 0 } : e.target.value === 'ORDINARIO' ? { ivaPercent: 22, ritenutaAcconto: 20 } : {}) })}><option value="">—</option>{Object.entries(REGIME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Cassa previdenziale (%)" help="ENPAM 2% / ENPAPI 4% / INPS gestione separata 4%"><input type="number" step="0.01" value={CO.cassaPrevidenziale ?? ''} onChange={(e) => setD('compenso', { cassaPrevidenziale: e.target.value })} /></Field>
          <Field label="IVA (%)"><input type="number" step="0.01" value={CO.ivaPercent ?? ''} onChange={(e) => setD('compenso', { ivaPercent: e.target.value })} /></Field>
          <Field label="Ritenuta d'acconto (%)"><input type="number" step="0.01" value={CO.ritenutaAcconto ?? ''} onChange={(e) => setD('compenso', { ritenutaAcconto: e.target.value })} /></Field>
          <Field label="Rimborso chilometrico (€/km)"><input type="number" step="0.01" value={CO.rimborsoKm ?? ''} onChange={(e) => setD('compenso', { rimborsoKm: e.target.value })} /></Field>
          <Field label="Giorno di pagamento previsto"><input value={CO.pagamento || ''} placeholder="es. 30 giorni data fattura" onChange={(e) => setD('compenso', { pagamento: e.target.value })} /></Field>
        </div>
        {CO.tipo !== 'FISSO' && <div style={{ marginTop: 12 }}>
          <div className="row"><b>Tariffe diverse per sede</b><span className="small muted">(se vuoto vale la tariffa base)</span><span className="spacer" /><button className="btn sm ghost" onClick={() => setD('compenso', { eccezioniSede: [...(CO.eccezioniSede || []), { sedeId: sedi[0]?.id, tariffaOraria: '' }] })}>+ eccezione</button></div>
          {(CO.eccezioniSede || []).map((e, i) => <div key={i} className="row" style={{ marginTop: 6 }}>
            <select value={e.sedeId} onChange={(ev) => setD('compenso', { eccezioniSede: CO.eccezioniSede.map((x, j) => (j === i ? { ...x, sedeId: Number(ev.target.value) } : x)) })} style={{ width: 320 }}>{sedi.map((s) => <option key={s.id} value={s.id}>{sedeLabel(s)}</option>)}</select>
            <input type="number" step="0.01" value={e.tariffaOraria} placeholder="€/h" style={{ width: 120 }} onChange={(ev) => setD('compenso', { eccezioniSede: CO.eccezioniSede.map((x, j) => (j === i ? { ...x, tariffaOraria: ev.target.value } : x)) })} />
            <button className="btn sm ghost" onClick={() => setD('compenso', { eccezioniSede: CO.eccezioniSede.filter((_, j) => j !== i) })}>×</button></div>)}
        </div>}
        <Field label="Note sul compenso" className="mt"><textarea rows={2} value={CO.note || ''} onChange={(e) => setD('compenso', { note: e.target.value })} /></Field>
        <p className="small muted">Il rendiconto mensile moltiplica le ore delle presenze confermate dai gestori di sede per la tariffa (base o della sede); con il fisso mensile le presenze restano registrate ma l'importo è il fisso. Gli oneri (cassa, IVA, ritenuta) sono calcolati a titolo indicativo per la fattura.</p>
      </Card>}

      {tab === 'documenti' && <Documenti p={p} opz={opz} toast={toast} reload={load} />}
      {tab === 'accesso' && <Accesso p={p} />}
      {tab === 'disponibilita' && <DisponibilitaProf profId={p.id} sedi={sedi} toast={toast} />}
    </div>
  );
}

function In({ p, setD, sec, k, label, type = 'text', ...rest }) { return <Field label={label}><input type={type} value={(p.dati[sec] || {})[k] ?? ''} onChange={(e) => setD(sec, { [k]: e.target.value })} {...rest} /></Field>; }
function Ro({ label, v }) { return <Field label={label}><input value={v || ''} readOnly title="Dato dell'anagrafica unica: si modifica in Amministrazione > Persone" style={{ background: 'var(--teal-050, #eef5f6)', cursor: 'default' }} placeholder="—" /></Field>; }

function TagPicker({ label, options, value, onChange }) {
  const [txt, setTxt] = useState('');
  const add = (v) => { v = v.trim(); if (v && !value.includes(v)) onChange([...value, v]); setTxt(''); };
  return (
    <Field label={label} className="mt">
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {value.map((v) => <span key={v} className="chip">{v} <button className="iconbtn" style={{ fontSize: 11 }} onClick={() => onChange(value.filter((x) => x !== v))}>✕</button></span>)}
        <input list={options.length ? `opt-${label}` : undefined} value={txt} placeholder="aggiungi e premi Invio" style={{ width: 260 }} onChange={(e) => setTxt(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(txt); } }} onBlur={() => txt && add(txt)} />
        {options.length > 0 && <datalist id={`opt-${label}`}>{options.filter((o) => !value.includes(o)).map((o) => <option key={o} value={o} />)}</datalist>}
      </div>
    </Field>
  );
}
function SediPicker({ label, sedi, value, onChange }) {
  return (
    <Field label={label} className="mt"><div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
      {sedi.map((s) => <label key={s.id} className="f inline"><input type="checkbox" checked={value.includes(s.id)} onChange={(e) => onChange(e.target.checked ? [...value, s.id] : value.filter((x) => x !== s.id))} />{sedeLabel(s)}</label>)}
      <span className="small muted">(nessuna selezione = tutte)</span></div></Field>
  );
}

function Documenti({ p, opz, toast, reload }) {
  const [f, setF] = useState({ tipo: 'CV', scadenza: '', note: '' });
  const upload = (e) => {
    const file = e.target.files[0]; if (!file) return; if (file.size > 8 * 1024 * 1024) { toast('File troppo grande (max 8 MB)', 'err'); return; }
    const fr = new FileReader();
    fr.onload = async () => { try { await api.post(`/personale/professionisti/${p.id}/docs`, { tipo: f.tipo, nome: file.name, mime: file.type || 'application/octet-stream', base64: String(fr.result).split(',')[1], scadenza: f.scadenza || null, note: f.note || null }); toast('Documento caricato'); reload(); } catch (e2) { toast(e2.message, 'err'); } };
    fr.readAsDataURL(file); e.target.value = '';
  };
  const del = async (d) => { if (!window.confirm(`Eliminare "${d.nome}"?`)) return; try { await api.del(`/personale/professionisti/${p.id}/docs/${d.id}`); reload(); } catch (e) { toast(e.message, 'err'); } };
  const today = new Date().toISOString().slice(0, 10), soon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  return (
    <Card title="Documenti" actions={<div className="row">
      <select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })} style={{ width: 'auto' }}>{(opz?.docTipi || Object.keys(DOC_LABEL)).map((t) => <option key={t} value={t}>{DOC_LABEL[t] || t}</option>)}</select>
      <input type="date" value={f.scadenza} title="Scadenza (opzionale)" onChange={(e) => setF({ ...f, scadenza: e.target.value })} style={{ width: 'auto' }} />
      <label className="btn sm" style={{ cursor: 'pointer' }}>Carica file…<input type="file" style={{ display: 'none' }} onChange={upload} /></label></div>}>
      {!p.docs?.length ? <div className="empty">Nessun documento. Carica CV, documento d'identità, iscrizione all'albo, polizza RC, titoli, contratto e consensi privacy, con la scadenza dove serve.</div> : (
        <div className="table-wrap"><table className="t"><thead><tr><th>Tipo</th><th>File</th><th>Scadenza</th><th>Caricato</th><th>Note</th><th /></tr></thead>
          <tbody>{p.docs.map((d) => <tr key={d.id}><td className="strong">{DOC_LABEL[d.tipo] || d.tipo}</td><td><a href={`${apiBase}/personale/professionisti/${p.id}/docs/${d.id}`} download>{d.nome}</a> <span className="small muted">({Math.round(d.size / 1024)} KB)</span></td>
            <td>{d.scadenza ? <Badge tone={d.scadenza < today ? 'red' : d.scadenza < soon ? 'amber' : 'green'}>{itD(d.scadenza)}</Badge> : '—'}</td><td className="small">{itDateTime(d.created_at)}</td><td className="small">{d.note}</td><td className="num"><button className="btn sm ghost" style={{ color: 'var(--red)' }} onClick={() => del(d)}>Elimina</button></td></tr>)}</tbody></table></div>)}
    </Card>
  );
}

function Accesso({ p }) {
  const { data, error } = useApi(`/personale/professionisti/${p.id}/accesso`);
  return (
    <Card title="Accesso al portale del professionista">
      <p>Il professionista entra nella <b>Suite TD</b> con il proprio account (email e password o Microsoft 365) e, con il profilo <b>Professionista</b> sul modulo Room Planning, vede solo il proprio portale: disponibilità, turni confermati, presenze registrate, rendiconti approvati e bacheca. L'utente, il collegamento alla persona e il profilo si gestiscono in Amministrazione &gt; Utenti.</p>
      <ErrorBox error={error} />
      {!data ? <Loading /> : <>
        <div className="row" style={{ gap: 14 }}>
          <div>Stato: {data.linked ? <Badge tone="green">accesso attivo</Badge> : data.suiteUser ? <Badge tone="amber">utente collegato, profilo da sistemare</Badge> : <Badge>nessun utente collegato</Badge>}</div>
          {data.suiteUser && <div className="small muted">{data.suiteUser.email}{data.suiteUser.last_login_at ? ` · ultimo accesso ${itDateTime(data.suiteUser.last_login_at)}` : ''}</div>}
        </div>
        <div className="alert info" style={{ marginTop: 10 }}>{data.hint}</div>
        <div className="row" style={{ marginTop: 12 }}><Link className="btn ghost" to="/admin/users">Apri Amministrazione &gt; Utenti</Link><span className="small muted">email in anagrafica: {p.email || '(mancante)'}</span></div>
      </>}
    </Card>
  );
}

export function DisponibilitaProf({ profId, sedi, toast, portale = false }) {
  const base = portale ? '/portale/disponibilita' : `/personale/disponibilita`;
  const { data, reload } = useApi(portale ? base : `${base}?prof_id=${profId}`);
  const [edit, setEdit] = useState(null);
  const sedeName = (id) => { const s = (sedi || []).find((x) => x.id === id); return s ? (s.label || sedeLabel(s)) : id; };
  const save = async () => {
    try {
      const body = { ...edit, giorno: edit.kind === 'SETTIMANALE' ? Number(edit.giorno) : null, data: edit.kind === 'DATA' ? edit.data : null, ...(portale ? {} : { prof_id: profId }) };
      if (edit.id) await api.put(`${base}/${edit.id}`, body); else await api.post(base, body);
      setEdit(null); reload(); toast('Disponibilità salvata');
    } catch (e) { toast(e.message, 'err'); }
  };
  const del = async (d) => { if (!window.confirm('Eliminare questa disponibilità?')) return; try { await api.del(`${base}/${d.id}`); reload(); } catch (e) { toast(e.message, 'err'); } };
  const sett = (data || []).filter((d) => d.kind === 'SETTIMANALE'), date = (data || []).filter((d) => d.kind === 'DATA');
  return (
    <Card title={portale ? 'Le mie disponibilità' : 'Disponibilità offerte'} actions={<button className="btn sm" onClick={() => setEdit({ kind: 'SETTIMANALE', giorno: 0, ora_da: '08:00', ora_a: '14:00', sedi: [], nota: '', valid_dal: '', valid_al: '' })}>+ Aggiungi</button>}>
      <p className="small muted" style={{ marginTop: 0 }}>{portale ? 'Indica giorni, orari e sedi in cui sei disponibile oltre agli impegni già in calendario: la struttura valuta cosa integrare e ti propone i turni.' : 'Fasce in cui il professionista si rende disponibile (ricorrenti per giorno della settimana, oppure in date precise), eventualmente limitate ad alcune sedi.'}</p>
      {!data ? <Loading /> : (
        <>
          <div className="win-grid">{[0, 1, 2, 3, 4, 5, 6].map((g) => <div key={g} className="win-day"><div className="small strong">{DAYS[g]}</div>
            {sett.filter((d) => d.giorno === g).map((d) => <div key={d.id} className="agenda-blk" style={{ background: 'var(--teal)', cursor: 'pointer' }} onClick={() => setEdit({ ...d, valid_dal: d.valid_dal || '', valid_al: d.valid_al || '' })}><div className="t">{d.ora_da}–{d.ora_a}</div><div className="s">{d.sedi?.length ? d.sedi.map(sedeName).join(', ') : 'qualsiasi sede'}</div>{(d.valid_dal || d.valid_al) && <div className="r">{d.valid_dal ? 'dal ' + itD(d.valid_dal) : ''} {d.valid_al ? 'al ' + itD(d.valid_al) : ''}</div>}</div>)}
            {!sett.some((d) => d.giorno === g) && <div className="agenda-free">—</div>}</div>)}</div>
          {date.length > 0 && <div className="table-wrap mt"><table className="t"><thead><tr><th>Data</th><th>Orario</th><th>Sedi</th><th>Nota</th><th /></tr></thead>
            <tbody>{date.map((d) => <tr key={d.id}><td className="strong">{itD(d.data)}</td><td className="mono">{d.ora_da}–{d.ora_a}</td><td>{d.sedi?.length ? d.sedi.map(sedeName).join(', ') : 'qualsiasi'}</td><td className="small">{d.nota}</td><td className="num"><button className="btn sm ghost" onClick={() => setEdit({ ...d, valid_dal: '', valid_al: '' })}>Modifica</button></td></tr>)}</tbody></table></div>}
        </>)}
      {edit && <Modal title={edit.id ? 'Modifica disponibilità' : 'Nuova disponibilità'} onClose={() => setEdit(null)} footer={<>{edit.id && <button className="btn ghost" style={{ color: 'var(--red)' }} onClick={() => { del(edit); setEdit(null); }}>Elimina</button>}<span className="spacer" /><button className="btn ghost" onClick={() => setEdit(null)}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}>
        <div className="form-grid">
          <Field label="Tipo"><select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}><option value="SETTIMANALE">Ricorrente (ogni settimana)</option><option value="DATA">Data precisa</option></select></Field>
          {edit.kind === 'SETTIMANALE' ? <Field label="Giorno"><select value={edit.giorno} onChange={(e) => setEdit({ ...edit, giorno: e.target.value })}>{DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}</select></Field> : <Field label="Data"><input type="date" value={edit.data || ''} onChange={(e) => setEdit({ ...edit, data: e.target.value })} /></Field>}
          <Field label="Dalle"><input type="time" value={edit.ora_da} onChange={(e) => setEdit({ ...edit, ora_da: e.target.value })} /></Field>
          <Field label="Alle"><input type="time" value={edit.ora_a} onChange={(e) => setEdit({ ...edit, ora_a: e.target.value })} /></Field>
          {edit.kind === 'SETTIMANALE' && <><Field label="Valida dal (opzionale)"><input type="date" value={edit.valid_dal || ''} onChange={(e) => setEdit({ ...edit, valid_dal: e.target.value })} /></Field><Field label="Valida fino al (opzionale)"><input type="date" value={edit.valid_al || ''} onChange={(e) => setEdit({ ...edit, valid_al: e.target.value })} /></Field></>}
        </div>
        <Field label="Sedi (nessuna = qualsiasi)"><div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>{(sedi || []).map((s) => <label key={s.id} className="f inline"><input type="checkbox" checked={(edit.sedi || []).includes(s.id)} onChange={(e) => setEdit({ ...edit, sedi: e.target.checked ? [...(edit.sedi || []), s.id] : edit.sedi.filter((x) => x !== s.id) })} />{s.label || sedeLabel(s)}</label>)}</div></Field>
        <Field label="Nota"><input value={edit.nota || ''} onChange={(e) => setEdit({ ...edit, nota: e.target.value })} /></Field>
      </Modal>}
    </Card>
  );
}

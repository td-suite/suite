import React, { useEffect, useMemo, useState } from 'react';
import { api, apiBase } from '../api.js';
import { useApi, Loading, ErrorBox, Modal, Badge, Field, useToast, Card } from '../components/ui.jsx';
import { itDateTime } from '../format.js';
import { sedeLabel } from './Sedi.jsx';
import { RAPPORTO, REGIME, DOC_LABEL, DAYS, itD, eur } from '../lib/personale.js';
import { DISC, EQUIP } from '../planner/planner.jsx';

const DISCIPLINE = (Array.isArray(DISC) ? DISC : Object.keys(DISC || {})).map((d) => (typeof d === 'string' ? d : d.n || d.nome || String(d)));
const ATTREZZ = (Array.isArray(EQUIP) ? EQUIP : Object.keys(EQUIP || {})).map((d) => (typeof d === 'string' ? d : d.n || d.nome || String(d)));
const TABS = [['anagrafica', 'Anagrafica'], ['professionale', 'Professionale'], ['contratto', 'Contratto e assicurazione'], ['compenso', 'Compenso'], ['documenti', 'Documenti'], ['accesso', 'Accesso'], ['disponibilita', 'Disponibilità']];
const empty = (nome = '', tipo = 'sanitario') => ({ nome, tipo, profilo: tipo === 'medico' ? 'Medico' : 'Infermiere', email: '', attivo: true, dati: { anagrafica: {}, professionale: { discipline: [], attrezzature: [], specializzazioni: [] }, contratto: { rapporto: 'LP' }, assicurazione: {}, compenso: { tipo: 'ORARIO', eccezioniSede: [], regime: 'FORFETTARIO' }, sediAbilitate: [], note: '' } });

export default function Professionisti() {
  const toast = useToast();
  const { data, error, reload } = useApi('/personale/professionisti');
  const sedi = useApi('/strutture');
  const opz = useApi('/personale/professionisti/opzioni');
  const [q, setQ] = useState(''); const [tipo, setTipo] = useState('tutti'); const [soloAttivi, setSoloAttivi] = useState(true);
  const [sel, setSel] = useState(null); const [nuovo, setNuovo] = useState(false);
  const list = useMemo(() => (data || []).filter((p) => (!soloAttivi || p.attivo) && (tipo === 'tutti' || p.tipo === tipo) && (!q || `${p.nome} ${p.profilo || ''} ${p.email || ''}`.toLowerCase().includes(q.toLowerCase()))), [data, q, tipo, soloAttivi]);
  const importa = async () => {
    try { const r = await api.post('/personale/professionisti/importa-da-sedi'); toast(r.created || r.riattivati ? `Aggiunti ${r.created} sanitari dalle sedi${r.riattivati ? `, riattivati ${r.riattivati}` : ''}` : 'Tutti i sanitari delle sedi sono già in elenco'); reload(); } catch (e) { toast(e.message, 'err'); }
  };
  const scad = (p) => p.prossimaScadenza && p.prossimaScadenza < new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  return (
    <div className="page">
      <div className="page-head"><div><h1>Professionisti</h1><div className="sub">Anagrafica completa di medici e professionisti sanitari: dati, contratto, compenso, documenti, accesso al portale e disponibilità.</div></div>
        <div className="row"><button className="btn ghost" onClick={importa} title="Aggiunge il personale sanitario censito nelle sedi e non ancora in elenco; non elimina nessuno">Aggiungi i sanitari mancanti dalle sedi</button><button className="btn" onClick={() => setNuovo(true)}>Nuovo professionista</button></div></div>
      <ErrorBox error={error} />
      {!data || !sedi.data ? <Loading /> : (
        <div className="spec-layout">
          <div className="card spec-list">
            <div className="bd" style={{ padding: 12, borderBottom: '1px solid var(--line)' }}>
              <input placeholder="Cerca nome, profilo, email…" value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="seg" style={{ marginTop: 8 }}>{[['tutti', 'Tutti'], ['medico', 'Medici'], ['sanitario', 'Sanitari']].map(([k, l]) => <button key={k} className={tipo === k ? 'on' : ''} onClick={() => setTipo(k)}>{l}</button>)}</div>
              <label className="f inline small" style={{ marginTop: 6 }}><input type="checkbox" checked={soloAttivi} onChange={(e) => setSoloAttivi(e.target.checked)} />solo attivi</label>
              <div className="small muted">{list.length} professionisti</div>
            </div>
            <div className="spec-items">{list.map((p) => (
              <button key={p.id} className={`spec-item ${sel === p.id ? 'on' : ''}`} onClick={() => setSel(p.id)}>
                <div className="strong">{p.nome}{!p.attivo && <Badge>non attivo</Badge>}</div>
                <div className="small muted">{p.profilo || (p.tipo === 'medico' ? 'Medico' : 'Sanitario')}{p.discipline?.length ? ' · ' + p.discipline.join(', ') : ''}</div>
                <div className="small">{p.email ? <span>{p.email}</span> : <span className="red">senza email</span>}{p.userId ? <span> · <Badge tone="green">portale</Badge></span> : null}{scad(p) ? <span> · <Badge tone="amber">documento in scadenza</Badge></span> : null}</div>
              </button>))}</div>
          </div>
          <div style={{ minWidth: 0 }}>
            {!sel ? <div className="card"><div className="bd empty">Seleziona un professionista. "Aggiungi i sanitari mancanti dalle sedi" censisce chi è già nelle schede di sede; chi lavora fuori dalla programmazione delle sedi (figure di backup) si inserisce con "Nuovo professionista" e resta in elenco.</div></div>
              : <Scheda key={sel} id={sel} sedi={sedi.data} opz={opz.data} toast={toast} reloadList={reload} onDeleted={() => { setSel(null); reload(); }} />}
          </div>
        </div>
      )}
      {nuovo && <NuovoModal onClose={() => setNuovo(false)} onCreated={(id) => { setNuovo(false); reload(); setSel(id); }} toast={toast} />}
    </div>
  );
}

function NuovoModal({ onClose, onCreated, toast }) {
  const [f, setF] = useState({ nome: '', tipo: 'sanitario', profilo: 'Infermiere', email: '' });
  const save = async () => { try { const r = await api.post('/personale/professionisti', { ...empty(f.nome, f.tipo), profilo: f.profilo, email: f.email || null }); toast('Professionista creato'); onCreated(r.id); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Modal title="Nuovo professionista" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={f.nome.trim().length < 2} onClick={save}>Crea</button></>}>
      <div className="form-grid">
        <Field label="Cognome e nome (come nelle schede di sede)"><input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} autoFocus /></Field>
        <Field label="Tipo"><select value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value, profilo: e.target.value === 'medico' ? 'Medico' : 'Infermiere' })}><option value="medico">Medico</option><option value="sanitario">Professionista sanitario</option></select></Field>
        <Field label="Profilo"><ProfiloInput value={f.profilo} tipo={f.tipo} onChange={(v) => setF({ ...f, profilo: v })} /></Field>
        <Field label="Email"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      </div>
      <p className="small muted">Il nome è la chiave che collega il professionista alle persone censite nelle sedi: usa la stessa grafia (l'ordine cognome/nome e gli accenti non contano).</p>
    </Modal>
  );
}

const PROFILI_SAN = ['Infermiere', 'Tecnico di radiologia', 'Tecnico di laboratorio', 'Ostetrica', 'Fisioterapista', 'Biologo', 'Psicologo', 'Dietista', 'Logopedista', 'OSS', 'Altro'];
function ProfiloInput({ value, tipo, onChange }) {
  if (tipo === 'medico') return <input value={value || 'Medico'} onChange={(e) => onChange(e.target.value)} />;
  return <><input list="profili-san" value={value || ''} onChange={(e) => onChange(e.target.value)} /><datalist id="profili-san">{PROFILI_SAN.map((p) => <option key={p} value={p} />)}</datalist></>;
}

function Scheda({ id, sedi, opz, toast, reloadList, onDeleted }) {
  const [p, setP] = useState(null); const [orig, setOrig] = useState(null); const [tab, setTab] = useState('anagrafica'); const [busy, setBusy] = useState(false);
  const load = async () => { const r = await api.get(`/personale/professionisti/${id}`); const base = empty(r.nome, r.tipo); const d = { ...base.dati, ...r.dati, anagrafica: { ...r.dati?.anagrafica }, professionale: { ...base.dati.professionale, ...r.dati?.professionale }, contratto: { ...base.dati.contratto, ...r.dati?.contratto }, assicurazione: { ...r.dati?.assicurazione }, compenso: { ...base.dati.compenso, ...r.dati?.compenso } }; const v = { ...r, dati: d }; setP(v); setOrig(JSON.stringify({ nome: v.nome, tipo: v.tipo, profilo: v.profilo, email: v.email, attivo: v.attivo, dati: v.dati })); };
  useEffect(() => { load().catch((e) => toast(e.message, 'err')); }, [id]);
  if (!p) return <Loading />;
  const payload = { nome: p.nome, tipo: p.tipo, profilo: p.profilo, email: p.email, attivo: p.attivo, dati: p.dati };
  const dirty = JSON.stringify(payload) !== orig;
  const set = (patch) => setP((x) => ({ ...x, ...patch }));
  const setD = (sec, patch) => setP((x) => ({ ...x, dati: { ...x.dati, [sec]: { ...(x.dati[sec] || {}), ...patch } } }));
  const save = async () => { setBusy(true); try { const r = await api.put(`/personale/professionisti/${id}`, payload); toast(r.sediAggiornate ? `Scheda salvata · aggiornata anche in ${r.sediAggiornate} ${r.sediAggiornate === 1 ? 'sede' : 'sedi'}` : 'Scheda salvata'); await load(); reloadList(); } catch (e) { toast(e.message, 'err'); } setBusy(false); };
  const elimina = async () => { if (!window.confirm(`Eliminare ${p.nome} dall'anagrafica dei professionisti? (le schede di sede non vengono toccate)`)) return; try { await api.del(`/personale/professionisti/${id}`); toast('Professionista eliminato'); onDeleted(); } catch (e) { toast(e.message, 'err'); } };
  const A = p.dati.anagrafica, PR = p.dati.professionale, C = p.dati.contratto, AS = p.dati.assicurazione, CO = p.dati.compenso;
  const scadenzaCls = (d) => (d && d < new Date().toISOString().slice(0, 10) ? 'red' : d && d < new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10) ? 'amber' : '');
  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="card"><div className="bd">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 18 }}>{p.nome} <Badge tone={p.tipo === 'medico' ? 'teal' : 'mauve'}>{p.profilo || p.tipo}</Badge> {!p.attivo && <Badge tone="red">non attivo</Badge>}</h2>
            <div className="small muted">{p.sediPresente?.length ? 'Nelle schede di sede: ' + p.sediPresente.map((s) => s.label).join(', ') : 'Non presente nelle schede di sede'}{p.updated_at ? ` · aggiornato ${itDateTime(p.updated_at)}` : ''}</div>
          </div>
          <div className="row">{dirty && <span className="small amber">modifiche non salvate</span>}<button className="btn ghost sm" style={{ color: 'var(--red)' }} onClick={elimina} title="Possibile solo senza turni, presenze, rendiconti o candidature collegati">Elimina</button><button className="btn" disabled={!dirty || busy} onClick={save}>{busy ? 'Salvo…' : 'Salva scheda'}</button></div>
        </div>
        <div className="seg" style={{ marginTop: 12, flexWrap: 'wrap' }}>{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      </div></div>

      {tab === 'anagrafica' && <Card title="Dati anagrafici e contatti"><div className="form-grid">
        <Field label="Cognome e nome (chiave di collegamento alle sedi)" help="Nome, email e profilo salvati qui vengono riportati anche nelle schede di sede dove la persona compare"><input value={p.nome} onChange={(e) => set({ nome: e.target.value })} /></Field>
        <Field label="Tipo"><select value={p.tipo} onChange={(e) => set({ tipo: e.target.value, profilo: e.target.value === 'medico' ? 'Medico' : p.profilo === 'Medico' ? 'Infermiere' : p.profilo })}><option value="medico">Medico</option><option value="sanitario">Professionista sanitario</option></select></Field>
        <Field label="Profilo professionale"><ProfiloInput value={p.profilo} tipo={p.tipo} onChange={(v) => set({ profilo: v })} /></Field>
        <Field label="Stato"><select value={p.attivo ? '1' : '0'} onChange={(e) => set({ attivo: e.target.value === '1' })}><option value="1">Attivo</option><option value="0">Non attivo (cessato)</option></select></Field>
        <In p={p} setD={setD} sec="anagrafica" k="cognome" label="Cognome" /><In p={p} setD={setD} sec="anagrafica" k="nome" label="Nome" />
        <Field label="Sesso"><select value={A.sesso || ''} onChange={(e) => setD('anagrafica', { sesso: e.target.value })}><option value="">—</option><option value="F">F</option><option value="M">M</option></select></Field>
        <In p={p} setD={setD} sec="anagrafica" k="dataNascita" label="Data di nascita" type="date" /><In p={p} setD={setD} sec="anagrafica" k="luogoNascita" label="Luogo di nascita" />
        <In p={p} setD={setD} sec="anagrafica" k="codiceFiscale" label="Codice fiscale" style={{ textTransform: 'uppercase' }} /><In p={p} setD={setD} sec="anagrafica" k="partitaIva" label="Partita IVA" />
        <In p={p} setD={setD} sec="anagrafica" k="indirizzo" label="Indirizzo" /><In p={p} setD={setD} sec="anagrafica" k="cap" label="CAP" /><In p={p} setD={setD} sec="anagrafica" k="citta" label="Città" /><In p={p} setD={setD} sec="anagrafica" k="provincia" label="Provincia" />
        <Field label="Email (accesso al portale e invii)"><input type="email" value={p.email || ''} onChange={(e) => set({ email: e.target.value })} /></Field>
        <In p={p} setD={setD} sec="anagrafica" k="pec" label="PEC" type="email" /><In p={p} setD={setD} sec="anagrafica" k="telefono" label="Telefono" /><In p={p} setD={setD} sec="anagrafica" k="cellulare" label="Cellulare" />
        <In p={p} setD={setD} sec="anagrafica" k="iban" label="IBAN" /><In p={p} setD={setD} sec="anagrafica" k="intestatarioConto" label="Intestatario del conto" />
        <In p={p} setD={setD} sec="anagrafica" k="contattoEmergenza" label="Contatto di emergenza" />
      </div><Field label="Note"><textarea rows={3} value={p.dati.note || ''} onChange={(e) => setP({ ...p, dati: { ...p.dati, note: e.target.value } })} /></Field></Card>}

      {tab === 'professionale' && <Card title="Profilo professionale">
        <div className="form-grid">
          <In p={p} setD={setD} sec="professionale" k="titoloStudio" label="Titolo di studio" /><In p={p} setD={setD} sec="professionale" k="annoLaurea" label="Anno di conseguimento" />
          <In p={p} setD={setD} sec="professionale" k="alboOrdine" label="Albo / Ordine (es. OMCeO, OPI, TSRM)" /><In p={p} setD={setD} sec="professionale" k="alboProvincia" label="Provincia dell'albo" /><In p={p} setD={setD} sec="professionale" k="alboNumero" label="Numero di iscrizione" /><In p={p} setD={setD} sec="professionale" k="alboData" label="Data di iscrizione" type="date" />
          <In p={p} setD={setD} sec="professionale" k="ecmCrediti" label="Crediti ECM (triennio corrente)" type="number" /><In p={p} setD={setD} sec="professionale" k="ecmTriennio" label="Triennio ECM" placeholder="2026-2028" />
          <In p={p} setD={setD} sec="professionale" k="anniEsperienza" label="Anni di esperienza" type="number" /><In p={p} setD={setD} sec="professionale" k="lingue" label="Lingue" />
        </div>
        <TagPicker label="Discipline / specialità" options={DISCIPLINE} value={PR.discipline || []} onChange={(v) => setD('professionale', { discipline: v })} />
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
            <select value={e.sedeId} onChange={(ev) => setD('compenso', { eccezioniSede: CO.eccezioniSede.map((x, j) => (j === i ? { ...x, sedeId: ev.target.value } : x)) })} style={{ width: 320 }}>{sedi.map((s) => <option key={s.id} value={s.id}>{sedeLabel(s)}</option>)}</select>
            <input type="number" step="0.01" value={e.tariffaOraria} placeholder="€/h" style={{ width: 120 }} onChange={(ev) => setD('compenso', { eccezioniSede: CO.eccezioniSede.map((x, j) => (j === i ? { ...x, tariffaOraria: ev.target.value } : x)) })} />
            <button className="btn sm ghost" onClick={() => setD('compenso', { eccezioniSede: CO.eccezioniSede.filter((_, j) => j !== i) })}>×</button></div>)}
        </div>}
        <Field label="Note sul compenso" className="mt"><textarea rows={2} value={CO.note || ''} onChange={(e) => setD('compenso', { note: e.target.value })} /></Field>
        <p className="small muted">Il rendiconto mensile moltiplica le ore delle presenze confermate dai gestori di sede per la tariffa (base o della sede); con il fisso mensile le presenze restano registrate ma l'importo è il fisso. Gli oneri (cassa, IVA, ritenuta) sono calcolati a titolo indicativo per la fattura.</p>
      </Card>}

      {tab === 'documenti' && <Documenti p={p} opz={opz} toast={toast} reload={load} />}
      {tab === 'accesso' && <Accesso p={p} toast={toast} reload={() => { load(); reloadList(); }} dirty={dirty} />}
      {tab === 'disponibilita' && <DisponibilitaProf profId={p.id} sedi={sedi} toast={toast} />}
    </div>
  );
}

function In({ p, setD, sec, k, label, type = 'text', ...rest }) { return <Field label={label}><input type={type} value={(p.dati[sec] || {})[k] ?? ''} onChange={(e) => setD(sec, { [k]: e.target.value })} {...rest} /></Field>; }

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

function Accesso({ p, toast, reload, dirty }) {
  const [link, setLink] = useState(null); const [busy, setBusy] = useState(false);
  const invita = async () => {
    if (dirty) { toast('Salva prima la scheda', 'err'); return; }
    if (!p.email) { toast('Inserisci l\'email nella scheda', 'err'); return; }
    if (!window.confirm(`Collegare la scheda all'accesso Suite con email ${p.email}? Il professionista entrerà nella Suite con il profilo Professionista e vedrà solo il proprio portale.`)) return;
    setBusy(true); try { const r = await api.post(`/personale/professionisti/${p.id}/invita`, {}); setLink(r); toast(r.linked ? 'Accesso collegato' : 'Scheda collegata: l\'utente va creato o abilitato in Amministrazione della Suite'); reload(); } catch (e) { toast(e.message, 'err'); } setBusy(false);
  };
  return (
    <Card title="Accesso al portale del professionista">
      <p>Il professionista entra nella <b>Suite TD</b> con il proprio account (email e password o Microsoft 365) e, con il profilo <b>Professionista</b> sul modulo Room Planning, vede solo il proprio portale: disponibilità, turni confermati, presenze registrate, rendiconti approvati e bacheca. L'utente e il profilo si creano in Amministrazione della Suite; da qui si collega la scheda all'account con la stessa email.</p>
      <div className="row" style={{ gap: 14 }}>
        <div>Stato: {p.user_id ? (p.user_active ? <Badge tone="green">scheda collegata</Badge> : <Badge tone="red">utente disattivato</Badge>) : <Badge>nessun accesso collegato</Badge>}</div>
        {p.last_login_at && <div className="small muted">ultimo accesso {itDateTime(p.last_login_at)}</div>}
      </div>
      <div className="row" style={{ marginTop: 12 }}><button className="btn" disabled={busy} onClick={invita}>{p.user_id ? 'Ricollega all\'account' : 'Collega all\'account Suite'}</button><span className="small muted">email {p.email || '(email mancante)'}</span></div>
      {link && <div className={`alert ${link.linked ? 'ok' : 'info'}`} style={{ marginTop: 10 }}>{link.hint}</div>}
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

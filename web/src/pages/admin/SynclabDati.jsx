import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useApi, Card, Badge, Skeleton, ErrorBox, PageHead, Field, useToast, Modal, Switch, ConfirmModal, Tabs, Seg, SearchInput, DropZone } from '../../components/ui.jsx';
import { Icon } from '../../components/Icons.jsx';
import { fmtDateTime, timeAgo } from '../../format.js';

// Amministrazione > Connettori > StudioLAB > Dati Synclab (Data API v1 di CB Sistemi, 09/11/2026). Copia locale in sola lettura dei cinque
// insiemi di dati del gestionale: stato della sincronizzazione, impostazioni, clienti Synclab e storico dei cicli. Il server non espone
// mai checkpoint, cursori o token: qui si vedono solo date, conteggi e sì/no. Guida: docs/SYNCLAB_DATA_API.md.
const NOMI = { exams: 'Esami', clients: 'Clienti', 'price-lists': 'Listini', requests: 'Accettazioni', invoices: 'Documenti economici' };
const TIPI = { COMPLETO: 'completo', DELTA: 'variazioni', RICONCILIAZIONE: 'riallineamento' };
const ESITO_TONE = { OK: 'green', ERRORE: 'red', IN_CORSO: 'blue', INTERROTTO: 'amber' };
const ABBINAMENTO = { CONFERMATO: ['green', 'confermato'], MANUALE: ['blue', 'scelto a mano'], PROPOSTO: ['amber', 'proposto'], DA_ABBINARE: ['grey', 'da abbinare'] };
const REGOLA = { CODICE_STUDIOLAB: 'codice StudioLAB della sede', PARTITA_IVA: 'partita IVA o codice fiscale', CODICE: 'codice della Legal entity o della sede', NOME_COMUNE: 'ragione sociale e comune' };
const ORIGINI = { NOTTURNO: 'notturno', MANUALE: 'manuale', RIPRESA: 'ripresa', GIORNO: 'di giorno' };
const durata = (ms) => (ms == null ? '' : ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);
const n0 = (v) => Number(v || 0).toLocaleString('it-IT');

function EsitoRun({ r }) {
  if (!r) return <span className="faint small">mai eseguito</span>;
  return (
    <div className="small">
      <Badge tone={ESITO_TONE[r.esito] || 'grey'} dot={false}>{r.esito === 'OK' ? 'riuscito' : r.esito === 'ERRORE' ? 'in errore' : r.esito === 'IN_CORSO' ? 'in corso' : 'interrotto'}</Badge>{' '}
      {TIPI[r.tipo] || r.tipo} · {fmtDateTime(r.iniziato)}{r.durata_ms != null ? ` · ${durata(r.durata_ms)}` : ''}{r.record != null ? ` · ${n0(r.record)} record` : ''}
      {r.errore ? <div className="red" style={{ maxWidth: 380 }}>{r.errore}</div> : null}
      {r.correlation_id ? <div className="muted mono">correlationId {r.correlation_id}</div> : null}
    </div>
  );
}

function Stato({ s, onAvvia, onSaved }) {
  const toast = useToast();
  const [conferma, setConferma] = useState(null);
  const [spegni, setSpegni] = useState(false);
  // v0.68.6: con la proiezione paziente accesa, avviso in testa con lo spegnimento (che svuota i dati paziente già importati)
  const spegniPaziente = async () => {
    try { const r = await api.put('/synclab/impostazioni', { include_patient: false }); toast(r.svuotati ? `Dati paziente spenti e tolti da ${n0(r.svuotati.accettazioni)} accettazioni` : 'Dati paziente spenti'); onSaved?.(); }
    catch (e) { toast(e, 'err'); }
  };
  return (
    <>
      {s.impostazioni.include_patient && (
        <div className="alert warn mb" data-testid="avviso-dati-paziente"><Icon name="alert" /><span style={{ flex: 1 }}><b>Importazione dei dati identificativi dei pazienti accesa.</b> La copia delle accettazioni riceve cognome, nome, data di nascita e codice fiscale: la decisione del CEO del 09/11/2026 è di tenerla spenta (la profilazione usa solo la demografia e la NC recupera il paziente una accettazione alla volta).</span>
          <button className="btn sm danger" onClick={() => setSpegni(true)} data-testid="spegni-dati-paziente">Spegni e svuota i dati paziente</button></div>
      )}
      {spegni && <ConfirmModal danger title="Spegni e svuota i dati paziente" text="La proiezione paziente viene spenta e dalla copia vengono tolti cognome, nome, data di nascita, codice fiscale e i testi storici delle righe già importati. La demografia (età, sesso, provenienza) resta. Il prossimo ciclo delle accettazioni usa l'ambito standard." confirmText="Spegni e svuota" onConfirm={() => { setSpegni(false); spegniPaziente(); }} onClose={() => setSpegni(false)} />}
      <Card title="Insiemi di dati" icon="stats" flush actions={<div className="row tight wrap">
        <button className="btn sm" disabled={!!s.in_corso} onClick={() => onAvvia(null, 'AUTO')}><Icon name="refresh" />Sincronizza adesso</button>
        <button className="btn sm ghost danger" disabled={!!s.in_corso} onClick={() => setConferma({ dataset: null })}>Completo forzato di tutti</button>
      </div>}>
        <div className="table-wrap"><table className="t" data-testid="synclab-stato">
          <thead><tr><th>Insieme di dati</th><th>Ultimo completo</th><th>Checkpoint confermato</th><th className="num">Record locali</th><th>Ultimo ciclo</th><th>Pagina in sospeso</th><th /></tr></thead>
          <tbody>
            {s.insiemi.map((x) => {
              const a = x.ambito;
              return (
                <tr key={x.dataset}>
                  <td><b>{NOMI[x.dataset]}</b>{!x.abilitato ? <div className="small muted">escluso dalle impostazioni</div> : null}{x.altri_ambiti.length ? <div className="small muted">{x.altri_ambiti.length} altri ambiti (filtri o proiezione precedenti)</div> : null}{a?.include_patient ? <div><Badge tone="red" dot={false}>con dati paziente</Badge></div> : null}</td>
                  <td className="small">{a?.ultimo_completo_at ? fmtDateTime(a.ultimo_completo_at) : <span className="faint">mai</span>}</td>
                  <td className="small">{a?.ha_checkpoint ? <><Badge tone="green" dot={false}>sì</Badge> fotografia del {fmtDateTime(a.checkpoint_at)}</> : <Badge tone="grey" dot={false}>no</Badge>}</td>
                  <td className="num">{n0(x.locali?.attivi)}{x.locali?.altri ? <div className="small muted">+{n0(x.locali.altri)} non attivi</div> : null}</td>
                  <td><EsitoRun r={a?.ultimo_run} /></td>
                  <td className="small">{a?.in_sospeso ? <><Badge tone="amber" dot={false}>sì</Badge> {a.sospeso_fase === 'STATUS' ? 'verifica degli assenti' : `${n0(a.sospeso_pagine)} pagine, ${n0(a.sospeso_record)} record`}</> : 'no'}{a?.in_corso ? <div><Badge tone="blue">in corso</Badge></div> : null}</td>
                  <td className="nowrap">
                    <div className="row tight">
                      {a?.in_sospeso
                        ? <button className="btn sm" disabled={!!s.in_corso} onClick={() => onAvvia(x.dataset, 'AUTO')}>Riprendi</button>
                        : <button className="btn sm ghost" disabled={!!s.in_corso} onClick={() => onAvvia(x.dataset, 'AUTO')}>Sincronizza</button>}
                      <button className="btn sm ghost" disabled={!!s.in_corso} onClick={() => setConferma({ dataset: x.dataset })} title="Nuovo completo fuso con la copia esistente">Completo</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </Card>
      <p className="small muted">"Sincronizza" riprende la pagina in sospeso se c'è, altrimenti chiede le sole variazioni dall'ultimo checkpoint confermato (o un completo se non ce n'è uno). Il completo forzato rilegge tutto e lo fonde con la copia: i record che non ricompaiono non si cancellano, si verificano uno per uno con il gestionale (archiviati, esclusi, uscita incerta).</p>
      {conferma && <ConfirmModal title={`Completo forzato${conferma.dataset ? ` · ${NOMI[conferma.dataset]}` : ' di tutti gli insiemi'}`} text="Il gestionale prepara una nuova fotografia completa: può richiedere diversi minuti e molte pagine (i listini e i documenti sono grandi). La pagina in sospeso, se c'è, viene abbandonata; il checkpoint confermato resta finché il nuovo completo non è finito." confirmText="Avvia il completo" onConfirm={() => onAvvia(conferma.dataset, 'COMPLETO')} onClose={() => setConferma(null)} />}
    </>
  );
}

function Impostazioni({ s, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState(null);
  useEffect(() => { setF({ ...s.impostazioni, data_api_timeout_s: Math.round(s.impostazioni.data_api_timeout_ms / 1000) }); }, [s.impostazioni]);
  if (!f) return null;
  const set = (k, v) => setF({ ...f, [k]: v });
  const save = async () => {
    try {
      const body = { data_api_enabled: f.data_api_enabled, sync_ora: f.sync_ora, page_size: Number(f.page_size), page_size_listini: Number(f.page_size_listini), include_patient: f.include_patient,
        data_api_timeout_ms: Number(f.data_api_timeout_s) * 1000, operating_company: f.operating_company || '', datasets: f.datasets,
        stati_erogati: [...f.stati_erogati].map(Number).sort((a, b) => a - b), sync_intraday_minuti: Number(f.sync_intraday_minuti), sconto_testata: f.sconto_testata === 'APPLICA' ? 'APPLICA' : 'NON_APPLICARE' };
      if (!body.stati_erogati.length) throw new Error('Indica almeno uno stato che conta come produzione accettata');
      const r = await api.put('/synclab/impostazioni', body);
      toast(r.svuotati ? `Impostazioni salvate; dati paziente tolti da ${r.svuotati.accettazioni} accettazioni` : 'Impostazioni salvate'); onSaved();
    } catch (e) { toast(e, 'err'); }
  };
  const tutti = ['exams', 'clients', 'price-lists', 'requests', 'invoices'];
  return (
    <Card title="Impostazioni della Data API" icon="gear">
      <div className="form-grid">
        <Field label="Sincronizzazione notturna" help="Spenta finché il CEO non la accende dopo la Prova connessione"><Switch checked={f.data_api_enabled} onChange={(v) => set('data_api_enabled', v)} label="Data API abilitata" /></Field>
        <Field label="Ora del ciclo notturno (Europe/Rome)" help="Il ciclo parte al primo controllo (ogni 15 minuti) da quest'ora in poi, una volta al giorno"><input type="time" value={f.sync_ora} onChange={(e) => set('sync_ora', e.target.value)} /></Field>
        <Field label="Record per pagina" help="Predefinito 100; il massimo lo dichiara il gestionale nei metadati"><input type="number" min={1} max={500} value={f.page_size} onChange={(e) => set('page_size', e.target.value)} /></Field>
        <Field label="Listini per pagina" help="Predefinito 10: ogni listino porta tutte le sue righe"><input type="number" min={1} max={500} value={f.page_size_listini} onChange={(e) => set('page_size_listini', e.target.value)} /></Field>
        <Field label="Tempo massimo per pagina (secondi)" help="Predefinito 120: le pagine di listini e documenti sono grandi"><input type="number" min={5} max={600} value={f.data_api_timeout_s} onChange={(e) => set('data_api_timeout_s', e.target.value)} /></Field>
        <Field label="Azienda operativa (facoltativa)" help="Vuota = tutte. Vale per clienti, listini, accettazioni e documenti; cambiarla avvia un ambito nuovo con un completo"><input value={f.operating_company || ''} onChange={(e) => set('operating_company', e.target.value)} placeholder="es. LAB" /></Field>
        <Field label="Insiemi di dati da sincronizzare" className="span2">
          <div className="row wrap" style={{ gap: 14 }}>{tutti.map((d) => <label key={d} className="row tight small"><input type="checkbox" checked={f.datasets.includes(d)} onChange={(e) => set('datasets', e.target.checked ? tutti.filter((x) => x === d || f.datasets.includes(x)) : f.datasets.filter((x) => x !== d))} />{NOMI[d]}</label>)}</div>
        </Field>
        <Field label="Aggiornamento di giorno delle accettazioni (minuti)" help={`Fra le ${s.giorno?.dalle || '07:00'} e le ${s.giorno?.alle || '21:00'} ora di Roma il delta delle accettazioni ogni N minuti (un ciclo alla volta, stesso lock del notturno), così la produzione del giorno si aggiorna nei cruscotti. 0 = spento. Solo con la Data API abilitata.`}>
          <input type="number" min={0} max={720} value={f.sync_intraday_minuti} onChange={(e) => set('sync_intraday_minuti', e.target.value)} data-testid="intraday-minuti" />
          {s.intraday ? <div className="small muted">Ultimo: {fmtDateTime(s.intraday.at)} · {s.intraday.esito === 'OK' ? `riuscito${s.intraday.record != null ? `, ${n0(s.intraday.record)} record` : ''}` : (s.intraday.errore || s.intraday.motivo || s.intraday.esito)}</div> : null}
        </Field>
        <Field label="Stati che contano come produzione accettata" className="span2" help="Stati dell'accettazione che valgono come produzione in tutti i cruscotti (Cockpit, Retail, Business Hub, Finance, Diagnostica). Dalla v0.68.6 il predefinito è l'ACCETTATO, come il report Riepilogo Esami del gestionale: tutti gli stati tranne 11 (NC mai arrivato). La scheda Quadratura dice quale definizione coincide con il report.">
          <div className="row wrap" style={{ gap: 12 }} data-testid="stati-erogati">{Object.entries(s.legenda_stati || {}).map(([k, l]) => <label key={k} className="row tight small"><input type="checkbox" checked={f.stati_erogati.map(Number).includes(Number(k))} onChange={(e) => set('stati_erogati', e.target.checked ? [...new Set([...f.stati_erogati.map(Number), Number(k)])] : f.stati_erogati.map(Number).filter((x) => x !== Number(k)))} /><span className="mono">{k}</span> {l}</label>)}</div>
          <div className="small muted" style={{ marginTop: 6 }}>Predefiniti (accettato): {(s.stati_erogati_predefiniti || []).join(', ')}; escluso 11 NC mai arrivato. La definizione della v0.68.5 ("erogati", dal prelievo eseguito in poi) era {(s.stati_erogati_v0685 || []).join(', ')}. Esami = righe d'esame non cancellate, comprese quelle senza prezzo (contate anche a parte).{f.stati_erogati.some((x) => !(s.legenda_stati || {})[x]) ? ` Altri codici in uso: ${f.stati_erogati.filter((x) => !(s.legenda_stati || {})[x]).join(', ')}.` : ''}</div>
        </Field>
        <Field label="Sconto di testata nella produzione" className="span2" help="Il report Riepilogo Esami del gestionale somma gli importi di riga: con &quot;Non applicare&quot; (predefinito) i cruscotti coincidono con il report; con &quot;Applica&quot; il valore è il netto vero (meno lo sconto di testata). I cruscotti dicono nella fonte quale regola vale e mostrano a parte gli sconti di testata.">
          <Seg value={f.sconto_testata || 'NON_APPLICARE'} onChange={(v) => set('sconto_testata', v)} label="Sconto di testata" items={[{ value: 'NON_APPLICARE', label: 'Non applicare (importi di riga, come il report)' }, { value: 'APPLICA', label: 'Applica (netto vero)' }]} />
        </Field>
        <Field label="Dati identificativi dei pazienti" className="span2"><Switch checked={f.include_patient} onChange={(v) => set('include_patient', v)} label="Importa nome, cognome, data di nascita e codice fiscale dei pazienti" /></Field>
      </div>
      {f.include_patient && <div className="alert warn small"><Icon name="alert" /><span>Con questa opzione la Suite importa per le accettazioni i dati identificativi dei pazienti (cognome, nome, data di nascita, codice fiscale) e i testi storici liberi delle righe, che possono contenere identificativi. Sono dati sanitari: servono una base giuridica e una finalità documentate. Le pagine della Suite non li mostrano. Spegnendo l'opzione i dati già importati vengono tolti dalla copia.</span></div>}
      <div className="row mt"><button className="btn sm" onClick={save}><Icon name="check" />Salva</button></div>
    </Card>
  );
}

function ScegliModal({ c, onClose, onSaved }) {
  const toast = useToast();
  const orgs = useApi('/organizations');
  const sites = useApi('/sites');
  const [qq, setQq] = useState(c.legal_name || '');
  const [org, setOrg] = useState(c.organization_id || null);
  const [site, setSite] = useState(c.site_id || '');
  const lista = useMemo(() => { const t = qq.trim().toLowerCase(); return (orgs.data || []).filter((o) => !t || o.name.toLowerCase().includes(t) || (o.vat_number || '').includes(t) || (o.code || '').toLowerCase().includes(t)).slice(0, 40); }, [orgs.data, qq]);
  const sediOrg = (Array.isArray(sites.data) ? sites.data : sites.data?.sites || []).filter((x) => x.organization_id === org);
  const save = async () => { try { await api.put(`/synclab/clienti/${encodeURIComponent(c.client_id)}`, { azione: 'SCEGLI', organization_id: org, site_id: site ? Number(site) : null }); toast('Abbinamento salvato'); onSaved(); } catch (e) { toast(e, 'err'); } };
  return (
    <Modal title={`Legal entity del client ${c.client_code || ''}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={!org} onClick={save}>Salva</button></>}>
      <p className="small muted" style={{ marginTop: 0 }}>{c.legal_name}{c.operating_company ? ` · azienda operativa ${c.operating_company}` : ''}</p>
      <SearchInput value={qq} onChange={setQq} placeholder="Cerca per nome, codice o partita IVA" />
      <div className="table-wrap mt" style={{ maxHeight: 260, overflow: 'auto' }}><table className="t small"><tbody>
        {lista.map((o) => <tr key={o.id} className={`click ${org === o.id ? 'sel' : ''}`} onClick={() => { setOrg(o.id); setSite(''); }}><td><input type="radio" readOnly checked={org === o.id} /></td><td><b>{o.name}</b> <span className="muted">{o.code || ''}</span></td><td className="muted">{o.kind}</td><td className="muted">{o.vat_number || ''}</td></tr>)}
        {!lista.length && <tr><td className="muted">Nessuna Legal entity trovata</td></tr>}
      </tbody></table></div>
      {org ? <Field label="Sede (facoltativa)"><select value={site} onChange={(e) => setSite(e.target.value)}><option value="">nessuna</option>{sediOrg.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</select></Field> : null}
    </Modal>
  );
}

function Clienti({ qIniziale }) {
  const toast = useToast();
  const [qq, setQq] = useState(qIniziale || '');
  const [filtro, setFiltro] = useState('');
  const [scegli, setScegli] = useState(null);
  const d = useApi(`/synclab/clienti?q=${encodeURIComponent(qq)}&filtro=${filtro}`, [qq, filtro]);
  const azione = async (c, a) => { try { await api.put(`/synclab/clienti/${encodeURIComponent(c.client_id)}`, { azione: a }); toast('Salvato'); d.reload(); } catch (e) { toast(e, 'err'); } };
  const k = d.data?.conteggi;
  return (
    <>
    {/* v0.68.6: "Riallinea abbinamenti" e il riepilogo degli abbinamenti automatici in testa alla scheda */}
    <Abbinamenti onDone={d.reload} onScegli={(c) => setScegli(c)} />
    <Card title="Clienti Synclab" icon="building" className="mt" flush actions={<div className="row tight wrap">
      <SearchInput value={qq} onChange={setQq} placeholder="Cerca codice, ragione sociale, P.IVA" />
      <Seg value={filtro} onChange={setFiltro} label="Filtro" items={[{ value: '', label: 'Tutti' }, { value: 'DA_ABBINARE', label: 'Da abbinare' }, { value: 'B2B', label: 'Perimetro B2B' }, { value: 'NON_B2B', label: 'Fuori perimetro' }]} />
    </div>}>
      {k && <div className="small muted" style={{ padding: '10px 16px 0' }}>{n0(k.totale)} client del gestionale: {n0(k.confermati)} abbinati e confermati, {n0(k.proposti)} con una proposta da confermare, {n0(k.da_abbinare)} da abbinare; {n0(k.b2b)} nel perimetro B2B.</div>}
      <ErrorBox error={d.error} />
      {d.loading && !d.data && <div style={{ padding: 16 }}><Skeleton lines={4} /></div>}
      <div className="table-wrap"><table className="t" data-testid="synclab-clienti">
        <thead><tr><th>Codice</th><th>Ragione sociale</th><th>Attivo</th><th>Azienda operativa</th><th>Abbinamento</th><th>Perimetro B2B</th><th /></tr></thead>
        <tbody>
          {(d.data?.clienti || []).map((c) => {
            const [tone, lab] = ABBINAMENTO[c.stato_abbinamento] || ['grey', c.stato_abbinamento];
            return (
              <tr key={c.client_id}>
                <td className="mono nowrap">{c.client_code}</td>
                <td>{c.legal_name}{c.disponibilita !== 'ATTIVO' ? <div><Badge tone="grey" dot={false}>{c.disponibilita.toLowerCase().replace(/_/g, ' ')}</Badge></div> : null}</td>
                <td>{c.active ? 'sì' : <span className="muted">no</span>}</td>
                <td>{c.operating_company || ''}</td>
                <td><Badge tone={tone} dot={false}>{lab}</Badge>{c.organization_name ? <div className="small"><b>{c.organization_name}</b>{c.site_code ? <span className="muted"> · sede {c.site_code}{c.site_studiolab_code ? ` (codice ${c.site_studiolab_code})` : ' (senza codice)'}</span> : null}</div> : null}{c.stato_abbinamento === 'PROPOSTO' && c.regola_proposta ? <div className="small muted">dal {REGOLA[c.regola_proposta]}</div> : null}</td>
                <td>{c.perimetro_b2b ? <Badge tone="green" dot={false}>dentro</Badge> : <Badge tone="grey" dot={false}>fuori</Badge>} <span className="small muted">{c.perimetro_forzato == null ? 'calcolato' : 'forzato a mano'}</span></td>
                <td className="nowrap"><div className="row tight">
                  {c.stato_abbinamento === 'PROPOSTO' && <button className="btn sm" onClick={() => azione(c, 'ABBINA')} title="Conferma la Legal entity proposta">Abbina</button>}
                  <button className="btn sm ghost" onClick={() => setScegli(c)}>Scegli</button>
                  {c.perimetro_b2b ? <button className="btn sm ghost" onClick={() => azione(c, 'ESCLUDI')} title="Fuori dal perimetro B2B">Escludi</button> : <button className="btn sm ghost" onClick={() => azione(c, 'INCLUDI')} title="Dentro il perimetro B2B">Includi</button>}
                  {c.perimetro_forzato != null && <button className="btn sm ghost" onClick={() => azione(c, 'PERIMETRO_CALCOLATO')} title="Torna al perimetro calcolato">Ripristina</button>}
                </div></td>
              </tr>
            );
          })}
          {d.data && !d.data.clienti.length && <tr><td colSpan={7} className="empty">Nessun client Synclab: si importano con la sincronizzazione dell'insieme "Clienti".</td></tr>}
        </tbody>
      </table></div>
      <p className="small muted" style={{ padding: '0 16px 12px' }}>Proposta automatica: codice cliente uguale al codice StudioLAB di una sede della Suite (la Legal entity è quella della sede), altrimenti partita IVA o codice fiscale di una sola Legal entity. Perimetro B2B calcolato: client abbinati a una Legal entity cliente attiva o contrattualizzata del Business Hub; "Escludi" e "Includi" lo forzano. La medicina del lavoro (occupationalMedicine) non decide il perimetro.</p>
      {scegli && <ScegliModal c={scegli} onClose={() => setScegli(null)} onSaved={() => { setScegli(null); d.reload(); }} />}
    </Card>
    </>
  );
}

// v0.68.5: allineamento automatico degli abbinamenti (codice StudioLAB, codice della Legal entity o sede, partita IVA, nome e comune; la sede
// giusta per i gruppi con più sedi service) e casi ambigui da scegliere a mano. Regole: server/src/lib/synclab/abbinamenti.js.
function Abbinamenti({ onDone, onScegli }) {
  const toast = useToast();
  const d = useApi('/synclab/abbinamenti');
  const [busy, setBusy] = useState(false);
  const u = d.data?.ultimo;
  const riallinea = async () => {
    setBusy(true);
    try { const r = await api.post('/synclab/abbinamenti/riallinea', {}); toast(`Riallineati: ${r.abbinati.length} abbinati, ${r.codici_scritti.length} codici StudioLAB scritti, ${r.ambigui.length} ambigui`); d.reload(); onDone(); }
    catch (e) { toast(e, 'err'); } finally { setBusy(false); }
  };
  const ambigui = [...(u?.ambigui || []), ...(u?.sede_da_scegliere || [])];
  return (
    <Card title="Abbinamenti automatici" icon="tree" flush actions={<button className="btn sm" disabled={busy} onClick={riallinea} data-testid="riallinea-abbinamenti"><Icon name="refresh" />Riallinea abbinamenti</button>}>
      <ErrorBox error={d.error} />
      <div className="small" style={{ padding: '10px 16px 0' }}>{u ? <>Ultimo allineamento {fmtDateTime(u.at)} ({u.origine}): {n0(u.esaminati)} client esaminati, {n0(u.abbinati)} abbinati, {n0(u.sedi_completate)} sedi completate, {n0((u.codici_scritti || []).length)} codici StudioLAB scritti nelle sedi, {n0(u.gia_abbinati)} già abbinati, {n0(u.senza_candidati)} senza candidati, {n0((u.ambigui || []).length)} ambigui, {n0((u.sede_da_scegliere || []).length)} con la sede da scegliere, {n0((u.conflitti || []).length)} conflitti di codice.</> : <span className="muted">Mai eseguito: parte da solo dopo ogni sincronizzazione dei clienti e ogni 6 ore.</span>}</div>
      {ambigui.length > 0 && <div className="table-wrap"><table className="t small" data-testid="synclab-ambigui">
        <thead><tr><th>Client</th><th>Motivo</th><th>Candidati</th><th /></tr></thead>
        <tbody>{ambigui.map((x) => <tr key={`${x.client_id}-${x.organization_id || ''}`}><td><span className="mono">{x.client_code}</span> {x.legal_name}</td><td>{x.motivo}{x.organization_name ? <div className="muted">Legal entity: {x.organization_name}</div> : null}</td>
          <td>{(x.candidati || []).map((c) => c.name || c.code).join(' · ') || <span className="muted">–</span>}</td>
          <td><button className="btn sm ghost" onClick={() => onScegli({ client_id: x.client_id, client_code: x.client_code, legal_name: x.legal_name, organization_id: x.organization_id || null, site_id: null })}>Scegli</button></td></tr>)}</tbody>
      </table></div>}
      {(u?.conflitti || []).length > 0 && <div className="small" style={{ padding: '6px 16px' }}><b>Conflitti di codice (nessuna sovrascrittura):</b> {u.conflitti.map((c) => `${c.client_code} → ${c.site_name}: ${c.motivo}`).join(' · ')}</div>}
      <p className="small muted" style={{ padding: '8px 16px 12px', margin: 0 }}>Regole, in ordine: codice cliente = codice StudioLAB di una sede; = codice della Legal entity (es. SER0033) o di una sede; partita IVA o codice fiscale di una sola Legal entity; ragione sociale normalizzata identica e stesso comune. Più Legal entity con la stessa regola = ambiguo. La sede è quella con lo stesso indirizzo, comune o nome della sede del client nel gestionale (per Toscana Diagnostica fra i punti e i centri, per i clienti fra le sedi SERVICE). Il codice StudioLAB si scrive nella sede solo se è vuota e se nessun'altra sede lo ha (audit "codice StudioLAB dal gestionale"); un abbinamento tolto a mano non viene rifatto.</p>
    </Card>
  );
}

// v0.68.6 (CEO 10/11/2026: discrepanza fra l'accettato di StudioLab e la Suite): quadratura con il report "Riepilogo Esami" del gestionale.
// Si carica il PDF (letto lato server con pdftotext, nessun file conservato) o si incolla il testo o si scrivono periodo e totali; la
// Suite confronta il totale nelle 4 varianti (stati accettato/erogati × sconto di testata sì/no) e, per cliente, attribuisce le cause.
// Regole: server/src/lib/synclab/quadratura.js; dati della Suite: lettura `quadratura` di lib/synclab/letture.js.
const eur2 = (v) => (v == null ? '–' : Number(v).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, useGrouping: 'always' }));
const ggmmaaaa = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const ESITI_Q = { QUADRA: ['green', 'quadra'], SPIEGATA: ['blue', 'spiegata'], NON_SPIEGATA: ['red', 'non spiegata'], SOLO_REPORT: ['amber', 'solo nel report'], SOLO_SUITE: ['amber', 'solo nella Suite'] };
function Diff({ v, eur = true }) {
  if (v == null) return <span className="faint">–</span>;
  const z = Math.abs(Number(v)) <= (eur ? 0.05 : 0);
  return <span className={z ? 'green' : 'red'}>{Number(v) > 0 ? '+' : ''}{eur ? eur2(v) : n0(v)}</span>;
}
function Cause({ cause }) {
  if (!cause?.length) return <span className="faint small">–</span>;
  return <ul className="small" style={{ margin: 0, paddingLeft: 16 }}>{cause.map((c) => <li key={c.codice} className={c.spiega ? '' : 'muted'}>{c.spiega ? <b>{c.testo}</b> : c.testo}{c.n != null ? ` · ${n0(c.n)}` : ''}{c.effetto != null && Number(c.effetto) !== 0 ? ` · ${eur2(c.effetto)}` : ''}{c.effetto_qta ? ` · ${n0(c.effetto_qta)} esami` : ''}{c.spiega ? ' ✓' : ''}</li>)}</ul>;
}
function Quadratura({ s, onSaved }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [testo, setTesto] = useState('');
  const [man, setMan] = useState({ da: '', a: '', importo: '', qta: '' });
  const [out, setOut] = useState(null);
  const [busy, setBusy] = useState(false);
  const [filtro, setFiltro] = useState('');
  const [adotta, setAdotta] = useState(null);
  const invia = async (extra = {}) => {
    setBusy(true);
    try {
      let r;
      if (extra.report) r = await api.post('/synclab/quadratura', { report: extra.report, variante: extra.variante || '' });
      else if (file) { const fd = new FormData(); fd.append('file', file); if (man.da && man.a) { fd.append('da', man.da); fd.append('a', man.a); } r = await api.upload('/synclab/quadratura', fd); }
      else if (testo.trim()) r = await api.post('/synclab/quadratura', { testo, da: man.da || undefined, a: man.a || undefined });
      else r = await api.post('/synclab/quadratura', { da: man.da, a: man.a, importo: man.importo, qta: man.qta });
      setOut(r);
    } catch (e) { toast(e, 'err'); } finally { setBusy(false); }
  };
  const esporta = async () => {
    try {
      const res = await fetch('/api/synclab/quadratura/xlsx', { method: 'POST', credentials: 'same-origin', headers: { 'X-Requested-With': 'td-suite', 'Content-Type': 'application/json' }, body: JSON.stringify({ report: out.report, variante: out.risultato.variante.chiave }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Errore ${res.status}`);
      const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = `Quadratura_StudioLab_${out.report.periodo.da}_${out.report.periodo.a}.xlsx`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { toast(e, 'err'); }
  };
  const salvaDefinizione = async (v) => {
    try { await api.put('/synclab/impostazioni', { stati_erogati: v.stati, sconto_testata: v.sconto }); toast(`Definizione adottata: stati ${v.stati.join(', ')}, sconto di testata ${v.sconto === 'APPLICA' ? 'applicato' : 'non applicato'}`); onSaved?.(); invia({ report: out.report, variante: v.chiave }); }
    catch (e) { toast(e, 'err'); }
  };
  const q = out?.risultato;
  const righe = (q?.righe || []).filter((r) => !filtro || (filtro === 'DA_VEDERE' ? ['NON_SPIEGATA', 'SOLO_REPORT', 'SOLO_SUITE'].includes(r.esito) : ['QUADRA', 'SPIEGATA'].includes(r.esito)));
  return (
    <>
      <Card title="Report di StudioLab" icon="upload" data-testid="quadratura-input">
        <p className="small muted" style={{ marginTop: 0 }}>Il report <b>Riepilogo Esami</b> del gestionale (per cliente, dal … al …) è l'accettato: tutte le accettazioni del periodo, una riga per codice esame con Q.ta e importo, comprese le righe senza importo (componenti di profilo). Il PDF si legge sul server e non viene conservato; il report non contiene dati di pazienti.</p>
        <div className="grid2" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
          <div>
            <DropZone accept="application/pdf,.pdf" multiple={false} compact onFiles={(fs) => { setFile(fs[0]); setTesto(''); }}>
              <Icon name="upload" /><div className="small">{file ? <><b>{file.name}</b> · {(file.size / 1024).toLocaleString('it-IT', { maximumFractionDigits: 0 })} KB</> : 'Trascina qui il PDF "Riepilogo Esami" oppure clicca per sceglierlo'}</div>
            </DropZone>
            {file && <button className="btn sm ghost mt" onClick={() => setFile(null)}>Togli il PDF</button>}
            <Field label="oppure incolla il testo del report" className="mt"><textarea rows={4} value={testo} onChange={(e) => { setTesto(e.target.value); if (e.target.value) setFile(null); }} placeholder={'Riepilogo Esami  Dal 01/11/2026 al 09/11/2026\n…\nTotale globale:   …'} data-testid="quadratura-testo" /></Field>
          </div>
          <div>
            <div className="small muted" style={{ marginBottom: 6 }}>oppure periodo e totali a mano (il periodo vale anche per il PDF o il testo che non lo riportano)</div>
            <div className="form-grid">
              <Field label="Dal"><input type="date" value={man.da} onChange={(e) => setMan({ ...man, da: e.target.value })} data-testid="quadratura-da" /></Field>
              <Field label="Al"><input type="date" value={man.a} onChange={(e) => setMan({ ...man, a: e.target.value })} data-testid="quadratura-a" /></Field>
              <Field label="Totale globale (importo, €)"><input inputMode="decimal" value={man.importo} onChange={(e) => setMan({ ...man, importo: e.target.value })} placeholder="es. 18.672,22" data-testid="quadratura-importo" /></Field>
              <Field label="Totale esami (Q.ta)"><input inputMode="numeric" value={man.qta} onChange={(e) => setMan({ ...man, qta: e.target.value })} placeholder="es. 2.578" /></Field>
            </div>
          </div>
        </div>
        <div className="row mt"><button className="btn" disabled={busy || (!file && !testo.trim() && !(man.da && man.a && man.importo))} onClick={() => invia()} data-testid="quadratura-confronta"><Icon name="stats" />{busy ? 'Confronto in corso…' : 'Confronta con la Suite'}</button></div>
      </Card>
      {q && (
        <>
          <Card title={`Totale: report e Suite dal ${ggmmaaaa(q.periodo.da)} al ${ggmmaaaa(q.periodo.a)}`} icon="stats" className="mt" flush data-testid="quadratura-varianti"
            actions={<button className="btn sm ghost" onClick={esporta} data-testid="quadratura-xlsx"><Icon name="download" />Esporta XLSX</button>}>
            <div className="small" style={{ padding: '10px 16px 0' }}>Report ({out.report.origine || 'letto'}): <b>{n0(q.totale.report.qta)} esami</b> · <b>{eur2(q.totale.report.importo)}</b>{out.report.clienti?.length ? ` · ${n0(out.report.clienti.length)} sottototali per cliente` : ''}. Copia delle accettazioni: {q.copia?.checkpoint_at ? fmtDateTime(q.copia.checkpoint_at) : 'nessuna'}{q.copia_prima_della_fine ? <span className="amber"> (non copre tutto l'ultimo giorno del periodo)</span> : null}.</div>
            {(q.report.avvisi || []).length > 0 && <div className="alert warn small" style={{ margin: '8px 16px 0' }}><Icon name="alert" /><span>{q.report.avvisi.join(' · ')}</span></div>}
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Variante</th><th className="num">Esami Suite</th><th className="num">Importo Suite</th><th className="num">Differenza</th><th>Esito</th><th /></tr></thead>
              <tbody>{q.varianti.map((v) => (
                <tr key={v.chiave} className={v.coincide ? 'sel' : ''} data-testid={`variante-${v.chiave}`}>
                  <td><b>{v.etichetta}</b> {v.in_vigore ? <Badge tone="blue" dot={false}>in vigore</Badge> : null}<div className="small muted">stati <span className="mono">{v.stati.join(', ')}</span> · sconto di testata {v.sconto === 'APPLICA' ? 'applicato' : 'non applicato'}</div></td>
                  <td className="num">{n0(v.quantita)}<div className="small muted">{n0(v.righe_senza_prezzo)} senza prezzo</div></td>
                  <td className="num"><b>{eur2(v.importo)}</b></td>
                  <td className="num nowrap"><Diff v={v.differenza} /><div className="small"><Diff v={v.differenza_qta} eur={false} /> esami</div></td>
                  <td>{v.coincide ? <Badge tone="green" dot={false}>coincide</Badge> : v.migliore ? <Badge tone="amber" dot={false}>più vicina</Badge> : null}</td>
                  <td className="nowrap"><div className="row tight">
                    <button className={`btn sm ${q.variante.chiave === v.chiave ? '' : 'ghost'}`} onClick={() => invia({ report: out.report, variante: v.chiave })}>Per cliente</button>
                    {!v.in_vigore && <button className="btn sm ghost" onClick={() => setAdotta(v)} data-testid={`adotta-${v.chiave}`}>Adotta questa definizione</button>}
                  </div></td>
                </tr>))}</tbody>
            </table></div>
            <div style={{ padding: '4px 16px 12px' }}>
              <div className="small"><b>Cause sul totale ({q.variante.etichetta}):</b> differenza {eur2(q.totale.differenza.importo)} e {n0(q.totale.differenza.qta)} esami</div>
              <Cause cause={q.totale.cause} />
            </div>
          </Card>
          <Card title={`Per cliente · ${q.variante.etichetta}`} icon="building" className="mt" flush data-testid="quadratura-clienti"
            actions={<Seg value={filtro} onChange={setFiltro} label="Filtro" items={[{ value: '', label: `Tutti (${q.righe.length})` }, { value: 'DA_VEDERE', label: `Da vedere (${(q.conteggi.NON_SPIEGATA || 0) + (q.conteggi.SOLO_REPORT || 0) + (q.conteggi.SOLO_SUITE || 0)})` }, { value: 'OK', label: `Quadrano o spiegate (${(q.conteggi.QUADRA || 0) + (q.conteggi.SPIEGATA || 0)})` }]} />}>
            <div className="table-wrap"><table className="t small">
              <thead><tr><th>Esito</th><th>Nel report</th><th>Client Synclab</th><th className="num">Report</th><th className="num">Suite</th><th className="num">Differenza</th><th>Causa</th></tr></thead>
              <tbody>{righe.map((r, i) => { const [tone, lab] = ESITI_Q[r.esito] || ['grey', r.esito]; return (
                <tr key={i}>
                  <td><Badge tone={tone} dot={false}>{lab}</Badge></td>
                  <td>{(r.report?.nomi || []).map((n) => <div key={n}>{n}</div>)}{!r.report && <span className="faint">–</span>}</td>
                  <td>{r.clienti.map((c) => <div key={c.client_id}><span className="mono">{c.client_code || c.client_id}</span> {c.legal_name}{c.sede_gestionale ? <span className="muted"> · {c.sede_gestionale}</span> : null}{c.ripartizione === 'LAB_SEDE' ? <span className="muted"> · in sede</span> : null}</div>)}{!r.clienti.length && <span className="faint">–</span>}</td>
                  <td className="num nowrap">{r.report ? <><b>{eur2(r.report.importo)}</b><div>{n0(r.report.qta)} esami</div></> : '–'}</td>
                  <td className="num nowrap">{r.suite ? <><b>{eur2(r.suite.importo)}</b><div>{n0(r.suite.quantita)} esami</div>{r.suite.righe_senza_prezzo ? <div className="muted">di cui {n0(r.suite.righe_senza_prezzo)} senza prezzo</div> : null}{r.suite.sconto_testata ? <div className="muted">sconti di testata {eur2(r.suite.sconto_testata)}</div> : null}</> : '–'}</td>
                  <td className="num nowrap"><Diff v={r.differenza.importo} /><div><Diff v={r.differenza.qta} eur={false} /> esami</div></td>
                  <td style={{ minWidth: 240 }}>{r.esito === 'QUADRA' ? <span className="faint">nessuna differenza</span> : <Cause cause={r.cause} />}</td>
                </tr>); })}
              {!righe.length && <tr><td colSpan={7} className="empty">{q.report.clienti ? 'Nessun cliente con questo filtro.' : 'Report senza sottototali per cliente: confronto solo sul totale.'}</td></tr>}</tbody>
            </table></div>
            <div className="small muted" style={{ padding: '8px 16px 12px' }}>{q.note.join(' · ')}. Abbinamento dei nomi: ragione sociale normalizzata (senza S.r.l., S.p.A. e punteggiatura), suffisso di reparto " - …" tollerato (con più client dello stesso cliente si sceglie quello del reparto, altrimenti si sommano), nomi troncati dal report a circa 45 caratteri.</div>
          </Card>
        </>
      )}
      {adotta && <ConfirmModal title="Adotta questa definizione" text={`Tutti i cruscotti useranno: stati ${adotta.stati.join(', ')}; sconto di testata ${adotta.sconto === 'APPLICA' ? 'applicato (netto vero)' : 'non applicato (importi di riga, come il report)'}. Si può cambiare in ogni momento da Impostazioni.`} confirmText="Adotta" onConfirm={() => { const v = adotta; setAdotta(null); salvaDefinizione(v); }} onClose={() => setAdotta(null)} />}
    </>
  );
}

function Storico() {
  const d = useApi('/synclab/run?limit=20');
  return (
    <Card title="Ultimi 20 cicli" icon="list" flush>
      <ErrorBox error={d.error} />
      <div className="table-wrap"><table className="t small" data-testid="synclab-run">
        <thead><tr><th>Inizio</th><th>Insieme</th><th>Tipo</th><th>Origine</th><th>Esito</th><th className="num">Pagine</th><th className="num">Record</th><th>Operazioni</th><th className="num">Durata</th><th>Errore · correlationId</th></tr></thead>
        <tbody>
          {(d.data || []).map((r) => (
            <tr key={r.id}>
              <td className="nowrap">{fmtDateTime(r.iniziato)}</td>
              <td>{NOMI[r.dataset]}{r.prima_importazione ? <div><Badge tone="blue" dot={false}>prima importazione</Badge></div> : null}</td>
              <td>{TIPI[r.tipo]}</td>
              <td>{ORIGINI[r.origine] || (r.origine || '').toLowerCase()}</td>
              <td><Badge tone={ESITO_TONE[r.esito] || 'grey'} dot={false}>{r.esito.toLowerCase().replace('_', ' ')}</Badge></td>
              <td className="num">{n0(r.pagine)}</td>
              <td className="num">{n0(r.record)}</td>
              <td className="muted">{[['aggiornati', r.upsert], ['rimossi', r.remove], ['fuori ambito', r.fuori_ambito], ['archiviati', r.archived], ['uscita incerta', r.unavailable], ['già applicati', r.gia_applicati], ['verificati', r.verificati]].filter(([, v]) => v).map(([l, v]) => `${l} ${n0(v)}`).join(' · ') || '–'}</td>
              <td className="num nowrap">{durata(r.durata_ms)}{r.attesa_ms ? <div className="muted">attesa {durata(r.attesa_ms)}</div> : null}</td>
              <td style={{ minWidth: 180 }}>{r.errore ? <span className="red">{r.errore}</span> : null}{r.correlation_id ? <div className="mono muted">{r.correlation_id}</div> : null}</td>
            </tr>
          ))}
          {d.data && !d.data.length && <tr><td colSpan={10} className="empty">Nessun ciclo eseguito.</td></tr>}
        </tbody>
      </table></div>
    </Card>
  );
}

export function SynclabDati() {
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'stato';
  const d = useApi('/synclab/stato');
  const s = d.data;
  // durante un ciclo la pagina si aggiorna da sola ogni 4 secondi
  useEffect(() => { if (!s?.in_corso) return undefined; const t = setInterval(() => d.reload(), 4000); return () => clearInterval(t); }, [s?.in_corso, d.reload]);
  const avvia = async (dataset, modo) => {
    try { await api.post('/synclab/sincronizza', { dataset, modo }); toast(`${modo === 'COMPLETO' ? 'Completo avviato' : 'Sincronizzazione avviata'}: ${dataset ? NOMI[dataset].toLowerCase() : 'tutti gli insiemi di dati'}`); setTimeout(d.reload, 800); }
    catch (e) { toast(e, 'err'); }
  };
  return (
    <div className="page">
      <PageHead title="Dati Synclab (Data API v1)" icon="stats" crumb={<Link to="/admin/connectors">Connettori</Link>}
        sub="Copia locale in sola lettura dei dati del gestionale di laboratorio: clienti, esami, listini, accettazioni e documenti economici. Alimenta il Controllo di gestione, il catalogo esami di Ordini, il Cockpit e la Diagnostica."
        actions={<button className="btn ghost sm" onClick={d.reload}><Icon name="refresh" />Aggiorna</button>} />
      <ErrorBox error={d.error} />
      {!s && !d.error && <Card><Skeleton lines={5} /></Card>}
      {s && (
        <>
          <div className="row wrap small" style={{ gap: 14, marginBottom: 12 }}>
            <span>Data API: {s.impostazioni.data_api_enabled ? <Badge tone="green">abilitata</Badge> : <Badge tone="grey">spenta</Badge>}</span>
            <span>Ciclo notturno: dalle {s.impostazioni.sync_ora}{s.notturno ? ` · ultimo del ${s.notturno.data} (${s.notturno.esito === 'OK' ? 'riuscito' : 'con errori'})` : ' · mai eseguito'}</span>
            <span>Client: <span className="mono">{s.connettore.client_name || 'non impostato'}</span></span>
            {s.in_corso && <span><Badge tone="blue">in corso: {NOMI[s.in_corso.dataset]}</Badge> dal {timeAgo(s.in_corso.dal)}</span>}
          </div>
          {s.connettore.auth_kind !== 'CLIENT_JWT' && <div className="alert warn small mb"><Icon name="alert" /><span>Il connettore StudioLAB non usa il "Client registrato con token": la Data API richiede il login del client (nome e password) in <Link to="/admin/connectors">Connettori</Link>.</span></div>}
          <Tabs value={tab} onChange={(v) => { const n = new URLSearchParams(sp); n.set('tab', v); n.delete('q'); setSp(n, { replace: true }); }} items={[{ value: 'stato', label: 'Stato' }, { value: 'clienti', label: 'Clienti Synclab' }, { value: 'quadratura', label: 'Quadratura' }, { value: 'impostazioni', label: 'Impostazioni' }, { value: 'storico', label: 'Storico dei cicli' }]} />
          <div className="mt">
            {tab === 'stato' && <Stato s={s} onAvvia={avvia} onSaved={d.reload} />}
            {tab === 'quadratura' && <Quadratura s={s} onSaved={d.reload} />}
            {tab === 'clienti' && <Clienti qIniziale={sp.get('q') || ''} />}
            {tab === 'impostazioni' && <Impostazioni s={s} onSaved={d.reload} />}
            {tab === 'storico' && <Storico />}
          </div>
        </>
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, BASE } from '../api.js';
import { useApi, Field, Loading, Empty, Badge, Modal, ErrorBox, Card, Icon, useToast } from '../components/ui.jsx';
import { KIND, STRUTTURA_ORIGIN, ORG_KIND, SITE_KIND, monthLabel } from '../format.js';

// Strutture: elenco unico delle due origini dell'anagrafica unica della Suite, sedi TD (public.sites, tranne i punti SERVICE) e
// Legal entity (public.organizations: clienti del service di laboratorio, partner, fornitori, società del gruppo), con le
// impostazioni di Ordini e Magazzino (site_ext / org_ext). I punti dei clienti service compaiono come punti di consegna sotto la
// loro Legal entity. Qui non si crea, rinomina o disattiva nulla: si fa in Amministrazione > Sedi o > Legal entity. Si modificano
// solo i campi operativi del modulo: ruolo nel flusso ordini, codice Silva, giorno limite della giacenza, modalità e note di consegna.
// Il referente è il responsabile di sede dell'organigramma (sedi TD) o il telefono ed email della Legal entity: dal core (docs/IMPOSTAZIONI.md).
const ADMIN_SITES = '/admin/sites';
const ADMIN_ORGS = '/admin/organizations';
const FIELDS = ['kind', 'silva_code', 'stock_deadline_day', 'delivery_mode', 'delivery_notes', 'notes'];
const adminHref = (s) => (s.origin === 'ORG' ? ADMIN_ORGS : ADMIN_SITES);
const adminLabel = (s) => (s.origin === 'ORG' ? 'Apri in Legal entity' : 'Apri in Sedi');
const typeLabel = (s) => (s.origin === 'ORG' ? ORG_KIND[s.org_kind] || s.org_kind : SITE_KIND[s.site_kind] || s.site_kind);

export default function Strutture() {
  const [params, setParams] = useSearchParams();
  const vista = params.get('vista') === 'silva' ? 'silva' : 'elenco';
  const setVista = (v) => setParams(v === 'silva' ? { vista: 'silva' } : {}, { replace: true });
  const tabs = <div className="row" style={{ gap: 6, marginBottom: 12 }}><button className={`btn sm ${vista === 'elenco' ? '' : 'ghost'}`} onClick={() => setVista('elenco')}>Strutture</button><button className={`btn sm ${vista === 'silva' ? '' : 'ghost'}`} onClick={() => setVista('silva')}>Destinazioni Silva</button></div>;
  if (vista === 'silva') return <DestinazioniSilva tabs={tabs} />;
  return <ElencoStrutture tabs={tabs} />;
}

function ElencoStrutture({ tabs }) {
  const toast = useToast();
  const silva = useApi('/silva/strutture');
  const destinazioni = silva.data?.destinazioni || [];
  const [origin, setOrigin] = useState('');
  const [kind, setKind] = useState('');
  const [show, setShow] = useState('active');   // active | all
  const { data, reload } = useApi(`/strutture${show === 'all' ? '?all=1' : ''}`, [show]);
  const [edit, setEdit] = useState(null);
  const [puntoEdit, setPuntoEdit] = useState(null);
  const [err, setErr] = useState(null);
  const [search, setSearch] = useState('');
  // impostazioni di consegna di un punto service (v0.68.3): destinazione Silva, modalità e note di consegna
  const apriPunto = async (p, le) => {
    setErr(null);
    try { const x = await api.get(`/strutture/${p.id}`); setPuntoEdit({ id: x.id, name: x.name, code: x.code, le: le.name, address: [x.address, [x.zip, x.city].filter(Boolean).join(' ')].filter(Boolean).join(', '), silva_code: x.silva_code || '', silva_code_orig: x.silva_code || '', delivery_mode: x.delivery_mode || 'GIRO', delivery_notes: x.delivery_notes || '' }); } catch (e) { setErr(e); }
  };
  const salvaPunto = async () => {
    setErr(null);
    const b = { delivery_mode: puntoEdit.delivery_mode, delivery_notes: puntoEdit.delivery_notes || null };
    if ((puntoEdit.silva_code || '') !== (puntoEdit.silva_code_orig || '')) b.silva_code = puntoEdit.silva_code || null;
    try { await api.put(`/strutture/${puntoEdit.id}`, b); toast(`Impostazioni di consegna di ${puntoEdit.name} salvate`); setPuntoEdit(null); reload(); silva.reload(); } catch (e) { setErr(e); }
  };
  const rows = (data || []).filter((s) => (!origin || s.origin === origin) && (!kind || s.kind === kind)
    && (!search || `${s.code} ${s.name} ${s.city || ''} ${s.organization_name || ''} ${s.silva_code || ''} ${s.studiolab_code || ''} ${(s.points || []).map((p) => `${p.code} ${p.name} ${p.studiolab_code || ''}`).join(' ')}`.toLowerCase().includes(search.toLowerCase())));
  const unconfigured = (data || []).filter((s) => !s.configured).length;
  const nSites = (data || []).filter((s) => s.origin === 'SITE').length;
  const nOrgs = (data || []).filter((s) => s.origin === 'ORG').length;
  const openEdit = (s) => setEdit({ id: s.id, origin: s.origin, code: s.code, name: s.name, type: typeLabel(s), configured: s.configured, kind: s.kind, silva_code: s.silva_code || '', silva_code_orig: s.silva_code || '', stock_deadline_day: s.stock_deadline_day, referente: s.referente || '', referente_phone: s.referente_phone || '', referente_role: s.referente_role || '', email: s.email || '', delivery_mode: s.delivery_mode || 'GIRO', delivery_notes: s.delivery_notes || '', notes: s.notes || '', points: s.points || [] });
  const save = async () => {
    setErr(null);
    const b = Object.fromEntries(FIELDS.map((k) => [k, edit[k] === '' ? null : edit[k]]));
    b.stock_deadline_day = Number(b.stock_deadline_day) || null;
    if ((edit.silva_code || '') === (edit.silva_code_orig || '')) delete b.silva_code;   // un codice storico non numerico non blocca le altre modifiche
    try { await api.put(`/strutture/${edit.id}`, b); toast(edit.configured ? 'Impostazioni Ordini salvate' : 'Struttura configurata in Ordini'); setEdit(null); reload(); silva.reload(); } catch (e) { setErr(e); }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Strutture</h1><div className="sub">Chi ordina e riceve materiale, dall'anagrafica unica della Suite: le sedi TD e le Legal entity (clienti del service di laboratorio, partner, fornitori, società del gruppo). I punti dei clienti service stanno sotto la loro Legal entity come punti di consegna. Qui si impostano solo i campi di Ordini e Magazzino: ruolo nel flusso (cliente Service ordina dal catalogo, sede del network dichiara la giacenza entro il 15, laboratorio TD entro il 30), codice Silva, referente per le consegne. Nome, indirizzo, contatti e stato si modificano in Amministrazione.</div></div>
        <div className="row">
          <Field label="Cerca"><input placeholder="Codice, nome, città, punto di consegna" value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
          <Field label="Tipo"><select value={origin} onChange={(e) => setOrigin(e.target.value)}><option value="">Tutte ({nSites + nOrgs})</option><option value="SITE">Sede TD ({nSites})</option><option value="ORG">Legal entity ({nOrgs})</option></select></Field>
          <Field label="Ruolo"><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Tutti</option>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Mostra"><select value={show} onChange={(e) => setShow(e.target.value)}><option value="active">Attive</option><option value="all">Anche disattivate</option></select></Field>
          <a className="btn ghost" href={ADMIN_SITES} title="Creare, rinominare o disattivare una sede si fa in Amministrazione"><Icon name="building" size={16} />Apri in Sedi</a>
          <a className="btn ghost" href={ADMIN_ORGS} title="Creare, rinominare o disattivare una Legal entity si fa in Amministrazione"><Icon name="building" size={16} />Apri in Legal entity</a>
        </div>
      </div>
      {tabs}
      <ErrorBox error={err} />
      {unconfigured > 0 && <div className="alert info" style={{ marginBottom: 12 }}>{unconfigured} {unconfigured === 1 ? 'struttura usa' : 'strutture usano'} le impostazioni predefinite (ruolo dedotto dal tipo: punto TD = sede del network, laboratorio = laboratorio TD, Legal entity = cliente Service; giacenza entro il 15 o il 30): apri "Impostazioni" per confermarle o cambiarle.</div>}
      <Card flush>
        {!data ? <Loading /> : !rows.length ? <Empty>Nessuna struttura{data && !data.length && <>: sedi e Legal entity si caricano in Amministrazione (<a href={ADMIN_SITES}>Sedi</a>, <a href={ADMIN_ORGS}>Legal entity</a>)</>}</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Codice</th><th>Struttura</th><th>Tipo</th><th>Ruolo in Ordini</th><th>Referente consegne</th><th>Codici</th><th className="num">Ordini aperti</th><th className="num">In giacenza</th><th>Stato</th><th /></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id}>
                <td className="mono" style={{ whiteSpace: 'nowrap' }}>{s.code}</td>
                <td>
                  <div className="strong">{s.name}</div>
                  <div className="small muted">{[typeLabel(s), s.origin === 'SITE' && s.organization_name, s.city].filter(Boolean).join(' · ')}</div>
                  {s.email && <div className="small muted">{s.email}</div>}
                  {s.origin === 'ORG' && s.points?.length > 0 && (
                    <div className="small" style={{ marginTop: 4 }}><span className="muted">Punti di consegna:</span> {s.points.map((p) => <span key={p.id} title={`Codice StudioLab ${p.studiolab_code || '–'}${p.active ? '' : ' · disattivo'}`} style={{ marginRight: 8, whiteSpace: 'nowrap' }}><span className="mono">{p.code}</span> {p.name}{p.city ? ` (${p.city})` : ''}{p.active ? <button className="btn sm ghost" style={{ marginLeft: 4, padding: "1px 8px" }} title="Destinazione Silva, modalità e note di consegna del punto" onClick={() => apriPunto(p, s)}>consegna</button> : <span className="muted"> · disattivo</span>}</span>)}</div>
                  )}
                </td>
                <td><Badge tone={s.origin === 'ORG' ? 'blue' : 'teal'}>{STRUTTURA_ORIGIN[s.origin]}</Badge></td>
                <td>{KIND[s.kind]}{s.kind !== 'CLIENTE' && <div className="small muted">giacenza entro il {s.stock_deadline_day}{s.last_stock_month ? ` · ultima ${monthLabel(s.last_stock_month)}` : ''}</div>}{!s.configured && <div className="small"><Badge tone="mauve">predefinito</Badge></div>}</td>
                <td className="small">{s.referente || <span className="muted">–</span>}{s.referente_phone && <div className="muted">{s.referente_phone}</div>}{s.delivery_mode === 'RITIRO' && <div className="muted">ritiro presso TD</div>}</td>
                <td className="mono small" style={{ whiteSpace: 'nowrap' }}>{s.origin === 'SITE' && <div title="Codice StudioLab">SL {s.studiolab_code || '–'}</div>}<div title="Destinazione Silva">SV {s.silva_code || '–'}</div>{s.origin === 'ORG' && s.vat_number && <div title="Partita IVA">PI {s.vat_number}</div>}</td>
                <td className="num"><Link to={`${BASE}/ordini?struttura_id=${s.id}`}>{s.open_orders}</Link></td>
                <td className="num">{s.packs_in_stock}</td>
                <td>{s.active ? <Badge tone="green">Attiva</Badge> : <Badge tone="red">Disattiva</Badge>}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}><Link className="btn sm ghost" to={`${BASE}/giacenza?struttura_id=${s.id}`}>Giacenza</Link> <button className="btn sm ghost" onClick={() => openEdit(s)}>Impostazioni</button> <a className="btn sm ghost" href={adminHref(s)} title="Dati anagrafici in Amministrazione">{adminLabel(s)}</a></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>
      {edit && (
        <Modal title={`Impostazioni Ordini · ${edit.name}`} onClose={() => setEdit(null)} wide footer={<><a className="btn ghost" href={adminHref(edit)}>{adminLabel(edit)}</a><button className="btn ghost" onClick={() => setEdit(null)}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}>
          <ErrorBox error={err} />
          <div className="small muted" style={{ marginBottom: 12 }}>{STRUTTURA_ORIGIN[edit.origin]} {edit.code} · {edit.type}. Nome, indirizzo di consegna, email e telefono vengono dall'anagrafica unica.{edit.origin === 'ORG' && edit.points.length > 0 && <> Punti di consegna: {edit.points.map((p) => `${p.code} ${p.name}`).join(', ')}.</>}</div>
          <div className="form-grid">
            <Field label="Ruolo nel flusso ordini" help="Cliente Service ordina dal catalogo e il materiale consegnato è in carico al cliente; sede del network e laboratorio TD caricano, scaricano e dichiarano la giacenza mensile"><select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value, stock_deadline_day: e.target.value === 'LAB' ? 30 : e.target.value === 'SEDE' ? 15 : edit.stock_deadline_day })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <Field label="Destinazione Silva" help={destinazioni.length ? `Sedi autorizzate da Silva (${destinazioni.length}, lette il ${new Date(silva.data.letto_al).toLocaleString('it-IT')}): nella POST va solo il codice, nome e indirizzo li prende Silva` : 'Elenco non ancora letto: "Aggiorna destinazioni" nella scheda Destinazioni Silva'}>
              <select value={edit.silva_code} onChange={(e) => setEdit({ ...edit, silva_code: e.target.value })}>
                <option value="">Nessuna (gli ordini non si trasmettono)</option>
                {edit.silva_code && !destinazioni.some((d) => d.codice === edit.silva_code) && <option value={edit.silva_code}>{edit.silva_code} · non tra le destinazioni lette</option>}
                {destinazioni.map((d) => <option key={d.codice} value={d.codice}>{destLabel(d)}</option>)}
              </select>
            </Field>
            {edit.kind !== 'CLIENTE' && <Field label="Giacenza mensile entro il giorno"><input type="number" min="1" max="31" value={edit.stock_deadline_day} onChange={(e) => setEdit({ ...edit, stock_deadline_day: e.target.value })} /></Field>}
            <Field label="Modalità di consegna"><select value={edit.delivery_mode} onChange={(e) => setEdit({ ...edit, delivery_mode: e.target.value })}><option value="GIRO">Giro logistico TD</option><option value="RITIRO">Ritiro presso TD</option></select></Field>
            <Field label={edit.origin === 'ORG' ? 'Referente (contatti della Legal entity)' : 'Referente (responsabile di sede)'} help={edit.origin === 'ORG' ? <>Telefono ed email della Legal entity: si modificano in <Link to="/admin/organizations">Amministrazione, Legal entity</Link></> : <>Responsabile del nodo Sede nell'organigramma: si assegna in <Link to="/admin/organization">Amministrazione, Organizzazione</Link></>}><input value={edit.origin === 'ORG' ? [edit.referente_phone, edit.email].filter(Boolean).join(' · ') : edit.referente ? `${edit.referente}${edit.referente_role ? ` · ${edit.referente_role}` : ''}` : ''} disabled placeholder={edit.origin === 'ORG' ? 'nessun contatto in Amministrazione' : 'da assegnare nell\'organigramma'} /></Field>
            {edit.origin !== 'ORG' && <Field label="Telefono del referente" help="Cellulare o telefono ufficio della persona, altrimenti il telefono della sede (Amministrazione, Persone e Sedi)"><input value={edit.referente_phone} disabled placeholder="non indicato" /></Field>}
            <Field label="Note per la consegna" help={edit.origin === 'ORG' && edit.points.some((p) => p.active) ? 'Valgono per i punti che non hanno note proprie: il punto di consegna si sceglie sull\'ordine ("Consegnare a")' : undefined} className="span2"><textarea value={edit.delivery_notes} onChange={(e) => setEdit({ ...edit, delivery_notes: e.target.value })} style={{ minHeight: 56 }} /></Field>
            <Field label="Note interne" className="span2"><textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} style={{ minHeight: 56 }} /></Field>
          </div>
        </Modal>
      )}
      {puntoEdit && (
        <Modal title={`Consegna · ${puntoEdit.le} · ${puntoEdit.name}`} onClose={() => setPuntoEdit(null)} wide footer={<><button className="btn ghost" onClick={() => setPuntoEdit(null)}>Annulla</button><button className="btn" onClick={salvaPunto}>Salva</button></>}>
          <ErrorBox error={err} />
          <div className="small muted" style={{ marginBottom: 12 }}>Punto service <span className="mono">{puntoEdit.code}</span> della Legal entity {puntoEdit.le}{puntoEdit.address ? ` · ${puntoEdit.address}` : ''}. Ordini, giacenze e dotazione restano sulla Legal entity: il punto ha solo le impostazioni di consegna. Nell'ordine si sceglie in "Consegnare a".</div>
          <div className="form-grid">
            <Field label="Destinazione Silva del punto" help="Nella trasmissione dell'ordine consegnato a questo punto parte questo codice" className="span2">
              <select value={puntoEdit.silva_code} onChange={(e) => setPuntoEdit({ ...puntoEdit, silva_code: e.target.value })}>
                <option value="">Nessuna (gli ordini per questo punto non si trasmettono)</option>
                {puntoEdit.silva_code && !destinazioni.some((d) => d.codice === puntoEdit.silva_code) && <option value={puntoEdit.silva_code}>{puntoEdit.silva_code} · non tra le destinazioni lette</option>}
                {destinazioni.map((d) => <option key={d.codice} value={d.codice}>{destLabel(d)}</option>)}
              </select>
            </Field>
            <Field label="Modalità di consegna"><select value={puntoEdit.delivery_mode} onChange={(e) => setPuntoEdit({ ...puntoEdit, delivery_mode: e.target.value })}><option value="GIRO">Giro logistico TD</option><option value="RITIRO">Ritiro presso TD</option></select></Field>
            <Field label="Note per la consegna (vanno a Silva come noteConsegna)" className="span2"><textarea value={puntoEdit.delivery_notes} onChange={(e) => setPuntoEdit({ ...puntoEdit, delivery_notes: e.target.value })} style={{ minHeight: 56 }} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

const indirizzo = (via, cap, citta, prov) => [via, [cap, citta, prov && `(${prov})`].filter(Boolean).join(' ')].filter(Boolean).join(', ');
const destLabel = (d) => `${d.codice} · ${d.nome} · ${indirizzo(d.indirizzo, d.cap, d.citta, d.provincia)}`;

// Destinazioni Silva (Guida tecnica API ordini v1, v0.68.3): le unità che ricevono merce (sedi TD, Legal entity cliente senza punti
// service, ogni punto service delle Legal entity cliente) in tre gruppi: Abbinate (automatiche o manuali), Da scegliere (più candidate o
// codice non autorizzato), Non presenti in Silva (nessuna destinazione plausibile). Le coincidenze univoche (CAP + via e civico, o CAP +
// nome) si abbinano da sole con "Aggiorna destinazioni" e ogni 6 ore. In fondo le destinazioni Silva che non corrispondono a nessuna unità.
const TIPO_UNITA = { SEDE: 'Sede TD', LE: 'Legal entity', PUNTO: 'Punto service' };
function DestinazioniSilva({ tabs }) {
  const toast = useToast();
  const { data, reload, error } = useApi('/silva/strutture');
  const [scelte, setScelte] = useState({});
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const [cerca, setCerca] = useState('');
  useEffect(() => { setScelte({}); }, [data]);
  const aggiorna = async () => {
    setBusy('dest'); setErr(null);
    try { const r = await api.get('/silva/destinazioni?refresh=1'); toast(`${r.destinazioni.length} destinazioni lette da Silva${r.abbinate_auto?.length ? ` · ${r.abbinate_auto.length} abbinate automaticamente` : ''}`); reload(); } catch (e) { setErr(e); }
    setBusy(null);
  };
  const salva = async (u, codice) => { setBusy(u.id); setErr(null); try { await api.put(`/strutture/${u.id}`, { silva_code: codice || null }); toast(codice ? `${u.label}: destinazione ${codice}` : `${u.label}: destinazione tolta`); reload(); } catch (e) { setErr(e); } setBusy(null); };
  const filtra = (u) => !cerca || `${u.label} ${u.code} ${u.city || ''} ${u.address || ''} ${u.silva_code || ''}`.toLowerCase().includes(cerca.toLowerCase());
  const tutte = (data?.strutture || []).filter(filtra);
  const abbinate = tutte.filter((u) => u.stato === 'ABBINATA');
  const daScegliere = tutte.filter((u) => u.stato === 'DA_SCEGLIERE' || u.stato === 'NON_AUTORIZZATA');
  const nonInSilva = tutte.filter((u) => u.stato === 'NON_IN_SILVA');
  const k = data?.conteggi;
  const unitaCell = (u) => <td><div className="strong">{u.label}</div><div className="small muted">{TIPO_UNITA[u.tipo]} · <span className="mono">{u.code}</span>{u.silva_match === 'ESCLUSA' && ' · tolta a mano: non si abbina in automatico'}</div></td>;
  const indCell = (u) => <td className="small">{indirizzo(u.address, u.zip, u.city, u.province) || <span className="muted">–</span>}</td>;
  const selettore = (u, opzioni, predefinito) => {
    const val = scelte[u.id] ?? (u.silva_code || predefinito || '');
    return <select value={val} onChange={(e) => setScelte({ ...scelte, [u.id]: e.target.value })} style={{ minWidth: 260 }}>
      <option value="">{u.silva_code ? 'Togli la destinazione' : 'Scegli…'}</option>
      {u.silva_code && !opzioni.some((d) => d.codice === String(u.silva_code)) && <option value={u.silva_code}>{u.silva_code} · non tra le destinazioni lette</option>}
      {opzioni.map((d) => <option key={d.codice} value={d.codice}>{destLabel(d)}{d.usata_da ? ` · già di ${d.usata_da}` : ''}</option>)}
    </select>;
  };
  const salvaBtn = (u, predefinito) => {
    const val = scelte[u.id] ?? (u.silva_code || predefinito || '');
    return (val !== (u.silva_code || '')) && <button className="btn sm" disabled={busy === u.id} onClick={() => salva(u, val)}>{val ? 'Salva' : 'Togli'}</button>;
  };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Destinazioni Silva</h1><div className="sub">Ogni unità che riceve merce va associata a una sede autorizzata da Silva: nella trasmissione dell'ordine parte solo il codice della destinazione. Le unità sono le sedi TD, le Legal entity cliente senza punti service e ogni punto service delle Legal entity cliente (la Legal entity con punti non si abbina: si abbinano i suoi punti). Quando una sola destinazione coincide per CAP + via e civico, o CAP + nome, e il codice è libero, l'abbinamento è automatico.</div></div>
        <div className="row">
          <Field label="Cerca"><input placeholder="Nome, codice, città" value={cerca} onChange={(e) => setCerca(e.target.value)} /></Field>
          <button className="btn" disabled={busy === 'dest'} onClick={aggiorna}>{busy === 'dest' ? 'Lettura…' : 'Aggiorna destinazioni'}</button>
        </div>
      </div>
      {tabs}
      <ErrorBox error={err || error} />
      {data && <div className="alert info small" style={{ marginBottom: 12 }}><span>{data.destinazioni.length ? `${data.destinazioni.length} destinazioni autorizzate da Silva, lette il ${new Date(data.letto_al).toLocaleString('it-IT')}.` : 'Destinazioni non ancora lette da Silva: premi "Aggiorna destinazioni" (serve la chiave API nel connettore Silva).'} {k && `${k.abbinate} abbinate (${k.automatiche} automaticamente) · ${k.da_scegliere} da scegliere · ${k.non_in_silva} non presenti in Silva · ${k.non_in_anagrafica} destinazioni Silva non in anagrafica.`} Il controllo si ripete ogni 6 ore (lavoro orders:silva-destinazioni).</span></div>}
      {!data ? <Card><Loading /></Card> : (<>
        <Card title={`Da scegliere (${daScegliere.length})`} flush className="mb" actions={<span className="small muted">più destinazioni plausibili o codice non autorizzato: si sceglie a mano</span>}>
          {!daScegliere.length ? <Empty>Nessuna unità da scegliere</Empty> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Unità</th><th>Indirizzo in anagrafica</th><th>Candidate</th><th>Destinazione</th><th /></tr></thead>
              <tbody>{daScegliere.map((u) => {
                const pred = u.auto?.codice || u.proposta?.codice || '';
                return (
                  <tr key={u.id}>
                    {unitaCell(u)}{indCell(u)}
                    <td className="small">{u.stato === 'NON_AUTORIZZATA' ? <Badge tone="red">codice {u.silva_code} non autorizzato</Badge> : <>{u.candidate.length} plausibili{u.candidate.filter((c) => c.coincide).length > 1 ? <div className="muted">{u.candidate.filter((c) => c.coincide).length} coincidono: ambiguo</div> : u.candidate.some((c) => c.coincide && c.usata_da) ? <div className="muted">coincide con una destinazione già usata da {u.candidate.find((c) => c.coincide && c.usata_da).usata_da}</div> : null}</>}</td>
                    <td>{selettore(u, u.candidate.length ? u.candidate : data.destinazioni, pred)}{pred && !scelte[u.id] && <div className="small muted">{u.auto ? `Coincide (${u.auto.motivo}): verrà abbinata al prossimo aggiornamento` : 'Proposta per somiglianza: da confermare'}</div>}</td>
                    <td className="num">{salvaBtn(u, pred) || (pred && !u.silva_code && <button className="btn sm" disabled={busy === u.id} onClick={() => salva(u, pred)}>Conferma</button>)}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
        </Card>
        <Card title={`Non presenti in Silva (${nonInSilva.length})`} flush className="mb" actions={<span className="small muted">nessuna destinazione plausibile: Silva non l'ha censita sulla nostra chiave</span>}>
          {!nonInSilva.length ? <Empty>Nessuna unità senza destinazione plausibile</Empty> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Unità</th><th>Indirizzo in anagrafica</th><th>Stato</th><th>Destinazione</th><th /></tr></thead>
              <tbody>{nonInSilva.map((u) => <tr key={u.id}>{unitaCell(u)}{indCell(u)}<td><Badge tone="red">Silva non l'ha censita sulla nostra chiave</Badge><div className="small muted">da chiedere a Silva</div></td><td>{selettore(u, data.destinazioni)}</td><td className="num">{salvaBtn(u)}</td></tr>)}</tbody>
            </table></div>
          )}
        </Card>
        <Card title={`Abbinate (${abbinate.length})`} flush className="mb">
          {!abbinate.length ? <Empty>Nessuna unità abbinata</Empty> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Unità</th><th>Indirizzo in anagrafica</th><th>Destinazione Silva</th><th>Abbinamento</th><th /></tr></thead>
              <tbody>{abbinate.map((u) => <tr key={u.id}>{unitaCell(u)}{indCell(u)}<td>{selettore(u, data.destinazioni)}</td><td>{u.silva_match === 'AUTO' ? <Badge tone="blue">automatico</Badge> : <Badge tone="green">manuale</Badge>}{u.silva_match_at && <div className="small muted">{new Date(u.silva_match_at).toLocaleString('it-IT')}</div>}</td><td className="num">{salvaBtn(u)}</td></tr>)}</tbody>
            </table></div>
          )}
        </Card>
        <Card title={`Presenti in Silva, non in anagrafica (${data.non_in_anagrafica.length})`} flush>
          {!data.non_in_anagrafica.length ? <Empty>Ogni destinazione Silva è abbinata a un'unità</Empty> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Codice</th><th>Nome presso Silva</th><th>Indirizzo</th></tr></thead>
              <tbody>{data.non_in_anagrafica.map((d) => <tr key={d.codice}><td className="mono strong">{d.codice}</td><td>{d.nome}</td><td className="small">{indirizzo(d.indirizzo, d.cap, d.citta, d.provincia)}</td></tr>)}</tbody>
            </table></div>
          )}
          <div className="small muted" style={{ padding: '10px 16px' }}>Destinazioni autorizzate da Silva che non corrispondono a nessuna sede TD, Legal entity o punto service attivo: una sede chiusa, un'unità da creare in Amministrazione o un errore di censimento presso Silva.</div>
        </Card>
      </>)}
    </div>
  );
}

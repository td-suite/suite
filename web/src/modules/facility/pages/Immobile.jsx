// Titolo di godimento, canone con IVA, garanzie, locatore e contratto in PDF: dall'anagrafica Sedi (Amministrazione), fonte unica; qui
// solo lettura con il rimando al form. Rata vigente e scatti: dal contratto collegato nello Scadenziario di Payments.
// Scheda dell'immobile: dati immobiliari, contratto e canone da Payments (o Legal entity ospitante), planimetria con pubblicazione in
// Room Planning, documenti, obblighi di controllo, utenze con volture e prossime bollette, dispositivi, interventi aperti, consumi dell'anno
import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, base, useApi, apiBase } from '../api.js';
import { Card, Loading, Empty, PageHead, Badge, Modal, Field, useToast, DropZone, ConfirmModal } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { Alert, Transfer, AssetStatus, Outcome, Priority, WoStatus, Bench, docUrl, FileLink } from '../components/bits.jsx';
import { MonthlyCompare } from '../components/Charts.jsx';
import PdfPreview from '../components/PdfPreview.jsx';
import { SITE_KIND, TENURE, DOC_KINDS, OBL_KINDS, VECTOR, CATEGORY, num, eur, pct, itDate, itDateTime, kb, ogni } from '../format.js';

const PERIOD_LABEL = { MESE: 'al mese', TRIMESTRE: 'al trimestre', SEMESTRE: 'al semestre', ANNO: 'all\'anno' };
const PERIOD_N = { MESE: 12, TRIMESTRE: 4, SEMESTRE: 2, ANNO: 1 };
const VAT_LABEL = { PIU_IVA: 'più IVA', ESENTE: 'esente IVA', IVA_INCLUSA: 'IVA inclusa' };
const REG_LABEL = { IMPOSTA_ANNUALE: 'imposta di registro annuale', UNICA_SOLUZIONE: 'registro in unica soluzione', CEDOLARE_SECCA: 'cedolare secca', DA_REGISTRARE: 'da registrare' };
const vatText = (R) => (R.rent_vat ? `${VAT_LABEL[R.rent_vat]}${R.rent_vat !== 'ESENTE' && R.rent_vat_rate != null ? ` ${num(R.rent_vat_rate)}%` : ''}` : 'IVA non indicata');

export default function Immobile() {
  const { siteId } = useParams();
  const toast = useToast();
  const { data: d, loading, error, reload } = useApi(`/immobili/${siteId}`);
  const [edit, setEdit] = useState(false);
  const [upload, setUpload] = useState(null);      // tipo di documento da caricare
  const [obl, setObl] = useState(null);            // obbligo in modifica ({} = nuovo)
  const [del, setDel] = useState(null);
  if (error) return <div className="page"><Empty icon="alert" title="Errore">{error.message}</Empty></div>;
  if (!d && loading) return <div className="page"><Loading /></div>;
  const p = d.property; const s = d.site; const L = d.lease?.lease; const R = d.registry || {};
  const editSite = `/admin/sites?sede=${s.id}`;
  const can = d.can_edit;
  const plan = d.planimetria;
  const publish = async () => { try { const r = await api.post(`/documenti/${plan.id}/pubblica-room`); toast(r.published ? 'Planimetria pubblicata in Room Planning' : r.reason, r.published ? undefined : 'err'); reload(); } catch (e) { toast(e, 'err'); } };
  return (
    <div className="page">
      <PageHead title={s.name} icon="building" crumb={<Link to={`${base}/immobili`}>Immobili</Link>}
        sub={`${SITE_KIND[s.kind] || s.kind}${s.address ? ` · ${s.address}` : ''}${s.city ? `, ${s.city}` : ''} · ${s.code}${s.manager_name ? ` · site manager ${s.manager_name}` : ''}`}
        actions={can && <><Link className="btn ghost" to={`${base}/dispositivi?site_id=${s.id}&nuovo=1`}><Icon name="plus" />Dispositivo</Link><button className="btn" onClick={() => setEdit(true)}><Icon name="edit" />Dati dell'immobile</button></>} />
      <div className="fa-two">
        <Card title="Dati dell'immobile" icon="building">
          <div className="fa-facts">
            <div><div className="k">Titolo</div><div className="v">{TENURE[p.tenure]}</div></div>
            <div><div className="k">Superficie</div><div className="v">{p.surface_sqm ? `${num(p.surface_sqm)} m2` : '–'}</div></div>
            <div><div className="k">Piani · locali</div><div className="v">{p.floors ?? '–'} · {p.rooms ?? '–'}</div></div>
            <div><div className="k">Classe energetica</div><div className="v">{p.energy_class || '–'}</div>{p.ape_valid_until && <div className="small muted">APE fino al {itDate(p.ape_valid_until)}</div>}</div>
            <div><div className="k">Riscaldamento</div><div className="v">{p.heating_type || '–'}</div></div>
            <div><div className="k">Raffrescamento</div><div className="v">{p.cooling_type || '–'}</div></div>
            <div><div className="k">Anno di costruzione</div><div className="v">{p.year_built || '–'}</div></div>
            <div><div className="k">Apertura</div><div className="v">{p.opening_hours_week ? `${num(p.opening_hours_week)} h/sett.` : '–'}{p.occupancy_days_week ? ` · ${num(p.occupancy_days_week)} gg` : ''}</div></div>
            <div><div className="k">Catasto</div><div className="v">{['foglio', 'particella', 'sub'].map((k) => p.cadastral?.[k] && `${k[0].toUpperCase()}${k.slice(1)} ${p.cadastral[k]}`).filter(Boolean).join(' · ') || '–'}</div>{p.cadastral?.categoria && <div className="small muted">cat. {p.cadastral.categoria}</div>}</div>
          </div>
          {p.notes && <div className="fa-muted-box" style={{ marginTop: 12 }}>{p.notes}</div>}
        </Card>
        <Card title="Titolo e canone" icon="finance-sign" actions={<a className="btn sm ghost" href={editSite} title="Titolo di godimento, canone, garanzie e contratto si modificano nell'anagrafica Sedi"><Icon name="edit" />Modifica in Amministrazione &gt; Sedi</a>}>
          <div className="fa-facts">
            <div><div className="k">Titolo</div><div className="v"><Badge tone={p.tenure === 'PROPRIETA' ? 'green' : p.tenure === 'OSPITATA' ? 'mauve' : 'blue'} dot={false}>{TENURE[p.tenure]}</Badge></div></div>
            {p.tenure === 'OSPITATA' && <div><div className="k">Ospitata da</div><div className="v">{d.host?.name || '–'}</div>{d.host?.city && <div className="small muted">{d.host.city}</div>}</div>}
            {['LOCAZIONE', 'COMODATO'].includes(p.tenure) && <div><div className="k">{p.tenure === 'COMODATO' ? 'Comodante' : 'Locatore'}</div><div className="v">{d.landlord?.name || L?.landlord || '–'}</div>{d.landlord?.vat_number && <div className="small muted">P.IVA {d.landlord.vat_number}</div>}</div>}
            {p.tenure === 'LOCAZIONE' && <div><div className="k">Canone (anagrafica)</div><div className="fa-big">{R.rent_amount != null ? eur(R.rent_amount) : '–'}</div>{R.rent_amount != null && <div className="small muted">{PERIOD_LABEL[R.rent_period] || ''} · {vatText(R)} · {eur(Number(R.rent_amount) * (PERIOD_N[R.rent_period] || 12))} l'anno</div>}</div>}
            {L && <div><div className="k">Rata vigente (Payments)</div><div className="v">{eur(L.rent)}</div><div className="small muted">ogni {L.period_months === 1 ? 'mese' : `${L.period_months} mesi`}{L.istat ? ' · ISTAT' : ''}</div></div>}
            {['LOCAZIONE', 'COMODATO'].includes(p.tenure) && <div><div className="k">Decorrenza · durata</div><div className="v">{itDate(R.lease_start || L?.start_date) || '–'}</div><div className="small muted">{R.lease_years ? `${R.lease_years} anni` : ''}{R.lease_renewal_years ? ` + ${R.lease_renewal_years}` : ''}{R.lease_notice_months != null ? ` · preavviso ${R.lease_notice_months} mesi` : ''}</div></div>}
            {['LOCAZIONE', 'COMODATO'].includes(p.tenure) && <div><div className="k">Scadenza</div><div className="v" style={{ color: L?.expired ? 'var(--red)' : undefined }}>{itDate(L?.end_date || R.lease_end) || '–'}</div>{L?.renewals > 0 && <div className="small muted">{L.renewals} rinnovi taciti</div>}{R.lease_registration && <div className="small muted">{REG_LABEL[R.lease_registration]}</div>}</div>}
          </div>
          {p.tenure === 'LOCAZIONE' && <>
            <div className="small strong" style={{ margin: '12px 0 6px' }}>Garanzie fornite al locatore</div>
            <div className="fa-facts">
              <div><div className="k">Fideiussione bancaria</div><div className="v">{R.guarantee_bank_amount != null ? eur(R.guarantee_bank_amount) : '–'}</div></div>
              <div><div className="k">Fideiussione assicurativa</div><div className="v">{R.guarantee_insurance_amount != null ? eur(R.guarantee_insurance_amount) : '–'}</div></div>
              <div><div className="k">Caparra / deposito</div><div className="v">{R.deposit_amount != null ? eur(R.deposit_amount) : '–'}</div></div>
            </div>
            {R.guarantee_notes && <div className="fa-muted-box" style={{ marginTop: 8 }}>{R.guarantee_notes}</div>}
          </>}
          <div className="small" style={{ marginTop: 10, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {R.lease_document && <a className="fa-file" href={`${apiBase}/immobili/${s.id}/contratto-pdf`} target="_blank" rel="noreferrer"><Icon name="pdf" />{R.lease_document.filename}</a>}
            {p.tenure === 'LOCAZIONE' && (!d.finance ? <span className="muted">Payments non avviato: la rata vigente e le scadenze si leggono dallo Scadenziario quando è attivo.</span>
              : L ? <span className="muted"><a href={`/finance/scadenziario?site_id=${s.id}`}>Contratto n. {L.id} nello Scadenziario di Payments</a>{L.steps?.length > 1 ? ` · scatti: ${L.steps.map((x) => `${itDate(x.valid_from)} ${eur(x.amount)}`).join(' · ')}` : ''}{L.next_step ? ` · prossimo il ${itDate(L.next_step.valid_from)}` : ''}</span>
                : <span className="muted">Nessun contratto in Payments: nasce da solo quando in Amministrazione &gt; Sedi ci sono canone e decorrenza.</span>)}
            {p.tenure === 'OSPITATA' && <span className="muted">Nessun contratto di affitto TD: la Legal entity ospitante si imposta in Amministrazione &gt; Sedi.</span>}
          </div>
        </Card>
      </div>

      <div className="fa-two">
        <Card title="Planimetria" icon="image" actions={<>{can && <button className="btn sm ghost" onClick={() => setUpload('PLANIMETRIA')}><Icon name="upload" />{plan ? 'Sostituisci' : 'Carica'}</button>}{can && plan && <button className="btn sm ghost" onClick={publish} disabled={!d.room.room}><Icon name="refresh" />Pubblica in Room Planning</button>}</>}>
          {!plan ? <Empty compact icon="image" title="Nessuna planimetria">Carica il PDF o l'immagine della planimetria: diventa disponibile in Room Planning per posizionare gli ambulatori.</Empty> : <>
            <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              {plan.published_room_at && d.room.has_plan ? <Badge tone="green">Disponibile in Room Planning dal {itDateTime(plan.published_room_at)}</Badge> : d.room.room ? <Badge tone="amber">Non ancora pubblicata in Room Planning</Badge> : <Badge tone="grey">Room Planning non avviato</Badge>}
              <FileLink f={plan} doc /> <span className="small muted">{kb(plan.size)} · {itDate(plan.created_at)}</span>
            </div>
            {/pdf/.test(plan.mime) ? <PdfPreview url={docUrl(plan.id)} /> : <img className="fa-planimg" src={docUrl(plan.id)} alt="Planimetria" />}
          </>}
        </Card>
        <Card title="Documenti" icon="folder" flush actions={can && <button className="btn sm ghost" onClick={() => setUpload('CERTIFICAZIONE')}><Icon name="upload" />Carica</button>}>
          {!d.documents.length ? <Empty compact icon="folder" title="Nessun documento">Contratti, certificazioni (APE, CPI, conformità impianti), verbali.</Empty> : (
            <table className="t fa-table"><thead><tr><th>Tipo</th><th>Documento</th><th>Scadenza</th><th>Caricato</th>{can && <th />}</tr></thead>
              <tbody>{d.documents.map((x) => <tr key={x.id}><td>{DOC_KINDS[x.kind]}</td><td><FileLink f={x} doc /><div className="small muted">{x.filename} · {kb(x.size)}</div></td><td>{x.valid_until ? <span style={{ color: x.valid_until < new Date().toISOString().slice(0, 10) ? 'var(--red)' : undefined }}>{itDate(x.valid_until)}</span> : '–'}</td><td className="small muted">{itDate(x.created_at)}{x.uploaded_by_name ? ` · ${x.uploaded_by_name}` : ''}</td>
                {can && <td><button className="iconbtn" title="Elimina" onClick={() => setDel(x)}><Icon name="trash" /></button></td>}</tr>)}</tbody></table>)}
        </Card>
      </div>

      <Card title="Obblighi di controllo" icon="doc" flush actions={can && <button className="btn sm ghost" onClick={() => setObl({})}><Icon name="plus" />Nuovo obbligo</button>} style={{ marginBottom: 16 }}>
        {!d.obligations.length ? <Empty compact icon="doc" title="Nessun obbligo registrato">Obblighi previsti dal contratto di affitto (es. manutenzione della caldaia a carico del conduttore), dalla legge o dall'assicurazione: generano scadenze nel piano.</Empty> : (
          <table className="t fa-table"><thead><tr><th>Obbligo</th><th>Tipo</th><th>Periodicità</th><th>A carico di</th><th>Prossima</th><th>Ultima</th><th className="num">Costo stimato</th>{can && <th />}</tr></thead>
            <tbody>{d.obligations.map((o) => <tr key={o.id} style={{ opacity: o.active ? 1 : 0.55 }}><td className="strong">{o.title}{o.asset_type_name && <div className="small muted">{o.asset_type_name}</div>}</td><td>{OBL_KINDS[o.kind]}</td><td>{ogni(o.interval_months)}</td><td>{o.responsible || '–'}</td>
              <td>{o.next_plan ? <Link to={`${base}/piano?id=${o.next_plan.id}`}>{itDate(o.next_plan.due_date)}</Link> : (o.active ? '–' : 'disattivato')}</td><td>{itDate(o.last_done) || '–'}</td><td className="num">{o.cost_estimate != null ? eur(o.cost_estimate) : '–'}</td>
              {can && <td><button className="iconbtn" title="Modifica" onClick={() => setObl(o)}><Icon name="edit" /></button></td>}</tr>)}</tbody></table>)}
      </Card>

      <div className="fa-two">
        <Card title="Utenze della sede" icon="bolt" flush actions={<Link className="btn sm ghost" to={`${base}/utenze?site_id=${s.id}`}>Utenze</Link>}>
          {!d.finance ? <Empty compact icon="bolt" title="Payments non avviato" /> : !d.utilities?.length ? <Empty compact icon="bolt" title="Nessuna utenza">Le utenze si creano in Utenze (finiscono nello Scadenziario di Payments).</Empty> : <>
            <ul className="fa-list" style={{ padding: 12 }}>{d.utilities.map((u) => <li key={u.id} style={{ opacity: u.active ? 1 : 0.55 }}><span><span className="t">{VECTOR[u.vector] || u.kind}</span> <span className="small muted">{u.supplier_name || ''}{u.pod_pdr || u.code ? ` · ${u.pod_pdr || u.code}` : ''}</span><div className="m">fatturazione {ogni(u.period_months)}{u.last_bill ? ` · ultima bolletta ${itDate(u.last_bill)}` : ''}</div></span><Transfer s={u.transfer_status} /></li>)}</ul>
            {d.next_bills.length > 0 && <div style={{ padding: '0 12px 12px' }}><div className="small muted" style={{ marginBottom: 6 }}>Prossime bollette attese (Scadenziario di Payments)</div>
              <ul className="fa-list">{d.next_bills.map((e) => <li key={e.key}><span>{itDate(e.date)} · {e.title}<div className="m">{e.desc}</div></span><b>{e.amount != null ? `${e.estimate ? '~' : ''}${eur(e.amount)}` : '–'}</b></li>)}</ul></div>}
          </>}
        </Card>
        <Card title={`Consumi ${d.energy?.year || ''}`} icon="sun" actions={<Link className="btn sm ghost" to={`${base}/energia?site_id=${s.id}`}>Energia</Link>}>
          {!d.energy?.available ? <Empty compact icon="sun" title="Dati energetici non disponibili" /> : d.energy.empty || !d.energy.totals?.kwh ? <Empty compact icon="sun" title="Nessun consumo registrato">Registra le bollette con i consumi o le letture dei contatori.</Empty> : <>
            <div className="fa-facts" style={{ marginBottom: 10 }}>
              <div><div className="k">kWh equivalenti</div><div className="v">{num(d.energy.totals.kwh)}</div><div className="small muted">{pct(d.energy.delta_kwh_pct)} sugli stessi mesi</div></div>
              <div><div className="k">Spesa</div><div className="v">{eur(d.energy.totals.cost)}</div></div>
              <div><div className="k">kWh/m2 anno</div><div className="v">{num(d.energy.intensity.kwh_m2_anno, 1)}</div>{d.energy.benchmark?.position && <Bench p={d.energy.benchmark.position} />}</div>
              <div><div className="k">kWh per accettazione</div><div className="v">{num(d.energy.intensity.kwh_per_acc, 2)}</div></div>
            </div>
            <MonthlyCompare monthly={d.energy.monthly} year={d.energy.year} anomalie={new Set(d.energy.anomalies.map((a) => a.month))} height={190} />
          </>}
        </Card>
      </div>

      <div className="fa-two">
        <Card title="Dispositivi installati" icon="qr" flush actions={<Link className="btn sm ghost" to={`${base}/dispositivi?site_id=${s.id}`}>Tutti</Link>}>
          {!d.assets.length ? <Empty compact icon="qr" title="Nessun dispositivo">Estintori, porte REI, impianti, elettromedicali: dal Catalogo dispositivi di Amministrazione.</Empty> : (
            <table className="t fa-table"><thead><tr><th>Dispositivo</th><th>Categoria</th><th>Prossimo controllo</th><th>Esito</th><th>Stato</th></tr></thead>
              <tbody>{d.assets.map((a) => <tr key={a.id}><td><Link to={`${base}/dispositivi/${a.id}`}>{a.code}</Link><div className="small muted">{a.name || a.type_name}{a.location ? ` · ${a.location}` : ''}</div></td><td className="small">{CATEGORY[a.category]}</td><td>{itDate(a.next_check_due) || '–'}</td><td><Outcome o={a.last_outcome} /></td><td><AssetStatus s={a.status} /></td></tr>)}</tbody></table>)}
        </Card>
        <Card title="Interventi aperti" icon="wrench" flush actions={<Link className="btn sm ghost" to={`${base}/interventi?site_id=${s.id}&nuovo=1`}><Icon name="plus" />Segnala</Link>}>
          {!d.work_orders.length ? <Empty compact icon="check" title="Nessun intervento aperto" /> : <ul className="fa-list" style={{ padding: 12 }}>{d.work_orders.map((w) => <li key={w.id}><span><Link className="t" to={`${base}/interventi/${w.id}`}>{w.title}</Link><div className="m">{w.code} · aperto {itDateTime(w.opened_at)}</div></span><span className="row" style={{ gap: 6 }}><Priority p={w.priority} /><WoStatus s={w.status} /></span></li>)}</ul>}
        </Card>
      </div>

      {edit && <EditModal d={d} onClose={() => setEdit(false)} onDone={() => { setEdit(false); reload(); }} />}
      {upload && <UploadModal siteId={s.id} kind={upload} onClose={() => setUpload(null)} onDone={() => { setUpload(null); reload(); }} />}
      {obl && <ObligationModal siteId={s.id} obl={obl} onClose={() => setObl(null)} onDone={() => { setObl(null); reload(); }} />}
      {del && <ConfirmModal title="Elimina documento" danger text={`Eliminare "${del.title || del.filename}"?${del.kind === 'PLANIMETRIA' && del.published_room_at ? ' In Room Planning va la planimetria più recente rimasta.' : ''}`} confirmText="Elimina"
        onConfirm={async () => { try { await api.del(`/documenti/${del.id}`); toast('Documento eliminato'); setDel(null); reload(); } catch (e) { toast(e, 'err'); } }} onClose={() => setDel(null)} />}
    </div>
  );
}

function EditModal({ d, onClose, onDone }) {
  const toast = useToast();
  const p = d.property;
  const [f, setF] = useState({ surface_sqm: p.surface_sqm ?? '', floors: p.floors ?? '', rooms: p.rooms ?? '', energy_class: p.energy_class || '', ape_valid_until: p.ape_valid_until || '', heating_type: p.heating_type || '', cooling_type: p.cooling_type || '',
    year_built: p.year_built ?? '', occupancy_days_week: p.occupancy_days_week ?? '', opening_hours_week: p.opening_hours_week ?? '', notes: p.notes || '', cadastral: { foglio: '', particella: '', sub: '', categoria: '', ...(p.cadastral || {}) }, lease_id: p.lease_id || '' });
  const { data: leases } = useApi(`/immobili/${d.site.id}/contratti`);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setC = (k) => (e) => setF({ ...f, cadastral: { ...f.cadastral, [k]: e.target.value } });
  const save = async () => { try { await api.put(`/immobili/${d.site.id}`, f); toast('Immobile aggiornato'); onDone(); } catch (e) { toast(e, 'err'); } };
  return (
    <Modal wide title={`Dati dell'immobile · ${d.site.name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}>
      <div className="fa-grid">
        <Field label="Superficie (m2)"><input className="fa-in" type="number" min="0" value={f.surface_sqm} onChange={set('surface_sqm')} /></Field>
        <Field label="Contratto di affitto in Payments" help="Vuoto = contratto attivo della sede"><select className="fa-in" value={f.lease_id} onChange={set('lease_id')}><option value="">Automatico</option>{(leases?.rows || []).map((l) => <option key={l.id} value={l.id}>{l.landlord || 'Locatore'} · dal {itDate(l.start_date)}{l.active ? '' : ' (cessato)'}</option>)}</select></Field>
        <Field label="Piani"><input className="fa-in" type="number" value={f.floors} onChange={set('floors')} /></Field>
        <Field label="Locali"><input className="fa-in" type="number" min="0" value={f.rooms} onChange={set('rooms')} /></Field>
        <Field label="Anno di costruzione"><input className="fa-in" type="number" value={f.year_built} onChange={set('year_built')} /></Field>
        <Field label="Classe energetica (APE)"><input className="fa-in" value={f.energy_class} onChange={set('energy_class')} placeholder="es. C" /></Field>
        <Field label="APE valido fino al"><input className="fa-in" type="date" value={f.ape_valid_until} onChange={set('ape_valid_until')} /></Field>
        <Field label="Ore di apertura a settimana" help="Per l'indicatore kWh per ora di apertura"><input className="fa-in" type="number" min="0" max="168" value={f.opening_hours_week} onChange={set('opening_hours_week')} /></Field>
        <Field label="Giorni di apertura a settimana"><input className="fa-in" type="number" min="0" max="7" step="0.5" value={f.occupancy_days_week} onChange={set('occupancy_days_week')} /></Field>
        <Field label="Riscaldamento"><input className="fa-in" value={f.heating_type} onChange={set('heating_type')} placeholder="es. caldaia a condensazione" /></Field>
        <Field label="Raffrescamento"><input className="fa-in" value={f.cooling_type} onChange={set('cooling_type')} placeholder="es. pompa di calore" /></Field>
      </div>
      <div className="fa-grid g4" style={{ marginTop: 10 }}>
        <Field label="Foglio"><input className="fa-in" value={f.cadastral.foglio} onChange={setC('foglio')} /></Field>
        <Field label="Particella"><input className="fa-in" value={f.cadastral.particella} onChange={setC('particella')} /></Field>
        <Field label="Subalterno"><input className="fa-in" value={f.cadastral.sub} onChange={setC('sub')} /></Field>
        <Field label="Categoria catastale"><input className="fa-in" value={f.cadastral.categoria} onChange={setC('categoria')} placeholder="es. A/10" /></Field>
      </div>
      <Field label="Note"><textarea className="fa-note" rows={3} value={f.notes} onChange={set('notes')} /></Field>
    </Modal>
  );
}

function UploadModal({ siteId, kind: k0, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ kind: k0, title: '', valid_until: '', notes: '' });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    if (!files.length) return toast('Scegli il file', 'err');
    const fd = new FormData(); for (const [kk, v] of Object.entries(f)) if (v) fd.append(kk, v); for (const x of files) fd.append('file', x, x.name);
    setBusy(true);
    try { const r = await api.upload(`/immobili/${siteId}/documenti`, fd); toast(r.room ? (r.room.published ? 'Planimetria caricata e pubblicata in Room Planning' : `Planimetria caricata. ${r.room.reason}`) : 'Documento caricato'); onDone(); } catch (e) { toast(e, 'err'); }
    setBusy(false);
  };
  return (
    <Modal title="Carica documento" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy} onClick={go}>{busy ? 'Caricamento' : 'Carica'}</button></>}>
      <div className="fa-grid g2">
        <Field label="Tipo"><select className="fa-in" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(DOC_KINDS).map(([kk, v]) => <option key={kk} value={kk}>{v}</option>)}</select></Field>
        <Field label="Titolo"><input className="fa-in" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={f.kind === 'PLANIMETRIA' ? 'es. Piano terra' : 'es. APE, CPI, dichiarazione di conformità'} /></Field>
        {f.kind !== 'PLANIMETRIA' && <Field label="Valido fino al"><input className="fa-in" type="date" value={f.valid_until} onChange={(e) => setF({ ...f, valid_until: e.target.value })} /></Field>}
      </div>
      <div style={{ marginTop: 10 }}><DropZone multiple={f.kind !== 'PLANIMETRIA'} onFiles={(xs) => setFiles(f.kind === 'PLANIMETRIA' ? xs.slice(0, 1) : [...files, ...xs])} accept={f.kind === 'PLANIMETRIA' ? '.pdf,.png,.jpg,.jpeg,.webp' : undefined} compact><Icon name="upload" /><div className="small">{f.kind === 'PLANIMETRIA' ? 'PDF o immagine della planimetria (va in Room Planning)' : 'Trascina qui i file (fino a 25 MB ciascuno)'}</div></DropZone></div>
      {files.length > 0 && <ul className="fa-list" style={{ marginTop: 8 }}>{files.map((x, i) => <li key={i}><span>{x.name} <span className="muted small">{kb(x.size)}</span></span><button className="iconbtn" onClick={() => setFiles(files.filter((_, j) => j !== i))}><Icon name="x" /></button></li>)}</ul>}
      {f.kind === 'PLANIMETRIA' && <div className="small muted" style={{ marginTop: 8 }}>Facility è la fonte della planimetria: la più recente sostituisce quella di Room Planning della sede (le posizioni degli ambulatori restano).</div>}
    </Modal>
  );
}

function ObligationModal({ siteId, obl, onClose, onDone }) {
  const toast = useToast();
  const isNew = !obl.id;
  const { data: cat } = useApi('/catalogo');
  const [f, setF] = useState({ title: obl.title || '', kind: obl.kind || 'CONTRATTUALE', interval_months: obl.interval_months || 6, first_due: obl.first_due || '', responsible: obl.responsible || '', asset_type_code: obl.asset_type_code || '', cost_estimate: obl.cost_estimate ?? '', notes: obl.notes || '', active: obl.active ?? true });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => { try { if (isNew) await api.post(`/immobili/${siteId}/obblighi`, f); else await api.put(`/obblighi/${obl.id}`, { ...f, first_due: undefined }); toast(isNew ? 'Obbligo registrato: la prima scadenza è nel piano' : 'Obbligo aggiornato'); onDone(); } catch (e) { toast(e, 'err'); } };
  const remove = async () => { try { const r = await api.del(`/obblighi/${obl.id}`); toast(r.disattivato ? 'Obbligo disattivato (ha uno storico)' : 'Obbligo eliminato'); onDone(); } catch (e) { toast(e, 'err'); } };
  return (
    <Modal title={isNew ? 'Nuovo obbligo di controllo' : 'Obbligo di controllo'} onClose={onClose} footer={<>{!isNew && <button className="btn ghost danger" onClick={remove}>Elimina</button>}<span className="spacer" /><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}>
      <Field label="Obbligo" required><input className="fa-in w" value={f.title} onChange={set('title')} placeholder="es. Manutenzione caldaia a carico del conduttore (art. 8)" /></Field>
      <div className="fa-grid">
        <Field label="Fonte"><select className="fa-in" value={f.kind} onChange={set('kind')}>{Object.entries(OBL_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Ogni (mesi)" required><input className="fa-in" type="number" min="1" max="240" value={f.interval_months} onChange={set('interval_months')} /></Field>
        {isNew && <Field label="Prima scadenza" required><input className="fa-in" type="date" value={f.first_due} onChange={set('first_due')} /></Field>}
        <Field label="A carico di"><input className="fa-in" value={f.responsible} onChange={set('responsible')} placeholder="Conduttore, Locatore, RSPP" /></Field>
        <Field label="Costo stimato (€)" help="Se valorizzato, all'esecuzione avvisa Payments"><input className="fa-in" type="number" min="0" step="0.01" value={f.cost_estimate} onChange={set('cost_estimate')} /></Field>
        <Field label="Tipo di dispositivo collegato"><select className="fa-in" value={f.asset_type_code} onChange={set('asset_type_code')}><option value="">Nessuno</option>{(cat || []).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</select></Field>
      </div>
      <Field label="Note"><textarea className="fa-note" rows={2} value={f.notes} onChange={set('notes')} /></Field>
      {!isNew && <label className="row small" style={{ gap: 6, marginTop: 8 }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Attivo (disattivandolo si annulla la scadenza aperta)</label>}
    </Modal>
  );
}

// Business Hub · pagina "Punti Prelievo" (richiesta del CEO del 06/11/2026): un punto prelievi per riga con tipo (flagship o corner, dalla
// sede TD collegata o previsto), sede, partner ospitante, fase della pipeline, autorizzazione (stato del fascicolo), avvio (date e passi);
// sedi Punto prelievi dell'anagrafica ancora senza account (con "Crea"); da qui i Fascicoli autorizzazione, il cruscotto e la pipeline PP,
// i contratti PP e il nuovo punto prelievi.
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, BASE } from '../api.js';
import { useAuth, canEditKind } from '../auth.jsx';
import { useApi, Card, Field, Loading, ErrorBox, Empty, Badge, Modal, Icon, useToast } from '../components/ui.jsx';
import { eur, itDate, FASI, DOSSIER_STATUS, STATUS, TIPO_PUNTO } from '../format.js';

export default function PuntiPrelievo() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const q = useApi('/hub/punti-prelievo');
  const [nuovo, setNuovo] = useState(false);
  const [filtro, setFiltro] = useState('');
  const [royalty, setRoyalty] = useState(null);   // B13: modale della proposta delle royalties in Cash
  const edit = canEditKind(user, 'PP');
  const d = q.data;
  const crea = async (s) => { try { const r = await api.post('/hub/punti-prelievo/da-sede', { site_id: s.id }); toast('Punto prelievi creato'); nav(`${BASE}/account/${r.id}?scheda=punto`); } catch (e) { toast(e.message, 'err'); } };
  const righe = (d?.punti || []).filter((p) => !filtro || p.tipo === filtro);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Punti Prelievo</h1><div className="sub">Flagship (sede TD in locazione o di proprietà) e corner (in sede del partner ospitante): anagrafica, contratto al partner da network@, autorizzazione sanitaria e avvio del punto prelievi.</div></div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn ghost" to={`${BASE}/fascicoli`}><Icon name="folder" />Fascicoli autorizzazione</Link>
          <Link className="btn ghost" to={`${BASE}?linea=PP`}>Cruscotto Punti Prelievo</Link>
          <Link className="btn ghost" to={`${BASE}/pipeline?linea=PP`}>Pipeline Punti Prelievo</Link>
          <Link className="btn ghost" to={`${BASE}/contratti-pp`}>Contratti PP</Link>
          {edit && <button className="btn" onClick={() => setNuovo(true)}><Icon name="plus" />Nuovo punto prelievi</button>}
        </div>
      </div>
      <div className="filters">
        <div className="seg">{[['', 'Tutti'], ['CORNER', 'Corner'], ['FLAGSHIP', 'Flagship']].map(([k, l]) => <label key={k} className={filtro === k ? 'on' : ''}><input type="radio" checked={filtro === k} onChange={() => setFiltro(k)} />{l}</label>)}</div>
        <div className="spacer" />
        <div className="small muted">{righe.length} punti prelievo</div>
      </div>
      <ErrorBox error={q.error} />
      <Card flush>{!d ? <Loading /> : righe.length ? (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Punto prelievi</th><th>Tipo</th><th>Sede TD</th><th>Partner ospitante</th><th>Fase</th><th>Contratto</th><th>Coerenza con Sedi</th><th>Royalty in Cash</th><th>Autorizzazione</th><th>Avvio</th></tr></thead>
          <tbody>{righe.map((p) => (
            <tr key={p.id} className="click" onClick={() => nav(`${BASE}/account/${p.id}?scheda=punto`)}>
              <td><div className="strong">{p.nome}</div><div className="small muted">{p.org_name}{p.owner_name ? ` · ${p.owner_name}` : ''}</div></td>
              <td>{p.tipo ? <><Badge tone={TIPO_PUNTO[p.tipo].tone}>{TIPO_PUNTO[p.tipo].label}</Badge>{p.tipo_fonte === 'previsto' && <div className="small muted">previsto</div>}</> : <span className="muted">da definire</span>}</td>
              <td>{p.site_name ? <>{p.site_name !== p.nome && <div>{p.site_name}</div>}<div className="small mono">{p.site_code}</div>{p.site_city ? <div className="small muted">{p.site_city}</div> : null}</> : <span className="muted">non in anagrafica</span>}</td>
              <td className="small">{p.partner || <span className="muted">–</span>}</td>
              <td><Badge tone={FASI[p.fase_corrente].tone}>{FASI[p.fase_corrente].short}</Badge></td>
              <td className="small">{p.tipo === 'FLAGSHIP' ? (p.locazione ? <>locazione {p.locazione.rent_amount != null ? eur(p.locazione.rent_amount) : <span className="amber">canone mancante</span>}{!p.locazione.documento && <div className="amber">PDF mancante in Sedi</div>}</> : <span className="muted">locazione: –</span>)
                : p.contratto ? <>{p.contratto.protocol || 'bozza'} <Badge tone={STATUS[p.contratto.status]?.tone}>{STATUS[p.contratto.status]?.label}</Badge></> : <span className="muted">–</span>}</td>
              <td className="small">{p.coerenza_sedi ? <span title={p.coerenza_sedi.testo}><Badge tone={p.coerenza_sedi.stato === 'OK' ? 'green' : p.coerenza_sedi.stato === 'CONFLITTO' ? 'red' : 'amber'}>{{ OK: 'coerente', DA_IMPOSTARE: 'da impostare', CONFLITTO: 'ospitante diverso', SENZA_SEDE: 'senza sede' }[p.coerenza_sedi.stato] || p.coerenza_sedi.stato}</Badge></span> : <span className="muted">–</span>}</td>
              <td className="small" onClick={(e) => e.stopPropagation()}>{p.royalty ? (['NUOVA', 'DIVERSA'].includes(p.royalty.stato)
                ? <button className="btn sm ghost" data-testid={`royalty-${p.pp_site_id}`} onClick={() => setRoyalty(p)}><Badge tone={p.royalty.stato === 'DIVERSA' ? 'amber' : 'mauve'}>{p.royalty.stato === 'DIVERSA' ? 'diverse dal contratto' : 'da confermare'}</Badge></button>
                : <Badge tone={p.royalty.stato === 'UGUALE' ? 'green' : 'grey'}>{{ UGUALE: 'allineate al contratto', NON_OSPITATA: 'sede non ospitata', CASH_NON_AVVIATO: 'Cash non avviato' }[p.royalty.stato] || p.royalty.stato}</Badge>) : <span className="muted">–</span>}</td>
              <td>{p.fascicolo ? <><Badge tone={DOSSIER_STATUS[p.fascicolo.status]?.tone}>{DOSSIER_STATUS[p.fascicolo.status]?.label}</Badge>{p.fascicolo.authorized_at ? <div className="small muted">{itDate(p.fascicolo.authorized_at)}</div> : null}</> : <span className="muted small">nessun fascicolo</span>}</td>
              <td className="small">{p.data_avvio_effettiva ? <div className="strong">{itDate(p.data_avvio_effettiva)}</div> : p.data_avvio_prevista ? <div>prevista {itDate(p.data_avvio_prevista)}</div> : null}
                {p.avvio ? <Badge tone={p.avvio.completo ? 'green' : p.avvio.falliti.length ? 'red' : 'mauve'}>{p.avvio.completo ? 'passi completati' : `${p.avvio.fatti}/${p.avvio.previsti} passi`}</Badge>
                  : p.tipo === 'FLAGSHIP' && p.fascicolo?.status === 'AUTORIZZATO' ? <Badge tone="mauve">autorizzato: da avviare</Badge> : <span className="muted">non avviato</span>}</td>
            </tr>))}</tbody>
        </table></div>
      ) : <Empty>Nessun punto prelievi{filtro ? ' di questo tipo' : ''} nel Business Hub</Empty>}</Card>

      {d?.sedi_senza_account?.length > 0 && <Card title={`Sedi Punto prelievi dell'anagrafica senza punto nel Business Hub (${d.sedi_senza_account.length})`} className="mt" flush>
        <table className="t"><tbody>{d.sedi_senza_account.map((s) => <tr key={s.id}>
          <td><div className="strong">{s.name}</div><div className="small muted mono">{s.code}{s.city ? ` · ${s.city}` : ''}</div></td>
          <td>{s.tipo ? <Badge tone={TIPO_PUNTO[s.tipo].tone}>{TIPO_PUNTO[s.tipo].label}</Badge> : null}</td>
          <td className="small">{s.tipo === 'CORNER' ? `ospitata da ${s.host_name || '–'}` : s.organization_name || ''}</td>
          <td className="small">{s.fascicolo_status ? <Badge tone={DOSSIER_STATUS[s.fascicolo_status]?.tone}>{DOSSIER_STATUS[s.fascicolo_status]?.label}</Badge> : null}</td>
          <td style={{ width: 1 }}>{edit && <button className="btn sm ghost" disabled={!s.org_account} title={!s.org_account ? 'Indica la Legal entity della sede in Amministrazione > Sedi' : ''} onClick={() => crea(s)}>Crea il punto prelievi</button>}</td>
        </tr>)}</tbody></table>
      </Card>}

      {nuovo && <NuovoPunto onClose={() => setNuovo(false)} onDone={(id) => nav(`${BASE}/account/${id}?scheda=punto`)} />}
      {royalty && <RoyaltyModal punto={royalty} edit={edit} onClose={() => setRoyalty(null)} onDone={() => { setRoyalty(null); q.reload(); }} />}
    </div>
  );
}

// Nuovo punto prelievi senza sede in anagrafica: Legal entity (il partner per il corner, la società TD o il locatore per il flagship),
// nome del punto e tipo previsto, da confermare quando la sede viene creata e collegata
function NuovoPunto({ onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ cerca: '', organization_id: '', pp_nome: '', pp_tipo_previsto: 'CORNER', data_avvio_prevista: '' });
  const orgs = useApi(f.cerca.length >= 2 ? `/organizations?q=${encodeURIComponent(f.cerca)}` : null, [f.cerca]);
  const salva = async () => {
    try {
      if (!f.organization_id) throw new Error('Scegli la Legal entity');
      if (!f.pp_nome.trim()) throw new Error('Indica il nome del punto prelievi');
      const r = await api.post('/hub/accounts', { linea: 'PP', organization_id: Number(f.organization_id), pp_nome: f.pp_nome, pp_tipo_previsto: f.pp_tipo_previsto, data_avvio_prevista: f.data_avvio_prevista || null });
      toast('Punto prelievi creato'); onDone(r.id);
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Modal title="Nuovo punto prelievi" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={salva}>Crea</button></>}>
      <div className="form-grid">
        <Field label="Tipo previsto"><select value={f.pp_tipo_previsto} onChange={(e) => setF({ ...f, pp_tipo_previsto: e.target.value })}><option value="CORNER">Corner (sede del partner)</option><option value="FLAGSHIP">Flagship (sede TD in locazione o di proprietà)</option></select></Field>
        <Field label="Data di avvio prevista"><input type="date" value={f.data_avvio_prevista} onChange={(e) => setF({ ...f, data_avvio_prevista: e.target.value })} /></Field>
        <Field label="Nome del punto prelievi" className="span2"><input value={f.pp_nome} onChange={(e) => setF({ ...f, pp_nome: e.target.value })} placeholder="es. il comune o la via" /></Field>
        <Field label={f.pp_tipo_previsto === 'CORNER' ? 'Legal entity del partner ospitante' : 'Legal entity (società TD o locatore)'} className="span2"><input value={f.cerca} onChange={(e) => setF({ ...f, cerca: e.target.value, organization_id: '' })} placeholder="cerca, almeno 2 lettere" autoFocus /></Field>
        {(orgs.data || []).length > 0 && <Field label="Legal entity" className="span2"><select value={f.organization_id} onChange={(e) => setF({ ...f, organization_id: e.target.value })} size={Math.min(8, orgs.data.length + 1)}><option value="">Scegli…</option>{orgs.data.map((o) => <option key={o.id} value={o.id}>{o.name}{o.city ? ` · ${o.city}` : ''}</option>)}</select></Field>}
      </div>
      <div className="small muted" style={{ marginTop: 8 }}>Quando la sede viene creata in Amministrazione &gt; Sedi (tipo Punto prelievi; per il corner con la Legal entity ospitante) la colleghi dalla scheda "Punto prelievi": il tipo si conferma dalla sede. Se la sede c'è già, usa "Crea il punto prelievi" dall'elenco delle sedi.</div>
    </Modal>
  );
}

// B13 (decisione 10 del CEO): le royalties del punto in Cash dai termini del contratto PP. La modale mostra le voci del contratto, i campi
// proposti e quelli già in Cash; con royalties diverse in Cash serve la spunta "Sovrascrivi" (mai sovrascritte senza conferma).
const RLABEL = { royalty_fixed_monthly: 'Quota fissa mensile', royalty_pct: 'Percentuale sui ricavi', royalty_base: 'Base', royalty_vat_rate: 'IVA %' };
const rval = (k, v) => (v == null ? '–' : k === 'royalty_fixed_monthly' ? eur(v) : k === 'royalty_pct' ? `${v}%` : k === 'royalty_base' ? ({ TOTALE: 'sul totale', CONTANTI_POS: 'contanti e POS', CONTANTI: 'contanti' }[v] || v) : String(v));
function RoyaltyModal({ punto, edit, onClose, onDone }) {
  const toast = useToast();
  const q = useApi(`/hub/punti-prelievo/${punto.pp_site_id}/royalty`);
  const [sovr, setSovr] = useState(false); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const p = q.data;
  const conferma = async () => { setBusy(true); setErr(null); try { await api.post(`/hub/punti-prelievo/${punto.pp_site_id}/royalty`, { sovrascrivi: sovr }); toast('Royalties registrate in Cash'); onDone(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  return (
    <Modal title={`Royalties in Cash · ${punto.nome}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button>{edit && <button className="btn" data-testid="royalty-conferma" disabled={busy || !p || !['NUOVA', 'DIVERSA'].includes(p.stato) || (p.stato === 'DIVERSA' && !sovr)} onClick={conferma}>Conferma in Cash</button>}</>}>
      <ErrorBox error={err || q.error} />
      {!p ? <Loading /> : <>
        <p className="small">Contratto PP{p.contratto?.protocol ? ` ${p.contratto.protocol}` : ''}: {p.contratto?.voci?.length ? p.contratto.voci.join('; ') : 'nessuna voce economica'}.</p>
        {p.avvisi?.map((a, i) => <div key={i} className="alert warn small"><Icon name="alert" /><span>{a}</span></div>)}
        {p.proposta && <table className="t small"><thead><tr><th>Campo di Cash</th><th>Dal contratto</th><th>Oggi in Cash</th></tr></thead><tbody>
          {Object.keys(RLABEL).map((k) => <tr key={k} className={p.differenze?.some((d) => d.campo === k) ? 'amber' : ''}><td>{RLABEL[k]}</td><td className="strong">{rval(k, p.proposta[k])}</td><td>{p.attuale ? rval(k, p.attuale[k]) : <span className="muted">non configurata</span>}</td></tr>)}
          <tr><td>Note</td><td colSpan={2} className="small muted">{p.proposta.royalty_notes}</td></tr>
        </tbody></table>}
        {p.stato === 'DIVERSA' && edit && <label className="row small" style={{ gap: 6, marginTop: 8 }}><input type="checkbox" checked={sovr} onChange={(e) => setSovr(e.target.checked)} />Sovrascrivi le royalties già impostate in Cash con quelle del contratto</label>}
        {!edit && <p className="small muted">La conferma la fa chi gestisce la linea Punti Prelievo (o Cash &gt; Sedi).</p>}
      </>}
    </Modal>
  );
}

// Business Hub · "Punti Prelievo e Centri" (richiesta del CEO del 09/11/2026: "Sedi TD in locazione non serve. I punti prelievo/centri medici li
// hai già: sono sedi"). Una pagina sola al posto di "Punti Prelievo" e "Punti e centri attivi": parte dalle SEDI dell'anagrafica (tutte le sedi
// attive di tipo punto prelievi, centro medico, centro diagnostico e poliambulatorio, più quelle in apertura: non attive con apertura futura) e
// per ognuna mostra tipo, titolo di godimento e ospitante/partner, apertura, responsabile, area TuoTempo e i dati del processo del Business Hub
// (account PP: fase, contratto PP, fascicolo, avvio, royalty) quando ci sono. Le azioni del processo creano l'account PP al volo per la sede
// (POST /hub/punti-centri/:siteId/account): la sede non deve "diventare" un punto prelievi. Nessun "Nuovo punto prelievi": le sedi nascono solo
// in Amministrazione > Sedi. La scheda del processo resta la scheda account (scheda "Punto prelievi": fascicoli, contratto, email, avvio).
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, BASE } from '../api.js';
import { useAuth, canEditKind } from '../auth.jsx';
import { useApi, Card, Field, Loading, ErrorBox, Empty, Badge, Modal, Icon, useToast } from '../components/ui.jsx';
import { eur, itDate, FASI, DOSSIER_STATUS, STATUS, TIPO_PUNTO } from '../format.js';

const SITE_KIND = { PUNTO_PRELIEVI: 'Punto prelievi', CENTRO_MEDICO: 'Centro medico', CENTRO_DIAGNOSTICO: 'Centro diagnostico', POLIAMBULATORIO: 'Poliambulatorio' };
const TENURE = { PROPRIETA: 'Proprietà', LOCAZIONE: 'Locazione', COMODATO: 'Comodato', OSPITATA: 'Ospitata' };
const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export default function PuntiPrelievo() {
  const { user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const q = useApi('/hub/punti-centri');
  const [filtro, setFiltro] = useState('');
  const [cerca, setCerca] = useState('');
  const [partner, setPartner] = useState(null);   // sede per "Avvia il processo con un partner"
  const [avvio, setAvvio] = useState(null);       // sede per "Avvia il punto prelievi"
  const [royalty, setRoyalty] = useState(null);
  const edit = canEditKind(user, 'PP');
  const d = q.data;
  // account PP della sede creato al volo (idempotente), poi l'azione
  const conAccount = async (s, azione, extra = {}) => {
    const r = await api.post(`/hub/punti-centri/${s.site_id}/account`, { azione, ...extra });
    if (r.creato) toast('Processo del Business Hub avviato per la sede');
    return r;
  };
  const esegui = async (s, azione) => {
    try {
      const r = await conAccount(s, azione);
      if (azione === 'CONTRATTO') nav(`${BASE}/contratti/nuovo/PP?site=${s.site_id}&org=${r.organization_id}`);
      else if (azione === 'FASCICOLO') nav(s.fascicolo ? `${BASE}/fascicoli/${s.fascicolo.id}` : `${BASE}/fascicoli/nuovo?site=${s.site_id}&org=${r.organization_id}`);
      else nav(`${BASE}/account/${r.id}?scheda=punto`);
    } catch (e) { toast(e.message, 'err'); }
  };
  const tutte = d?.sedi || [];
  const righe = tutte.filter((s) => (!filtro || (filtro === 'PROCESSO' ? s.account_id : filtro === 'APERTURA' ? s.in_apertura : filtro === 'SENZA_AREA' ? !s.area_tuotempo : filtro === 'SENZA_CODICE' ? !s.studiolab_code : s.kind === filtro))
    && (!cerca || norm(`${s.code} ${s.name} ${s.city || ''} ${s.host_name || ''} ${s.partner || ''} ${s.studiolab_code || ''}`).includes(norm(cerca))));
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Punti Prelievo e Centri</h1><div className="sub">Le sedi dell'anagrafica (Amministrazione &gt; Sedi): punti prelievo, centri medici, centri diagnostici e poliambulatori attivi o in apertura, con il processo del Business Hub quando c'è. Le sedi nascono e si chiudono solo in Amministrazione.</div></div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn ghost" to={`${BASE}/fascicoli`}><Icon name="folder" />Fascicoli autorizzazione</Link>
          <Link className="btn ghost" to={`${BASE}/contratti-pp`}>Contratti PP</Link>
          <a className="btn" href="/admin/sites" data-testid="nuova-sede-admin"><Icon name="plus" />Nuova sede in Amministrazione</a>
        </div>
      </div>
      {d && <div className="small muted" style={{ marginBottom: 8 }}>{d.riepilogo.sedi} sedi ({d.riepilogo.attive} attive{d.riepilogo.in_apertura ? `, ${d.riepilogo.in_apertura} in apertura` : ''}) · {d.riepilogo.con_processo} con il processo del Business Hub · {d.riepilogo.con_area_tuotempo} con l'area TuoTempo · {d.riepilogo.senza_codice} senza codice StudioLAB · {d.riepilogo.fascicoli_aperti} fascicoli aperti</div>}
      <div className="filters">
        <label className="f" style={{ minWidth: 220, flex: 1 }}>Cerca<input value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Codice, nome, città, partner" /></label>
        <label className="f">Mostra<select value={filtro} onChange={(e) => setFiltro(e.target.value)}><option value="">Tutte le sedi</option>{Object.entries(SITE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="PROCESSO">Con il processo avviato</option><option value="APERTURA">In apertura</option><option value="SENZA_AREA">Senza area TuoTempo</option><option value="SENZA_CODICE">Senza codice StudioLAB ({d?.riepilogo?.senza_codice ?? '…'})</option></select></label>
        <div className="spacer" /><div className="small muted" style={{ alignSelf: 'center' }}>{righe.length} sedi</div>
      </div>
      <ErrorBox error={q.error} />
      <Card flush>{!d ? <Loading /> : righe.length ? (
        <div className="table-wrap"><table className="t" data-testid="punti-centri">
          <thead><tr><th>Sede</th><th>Codice StudioLAB</th><th>Tipo e titolo</th><th>Apertura e responsabile</th><th>Area TuoTempo</th><th>Processo del Business Hub</th><th /></tr></thead>
          <tbody>{righe.map((s) => (
            <tr key={s.site_id} className={s.in_apertura ? 'muted' : ''}>
              <td style={{ minWidth: 200 }}><div className="strong">{s.name}</div><div className="small muted mono">{s.code}</div><div className="small muted">{[s.address, [s.zip, s.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</div>{s.in_apertura && <Badge tone="amber">in apertura</Badge>}</td>
              <td className="small" data-testid="codice-punto">{s.studiolab_code ? <span className="mono strong">{s.studiolab_code}</span> : <Badge tone="amber">senza codice</Badge>}
                {(s.synclab_clients || []).map((c) => <div key={c.client_id} className="muted" title="Client del gestionale (Synclab)">{c.client_code !== s.studiolab_code ? <span className="mono">{c.client_code} </span> : null}{c.legal_name}{c.active === false ? ' (non attivo)' : ''}</div>)}
                {s.studiolab_code && !(s.synclab_clients || []).length ? <div className="tiny muted">nessun client del gestionale</div> : null}</td>
              <td className="small">{SITE_KIND[s.kind] || s.kind}{s.tipo && <> · <Badge tone={TIPO_PUNTO[s.tipo].tone}>{TIPO_PUNTO[s.tipo].label}</Badge>{s.tipo_fonte === 'previsto' && <span className="muted"> previsto</span>}</>}
                <div style={{ marginTop: 4 }}><Badge tone={s.tenure === 'PROPRIETA' ? 'green' : s.tenure === 'OSPITATA' ? 'mauve' : 'blue'}>{TENURE[s.tenure] || s.tenure || '–'}</Badge>{s.host_name ? <span className="muted"> ospitata da {s.host_name}</span> : s.partner ? <span className="muted"> partner {s.partner}</span> : null}</div>
                {s.coerenza_sedi && s.coerenza_sedi.stato !== 'OK' && <div title={s.coerenza_sedi.testo}><Badge tone={s.coerenza_sedi.stato === 'CONFLITTO' ? 'red' : 'amber'}>{{ DA_IMPOSTARE: 'ospitante da impostare', CONFLITTO: 'ospitante diverso dal contratto', SENZA_SEDE: 'senza sede' }[s.coerenza_sedi.stato] || s.coerenza_sedi.stato}</Badge></div>}</td>
              <td className="small">{s.opened_at ? <div>{s.in_apertura ? 'apre il ' : 'aperta dal '}{itDate(s.opened_at)}</div> : <div className="muted">apertura –</div>}<div>{s.manager_name || <span className="muted">responsabile da assegnare</span>}</div></td>
              <td className="small">{s.area_tuotempo ? <><Badge tone="teal">abbinata</Badge>{s.area_tuotempo.titolo && <div className="muted">{s.area_tuotempo.titolo}{s.area_tuotempo.is_hidden ? ' (nascosta online)' : ''}</div>}</> : <span className="muted">{s.area_tuotempo_note || 'non abbinata'}</span>}</td>
              <td className="small" style={{ minWidth: 220 }}>{!s.account_id ? <span className="muted">non avviato</span> : <div style={{ display: 'grid', gap: 3 }}>
                <div><Badge tone={FASI[s.fase_corrente]?.tone}>{FASI[s.fase_corrente]?.short}</Badge>{s.account_org_name && s.account_org_name !== s.organization_name && <span className="muted"> {s.account_org_name}</span>}{s.owner_name && <span className="muted"> · {s.owner_name}</span>}</div>
                <div>Contratto PP: {s.contratto ? <>{s.contratto.protocol || 'bozza'} <Badge tone={STATUS[s.contratto.status]?.tone}>{STATUS[s.contratto.status]?.label}</Badge></> : <span className="muted">{s.tipo === 'CORNER' ? 'nessuno' : 'non previsto (flagship)'}</span>}</div>
                <div>Fascicolo: {s.fascicolo ? <><Badge tone={DOSSIER_STATUS[s.fascicolo.status]?.tone}>{DOSSIER_STATUS[s.fascicolo.status]?.label}</Badge>{s.fascicolo.authorized_at && <span className="muted"> {itDate(s.fascicolo.authorized_at)}</span>}</> : <span className="muted">–</span>}</div>
                <div>Avvio: {s.data_avvio_effettiva ? <b>{itDate(s.data_avvio_effettiva)} </b> : s.data_avvio_prevista ? <span>previsto {itDate(s.data_avvio_prevista)} </span> : null}{s.avvio ? <Badge tone={s.avvio.completo ? 'green' : s.avvio.falliti.length ? 'red' : 'mauve'}>{s.avvio.completo ? 'passi completati' : `${s.avvio.fatti}/${s.avvio.previsti} passi`}</Badge> : <span className="muted">non avviato</span>}</div>
                {s.royalty && <div>Royalty: {['NUOVA', 'DIVERSA'].includes(s.royalty.stato)
                  ? <button className="btn sm ghost" onClick={() => setRoyalty({ ...s, pp_site_id: s.site_id, nome: s.name })}><Badge tone={s.royalty.stato === 'DIVERSA' ? 'amber' : 'mauve'}>{s.royalty.stato === 'DIVERSA' ? 'diverse dal contratto' : 'da confermare'}</Badge></button>
                  : <Badge tone={s.royalty.stato === 'UGUALE' ? 'green' : 'grey'}>{{ UGUALE: 'allineate', NON_OSPITATA: 'sede non ospitata', CASH_NON_AVVIATO: 'Cash non avviato' }[s.royalty.stato] || s.royalty.stato}</Badge>}</div>}
              </div>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                {s.account_id && <button className="btn sm" onClick={() => nav(`${BASE}/account/${s.account_id}?scheda=punto`)}>Apri il processo</button>}
                {edit && <details className="azioni" style={{ display: 'inline-block', marginLeft: 6, verticalAlign: 'top' }}><summary className="btn sm ghost">Azioni</summary>
                  <div style={{ display: 'grid', gap: 4, marginTop: 4 }}>
                    {!s.account_id && !s.host_organization_id && <button className="btn sm ghost" data-testid={`partner-${s.code}`} onClick={() => setPartner(s)}>Avvia il processo con un partner</button>}
                    <button className="btn sm ghost" onClick={() => esegui(s, 'CONTRATTO')}>Contratto PP</button>
                    <button className="btn sm ghost" onClick={() => esegui(s, 'FASCICOLO')}>Fascicolo</button>
                    {s.tipo === 'FLAGSHIP' && !s.avvio && <button className="btn sm ghost" data-testid={`avvio-${s.code}`} onClick={() => setAvvio(s)}>Avvia il punto prelievi</button>}
                    <a className="btn sm ghost" href={`/admin/sites?q=${encodeURIComponent(s.code)}`}>Scheda in Amministrazione</a>
                  </div></details>}
              </td>
            </tr>))}</tbody>
        </table></div>
      ) : <Empty>Nessuna sede {filtro ? 'con questo filtro' : 'di questi tipi in Amministrazione > Sedi'}</Empty>}</Card>

      {d?.processi_senza_sede?.length > 0 && <Card title={`Processi senza sede in anagrafica (${d.processi_senza_sede.length})`} className="mt" flush>
        <div className="small muted" style={{ padding: '8px 14px' }}>Account Punti Prelievo nati prima della sede: crea la sede in Amministrazione &gt; Sedi e collegala dalla scheda del processo.</div>
        <table className="t"><tbody>{d.processi_senza_sede.map((a) => <tr key={a.id} className="click" onClick={() => nav(`${BASE}/account/${a.id}?scheda=punto`)}>
          <td><div className="strong">{a.pp_nome || a.org_name}</div><div className="small muted">{a.org_name}{a.owner_name ? ` · ${a.owner_name}` : ''}</div></td>
          <td>{a.pp_tipo_previsto ? <Badge tone={TIPO_PUNTO[a.pp_tipo_previsto].tone}>{TIPO_PUNTO[a.pp_tipo_previsto].label} previsto</Badge> : null}</td>
          <td><Badge tone={FASI[a.fase_corrente]?.tone}>{FASI[a.fase_corrente]?.short}</Badge></td>
          <td className="small">{a.data_avvio_prevista ? `avvio previsto ${itDate(a.data_avvio_prevista)}` : ''}</td>
        </tr>)}</tbody></table>
      </Card>}

      {partner && <PartnerModal sede={partner} onClose={() => setPartner(null)} onDone={(id) => nav(`${BASE}/account/${id}?scheda=punto`)} conAccount={conAccount} />}
      {avvio && <AvvioModal sede={avvio} onClose={() => setAvvio(null)} onDone={() => { setAvvio(null); q.reload(); }} conAccount={conAccount} />}
      {royalty && <RoyaltyModal punto={royalty} edit={edit} onClose={() => setRoyalty(null)} onDone={() => { setRoyalty(null); q.reload(); }} />}
    </div>
  );
}

// "Avvia il processo con un partner": la sede (non ancora ospitata) e la Legal entity del partner; l'account PP nasce sul partner (corner
// previsto) e la sede diventa Ospitata dal partner alla firma del contratto PP (A1)
function PartnerModal({ sede, onClose, onDone, conAccount }) {
  const toast = useToast();
  const [cerca, setCerca] = useState('');
  const [orgId, setOrgId] = useState('');
  const orgs = useApi(cerca.length >= 2 ? `/organizations?q=${encodeURIComponent(cerca)}` : null, [cerca]);
  const go = async () => { try { if (!orgId) throw new Error('Scegli la Legal entity del partner'); const r = await conAccount(sede, 'PARTNER', { partner_org_id: Number(orgId) }); onDone(r.id); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Modal title={`Avvia il processo con un partner · ${sede.name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" data-testid="partner-conferma" onClick={go}>Avvia il processo</button></>}>
      <div className="form-grid">
        <Field label="Legal entity del partner ospitante" className="span2"><input value={cerca} onChange={(e) => { setCerca(e.target.value); setOrgId(''); }} placeholder="cerca, almeno 2 lettere" autoFocus data-testid="partner-cerca" /></Field>
        {(orgs.data || []).length > 0 && <Field label="Legal entity" className="span2"><select value={orgId} onChange={(e) => setOrgId(e.target.value)} size={Math.min(8, orgs.data.length + 1)} data-testid="partner-scelta"><option value="">Scegli…</option>{orgs.data.map((o) => <option key={o.id} value={o.id}>{o.name}{o.city ? ` · ${o.city}` : ''}</option>)}</select></Field>}
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>Nasce il processo corner sulla Legal entity del partner per questa sede: contratto PP da network@, form del partner, fascicolo e avvio. Alla firma del contratto la sede diventa "Ospitata" dal partner in Amministrazione &gt; Sedi. Se il partner non è in anagrafica, crealo in Amministrazione &gt; Legal entity.</p>
    </Modal>
  );
}

// "Avvia il punto prelievi" (flagship): account PP al volo, poi l'avvio con la data effettiva obbligatoria (passi c-g)
function AvvioModal({ sede, onClose, onDone, conAccount }) {
  const toast = useToast();
  const [data, setData] = useState(sede.opened_at ? String(sede.opened_at).slice(0, 10) : '');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { if (!data) throw new Error('Indica la data di avvio effettiva'); const r = await conAccount(sede, 'AVVIO'); const out = await api.post(`/hub/accounts/${r.id}/avvio`, { data }); toast(`Punto avviato: ${out.riepilogo?.fatti ?? 0}/${out.riepilogo?.previsti ?? 0} passi`); if (out.avvisi?.length) toast(out.avvisi.join(' · '), 'warn'); onDone(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Avvia il punto prelievi · ${sede.name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy} data-testid="avvio-conferma" onClick={go}>Avvia</button></>}>
      <Field label="Data di avvio effettiva"><input type="date" value={data} onChange={(e) => setData(e.target.value)} /></Field>
      <p className="small muted" style={{ marginTop: 8 }}>Flagship: comunicazioni al laboratorio, primo ordine standard, dotazione, fondo cassa e rifiuti speciali (passi dell'avvio, una volta sola). La data diventa l'apertura della sede in Amministrazione &gt; Sedi se non ne ha già una.</p>
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

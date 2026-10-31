// Dispositivi installati: filtri per sede, categoria, stato, testo, non conformi; nuovo dispositivo dal Catalogo di Amministrazione
// (le scadenze del piano nascono da sole); etichette QR in PDF per la sede
import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, base, useApi, qs, apiBase } from '../api.js';
import { Card, Loading, Empty, PageHead, Modal, Field, SearchInput, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useAuth, isFacility } from '../index.jsx';
import { AssetStatus, Outcome, SiteSelect, useSites } from '../components/bits.jsx';
import { CATEGORY, ASSET_STATUS, itDate } from '../format.js';

export default function Dispositivi() {
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const sites = useSites();
  const [f, setF] = useState({ site_id: sp.get('site_id') || '', category: '', status: '', q: '', non_conformi: '' });
  const [nuovo, setNuovo] = useState(sp.get('nuovo') === '1');
  const { data, loading, error, reload } = useApi(`/dispositivi${qs(f)}`, [], { silent: true });
  const nav = useNavigate();
  const set = (k) => (v) => setF({ ...f, [k]: v });
  return (
    <div className="page">
      <PageHead title="Dispositivi" icon="qr" sub="Dispositivi sotto manutenzione nelle sedi, compresi quelli di sicurezza. Tipi e periodicità dal Catalogo dispositivi di Amministrazione."
        actions={<><a className="btn ghost" href={`${apiBase}/etichette.pdf${qs({ site_id: f.site_id, inline: 1 })}`} target="_blank" rel="noreferrer"><Icon name="qr" />Etichette QR</a>{isFacility(user) && <button className="btn" onClick={() => setNuovo(true)}><Icon name="plus" />Nuovo dispositivo</button>}</>} />
      <div className="fa-filters">
        <SiteSelect value={f.site_id} onChange={set('site_id')} sites={sites} />
        <select className="fa-in" value={f.category} onChange={(e) => set('category')(e.target.value)}><option value="">Tutte le categorie</option>{Object.entries(CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="fa-in" value={f.status} onChange={(e) => set('status')(e.target.value)}><option value="">In servizio e fuori servizio</option>{Object.entries(ASSET_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={f.non_conformi === '1'} onChange={(e) => set('non_conformi')(e.target.checked ? '1' : '')} />Solo non conformi</label>
        <SearchInput value={f.q} onChange={set('q')} placeholder="Codice, marca, matricola, locale" />
      </div>
      {error ? <Empty icon="alert" title="Errore">{error.message}</Empty> : !data && loading ? <Loading /> : (
        <Card flush>
          {!data.rows.length ? <Empty icon="qr" title="Nessun dispositivo">{isFacility(user) ? 'Registra estintori, porte REI, impianti ed elettromedicali con "Nuovo dispositivo".' : 'Nessun dispositivo nel tuo perimetro.'}</Empty> : (
            <table className="t fa-table"><thead><tr><th>Codice</th><th>Dispositivo</th><th>Categoria</th><th>Sede · locale</th><th>Manutentore</th><th>Prossimo controllo</th><th>Prossima manutenzione</th><th>Ultimo esito</th><th>Stato</th></tr></thead>
              <tbody>{data.rows.map((a) => <tr key={a.id} className={`click ${a.n_overdue ? 'late' : ''}`} onClick={() => nav(`${base}/dispositivi/${a.id}`)}>
                <td><Link to={`${base}/dispositivi/${a.id}`} onClick={(e) => e.stopPropagation()}>{a.code}</Link></td><td>{a.name || a.type_name}<div className="small muted">{a.type_name}{a.brand ? ` · ${a.brand}${a.model ? ` ${a.model}` : ''}` : ''}</div></td>
                <td className="small">{CATEGORY[a.category]}</td><td>{a.site_name}{a.location && <div className="small muted">{a.location}</div>}</td><td className="small">{a.vendor_name || '–'}</td>
                <td>{itDate(a.next_check_due) || '–'}{a.n_overdue > 0 && <div className="small" style={{ color: 'var(--red)' }}>{a.n_overdue} scadute</div>}</td><td>{itDate(a.next_maintenance_due) || '–'}</td><td><Outcome o={a.last_outcome} /></td><td><AssetStatus s={a.status} /></td></tr>)}</tbody></table>)}
        </Card>)}
      {nuovo && <AssetModal sites={sites} siteId={f.site_id || sp.get('site_id')} onClose={() => { setNuovo(false); if (sp.get('nuovo')) { sp.delete('nuovo'); setSp(sp, { replace: true }); } }} onDone={(a) => { setNuovo(false); reload(); nav(`${base}/dispositivi/${a.id}`); }} />}
    </div>
  );
}

export function AssetModal({ sites, siteId, asset, onClose, onDone }) {
  const toast = useToast();
  const isNew = !asset;
  const [f, setF] = useState(asset ? { site_id: asset.site_id, asset_type_code: asset.asset_type_code, code: asset.code, name: asset.name || '', brand: asset.brand || '', model: asset.model || '', serial: asset.serial || '', location: asset.location || '', installed_at: asset.installed_at || '', warranty_until: asset.warranty_until || '',
    vendor_org_id: asset.vendor_org_id || '', contract_ref: asset.contract_ref || '', status: asset.status, surveillance_months: asset.surveillance_months ?? '', check_interval_months: asset.check_interval_months ?? '', maintenance_interval_months: asset.maintenance_interval_months ?? '', notes: asset.notes || '' }
    : { site_id: siteId || '', asset_type_code: '', code: '', name: '', brand: '', model: '', serial: '', location: '', installed_at: '', warranty_until: '', vendor_org_id: '', contract_ref: '', next_check_due: '', next_maintenance_due: '', notes: '' });
  const site = sites.find((s) => String(s.id) === String(f.site_id));
  const { data: cat } = useApi(`/catalogo${qs({ site_kind: site?.kind })}`);
  const { data: man } = useApi('/manutentori');
  const t = (cat || []).find((x) => x.code === f.asset_type_code);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const byCat = {};
  for (const x of cat || []) (byCat[x.category] = byCat[x.category] || []).push(x);
  const save = async () => {
    try {
      const body = { ...f }; for (const k of Object.keys(body)) if (body[k] === '' && !['code'].includes(k)) body[k] = null;
      if (!body.code) delete body.code;
      const r = isNew ? await api.post('/dispositivi', body) : await api.put(`/dispositivi/${asset.id}`, body);
      toast(isNew ? `Dispositivo ${r.code} registrato: ${r.scadenze_create} scadenze nel piano` : 'Dispositivo aggiornato'); onDone(r);
    } catch (e) { toast(e, 'err'); }
  };
  return (
    <Modal wide title={isNew ? 'Nuovo dispositivo' : `Dispositivo ${asset.code}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={save}>{isNew ? 'Registra' : 'Salva'}</button></>}>
      <div className="fa-grid">
        <Field label="Sede" required><SiteSelect className="fa-in w" value={f.site_id} onChange={(v) => setF({ ...f, site_id: v })} sites={sites} all="Scegli la sede" /></Field>
        <Field label="Tipo (Catalogo dispositivi)" required><select className="fa-in w" value={f.asset_type_code} onChange={set('asset_type_code')}><option value="">Scegli il tipo</option>{Object.entries(byCat).map(([c, xs]) => <optgroup key={c} label={CATEGORY[c]}>{xs.map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</optgroup>)}</select></Field>
        <Field label="Codice interno" help="Vuoto = generato (sede-tipo-numero)"><input className="fa-in w" value={f.code} onChange={set('code')} /></Field>
        <Field label="Descrizione"><input className="fa-in w" value={f.name} onChange={set('name')} placeholder="es. Estintore corridoio" /></Field>
        <Field label="Locale / posizione"><input className="fa-in w" value={f.location} onChange={set('location')} /></Field>
        <Field label="Manutentore (Legal entity)"><select className="fa-in w" value={f.vendor_org_id} onChange={set('vendor_org_id')}><option value="">Interno / non indicato</option>{(man?.vendors || []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
        <Field label="Marca"><input className="fa-in w" value={f.brand} onChange={set('brand')} /></Field>
        <Field label="Modello"><input className="fa-in w" value={f.model} onChange={set('model')} /></Field>
        <Field label="Matricola"><input className="fa-in w" value={f.serial} onChange={set('serial')} /></Field>
        <Field label="Installato il"><input className="fa-in w" type="date" value={f.installed_at} onChange={set('installed_at')} /></Field>
        <Field label="Garanzia fino al"><input className="fa-in w" type="date" value={f.warranty_until} onChange={set('warranty_until')} /></Field>
        <Field label="Contratto di manutenzione"><input className="fa-in w" value={f.contract_ref} onChange={set('contract_ref')} /></Field>
        {isNew ? <>
          <Field label="Prossimo controllo" help="Vuoto = installazione + periodicità, oppure oggi"><input className="fa-in w" type="date" value={f.next_check_due} onChange={set('next_check_due')} /></Field>
          <Field label="Prossima manutenzione"><input className="fa-in w" type="date" value={f.next_maintenance_due} onChange={set('next_maintenance_due')} /></Field>
        </> : <Field label="Stato"><select className="fa-in w" value={f.status} onChange={set('status')}>{Object.entries(ASSET_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>}
      </div>
      {t && <div className="fa-muted-box" style={{ marginTop: 10 }}>
        <b>Periodicità del catalogo</b>: {[t.surveillance_months && `sorveglianza di sede ogni ${t.surveillance_months} mesi`, t.check_interval_months && `${t.check_kind === 'VERIFICA_NORMATIVA' ? 'verifica periodica' : 'controllo'} ogni ${t.check_interval_months} mesi`, t.maintenance_interval_months && `manutenzione ogni ${t.maintenance_interval_months} mesi`].filter(Boolean).join(' · ')}.
        {t.legal_reference && <div className="small muted">Riferimento: {t.legal_reference}</div>}<div className="small muted">{t.benchmark_note}</div>
      </div>}
      <div className="fa-grid" style={{ marginTop: 10 }}>
        <Field label="Sorveglianza propria (mesi)"><input className="fa-in w" type="number" min="1" value={f.surveillance_months ?? ''} onChange={set('surveillance_months')} placeholder={t?.surveillance_months || ''} /></Field>
        <Field label="Controllo proprio (mesi)"><input className="fa-in w" type="number" min="1" value={f.check_interval_months ?? ''} onChange={set('check_interval_months')} placeholder={t?.check_interval_months || ''} /></Field>
        <Field label="Manutenzione propria (mesi)" help="Vuoto = quella del catalogo"><input className="fa-in w" type="number" min="1" value={f.maintenance_interval_months ?? ''} onChange={set('maintenance_interval_months')} placeholder={t?.maintenance_interval_months || ''} /></Field>
      </div>
      <Field label="Note"><textarea className="fa-note" rows={2} value={f.notes} onChange={set('notes')} /></Field>
    </Modal>
  );
}

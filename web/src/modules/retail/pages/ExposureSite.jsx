import React, { useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useApi, Card, Loading, ErrorBox, Empty, Field, Badge, ToneBadge, useToast, Kpi, Icon, Progress, Modal } from '../components/ui.jsx';
import { api, base, apiBase } from '../api.js';
import { num, itDate, EXPO_STATUS, SITE_KIND } from '../format.js';

export default function ExposureSite() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const d = useApi(`/exposure/sites/${id}`);
  const zones = useApi('/exposure/zones');
  const promos = useApi(`/promotions?year=${new Date().getFullYear()}`);
  const fileInput = useRef(null);
  const [add, setAdd] = useState(null);
  const [photoFor, setPhotoFor] = useState(null);
  const [preview, setPreview] = useState(null);
  const data = d.data;
  if (d.error) return <div className="page"><ErrorBox error={d.error} /></div>;
  if (!data) return <div className="page"><Loading /></div>;
  const { site, items, missing, photos, can_edit } = data;
  const active = items.filter((i) => i.status !== 'RIMOSSO');
  const ok = active.filter((i) => i.status === 'INSTALLATO').length;
  const setStatus = async (it, status) => { try { await api.put(`/exposure/items/${it.id}`, { status }); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const setContent = async (it, content) => { try { await api.put(`/exposure/items/${it.id}`, { content }); } catch (e) { toast(e.message, 'err'); } };
  const applyStd = async () => { try { const r = await api.post(`/exposure/sites/${id}/apply-standard`); toast(`${r.created} materiali aggiunti dallo standard`); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const checkAll = async () => { if (!window.confirm('Segnare tutti i materiali come installati e verificati oggi?')) return; try { const r = await api.post(`/exposure/sites/${id}/check-all`, { status: 'INSTALLATO' }); toast(`${r.updated} materiali verificati`); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const uploadPhoto = async (f) => { if (!f) return; try { const fd = new FormData(); fd.append('file', f); if (photoFor) fd.append('item_id', photoFor); await api.upload(`/exposure/sites/${id}/photos`, fd); toast('Foto caricata'); setPhotoFor(null); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const saveAdd = async () => { try { await api.post(`/exposure/sites/${id}/items`, { ...add, zone_id: Number(add.zone_id), quantity: Number(add.quantity) || 1, promotion_id: add.promotion_id ? Number(add.promotion_id) : null }); toast('Materiale aggiunto'); setAdd(null); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{site.name}</h1><div className="sub">{SITE_KIND[site.kind]} · {site.address || ''}{site.city ? `, ${site.city}` : ''} · site manager: {site.manager || 'da definire'}{site.sqm_waiting ? ` · sala d'attesa ${site.sqm_waiting} mq` : ''}</div></div>
        <div className="row">
          <button className="btn ghost" onClick={() => nav(`${base}/esposizione`)}>Tutte le sedi</button>
          <a className="btn ghost" href={`${apiBase}/exposure/book.pptx?site_id=${id}`}><Icon name="download" />Book PPTX</a>
          {can_edit && missing.length > 0 && <button className="btn ghost" onClick={applyStd}>Applica standard ({missing.length})</button>}
          {can_edit && <button className="btn ghost" onClick={() => { setPhotoFor(null); fileInput.current?.click(); }}><Icon name="camera" />Foto sede</button>}
          {can_edit && <button className="btn" onClick={checkAll}><Icon name="check" />Verifica completata</button>}
          {can_edit && <button className="btn" onClick={() => setAdd({ zone_id: zones.data?.[0]?.id || '', quantity: 1, status: 'INSTALLATO' })}>+ Materiale</button>}
        </div>
      </div>
      <input ref={fileInput} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => { uploadPhoto(e.target.files?.[0]); e.target.value = ''; }} />
      <div className="grid g4" style={{ marginBottom: 16 }}>
        <Kpi accent label="Conformità" value={active.length ? `${Math.round((ok / active.length) * 100)}%` : '–'} foot={`${ok} installati su ${active.length}`} />
        <Kpi label="Da sostituire / non conformi" value={num(active.filter((i) => ['DA_SOSTITUIRE', 'NON_CONFORME'].includes(i.status)).length)} />
        <Kpi label="Da installare" value={num(active.filter((i) => i.status === 'DA_INSTALLARE').length + missing.length)} foot={missing.length ? `${missing.length} previsti dallo standard e non ancora nel book` : ''} />
        <Kpi label="Ultima verifica" value={active.some((i) => i.checked_at) ? itDate(active.map((i) => i.checked_at).filter(Boolean).sort().pop()) : 'mai'} foot={active.find((i) => i.checked_by)?.checked_by || ''} />
      </div>
      <Card title="Book retail della sede" actions={<span className="small muted">per zona espositiva · cambia lo stato direttamente dalla tendina</span>}>
        {!active.length && !missing.length ? <Empty>Nessun materiale. {can_edit ? 'Applica lo standard per iniziare.' : ''}</Empty> : (zones.data || []).map((z) => {
          const list = active.filter((i) => i.zone_id === z.id); const miss = missing.filter((m) => m.zone_id === z.id);
          if (!list.length && !miss.length) return null;
          return (
            <div key={z.id} className="zone">
              <div className="zh"><h3>{z.name}</h3><span className="small muted">{z.description}</span><div className="spacer" /><span className="small muted">{list.filter((i) => i.status === 'INSTALLATO').length}/{list.length}</span></div>
              {list.map((it) => (
                <div key={it.id} className="item-row">
                  <div><div className="strong">{it.material}</div><div className="small muted">{it.format || ''}{it.quantity > 1 ? ` · ${it.quantity} pz` : ''}{it.mandatory === false ? ' · facoltativo' : ''}{it.photos ? ` · ${it.photos} foto` : ''}</div></div>
                  <div className="rule">{it.rule || ''}{it.promotion_name ? <div className="pill" style={{ marginTop: 4 }}>{it.promotion_name}</div> : null}</div>
                  <div>{can_edit ? <input defaultValue={it.content || ''} placeholder="Cosa è esposto (claim, promo, servizio)" onBlur={(e) => e.target.value !== (it.content || '') && setContent(it, e.target.value)} style={{ height: 32 }} /> : <span className="small">{it.content || '–'}</span>}{it.valid_to && <div className="small muted">valido fino al {itDate(it.valid_to)}</div>}</div>
                  <div>{can_edit ? <select value={it.status} onChange={(e) => setStatus(it, e.target.value)} style={{ color: `var(--${EXPO_STATUS[it.status]?.tone === 'green' ? 'green' : EXPO_STATUS[it.status]?.tone === 'red' ? 'red' : 'ink'})` }}>{Object.entries(EXPO_STATUS).map(([k, l]) => <option key={k} value={k}>{l.label}</option>)}</select> : <ToneBadge map={EXPO_STATUS} value={it.status} />}</div>
                  <div className="small muted" style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>{it.checked_at ? <span>{itDate(it.checked_at)}<br />{it.checked_by || ''}</span> : <span>non verificato</span>}{can_edit && <button className="iconbtn nav" title="Foto del materiale" onClick={() => { setPhotoFor(it.id); fileInput.current?.click(); }}><Icon name="camera" /></button>}{can_edit && <button className="iconbtn" title="Elimina" onClick={async () => { if (!window.confirm('Eliminare il materiale dal book?')) return; await api.del(`/exposure/items/${it.id}`); d.reload(); }}><Icon name="trash" /></button>}</div>
                </div>
              ))}
              {miss.map((m) => <div key={`m${m.id}`} className="item-row" style={{ opacity: .6 }}><div><div className="strong">{m.material}</div><div className="small muted">{m.format || ''} · previsto dallo standard</div></div><div className="rule">{m.rule}</div><div /><div><Badge tone="grey">non nel book</Badge></div><div className="num">{can_edit && <button className="btn sm ghost" onClick={applyStd}>Aggiungi</button>}</div></div>)}
            </div>
          );
        })}
      </Card>
      <Card title={`Foto (${photos.length})`} className="card mt" actions={<span className="small muted">verifiche in sede: clicca per ingrandire</span>}>
        {photos.length ? <div className="photos">{photos.map((p) => <img key={p.id} src={`${apiBase}/exposure/photos/${p.id}`} alt={p.filename} title={`${itDate(p.taken_at)} · ${p.filename}`} onClick={() => setPreview(p)} style={{ cursor: 'zoom-in' }} />)}</div> : <Empty>Nessuna foto caricata</Empty>}
      </Card>
      {preview && <Modal title={`${itDate(preview.taken_at)} · ${preview.filename}`} onClose={() => setPreview(null)} wide footer={<>{can_edit && <button className="btn danger" onClick={async () => { await api.del(`/exposure/photos/${preview.id}`); setPreview(null); d.reload(); }}>Elimina foto</button>}<button className="btn" onClick={() => setPreview(null)}>Chiudi</button></>}><img src={`${apiBase}/exposure/photos/${preview.id}`} alt="" style={{ maxWidth: '100%', borderRadius: 10 }} /></Modal>}
      {add && <Modal title="Nuovo materiale nel book" onClose={() => setAdd(null)} footer={<><button className="btn ghost" onClick={() => setAdd(null)}>Annulla</button><button className="btn" disabled={!add.material || !add.zone_id} onClick={saveAdd}>Aggiungi</button></>}>
        <div className="form-grid">
          <Field label="Zona"><select value={add.zone_id} onChange={(e) => setAdd({ ...add, zone_id: e.target.value })}>{(zones.data || []).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>
          <Field label="Stato"><select value={add.status} onChange={(e) => setAdd({ ...add, status: e.target.value })}>{Object.entries(EXPO_STATUS).map(([k, l]) => <option key={k} value={k}>{l.label}</option>)}</select></Field>
          <Field label="Materiale *" className="span2"><input value={add.material || ''} onChange={(e) => setAdd({ ...add, material: e.target.value })} /></Field>
          <Field label="Formato"><input value={add.format || ''} onChange={(e) => setAdd({ ...add, format: e.target.value })} /></Field>
          <Field label="Quantità"><input type="number" min="1" value={add.quantity} onChange={(e) => setAdd({ ...add, quantity: e.target.value })} /></Field>
          <Field label="Promozione"><select value={add.promotion_id || ''} onChange={(e) => setAdd({ ...add, promotion_id: e.target.value })}><option value="">–</option>{(promos.data || []).map((p) => <option key={p.id} value={p.id}>{p.month}/{p.year} · {p.name}</option>)}</select></Field>
          <Field label="Contenuto esposto" className="span2"><input value={add.content || ''} onChange={(e) => setAdd({ ...add, content: e.target.value })} /></Field>
          <Field label="Valido dal"><input type="date" value={add.valid_from || ''} onChange={(e) => setAdd({ ...add, valid_from: e.target.value })} /></Field>
          <Field label="Valido al"><input type="date" value={add.valid_to || ''} onChange={(e) => setAdd({ ...add, valid_to: e.target.value })} /></Field>
        </div>
      </Modal>}
      {user.role === 'SEDE' && !can_edit && <p className="small muted" style={{ marginTop: 12 }}>Questa non è la tua sede: puoi consultare il book ma non modificarlo. <Link to={`${base}/esposizione/${user.site_id}`}>Vai alla tua sede</Link>.</p>}
    </div>
  );
}

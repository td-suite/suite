import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { useApi, Card, Badge, Skeleton, Empty, ErrorBox, PageHead, Field, SearchInput, useToast, Modal, Switch } from '../../components/ui.jsx';
import { Icon } from '../../components/Icons.jsx';
import { SITE_KIND, ORG_KIND, PERSON_KIND } from '../../format.js';

// Chip dei riferimenti alle sorgenti legacy: { cash: 12, nc: "SITE-3", ... } oppure [{source, id}]
export function LegacyRefs({ refs }) {
  if (!refs) return null;
  const list = Array.isArray(refs) ? refs.map((r) => [r.source || r.key, r.id ?? r.ref]) : Object.entries(refs);
  if (!list.length) return null;
  return <div className="row tight" style={{ gap: 4 }}>{list.map(([k, v], i) => <span key={i} className="chip" title={`Riferimento in ${k}`}><Icon name="external" />{k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>)}</div>;
}

// Modale generica di modifica (campi: {key,label,type,options,help})
function EditModal({ title, fields, item, onSave, onClose }) {
  const toast = useToast();
  const [f, setF] = useState(() => Object.fromEntries(fields.map((x) => [x.key, item?.[x.key] ?? (x.type === 'bool' ? (x.default ?? true) : '')])));
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    const body = {};
    for (const x of fields) { const v = f[x.key]; body[x.key] = x.type === 'bool' ? Boolean(v) : x.type === 'number' ? (v === '' ? null : Number(v)) : v === '' ? null : v; }
    try { await onSave(body); onClose(); } catch (e2) { toast(e2, 'err'); }
    setBusy(false);
  };
  return (
    <Modal title={title} onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" form="eform" disabled={busy}>Salva</button></>}>
      <form id="eform" onSubmit={save} className="form-grid">
        {fields.map((x) => (
          <Field key={x.key} label={x.label} help={x.help} required={x.required} className={x.wide ? 'span2' : ''}>
            {x.type === 'select' ? <select value={f[x.key] ?? ''} onChange={(e) => setF({ ...f, [x.key]: e.target.value })}>{!x.required && <option value="">Nessuno</option>}{x.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              : x.type === 'bool' ? <div style={{ paddingTop: 6 }}><Switch checked={f[x.key]} onChange={(v) => setF({ ...f, [x.key]: v })} label={x.label} /></div>
                : x.type === 'textarea' ? <textarea value={f[x.key] ?? ''} onChange={(e) => setF({ ...f, [x.key]: e.target.value })} style={{ minHeight: 60 }} />
                  : <input type={x.type === 'number' ? 'number' : x.type || 'text'} step={x.step} value={f[x.key] ?? ''} onChange={(e) => setF({ ...f, [x.key]: e.target.value })} required={x.required} maxLength={x.max} />}
          </Field>
        ))}
      </form>
    </Modal>
  );
}

const opts = (o) => Object.entries(o).map(([value, label]) => ({ value, label }));

// Foto della sede: fino a 3, su Azure Blob
function SitePhotos({ site, onClose }) {
  const toast = useToast();
  const [ids, setIds] = useState(site.photo_file_ids || []);
  const [busy, setBusy] = useState(false);
  const add = () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      const fd = new FormData(); fd.append('file', file); setBusy(true);
      try { const r = await api.upload(`/sites/${site.id}/photos`, fd); setIds((x) => [...x, r.id]); toast('Foto caricata'); } catch (e) { toast(e, 'err'); }
      setBusy(false);
    };
    input.click();
  };
  const remove = async (fid) => { try { await api.del(`/sites/${site.id}/photos/${fid}`); setIds((x) => x.filter((i) => i !== fid)); toast('Foto rimossa'); } catch (e) { toast(e, 'err'); } };
  return (
    <Modal title={`Foto · ${site.name}`} onClose={onClose}>
      <div className="site-photos">
        {ids.map((fid) => <div key={fid} className="ph"><img src={`/api/files/${fid}`} alt="" /><button className="iconbtn" aria-label="Rimuovi" onClick={() => remove(fid)}><Icon name="x" /></button></div>)}
        {ids.length < 3 && <button type="button" className="ph add" disabled={busy} onClick={add}><Icon name="upload" /><span>{busy ? 'Caricamento' : 'Aggiungi foto'}</span></button>}
      </div>
      <div className="small muted" style={{ marginTop: 10 }}>Massimo 3 foto per sede (JPEG, PNG o WebP). Richiede Azure Blob configurato in Impostazioni.</div>
    </Modal>
  );
}

// ---------- Sedi ----------
export function Sites() {
  const { data, loading, error, reload } = useApi('/sites?all=1');
  const orgs = useApi('/organizations');
  const toast = useToast();
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const [photos, setPhotos] = useState(null);
  const rows = (data || []).filter((s) => !q || `${s.code} ${s.name} ${s.city || ''}`.toLowerCase().includes(q.toLowerCase()));
  const fields = [
    { key: 'code', label: 'Codice', required: true, max: 24 }, { key: 'name', label: 'Nome', required: true }, { key: 'short_name', label: 'Nome breve' },
    { key: 'kind', label: 'Tipo', type: 'select', options: opts(SITE_KIND) }, { key: 'organization_id', label: 'Organizzazione', type: 'select', options: (orgs.data || []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'address', label: 'Indirizzo' }, { key: 'zip', label: 'CAP' }, { key: 'city', label: 'Città' }, { key: 'province', label: 'Provincia', max: 4 },
    { key: 'phone', label: 'Telefono' }, { key: 'email', label: 'Email', type: 'email' }, { key: 'manager_name', label: 'Responsabile' }, { key: 'opening_hours', label: 'Orari' },
    { key: 'lat', label: 'Latitudine', type: 'number', step: 'any' }, { key: 'lng', label: 'Longitudine', type: 'number', step: 'any' }, { key: 'sort_order', label: 'Ordine', type: 'number' },
    { key: 'active', label: 'Attiva', type: 'bool' }, { key: 'notes', label: 'Note', type: 'textarea', wide: true },
  ];
  const save = async (body) => { const b = { ...body, organization_id: body.organization_id ? Number(body.organization_id) : null }; if (modal?.id) await api.put(`/sites/${modal.id}`, b); else await api.post('/sites', b); toast('Sede salvata'); reload(); };
  return (
    <div className="page">
      <PageHead title="Sedi" icon="building" sub="Laboratori, centri, punti prelievo e strutture ospitanti della rete" actions={<button className="btn" onClick={() => setModal({})}><Icon name="plus" />Nuova sede</button>} />
      <div className="filters"><SearchInput value={q} onChange={setQ} placeholder="Codice, nome o città" /></div>
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton lines={4} /></div>}
        {error && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && !rows.length && <Empty icon="building" title="Nessuna sede" />}
        {rows.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>Codice</th><th>Nome</th><th>Tipo</th><th>Città</th><th>Organizzazione</th><th>Utenti</th><th>Foto</th><th></th></tr></thead><tbody>
          {rows.map((s) => <tr key={s.id}>
            <td className="mono">{s.code}</td>
            <td><div className="strong">{s.name}</div><div className="row tight">{!s.active && <Badge tone="grey">Non attiva</Badge>}</div></td>
            <td className="small">{SITE_KIND[s.kind] || s.kind}</td><td className="small">{s.city}{s.province ? ` (${s.province})` : ''}</td><td className="small">{s.organization_name}</td><td className="num">{s.users_count}</td>
            <td className="small muted">{(s.photo_file_ids || []).length ? `${s.photo_file_ids.length} / 3` : ''}</td>
            <td className="actions"><button className="iconbtn" aria-label="Modifica" onClick={() => setModal(s)}><Icon name="edit" /></button><button className="iconbtn" aria-label="Foto" title="Foto della sede" onClick={() => setPhotos(s)}><Icon name="image" /></button></td>
          </tr>)}
        </tbody></table></div>}
      </Card>
      {modal && <EditModal title={modal.id ? `Modifica ${modal.name}` : 'Nuova sede'} fields={fields} item={modal.id ? modal : null} onSave={save} onClose={() => setModal(null)} />}
      {photos && <SitePhotos site={photos} onClose={() => { setPhotos(null); reload(); }} />}
    </div>
  );
}

// ---------- Organizzazioni ----------
export function Organizations() {
  const { data, loading, error, reload } = useApi('/organizations');
  const toast = useToast();
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const rows = (data || []).filter((o) => !q || `${o.code || ''} ${o.name} ${o.city || ''}`.toLowerCase().includes(q.toLowerCase()));
  const fields = [
    { key: 'name', label: 'Nome', required: true }, { key: 'kind', label: 'Tipo', type: 'select', options: opts(ORG_KIND) }, { key: 'code', label: 'Codice', max: 24 },
    { key: 'vat_number', label: 'Partita IVA', max: 20 }, { key: 'studiolab_code', label: 'Codice StudioLAB', max: 40, help: 'Clienti service: un codice, un\'organizzazione, una sede gemella SERVICE' }, { key: 'tax_code', label: 'Codice fiscale', max: 20 }, { key: 'sdi', label: 'Codice SDI', max: 10 }, { key: 'pec', label: 'PEC' },
    { key: 'email', label: 'Email' }, { key: 'phone', label: 'Telefono' }, { key: 'address', label: 'Indirizzo' }, { key: 'zip', label: 'CAP' }, { key: 'city', label: 'Città' }, { key: 'province', label: 'Provincia', max: 4 }, { key: 'website', label: 'Sito web' },
    { key: 'active', label: 'Attiva', type: 'bool' }, { key: 'notes', label: 'Note', type: 'textarea', wide: true },
  ];
  const save = async (body) => { if (modal?.id) await api.put(`/organizations/${modal.id}`, body); else await api.post('/organizations', body); toast('Organizzazione salvata'); reload(); };
  return (
    <div className="page">
      <PageHead title="Organizzazioni" icon="folder" sub="Società del gruppo, clienti Service, partner, fornitori e target M&A" actions={<button className="btn" onClick={() => setModal({})}><Icon name="plus" />Nuova organizzazione</button>} />
      <div className="filters"><SearchInput value={q} onChange={setQ} placeholder="Nome, codice o città" /></div>
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton lines={4} /></div>}
        {error && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && !rows.length && <Empty icon="folder" title="Nessuna organizzazione" />}
        {rows.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>Nome</th><th>Tipo</th><th>P. IVA</th><th>Città</th><th>Sedi</th><th>Utenti</th><th></th></tr></thead><tbody>
          {rows.map((o) => <tr key={o.id}>
            <td><div className="strong">{o.name}</div><div className="row tight">{o.code && <span className="mono small muted">{o.code}</span>}{o.active === false && <Badge tone="grey">Non attiva</Badge>}</div></td>
            <td><Badge tone={o.kind === 'CLIENTE' ? 'blue' : o.kind === 'TARGET' ? 'mauve' : 'grey'}>{ORG_KIND[o.kind] || o.kind}</Badge></td><td className="mono small">{o.vat_number}</td><td className="small">{o.city}</td><td className="num">{o.sites_count}</td><td className="num">{o.users_count}</td>
            <td className="actions"><button className="iconbtn" aria-label="Modifica" onClick={() => setModal(o)}><Icon name="edit" /></button></td>
          </tr>)}
        </tbody></table></div>}
      </Card>
      {modal && <EditModal title={modal.id ? `Modifica ${modal.name}` : 'Nuova organizzazione'} fields={fields} item={modal.id ? modal : null} onSave={save} onClose={() => setModal(null)} />}
    </div>
  );
}

// ---------- Persone ----------
export function PeopleAdmin() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ATTIVO');
  const { data, loading, error, reload } = useApi(`/people${qs({ qtext: q, status, all: status ? '' : '1' })}`, [q, status]);
  const sites = useApi('/sites?all=1');
  const orgs = useApi('/organizations');
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const people = useMemo(() => (data || []).map((p) => ({ value: p.id, label: `${p.last_name} ${p.first_name}` })), [data]);
  const fields = [
    { key: 'last_name', label: 'Cognome', required: true }, { key: 'first_name', label: 'Nome', required: true }, { key: 'title', label: 'Titolo', max: 20 },
    { key: 'kind', label: 'Tipo', type: 'select', options: opts(PERSON_KIND) }, { key: 'status', label: 'Stato', type: 'select', options: opts({ CANDIDATO: 'Candidato', IMPEGNO: 'Impegno', ATTIVO: 'Attivo', CESSATO: 'Cessato' }) },
    { key: 'email', label: 'Email', type: 'email' }, { key: 'phone', label: 'Cellulare' }, { key: 'phone_office', label: 'Telefono ufficio' }, { key: 'area', label: 'Area' }, { key: 'job_title', label: 'Ruolo' }, { key: 'discipline', label: 'Disciplina' },
    { key: 'manager_person_id', label: 'Responsabile', type: 'select', options: people }, { key: 'site_id', label: 'Sede', type: 'select', options: (sites.data || []).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` })) },
    { key: 'organization_id', label: 'Organizzazione', type: 'select', options: (orgs.data || []).map((o) => ({ value: o.id, label: o.name })) }, { key: 'tax_code', label: 'Codice fiscale', max: 16 },
   
  ];
  const save = async (body) => {
    const b = { ...body, manager_person_id: body.manager_person_id ? Number(body.manager_person_id) : null, site_id: body.site_id ? Number(body.site_id) : null, organization_id: body.organization_id ? Number(body.organization_id) : null };
    if (modal?.id) await api.put(`/people/${modal.id}`, b); else await api.post('/people', b); toast('Persona salvata'); reload();
  };
  return (
    <div className="page">
      <PageHead title="Persone" icon="user" sub="Anagrafica della rubrica: chi è, dove lavora, cosa fa. I dati contrattuali restano in Contracts." actions={<button className="btn" onClick={() => setModal({})}><Icon name="plus" />Nuova persona</button>} />
      <div className="filters">
        <SearchInput value={q} onChange={setQ} placeholder="Cognome, nome, email, ruolo" />
        <Field label="Stato"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tutti</option><option value="ATTIVO">Attivi</option><option value="IMPEGNO">Impegno</option><option value="CANDIDATO">Candidati</option><option value="CESSATO">Cessati</option></select></Field>
      </div>
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton lines={4} /></div>}
        {error && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && !data.length && <Empty icon="user" title="Nessuna persona">Le persone arrivano dalle importazioni (Contracts) o si inseriscono a mano.</Empty>}
        {data?.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>Persona</th><th>Tipo</th><th>Area / ruolo</th><th>Sede</th><th>Responsabile</th><th>Contatti</th><th>Account</th><th></th></tr></thead><tbody>
          {data.map((p) => <tr key={p.id}>
            <td><Link to={`/people/${p.id}`} className="strong">{p.last_name} {p.first_name}</Link></td>
            <td className="small">{PERSON_KIND[p.kind] || p.kind}</td><td className="small">{p.area}{p.job_title && <div className="muted">{p.job_title}</div>}</td><td className="small">{p.site_name}</td><td className="small">{p.manager_name}</td>
            <td className="small">{p.email}<div className="muted">{p.phone_office || p.phone}</div></td>
            <td>{p.user_id ? <Link to={`/admin/users/${p.user_id}`} className="small">Utente</Link> : <span className="faint small">nessuno</span>}</td>
            <td className="actions"><button className="iconbtn" aria-label="Modifica" onClick={() => setModal(p)}><Icon name="edit" /></button></td>
          </tr>)}
        </tbody></table></div>}
      </Card>
      {modal && <EditModal title={modal.id ? `Modifica ${modal.last_name} ${modal.first_name}` : 'Nuova persona'} fields={fields} item={modal.id ? modal : null} onSave={save} onClose={() => setModal(null)} />}
    </div>
  );
}

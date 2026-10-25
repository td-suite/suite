import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { useApi, Card, Badge, Skeleton, Empty, ErrorBox, PageHead, Field, SearchInput, useToast, Modal, Switch, Tabs, ConfirmModal } from '../../components/ui.jsx';
import { Icon } from '../../components/Icons.jsx';
import { SITE_KIND, ORG_KIND, PERSON_KIND, LEVEL } from '../../format.js';

// Chip dei riferimenti alle sorgenti legacy: { cash: 12, nc: "SITE-3", ... } oppure [{source, id}]
export function LegacyRefs({ refs }) {
  if (!refs) return null;
  const list = Array.isArray(refs) ? refs.map((r) => [r.source || r.key, r.id ?? r.ref]) : Object.entries(refs);
  if (!list.length) return null;
  return <div className="row tight" style={{ gap: 4 }}>{list.map(([k, v], i) => <span key={i} className="chip" title={`Riferimento in ${k}`}><Icon name="external" />{k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>)}</div>;
}

// Modale generica di modifica (campi: {key,label,type,options,help})
// Orari di apertura per giorno: fino a due fasce (mattina, pomeriggio); "copia agli altri giorni" dal lunedì
const DAYS = [['mon', 'Lunedì'], ['tue', 'Martedì'], ['wed', 'Mercoledì'], ['thu', 'Giovedì'], ['fri', 'Venerdì'], ['sat', 'Sabato'], ['sun', 'Domenica']];
function HoursEditor({ value, onChange }) {
  const v = value || {};
  const ranges = (d) => { const r = v[d] || []; return [r[0] || null, r[1] || null]; };
  const setRange = (d, i, field, val) => {
    const cur = ranges(d); const r = { ...(cur[i] || { from: '', to: '' }), [field]: val }; cur[i] = r;
    const clean = cur.filter((x) => x && (x.from || x.to));
    onChange({ ...v, [d]: clean });
  };
  const clearDay = (d) => { const n = { ...v }; delete n[d]; onChange(n); };
  const copyToAll = (d) => { const src = v[d] || []; const n = { ...v }; for (const [k] of DAYS) if (k !== d && k !== 'sun') n[k] = src.map((x) => ({ ...x })); onChange(n); };
  return (
    <div className="hours-editor">
      <div className="hd"><span>Giorno</span><span>Mattina</span><span>Pomeriggio</span><span /></div>
      {DAYS.map(([d, label]) => { const [a, b] = ranges(d); const closed = !a && !b; return (
        <div key={d} className={`row-day ${closed ? 'closed' : ''}`}>
          <span className="dl">{label}</span>
          <span className="rg"><input type="time" value={a?.from || ''} onChange={(e) => setRange(d, 0, 'from', e.target.value)} /><i>–</i><input type="time" value={a?.to || ''} onChange={(e) => setRange(d, 0, 'to', e.target.value)} /></span>
          <span className="rg"><input type="time" value={b?.from || ''} onChange={(e) => setRange(d, 1, 'from', e.target.value)} /><i>–</i><input type="time" value={b?.to || ''} onChange={(e) => setRange(d, 1, 'to', e.target.value)} /></span>
          <span className="ac">{closed ? <span className="tiny faint">Chiuso</span> : <><button type="button" className="link tiny" onClick={() => copyToAll(d)}>Copia agli altri giorni</button><button type="button" className="link tiny" onClick={() => clearDay(d)}>Chiuso</button></>}</span>
        </div>
      ); })}
      <div className="tiny muted" style={{ marginTop: 6 }}>La domenica non riceve la copia automatica. Il testo riassuntivo per Rubrica e meteo viene composto da solo.</div>
    </div>
  );
}

function EditModal({ title, fields, item, onSave, onClose }) {
  const toast = useToast();
  const [f, setF] = useState(() => Object.fromEntries(fields.map((x) => [x.key, item?.[x.key] ?? (x.type === 'bool' ? (x.default ?? true) : x.type === 'hours' ? null : '')])));
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    const body = {};
    for (const x of fields) { const v = f[x.key]; body[x.key] = x.type === 'bool' ? Boolean(v) : x.type === 'number' ? (v === '' ? null : Number(v)) : x.type === 'hours' ? (v && Object.values(v).some((r) => r?.length) ? Object.fromEntries(Object.entries(v).filter(([, r]) => r?.length).map(([d, r]) => [d, r.filter((x) => x.from && x.to)])) : null) : v === '' ? null : v; }
    try { await onSave(body); onClose(); } catch (e2) { toast(e2, 'err'); }
    setBusy(false);
  };
  return (
    <Modal title={title} onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" form="eform" disabled={busy}>Salva</button></>}>
      <form id="eform" onSubmit={save} className="form-grid">
        {fields.map((x) => (
          <Field key={x.key} label={x.label} help={x.help} required={x.required} className={x.full ? 'span-all' : x.wide ? 'span2' : ''}>
            {x.type === 'hours' ? <HoursEditor value={f[x.key]} onChange={(val) => setF({ ...f, [x.key]: val })} />
              : x.type === 'select' ? <select value={f[x.key] ?? ''} onChange={(e) => setF({ ...f, [x.key]: e.target.value, ...(x.resets ? Object.fromEntries(x.resets.map((k) => [k, ''])) : {}) })}>{!x.required && <option value="">Nessuno</option>}{(x.optionsFor ? x.optionsFor(f) : x.options).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
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

// Cestino di riga: conferma, poi DELETE; il server rifiuta se ci sono dati collegati (si disattiva invece di eliminare)
function DeleteButton({ label, text, onDelete }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="iconbtn danger" aria-label={`Elimina ${label}`} title="Elimina" onClick={() => setOpen(true)}><Icon name="trash" /></button>
      {open && <ConfirmModal title={`Eliminare ${label}?`} text={text} danger confirmText="Elimina" onConfirm={onDelete} onClose={() => setOpen(false)} />}
    </>
  );
}

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
  // Due elenchi distinti: le sedi della rete Toscana Diagnostica e le strutture dei clienti service (sedi gemelle SRV-<codice StudioLAB>, create dalle organizzazioni)
  const [tab, setTab] = useState('td');
  const isService = (s) => s.kind === 'SERVICE';
  const all = data || [];
  const rows = all.filter((s) => (tab === 'service' ? isService(s) : !isService(s))).filter((s) => !q || `${s.code} ${s.name} ${s.city || ''} ${s.organization_name || ''}`.toLowerCase().includes(q.toLowerCase()));
  const fields = [
    { key: 'code', label: 'Codice', required: true, max: 40 }, { key: 'name', label: 'Nome', required: true }, { key: 'short_name', label: 'Nome breve' },
    { key: 'kind', label: 'Tipo', type: 'select', options: opts(SITE_KIND) }, { key: 'organization_id', label: 'Legal entity', type: 'select', options: (orgs.data || []).map((o) => ({ value: o.id, label: o.name })) },
    { key: 'address', label: 'Indirizzo' }, { key: 'zip', label: 'CAP' }, { key: 'city', label: 'Città' }, { key: 'province', label: 'Provincia', max: 4 },
    { key: 'phone', label: 'Telefono' }, { key: 'email', label: 'Email', type: 'email' }, { key: 'manager_name', label: 'Responsabile' }, { key: 'opening_hours_json', label: 'Orari di apertura', type: 'hours', full: true },
    { key: 'lat', label: 'Latitudine', type: 'number', step: 'any' }, { key: 'lng', label: 'Longitudine', type: 'number', step: 'any' }, { key: 'sort_order', label: 'Ordine', type: 'number' },
    { key: 'active', label: 'Attiva', type: 'bool' }, { key: 'notes', label: 'Note', type: 'textarea', wide: true },
  ];
  const save = async (body) => { const b = { ...body, organization_id: body.organization_id ? Number(body.organization_id) : null }; if (modal?.id) await api.put(`/sites/${modal.id}`, b); else await api.post('/sites', b); toast('Sede salvata'); reload(); };
  return (
    <div className="page">
      <PageHead title="Sedi" icon="building" sub="Laboratori, centri, punti prelievo e strutture ospitanti della rete" actions={<button className="btn" onClick={() => setModal({})}><Icon name="plus" />Nuova sede</button>} />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'td', label: 'Sedi Toscana Diagnostica', count: all.filter((s) => !isService(s)).length }, { value: 'service', label: 'Strutture clienti service', count: all.filter(isService).length }]} />
      {tab === 'service' && <div className="alert info small" style={{ marginBottom: 12 }}><Icon name="info" /><span>Punti dei clienti del service di laboratorio (tipo SERVICE): una riga per codice cliente StudioLAB, agganciata alla legal entity del cliente. Sono il punto inviante su cui lavorano Non conformità, Ordini e gli accessi dei clienti. Si caricano dal file Sedi o dal connettore StudioLAB.</span></div>}
      <div className="filters"><SearchInput value={q} onChange={setQ} placeholder={tab === 'service' ? 'Codice StudioLAB, cliente o città' : 'Codice, nome o città'} /></div>
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton lines={4} /></div>}
        {error && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && !rows.length && <Empty icon="building" title={tab === 'service' ? 'Nessun punto cliente: si caricano dal file Sedi con tipo SERVICE e il codice della legal entity del cliente' : 'Nessuna sede'} />}
        {rows.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>Codice</th><th>Nome</th><th>Tipo</th><th>Città</th><th>Legal entity</th><th>Utenti</th><th>Foto</th><th></th></tr></thead><tbody>
          {rows.map((s) => <tr key={s.id}>
            <td className="mono">{s.code}</td>
            <td><div className="strong">{s.name}</div><div className="row tight">{!s.active && <Badge tone="grey">Non attiva</Badge>}</div></td>
            <td className="small">{SITE_KIND[s.kind] || s.kind}</td><td className="small">{s.city}{s.province ? ` (${s.province})` : ''}</td><td className="small">{s.organization_name}</td><td className="num">{s.users_count}</td>
            <td className="small muted">{(s.photo_file_ids || []).length ? `${s.photo_file_ids.length} / 3` : ''}</td>
            <td className="actions"><button className="iconbtn" aria-label="Modifica" onClick={() => setModal(s)}><Icon name="edit" /></button><button className="iconbtn" aria-label="Foto" title="Foto della sede" onClick={() => setPhotos(s)}><Icon name="image" /></button><DeleteButton label={`la sede ${s.code}`} text="Persone e utenti collegati restano, senza sede. Se la sede ha dati nei moduli l'eliminazione viene rifiutata: in quel caso disattivala." onDelete={async () => { await api.del(`/sites/${s.id}`); toast('Sede eliminata'); reload(); }} /></td>
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
    { key: 'name', label: 'Nome', required: true }, { key: 'kind', label: 'Tipo', type: 'select', options: opts(ORG_KIND) }, { key: 'code', label: 'Codice', max: 40 },
    { key: 'vat_number', label: 'Partita IVA', max: 20 }, { key: 'tax_code', label: 'Codice fiscale', max: 20 }, { key: 'sdi', label: 'Codice SDI', max: 10 }, { key: 'pec', label: 'PEC' },
    { key: 'email', label: 'Email' }, { key: 'phone', label: 'Telefono' }, { key: 'address', label: 'Indirizzo' }, { key: 'zip', label: 'CAP' }, { key: 'city', label: 'Città' }, { key: 'province', label: 'Provincia', max: 4 }, { key: 'website', label: 'Sito web' },
    { key: 'active', label: 'Attiva', type: 'bool' }, { key: 'notes', label: 'Note', type: 'textarea', wide: true },
  ];
  const save = async (body) => { if (modal?.id) await api.put(`/organizations/${modal.id}`, body); else await api.post('/organizations', body); toast('Legal entity salvata'); reload(); };
  return (
    <div className="page">
      <PageHead title="Legal entity" icon="folder" sub="Soggetti giuridici, una riga per partita IVA: società del gruppo, clienti service, partner, fornitori e target M&A" actions={<button className="btn" onClick={() => setModal({})}><Icon name="plus" />Nuova legal entity</button>} />
      <div className="filters"><SearchInput value={q} onChange={setQ} placeholder="Nome, codice o città" /></div>
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton lines={4} /></div>}
        {error && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && !rows.length && <Empty icon="folder" title="Nessuna organizzazione" />}
        {rows.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>Nome</th><th>Tipo</th><th>P. IVA</th><th>Città</th><th>Sedi</th><th>Utenti</th><th></th></tr></thead><tbody>
          {rows.map((o) => <tr key={o.id}>
            <td><div className="strong">{o.name}</div><div className="row tight">{o.code && <span className="mono small muted">{o.code}</span>}{o.active === false && <Badge tone="grey">Non attiva</Badge>}</div></td>
            <td><Badge tone={o.kind === 'CLIENTE' ? 'blue' : o.kind === 'TARGET' ? 'mauve' : 'grey'}>{ORG_KIND[o.kind] || o.kind}</Badge></td><td className="mono small">{o.vat_number}</td><td className="small">{o.city}</td><td className="num">{o.sites_count}</td><td className="num">{o.users_count}</td>
            <td className="actions"><button className="iconbtn" aria-label="Modifica" onClick={() => setModal(o)}><Icon name="edit" /></button><DeleteButton label={`la legal entity ${o.name}`} text="Possibile solo senza sedi collegate e senza dati nei moduli; altrimenti disattivala." onDelete={async () => { await api.del(`/organizations/${o.id}`); toast('Legal entity eliminata'); reload(); }} /></td>
          </tr>)}
        </tbody></table></div>}
      </Card>
      {modal && <EditModal title={modal.id ? `Modifica ${modal.name}` : 'Nuova legal entity'} fields={fields} item={modal.id ? modal : null} onSave={save} onClose={() => setModal(null)} />}
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
  const roles = useApi('/job-roles');
  const units = useApi('/org-units');
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const people = useMemo(() => (data || []).map((p) => ({ value: p.id, label: `${p.last_name} ${p.first_name}` })), [data]);
  const fields = [
    { key: 'last_name', label: 'Cognome', required: true }, { key: 'first_name', label: 'Nome', required: true }, { key: 'title', label: 'Titolo', max: 20 },
    { key: 'kind', label: 'Tipo', type: 'select', options: opts(PERSON_KIND) }, { key: 'status', label: 'Stato', type: 'select', options: opts({ CANDIDATO: 'Candidato', IMPEGNO: 'Impegno', ATTIVO: 'Attivo', CESSATO: 'Cessato' }) },
    { key: 'email', label: 'Email', type: 'email' }, { key: 'phone', label: 'Cellulare' }, { key: 'phone_office', label: 'Telefono ufficio' }, { key: 'site_id', label: 'Sede', type: 'select', options: (sites.data || []).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` })), resets: ['unit_id'] }, { key: 'unit_id', label: 'Reparto', type: 'select', options: [], optionsFor: (f) => (units.data || []).filter((u) => String(u.site_id) === String(f.site_id)).map((u) => ({ value: u.id, label: u.name })), help: 'Dipende dalla sede scelta' }, { key: 'role_id', label: 'Ruolo', type: 'select', options: (roles.data || []).map((r) => ({ value: r.id, label: r.name })), help: 'Dal catalogo in Organizzazione' }, { key: 'discipline', label: 'Disciplina' }, { key: 'manager_person_id', label: 'Responsabile', type: 'select', options: people },  
      
    { key: 'organization_id', label: 'Legal entity', type: 'select', options: (orgs.data || []).map((o) => ({ value: o.id, label: o.name })) }, { key: 'tax_code', label: 'Codice fiscale', max: 16 },
   
  ];
  const save = async (body) => {
    const b = { ...body, manager_person_id: body.manager_person_id ? Number(body.manager_person_id) : null, site_id: body.site_id ? Number(body.site_id) : null, organization_id: body.organization_id ? Number(body.organization_id) : null, role_id: body.role_id ? Number(body.role_id) : null, unit_id: body.unit_id ? Number(body.unit_id) : null };
    delete b.job_title; delete b.area;
    if (modal?.id) await api.put(`/people/${modal.id}`, b); else await api.post('/people', b); toast('Persona salvata'); reload();
  };
  return (
    <div className="page">
      <PageHead title="Persone" icon="user" sub="Anagrafica unica: chi è, dove lavora, cosa fa. Il dossier HR è in Contratti del personale." actions={<><button className="btn ghost" onClick={async () => { try { const r = await api.post('/people/dedupe'); toast(r.removed ? `${r.removed} copie eliminate${r.blocked?.length ? `, ${r.blocked.length} con dati collegati lasciate` : ''}` : 'Nessun duplicato'); reload(); } catch (e) { toast(e, 'err'); } }}><Icon name="refresh" />Elimina duplicati</button><button className="btn" onClick={() => setModal({})}><Icon name="plus" />Nuova persona</button></>} />
      <div className="filters">
        <SearchInput value={q} onChange={setQ} placeholder="Cognome, nome, email, ruolo" />
        <Field label="Stato"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Tutti</option><option value="ATTIVO">Attivi</option><option value="IMPEGNO">Impegno</option><option value="CANDIDATO">Candidati</option><option value="CESSATO">Cessati</option></select></Field>
      </div>
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton lines={4} /></div>}
        {error && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && !data.length && <Empty icon="user" title="Nessuna persona">Le persone arrivano dalle importazioni (Contracts) o si inseriscono a mano.</Empty>}
        {data?.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>Persona</th><th>Tipo</th><th>Sede / reparto</th><th>Ruolo</th><th>Responsabile</th><th>Contatti</th><th>Accesso</th><th></th></tr></thead><tbody>
          {data.map((p) => <tr key={p.id}>
            <td><Link to={`/people/${p.id}`} className="strong">{p.last_name} {p.first_name}</Link></td>
            <td className="small">{PERSON_KIND[p.kind] || p.kind}</td><td className="small">{p.unit_name && <div className="strong">{p.unit_name}</div>}{p.site_name}</td><td className="small">{p.job_title}</td><td className="small">{p.manager_name}</td>
            <td className="small">{p.email}<div className="muted">{p.phone_office || p.phone}</div></td>
            <td>{p.user_id ? <Link to={`/admin/users/${p.user_id}`}><Badge tone={p.user_level === 'OWNER' ? 'teal' : p.user_level === 'ADMIN' ? 'blue' : 'grey'}>{LEVEL[p.user_level] || 'Accesso'}</Badge></Link> : <span className="faint small">nessun accesso</span>}</td>
            <td className="actions"><button className="iconbtn" aria-label="Modifica" onClick={() => setModal(p)}><Icon name="edit" /></button><DeleteButton label={`${p.last_name} ${p.first_name}`} text="Elimina la persona dall'anagrafica e il suo eventuale accesso. Se ha dati nei moduli (turni, contratti, rendiconti) l'eliminazione viene rifiutata: mettila in stato CESSATO." onDelete={async () => { await api.del(`/people/${p.id}`); toast('Persona eliminata'); reload(); }} /></td>
          </tr>)}
        </tbody></table></div>}
      </Card>
      {modal && <EditModal title={modal.id ? `Modifica ${modal.last_name} ${modal.first_name}` : 'Nuova persona'} fields={fields} item={modal.id ? modal : null} onSave={save} onClose={() => setModal(null)} />}
    </div>
  );
}

// ---------- Ruoli (catalogo) ----------
export function Organization() {
  const [tab, setTab] = useState('units');
  return (
    <div className="page">
      <PageHead title="Organizzazione" icon="grid" sub="Reparti per sede e ruoli: con il responsabile compongono l'organigramma. Il reparto dipende dalla sede; il ruolo si sceglie dal catalogo." />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'units', label: 'Reparti per sede' }, { value: 'roles', label: 'Ruoli' }]} />
      {tab === 'roles' ? <Roles embedded /> : <Units />}
    </div>
  );
}

function Units() {
  const { data, loading, error, reload } = useApi('/org-units?all=1');
  const sites = useApi('/sites?all=1');
  const people = useApi('/people?all=1');
  const toast = useToast();
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const rows = (data || []).filter((u) => !q || `${u.name} ${u.site_name}`.toLowerCase().includes(q.toLowerCase()));
  const fields = [
    { key: 'site_id', label: 'Sede', type: 'select', required: true, options: (sites.data || []).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` })) },
    { key: 'name', label: 'Reparto', required: true, max: 160 },
    { key: 'head_person_id', label: 'Responsabile del reparto', type: 'select', options: (people.data || []).map((p) => ({ value: p.id, label: `${p.last_name} ${p.first_name}` })) },
    { key: 'phone_ext', label: 'Interno centralino', max: 10 }, { key: 'sort_order', label: 'Ordine', type: 'number' }, { key: 'active', label: 'Attivo', type: 'bool' }, { key: 'description', label: 'Descrizione', type: 'textarea', wide: true },
  ];
  const save = async (body) => { const b = { ...body, site_id: Number(body.site_id), head_person_id: body.head_person_id ? Number(body.head_person_id) : null }; if (modal?.id) await api.put(`/org-units/${modal.id}`, b); else await api.post('/org-units', b); toast('Reparto salvato'); reload(); };
  return (
    <>
      <div className="filters"><SearchInput value={q} onChange={setQ} placeholder="Reparto o sede" /><div className="spacer" /><button className="btn" onClick={() => setModal({})}><Icon name="plus" />Nuovo reparto</button></div>
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton lines={4} /></div>}
        {error && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && !rows.length && <Empty icon="grid" title="Nessun reparto" />}
        {rows.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>Sede</th><th>Reparto</th><th>Responsabile</th><th>Interno</th><th>Persone</th><th></th></tr></thead><tbody>
          {rows.map((u) => <tr key={u.id}>
            <td className="small">{u.site_name}</td>
            <td><div className="strong">{u.name}</div>{!u.active && <Badge tone="grey">Non attivo</Badge>}</td>
            <td className="small">{u.head_name}</td><td className="mono small">{u.phone_ext}</td>
            <td className="num">{u.people_count}</td>
            <td className="actions"><button className="iconbtn" aria-label="Modifica" onClick={() => setModal(u)}><Icon name="edit" /></button><DeleteButton label={`il reparto ${u.name}`} text="Possibile solo se nessuna persona vi appartiene; altrimenti disattivalo." onDelete={async () => { await api.del(`/org-units/${u.id}`); toast('Reparto eliminato'); reload(); }} /></td>
          </tr>)}
        </tbody></table></div>}
      </Card>
      {modal && <EditModal title={modal.id ? `Modifica ${modal.name}` : 'Nuovo reparto'} fields={fields} item={modal.id ? modal : null} onSave={save} onClose={() => setModal(null)} />}
    </>
  );
}

export function Roles({ embedded }) {
  const { data, loading, error, reload } = useApi('/job-roles?all=1');
  const toast = useToast();
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);
  const rows = (data || []).filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()));
  const fields = [{ key: 'name', label: 'Ruolo', required: true, max: 200 }, { key: 'description', label: 'Descrizione', type: 'textarea', wide: true }, { key: 'sort_order', label: 'Ordine', type: 'number' }, { key: 'active', label: 'Attivo', type: 'bool' }];
  const save = async (body) => { if (modal?.id) await api.put(`/job-roles/${modal.id}`, body); else await api.post('/job-roles', body); toast('Ruolo salvato'); reload(); };
  return (
    <div className={embedded ? '' : 'page'}>
      {!embedded && <PageHead title="Ruoli" icon="grid" sub="Catalogo dei ruoli" />}
      <div className="filters"><SearchInput value={q} onChange={setQ} placeholder="Cerca un ruolo" /><div className="spacer" /><button className="btn" onClick={() => setModal({})}><Icon name="plus" />Nuovo ruolo</button></div>
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton lines={4} /></div>}
        {error && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && !rows.length && <Empty icon="grid" title="Nessun ruolo" />}
        {rows.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>Ruolo</th><th>Descrizione</th><th>Persone</th><th></th></tr></thead><tbody>
          {rows.map((r) => <tr key={r.id}>
            <td><div className="strong">{r.name}</div>{!r.active && <Badge tone="grey">Non attivo</Badge>}</td>
            <td className="small muted">{r.description}</td>
            <td className="num">{r.people_count ? <Link to={`/people?role_id=${r.id}`}>{r.people_count}</Link> : 0}</td>
            <td className="actions"><button className="iconbtn" aria-label="Modifica" onClick={() => setModal(r)}><Icon name="edit" /></button><DeleteButton label={`il ruolo ${r.name}`} text="Possibile solo se nessuna persona lo ricopre; altrimenti disattivalo." onDelete={async () => { await api.del(`/job-roles/${r.id}`); toast('Ruolo eliminato'); reload(); }} /></td>
          </tr>)}
        </tbody></table></div>}
      </Card>
      {modal && <EditModal title={modal.id ? `Modifica ${modal.name}` : 'Nuovo ruolo'} fields={fields} item={modal.id ? modal : null} onSave={save} onClose={() => setModal(null)} />}
    </div>
  );
}

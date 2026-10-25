import React, { useEffect, useMemo, useState } from 'react';
import { Routes, Route, Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { qs } from '../api.js';
import { useAuth, isAdmin, hasModule } from '../auth.jsx';
import { useApi, Card, Badge, Skeleton, Empty, ErrorBox, PageHead, Field, SearchInput, Avatar, Modal, useToast } from '../components/ui.jsx';
import { Icon } from '../components/Icons.jsx';
import { PERSON_KIND, fmtDate } from '../format.js';
import { api } from '../api.js';
import { NotFound } from './Misc.jsx';

const fullName = (p) => [p.title, p.first_name, p.last_name].filter(Boolean).join(' ');
const teamsUrl = (email) => `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(email)}`;

function PersonCard({ p }) {
  return (
    <Link to={`/people/${p.id}`} className="card person">
      <Avatar name={`${p.first_name} ${p.last_name}`} fileId={p.avatar_file_id || p.photo_file_id} size="lg" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="n">{fullName(p)}</div>
        <div className="r">{[p.job_title, p.discipline].filter(Boolean).join(' · ') || PERSON_KIND[p.kind] || ''}</div>
        <div className="s">{p.area && <Badge tone="mauve">{p.area}</Badge>}{p.site_name && <span><Icon name="pin" style={{ width: 12, height: 12, marginRight: 3 }} />{p.site_name}</span>}</div>
        <div className="c">
          {p.email && <a href={`mailto:${p.email}`} onClick={(e) => e.stopPropagation()}><Icon name="mail" />Email</a>}
          {(p.phone_office || p.phone) && <a href={`tel:${p.phone_office || p.phone}`} onClick={(e) => e.stopPropagation()}><Icon name="phone" />{p.phone_office || p.phone}</a>}
          {p.email && <a href={teamsUrl(p.email)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}><Icon name="teams" />Teams</a>}
        </div>
      </div>
    </Link>
  );
}

function List() {
  const [sp, setSp] = useSearchParams();
  const qtext = sp.get('qtext') || '';
  const [q, setQ] = useState(qtext);
  const area = sp.get('area') || '', kind = sp.get('kind') || '', site_id = sp.get('site_id') || '';
  useEffect(() => setQ(qtext), [qtext]);
  useEffect(() => { const t = setTimeout(() => { if (q !== qtext) setSp((s) => { const n = new URLSearchParams(s); if (q) n.set('qtext', q); else n.delete('qtext'); return n; }, { replace: true }); }, 300); return () => clearTimeout(t); }, [q, qtext, setSp]);
  const setF = (k, v) => setSp((s) => { const n = new URLSearchParams(s); if (v) n.set(k, v); else n.delete(k); return n; });
  const { data, loading, error } = useApi(`/people${qs({ qtext, area, kind, site_id })}`, [qtext, area, kind, site_id]);
  const areas = useApi('/people/areas');
  const sites = useApi('/sites');
  return (
    <div className="page">
      <PageHead title="Rubrica" icon="rubrica" sub="Chi fa cosa nella rete Toscana Diagnostica" />
      <div className="filters">
        <SearchInput value={q} onChange={setQ} placeholder="Cerca per nome, ruolo, area o email" autoFocus />
        <Field label="Area"><select value={area} onChange={(e) => setF('area', e.target.value)}><option value="">Tutte</option>{(areas.data || []).map((a) => <option key={a.area} value={a.area}>{a.area} ({a.n})</option>)}</select></Field>
        <Field label="Sede"><select value={site_id} onChange={(e) => setF('site_id', e.target.value)}><option value="">Tutte</option>{(sites.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Tipo"><select value={kind} onChange={(e) => setF('kind', e.target.value)}><option value="">Tutti</option>{Object.entries(PERSON_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      </div>
      {loading && <div className="people">{[1, 2, 3, 4].map((i) => <Card key={i}><Skeleton lines={3} /></Card>)}</div>}
      <ErrorBox error={error} />
      {data && !data.length && <Empty icon="users" title="Nessuna persona trovata">{qtext ? 'Prova con un nome o un ruolo diverso.' : 'La rubrica si popola dalle anagrafiche e dalle importazioni.'}</Empty>}
      {data?.length > 0 && <><div className="small muted mb">{data.length} person{data.length === 1 ? 'a' : 'e'}</div><div className="people">{data.map((p) => <PersonCard key={p.id} p={p} />)}</div></>}
    </div>
  );
}

function EditPersonModal({ p, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ job_title: p.job_title || '', area: p.area || '', phone: p.phone || '', phone_office: p.phone_office || '', email: p.email || '', discipline: p.discipline || '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => { e.preventDefault(); try { await api.put(`/people/${p.id}`, Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v || null]))); toast('Scheda aggiornata'); onSaved(); onClose(); } catch (e2) { toast(e2, 'err'); } };
  return (
    <Modal title="Aggiorna la scheda" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" form="pform">Salva</button></>}>
      <form id="pform" onSubmit={save} className="form-grid">
        <Field label="Ruolo"><input value={f.job_title} onChange={set('job_title')} /></Field>
        <Field label="Area"><input value={f.area} onChange={set('area')} /></Field>
        <Field label="Disciplina"><input value={f.discipline} onChange={set('discipline')} /></Field>
        <Field label="Email"><input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Telefono ufficio"><input value={f.phone_office} onChange={set('phone_office')} /></Field>
        <Field label="Cellulare"><input value={f.phone} onChange={set('phone')} /></Field>
      </form>
    </Modal>
  );
}

function Detail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data: p, loading, error, reload } = useApi(`/people/${id}`, [id]);
  const [edit, setEdit] = useState(false);
  if (loading) return <div className="page"><Skeleton lines={5} /></div>;
  if (error?.status === 404) return <NotFound />;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  const canEdit = isAdmin(user) || hasModule(user, 'rubrica', 'EDITOR');
  return (
    <div className="page narrow">
      <div className="crumb"><Link to="/people">Rubrica</Link><Icon name="chevron" /><span>{fullName(p)}</span></div>
      <Card>
        <div className="person-head">
          <Avatar name={`${p.first_name} ${p.last_name}`} fileId={p.avatar_file_id || p.photo_file_id} size="xl" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1>{fullName(p)}</h1>
            <div className="role">{[p.job_title, p.discipline].filter(Boolean).join(' · ') || PERSON_KIND[p.kind]}</div>
            <div className="row tight mt">{p.area && <Badge tone="mauve">{p.area}</Badge>}{p.kind && <Badge tone="grey">{PERSON_KIND[p.kind]}</Badge>}{p.site_name && <Badge tone="blue">{p.site_name}{p.site_city && !p.site_name.includes(p.site_city) ? ` · ${p.site_city}` : ''}</Badge>}{p.organization_name && <Badge tone="grey">{p.organization_name}</Badge>}</div>
          </div>
          <div className="row tight">
            {p.email && <a className="btn" href={teamsUrl(p.email)} target="_blank" rel="noopener noreferrer"><Icon name="teams" />Scrivi su Teams</a>}
            {p.email && <a className="btn ghost" href={`mailto:${p.email}`}><Icon name="mail" />Email</a>}
            {canEdit && <button className="btn ghost" onClick={() => setEdit(true)}><Icon name="edit" />Aggiorna</button>}
          </div>
        </div>
      </Card>
      <div className="grid g2 mt2">
        <Card title="Contatti" icon="phone">
          <div className="contact-list">
            {p.email && <div className="c"><Icon name="mail" /><div><div className="k">Email</div><a href={`mailto:${p.email}`}>{p.email}</a></div></div>}
            {p.phone_office && <div className="c"><Icon name="phone" /><div><div className="k">Telefono ufficio</div><a href={`tel:${p.phone_office}`}>{p.phone_office}</a></div></div>}
            {p.phone && <div className="c"><Icon name="phone" /><div><div className="k">Cellulare</div><a href={`tel:${p.phone}`}>{p.phone}</a></div></div>}
            {p.site_name && <div className="c"><Icon name="pin" /><div><div className="k">Sede</div><div>{p.site_name}{p.site_city && !p.site_name.includes(p.site_city) ? `, ${p.site_city}` : ''}</div></div></div>}
            {!p.email && !p.phone && !p.phone_office && <div className="muted small">Nessun contatto registrato.</div>}
          </div>
        </Card>
        <Card title="Organizzazione" icon="tree">
          <div className="col">
            <div><div className="tiny muted strong" style={{ textTransform: 'uppercase', letterSpacing: '.07em' }}>Responsabile</div>
              {p.manager_person_id ? <Link to={`/people/${p.manager_person_id}`} className="row tight mt" style={{ color: 'inherit' }}><Avatar name={p.manager_name} size="sm" /><span className="strong">{p.manager_name}</span></Link> : <div className="small muted mt">Nessun responsabile indicato</div>}</div>
            <div><div className="tiny muted strong" style={{ textTransform: 'uppercase', letterSpacing: '.07em' }}>Collaboratori ({p.reports?.length || 0})</div>
              {!p.reports?.length && <div className="small muted mt">Nessun collaboratore diretto</div>}
              <div className="col mt" style={{ gap: 6 }}>{(p.reports || []).map((r) => <Link key={r.id} to={`/people/${r.id}`} className="row tight" style={{ color: 'inherit' }}><Avatar name={`${r.first_name} ${r.last_name}`} size="sm" /><span><span className="strong">{r.first_name} {r.last_name}</span>{r.job_title && <span className="muted small"> · {r.job_title}</span>}</span></Link>)}</div></div>
            <div><Link to={`/people/org-chart?focus=${p.id}`} className="small">Vedi nell'organigramma</Link></div>
          </div>
        </Card>
      </div>
      {isAdmin(user) && (p.hired_at || p.needs_review) && <div className="small muted mt2">{p.hired_at && <>In servizio dal {fmtDate(p.hired_at)}. </>}{p.needs_review && <Badge tone="amber">Da verificare</Badge>}</div>}
      {edit && <EditPersonModal p={p} onClose={() => setEdit(false)} onSaved={reload} />}
    </div>
  );
}

function Node({ p, children }) {
  return (
    <li>
      <Link to={`/people/${p.id}`} className="node"><Avatar name={`${p.first_name} ${p.last_name}`} fileId={p.avatar_file_id} size="sm" /><div style={{ minWidth: 0 }}><div className="n">{p.first_name} {p.last_name}</div><div className="r ellipsis">{p.job_title || p.area || ''}</div></div></Link>
      {children?.length > 0 && <ul>{children.map((c) => <Node key={c.p.id} p={c.p}>{c.children}</Node>)}</ul>}
    </li>
  );
}

function OrgChart() {
  const { data, loading, error } = useApi('/people/org-chart');
  const [zoom, setZoom] = useState(1);
  const tree = useMemo(() => {
    const rows = data || [];
    const ids = new Set(rows.map((r) => r.id));
    const byMgr = {};
    for (const r of rows) { const k = r.manager_person_id && ids.has(r.manager_person_id) ? r.manager_person_id : 'root'; (byMgr[k] ||= []).push(r); }
    const build = (p, depth = 0) => ({ p, children: depth > 8 ? [] : (byMgr[p.id] || []).map((c) => build(c, depth + 1)) });
    return (byMgr.root || []).map((r) => build(r));
  }, [data]);
  return (
    <div className="page">
      <PageHead title="Organigramma" icon="tree" sub="Struttura della rete a partire dai responsabili" actions={<div className="row tight"><button className="btn ghost sm" onClick={() => setZoom((z) => Math.max(.4, z - .1))} aria-label="Riduci"><Icon name="zoomOut" /></button><span className="small muted" style={{ minWidth: 40, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span><button className="btn ghost sm" onClick={() => setZoom((z) => Math.min(1.6, z + .1))} aria-label="Ingrandisci"><Icon name="zoomIn" /></button><button className="btn ghost sm" onClick={() => setZoom(1)}>Reimposta</button></div>} />
      <ErrorBox error={error} />
      {loading && <Card><Skeleton lines={4} /></Card>}
      {data && !data.length && <Empty icon="tree" title="Nessuna persona attiva">L'organigramma si costruisce dai responsabili indicati nelle schede.</Empty>}
      {tree.length > 0 && (
        <Card flush><div className="org"><div className="org-wrap" style={{ transform: `scale(${zoom})` }}><ul className="tree">{tree.map((n) => <Node key={n.p.id} p={n.p}>{n.children}</Node>)}</ul></div></div></Card>
      )}
    </div>
  );
}

function Areas() {
  const { data, loading, error } = useApi('/people/areas');
  const navigate = useNavigate();
  return (
    <div className="page">
      <PageHead title="Aree" icon="grid" sub="Le aree organizzative e quante persone ne fanno parte" />
      <ErrorBox error={error} />
      {loading && <Skeleton lines={3} />}
      {data && !data.length && <Empty icon="grid" title="Nessuna area definita" />}
      <div className="grid g4">{(data || []).map((a) => (
        <button key={a.area} type="button" className="card kpi" style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--line)' }} onClick={() => navigate(`/people?area=${encodeURIComponent(a.area)}`)}>
          <div className="lbl">{a.area}</div><div className="val">{a.n}<small>person{a.n === 1 ? 'a' : 'e'}</small></div>
        </button>
      ))}</div>
    </div>
  );
}

export default function People() {
  return (
    <Routes>
      <Route index element={<List />} />
      <Route path="org-chart" element={<OrgChart />} />
      <Route path="areas" element={<Areas />} />
      <Route path=":id" element={<Detail />} />
    </Routes>
  );
}

import React, { useEffect, useMemo, useState } from 'react';
import { Routes, Route, Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { qs } from '../api.js';
import { useAuth, isAdmin, hasModule } from '../auth.jsx';
import { useApi, Card, Badge, Skeleton, Empty, ErrorBox, PageHead, Field, SearchInput, Avatar, Modal, useToast } from '../components/ui.jsx';
import { Icon } from '../components/Icons.jsx';
import { PERSON_KIND, fmtDate } from '../format.js';
import { api } from '../api.js';
import { NotFound } from './Misc.jsx';
import { PersonPositionsModal } from './admin/Registry.jsx';

const fullName = (p) => [p.last_name, p.first_name].filter(Boolean).join(' ');   // Cognome Nome, ovunque nella Suite
const teamsUrl = (email) => `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(email)}`;

function PersonCard({ p }) {
  return (
    <Link to={`/people/${p.id}`} className="card person">
      <Avatar name={`${p.first_name} ${p.last_name}`} fileId={p.avatar_file_id || p.photo_file_id} size="lg" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="n">{fullName(p)}</div>
        <div className="r">{[p.job_title, p.discipline].filter(Boolean).join(' · ') || PERSON_KIND[p.kind] || ''}</div>
        <div className="s">{p.unit_name && <Badge tone="mauve">{p.unit_name}</Badge>}{p.site_name && <span><Icon name="pin" style={{ width: 12, height: 12, marginRight: 3 }} />{p.site_name}</span>}</div>
        <div className="c">
          {p.email && <a href={`mailto:${p.email}`} onClick={(e) => e.stopPropagation()}><Icon name="mail" />Email</a>}
          {p.phone_ext && <a href={`tel:055776511`} title={`Centralino 055 776511, interno ${p.phone_ext}`} onClick={(e) => e.stopPropagation()}><Icon name="phone" />Int. {p.phone_ext}</a>}
          {(p.phone_office || p.phone) && <a href={`tel:${p.phone_office || p.phone}`} onClick={(e) => e.stopPropagation()}><Icon name="phone" />{p.phone_office || p.phone}</a>}
          {p.email && <a href={teamsUrl(p.email)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}><Icon name="teams" />Teams</a>}
        </div>
      </div>
    </Link>
  );
}

// Numeri interni del centralino (configurazione Rev01 del 06/10/2026), in fondo all'elenco
function Switchboard() {
  const { data } = useApi('/people/switchboard', []);
  if (!data?.number) return null;
  return (
    <Card title={`Numeri interni · centralino ${data.number}`} icon="phone" className="mt2">
      <div className="switchboard">
        {(data.departments || []).map((d) => <div key={d.ext} className="it"><span className="ext">{d.ext}</span><span>{d.name}</span></div>)}
      </div>
      {data.second?.number && <div className="small muted" style={{ marginTop: 10 }}>{data.second.label}: {data.second.number}. Dall'esterno: {data.number}, poi il tasto del reparto; dall'interno: il numero breve.</div>}
    </Card>
  );
}

function List() {
  const [sp, setSp] = useSearchParams();
  const qtext = sp.get('qtext') || '';
  const [q, setQ] = useState(qtext);
  const role_id = sp.get('role_id') || '', kind = sp.get('kind') || '', site_id = sp.get('site_id') || '';
  useEffect(() => setQ(qtext), [qtext]);
  useEffect(() => { const t = setTimeout(() => { if (q !== qtext) setSp((s) => { const n = new URLSearchParams(s); if (q) n.set('qtext', q); else n.delete('qtext'); return n; }, { replace: true }); }, 300); return () => clearTimeout(t); }, [q, qtext, setSp]);
  const setF = (k, v) => setSp((s) => { const n = new URLSearchParams(s); if (v) n.set(k, v); else n.delete(k); return n; });
  const { data, loading, error } = useApi(`/people${qs({ qtext, role_id, kind, site_id })}`, [qtext, role_id, kind, site_id]);
  const roles = useApi('/job-roles');
  const sites = useApi('/sites');
  return (
    <div className="page">
      <PageHead title="Rubrica" icon="rubrica" sub="Chi fa cosa nella rete Toscana Diagnostica" />
      <div className="filters">
        <SearchInput value={q} onChange={setQ} placeholder="Cerca per nome, ruolo o email" autoFocus />
        <Field label="Ruolo"><select value={role_id} onChange={(e) => setF('role_id', e.target.value)}><option value="">Tutti</option>{(roles.data || []).map((r) => <option key={r.id} value={r.id}>{r.name}{r.people_count ? ` (${r.people_count})` : ''}</option>)}</select></Field>
        <Field label="Sede"><select value={site_id} onChange={(e) => setF('site_id', e.target.value)}><option value="">Tutte</option>{(sites.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Tipo"><select value={kind} onChange={(e) => setF('kind', e.target.value)}><option value="">Tutti</option>{Object.entries(PERSON_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      </div>
      {loading && <div className="people">{[1, 2, 3, 4].map((i) => <Card key={i}><Skeleton lines={3} /></Card>)}</div>}
      <ErrorBox error={error} />
      {data && !data.length && <Empty icon="users" title="Nessuna persona trovata">{qtext ? 'Prova con un nome o un ruolo diverso.' : 'La rubrica si popola dalle anagrafiche e dalle importazioni.'}</Empty>}
      {data?.length > 0 && <><div className="small muted mb">{data.length} person{data.length === 1 ? 'a' : 'e'}</div><div className="people">{data.map((p) => <PersonCard key={p.id} p={p} />)}</div></>}
      {!qtext && !role_id && !kind && !site_id && <Switchboard />}
    </div>
  );
}

function EditPersonModal({ p, onClose, onSaved }) {
  const toast = useToast();
  const roles = useApi('/job-roles');
  const units = useApi(p.site_id ? `/org-units?site_id=${p.site_id}` : null, [p.site_id]);
  const [f, setF] = useState({ role_id: p.role_id || '', unit_id: p.unit_id || '', phone: p.phone || '', phone_office: p.phone_office || '', phone_ext: p.phone_ext || '', email: p.email || '', discipline: p.discipline || '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => { e.preventDefault(); try { await api.put(`/people/${p.id}`, Object.fromEntries(Object.entries(f).map(([k, v]) => [k, (k === 'role_id' || k === 'unit_id') ? (v ? Number(v) : null) : (v || null)]))); toast('Scheda aggiornata'); onSaved(); onClose(); } catch (e2) { toast(e2, 'err'); } };
  return (
    <Modal title="Aggiorna la scheda" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" form="pform">Salva</button></>}>
      <form id="pform" onSubmit={save} className="form-grid">
        <Field label="Sede"><input value={p.site_name || ''} disabled title="La sede si cambia in Amministrazione" /></Field>
        <Field label="Reparto" help={p.site_id ? undefined : 'Imposta prima la sede in Amministrazione'}><select value={f.unit_id || ''} onChange={set('unit_id')} disabled={!p.site_id}><option value="">Nessuno</option>{(units.data || []).filter((u) => u.kind === 'REPARTO').map((u) => <option key={u.id} value={u.id}>{u.name}{!u.site_id && u.parent_name ? ` (${u.parent_name})` : ''}</option>)}</select></Field>
        <Field label="Ruolo"><select value={f.role_id || ''} onChange={set('role_id')}><option value="">Nessuno</option>{(roles.data || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <Field label="Disciplina"><input value={f.discipline} onChange={set('discipline')} /></Field>
        <Field label="Email"><input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Telefono ufficio"><input value={f.phone_office} onChange={set('phone_office')} /></Field>
        <Field label="Interno centralino"><input value={f.phone_ext} onChange={set('phone_ext')} maxLength={10} placeholder="101" /></Field>
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
  const [pos, setPos] = useState(false);
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
            <div className="row tight mt">{p.kind && <Badge tone="grey">{PERSON_KIND[p.kind]}</Badge>}{p.site_name && <Badge tone="blue">{p.site_name}{p.site_city && !p.site_name.includes(p.site_city) ? ` · ${p.site_city}` : ''}</Badge>}{p.organization_name && <Badge tone="grey">{p.organization_name}</Badge>}</div>
          </div>
          <div className="row tight">
            {p.email && <a className="btn" href={teamsUrl(p.email)} target="_blank" rel="noopener noreferrer"><Icon name="teams" />Scrivi su Teams</a>}
            {p.email && <a className="btn ghost" href={`mailto:${p.email}`}><Icon name="mail" />Email</a>}
            {canEdit && <button className="btn ghost" onClick={() => setEdit(true)}><Icon name="edit" />Aggiorna</button>}
          </div>
        </div>
      </Card>
      {p.bio && <Card title="Presentazione" icon="user" className="mt2"><div className="bio">{p.bio.split(/\n\s*\n/).map((par, i) => <p key={i}>{par}</p>)}</div></Card>}
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
        <Card title="Organizzazione" icon="tree" actions={isAdmin(user) && <button className="btn ghost sm" onClick={() => setPos(true)}><Icon name="edit" />Incarichi</button>}>
          <div className="col">
            <div><div className="tiny muted strong" style={{ textTransform: 'uppercase', letterSpacing: '.07em' }}>Incarichi nell'organigramma ({p.positions?.length || 0})</div>
              {!p.positions?.length && <div className="small muted mt">Nessun incarico: si assegnano in Amministrazione, Persone o Organizzazione.</div>}
              <div className="col mt" style={{ gap: 6 }}>{(p.positions || []).map((x) => <Link key={x.id} to={`/people/org-chart?focus=${p.id}`} className="small" style={{ color: 'inherit' }}><span className={x.is_head ? 'strong' : ''}>{x.unit_name}</span>{x.parent_name ? <span className="muted"> ({x.parent_name})</span> : ''}{x.role_name ? <span className="muted"> · {x.role_name}</span> : ''}{x.is_head && <> <Badge tone="blue">Responsabile</Badge></>}</Link>)}</div></div>
            <div><div className="tiny muted strong" style={{ textTransform: 'uppercase', letterSpacing: '.07em' }}>Responsabile</div>
              {p.manager_person_id ? <Link to={`/people/${p.manager_person_id}`} className="row tight mt" style={{ color: 'inherit' }}><Avatar name={p.manager_name} size="sm" /><span className="strong">{p.manager_name}</span></Link> : <div className="small muted mt">Nessun responsabile indicato</div>}</div>
            <div><div className="tiny muted strong" style={{ textTransform: 'uppercase', letterSpacing: '.07em' }}>Collaboratori ({p.reports?.length || 0})</div>
              {!p.reports?.length && <div className="small muted mt">Nessun collaboratore diretto</div>}
              <div className="col mt" style={{ gap: 6 }}>{(p.reports || []).map((r) => <Link key={r.id} to={`/people/${r.id}`} className="row tight" style={{ color: 'inherit' }}><Avatar name={`${r.first_name} ${r.last_name}`} size="sm" /><span><span className="strong">{r.last_name} {r.first_name}</span>{r.job_title && <span className="muted small"> · {r.job_title}</span>}</span></Link>)}</div></div>
            <div><Link to={`/people/org-chart?focus=${p.id}`} className="small">Vedi nell'organigramma</Link></div>
          </div>
        </Card>
      </div>
      {isAdmin(user) && (p.hired_at || p.needs_review) && <div className="small muted mt2">{p.hired_at && <>In servizio dal {fmtDate(p.hired_at)}. </>}{p.needs_review && <Badge tone="amber">Da verificare</Badge>}</div>}
      {edit && <EditPersonModal p={p} onClose={() => setEdit(false)} onSaved={reload} />}
      {pos && <PersonPositionsModal person={p} onClose={() => setPos(false)} onChange={reload} />}
    </div>
  );
}

function Node({ p, children }) {
  return (
    <li>
      <Link to={`/people/${p.id}`} className="node"><Avatar name={`${p.first_name} ${p.last_name}`} fileId={p.avatar_file_id} size="sm" /><div style={{ minWidth: 0 }}><div className="n">{p.last_name} {p.first_name}</div><div className="r ellipsis">{p.job_title || ''}</div></div></Link>
      {children?.length > 0 && <ul>{children.map((c) => <Node key={c.p.id} p={c.p}>{c.children}</Node>)}</ul>}
    </li>
  );
}

function OrgChart() {
  const { data, loading, error } = useApi('/org-chart');
  const [zoom, setZoom] = useState(0.9);
  const [sp] = useSearchParams();
  const focus = Number(sp.get('focus')) || null;
  const tree = useMemo(() => {
    const units = data?.units || [];
    const byParent = {};
    for (const u of units) (byParent[u.parent_id || 'root'] ||= []).push(u);
    const coll = new Intl.Collator('it');
    for (const k of Object.keys(byParent)) byParent[k].sort((a, b) => (a.sort_order - b.sort_order) || coll.compare(a.name, b.name));
    const build = (u, depth = 0) => ({ u, children: depth > 8 ? [] : (byParent[u.id] || []).map((c) => build(c, depth + 1)) });
    return (byParent.root || []).map((u) => build(u));
  }, [data]);
  const unitsWithPositions = (data?.units || []).filter((u) => u.positions?.length).length;
  return (
    <div className="page">
      <PageHead title="Organigramma" icon="tree" sub="Unità organizzative e incarichi: direzione, aree, sedi, reparti" actions={<div className="row tight"><button className="btn ghost sm" onClick={() => setZoom((z) => Math.max(.4, z - .1))} aria-label="Riduci"><Icon name="zoomOut" /></button><span className="small muted" style={{ minWidth: 40, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span><button className="btn ghost sm" onClick={() => setZoom((z) => Math.min(1.6, z + .1))} aria-label="Ingrandisci"><Icon name="zoomIn" /></button><button className="btn ghost sm" onClick={() => setZoom(0.9)}>Reimposta</button><span className="sep" /><a className="btn ghost sm" href="/api/org-chart/export.xlsx" title="Excel (ricaricabile dalle Importazioni)"><Icon name="download" />XLSX</a><a className="btn ghost sm" href="/api/org-chart/export.pptx" title="PowerPoint"><Icon name="download" />PPTX</a><a className="btn ghost sm" href="/api/org-chart/export.pdf" title="PDF"><Icon name="download" />PDF</a></div>} />
      <ErrorBox error={error} />
      {loading && <Card><Skeleton lines={4} /></Card>}
      {data && !unitsWithPositions && <Empty icon="tree" title="Organigramma da comporre">Le unità e gli incarichi si definiscono in Amministrazione, Organizzazione, oppure si caricano con il file Organigramma da Importazioni.</Empty>}
      {tree.length > 0 && unitsWithPositions > 0 && (
        <Card flush><div className="org"><div className="org-wrap" style={{ zoom }}><ul className="tree">{tree.map((n) => <UnitNode key={n.u.id} u={n.u} focus={focus}>{n.children}</UnitNode>)}</ul></div></div></Card>
      )}
    </div>
  );
}

const KIND_LABEL = { DIREZIONE: 'Direzione', AREA: 'Area', SEDE: 'Sede', REPARTO: 'Reparto', FUNZIONE: 'Funzione' };
function UnitNode({ u, children, focus }) {
  const heads = (u.positions || []).filter((x) => x.is_head);
  const others = (u.positions || []).filter((x) => !x.is_head);
  const hit = (u.positions || []).some((x) => x.person_id === focus);
  return (
    <li>
      <div className={`node unit ${u.kind.toLowerCase()}${hit ? ' focus' : ''}`}>
        <div className="unit-head"><span className="unit-kind">{KIND_LABEL[u.kind]}</span><div className="unit-name">{u.name}</div></div>
        {heads.map((x) => <Link key={x.id} to={`/people/${x.person_id}`} className="pos head"><Avatar name={x.person_name} fileId={x.avatar_file_id} size="sm" /><div style={{ minWidth: 0 }}><div className="n">{x.person_name}</div><div className="r ellipsis">{x.role_name || 'Responsabile'}</div></div></Link>)}
        {!heads.length && <div className="pos head tbd"><div className="n muted">Da assegnare</div></div>}
        {others.map((x) => <Link key={x.id} to={`/people/${x.person_id}`} className="pos"><div style={{ minWidth: 0 }}><div className="r">{x.role_name || 'Incarico'}</div><div className="n">{x.person_name}</div></div></Link>)}
      </div>
      {children?.length > 0 && <ul className={children.length > 3 && children.every((c) => !c.children?.length) ? 'stack' : ''}>{children.map((c) => <UnitNode key={c.u.id} u={c.u} focus={focus}>{c.children}</UnitNode>)}</ul>}
    </li>
  );
}

function Roles() {
  const { data, loading, error } = useApi('/job-roles');
  const navigate = useNavigate();
  return (
    <div className="page">
      <PageHead title="Ruoli" icon="grid" sub="I ruoli della rete e quante persone li ricoprono" />
      <ErrorBox error={error} />
      {loading && <Skeleton lines={3} />}
      {data && !data.length && <Empty icon="grid" title="Nessun ruolo definito" />}
      <div className="grid g4">{(data || []).filter((r) => r.people_count).map((r) => (
        <button key={r.id} type="button" className="card kpi" style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid var(--line)' }} onClick={() => navigate(`/people?role_id=${r.id}`)}>
          <div className="lbl">{r.name}</div><div className="val">{r.people_count}<small>person{r.people_count === 1 ? 'a' : 'e'}</small></div>
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
      <Route path="ruoli" element={<Roles />} />
      <Route path=":id" element={<Detail />} />
    </Routes>
  );
}

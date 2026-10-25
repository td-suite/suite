import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, qs } from '../../api.js';
import { useAuth, isOwner } from '../../auth.jsx';
import { useApi, Card, Badge, Skeleton, Empty, ErrorBox, PageHead, Field, SearchInput, Avatar, useToast, Switch, MultiSelect, Modal, ConfirmModal, Pager, CopyButton } from '../../components/ui.jsx';
import { Icon } from '../../components/Icons.jsx';
import { LEVEL, STATUS, STATUS_TONE, PROVIDER, fmtDateTime, timeAgo, AREA_COLORS, AREA_NAMES } from '../../format.js';

// ---------- Elenco ----------
export function UsersList() {
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const get = (k) => sp.get(k) || '';
  const [q, setQ] = useState(get('qtext'));
  useEffect(() => { const t = setTimeout(() => { if (q !== get('qtext')) setF('qtext', q); }, 300); return () => clearTimeout(t); }, [q]); // eslint-disable-line
  const setF = (k, v) => setSp((s) => { const n = new URLSearchParams(s); if (v) n.set(k, v); else n.delete(k); if (k !== 'page') n.delete('page'); return n; });
  const page = Number(get('page') || 1);
  const params = { qtext: get('qtext'), status: get('status'), module: get('module'), level: get('level'), site_id: get('site_id'), page, pageSize: 50 };
  const { data, loading, error, reload } = useApi(`/users${qs(params)}`, [sp.toString()]);
  const { user: me } = useAuth();
  const toast = useToast();
  const [confirmDel, setConfirmDel] = useState(null);
  const mods = useApi('/modules');
  const sites = useApi('/sites?all=1');
  const onlyProposals = get('proposals') === '1';
  const rows = (data?.rows || []).filter((u) => !onlyProposals || u.grants?.some((g) => g.proposed));
  return (
    <div className="page">
      <PageHead title="Utenti" icon="users" sub={data ? `${data.total} utent${data.total === 1 ? "e registrato" : "i registrati"}` : 'Account, livelli e accesso ai widget'} actions={<Link to="/admin/users/new" className="btn"><Icon name="plus" />Nuovo utente</Link>} />
      <div className="filters">
        <SearchInput value={q} onChange={setQ} placeholder="Nome o email" />
        <Field label="Stato"><select value={get('status')} onChange={(e) => setF('status', e.target.value)}><option value="">Tutti</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Modulo"><select value={get('module')} onChange={(e) => setF('module', e.target.value)}><option value="">Tutti</option>{(mods.data || []).map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</select></Field>
        <Field label="Livello"><select value={get('level')} onChange={(e) => setF('level', e.target.value)}><option value="">Tutti</option>{Object.entries(LEVEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Sede"><select value={get('site_id')} onChange={(e) => setF('site_id', e.target.value)}><option value="">Tutte</option>{(sites.data || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <label className="f inline" style={{ alignSelf: 'center' }}><input type="checkbox" checked={onlyProposals} onChange={(e) => setF('proposals', e.target.checked ? '1' : '')} />Solo con proposte</label>
      </div>
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton lines={5} /></div>}
        {error && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && !rows.length && <Empty icon="users" title="Nessun utente corrisponde ai filtri" />}
        {rows.length > 0 && <div className="table-wrap"><table className="t">
          <thead><tr><th>Utente</th><th>Livello</th><th>Stato</th><th>Accesso</th><th>Sede / organizzazione</th><th>Moduli</th><th>Ultimo accesso</th><th></th></tr></thead>
          <tbody>{rows.map((u) => { const proposed = (u.grants || []).filter((g) => g.proposed).length; const active = (u.grants || []).filter((g) => !g.proposed); return (
            <tr key={u.id} className="click" onClick={() => navigate(`/admin/users/${u.id}`)}>
              <td><div className="row tight" style={{ flexWrap: 'nowrap' }}><Avatar name={u.full_name} size="sm" /><div style={{ minWidth: 0 }}><Link to={`/admin/users/${u.id}`} className="strong" onClick={(e) => e.stopPropagation()}>{u.full_name}</Link><div className="small muted ellipsis">{u.email}</div></div></div></td>
              <td><Badge tone={u.level === 'USER' ? 'grey' : u.level === 'OWNER' ? 'teal' : 'blue'}>{LEVEL[u.level]}</Badge></td>
              <td><Badge tone={STATUS_TONE[u.status]}>{STATUS[u.status]}</Badge></td>
              <td className="small">{PROVIDER[u.auth_provider]}{u.totp_enabled && <div className="tiny muted">TOTP attivo</div>}</td>
              <td className="small">{u.site_name || <span className="faint">nessuna sede</span>}{u.organization_name && <div className="tiny muted">{u.organization_name}</div>}</td>
              <td className="small"><span>{active.length} modul{active.length === 1 ? 'o' : 'i'}</span>{proposed > 0 && <div><Badge tone="mauve">{proposed} propost{proposed === 1 ? 'a' : 'e'} da confermare</Badge></div>}</td>
              <td className="small nowrap">{u.last_login_at ? timeAgo(u.last_login_at) : <span className="faint">mai</span>}</td>
              <td className="actions" onClick={(e) => e.stopPropagation()}>{u.level !== 'OWNER' && (u.level !== 'ADMIN' || isOwner(me)) && <button className="iconbtn danger" aria-label="Elimina accesso" title="Elimina accesso" onClick={() => setConfirmDel(u)}><Icon name="trash" /></button>}</td>
            </tr>
          ); })}</tbody>
        </table></div>}
        {data && <Pager page={page} pageSize={50} total={data.total} onChange={(p) => setF('page', String(p))} />}
      </Card>
      {confirmDel && <ConfirmModal title={`Eliminare l'accesso di ${confirmDel.full_name}?`} text="L'utente non potrà più entrare nella Suite e perde i moduli assegnati. La persona resta in anagrafica: l'accesso si può ricreare dalla sua scheda." danger confirmText="Elimina" onConfirm={async () => { await api.del(`/users/${confirmDel.id}`); toast('Accesso eliminato'); reload(); }} onClose={() => setConfirmDel(null)} />}
    </div>
  );
}

// ---------- Scelta della persona per un nuovo accesso ----------
function PersonPicker({ value, onChange }) {
  const [qtext, setQ] = useState('');
  const { data } = useApi(`/people${qs({ qtext, all: 1 })}`, [qtext]);
  const rows = (data || []).filter((p) => p.email).slice(0, 30);
  const sel = (data || []).find((p) => String(p.id) === String(value));
  return (
    <div className="col" style={{ gap: 8 }}>
      <SearchInput value={qtext} onChange={setQ} placeholder="Cerca per cognome, nome o email" />
      {sel && <div className="row tight"><Avatar name={`${sel.last_name} ${sel.first_name}`} size="sm" /><span className="strong">{sel.last_name} {sel.first_name}</span><span className="muted small">{sel.email}{sel.user_id ? ' · ha già un accesso' : ''}</span><button type="button" className="btn sm ghost" onClick={() => onChange(null)}>Cambia</button></div>}
      {!sel && <div className="list" style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 10 }}>
        {rows.map((p) => <button type="button" key={p.id} className="it" style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, cursor: p.user_id ? 'not-allowed' : 'pointer', opacity: p.user_id ? .5 : 1 }} disabled={Boolean(p.user_id)} onClick={() => onChange(p)}>
          <div className="t">{p.last_name} {p.first_name}</div><div className="m">{p.email} · {p.job_title || p.area || ''}{p.site_name ? ` · ${p.site_name}` : ''}{p.user_id ? ' · ha già un accesso' : ''}</div>
        </button>)}
        {!rows.length && <div className="small muted" style={{ padding: 12 }}>Nessuna persona con email trovata.</div>}
      </div>}
    </div>
  );
}

// ---------- Riga grant ----------
function GrantRow({ module: m, grant, onChange, canAssign, sites, orgs }) {
  const on = Boolean(grant);
  const profile = m.profiles?.find((p) => p.key === grant?.profile);
  const scoped = Boolean(profile?.scoped);
  const scopeType = m.scope_type || 'SITE';
  const options = scopeType === 'ORG' ? orgs : sites;
  const ids = (grant?.scopes || []).filter((s) => s.type === scopeType).map((s) => Number(s.id));
  const locked = !canAssign;
  const toggle = (v) => { if (locked) return; onChange(v ? { profile: m.profiles?.[0]?.key || 'VIEWER', scopes: [] } : null); };
  return (
    <div className={`grant-row ${on ? '' : 'off'} ${grant?.proposed ? 'proposed' : ''} ${locked ? 'tip' : ''}`} data-tip={locked ? 'Assegnabile solo dal titolare' : undefined}>
      <div className="wi" style={{ color: AREA_COLORS[m.area] || 'var(--teal)' }}><Icon name={m.icon} /></div>
      <div style={{ minWidth: 0 }}>
        <div className="nm">{m.restricted && <Icon name="lock" title="Modulo riservato" />}{m.name}{grant?.proposed && <Badge tone="mauve">Proposta</Badge>}{grant?.source && grant.source !== 'MANUAL' && <span className="tiny faint">da {grant.source}</span>}</div>
        <div className="tg">{m.tagline}</div>
      </div>
      <div className="row tight prof-sel" style={{ flexWrap: 'nowrap' }}>
        <Switch checked={on} onChange={toggle} disabled={locked} label={`Abilita ${m.name}`} />
        {on && <select value={grant.profile} disabled={locked} onChange={(e) => onChange({ ...grant, profile: e.target.value, scopes: m.profiles?.find((p) => p.key === e.target.value)?.scoped ? grant.scopes : [] })} aria-label={`Profilo ${m.name}`} style={{ minHeight: 34, padding: '4px 8px', fontSize: 13 }}>
          {(m.profiles || []).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>}
      </div>
      <div className="sc">
        {on && scoped && <div style={{ flex: 1, minWidth: 180 }}><MultiSelect value={ids} onChange={(nids) => onChange({ ...grant, scopes: nids.map((id) => ({ type: scopeType, id })) })} options={options || []} placeholder={scopeType === 'ORG' ? 'Aggiungi organizzazione' : 'Aggiungi sede'} labelOf={(o) => (o.code ? `${o.code} · ${o.name}` : o.name)} />{!ids.length && <div className="tiny amber mt" style={{ marginTop: 4 }}>Questo profilo richiede almeno un ambito.</div>}</div>}
        {on && !scoped && <span className="tiny faint">{m.kind === 'LEGACY' ? 'Accesso a tutta l\'app' : 'Accesso completo'}</span>}
        {grant?.proposed && !locked && <><button className="btn sm mauve" onClick={() => onChange({ ...grant, confirm: true })}><Icon name="check" />Conferma</button><button className="btn sm ghost" onClick={() => onChange(null)}>Rimuovi</button></>}
      </div>
    </div>
  );
}

// ---------- Dettaglio / nuovo ----------
const EMPTY_USER = { email: '', full_name: '', first_name: '', last_name: '', person_id: '', title: '', phone: '', level: 'USER', status: 'ACTIVE', auth_provider: 'ENTRA', organization_id: '', site_id: '', person_id: '', lang: 'it', password: '', send_invite: true };

export function UserDetail() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const toast = useToast();
  const { user: me } = useAuth();
  const owner = isOwner(me);
  const detail = useApi(!isNew ? `/users/${id}` : null, [id]);
  const mods = useApi('/modules');
  const sites = useApi('/sites?all=1');
  const orgs = useApi('/organizations');
  const people = useApi('/people?all=1');
  const [f, setF] = useState(EMPTY_USER);
  const [grants, setGrants] = useState({}); // module_key → {profile, scopes, proposed, source}
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // {temporaryPassword, invited}
  const [confirm, setConfirm] = useState(null);

  useEffect(() => {
    if (detail.data) {
      const u = detail.data.user;
      setF({ ...EMPTY_USER, ...Object.fromEntries(Object.entries(u).filter(([k]) => k in EMPTY_USER).map(([k, v]) => [k, v ?? ''])), password: '', send_invite: false });
      setGrants(Object.fromEntries((detail.data.grants || []).map((g) => [g.module_key, { profile: g.profile, scopes: g.scopes || [], proposed: g.proposed, source: g.source }])));
    }
  }, [detail.data]);

  const byArea = useMemo(() => {
    const m = {};
    for (const mod of (mods.data || []).filter((x) => x.active !== false)) (m[mod.area] ||= []).push(mod);
    const order = ['DIREZIONE', 'FINANCE', 'RETAIL_FLOW', 'OPERATIONS', 'HQS', 'PEOPLE'];
    return Object.entries(m).sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  }, [mods.data]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const payload = () => ({
    email: f.email.trim(), first_name: f.first_name.trim(), last_name: f.last_name.trim(), full_name: `${f.last_name.trim()} ${f.first_name.trim()}`.trim(), title: f.title || null, phone: f.phone || null, level: f.level, status: f.status, auth_provider: f.auth_provider,
    organization_id: f.organization_id ? Number(f.organization_id) : null, site_id: f.site_id ? Number(f.site_id) : null, person_id: f.person_id ? Number(f.person_id) : null, lang: f.lang,
  });

  const saveUser = async (e) => {
    e?.preventDefault(); setBusy(true);
    try {
      if (isNew) {
        const body = { ...payload(), send_invite: Boolean(f.send_invite), ...(f.password ? { password: f.password } : {}), grants: Object.entries(grants).map(([module_key, g]) => ({ module_key, profile: g.profile, scopes: g.scopes?.length ? g.scopes : undefined })) };
        const r = await api.post('/users', body);
        toast('Utente creato');
        if (r.temporaryPassword) setResult(r); else navigate(`/admin/users/${r.id}`);
      } else {
        const body = payload();
        if (!owner) delete body.level;
        await api.put(`/users/${id}`, body);
        toast('Utente aggiornato'); detail.reload();
      }
    } catch (e2) { toast(e2, 'err'); }
    setBusy(false);
  };

  const changeGrant = async (m, g) => {
    if (isNew) { setGrants((x) => { const n = { ...x }; if (g) n[m.key] = { profile: g.profile, scopes: g.scopes || [] }; else delete n[m.key]; return n; }); return; }
    try {
      if (!g) { await api.del(`/users/${id}/grants/${m.key}`); toast(`${m.name} rimosso`); }
      else { await api.put(`/users/${id}/grants/${m.key}`, { profile: g.profile, scopes: g.scopes?.length ? g.scopes : [] }); toast(g.confirm ? `${m.name} confermato` : `${m.name} aggiornato`); }
      detail.reload();
    } catch (e) { toast(e, 'err'); }
  };
  const confirmAll = async () => { try { await api.post(`/users/${id}/grants/confirm-all`); toast('Proposte confermate'); detail.reload(); } catch (e) { toast(e, 'err'); } };
  const resetPassword = async () => { const r = await api.post(`/users/${id}/reset-password`); toast('Password reimpostata'); if (r.temporaryPassword) setResult(r); };
  const resetTotp = async () => { await api.post(`/users/${id}/reset-totp`); toast('Verifica in due passaggi azzerata'); detail.reload(); };
  const setStatus = async (status) => { await api.put(`/users/${id}`, { status }); toast(status === 'DISABLED' ? 'Utente disattivato' : 'Utente attivato'); detail.reload(); };

  if (!isNew && detail.loading) return <div className="page"><Skeleton lines={6} /></div>;
  if (!isNew && detail.error) return <div className="page"><PageHead crumb={<><Link to="/admin/users">Utenti</Link><Icon name="chevron" /><span>Dettaglio</span></>} title="Utente non disponibile" icon="user" /><ErrorBox error={detail.error} /><div className="row mt2"><button className="btn ghost" onClick={detail.reload}><Icon name="refresh" />Riprova</button><Link to="/admin/users" className="btn">Torna agli utenti</Link></div></div>;
  const u = detail.data?.user;
  if (!isNew && !u) return <div className="page"><Skeleton lines={6} /></div>;   // transizione da /new al dettaglio appena creato: i dati non sono ancora arrivati
  const proposedCount = Object.values(grants).filter((g) => g.proposed).length;
  const targetIsOwner = u?.level === 'OWNER';

  return (
    <div className="page">
      <PageHead crumb={<><Link to="/admin/users">Utenti</Link><Icon name="chevron" /><span>{isNew ? 'Nuovo utente' : u?.full_name}</span></>}
        title={isNew ? 'Nuovo utente' : u?.full_name} icon="user" sub={isNew ? 'Crea l\'account e assegna subito i widget' : <span className="row tight">{u.email}<Badge tone={STATUS_TONE[u.status]}>{STATUS[u.status]}</Badge><Badge tone={u.level === 'USER' ? 'grey' : 'teal'}>{LEVEL[u.level]}</Badge></span>}
        actions={!isNew && <>
          {['LOCAL', 'BOTH'].includes(u.auth_provider) && <button className="btn ghost sm" onClick={() => setConfirm({ title: 'Reimpostare la password?', text: 'Verrà generata una password provvisoria e inviata via email, se possibile.', go: resetPassword })}><Icon name="key" />Reset password</button>}
          {u.totp_enabled && <button className="btn ghost sm" onClick={() => setConfirm({ title: 'Azzerare la verifica in due passaggi?', text: 'L\'utente dovrà configurarla di nuovo dal profilo.', go: resetTotp })}><Icon name="unlock" />Reset TOTP</button>}
          {u.status !== 'DISABLED' ? <button className="btn danger sm" disabled={targetIsOwner} onClick={() => setConfirm({ title: 'Disattivare l\'utente?', text: 'Non potrà più accedere alla Suite e alle app collegate.', danger: true, confirmText: 'Disattiva', go: () => setStatus('DISABLED') })}><Icon name="x" />Disattiva</button>
            : <button className="btn sm" onClick={() => setStatus('ACTIVE')}><Icon name="check" />Riattiva</button>}
        </>} />

      {u?.status === 'PENDING' && <div className="alert warn mb2"><Icon name="alert" /><span>Questo account è in attesa di abilitazione: imposta lo stato su Attivo e assegna i moduli per farlo entrare.</span></div>}

      <div className="grid user-layout">
        <div className="col">
          <Card title="Anagrafica" icon="user">
            <form onSubmit={saveUser} className="col" id="uform">
              {isNew ? (
                <Field label="Persona" required help="Ogni utente è una persona dell'anagrafica: scegli chi deve avere l'accesso. Se manca, creala prima in Persone o in Contratti del personale.">
                  <PersonPicker value={f.person_id} onChange={(p) => setF({ ...f, person_id: p?.id || '', email: p?.email || '', first_name: p?.first_name || '', last_name: p?.last_name || '', site_id: p?.site_id || f.site_id })} />
                </Field>
              ) : (
                <>
                  <Field label="Email" required><input type="email" value={f.email} onChange={set('email')} required disabled={!owner} /></Field>
                  <div className="form-grid">
                    <Field label="Cognome" required><input value={f.last_name} onChange={set('last_name')} required /></Field>
                    <Field label="Nome" required><input value={f.first_name} onChange={set('first_name')} required /></Field>
                  </div>
                  {u?.person_id ? <div className="small muted">Persona collegata: <Link to={`/people/${u.person_id}`}>scheda in Rubrica</Link></div> : <div className="alert warn small"><Icon name="alert" /><span>Utente senza persona collegata (eredità): nome e sede non seguono l'anagrafica.</span></div>}
                </>
              )}
              <div className="form-grid">
                <Field label="Titolo"><input value={f.title} onChange={set('title')} maxLength={20} placeholder="Dott.ssa" /></Field>
                <Field label="Telefono"><input value={f.phone} onChange={set('phone')} /></Field>
                <Field label="Livello" help={!owner ? 'Solo il titolare cambia il livello' : undefined}><select value={f.level} onChange={set('level')} disabled={!owner}>{Object.entries(LEVEL).map(([k, v]) => <option key={k} value={k} disabled={k === 'OWNER' && !owner}>{v}</option>)}</select></Field>
                <Field label="Stato"><select value={f.status} onChange={set('status')} disabled={targetIsOwner}>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Metodo di accesso"><select value={f.auth_provider} onChange={set('auth_provider')}>{Object.entries(PROVIDER).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Lingua"><select value={f.lang} onChange={set('lang')}><option value="it">Italiano</option><option value="en">English</option></select></Field>
                <Field label="Sede"><select value={f.site_id} onChange={set('site_id')}><option value="">Nessuna</option>{(sites.data || []).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></Field>
                <Field label="Organizzazione"><select value={f.organization_id} onChange={set('organization_id')}><option value="">Nessuna</option>{(orgs.data || []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
              </div>
              {!isNew && <Field label="Persona in rubrica" help="Collega l'account alla scheda anagrafica (ruolo, area, responsabile)."><select value={f.person_id} onChange={set('person_id')}><option value="">Nessuna</option>{(people.data || []).map((p) => <option key={p.id} value={p.id}>{p.last_name} {p.first_name}{p.job_title ? ` · ${p.job_title}` : ''}</option>)}</select></Field>}
              {isNew && ['LOCAL', 'BOTH'].includes(f.auth_provider) && <>
                <Field label="Password provvisoria" help="Vuota: viene generata e inviata con l'invito."><input type="text" autoComplete="off" value={f.password} onChange={set('password')} minLength={12} /></Field>
              </>}
              {isNew && <label className="f inline"><input type="checkbox" checked={f.send_invite} onChange={set('send_invite')} />Invia l'email di invito con le istruzioni di accesso</label>}
              <div className="row end"><button className="btn" disabled={busy}>{isNew ? 'Crea utente' : 'Salva'}</button></div>
            </form>
          </Card>
          {!isNew && (
            <Card title="Attività recenti" icon="shield">
              {!detail.data.audit?.length && <div className="small muted">Nessuna attività registrata.</div>}
              <ul className="timeline">{(detail.data.audit || []).slice(0, 15).map((a, i) => <li key={i}><div className="ev"><span className="mono">{a.action}</span>{a.label && <span className="muted"> · {a.label}</span>}</div><div className="w">{fmtDateTime(a.at)}</div></li>)}</ul>
            </Card>
          )}
        </div>
        <div className="col">
          <Card title="Accesso ai widget" icon="grid" flush actions={<>{proposedCount > 0 && !isNew && <button className="btn sm mauve" onClick={confirmAll}><Icon name="check" />Conferma tutte le proposte ({proposedCount})</button>}{isNew && <span className="small muted">I moduli verranno assegnati alla creazione</span>}</>}>
            {mods.loading && <div style={{ padding: 18 }}><Skeleton lines={4} /></div>}
            {byArea.map(([area, list]) => (
              <div key={area}>
                <div className="area-title" style={{ '--area': AREA_COLORS[area], padding: '12px 14px 4px' }}><i /><h2>{AREA_NAMES[area] || area}</h2></div>
                {list.map((m) => <GrantRow key={m.key} module={m} grant={grants[m.key]} sites={sites.data} orgs={orgs.data} canAssign={!m.restricted || owner} onChange={(g) => changeGrant(m, g)} />)}
              </div>
            ))}
            <div className="small muted" style={{ padding: 14 }}>Le righe evidenziate in viola sono proposte automatiche (dall'area organizzativa o dalle app legacy) in attesa di conferma. Il modulo con il lucchetto è assegnabile solo dal titolare.</div>
          </Card>
        </div>
      </div>

      {result && (
        <Modal title={result.invited ? 'Utente creato e invitato' : 'Password provvisoria'} onClose={() => { setResult(null); if (isNew && result.id) navigate(`/admin/users/${result.id}`); }}
          footer={<button className="btn" onClick={() => { setResult(null); if (isNew && result.id) navigate(`/admin/users/${result.id}`); }}>Ho preso nota</button>}>
          {result.invited ? <div className="alert ok"><Icon name="check" /><span>L'email di invito con le istruzioni è stata inviata.</span></div> : <div className="alert warn"><Icon name="alert" /><span>L'email non è partita: comunica la password provvisoria all'utente con un canale sicuro. Non sarà più visibile dopo la chiusura.</span></div>}
          {result.temporaryPassword && <div className="secret mt"><span>{result.temporaryPassword}</span><CopyButton text={result.temporaryPassword} /></div>}
        </Modal>
      )}
      {confirm && <ConfirmModal title={confirm.title} text={confirm.text} danger={confirm.danger} confirmText={confirm.confirmText} onConfirm={confirm.go} onClose={() => setConfirm(null)} />}
    </div>
  );
}

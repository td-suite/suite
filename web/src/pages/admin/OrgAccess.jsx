// Scheda Legal entity > sezione "Accessi" (richiesta del CEO, 29/10/2026): utenti esterni collegati all'organizzazione, creazione di
// un accesso esterno con il profilo di sistema (Partner ospitante / Cliente service) proposto dal tipo e dalle sedi, riallineamento
// dei perimetri quando TD apre un nuovo punto prelievi presso lo stesso partner. Le regole stanno nel server (routes/esterni.js).
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useApi, Badge, Skeleton, Empty, ErrorBox, Field, useToast, Modal, Switch, CopyButton } from '../../components/ui.jsx';
import { Icon } from '../../components/Icons.jsx';
import { ORG_KIND, STATUS, STATUS_TONE, timeAgo } from '../../format.js';

const PROFILE_LABEL = { PARTNER_OSPITANTE: 'Partner ospitante', CLIENTE_SERVICE: 'Cliente service' };

function CreateAccess({ org, data, onClose, onCreated }) {
  const toast = useToast();
  const [f, setF] = useState({ person_id: '', first_name: '', last_name: '', email: '', job_title: '', phone_office: '', profile_key: data.proposed_profile_key || (data.profiles[0]?.system_key || ''), send_invite: true });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const pickPerson = (id) => {
    const p = data.people.find((x) => String(x.id) === String(id));
    setF({ ...f, person_id: id, first_name: p?.first_name || '', last_name: p?.last_name || '', email: p?.email || '', job_title: p?.job_title || '', phone_office: p?.phone_office || '' });
  };
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const out = await api.post(`/organizations/${org.id}/external-access`, { ...f, person_id: f.person_id ? Number(f.person_id) : null, job_title: f.job_title || null, phone_office: f.phone_office || null });
      setDone(out); onCreated?.();
      toast(out.invited ? 'Accesso creato e invito inviato' : 'Accesso creato: consegna la password provvisoria');
    } catch (err) { toast(err, 'err'); }
    setBusy(false);
  };
  const prof = data.profiles.find((p) => p.system_key === f.profile_key);
  if (done) {
    return (
      <Modal title="Accesso esterno creato" onClose={onClose} footer={<button className="btn" onClick={onClose}>Chiudi</button>}>
        <div className="col" style={{ gap: 10 }}>
          <div><b>{f.last_name} {f.first_name}</b> · {f.email}</div>
          <div>Profilo <Badge tone="blue">{done.profile?.name}</Badge>{done.access_profile ? <span className="small muted"> · {done.access_profile.added} widget assegnati</span> : null}</div>
          {done.invited ? <div className="alert ok small"><Icon name="check" /><span>Invito inviato via email con la password provvisoria.</span></div>
            : done.temporaryPassword ? <div className="alert warn small"><Icon name="alert" /><span>Email non inviata (posta non configurata). Password provvisoria da consegnare: <code>{done.temporaryPassword}</code> <CopyButton text={done.temporaryPassword} /></span></div>
              : <div className="alert warn small"><Icon name="alert" /><span>Invito non inviato: usa "Reset password" dalla scheda utente per generare una password provvisoria.</span></div>}
          {done.access_profile?.warnings?.length > 0 && <div className="alert warn small"><Icon name="alert" /><div>{done.access_profile.warnings.map((w, i) => <div key={i}>{w}</div>)}</div></div>}
          {done.access_profile_error && <div className="alert err small"><Icon name="alert" /><span>Profilo non applicato: {done.access_profile_error}</span></div>}
          <div className="small muted">Al primo accesso l'utente sceglie una password personale. Scheda in <Link to={`/admin/users/${done.id}`} onClick={onClose}>Utenti</Link>.</div>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={`Crea accesso esterno · ${org.name}`} onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" form="extform" disabled={busy || !f.profile_key}>Crea e invia l'invito</button></>}>
      <form id="extform" onSubmit={submit} className="form-grid">
        {data.people.length > 0 && <Field label="Referente già in anagrafica" className="span-all" help="Persone della Legal entity (tipo Esterno) senza accesso: scegline una per precompilare">
          <select value={f.person_id} onChange={(e) => pickPerson(e.target.value)}><option value="">Nuova persona</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.last_name} {p.first_name}{p.email ? ` · ${p.email}` : ' · senza email'}{p.job_title ? ` · ${p.job_title}` : ''}</option>)}</select>
        </Field>}
        <Field label="Cognome" required><input value={f.last_name} onChange={set('last_name')} required maxLength={60} /></Field>
        <Field label="Nome" required><input value={f.first_name} onChange={set('first_name')} required maxLength={60} /></Field>
        <Field label="Email" required help="Credenziali locali con invito (gli esterni non hanno Microsoft 365 aziendale)"><input type="email" value={f.email} onChange={set('email')} required /></Field>
        <Field label="Ruolo presso la Legal entity"><input value={f.job_title} onChange={set('job_title')} maxLength={160} placeholder="Titolare, Direttore di laboratorio, Amministrazione" /></Field>
        <Field label="Telefono ufficio"><input value={f.phone_office} onChange={set('phone_office')} maxLength={40} /></Field>
        <Field label="Profilo di accesso" required help={f.profile_key === data.proposed_profile_key ? 'Proposto dal tipo di Legal entity e dalle sedi collegate' : undefined}>
          <select value={f.profile_key} onChange={set('profile_key')} required>{data.profiles.map((p) => <option key={p.system_key} value={p.system_key}>{p.name}</option>)}</select>
        </Field>
        {prof && <div className="span-all small muted">{prof.description}. Widget: {(prof.items || []).map((i) => `${i.module_key} (${i.profile})`).join(', ')}, più Ticket (aperto a tutti gli account).</div>}
        {f.profile_key === 'PARTNER_OSPITANTE' && <div className="span-all small">{data.hosted_sites.length ? <>Sedi ospitate che entreranno nel perimetro Cash: {data.hosted_sites.map((s) => s.name).join(', ')}.</> : <span className="alert warn small"><Icon name="alert" /><span>La Legal entity non ospita ancora nessun punto prelievi (Amministrazione › Sedi › Legal entity ospitante): il grant Cash nascerà senza sedi; dopo averle collegate usa "Riallinea perimetri".</span></span>}</div>}
        {f.profile_key === 'CLIENTE_SERVICE' && <div className="span-all small">{data.service_sites.length ? <>Punti service collegati: {data.service_sites.map((s) => s.name).join(', ')}. Le non conformità si vedono per l'intera Legal entity.</> : <span className="muted">Nessuna sede SERVICE collegata: le NC si vedono comunque per la Legal entity (contratto service scelto a mano).</span>}</div>}
        <label className="f inline span-all" style={{ alignItems: 'center', gap: 10 }}><Switch checked={f.send_invite} onChange={(v) => setF({ ...f, send_invite: v })} label="Invia l'invito via email" /><span>Invia l'invito via email con la password provvisoria<span className="help" style={{ display: 'block' }}>Se spento, la password provvisoria viene mostrata qui una sola volta, da consegnare a mano.</span></span></label>
      </form>
    </Modal>
  );
}

export function OrgAccessModal({ org, onClose, onChanged }) {
  const toast = useToast();
  const { data, loading, error, reload } = useApi(`/organizations/${org.id}/access`, [org.id]);
  const [create, setCreate] = useState(false);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReport(null); }, [org.id]);
  const realign = async () => {
    setBusy(true);
    try { const r = await api.post(`/organizations/${org.id}/realign-perimeters`, {}); setReport(r); toast(`Perimetri riallineati: ${r.changed} grant aggiornati su ${r.users} utenti`); reload(); onChanged?.(); } catch (e) { toast(e, 'err'); }
    setBusy(false);
  };
  const internal = ['GRUPPO', 'SOCIETA'].includes(org.kind);
  return (
    <Modal title={`Accessi · ${org.name}`} onClose={onClose} wide footer={<><button className="btn ghost" onClick={onClose}>Chiudi</button>{!internal && data && <button className="btn ghost" disabled={busy || !data.users.length} onClick={realign} title="Ricalcola gli ambiti dei grant nati dai profili per tutti gli utenti della Legal entity"><Icon name="refresh" />Riallinea perimetri</button>}{!internal && data && <button className="btn" onClick={() => setCreate(true)}><Icon name="plus" />Crea accesso esterno</button>}</>}>
      {loading && <Skeleton lines={4} />}
      <ErrorBox error={error} />
      {data && (
        <div className="col" style={{ gap: 14 }}>
          <div className="row tight" style={{ flexWrap: 'wrap' }}>
            <Badge tone={org.kind === 'CLIENTE' ? 'blue' : 'grey'}>{ORG_KIND[org.kind] || org.kind}</Badge>
            {data.hosted_sites.length > 0 && <span className="small">Ospita {data.hosted_sites.length} punt{data.hosted_sites.length === 1 ? 'o prelievi' : 'i prelievo'}: {data.hosted_sites.map((s) => s.name).join(', ')}</span>}
            {data.service_sites.length > 0 && <span className="small">{data.service_sites.length} sed{data.service_sites.length === 1 ? 'e' : 'i'} SERVICE: {data.service_sites.map((s) => s.name).join(', ')}</span>}
            {data.proposed_profile_key && <span className="small muted">Profilo proposto: <b>{PROFILE_LABEL[data.proposed_profile_key]}</b></span>}
          </div>
          {internal && <div className="alert info small"><Icon name="info" /><span>Società del gruppo: i suoi utenti sono interni e si gestiscono in Amministrazione › Utenti.</span></div>}
          {!data.users.length && <Empty icon="users" compact title="Nessun utente collegato">{internal ? '' : 'Crea il primo accesso esterno: la persona nasce in anagrafica (tipo Esterno) e riceve l\'invito con la password provvisoria.'}</Empty>}
          {data.users.length > 0 && <div className="table-wrap"><table className="t">
            <thead><tr><th>Utente</th><th>Stato</th><th>Widget e perimetro</th><th>Ultimo accesso</th><th /></tr></thead>
            <tbody>{data.users.map((u) => (
              <tr key={u.id}>
                <td><div className="strong">{u.full_name}</div><div className="small muted">{u.email}</div></td>
                <td><Badge tone={STATUS_TONE[u.status]}>{STATUS[u.status]}</Badge>{u.level !== 'USER' && <div><Badge tone="teal">{u.level}</Badge></div>}</td>
                <td className="small">{(u.grants || []).filter((g) => !g.proposed).map((g) => <div key={g.module_key}><span className="mono">{g.module_key}</span> · {g.profile}{g.scopes?.length ? <span className="muted"> · {g.scopes.filter((s) => s.type === 'SITE').length ? `${g.scopes.filter((s) => s.type === 'SITE').length} sed${g.scopes.filter((s) => s.type === 'SITE').length === 1 ? 'e' : 'i'}` : ''}{g.scopes.some((s) => s.type === 'ORG') ? ' Legal entity' : ''}</span> : null}{g.access_profile ? <span className="faint"> · {g.access_profile}</span> : null}</div>)}{!(u.grants || []).length && <span className="muted">Nessun widget</span>}</td>
                <td className="small nowrap">{u.last_login_at ? timeAgo(u.last_login_at) : <span className="faint">mai</span>}</td>
                <td className="actions"><Link to={`/admin/users/${u.id}`} className="btn sm ghost" onClick={onClose}>Apri</Link></td>
              </tr>
            ))}</tbody>
          </table></div>}
          {data.people.length > 0 && <div className="small muted">{data.people.length} person{data.people.length === 1 ? 'a' : 'e'} della Legal entity senza accesso: {data.people.slice(0, 5).map((p) => `${p.last_name} ${p.first_name}`).join(', ')}{data.people.length > 5 ? '…' : ''}. Si possono scegliere in "Crea accesso esterno".</div>}
          {report && <div className="alert info small"><Icon name="info" /><div><div>Riallineamento: {report.changed} grant aggiornati su {report.grants} ({report.users} utenti); sedi ospitate {report.context.hosted_sites}, sedi dell'organizzazione {report.context.org_sites}.</div>{report.warnings.slice(0, 8).map((w, i) => <div key={i}>{w}</div>)}</div></div>}
        </div>
      )}
      {create && data && <CreateAccess org={org} data={data} onClose={() => setCreate(false)} onCreated={() => { reload(); onChanged?.(); }} />}
    </Modal>
  );
}

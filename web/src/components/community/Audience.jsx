import React from 'react';
import { Field, MultiSelect, useApi } from '../ui.jsx';

const TYPES = [
  { value: 'ALL', label: 'Tutti' }, { value: 'INTERNAL', label: 'Solo interni' }, { value: 'SITES', label: 'Sedi' },
  { value: 'ORGS', label: 'Organizzazioni' }, { value: 'MODULE', label: 'Modulo' }, { value: 'USERS', label: 'Utenti' },
];

export function audienceLabel(a, ctx = {}) {
  if (!a || a.type === 'ALL') return 'Tutti';
  if (a.type === 'INTERNAL') return 'Solo interni';
  if (a.type === 'MODULE') return `Modulo ${ctx.modules?.find((m) => m.key === a.key)?.name || a.key || ''}`;
  const n = a.ids?.length || 0;
  return { SITES: `${n} sed${n === 1 ? 'e' : 'i'}`, ORGS: `${n} organizzazion${n === 1 ? 'e' : 'i'}`, USERS: `${n} utent${n === 1 ? 'e' : 'i'}` }[a.type] || a.type;
}

// Selettore del pubblico: {type, ids?|key?}
export default function AudienceSelector({ value, onChange, admin }) {
  const a = value || { type: 'ALL' };
  const sites = useApi(a.type === 'SITES' ? '/sites?all=1' : null, [a.type]);
  const orgs = useApi(a.type === 'ORGS' ? '/organizations' : null, [a.type]);
  const mods = useApi(a.type === 'MODULE' ? '/modules' : null, [a.type]);
  const users = useApi(a.type === 'USERS' && admin ? '/users?pageSize=200&status=ACTIVE' : null, [a.type]);
  const set = (type) => onChange(type === 'MODULE' ? { type, key: '' } : ['SITES', 'ORGS', 'USERS'].includes(type) ? { type, ids: [] } : { type });
  return (
    <div className="col" style={{ gap: 8 }}>
      <Field label="Pubblico">
        <select value={a.type} onChange={(e) => set(e.target.value)}>{TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
      </Field>
      {a.type === 'SITES' && <MultiSelect value={a.ids || []} onChange={(ids) => onChange({ ...a, ids })} options={sites.data || []} placeholder="Aggiungi una sede" labelOf={(s) => `${s.code} · ${s.name}`} />}
      {a.type === 'ORGS' && <MultiSelect value={a.ids || []} onChange={(ids) => onChange({ ...a, ids })} options={orgs.data || []} placeholder="Aggiungi un'organizzazione" />}
      {a.type === 'MODULE' && <select value={a.key || ''} onChange={(e) => onChange({ ...a, key: e.target.value })} aria-label="Modulo"><option value="">Scegli il modulo</option>{(mods.data || []).map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</select>}
      {a.type === 'USERS' && (admin ? <MultiSelect value={a.ids || []} onChange={(ids) => onChange({ ...a, ids })} options={users.data?.rows || []} placeholder="Aggiungi un utente" labelOf={(u) => `${u.full_name} (${u.email})`} /> : <div className="help">L'elenco utenti è riservato all'amministrazione: indica gli id separati da virgola.<input value={(a.ids || []).join(',')} onChange={(e) => onChange({ ...a, ids: e.target.value.split(',').map((x) => Number(x.trim())).filter(Boolean) })} /></div>)}
    </div>
  );
}

// Firmatari della circolare (v0.98.0): uno o più, scelti dal personale (nome, ruolo, email e telefono d'ufficio arrivano dall'anagrafica
// e si possono correggere) o scritti a mano. I recapiti di ogni firmatario compaiono nel riquadro "Per informazioni" in fondo.
import React, { useEffect, useState } from 'react';
import { Icon } from '../../components/Icons.jsx';

const VUOTO = { nome: '', ruolo: '', email: '', telefono: '' };
export default function Firmatari({ value, onChange, max = 6 }) {
  const lista = Array.isArray(value) ? value : [];
  const [persone, setPersone] = useState(null);
  useEffect(() => {
    let vivo = true;
    fetch('/api/people?status=ATTIVO', { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])).then((j) => { if (vivo) setPersone((Array.isArray(j) ? j : j.rows || []).filter((p) => p.kind !== 'ESTERNO')); }).catch(() => vivo && setPersone([]));
    return () => { vivo = false; };
  }, []);
  const set = (i, k, v) => onChange(lista.map((f, n) => (n === i ? { ...f, [k]: v } : f)));
  const togli = (i) => onChange(lista.filter((_, n) => n !== i));
  const sposta = (i, d) => { const l = [...lista]; const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; onChange(l); };
  const daPersona = (id) => {
    const p = (persone || []).find((x) => String(x.id) === String(id)); if (!p) return;
    const ruolo = p.job_title || p.positions?.[0]?.role_name || '';
    onChange([...lista, { nome: `${p.first_name || ''} ${p.last_name || ''}`.trim(), ruolo, email: p.email || '', telefono: p.phone_office || '' }]);
  };
  return (
    <div className="circ-firme">
      {lista.map((f, i) => (
        <div key={i} className="circ-firma">
          <div className="circ-firma-campi">
            <input value={f.nome} onChange={(e) => set(i, 'nome', e.target.value)} placeholder="Nome e cognome" maxLength={80} aria-label={`Firmatario ${i + 1}: nome`} />
            <input value={f.ruolo || ''} onChange={(e) => set(i, 'ruolo', e.target.value)} placeholder="Ruolo" maxLength={80} aria-label={`Firmatario ${i + 1}: ruolo`} />
            <input value={f.email || ''} onChange={(e) => set(i, 'email', e.target.value)} placeholder="Email (in fondo alla circolare)" maxLength={120} aria-label={`Firmatario ${i + 1}: email`} />
            <input value={f.telefono || ''} onChange={(e) => set(i, 'telefono', e.target.value)} placeholder="Telefono (in fondo alla circolare)" maxLength={40} aria-label={`Firmatario ${i + 1}: telefono`} />
          </div>
          <div className="circ-firma-az">
            <button type="button" className="btn sm ghost" disabled={i === 0} onClick={() => sposta(i, -1)} title="Sposta prima" aria-label="Sposta prima"><Icon name="arrowUp" /></button>
            <button type="button" className="btn sm ghost" disabled={i === lista.length - 1} onClick={() => sposta(i, 1)} title="Sposta dopo" aria-label="Sposta dopo"><Icon name="arrowDown" /></button>
            <button type="button" className="btn sm ghost" onClick={() => togli(i)} title="Togli il firmatario" aria-label="Togli il firmatario"><Icon name="trash" /></button>
          </div>
        </div>
      ))}
      {!lista.length && <div className="small muted">Nessun firmatario: la circolare esce senza firma.</div>}
      {lista.length < max && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select value="" onChange={(e) => daPersona(e.target.value)} style={{ maxWidth: 340 }} aria-label="Aggiungi un firmatario dal personale">
            <option value="">{persone ? 'Aggiungi dal personale…' : 'Carico il personale…'}</option>
            {(persone || []).slice().sort((a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`)).map((p) => <option key={p.id} value={p.id}>{p.last_name} {p.first_name}{p.job_title ? ` · ${p.job_title}` : ''}</option>)}
          </select>
          <button type="button" className="btn sm ghost" onClick={() => onChange([...lista, { ...VUOTO }])}><Icon name="plus" />Scrivi a mano</button>
        </div>
      )}
    </div>
  );
}

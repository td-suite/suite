// Firmatari della circolare (v0.98.2): uno o più, scelti SOLO dall'elenco del personale (dipendenti e liberi professionisti attivi).
// Email, cellulare e indirizzo sono quelli di LAVORO dell'utente della Suite collegato (profilo utente e sede), mai i dati personali
// della scheda del dipendente; non si scrivono a mano: si correggono in Amministrazione > Utenti (o nel proprio profilo).
// I recapiti di ogni firmatario compaiono nel riquadro "Per informazioni" in fondo alla circolare.
import React, { useEffect, useState } from 'react';
import { Icon } from '../../components/Icons.jsx';

export default function Firmatari({ value, onChange, max = 6 }) {
  const lista = Array.isArray(value) ? value : [];
  const [persone, setPersone] = useState(null);
  useEffect(() => {
    let vivo = true;
    fetch('/api/circolari/personale-firmatari', { credentials: 'include' }).then((r) => (r.ok ? r.json() : [])).then((j) => { if (vivo) setPersone(Array.isArray(j) ? j : []); }).catch(() => vivo && setPersone([]));
    return () => { vivo = false; };
  }, []);
  const togli = (i) => onChange(lista.filter((_, n) => n !== i));
  const sposta = (i, d) => { const l = [...lista]; const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; onChange(l); };
  const scelti = new Set(lista.map((f) => f.person_id).filter(Boolean));
  const aggiungi = (id) => { const p = (persone || []).find((x) => String(x.person_id) === String(id)); if (p) onChange([...lista, { person_id: p.person_id, nome: p.nome, ruolo: p.ruolo, email: p.email, telefono: p.telefono, indirizzo: p.indirizzo }]); };
  const sostituisci = (i, id) => { const p = (persone || []).find((x) => String(x.person_id) === String(id)); if (p) onChange(lista.map((f, n) => (n === i ? { person_id: p.person_id, nome: p.nome, ruolo: p.ruolo, email: p.email, telefono: p.telefono, indirizzo: p.indirizzo } : f))); };
  const opzioni = (escludi) => (persone || []).filter((p) => !escludi.has(p.person_id)).map((p) => <option key={p.person_id} value={p.person_id}>{p.nome}{p.ruolo ? ` · ${p.ruolo}` : ''}{p.tipo === 'LP' ? ' (LP)' : ''}</option>);
  return (
    <div className="circ-firme">
      {lista.map((f, i) => {
        // i contatti mostrati sono quelli dell'anagrafica di adesso, se la persona è nell'elenco
        const p = (persone || []).find((x) => x.person_id === f.person_id);
        const d = p || f;
        return (
          <div key={i} className="circ-firma">
            <div className="circ-firma-dati">
              <div><b>{d.nome}</b>{d.ruolo ? <span className="muted"> · {d.ruolo}</span> : null}</div>
              {f.person_id ? (
                p && !p.utente ? <div className="small red">Nessun utente della Suite collegato a questa persona: firma con nome e ruolo, senza contatti.</div> : <>
                  <div className="small">{d.email || <span className="red">email mancante nel profilo utente</span>} · {d.telefono ? `Cell. ${d.telefono}` : <span className="red">cellulare mancante nel profilo utente</span>}</div>
                  <div className="small muted">{d.indirizzo || <span className="red">sede di lavoro senza indirizzo</span>}</div>
                </>
              ) : (
                <div className="small"><span className="red">Non collegato all'elenco del personale: i contatti non escono.</span> <select value="" onChange={(e) => sostituisci(i, e.target.value)} style={{ maxWidth: 280 }} aria-label={`Collega ${f.nome} al personale`}><option value="">Scegli dal personale…</option>{opzioni(scelti)}</select></div>
              )}
            </div>
            <div className="circ-firma-az">
              <button type="button" className="btn sm ghost" disabled={i === 0} onClick={() => sposta(i, -1)} title="Sposta prima" aria-label="Sposta prima"><Icon name="arrowUp" /></button>
              <button type="button" className="btn sm ghost" disabled={i === lista.length - 1} onClick={() => sposta(i, 1)} title="Sposta dopo" aria-label="Sposta dopo"><Icon name="arrowDown" /></button>
              <button type="button" className="btn sm ghost" onClick={() => togli(i)} title="Togli il firmatario" aria-label="Togli il firmatario"><Icon name="trash" /></button>
            </div>
          </div>
        );
      })}
      {!lista.length && <div className="small muted">Nessun firmatario: la circolare esce senza firma.</div>}
      {lista.length < max && (
        <select value="" onChange={(e) => aggiungi(e.target.value)} style={{ maxWidth: 420 }} aria-label="Aggiungi un firmatario dal personale">
          <option value="">{persone ? 'Aggiungi un firmatario dal personale…' : 'Carico il personale…'}</option>
          {opzioni(scelti)}
        </select>
      )}
    </div>
  );
}

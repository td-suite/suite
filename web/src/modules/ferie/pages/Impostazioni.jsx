// Impostazioni del Piano Ferie (HR): parametri generali, giorni annui per CCNL e livello, copertura minima per area o sede, chiusure
// collettive, aree forzate (solo per la visibilità del piano dell'area), santi patroni delle sedi, deleghe di approvazione a tempo, esecuzione
// del job giornaliero. Nessuna impostazione sceglie l'approvatore: è il superiore diretto dell'anagrafica (CEO, 09/11/2026).
import React, { useEffect, useState } from 'react';
import { api, useApi } from '../api.js';
import { Card, Loading, PageHead, Field, Tabs, Switch, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { itData, MESI, num, oggiIso } from '../format.js';

export default function Impostazioni() {
  const [tab, setTab] = useState('generali');
  const cat = useApi('/catalogo');
  return (
    <div className="page">
      <PageHead title="Impostazioni del Piano Ferie" icon="gear" sub="Valori di lavoro del modulo. Ogni modifica finisce nel registro delle attività della Suite." />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'generali', label: 'Generali' }, { value: 'spettanze', label: 'Giorni annui' }, { value: 'copertura', label: 'Copertura minima' }, { value: 'chiusure', label: 'Chiusure collettive' }, { value: 'aree', label: 'Aree (visibilità)' }, { value: 'patroni', label: 'Santi patroni' }, { value: 'deleghe', label: 'Deleghe' }]} />
      {!cat.data ? <Loading /> : (
        <>
          {tab === 'generali' && <Generali />}
          {tab === 'spettanze' && <Spettanze />}
          {tab === 'copertura' && <Copertura cat={cat.data} />}
          {tab === 'chiusure' && <Chiusure cat={cat.data} />}
          {tab === 'aree' && <AreeForzate cat={cat.data} />}
          {tab === 'patroni' && <Patroni cat={cat.data} />}
          {tab === 'deleghe' && <Deleghe />}
        </>
      )}
    </div>
  );
}

const useRun = () => {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn, ok, after) => { setBusy(true); try { const r = await fn(); if (ok) toast(ok); after?.(r); } catch (e) { toast(e, 'err'); } setBusy(false); };
  return [run, busy, toast];
};
const gruppoOpzioni = (cat, conTutte = false) => [
  ...(conTutte ? [{ v: 'TUTTE', l: 'Tutte le aree' }] : []), { v: 'DIR', l: 'Direzione' }, { v: 'LAB', l: 'Laboratorio' },
  ...cat.sedi.filter((s) => !['HEADQUARTER', 'LABORATORIO'].includes(s.kind)).map((s) => ({ v: `SEDE:${s.id}`, l: `Sede ${s.short_name || s.name}` })),
];

function Generali() {
  const { data, reload } = useApi('/impostazioni');
  const [f, setF] = useState(null);
  const [run, busy, toast] = useRun();
  useEffect(() => { if (data) setF({ ...data, festivi_aggiunti_txt: (data.festivi_aggiunti || []).map((x) => `${x.data} ${x.nome}`).join('\n'), festivi_esclusi_txt: (data.festivi_esclusi || []).join('\n') }); }, [data]);
  if (!f) return <Loading />;
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const salva = () => run(() => api.put('/impostazioni', {
    includi_dirigenti: f.includi_dirigenti, soglia_mese_giorni: Number(f.soglia_mese_giorni), scadenza_ap: f.scadenza_ap, mesi_rischio: f.mesi_rischio, soglia_rischio_giorni: Number(f.soglia_rischio_giorni),
    promemoria_giorni: Number(f.promemoria_giorni), email_attiva: f.email_attiva, festa_4_ottobre: f.festa_4_ottobre, rol_attivi: f.rol_attivi, avviso_dipendenti: f.avviso_dipendenti || '',
    festivi_aggiunti: f.festivi_aggiunti_txt.split('\n').map((x) => x.trim()).filter(Boolean).map((x) => ({ data: x.slice(0, 10), nome: x.slice(10).trim() || 'Festivo aziendale' })),
    festivi_esclusi: f.festivi_esclusi_txt.split('\n').map((x) => x.trim().slice(0, 10)).filter(Boolean),
    scadenze_piano: Object.fromEntries(Object.entries(f.scadenze_piano || {}).filter(([, v]) => v)), promemoria_scadenza_giorni: Number(f.promemoria_scadenza_giorni ?? 7),
  }), 'Impostazioni salvate', reload);
  const anno0 = Number(oggiIso().slice(0, 4));
  const sw = (k, l, help) => <div className="fe-sw"><Switch checked={f[k]} onChange={(v) => set(k, v)} label={l} /><div><div className="strong small">{l}</div>{help && <div className="small muted">{help}</div>}</div></div>;
  return (
    <div className="fe-two">
      <Card title="Piano annuale" icon="calendar">
        <div className="fe-form">
          <p className="small">Ogni dipendente compila il proprio piano dell'anno e lo invia al suo superiore diretto in anagrafica ("Dipende da" in Amministrazione &gt; Persone), che lo modifica, lo approva e lo rende definitivo; chi è al vertice non ha approvazione. Qui la data entro cui i dipendenti devono inviarlo: il job manda i promemoria a chi ha ancora il piano in bozza e il Cockpit la mostra nello scadenzario.</p>
          {[anno0, anno0 + 1].map((a) => <Field key={a} label={`Scadenza di invio del piano ${a}`} help="Vuota = nessuna scadenza"><input type="date" value={(f.scadenze_piano || {})[a] || ''} onChange={(e) => set('scadenze_piano', { ...(f.scadenze_piano || {}), [a]: e.target.value })} /></Field>)}
          <Field label="Promemoria da quanti giorni prima della scadenza"><input type="number" min="0" max="60" value={f.promemoria_scadenza_giorni ?? 7} onChange={(e) => set('promemoria_scadenza_giorni', e.target.value)} /></Field>
        </div>
      </Card>
      <Card title="Perimetro e maturazione" icon="users">
        <div className="fe-form">
          {sw('includi_dirigenti', 'Includi i dirigenti con contratto subordinato', 'Persone di tipo DIRIGENTE con contratto in Contratti del personale. I liberi professionisti restano sempre fuori.')}
          <Field label="Giorni del mese per contarlo come lavorato" help="Maturazione pro rata: un mese conta se il rapporto ne copre almeno questi giorni (ipotesi 15, da verificare con il consulente)."><input type="number" min="1" max="31" value={f.soglia_mese_giorni} onChange={(e) => set('soglia_mese_giorni', e.target.value)} /></Field>
          {sw('rol_attivi', 'Voce ROL e permessi in ore', 'Facoltativa: ore annue per CCNL e livello in "Giorni annui", residuo dell\'anno precedente nel saldo.')}
          <Field label="Avviso ai dipendenti (sopra il loro piano)"><textarea rows={3} maxLength={2000} value={f.avviso_dipendenti || ''} onChange={(e) => set('avviso_dipendenti', e.target.value)} /></Field>
        </div>
      </Card>
      <Card title="Avvisi e promemoria" icon="bell">
        <div className="fe-form">
          <Field label="Scadenza del residuo dell'anno precedente (MM-GG)" help="Predefinita 06-30, come indicato dal CEO. Verificare la regola con il consulente del lavoro (vedi Guida)."><input value={f.scadenza_ap} onChange={(e) => set('scadenza_ap', e.target.value)} maxLength={5} /></Field>
          <Field label="Mesi di controllo dei residui a rischio"><div className="fe-mesi">{MESI.map((m, i) => <label key={m} className="fe-check"><input type="checkbox" checked={(f.mesi_rischio || []).includes(i + 1)} onChange={(e) => set('mesi_rischio', e.target.checked ? [...(f.mesi_rischio || []), i + 1].sort((a, b) => a - b) : (f.mesi_rischio || []).filter((x) => x !== i + 1))} />{m.slice(0, 3)}</label>)}</div></Field>
          <Field label="Giorni non pianificati da cui scatta l'avviso"><input type="number" min="0" max="60" value={f.soglia_rischio_giorni} onChange={(e) => set('soglia_rischio_giorni', e.target.value)} /></Field>
          <Field label="Promemoria al responsabile dopo (giorni di attesa di un piano inviato o di una variazione)"><input type="number" min="1" max="60" value={f.promemoria_giorni} onChange={(e) => set('promemoria_giorni', e.target.value)} /></Field>
          {sw('email_attiva', 'Email oltre alla notifica in app', 'Con il mittente della Suite, agli utenti con email e avvisi email attivi. Spenta finché HR non decide.')}
        </div>
      </Card>
      <Card title="Calendario" icon="calendar">
        <div className="fe-form">
          {sw('festa_4_ottobre', '4 ottobre festa nazionale (dal 2026)', 'San Francesco d\'Assisi e Santa Caterina da Siena. Spegnere solo su indicazione del consulente.')}
          <Field label="Festivi aziendali aggiunti" help="Una riga per giorno: AAAA-MM-GG e nome"><textarea rows={3} value={f.festivi_aggiunti_txt} onChange={(e) => set('festivi_aggiunti_txt', e.target.value)} placeholder="2026-12-24 Vigilia (accordo aziendale)" /></Field>
          <Field label="Date da non considerare festive" help="Una per riga: AAAA-MM-GG"><textarea rows={2} value={f.festivi_esclusi_txt} onChange={(e) => set('festivi_esclusi_txt', e.target.value)} /></Field>
          <details className="small"><summary>Festivi nazionali {data.anno}</summary><ul className="fe-fest">{data.festivi_nazionali.map((x) => <li key={x.data}>{itData(x.data)} · {x.nome}</li>)}</ul></details>
        </div>
      </Card>
      <Card title="Lavoro giornaliero" icon="refresh">
        <p className="small">Una volta al giorno il job <code>ferie:promemoria</code> passa a Goduti i periodi approvati conclusi, ricorda ai dipendenti di inviare il piano entro la scadenza e ai responsabili i piani e le variazioni in attesa da più di {f.promemoria_giorni} giorni.</p>
        <div className="row"><button className="btn primary" disabled={busy} onClick={salva}><Icon name="check" />Salva le impostazioni</button>
          <button className="btn ghost" disabled={busy} onClick={() => run(() => api.post('/admin/job'), null, (r) => toast(`Job eseguito: ${r.godute} goduti, ${r.promemoria_piani_non_inviati} promemoria di invio, ${r.promemoria_piani_da_approvare} piani e ${r.promemoria} variazioni ricordati ai responsabili`))}><Icon name="refresh" />Esegui ora il job</button></div>
      </Card>
    </div>
  );
}

function Spettanze() {
  const { data, reload } = useApi('/spettanze');
  const [f, setF] = useState({ ccnl: '*', level: '*', giorni_annui: '', rol_ore_annue: '', note: '' });
  const [run, busy] = useRun();
  if (!data) return <Loading />;
  return (
    <div className="fe-two">
      <Card title="Giorni di ferie annui per CCNL e livello" icon="list" flush>
        <div className="table-wrap"><table className="t fe-table"><thead><tr><th>CCNL</th><th>Livello</th><th className="num">Giorni</th><th className="num">ROL (ore)</th><th>Note</th><th /></tr></thead>
          <tbody>{data.righe.map((r) => <tr key={`${r.ccnl}:${r.level}`}><td>{r.ccnl === '*' ? 'Qualunque' : r.ccnl}</td><td>{r.level === '*' ? 'Qualunque' : r.level}</td><td className="num strong">{num(r.giorni_annui)}</td><td className="num">{r.rol_ore_annue == null ? '-' : num(r.rol_ore_annue)}</td><td className="small">{r.note}</td>
            <td className="row tight"><button className="btn ghost sm" onClick={() => setF({ ...r, rol_ore_annue: r.rol_ore_annue ?? '', note: r.note || '' })}><Icon name="edit" /></button>{!(r.ccnl === '*' && r.level === '*') && <button className="btn ghost sm" disabled={busy} onClick={() => run(() => api.del(`/spettanze/${encodeURIComponent(r.ccnl)}/${encodeURIComponent(r.level)}`), 'Riga eliminata', reload)}><Icon name="trash" /></button>}</td></tr>)}</tbody></table></div>
        <div className="small muted" style={{ padding: 12 }}>Vale la riga più specifica (CCNL e livello, poi CCNL, poi la riga generale). Il contratto di lavoro non ha un campo ferie: i 26 giorni della riga generale sono un'ipotesi da verificare sul testo del CCNL (spesso riferiti alla settimana di 6 giorni).</div>
      </Card>
      <Card title="Aggiungi o modifica" icon="edit">
        <div className="fe-form">
          <div className="two"><Field label="CCNL" help="* = qualunque"><input value={f.ccnl} onChange={(e) => setF({ ...f, ccnl: e.target.value })} list="fe-ccnl" /></Field><Field label="Livello" help="* = qualunque"><input value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} /></Field></div>
          <datalist id="fe-ccnl">{[...new Set(data.combinazioni.map((c) => c.ccnl))].map((c) => <option key={c} value={c} />)}</datalist>
          <div className="two"><Field label="Giorni annui"><input type="number" min="0" max="60" step="0.5" value={f.giorni_annui} onChange={(e) => setF({ ...f, giorni_annui: e.target.value })} /></Field><Field label="ROL ore annue (facoltativo)"><input type="number" min="0" max="400" step="0.5" value={f.rol_ore_annue} onChange={(e) => setF({ ...f, rol_ore_annue: e.target.value })} /></Field></div>
          <Field label="Note (fonte del valore)"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} /></Field>
          <button className="btn primary" disabled={busy || f.giorni_annui === ''} onClick={() => run(() => api.put('/spettanze', { ...f, giorni_annui: Number(f.giorni_annui), rol_ore_annue: f.rol_ore_annue === '' ? null : Number(f.rol_ore_annue) }), 'Salvato', reload)}><Icon name="check" />Salva</button>
          {data.combinazioni.length > 0 && <div className="small muted">Contratti presenti: {data.combinazioni.map((c) => `${c.ccnl} liv. ${c.level} (${c.persone})`).join(', ')}</div>}
        </div>
      </Card>
    </div>
  );
}

function Copertura({ cat }) {
  const { data, reload } = useApi('/coperture');
  const [f, setF] = useState({ ambito: 'KIND:PUNTO_PRELIEVI', role_id: '', minimo: 1, note: '' });
  const [run, busy] = useRun();
  if (!data) return <Loading />;
  const ambiti = [...gruppoOpzioni(cat), ...cat.tipi_sede.filter((t) => !['HEADQUARTER', 'LABORATORIO'].includes(t.key)).map((t) => ({ v: `KIND:${t.key}`, l: `Ogni sede di tipo ${t.label.toLowerCase()}` }))];
  return (
    <div className="fe-two">
      <Card title="Regole di copertura minima" icon="shield" flush>
        {!data.length ? <div className="small muted" style={{ padding: 12 }}>Nessuna regola: nessun avviso di copertura.</div> : (
          <div className="table-wrap"><table className="t fe-table"><thead><tr><th>Ambito</th><th>Ruolo</th><th className="num">Minimo presenti</th><th>Note</th><th /></tr></thead>
            <tbody>{data.map((c) => <tr key={c.id}><td>{c.ambito_nome}</td><td>{c.role_name || 'Qualunque ruolo'}</td><td className="num strong">{c.minimo}</td><td className="small">{c.note}</td><td><button className="btn ghost sm" disabled={busy} onClick={() => run(() => api.del(`/coperture/${c.id}`), 'Regola eliminata', reload)}><Icon name="trash" /></button></td></tr>)}</tbody></table></div>)}
        <div className="small muted" style={{ padding: 12 }}>Un periodo che fa scendere un giorno sotto il minimo non viene bloccato: nel piano dell'area il giorno è rosso e il responsabile vede l'avviso. Contano i dipendenti del perimetro della stessa area o sede; il ruolo è quello della scheda persona o di un incarico nell'organigramma.</div>
      </Card>
      <Card title="Nuova regola" icon="plus">
        <div className="fe-form">
          <Field label="Ambito"><select value={f.ambito} onChange={(e) => setF({ ...f, ambito: e.target.value })}>{ambiti.map((a) => <option key={a.v} value={a.v}>{a.l}</option>)}</select></Field>
          <Field label="Ruolo"><select value={f.role_id} onChange={(e) => setF({ ...f, role_id: e.target.value })}><option value="">Qualunque ruolo</option>{cat.ruoli.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
          <Field label="Minimo di presenti al giorno"><input type="number" min="1" max="99" value={f.minimo} onChange={(e) => setF({ ...f, minimo: e.target.value })} /></Field>
          <Field label="Note"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} /></Field>
          <button className="btn primary" disabled={busy} onClick={() => run(() => api.post('/coperture', { ...f, role_id: f.role_id ? Number(f.role_id) : null, minimo: Number(f.minimo) }), 'Regola aggiunta', reload)}><Icon name="plus" />Aggiungi</button>
        </div>
      </Card>
    </div>
  );
}

function Chiusure({ cat }) {
  const anno0 = Number(oggiIso().slice(0, 4));
  const [anno, setAnno] = useState(anno0);
  const { data, reload } = useApi(`/chiusure?anno=${anno}`, [anno]);
  const [f, setF] = useState({ gruppo: 'TUTTE', data_inizio: '', data_fine: '', descrizione: '' });
  const [run, busy] = useRun();
  return (
    <div className="fe-two">
      <Card title="Chiusure collettive" icon="building" flush actions={<select value={anno} onChange={(e) => setAnno(Number(e.target.value))} aria-label="Anno">{[anno0 - 1, anno0, anno0 + 1].map((a) => <option key={a}>{a}</option>)}</select>}>
        {!data ? <Loading /> : !data.length ? <div className="small muted" style={{ padding: 12 }}>Nessuna chiusura nell'anno.</div> : (
          <div className="table-wrap"><table className="t fe-table"><thead><tr><th>Area</th><th>Dal</th><th>Al</th><th>Descrizione</th><th /></tr></thead>
            <tbody>{data.map((c) => <tr key={c.id}><td>{c.gruppo_nome}</td><td>{itData(c.data_inizio)}</td><td>{itData(c.data_fine)}</td><td className="small">{c.descrizione}</td><td><button className="btn ghost sm" disabled={busy} onClick={() => run(() => api.del(`/chiusure/${c.id}`), 'Chiusura eliminata', reload)}><Icon name="trash" /></button></td></tr>)}</tbody></table></div>)}
        <div className="small muted" style={{ padding: 12 }}>Le chiusure sono proposte ai dipendenti dell'area nel loro piano ("Aggiungi al piano") e compaiono nel piano dell'area. Non creano periodi da sole.</div>
      </Card>
      <Card title="Nuova chiusura" icon="plus">
        <div className="fe-form">
          <Field label="Area"><select value={f.gruppo} onChange={(e) => setF({ ...f, gruppo: e.target.value })}>{gruppoOpzioni(cat, true).map((a) => <option key={a.v} value={a.v}>{a.l}</option>)}</select></Field>
          <div className="two"><Field label="Dal"><input type="date" value={f.data_inizio} onChange={(e) => setF({ ...f, data_inizio: e.target.value, data_fine: f.data_fine || e.target.value })} /></Field><Field label="Al"><input type="date" value={f.data_fine} onChange={(e) => setF({ ...f, data_fine: e.target.value })} /></Field></div>
          <Field label="Descrizione"><input value={f.descrizione} onChange={(e) => setF({ ...f, descrizione: e.target.value })} maxLength={200} /></Field>
          <button className="btn primary" disabled={busy || !f.data_inizio || !f.data_fine} onClick={() => run(() => api.post('/chiusure', f), 'Chiusura aggiunta', reload)}><Icon name="plus" />Aggiungi</button>
        </div>
      </Card>
    </div>
  );
}

function AreeForzate({ cat }) {
  const { data, reload } = useApi('/aree-forzate');
  const persone = useApi('/persone');
  const [f, setF] = useState({ person_id: '', gruppo: 'DIR', note: '' });
  const [run, busy] = useRun();
  return (
    <div className="fe-two">
      <Card title="Area di ogni persona" icon="tree" flush>
        <div className="small muted" style={{ padding: '10px 12px 0' }}>L'area decide solo chi vede il piano dell'area (trasparenza interna all'area). Chi approva non si sceglie qui: è il superiore diretto in anagrafica ("Dipende da" in Amministrazione &gt; Persone), letto così com'è.</div>
        {!persone.data ? <Loading /> : (
          <div className="table-wrap"><table className="t fe-table"><thead><tr><th>Persona</th><th>Area</th><th>Da dove</th><th>Approva (dall'anagrafica)</th></tr></thead>
            <tbody>{persone.data.rows.map((p) => <tr key={p.id} className={p.gruppo === 'DA_ASSEGNARE' || p.senza_superiore ? 'fe-row-warn' : ''}><td className="strong">{p.nome}</td><td>{p.gruppo_nome}</td><td className="small muted">{p.area_origine}</td><td className="small">{p.approvatore || 'amministratore'}{p.approvatore_origine && <span className="muted"> ({p.approvatore_origine})</span>}</td></tr>)}</tbody></table></div>)}
      </Card>
      <div className="grid">
        <Card title="Forza l'area di una persona (solo visibilità)" icon="edit">
          <div className="fe-form">
            <Field label="Persona"><select value={f.person_id} onChange={(e) => setF({ ...f, person_id: e.target.value })}><option value="">Scegli</option>{(persone.data?.rows || []).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></Field>
            <Field label="Area"><select value={f.gruppo} onChange={(e) => setF({ ...f, gruppo: e.target.value })}>{gruppoOpzioni(cat).map((a) => <option key={a.v} value={a.v}>{a.l}</option>)}</select></Field>
            <Field label="Motivo"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} /></Field>
            <button className="btn primary" disabled={busy || !f.person_id} onClick={() => run(() => api.put(`/aree-forzate/${f.person_id}`, { gruppo: f.gruppo, note: f.note }), 'Area forzata', () => { reload(); persone.reload(); })}><Icon name="check" />Salva</button>
          </div>
        </Card>
        <Card title="Forzature attive" icon="list">
          {!data?.length ? <div className="small muted">Nessuna: le aree vengono tutte dall'organigramma.</div> : <ul className="fe-list">{data.map((x) => <li key={x.person_id}><div><div className="strong">{x.persona}</div><div className="small muted">{x.gruppo_nome}{x.note ? ` · ${x.note}` : ''}</div></div><button className="btn ghost sm" disabled={busy} onClick={() => run(() => api.del(`/aree-forzate/${x.person_id}`), 'Forzatura tolta', () => { reload(); persone.reload(); })}><Icon name="trash" /></button></li>)}</ul>}
        </Card>
      </div>
    </div>
  );
}

function Patroni({ cat }) {
  const { data, reload } = useApi('/patroni');
  const [f, setF] = useState({ site_id: '', giorno: '', santo: '' });
  const [run, busy] = useRun();
  return (
    <div className="fe-two">
      <Card title="Santo patrono per sede" icon="calendar" flush>
        {!data?.length ? <div className="small muted" style={{ padding: 12 }}>Nessun patrono impostato: contano solo i festivi nazionali.</div> : (
          <div className="table-wrap"><table className="t fe-table"><thead><tr><th>Sede</th><th>Giorno</th><th>Santo</th><th /></tr></thead>
            <tbody>{data.map((p) => <tr key={p.site_id}><td>{p.sede}<div className="small muted">{p.city}</div></td><td>{p.giorno.slice(3, 5)}/{p.giorno.slice(0, 2)}</td><td>{p.santo}</td><td><button className="btn ghost sm" disabled={busy} onClick={() => run(() => api.del(`/patroni/${p.site_id}`), 'Patrono tolto', reload)}><Icon name="trash" /></button></td></tr>)}</tbody></table></div>)}
        <div className="small muted" style={{ padding: 12 }}>Il giorno del patrono del comune della sede è festivo per chi ci lavora. Nessun valore è precompilato: inseriscilo per ogni sede.</div>
      </Card>
      <Card title="Imposta il patrono" icon="edit">
        <div className="fe-form">
          <Field label="Sede"><select value={f.site_id} onChange={(e) => setF({ ...f, site_id: e.target.value })}><option value="">Scegli</option>{cat.sedi.map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` (${s.city})` : ''}</option>)}</select></Field>
          <Field label="Giorno"><input type="date" value={f.giorno ? `2000-${f.giorno}` : ''} onChange={(e) => setF({ ...f, giorno: e.target.value.slice(5, 10) })} /></Field>
          <Field label="Santo"><input value={f.santo} onChange={(e) => setF({ ...f, santo: e.target.value })} maxLength={80} /></Field>
          <button className="btn primary" disabled={busy || !f.site_id || !f.giorno} onClick={() => run(() => api.put(`/patroni/${f.site_id}`, { giorno: f.giorno, santo: f.santo }), 'Patrono salvato', reload)}><Icon name="check" />Salva</button>
        </div>
      </Card>
    </div>
  );
}

function Deleghe() {
  const { data, reload } = useApi('/deleghe');
  const persone = useApi('/delegabili');
  const [f, setF] = useState({ delegante_person_id: '', delegato_person_id: '', dal: '', al: '', note: '' });
  const [run, busy] = useRun();
  return (
    <div className="fe-two">
      <Card title="Deleghe di approvazione in corso e future" icon="users" flush>
        {!data?.length ? <div className="small muted" style={{ padding: 12 }}>Nessuna delega.</div> : (
          <div className="table-wrap"><table className="t fe-table"><thead><tr><th>Delegante</th><th>Delegato</th><th>Dal</th><th>Al</th><th /></tr></thead>
            <tbody>{data.map((d) => <tr key={d.id}><td>{d.delegante}</td><td>{d.delegato}</td><td>{itData(d.dal)}</td><td>{itData(d.al)}</td><td><button className="btn ghost sm" disabled={busy} onClick={() => run(() => api.del(`/deleghe/${d.id}`), 'Delega eliminata', reload)}><Icon name="trash" /></button></td></tr>)}</tbody></table></div>)}
        <div className="small muted" style={{ padding: 12 }}>Durante la delega il delegato riceve i piani e le variazioni dei diretti del delegante (chi ha il delegante come superiore in anagrafica), con i promemoria, e può modificarli e approvarli. L'amministratore interviene sempre.</div>
      </Card>
      <Card title="Nuova delega" icon="plus">
        <div className="fe-form">
          <Field label="Delegante (responsabile)"><select value={f.delegante_person_id} onChange={(e) => setF({ ...f, delegante_person_id: e.target.value })}><option value="">Scegli</option>{(persone.data || []).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></Field>
          <Field label="Delegato"><select value={f.delegato_person_id} onChange={(e) => setF({ ...f, delegato_person_id: e.target.value })}><option value="">Scegli</option>{(persone.data || []).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></Field>
          <div className="two"><Field label="Dal"><input type="date" value={f.dal} onChange={(e) => setF({ ...f, dal: e.target.value })} /></Field><Field label="Al"><input type="date" value={f.al} onChange={(e) => setF({ ...f, al: e.target.value })} /></Field></div>
          <button className="btn primary" disabled={busy || !f.delegante_person_id || !f.delegato_person_id || !f.dal || !f.al} onClick={() => run(() => api.post('/deleghe', { ...f, delegante_person_id: Number(f.delegante_person_id), delegato_person_id: Number(f.delegato_person_id) }), 'Delega creata', reload)}><Icon name="plus" />Crea</button>
        </div>
      </Card>
    </div>
  );
}

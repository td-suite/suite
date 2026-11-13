// Componenti del Rimborso Spese: stato, modulistica cartacea, foto dei giustificativi (fotocamera del telefono, compressione nel browser),
// finestre "Nuova spesa" e "Nuovo viaggio" (anche nella forma rapida per il telefono), riepilogo come nei moduli MOD025 e MOD029, storico.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Modal, Field, ErrorBox } from '../../components/ui.jsx';
import { Icon } from '../../components/Icons.jsx';
import { api, apiBase, useApi } from './api.js';
import { useAuth } from './auth.jsx';
import { STATO, METODI, EVENTO, eur, num, km, tariffa, itData, itDataOra, oggiIso, kb, saldoTesto } from './format.js';

export const StatoBadge = ({ stato }) => <Badge tone={STATO[stato]?.tone || 'grey'}>{STATO[stato]?.label || stato}</Badge>;

// ------------------------------------------------------------------ modulistica cartacea (TD-SGI-MOD025 e MOD029, rev. 00 del 12/04/2026)
export function ModuliCartacei({ compatto = false }) {
  const { state } = useAuth();
  const moduli = state?.moduli_cartacei || [];
  if (!moduli.length) return null;
  return (
    <div className={`rs-moduli ${compatto ? 'compatto' : ''}`}>
      {moduli.map((m) => (
        <div key={m.key} className="rs-modulo">
          <a className="btn ghost sm" href={m.url} download><Icon name="download" />Scarica il modulo cartaceo {m.key}</a>
          <span className="small muted">{m.codice} rev. {m.revisione} del {itData(m.data)} · {state.rif_procedura}{m.sgi && <> · <a href={m.sgi}>scheda nel SGI Management</a></>}</span>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ foto: compressione nel browser (lato lungo 1600 px, JPEG)
export async function comprimiFoto(file, { lato = 1600, qualita = 0.82 } = {}) {
  if (!file || !/^image\//.test(file.type) || /gif|svg/.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const s = Math.min(1, lato / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', qualita));
    if (!blob || (blob.size >= file.size && s === 1 && file.type === 'image/jpeg')) return file;
    return new File([blob], `${String(file.name || 'foto').replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
  } catch { return file; }   // formato non decodificabile dal browser (es. HEIC su alcuni telefoni): si carica l'originale
}

/** Scelta dei giustificativi: "Scatta la foto" (fotocamera posteriore) e "Carica file" (galleria o PDF), con anteprima */
export function FotoScelta({ files, setFiles, obbligatorio }) {
  const anteprime = useMemo(() => files.map((f) => ({ f, url: /^image\//.test(f.type) ? URL.createObjectURL(f) : null })), [files]);
  useEffect(() => () => anteprime.forEach((a) => a.url && URL.revokeObjectURL(a.url)), [anteprime]);
  const [lavoro, setLavoro] = useState(false);
  const aggiungi = async (lista) => {
    setLavoro(true);
    try { const out = []; for (const f of lista) out.push(await comprimiFoto(f)); setFiles((x) => [...x, ...out].slice(0, 6)); } finally { setLavoro(false); }
  };
  return (
    <div className="rs-foto">
      <div className="rs-foto-btn">
        <label className="btn lg">
          <Icon name="image" />Scatta la foto
          <input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => { aggiungi([...e.target.files]); e.target.value = ''; }} hidden />
        </label>
        <label className="btn ghost lg">
          <Icon name="upload" />Carica file
          <input type="file" accept="image/*,application/pdf" multiple onChange={(e) => { aggiungi([...e.target.files]); e.target.value = ''; }} hidden />
        </label>
      </div>
      {lavoro && <div className="small muted">Preparo la foto…</div>}
      {anteprime.length > 0 && <div className="rs-thumbs">{anteprime.map((a, i) => (
        <div key={i} className="rs-thumb">
          {a.url ? <img src={a.url} alt={a.f.name} /> : <div className="rs-pdf"><Icon name="pdf" /></div>}
          <div className="small ellipsis">{a.f.name} · {kb(a.f.size)}</div>
          <button type="button" className="iconbtn" aria-label="Togli" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}><Icon name="x" /></button>
        </div>))}</div>}
      {obbligatorio != null && <div className={`small ${obbligatorio ? 'rs-warn' : 'muted'}`}>{obbligatorio ? 'Giustificativo obbligatorio: senza la foto dello scontrino la spesa non si può inviare.' : 'Per te il giustificativo è facoltativo (eccezione stabilita dalla direzione): allegalo comunque se ce l\'hai.'}</div>}
    </div>
  );
}

/** Giustificativi già salvati di una riga: miniature cliccabili (anteprima in linea), eliminazione solo in bozza */
export function Allegati({ allegati, modificabile, onElimina }) {
  if (!allegati?.length) return null;
  return (
    <div className="rs-thumbs">
      {allegati.map((a) => (
        <div key={a.id} className="rs-thumb">
          <a href={`${apiBase}/allegati/${a.id}?inline=1`} target="_blank" rel="noreferrer" title={`${a.filename} · ${kb(a.size)} · ${itDataOra(a.caricato_at)}`}>
            {/^image\/(jpeg|png|webp)/.test(a.mime || '') ? <img src={`${apiBase}/allegati/${a.id}?inline=1`} alt={a.filename} loading="lazy" /> : <div className="rs-pdf"><Icon name={a.mime === 'application/pdf' ? 'pdf' : 'file'} /></div>}
          </a>
          <div className="small ellipsis">{a.filename}</div>
          {modificabile && <button type="button" className="iconbtn" aria-label="Elimina il giustificativo" onClick={() => onElimina(a)}><Icon name="trash" /></button>}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Legal entity (cliente o progetto collegabile)
export function LegalEntity({ value, nome, onChange }) {
  const [q, setQ] = useState(nome || '');
  const [lista, setLista] = useState([]);
  const [aperto, setAperto] = useState(false);
  useEffect(() => {
    if (!aperto || q.trim().length < 2) { setLista([]); return undefined; }
    const t = setTimeout(() => api.get(`/legal-entity?q=${encodeURIComponent(q.trim())}`, { silent: true }).then(setLista).catch(() => setLista([])), 200);
    return () => clearTimeout(t);
  }, [q, aperto]);
  return (
    <div className="rs-le">
      <input value={q} placeholder="Cerca la Legal entity (facoltativo)" onFocus={() => setAperto(true)} onChange={(e) => { setQ(e.target.value); setAperto(true); if (!e.target.value) onChange(null, ''); }} />
      {value && <button type="button" className="iconbtn" aria-label="Togli il cliente" onClick={() => { setQ(''); onChange(null, ''); }}><Icon name="x" /></button>}
      {aperto && lista.length > 0 && <div className="rs-le-pop">{lista.map((o) => <button type="button" key={o.id} onClick={() => { setQ(o.name); setAperto(false); onChange(o.id, o.name); }}>{o.name}<span className="small muted">{o.city || ''}</span></button>)}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ finestra della spesa (completa o rapida dal telefono)
const nuovaSpesa = (data) => ({ data: data || oggiIso(), descrizione: '', categoria_id: '', importo: '', metodo: 'DIPENDENTE', fuel_card_id: '', motivazione: '', cliente_org_id: null, cliente: '', progetto: '', viaggio_id: '' });
export function SpesaModal({ spesa, nota, scheda, rapida = false, categorie, fuelCard = [], eccezione, onClose, onSalvata }) {
  const [v, setV] = useState(() => (spesa ? { ...nuovaSpesa(), ...spesa, importo: num(spesa.importo).replace(/\./g, ''), cliente: spesa.cliente || '', fuel_card_id: spesa.fuel_card_id || '', viaggio_id: spesa.viaggio_id || '' } : nuovaSpesa(nota && !rapida ? limiteData(nota) : oggiIso())));
  const [files, setFiles] = useState([]);
  const [altro, setAltro] = useState(!rapida);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const s = (k, x) => setV((o) => ({ ...o, [k]: x }));
  const cat = (categorie || []).filter((c) => c.attiva || c.id === v.categoria_id);
  const catSel = cat.find((c) => String(c.id) === String(v.categoria_id));
  const fcAttive = fuelCard.filter((f) => f.in_corso);
  const obbl = catSel ? (catSel.giustificativo_obbligatorio && !eccezione) : null;
  const salva = async (e) => {
    e?.preventDefault(); setBusy(true); setErr(null);
    try {
      const corpo = { data: v.data, descrizione: v.descrizione, categoria_id: v.categoria_id, importo: v.importo, metodo: v.metodo, fuel_card_id: v.metodo === 'FUEL_CARD' ? v.fuel_card_id : null,
        motivazione: v.motivazione, cliente_org_id: v.cliente_org_id, progetto: v.progetto, viaggio_id: v.viaggio_id || null };
      if (rapida) {
        const fd = new FormData();
        for (const [k, x] of Object.entries(corpo)) if (x != null && x !== '') fd.append(k, x);
        for (const f of files) fd.append('file', f);
        const r = await api.upload('/spesa-rapida', fd);
        onSalvata(r);
      } else {
        const r = spesa ? await api.put(`/note/${nota.id}/spese/${spesa.id}`, corpo) : await api.post(`/note/${nota.id}/spese`, corpo);
        const id = spesa?.id || r.id;
        if (files.length) { const fd = new FormData(); fd.append('riga_tipo', 'SPESA'); fd.append('riga_id', String(id)); for (const f of files) fd.append('file', f); await api.upload(`/note/${nota.id}/allegati`, fd); }
        onSalvata(r);
      }
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  const viaggi = scheda?.viaggi || [];
  return (
    <Modal title={spesa ? 'Modifica spesa' : 'Nuova spesa'} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy || !v.importo || !v.categoria_id || (!rapida && v.descrizione.trim().length < 2)} onClick={salva}><Icon name="check" />Salva la spesa</button></>}>
      <ErrorBox error={err} />
      <form className="rs-form" onSubmit={salva}>
        <FotoScelta files={files} setFiles={setFiles} obbligatorio={obbl} />
        {spesa?.allegati?.length > 0 && <div className="small muted">Già allegati: {spesa.allegati.length}</div>}
        <div className="rs-tre">
          <Field label="Importo (EUR)" required><input inputMode="decimal" autoComplete="off" value={v.importo} placeholder="0,00" onChange={(e) => s('importo', e.target.value.replace(/[^\d,.]/g, ''))} /></Field>
          <Field label="Categoria" required><select value={v.categoria_id} onChange={(e) => s('categoria_id', e.target.value)}><option value="">Scegli</option>{cat.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select></Field>
          <Field label="Data" required><input type="date" value={v.data} max={oggiIso()} onChange={(e) => s('data', e.target.value)} /></Field>
        </div>
        <Field label={rapida ? 'Descrizione (facoltativa: altrimenti la categoria)' : 'Descrizione'} required={!rapida}><input value={v.descrizione} maxLength={300} placeholder="es. Pranzo con il cliente" onChange={(e) => s('descrizione', e.target.value)} /></Field>
        {!altro && <button type="button" className="btn link" onClick={() => setAltro(true)}><Icon name="plus" />Altri dettagli (motivazione, pagamento, cliente)</button>}
        {altro && <>
          <Field label="Motivazione / trasferta" help="Se manca vale la motivazione generale della nota"><input value={v.motivazione || ''} maxLength={500} onChange={(e) => s('motivazione', e.target.value)} /></Field>
          <div className="rs-due">
            <Field label="Pagamento"><select value={v.metodo} onChange={(e) => s('metodo', e.target.value)}>
              <option value="DIPENDENTE">{METODI.DIPENDENTE} (rimborsabile)</option><option value="CARTA_AZIENDALE">{METODI.CARTA_AZIENDALE} (non rimborsabile)</option>
              {fcAttive.length > 0 && <option value="FUEL_CARD">{METODI.FUEL_CARD} (non rimborsabile)</option>}</select></Field>
            {v.metodo === 'FUEL_CARD' && <Field label="Fuel card" required><select value={v.fuel_card_id} onChange={(e) => s('fuel_card_id', e.target.value)}><option value="">Scegli</option>{fcAttive.map((f) => <option key={f.id} value={f.id}>{f.circuito} {f.numero}</option>)}</select></Field>}
          </div>
          <div className="rs-due">
            <Field label="Cliente (Legal entity)"><LegalEntity value={v.cliente_org_id} nome={v.cliente} onChange={(id, n) => setV((o) => ({ ...o, cliente_org_id: id, cliente: n }))} /></Field>
            <Field label="Progetto"><input value={v.progetto || ''} maxLength={200} onChange={(e) => s('progetto', e.target.value)} /></Field>
          </div>
          {catSel && ['PEDAGGIO', 'PARCHEGGIO'].includes(catSel.tipo) && viaggi.length > 0 && <Field label="Viaggio collegato"><select value={v.viaggio_id} onChange={(e) => s('viaggio_id', e.target.value)}><option value="">Nessuno</option>{viaggi.map((x) => <option key={x.id} value={x.id}>{itData(x.data)} {x.partenza} - {x.arrivo}</option>)}</select></Field>}
        </>}
        {catSel && (catSel.massimale_spesa || catSel.massimale_giorno) && <div className="small muted">Massimali di {catSel.nome}: {[catSel.massimale_spesa && `${eur(catSel.massimale_spesa)} per spesa`, catSel.massimale_giorno && `${eur(catSel.massimale_giorno)} al giorno`].filter(Boolean).join(', ')}</div>}
      </form>
    </Modal>
  );
}
// data predefinita di una nuova riga: oggi se è nel mese della nota, altrimenti l'ultimo giorno del mese
function limiteData(nota) {
  const o = oggiIso();
  const pref = `${nota.anno}-${String(nota.mese).padStart(2, '0')}`;
  if (o.startsWith(pref)) return o;
  return `${pref}-${String(new Date(Date.UTC(nota.anno, nota.mese, 0)).getUTCDate()).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ finestra del viaggio
export function ViaggioModal({ viaggio, nota, veicoli = [], vettura, tariffaDefault, onClose, onSalvata }) {
  const [v, setV] = useState(() => (viaggio ? { ...viaggio, km: String(viaggio.km).replace('.', ','), veicolo_id: viaggio.veicolo_id || '' } : { data: nota ? limiteData(nota) : oggiIso(), partenza: '', arrivo: '', andata_ritorno: true, km: '', motivazione: '', veicolo_tipo: vettura ? 'AZIENDALE' : 'PROPRIO', veicolo_id: veicoli.find((x) => x.attivo)?.id || '', vettura_id: vettura?.id || null }));
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const s = (k, x) => setV((o) => ({ ...o, [k]: x }));
  const veic = veicoli.find((x) => String(x.id) === String(v.veicolo_id));
  const t = vettura ? null : veic?.tariffa != null ? Number(veic.tariffa) : tariffaDefault?.tariffa ?? null;
  const kmTot = (Number(String(v.km).replace(',', '.')) || 0) * (v.andata_ritorno ? 2 : 1);
  const salva = async (e) => {
    e?.preventDefault(); setBusy(true); setErr(null);
    try {
      const corpo = { data: v.data, partenza: v.partenza, arrivo: v.arrivo, andata_ritorno: Boolean(v.andata_ritorno), km: v.km, motivazione: v.motivazione, veicolo_tipo: vettura ? 'AZIENDALE' : 'PROPRIO', veicolo_id: vettura ? null : v.veicolo_id || null, vettura_id: vettura?.id || null };
      const r = viaggio ? await api.put(`/note/${nota.id}/viaggi/${viaggio.id}`, corpo) : await api.post(`/note/${nota.id}/viaggi`, corpo);
      onSalvata(r);
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  };
  return (
    <Modal title={viaggio ? 'Modifica viaggio' : 'Nuovo viaggio'} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy || !v.partenza || !v.arrivo || !v.km || (!vettura && !v.veicolo_id)} onClick={salva}><Icon name="check" />Salva il viaggio</button></>}>
      <ErrorBox error={err} />
      {vettura && <div className="alert info"><Icon name="info" /><span>Hai una vettura aziendale ({vettura.marca} {vettura.modello} {vettura.targa}): i chilometri non sono rimborsabili. Puoi registrare il viaggio di servizio come promemoria facoltativo.</span></div>}
      <form className="rs-form" onSubmit={salva}>
        <div className="rs-due">
          <Field label="Da" required><input value={v.partenza} maxLength={200} placeholder="es. Firenze, sede" onChange={(e) => s('partenza', e.target.value)} /></Field>
          <Field label="A" required><input value={v.arrivo} maxLength={200} placeholder="es. Prato, punto prelievi" onChange={(e) => s('arrivo', e.target.value)} /></Field>
        </div>
        <div className="rs-tre">
          <Field label="Km del percorso (sola andata)" required><input inputMode="decimal" value={v.km} placeholder="0" onChange={(e) => s('km', e.target.value.replace(/[^\d,.]/g, ''))} /></Field>
          <Field label="Data" required><input type="date" value={v.data} max={oggiIso()} onChange={(e) => s('data', e.target.value)} /></Field>
          <label className="f inline rs-ar"><input type="checkbox" checked={Boolean(v.andata_ritorno)} onChange={(e) => s('andata_ritorno', e.target.checked)} />Andata e ritorno</label>
        </div>
        {!vettura && <Field label="Veicolo utilizzato" required help={veicoli.length ? null : 'Aggiungi il tuo veicolo in "Veicoli e fuel card" (marca, modello, targa e tariffa ACI)'}>
          <select value={v.veicolo_id} onChange={(e) => s('veicolo_id', e.target.value)}><option value="">Scegli</option>{veicoli.filter((x) => x.attivo || String(x.id) === String(v.veicolo_id)).map((x) => <option key={x.id} value={x.id}>{x.marca} {x.modello} {x.targa}</option>)}</select></Field>}
        <Field label="Motivazione"><input value={v.motivazione || ''} maxLength={500} placeholder="es. Visita al cliente" onChange={(e) => s('motivazione', e.target.value)} /></Field>
        <div className="rs-calc">
          <span>{km(kmTot)}{v.andata_ritorno ? ' (andata e ritorno)' : ''}</span>
          {vettura ? <strong>non rimborsabile</strong> : t == null ? <span className="rs-warn">tariffa EUR/km mancante: senza tariffa il viaggio non si invia</span> : <strong>{tariffa(t)} = {eur(Math.round(kmTot * t * 100) / 100)}</strong>}
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ riepilogo (come i moduli)
export function Riepilogo({ r, nota }) {
  if (!r) return null;
  const voci = [
    ['Spese documentate', eur(r.tot_spese), 'MOD025'],
    ['Rimborso chilometrico', eur(r.tot_km_importo), `${km(r.tot_km)}${r.km_registro ? ` · più ${km(r.km_registro)} con la vettura aziendale` : ''}`],
    ['Pedaggi', eur(r.tot_pedaggi), 'con ricevute'], ['Parcheggi', eur(r.tot_parcheggi), 'con ricevute'],
    ['Totale rimborsabile', eur(r.tot_rimborsabile), 'MOD025 + MOD029', 'tot'],
    ['Anticipi ricevuti', eur(r.anticipi), 'da scalare'],
    ['Carta aziendale o fuel card', eur(r.tot_carta), 'non rimborsabile'],
    ...(r.tot_escluso ? [['Escluso dal responsabile', eur(r.tot_escluso), 'righe escluse', 'neg']] : []),
  ];
  return (
    <div className="rs-riep">
      <div className="rs-kpis">{voci.map(([l, v, f, c]) => <div key={l} className={`rs-kpi ${c || ''}`}><div className="l">{l}</div><div className="v">{v}</div><div className="f">{f}</div></div>)}</div>
      <div className={`rs-saldo ${r.saldo < 0 ? 'neg' : ''}`}><span>Saldo</span><strong>{eur(Math.abs(r.saldo))}</strong><span>{saldoTesto(r.saldo)}</span></div>
      {nota?.liquidazione_data && <div className="small muted">Liquidata {eur(nota.liquidazione_importo)} con pagamento del {itData(nota.liquidazione_data)} · rif. {nota.liquidazione_rif}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ storico
export function Storico({ eventi }) {
  if (!eventi?.length) return <div className="small muted">Nessun evento</div>;
  return (
    <ul className="rs-timeline">
      {eventi.map((e) => (
        <li key={e.id}><div className="strong">{EVENTO[e.tipo] || e.tipo}{e.testo ? `: ${e.testo}` : ''}</div><div className="small muted">{itDataOra(e.at)}{e.utente ? ` · ${e.utente}` : ' · sistema'}</div></li>
      ))}
    </ul>
  );
}

export { useApi, eur, km };

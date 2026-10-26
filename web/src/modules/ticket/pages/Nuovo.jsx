// Nuovo ticket: form guidato. Categoria con descrizione → priorità proposta e casella destinataria proposta (modificabile dall'albero),
// "per conto di" sede o Legal entity con proposta dalla persona dell'utente, allegati, avviso privacy, nota per i riservati.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, base, useApi } from '../api.js';
import { Card, Field, DropZone, useToast, PageHead, Loading, Empty } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { UnitSelect } from '../components.jsx';
import { PRIORITA, kb } from '../format.js';

export default function Nuovo() {
  const nav = useNavigate();
  const toast = useToast();
  const cat = useApi('/catalogo');
  const [f, setF] = useState({ categoria_id: '', titolo: '', descrizione: '', priorita: '', unit_id: null, per_conto: '', anonimo: false });
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [touchedUnit, setTouchedUnit] = useState(false);
  const categoria = useMemo(() => (cat.data?.categorie || []).find((c) => c.id === Number(f.categoria_id)), [cat.data, f.categoria_id]);
  const sla = useMemo(() => (cat.data?.sla || []).find((s) => s.priorita === (f.priorita || categoria?.priorita_default)), [cat.data, f.priorita, categoria]);
  // proposta "per conto di" dalla persona dell'utente
  useEffect(() => {
    if (!cat.data || f.per_conto) return;
    const p = cat.data.proposta || {};
    if (p.site_id && cat.data.sedi.some((s) => s.id === p.site_id)) setF((x) => ({ ...x, per_conto: `site:${p.site_id}` }));
    else if (p.org_id && cat.data.organizzazioni.some((o) => o.id === p.org_id)) setF((x) => ({ ...x, per_conto: `org:${p.org_id}` }));
  }, [cat.data]); // eslint-disable-line react-hooks/exhaustive-deps
  // la categoria propone priorità e casella (finché l'utente non cambia la casella a mano)
  useEffect(() => {
    if (!categoria) return;
    setF((x) => ({ ...x, priorita: categoria.priorita_default, unit_id: touchedUnit && x.unit_id ? x.unit_id : categoria.unit_id || null }));
  }, [categoria]); // eslint-disable-line react-hooks/exhaustive-deps
  const upd = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const limiti = cat.data?.limiti || { max_file_mb: 10, max_files: 10, estensioni: [] };
  const addFiles = (list) => {
    const next = [...files];
    for (const file of list) {
      const ext = file.name.split('.').pop().toLowerCase();
      if (!limiti.estensioni.includes(ext)) { toast(`${file.name}: tipo non ammesso`, 'err'); continue; }
      if (file.size > limiti.max_file_mb * 1024 * 1024) { toast(`${file.name}: supera ${limiti.max_file_mb} MB`, 'err'); continue; }
      if (next.length >= limiti.max_files) { toast(`Massimo ${limiti.max_files} allegati`, 'err'); break; }
      next.push(file);
    }
    setFiles(next);
  };
  const invia = async (e) => {
    e?.preventDefault();
    if (!categoria) return toast('Scegli la categoria', 'err');
    if (f.titolo.trim().length < 5) return toast('Il titolo deve avere almeno 5 caratteri', 'err');
    if (f.descrizione.trim().length < 10) return toast('Descrivi la richiesta (almeno 10 caratteri)', 'err');
    if (!f.unit_id) return toast('Scegli la casella destinataria', 'err');
    setBusy(true);
    try {
      const [kind, id] = String(f.per_conto || '').split(':');
      const body = { categoria_id: categoria.id, titolo: f.titolo.trim(), descrizione: f.descrizione.trim(), priorita: f.priorita || undefined, unit_id: f.unit_id, per_conto_site_id: kind === 'site' ? Number(id) : null, per_conto_org_id: kind === 'org' ? Number(id) : null, anonimo: categoria.riservata ? f.anonimo : false };
      const t = await api.post('/tickets', body);
      let errori = 0;
      for (const file of files) { const fd = new FormData(); fd.append('file', file); try { await api.upload(`/tickets/${t.id}/allegati`, fd); } catch { errori++; } }
      toast(`Ticket ${t.protocollo} aperto${errori ? ` (${errori} allegati non caricati)` : ''}`);
      nav(`${base}/${t.id}`);
    } catch (err) { toast(err, 'err'); }
    setBusy(false);
  };
  if (cat.error) return <div className="page narrow"><Empty icon="alert" title="Catalogo non disponibile">{cat.error.message}</Empty></div>;
  if (!cat.data) return <div className="page narrow"><Loading /></div>;
  const unitSel = cat.data.unita.find((u) => u.id === f.unit_id);
  return (
    <div className="page narrow">
      <PageHead title="Nuovo ticket" icon="plus" sub="Scegli la categoria, descrivi la richiesta e indica per conto di quale sede o Legal entity la fai. La casella destinataria è proposta dalla categoria e si può cambiare." />
      <form onSubmit={invia} className="tk-form">
        <Card title="1. Che cosa chiedi" icon="list">
          <div className="tk-form">
            <Field label="Categoria" required>
              <select value={f.categoria_id} onChange={(e) => upd('categoria_id', e.target.value)} required>
                <option value="">Scegli la categoria</option>
                {cat.data.categorie.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.riservata ? ' (riservata)' : ''}</option>)}
              </select>
              {categoria && <div className="help" style={{ marginTop: 4 }}>{categoria.descrizione}</div>}
            </Field>
            {categoria?.riservata && (
              <div className="tk-alert warn"><Icon name="lock" /><div><b>Segnalazione riservata.</b> {cat.data.avviso_riservato}
                <label className="tk-check" style={{ marginTop: 8 }}><input type="checkbox" checked={f.anonimo} onChange={(e) => upd('anonimo', e.target.checked)} /> Non mostrare il mio nome al di fuori della casella destinataria (nelle liste e nelle statistiche comparirà "Riservato")</label></div></div>
            )}
            <Field label="Titolo" required><input value={f.titolo} onChange={(e) => upd('titolo', e.target.value)} maxLength={200} placeholder="In poche parole, che cosa serve" required /></Field>
            <Field label="Descrizione" required help="Contesto, che cosa è successo, che cosa ti aspetti. Niente dati di pazienti.">
              <textarea rows={7} value={f.descrizione} onChange={(e) => upd('descrizione', e.target.value)} maxLength={10000} required placeholder="Descrivi la richiesta o la segnalazione" />
            </Field>
            <div className="tk-alert"><Icon name="shield" /><div>{cat.data.avviso_privacy || 'Non inserire dati di pazienti (nomi, referti, codici fiscali).'}</div></div>
          </div>
        </Card>
        <Card title="2. A chi e con quale urgenza" icon="users">
          <div className="tk-form">
            <Field label="Casella destinataria" required help={categoria?.unit_id ? 'Proposta dalla categoria: cambiala se la richiesta riguarda un altro reparto o un\'altra sede.' : 'La categoria non ha una casella predefinita: scegli la casella del responsabile che deve ricevere il ticket.'}>
              <UnitSelect units={cat.data.unita} value={f.unit_id} onChange={(v) => { setTouchedUnit(true); upd('unit_id', v); }} />
              {unitSel && !unitSel.has_head && <div className="tk-alert warn" style={{ marginTop: 6 }}><Icon name="alert" /><div>Questa casella non ha un responsabile nell'organigramma: il ticket sarà visibile ai responsabili delle caselle superiori.</div></div>}
            </Field>
            <div className="two">
              <Field label="Priorità" help={sla ? `Prima risposta entro ${sla.prima_risposta_ore} ore, risoluzione entro ${sla.risoluzione_ore} ore` : ''}>
                <select value={f.priorita} onChange={(e) => upd('priorita', e.target.value)}>{Object.entries(PRIORITA).map(([k, v]) => <option key={k} value={k}>{v.label}{categoria?.priorita_default === k ? ' (proposta)' : ''}</option>)}</select>
              </Field>
              <Field label="Per conto di" help="La sede o la Legal entity per cui fai la richiesta (proposta dalla tua scheda persona).">
                <select value={f.per_conto} onChange={(e) => upd('per_conto', e.target.value)}>
                  <option value="">Non indicata</option>
                  <optgroup label="Sedi TD">{cat.data.sedi.map((s) => <option key={`s${s.id}`} value={`site:${s.id}`}>{s.name}{s.city ? ` · ${s.city}` : ''}</option>)}</optgroup>
                  <optgroup label="Legal entity">{cat.data.organizzazioni.map((o) => <option key={`o${o.id}`} value={`org:${o.id}`}>{o.name}</option>)}</optgroup>
                </select>
              </Field>
            </div>
          </div>
        </Card>
        <Card title="3. Allegati" icon="upload">
          <DropZone multiple accept={limiti.estensioni.map((e) => `.${e}`).join(',')} onFiles={addFiles}>
            <Icon name="upload" /><div>Trascina qui i file o clicca per sceglierli. {limiti.estensioni.join(', ')}; massimo {limiti.max_file_mb} MB ciascuno, {limiti.max_files} per ticket.</div>
          </DropZone>
          {files.length > 0 && <ul className="tk-files">{files.map((file, i) => <li key={i}><Icon name="file" /><span>{file.name}</span><span className="muted small">{kb(file.size)}</span><button type="button" className="iconbtn" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Togli"><Icon name="x" /></button></li>)}</ul>}
        </Card>
        <div className="row end">
          <button type="button" className="btn ghost" onClick={() => nav(base)}>Annulla</button>
          <button type="submit" className="btn lg" disabled={busy}><Icon name="send" />Apri il ticket</button>
        </div>
      </form>
    </div>
  );
}

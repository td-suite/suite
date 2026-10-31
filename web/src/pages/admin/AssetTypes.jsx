// Amministrazione > Anagrafiche > Catalogo dispositivi (public.asset_types): tipologie di dispositivi sotto manutenzione, compresi quelli
// di sicurezza, con periodicità di sorveglianza, controllo e manutenzione e riferimento normativo. Lo usa il modulo Facility e
// Manutenzioni. Il seed iniziale è un benchmark da confermare con RSPP e Qualità. Owner e Admin modificano; un tipo in uso si disattiva.
import React, { useState } from 'react';
import { api } from '../../api.js';
import { useApi, Card, Badge, Skeleton, Empty, ErrorBox, PageHead, Field, SearchInput, useToast, Modal, ConfirmModal } from '../../components/ui.jsx';
import { Icon } from '../../components/Icons.jsx';
import { SITE_KIND } from '../../format.js';

// nota del benchmark senza la frase comune (mostrata una volta sola nel riquadro sopra la tabella)
const noteOf = (t) => String(t.benchmark_note || '').replace('Benchmark indicativo, da confermare con RSPP e Qualità.', '').trim();
const every = (m) => (m ? `${m} mes${m === 1 ? 'e' : 'i'}` : '–');

export function AssetTypes() {
  const { data, loading, error, reload } = useApi('/asset-types?all=1');
  const toast = useToast();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);
  const cats = data?.categories || {};
  const rows = (data?.rows || []).filter((t) => (!cat || t.category === cat) && (!q || `${t.code} ${t.name} ${t.legal_reference || ''}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="page">
      <PageHead title="Catalogo dispositivi" icon="facility" sub="Dispositivi sotto manutenzione, compresi quelli di sicurezza (porte antincendio, estintori, maniglioni antipanico...), con le periodicità che generano il piano del widget Facility e Manutenzioni. Valori iniziali di benchmark da confermare con RSPP e Qualità." />
      <div className="filters">
        <SearchInput value={q} onChange={setQ} placeholder="Cerca per nome, codice o norma" />
        <select style={{ width: 'auto', minWidth: 220 }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoria"><option value="">Tutte le categorie</option>{Object.entries(cats).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <div className="spacer" /><span className="small muted">{rows.length} tipi</span>
        <button className="btn" onClick={() => setModal({})}><Icon name="plus" />Nuovo tipo</button>
      </div>
      <div className="alert" style={{ marginBottom: 12 }}><Icon name="info" /><span>Periodicità e riferimenti sono indicativi e vanno confermati con RSPP e Qualità prima dell'uso; dove dipendono dal tipo, dalla carica o dal fabbricante la nota lo dice. Una modifica vale per i dispositivi registrati dopo e per le scadenze rigenerate.</span></div>
      <Card flush>
        {loading && <div style={{ padding: 18 }}><Skeleton lines={6} /></div>}
        {error && <div style={{ padding: 16 }}><ErrorBox error={error} /></div>}
        {data && !rows.length && <Empty icon="grid" title="Nessun tipo di dispositivo" />}
        {rows.length > 0 && <div className="table-wrap"><table className="t"><thead><tr><th>Tipo</th><th>Categoria</th><th>Sorveglianza di sede</th><th>Controllo</th><th>Manutenzione</th><th>Riferimento</th><th>Sedi</th><th className="num">In uso</th><th /></tr></thead><tbody>
          {rows.map((t) => <tr key={t.id} style={{ opacity: t.active ? 1 : 0.55 }}>
            <td><div className="strong">{t.name}</div><div className="small muted mono">{t.code}</div>{!t.active && <Badge tone="grey">Non attivo</Badge>}{t.requires_certified_vendor && <Badge tone="blue" dot={false}>manutentore abilitato</Badge>}</td>
            <td className="small">{cats[t.category]}</td><td>{every(t.surveillance_months)}</td>
            <td>{every(t.check_interval_months)}{t.check_kind === 'VERIFICA_NORMATIVA' && <div className="small muted">verifica normativa</div>}</td><td>{every(t.maintenance_interval_months)}</td>
            <td className="small" style={{ minWidth: 300 }}>{t.legal_reference}{noteOf(t) && <div className="muted">{noteOf(t)}</div>}</td>
            <td className="small" title={t.applies_to_kinds?.map((k) => SITE_KIND[k] || k).join(', ')}>{t.applies_to_kinds?.length ? (t.applies_to_kinds.length > 2 ? `${t.applies_to_kinds.length} tipologie` : t.applies_to_kinds.map((k) => SITE_KIND[k] || k).join(', ')) : 'tutte'}</td>
            <td className="num">{t.in_use}</td>
            <td className="actions"><button className="iconbtn" aria-label="Modifica" onClick={() => setModal(t)}><Icon name="edit" /></button>{!t.in_use && <button className="iconbtn" aria-label="Elimina" onClick={() => setDel(t)}><Icon name="trash" /></button>}</td>
          </tr>)}
        </tbody></table></div>}
      </Card>
      {modal && <TypeModal t={modal} cats={cats} kinds={data.site_kinds} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {del && <ConfirmModal title="Elimina tipo" danger text={`Eliminare "${del.name}" dal catalogo?`} confirmText="Elimina" onConfirm={async () => { try { await api.del(`/asset-types/${del.id}`); toast('Tipo eliminato'); setDel(null); reload(); } catch (e) { toast(e, 'err'); } }} onClose={() => setDel(null)} />}
    </div>
  );
}

function TypeModal({ t, cats, kinds, onClose, onDone }) {
  const toast = useToast();
  const isNew = !t.id;
  const [f, setF] = useState({ code: t.code || '', name: t.name || '', category: t.category || 'SICUREZZA_ANTINCENDIO', description: t.description || '', surveillance_months: t.surveillance_months ?? '', check_interval_months: t.check_interval_months ?? '', check_kind: t.check_kind || 'CONTROLLO',
    maintenance_interval_months: t.maintenance_interval_months ?? '', legal_reference: t.legal_reference || '', requires_certified_vendor: Boolean(t.requires_certified_vendor), applies_to_kinds: t.applies_to_kinds || [], benchmark_note: t.benchmark_note ?? 'Benchmark indicativo, da confermare con RSPP e Qualità.', active: t.active ?? true, sort: t.sort ?? 100 });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const body = { ...f }; for (const k of ['surveillance_months', 'check_interval_months', 'maintenance_interval_months']) body[k] = body[k] === '' ? null : Number(body[k]);
    body.sort = Number(body.sort) || 100;
    try { if (isNew) await api.post('/asset-types', body); else await api.put(`/asset-types/${t.id}`, body); toast('Tipo salvato'); onDone(); } catch (e) { toast(e, 'err'); }
  };
  const toggle = (k) => setF({ ...f, applies_to_kinds: f.applies_to_kinds.includes(k) ? f.applies_to_kinds.filter((x) => x !== k) : [...f.applies_to_kinds, k] });
  return (
    <Modal wide title={isNew ? 'Nuovo tipo di dispositivo' : t.name} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" onClick={save}>Salva</button></>}>
      <div className="form-grid">
        <Field label="Codice" required><input value={f.code} onChange={set('code')} placeholder="ES. PORTA_REI" /></Field>
        <Field label="Nome" required><input value={f.name} onChange={set('name')} /></Field>
        <Field label="Categoria"><select value={f.category} onChange={set('category')}>{Object.entries(cats).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Sorveglianza di sede (mesi)" help="Controllo a vista a cura della sede"><input type="number" min="1" value={f.surveillance_months} onChange={set('surveillance_months')} /></Field>
        <Field label="Controllo periodico (mesi)"><input type="number" min="1" value={f.check_interval_months} onChange={set('check_interval_months')} /></Field>
        <Field label="Il controllo è"><select value={f.check_kind} onChange={set('check_kind')}><option value="CONTROLLO">un controllo del manutentore</option><option value="VERIFICA_NORMATIVA">una verifica normativa (ente)</option></select></Field>
        <Field label="Manutenzione / revisione (mesi)"><input type="number" min="1" value={f.maintenance_interval_months} onChange={set('maintenance_interval_months')} /></Field>
        <Field label="Ordine"><input type="number" value={f.sort} onChange={set('sort')} /></Field>
      </div>
      <Field label="Riferimento normativo"><input value={f.legal_reference} onChange={set('legal_reference')} /></Field>
      <Field label="Descrizione"><textarea rows={2} value={f.description} onChange={set('description')} /></Field>
      <Field label="Nota di benchmark"><input value={f.benchmark_note} onChange={set('benchmark_note')} /></Field>
      <div className="small" style={{ margin: '8px 0 4px' }}>Tipologie di sede (nessuna = tutte)</div>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>{kinds.map((k) => <label key={k} className="row small" style={{ gap: 6 }}><input type="checkbox" checked={f.applies_to_kinds.includes(k)} onChange={() => toggle(k)} />{SITE_KIND[k] || k}</label>)}</div>
      <div className="row" style={{ gap: 16, marginTop: 10 }}>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={f.requires_certified_vendor} onChange={(e) => setF({ ...f, requires_certified_vendor: e.target.checked })} />Richiede manutentore abilitato o ente verificatore</label>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Attivo</label>
      </div>
    </Modal>
  );
}

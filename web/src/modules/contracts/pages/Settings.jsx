import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApi, Card, Field, ErrorBox, Loading, Badge, useToast, Icon } from '../components/ui.jsx';

const GROUPS = [
  { title: 'Dati societari (intestazioni dei documenti)', keys: [['company_name', 'Ragione sociale'], ['company_legal_address', 'Sede legale (contratti LP)'], ['company_address', 'Sede operativa / di lavoro predefinita'], ['company_vat', 'P.IVA e C.F.'], ['company_rea', 'REA'], ['company_capital', 'Capitale sociale'], ['company_phone', 'Telefono'], ['company_email', 'Email'], ['company_pec', 'PEC'], ['company_website', 'Sito web'], ['health_director', 'Direttore Sanitario'], ['signatory_name', 'Firmatario (Datore di lavoro)'], ['signatory_title', 'Qualifica del firmatario'], ['letter_city', 'Luogo delle lettere']] },
  { title: 'Costo azienda (ipotesi: verificare con il consulente del lavoro)', keys: [['cost_inps_pct', 'Contributi INPS a carico azienda %'], ['cost_inail_pct', 'INAIL %'], ['cost_tfr_pct', 'TFR %'], ['cost_apprentice_inps_pct', 'INPS apprendisti %'], ['cost_dirigente_extra_pct', 'Extra dirigenti (FASI, Previndai) %'], ['function_allowance_share', 'Quota indennità di funzione sull\'eccedenza (0,7)']] },
  { title: 'Simulatore netto (stime)', keys: [['employee_inps_pct', 'INPS a carico dipendente %'], ['addizionale_regionale_pct', 'Addizionale regionale %'], ['addizionale_comunale_pct', 'Addizionale comunale %'], ['irpef_brackets', 'Scaglioni IRPEF (JSON)']] },
  { title: 'Scadenze', keys: [['deadline_alert_days', 'Giorni di allerta in dashboard']] },
];

export default function Settings() {
  const toast = useToast();
  const d = useApi('/settings');
  const areas = useApi('/areas');
  const people = useApi('/resources?status=ATTIVO,IMPEGNO');
  const sites = useApi('/work-sites');
  const [v, setV] = useState({});
  const [imp, setImp] = useState({ file: null, mode: 'skip', busy: false, result: null, error: null });
  const [newArea, setNewArea] = useState({ name: '', parent_id: '' });
  const [editArea, setEditArea] = useState(null);
  const saveArea = async () => { if (!editArea || !editArea.name.trim()) return; try { await api.put(`/areas/${editArea.id}`, { name: editArea.name.trim(), parent_id: editArea.parent_id ? Number(editArea.parent_id) : null, head_resource_id: editArea.head_resource_id ? Number(editArea.head_resource_id) : null, kind: editArea.kind || 'LINEA' }); toast('Area aggiornata'); setEditArea(null); areas.reload(); } catch (e) { toast(e.message, 'err'); } };
  const [newSite, setNewSite] = useState({ name: '', address: '' });
  useEffect(() => { if (d.data) setV(d.data.settings); }, [d.data]);
  if (!d.data) return <div className="page"><Loading /></div>;
  const save = async () => { try { await api.put('/settings', v); toast('Impostazioni salvate'); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const runImport = async () => {
    if (!imp.file) return;
    setImp({ ...imp, busy: true, error: null, result: null });
    try { const fd = new FormData(); fd.append('file', imp.file); fd.append('mode', imp.mode); const r = await api.upload('/import/pack', fd); setImp({ ...imp, busy: false, result: r }); toast('Import completato'); }
    catch (e) { setImp({ ...imp, busy: false, error: e }); }
  };
  return (
    <div className="page">
      <div className="page-head"><div><h1>Impostazioni e import</h1><div className="sub">Dati societari per i documenti, parametri di costo, aree, sedi e importazione del pacchetto iniziale.</div></div><button className="btn" onClick={save}>Salva impostazioni</button></div>
      <div className="grid g2" style={{ marginBottom: 16 }}>
        <Card title="Stato dell'installazione">
          <p>Accesso Microsoft 365: {d.data.entraEnabled ? <Badge tone="green">attivo</Badge> : <Badge tone="grey">non configurato (ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET)</Badge>}</p>
          <p>Conversione PDF (LibreOffice): {d.data.pdfEnabled ? <Badge tone="green">disponibile</Badge> : <Badge tone="red">non disponibile: vengono prodotti solo DOCX</Badge>}</p>
          <p>Sintesi automatica dei CV (API Claude): {d.data.aiEnabled ? <Badge tone="green">attiva</Badge> : <Badge tone="grey">non configurata (ANTHROPIC_API_KEY)</Badge>}</p>
          <p className="small muted">Dimensione massima per allegato: {d.data.maxUploadMb} MB.</p>
        </Card>
        <Card title="Importa pacchetto iniziale (seed pack)">
          <p className="small muted">Zip con manifest.json e cartella files/: crea risorse, contratti, lettere di impegno e dossier. Con "Salta esistenti" le risorse già presenti (stesso codice fiscale o nome) non vengono toccate; gli allegati identici sono ignorati.</p>
          <div className="form-grid">
            <Field label="File zip" className="span2"><input type="file" accept=".zip" onChange={(e) => setImp({ ...imp, file: e.target.files?.[0] || null })} /></Field>
            <Field label="Risorse già presenti"><select value={imp.mode} onChange={(e) => setImp({ ...imp, mode: e.target.value })}><option value="skip">Salta esistenti</option><option value="update">Aggiorna esistenti</option></select></Field>
          </div>
          <div className="row" style={{ marginTop: 10 }}><button className="btn" disabled={!imp.file || imp.busy} onClick={runImport}><Icon name="upload" />{imp.busy ? 'Import in corso…' : 'Importa'}</button></div>
          <ErrorBox error={imp.error} />
          {imp.result && <div className="alert ok" style={{ marginTop: 10, display: 'block' }}>Risorse create {imp.result.stats.resources_created}, aggiornate {imp.result.stats.resources_updated}, saltate {imp.result.stats.resources_skipped} · allegati {imp.result.stats.attachments} (ignorati {imp.result.stats.attachments_skipped}) · lettere {imp.result.stats.letters} · CV {imp.result.stats.cv} · errori {imp.result.stats.errors}{imp.result.log.length ? <ul>{imp.result.log.map((l, i) => <li key={i}>{l}</li>)}</ul> : null}</div>}
        </Card>
      </div>
      <div className="grid g2">
        {GROUPS.map((g) => (
          <Card key={g.title} title={g.title}>
            <div className="form-grid">{g.keys.map(([k, l]) => <Field key={k} label={l} className={k === 'irpef_brackets' || k.startsWith('company_') ? 'span2' : ''}><input value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>)}</div>
          </Card>
        ))}
        <Card title="Aree aziendali" className="span2" actions={<span className="small muted">fino a quattro livelli, dall'organigramma TD-SGI-IDL007</span>}>
          <table className="t"><tbody>{(areas.data || []).map((a) => <tr key={a.id}><td style={{ paddingLeft: 8 + (a.level - 1) * 22 }}>{editArea?.id === a.id ? <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><input value={editArea.name} autoFocus placeholder="Denominazione" style={{ minWidth: 220 }} onChange={(e) => setEditArea({ ...editArea, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') saveArea(); if (e.key === 'Escape') setEditArea(null); }} /><select value={editArea.parent_id || ''} title="Area di livello superiore" onChange={(e) => setEditArea({ ...editArea, parent_id: e.target.value })}><option value="">1° livello (nessuna area superiore)</option>{(areas.data || []).filter((x) => x.id !== a.id && x.level < 4 && !(x.path || '').startsWith((a.path || '') + ' › ')).map((x) => <option key={x.id} value={x.id}>{x.level + 1}° livello di: {x.path}</option>)}</select><select value={editArea.head_resource_id || ''} title="Referente dell'area (organigramma)" onChange={(e) => setEditArea({ ...editArea, head_resource_id: e.target.value })}><option value="">Referente: automatico dalle linee di riporto</option>{(people.data || []).map((p) => <option key={p.id} value={p.id}>Referente: {p.last_name} {p.first_name}</option>)}</select><select value={editArea.kind || 'LINEA'} title="Tecnostruttura (in alto nell'organigramma) o area operativa (nel pettine)" onChange={(e) => setEditArea({ ...editArea, kind: e.target.value })}><option value="LINEA">Area operativa (pettine)</option><option value="STAFF">Tecnostruttura (staff, in alto)</option></select></div> : <><span className="small muted" style={{ marginRight: 6 }}>{a.level}°</span>{a.name}{a.kind === 'STAFF' && <Badge tone="grey">tecnostruttura</Badge>}{a.head_name && <span className="small muted" style={{ marginLeft: 8 }}>· {a.head_name}</span>}</>}</td><td className="num"><Badge>{a.headcount} risorse</Badge></td><td className="num" style={{ whiteSpace: 'nowrap' }}>{editArea?.id === a.id ? <><button className="btn sm" onClick={saveArea}>Salva</button> <button className="btn sm ghost" onClick={() => setEditArea(null)}>Annulla</button></> : <><button className="btn sm ghost" title="Modifica denominazione e livello" onClick={() => setEditArea({ id: a.id, name: a.name, parent_id: a.parent_id || '', head_resource_id: a.head_resource_id || '', kind: a.kind || 'LINEA' })}>Modifica</button> {a.headcount > 0 || a.children > 0 ? <span className="small muted" title={a.headcount > 0 ? 'Sposta prima le risorse in un\'altra area' : 'Elimina prima le aree di livello inferiore'}>in uso</span> : <button className="btn sm danger" onClick={async () => { if (!window.confirm(`Eliminare l'area "${a.name}"?`)) return; try { await api.del(`/areas/${a.id}`); toast('Area eliminata'); areas.reload(); } catch (e) { toast(e.message, 'err'); } }}>Elimina</button>}</>}</td></tr>)}</tbody></table>
          <div className="form-grid" style={{ marginTop: 10 }}>
            <Field label="Nuova area"><input value={newArea.name} onChange={(e) => setNewArea({ ...newArea, name: e.target.value })} placeholder="Nome dell'area" /></Field>
            <Field label="Area di livello superiore" help="Vuoto = area di 1° livello"><select value={newArea.parent_id} onChange={(e) => setNewArea({ ...newArea, parent_id: e.target.value })}><option value="">nessuna (1° livello)</option>{(areas.data || []).filter((a) => a.level < 4).map((a) => <option key={a.id} value={a.id}>{a.path} ({a.level}° livello)</option>)}</select></Field>
            <Field label="Tipo"><select value={newArea.kind || 'LINEA'} onChange={(e) => setNewArea({ ...newArea, kind: e.target.value })}><option value="LINEA">Area operativa (pettine)</option><option value="STAFF">Tecnostruttura (staff, in alto)</option></select></Field>
          </div>
          <div className="row" style={{ marginTop: 6 }}><button className="btn sm" disabled={!newArea.name} onClick={async () => { try { await api.post('/areas', { name: newArea.name, parent_id: newArea.parent_id ? Number(newArea.parent_id) : null, kind: newArea.kind || 'LINEA' }); setNewArea({ name: '', parent_id: '' }); toast('Area aggiunta'); areas.reload(); } catch (e) { toast(e.message, 'err'); } }}>Aggiungi</button></div>
        </Card>
        <Card title="Sedi di lavoro (per i contratti)">
          <table className="t"><tbody>{(sites.data || []).map((s) => <tr key={s.id}><td><div className="strong">{s.name}</div><div className="small muted">{s.address}</div></td><td className="num"><button className="btn sm link" onClick={async () => { await api.del(`/work-sites/${s.id}`); sites.reload(); }}>Rimuovi</button></td></tr>)}</tbody></table>
          <div className="form-grid" style={{ marginTop: 10 }}><Field label="Nome"><input value={newSite.name} onChange={(e) => setNewSite({ ...newSite, name: e.target.value })} /></Field><Field label="Indirizzo completo"><input value={newSite.address} onChange={(e) => setNewSite({ ...newSite, address: e.target.value })} /></Field></div>
          <div style={{ marginTop: 8 }}><button className="btn sm" disabled={!newSite.name || !newSite.address} onClick={async () => { await api.post('/work-sites', newSite); setNewSite({ name: '', address: '' }); sites.reload(); }}>Aggiungi sede</button></div>
        </Card>
      </div>
    </div>
  );
}

// Impostazioni (Qualità o amministratore): giorno dell'alert e promemoria, modelli attivi con anteprima e caricamento di una nuova
// revisione JSON, modalità di archiviazione dei file, stato di IA e posta, esecuzione manuale dell'alert.
import React, { useEffect, useState } from 'react';
import { api, useApi } from '../api.js';
import { Card, Field, PageHead, Loading, useToast, Badge, DropZone, Modal } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { itDate, itDateTime, mese } from '../format.js';

export default function Impostazioni() {
  const toast = useToast();
  const imp = useApi('/settings');
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [prev, setPrev] = useState(null);
  const [esito, setEsito] = useState(null);
  useEffect(() => { if (imp.data) setForm({ alert_day: imp.data.alert_day, reminder_every_days: imp.data.reminder_every_days }); }, [imp.data]);
  const run = async (fn, ok) => { setBusy(true); try { const r = await fn(); if (ok) toast(ok); imp.reload(); return r; } catch (e) { toast(e, 'err'); } finally { setBusy(false); } };
  const salva = () => run(() => api.put('/settings', { alert_day: Number(form.alert_day), reminder_every_days: Number(form.reminder_every_days) }), 'Impostazioni salvate');
  const carica = (files) => { const f = files[0]; if (!f) return; if (!/\.json$/i.test(f.name)) return toast('Il modello deve essere un file JSON', 'err'); const fd = new FormData(); fd.append('file', f, f.name); run(() => api.upload('/templates', fd), 'Nuova revisione del modello caricata e attivata'); };
  const anteprima = async (t) => { try { setPrev(await api.get(`/templates/${t.id}`)); } catch (e) { toast(e, 'err'); } };
  const alert = async (dry) => { const r = await run(() => api.post('/jobs/alert17/run', { dry_run: dry }), null); if (r) setEsito(r); };
  if (!form || !imp.data) return <div className="page"><Loading /></div>;
  const d = imp.data;
  return (
    <div className="page">
      <PageHead title="Impostazioni" icon="gear" sub="Parametri del modulo Audit SGI. Sedi, Legal entity e persone vengono dall'anagrafica unica della Suite." />
      <div className="grid au-two">
        <Card title="Alert dell'auto-audit mensile" icon="bell" actions={<button className="btn sm" disabled={busy} onClick={salva}>Salva</button>}>
          <div className="au-head-grid">
            <Field label="Giorno del mese dell'avviso" help="Dal giorno indicato fino a fine mese: una notifica Suite (ed email, se la posta è configurata) ai site manager delle sedi struttura che non hanno ancora inviato l'auto-audit."><input className="au-in" type="number" min={1} max={28} value={form.alert_day} onChange={(e) => setForm({ ...form, alert_day: e.target.value })} /></Field>
            <Field label="Promemoria ogni (giorni)" help="0 = nessun promemoria dopo il primo avviso."><input className="au-in" type="number" min={0} max={15} value={form.reminder_every_days} onChange={(e) => setForm({ ...form, reminder_every_days: e.target.value })} /></Field>
          </div>
          <div className="small muted" style={{ marginTop: 10 }}>Il lavoro `audit:alert17` gira ogni ora. Posta: {d.mail?.provider === 'graph' ? `Microsoft Graph da ${d.mail.sender}` : 'solo registro (MAIL_PROVIDER=log)'}. {d.ultimo_alert ? `Ultimo avviso: ${mese(d.ultimo_alert.period)}, ${itDateTime(d.ultimo_alert.sent_at)} (${d.ultimo_alert.n} invii).` : 'Nessun avviso ancora inviato.'}</div>
          <div className="row" style={{ marginTop: 10, gap: 8 }}><button className="btn sm ghost" disabled={busy} onClick={() => alert(true)}><Icon name="eye" />Simula (senza inviare)</button><button className="btn sm ghost" disabled={busy} onClick={() => alert(false)}><Icon name="send" />Esegui ora</button></div>
          {esito && <div className="au-alert" style={{ marginTop: 10, marginBottom: 0 }}><Icon name="info" className="ico" /><div>{esito.skipped ? `Nessuna sede da avvisare oggi (${esito.giorno}): ${esito.skipped}.` : `${esito.sedi} sedi, ${esito.notifiche} notifiche, ${esito.email} email (${esito.giorno}).`}{esito.dettaglio?.length ? <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{esito.dettaglio.map((x, i) => <li key={i}>sede {x.site_id}: {x.kind === 'REMINDER' ? 'promemoria' : 'avviso'}, {x.destinatari} destinatari</li>)}</ul> : null}</div></div>}
        </Card>
        <Card title="Stato dei servizi" icon="shield">
          <ul className="au-list">
            <li><span>Intelligenza artificiale (sintesi con Claude)</span>{d.ai?.enabled ? <Badge tone="green">Configurata</Badge> : d.ai?.mock ? <Badge tone="amber">Simulata (AUDIT_AI_MOCK)</Badge> : <Badge tone="red">Non configurata</Badge>}</li>
            <li><span>Archivio dei file (PDF, evidenze)</span><Badge tone="grey" dot={false}>{d.storage === 'blob' ? 'Azure Blob Storage' : 'Database della Suite'}</Badge></li>
            <li><span>Font dei PDF</span><Badge tone="grey" dot={false}>{d.pdf_font}</Badge></li>
            <li><span>Limite per file caricato</span><Badge tone="grey" dot={false}>25 MB</Badge></li>
          </ul>
          {d.ai && !d.ai.enabled && <div className="small muted" style={{ marginTop: 8 }}>{d.ai.message}</div>}
        </Card>
      </div>
      <Card title="Modelli di checklist" icon="list" actions={<DropZone onFiles={carica} accept=".json" multiple={false} compact><span className="small"><Icon name="upload" /> Carica una nuova revisione (JSON)</span></DropZone>}>
        <table className="t au-table"><thead><tr><th>Codice</th><th>Titolo</th><th>Tipo</th><th>Rev.</th><th>Data rev.</th><th>Audit</th><th>Stato</th><th></th></tr></thead>
          <tbody>{d.templates.map((t) => <tr key={t.id}><td className="mono">{t.code}</td><td>{t.title}</td><td><Badge tone={t.kind === 'SEDE' ? 'teal' : 'silk'} dot={false}>{t.kind === 'SEDE' ? 'Sede' : 'Legal entity (ISO 37001)'}</Badge></td><td>{t.rev}</td><td className="small">{itDate(t.rev_date)}</td><td>{t.n_audits}</td><td>{t.active ? <Badge tone="green">Attivo</Badge> : <Badge tone="grey">Non attivo</Badge>}</td>
            <td className="actions"><button className="btn sm ghost" onClick={() => anteprima(t)}><Icon name="eye" />Anteprima</button>{!t.active && <button className="btn sm ghost" disabled={busy} onClick={() => run(() => api.put(`/templates/${t.id}`, { active: true }), 'Modello attivato')}>Attiva</button>}</td></tr>)}</tbody></table>
        <div className="small muted" style={{ marginTop: 8 }}>Il JSON ha la stessa struttura dei modelli iniziali (code, title, rev, rev_date, header_fields, parts &gt; sections &gt; items con n, text, rev, sub, free, repeat; report). La nuova revisione si applica agli audit creati da quel momento; quelli esistenti restano legati alla loro revisione.</div>
      </Card>
      {prev && <Modal title={`${prev.code} rev. ${prev.rev} · ${prev.title}`} onClose={() => setPrev(null)} wide>
        <div className="small muted" style={{ marginBottom: 8 }}>{prev.items.length} voci in {prev.sections.length} sezioni{prev.body.derived_from ? ` · ${prev.body.derived_from}` : ''}</div>
        {prev.sections.map((s) => <div key={s.key} style={{ marginBottom: 10 }}><div className="strong">{s.part_title} · {s.key} {s.title}</div><ol style={{ margin: '4px 0', paddingLeft: 22, fontSize: 13 }}>{prev.items.filter((i) => i.section_key === s.key).map((i) => <li key={i.key} value={undefined}><span className="mono small">{i.key}</span> {i.parent ? <span className="muted">{i.parent} · </span> : null}{i.label}{i.rev ? <span className="small muted"> (rev.)</span> : null}{i.free ? <span className="small muted"> (libera)</span> : null}</li>)}</ol></div>)}
      </Modal>}
    </div>
  );
}

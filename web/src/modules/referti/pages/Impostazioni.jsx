// Impostazioni (Qualità o amministratore): cartella OneDrive di destinazione (per ora informativa), genera anche PDF,
// retention dei PDF sorgente, regola del suffisso, template DOCX della carta intestata; casella template@ (31/10/2026): indirizzo,
// "Leggi la casella", "Invia al mittente", "Prova la casella", "Prova l'invio", "Leggi ora" e stato (ultima lettura, ultimo invio).
import React, { useEffect, useState } from 'react';
import { api, apiBase, useApi } from '../api.js';
import { Card, Field, PageHead, Loading, Switch, useToast, Badge, DropZone, ConfirmModal } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { itDateTime, kb } from '../format.js';

export default function Impostazioni() {
  const toast = useToast();
  const imp = useApi('/settings');
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rimuovi, setRimuovi] = useState(false);
  const cas = useApi('/casella');
  const [prova, setProva] = useState(null);          // { titolo, ok, message, steps }
  const [provaTo, setProvaTo] = useState('');
  useEffect(() => { if (imp.data) setForm({ ...imp.data }); }, [imp.data]);
  const salvaCasella = () => run(async () => { await api.put('/settings', { ...(form.casella_source === 'env' ? {} : { casella_indirizzo: form.casella_indirizzo }), casella_lettura: Boolean(form.casella_lettura), invio_mittente: Boolean(form.invio_mittente) }); cas.reload(); }, 'Casella salvata');
  const prove = async (titolo, fn) => { setBusy(true); setProva(null); try { const r = await fn(); setProva({ titolo, ...r }); } catch (e) { setProva({ titolo, ok: false, message: e.message }); } setBusy(false); cas.reload(); };
  const run = async (fn, ok) => { setBusy(true); try { await fn(); if (ok) toast(ok); imp.reload(); } catch (e) { toast(e, 'err'); } setBusy(false); };
  const salva = () => run(() => api.put('/settings', { onedrive_folder: form.onedrive_folder, genera_pdf: Boolean(form.genera_pdf), retention_giorni: Number(form.retention_giorni) || 0, suffisso_predefinito: form.suffisso_predefinito }), 'Impostazioni salvate');
  const caricaTemplate = (files) => {
    const f = files[0]; if (!f) return;
    if (!/\.docx$/i.test(f.name)) return toast('Il template deve essere un file Word (.docx)', 'err');
    const fd = new FormData(); fd.append('file', f, f.name);
    run(() => api.upload('/settings/template', fd), 'Template caricato: da ora i referti usano la sua carta intestata');
  };
  if (!form) return <div className="page"><Loading /></div>;
  return (
    <div className="page">
      <PageHead title="Impostazioni" icon="gear" sub="Parametri del modulo Referti esterni. I dati aziendali (ragione sociale, piè di pagina) vengono dai Dati aziendali della Suite." />
      <div className="grid rf-two">
        <Card title="Regole" icon="shield" actions={<button className="btn sm" disabled={busy} onClick={salva}>Salva</button>}>
          <div className="rf-form">
            <Field label="Cartella OneDrive di destinazione" help="Per ora solo informativa: l'archiviazione automatica su OneDrive (Microsoft Graph) non è ancora attiva; i file si scaricano dall'Archivio."><input value={form.onedrive_folder || ''} onChange={(e) => setForm({ ...form, onedrive_folder: e.target.value })} /></Field>
            <label className="rf-switch"><Switch checked={Boolean(form.genera_pdf)} onChange={(v) => setForm({ ...form, genera_pdf: v })} label="Genera anche il PDF" /><span>Genera anche il PDF del referto TD alla conferma (oltre al DOCX)</span></label>
            <div className="rf-grid2">
              <Field label="Retention dei PDF sorgente (giorni)" help="0 = i PDF caricati non vengono mai eliminati. Oltre il termine resta la scheda con i file prodotti."><input type="number" min={0} max={3650} value={form.retention_giorni} onChange={(e) => setForm({ ...form, retention_giorni: e.target.value })} /></Field>
              <Field label="Suffisso quando il nome del file esiste già" help='Es. "Referto - CELIN PATRIZIA (KPC).docx".'>
                <select value={form.suffisso_predefinito || 'ESAME'} onChange={(e) => setForm({ ...form, suffisso_predefinito: e.target.value })}>
                  <option value="ESAME">Nome del primo esame (es. KPC, Urinocoltura)</option>
                  <option value="SORGENTE">Laboratorio esterno (es. Bianalisi)</option>
                  <option value="DATA">Data di accettazione</option>
                </select>
              </Field>
            </div>
            <div className="small muted">Archivio dei file: {form.storage === 'blob' ? 'Azure Blob Storage della Suite' : 'database della Suite (Azure Blob non configurato)'}.</div>
          </div>
        </Card>
        <Card title="Carta intestata (template DOCX)" icon="doc">
          <div className="rf-form">
            {form.template ? (
              <div className="rf-alert ok"><Icon name="check" className="ico" /><div><div className="strong">{form.template.filename}</div><div className="small">{kb(form.template.size)} · caricato il {itDateTime(form.template.created_at)}. Intestazione, piè di pagina e impostazioni di pagina dei referti vengono da questo file.</div>
                <div className="row" style={{ marginTop: 8 }}><a className="btn sm ghost" href={`${apiBase}/settings/template`}><Icon name="download" />Scarica</a><button className="btn sm ghost danger" disabled={busy} onClick={() => setRimuovi(true)}><Icon name="trash" />Torna alla predefinita</button></div></div></div>
            ) : (
              <div className="rf-alert warn"><Icon name="alert" className="ico" /><div><div className="strong">Carta intestata predefinita</div><div className="small">È in uso l'intestazione dei documenti Service della Suite (logo e contatti TD). Carica qui il template del referto (es. "Referto - BARONI VERA.docx", carta intestata luglio 2026): il generatore userà intestazione, piè di pagina e margini del file caricato.</div></div></div>
            )}
            <DropZone onFiles={caricaTemplate} accept=".docx" multiple={false} compact><Icon name="upload" /><div className="small">Trascina qui il template .docx oppure clicca per sceglierlo</div></DropZone>
            <div className="small muted">Il contenuto del template viene ignorato: contano solo intestazione, piè di pagina (con numero di pagina) e impostazioni di sezione. Il corpo del referto è generato dal modulo secondo il format canonico TD (font Lato, tabelle senza bordi).</div>
          </div>
        </Card>
      </div>
      <Card title="Casella dei referti da trasformare" icon="mail" actions={<button className="btn sm" disabled={busy} onClick={salvaCasella}>Salva</button>}>
        <div className="rf-two-cols">
          <div className="rf-form">
            <Field label="Casella in lettura" help={form.casella_source === 'env' ? 'Impostata dalla variabile d\'ambiente REFERTI_MAILBOX: si cambia su Render.' : 'I PDF che arrivano a questa casella diventano elaborazioni; il referto riprodotto riparte da qui al mittente.'}>
              <input type="email" value={form.casella_indirizzo || ''} disabled={form.casella_source === 'env'} onChange={(e) => setForm({ ...form, casella_indirizzo: e.target.value })} />
            </Field>
            <label className="rf-switch"><Switch checked={form.casella_lettura !== false} onChange={(v) => setForm({ ...form, casella_lettura: v })} label="Leggi la casella" /><span><b>Leggi la casella</b>: ogni {cas.data?.intervallo_minuti || 10} minuti i PDF allegati alle mail nuove vanno in lavorazione (una scheda per paziente). Le mail senza PDF vengono ignorate e annotate nel registro.</span></label>
            <label className="rf-switch"><Switch checked={form.invio_mittente !== false} onChange={(v) => setForm({ ...form, invio_mittente: v })} label="Invia al mittente" /><span><b>Invia al mittente</b>: un referto con controllo di coerenza verde e senza anomalie viene confermato e inviato in automatico al mittente della mail; gli altri restano da verificare (notifica al Laboratorio) e partono alla conferma.</span></label>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <button className="btn sm ghost" disabled={busy} onClick={() => prove('Prova la casella', () => api.post('/casella/prova'))}><Icon name="search" />Prova la casella</button>
              <input className="rf-in" style={{ maxWidth: 240 }} type="email" placeholder="Destinatario della prova (vuoto: te)" value={provaTo} onChange={(e) => setProvaTo(e.target.value)} />
              <button className="btn sm ghost" disabled={busy} onClick={() => prove('Prova l\'invio', () => api.post('/casella/prova-invio', { to: provaTo || undefined }))}><Icon name="mail" />Prova l'invio</button>
              <button className="btn sm ghost" disabled={busy} onClick={() => prove('Leggi ora', async () => { const r = await api.post('/casella/leggi'); return { ok: true, message: `${r.letti} messaggi letti, ${r.importati} con PDF in lavorazione` }; })}><Icon name="refresh" />Leggi ora</button>
            </div>
            {prova && (
              <div className={`rf-alert ${prova.ok ? (prova.logged ? '' : 'ok') : 'warn'}`}><Icon name={prova.ok ? 'check' : 'alert'} className="ico" /><div><div className="strong">{prova.titolo}</div><div className="small">{prova.message}</div>
                {prova.steps?.length > 0 && <ul className="rf-check" style={{ marginTop: 6 }}>{prova.steps.map((st, i) => <li key={i} className={st.ok ? 'ok' : 'ko'}><Icon name={st.ok ? 'check' : 'alert'} /><div><div>{st.step}</div><div className="small muted">{st.detail}</div></div></li>)}</ul>}</div></div>)}
          </div>
          <div className="rf-form">
            {!cas.data ? <Loading /> : <>
              <div className="rf-stato">
                <div><span className="muted small">Microsoft Graph</span><div>{cas.data.graph_configured ? <Badge tone="green" dot={false}>Configurato</Badge> : <Badge tone="amber" dot={false}>Non configurato</Badge>} <span className="small muted">posta: {cas.data.mail_provider === 'graph' ? 'Microsoft 365' : 'modalità registro'}</span></div></div>
                <div><span className="muted small">Ultima lettura</span><div>{cas.data.ultima_lettura ? itDateTime(cas.data.ultima_lettura) : <span className="muted">mai</span>}</div></div>
                <div><span className="muted small">Ultimo invio</span><div>{cas.data.ultimo_invio ? itDateTime(cas.data.ultimo_invio) : <span className="muted">nessuno</span>}</div></div>
                <div><span className="muted small">Messaggi letti</span><div>{cas.data.messaggi.letti} <span className="small muted">({cas.data.messaggi.importati} con PDF, {cas.data.messaggi.ignorati} ignorati{cas.data.messaggi.simulati ? `, ${cas.data.messaggi.simulati} simulati` : ''})</span></div></div>
                <div><span className="muted small">Invii</span><div>{cas.data.invii.inviati} inviati{cas.data.invii.registrati ? `, ${cas.data.invii.registrati} registrati` : ''}{cas.data.invii.falliti ? <span className="rf-ko">, {cas.data.invii.falliti} non riusciti</span> : ''}</div></div>
              </div>
              {!cas.data.graph_configured && <div className="rf-alert warn"><Icon name="alert" className="ico" /><div className="small">Credenziali Microsoft Graph assenti (ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET su Render): la casella non viene letta. Sull'app registration servono i permessi applicativi <b>Mail.Read</b> e <b>Mail.Send</b> con consenso amministratore e, se c'è una Application Access Policy, la casella {cas.data.mailbox} deve esserne inclusa.</div></div>}
              {cas.data.errore_lettura && <div className="rf-alert warn"><Icon name="alert" className="ico" /><div><div className="strong">Lettura non riuscita</div><div className="small">{cas.data.errore_lettura}</div></div></div>}
              {cas.data.errore_invio && <div className="rf-alert warn"><Icon name="alert" className="ico" /><div><div className="strong">Ultimo invio non riuscito</div><div className="small">{cas.data.errore_invio}</div></div></div>}
              <div className="small muted">Mail al mittente: oggetto "Toscana Diagnostica · Referto COGNOME NOME", PDF del referto allegato, nessun dato clinico nel testo. Mai due invii dello stesso file allo stesso destinatario senza "Reinvia".</div>
            </>}
          </div>
        </div>
      </Card>

      <Card title="Sorgenti riconosciute" icon="info">
        <table className="t"><thead><tr><th>Laboratorio</th><th>Come si riconosce</th><th>Struttura</th></tr></thead>
          <tbody>
            <tr><td><Badge tone="blue" dot={false}>Bianalisi</Badge> Bianalisi S.p.A. – Laboratorio Firenze</td><td className="small">Intestazione "BIANALISI S.p.A. Laboratorio Firenze"; "Referto R3YE… del gg/mm/aaaa", "Accettazione A3YE… del gg/mm/aaaa"; riga "F-16/04/1974 (anni 52)"</td><td className="small">1 paziente per PDF, 1–3 pagine; colonne Analisi / Risultati / Intervalli di Riferimento; antibiogramma testuale</td></tr>
            <tr><td><Badge tone="teal" dot={false}>Cerba RDI</Badge> Rete Diagnostica Italiana (Limena)</td><td className="small">Intestazione "Rete Diagnostica Italiana S.r.l. VIA DEL SANTO 145/147 LIMENA"; "Accettazione n°" e "Data Acc."</td><td className="small">PDF unito con più pazienti, una pagina ciascuno (es. KPC): spezzato per paziente</td></tr>
            <tr><td><Badge tone="mauve" dot={false}>Nuova Igea</Badge> Cerba HealthCare Toscana – Nuova Igea</td><td className="small">Intestazione "Cerba HealthCare Toscana s.r.l. - Nuova Igea, Via Duccio di Buoninsegna 54"; "Accettazione n°" e "Data Acc."</td><td className="small">Blocchi esame con etichetta/valore; antibiogramma tabellare, anche con due microrganismi affiancati (#1 MIC #2 MIC)</td></tr>
          </tbody></table>
        <div className="small muted" style={{ marginTop: 8 }}>I PDF senza intestazione nota e senza anagrafica riconoscibile vengono scartati. I PDF senza testo estraibile passano dall'OCR (italiano) con l'anomalia "verifica manuale obbligatoria".</div>
      </Card>
      {rimuovi && <ConfirmModal title="Torna alla carta intestata predefinita" text="Il template caricato viene disattivato: i prossimi referti useranno l'intestazione predefinita della Suite. I referti già prodotti non cambiano." confirmText="Disattiva il template" danger onConfirm={() => run(() => api.del('/settings/template'), 'Template disattivato').then(() => setRimuovi(false))} onClose={() => setRimuovi(false)} />}
    </div>
  );
}

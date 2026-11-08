// Impostazioni (Qualità o amministratore): cartella OneDrive di destinazione (per ora informativa), genera anche PDF,
// retention dei PDF sorgente, regola del suffisso, template DOCX del referto (predefinito "Format TD (BARONI VERA)" del progetto, o uno
// caricato); "Prova la lettura" (motore del 03/11/2026): un PDF di prova con il JSON e l'anteprima, senza creare schede; casella template@ (31/10/2026): indirizzo,
// "Leggi la casella", "Invia al mittente", "Prova la casella", "Prova l'invio", "Leggi ora" e stato (ultima lettura, ultimo invio).
import React, { useEffect, useState } from 'react';
import { api, apiBase, useApi } from '../api.js';
import { Card, Field, PageHead, Loading, Switch, useToast, Badge, DropZone, ConfirmModal } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { itDateTime, kb, b64ToUrl, LETTURA } from '../format.js';
import { Checklist } from './Scheda.jsx';
import { Anomalie } from './Inbox.jsx';

export default function Impostazioni() {
  const toast = useToast();
  const imp = useApi('/settings');
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rimuovi, setRimuovi] = useState(false);
  const cas = useApi('/casella');
  const [prova, setProva] = useState(null);          // { titolo, ok, message, steps }
  const [provaTo, setProvaTo] = useState('');
  const [lettura, setLettura] = useState(null);      // esito di "Prova la lettura": { modo, schede: [{ dati, anomalie, coerenza, url }] }
  const [schedaProva, setSchedaProva] = useState(0);
  const provaLettura = async (files) => {
    const f = files[0]; if (!f) return;
    if (!/\.pdf$/i.test(f.name)) return toast('Serve un file PDF', 'err');
    const fd = new FormData(); fd.append('file', f, f.name);
    setBusy(true); setLettura(null);
    try {
      const r = await api.upload('/settings/prova-lettura', fd);
      setLettura({ ...r, filename: f.name, schede: r.schede.map((s) => ({ ...s, url: s.pdf ? b64ToUrl(s.pdf, 'application/pdf') : null })) }); setSchedaProva(0);
    } catch (e) { toast(e, 'err'); }
    setBusy(false);
  };
  useEffect(() => { if (imp.data) setForm({ ...imp.data }); }, [imp.data]);
  const salvaCasella = () => run(async () => { await api.put('/settings', { ...(form.casella_source === 'env' ? {} : { casella_indirizzo: form.casella_indirizzo }), casella_lettura: Boolean(form.casella_lettura), invio_mittente: Boolean(form.invio_mittente) }); cas.reload(); }, 'Casella salvata');
  const prove = async (titolo, fn) => { setBusy(true); setProva(null); try { const r = await fn(); setProva({ titolo, ...r }); } catch (e) { setProva({ titolo, ok: false, message: e.message }); } setBusy(false); cas.reload(); };
  const run = async (fn, ok) => { setBusy(true); try { await fn(); if (ok) toast(ok); imp.reload(); } catch (e) { toast(e, 'err'); } setBusy(false); };
  const salva = () => run(() => api.put('/settings', { onedrive_folder: form.onedrive_folder, genera_pdf: Boolean(form.genera_pdf), retention_mesi: form.retention_mesi === '' ? 24 : Number(form.retention_mesi), suffisso_predefinito: form.suffisso_predefinito }), 'Impostazioni salvate');
  const caricaTemplate = (files) => {
    const f = files[0]; if (!f) return;
    if (!/\.docx$/i.test(f.name)) return toast('Il template deve essere un file Word (.docx)', 'err');
    const fd = new FormData(); fd.append('file', f, f.name);
    run(() => api.upload('/settings/template', fd), 'Template caricato: da ora i referti usano la sua intestazione e il suo piè di pagina');
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
              <Field label="Conservazione dei PDF sorgente (mesi)" help="Predefinito 24 mesi; 0 = i PDF caricati non vengono mai eliminati. Oltre il termine restano la scheda e i file prodotti."><input type="number" min={0} max={120} value={form.retention_mesi ?? 24} onChange={(e) => setForm({ ...form, retention_mesi: e.target.value })} /></Field>
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
        <Card title="Template del referto (format TD)" icon="doc">
          <div className="rf-form">
            {form.template ? (
              <div className="rf-alert ok"><Icon name="check" className="ico" /><div><div className="strong">{form.template.filename}</div><div className="small">{kb(form.template.size)} · caricato il {itDateTime(form.template.created_at)}. Intestazione, piè di pagina e margini dei referti vengono da questo file; il corpo resta quello del generatore del progetto.</div>
                <div className="row" style={{ marginTop: 8 }}><a className="btn sm ghost" href={`${apiBase}/settings/template`}><Icon name="download" />Scarica</a><button className="btn sm ghost danger" disabled={busy} onClick={() => setRimuovi(true)}><Icon name="trash" />Torna al predefinito</button></div></div></div>
            ) : (
              <div className="rf-alert ok"><Icon name="check" className="ico" /><div><div className="strong">Predefinito: {form.template_predefinito || 'Format TD (BARONI VERA)'}</div><div className="small">Il template del progetto dedicato (carta intestata TD con logo, contatti e piè di pagina a 3 righe): i referti escono identici a quelli prodotti dal progetto.</div>
                <div className="row" style={{ marginTop: 8 }}><a className="btn sm ghost" href={`${apiBase}/settings/template-predefinito`}><Icon name="download" />Scarica il predefinito</a></div></div></div>
            )}
            <DropZone onFiles={caricaTemplate} accept=".docx" multiple={false} compact><Icon name="upload" /><div className="small">Carica un altro template .docx (trascinalo qui o clicca)</div></DropZone>
            <div className="small muted">Del template contano solo l'inizio del documento fino al corpo e le proprietà di sezione (intestazione, piè di pagina con numero di pagina, margini): il corpo viene sostituito con quello generato. Serve un word/document.xml con &lt;w:body&gt; e &lt;w:sectPr&gt;.</div>
          </div>
        </Card>
      </div>
      <Card title="Prova la lettura" icon="sparkle">
        <div className="rf-two-cols">
          <div className="rf-form">
            <div className="small">Carica un PDF di prova: viene letto come in Inbox ({LETTURA[form.lettura?.modo]?.label || form.lettura?.nome || 'lettura'}) e qui compaiono il JSON della scheda, le anomalie, il controllo di coerenza e l'anteprima del referto. <b>Non si crea nessuna scheda</b> e nulla viene salvato.</div>
            {form.lettura?.modo === 'RISERVA' && <div className="rf-alert warn"><Icon name="alert" className="ico" /><div className="small">Chiave Anthropic non configurata (Amministrazione &gt; Impostazioni &gt; Claude): la lettura usa il parser di riserva.</div></div>}
            {form.lettura?.modo === 'MOCK' && <div className="rf-alert"><Icon name="info" className="ico" /><div className="small">REFERTI_AI_MOCK attiva: lettura simulata con i JSON di collaudo, non il modello.</div></div>}
            <DropZone onFiles={provaLettura} accept="application/pdf,.pdf" multiple={false} compact><Icon name="upload" /><div className="small">{busy ? 'Lettura in corso' : 'Trascina qui il PDF di prova oppure clicca'}</div></DropZone>
            {lettura && (lettura.non_referto ? <div className="rf-alert warn"><Icon name="x" className="ico" /><div><div className="strong">{lettura.filename}: non è un referto</div><div className="small">{lettura.motivo}</div></div></div> : <>
              <div className="small"><b>{lettura.filename}</b> · {lettura.modo_nome} · {lettura.pagine} {lettura.pagine === 1 ? 'pagina' : 'pagine'} · {lettura.schede.length} {lettura.schede.length === 1 ? 'scheda' : 'schede'} · {Math.round((lettura.ms || 0) / 100) / 10} s{lettura.errore_claude ? ` · lettura con Claude non riuscita: ${lettura.errore_claude}` : ''}</div>
              {lettura.schede.length > 1 && <select className="rf-in" value={schedaProva} onChange={(e) => setSchedaProva(Number(e.target.value))}>{lettura.schede.map((s, i) => <option key={i} value={i}>{s.dati.anagrafica.cognome_nome || `Scheda ${i + 1}`} · pagg. {s.pagine.join(', ')}</option>)}</select>}
              {lettura.schede[schedaProva] && <>
                <Anomalie list={lettura.schede[schedaProva].anomalie} />
                <Checklist coerenza={lettura.schede[schedaProva].coerenza} />
                <pre className="rf-prova-json">{JSON.stringify(lettura.schede[schedaProva].dati, null, 1)}</pre>
              </>}
            </>)}
          </div>
          <div>{lettura?.schede?.[schedaProva]?.url ? <iframe title="Anteprima della prova" className="rf-prova-frame" src={lettura.schede[schedaProva].url} /> : <div className="rf-placeholder" style={{ height: 300, minHeight: 300 }}><Icon name="eye" /><div>L'anteprima del referto compare qui.</div></div>}</div>
        </div>
      </Card>
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

      <LaboratoriOrigine />

      <Card title="Sorgenti riconosciute" icon="info">
        <table className="t"><thead><tr><th>Laboratorio</th><th>Come si riconosce</th><th>Struttura</th></tr></thead>
          <tbody>
            <tr><td><Badge tone="blue" dot={false}>Bianalisi</Badge> Bianalisi S.p.A. – Laboratorio Firenze</td><td className="small">Intestazione "BIANALISI S.p.A. Laboratorio Firenze"; "Referto R3YE… del gg/mm/aaaa", "Accettazione A3YE… del gg/mm/aaaa"; riga "F-16/04/1974 (anni 52)"</td><td className="small">1 paziente per PDF, 1–3 pagine; colonne Analisi / Risultati / Intervalli di Riferimento; antibiogramma testuale</td></tr>
            <tr><td><Badge tone="teal" dot={false}>Cerba RDI</Badge> Rete Diagnostica Italiana (Limena)</td><td className="small">Intestazione "Rete Diagnostica Italiana S.r.l. VIA DEL SANTO 145/147 LIMENA"; "Accettazione n°" e "Data Acc."</td><td className="small">PDF unito con più pazienti, una pagina ciascuno (es. KPC): spezzato per paziente</td></tr>
            <tr><td><Badge tone="mauve" dot={false}>Nuova Igea</Badge> Cerba HealthCare Toscana – Nuova Igea</td><td className="small">Intestazione "Cerba HealthCare Toscana s.r.l. - Nuova Igea, Via Duccio di Buoninsegna 54"; "Accettazione n°" e "Data Acc."</td><td className="small">Blocchi esame con etichetta/valore; antibiogramma tabellare, anche con due microrganismi affiancati (#1 MIC #2 MIC)</td></tr>
          </tbody></table>
        <div className="small muted" style={{ marginTop: 8 }}>La lettura la fa Claude sul PDF (con il testo estratto come aiuto): i PDF che non sono referti vengono scartati con il motivo. I PDF senza testo estraibile passano anche dall'OCR (italiano) con l'anomalia "verifica manuale obbligatoria". Senza chiave Anthropic si usano i parser di riserva, che riconoscono le tre sorgenti dall'intestazione.</div>
      </Card>
      {rimuovi && <ConfirmModal title="Torna al template predefinito" text={`Il template caricato viene disattivato: i prossimi referti useranno il predefinito ${form.template_predefinito || 'Format TD (BARONI VERA)'}. I referti già prodotti non cambiano.`} confirmText="Disattiva il template" danger onConfirm={() => run(() => api.del('/settings/template'), 'Template disattivato').then(() => setRimuovi(false))} onClose={() => setRimuovi(false)} />}
    </div>
  );
}

// C12 (programma anagrafica unica): ogni laboratorio di origine è una Legal entity di Amministrazione > Legal entity
function LaboratoriOrigine() {
  const toast = useToast();
  const { data, reload } = useApi('/settings/laboratori');
  const [sel, setSel] = useState({});
  if (!data) return null;
  const val = (l) => sel[l.sorgente] ?? (l.org?.id || '');
  const salva = async () => { try { await api.put('/settings/laboratori', Object.fromEntries(data.laboratori.map((l) => [l.sorgente, val(l) || null]))); toast('Laboratori collegati alle Legal entity'); setSel({}); reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Card title="Laboratori di origine e Legal entity" icon="building" actions={<button className="btn sm" onClick={salva}>Salva</button>}>
      <p className="small muted" style={{ marginTop: 0 }}>Ogni laboratorio esterno è una Legal entity dell'anagrafica (Amministrazione &gt; Legal entity): serve ai conteggi per cliente e fornitore. Se manca, la Suite propone quella con il nome più simile.</p>
      <table className="t"><tbody>{data.laboratori.map((l) => <tr key={l.sorgente}>
        <td className="strong">{l.label}</td>
        <td><select value={val(l)} onChange={(e) => setSel({ ...sel, [l.sorgente]: e.target.value })}><option value="">{l.proposta ? `Proposta: ${l.proposta.name} (scegli per confermare)` : 'Non collegato'}</option>{data.organizzazioni.map((o) => <option key={o.id} value={o.id}>{o.name}{o.vat_number ? ` · ${o.vat_number}` : ''}</option>)}</select></td>
        <td className="small">{l.org ? <Badge tone="green">collegato</Badge> : l.proposta ? <button className="btn sm ghost" onClick={() => setSel({ ...sel, [l.sorgente]: String(l.proposta.id) })}>Usa la proposta</button> : <Badge tone="amber">da collegare</Badge>}</td>
      </tr>)}</tbody></table>
    </Card>
  );
}

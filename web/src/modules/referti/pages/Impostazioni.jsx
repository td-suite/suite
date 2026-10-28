// Impostazioni (Qualità o amministratore): cartella OneDrive di destinazione (per ora informativa), genera anche PDF,
// retention dei PDF sorgente, regola del suffisso, template DOCX della carta intestata.
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
  useEffect(() => { if (imp.data) setForm({ ...imp.data }); }, [imp.data]);
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

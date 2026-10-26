// Nuova circolare: da file grezzo del laboratorio (DOCX, PDF, TXT) o testo incollato, con strutturazione automatica,
// oppure scheda vuota da compilare. In entrambi i casi nasce una bozza che si rifinisce nella pagina della circolare.
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, base, useApi } from '../api.js';
import { Card, Field, DropZone, useToast, PageHead, Seg } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { SEGMENTO } from '../format.js';

export default function Nuova() {
  const nav = useNavigate();
  const toast = useToast();
  const caps = useApi('/capabilities');
  const [mode, setMode] = useState('file');
  const [file, setFile] = useState(null);
  const [testo, setTesto] = useState('');
  const [hint, setHint] = useState('');
  const [segmento, setSegmento] = useState('CLIENTI_SERVICE');
  const [ai, setAi] = useState(true);
  const [titolo, setTitolo] = useState('');
  const [busy, setBusy] = useState(false);

  const importa = async () => {
    if (mode === 'file' && !file) return toast('Scegli un file', 'err');
    if (mode === 'testo' && !testo.trim()) return toast('Incolla il testo della bozza', 'err');
    setBusy(true);
    try {
      const fd = new FormData();
      if (mode === 'file') fd.append('file', file); else fd.append('testo', testo);
      fd.append('hint', hint); fd.append('segmento', segmento); fd.append('ai', ai ? '1' : '0');
      const c = await api.upload('/circolari/importa', fd);
      toast(c.ai ? 'Bozza strutturata con Claude: controlla e rifinisci' : c.ai_error ? `Strutturazione automatica non riuscita (${c.ai_error}): bozza creata con regole semplici` : 'Bozza creata: controlla e rifinisci');
      nav(`${base}/${c.id}`);
    } catch (e) { toast(e, 'err'); }
    setBusy(false);
  };
  const vuota = async () => {
    if (titolo.trim().length < 3) return toast('Indica il titolo', 'err');
    setBusy(true);
    try { const c = await api.post('/circolari', { titolo: titolo.trim(), segmento, corpo: [{ type: 'paragrafo', text: 'Gentile Cliente,' }, { type: 'paragrafo', text: '' }] }); nav(`${base}/${c.id}`); }
    catch (e) { toast(e, 'err'); }
    setBusy(false);
  };

  return (
    <div className="page narrow">
      <PageHead title="Nuova circolare" icon="plus" sub="Il laboratorio o l'ufficio scrive la circolare come preferisce, anche in orizzontale: qui entra il file grezzo e ne esce la bozza nel format aziendale, da rifinire e pubblicare." />
      <div style={{ marginBottom: 14 }}><Seg value={mode} onChange={setMode} label="Origine" items={[{ value: 'file', label: 'Da file' }, { value: 'testo', label: 'Da testo incollato' }, { value: 'vuota', label: 'Scheda vuota' }]} /></div>
      {mode !== 'vuota' ? (
        <Card title={mode === 'file' ? 'Bozza grezza' : 'Testo della bozza'} icon="upload">
          <div className="circ-form">
            {mode === 'file' ? (
              <DropZone multiple={false} accept=".docx,.pdf,.txt,.md" onFiles={(fs) => setFile(fs[0])}>
                <Icon name="upload" /><div>{file ? <><b>{file.name}</b> <span className="muted">({Math.round(file.size / 1024)} KB)</span></> : 'Trascina qui il DOCX, PDF o TXT del laboratorio, oppure clicca per sceglierlo'}</div>
              </DropZone>
            ) : (
              <Field label="Testo"><textarea rows={12} value={testo} onChange={(e) => setTesto(e.target.value)} placeholder="Incolla qui il testo della circolare. Le righe vuote separano i paragrafi; le righe con tabulazioni o con ' | ' diventano tabelle." /></Field>
            )}
            <div className="two">
              <Field label="Destinatari"><select value={segmento} onChange={(e) => setSegmento(e.target.value)}>{Object.entries(SEGMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="Strutturazione" help={caps.data && !caps.data.ai ? 'Claude non è configurato nella Suite: la bozza viene strutturata con regole semplici.' : 'Claude ricava titolo, sintesi, sezioni e tabelle dalla bozza senza alterare numeri, date e condizioni.'}>
                <select value={ai ? '1' : '0'} onChange={(e) => setAi(e.target.value === '1')} disabled={caps.data && !caps.data.ai}><option value="1">Con Claude</option><option value="0">Solo regole semplici</option></select>
              </Field>
            </div>
            <Field label="Indicazioni per la strutturazione (facoltative)" help="Esempio: circolare per i clienti service, tono formale, mettere in evidenza la decorrenza dal 1° novembre."><input value={hint} onChange={(e) => setHint(e.target.value)} maxLength={500} /></Field>
            <div className="row end"><button className="btn" disabled={busy} onClick={importa}><Icon name="sparkle" />Crea la bozza</button></div>
          </div>
        </Card>
      ) : (
        <Card title="Scheda vuota" icon="edit">
          <div className="circ-form">
            <Field label="Titolo" required><input value={titolo} onChange={(e) => setTitolo(e.target.value)} maxLength={200} placeholder="Es. Nuovi tempi di refertazione per i clienti in service" /></Field>
            <Field label="Destinatari"><select value={segmento} onChange={(e) => setSegmento(e.target.value)}>{Object.entries(SEGMENTO).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
            <div className="row end"><button className="btn" disabled={busy} onClick={vuota}><Icon name="plus" />Crea la bozza</button></div>
          </div>
        </Card>
      )}
    </div>
  );
}

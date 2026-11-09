import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApi, Card, Field, Loading, Badge, useToast, PromptModal } from '../components/ui.jsx';
import { num, itDate } from '../format.js';
import { metri } from '../components/Intorno.jsx';

const GROUPS = [
  { title: 'Azienda', keys: [['company_name', 'Ragione sociale'], ['company_website', 'Sito web'], ['brand_claim', 'Claim istituzionale']] },
  { title: 'Segmentazione clienti', keys: [['age_bands', 'Fasce di età (es. 0-17,18-29,30-44,45-59,60-74,75+)'], ['returning_days', 'Giorni per considerare un cliente "di ritorno"'], ['churn_days', 'Giorni senza visite oltre i quali un cliente è dormiente']] },
  { title: 'Dashboard e retail', keys: [['top_products_limit', 'Prestazioni nelle classifiche'], ['exposure_check_days', 'Frequenza attesa delle verifiche in sede (giorni)'], ['promo_change_day', 'Giorno del mese entro cui sostituire i materiali promo']] },
];

export default function Settings() {
  const toast = useToast();
  const d = useApi('/settings');
  const [v, setV] = useState({});
  const [confirm, setConfirm] = useState(null);
  useEffect(() => { if (d.data) setV(d.data.settings); }, [d.data]);
  if (!d.data) return <div className="page"><Loading /></div>;
  const save = async () => { try { await api.put('/settings', v); toast('Impostazioni salvate'); d.reload(); window.dispatchEvent(new Event('suite:badges')); } catch (e) { toast(e.message, 'err'); } };
  const c = d.data.counts;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Impostazioni</h1><div className="sub">Parametri della dashboard, stato dell'installazione e set dimostrativo.</div></div><button className="btn" onClick={save}>Salva impostazioni</button></div>
      <div className="grid g2" style={{ marginBottom: 16 }}>
        <Card title="Stato dell'installazione">
          <p>Accesso Microsoft 365 (gestito dalla Suite): {d.data.entraEnabled ? <Badge tone="green">attivo</Badge> : <Badge tone="grey">non configurato</Badge>}</p>
          <p>Proposte di claim con API Claude: {d.data.aiEnabled ? <Badge tone="green">attive</Badge> : <Badge tone="grey">non configurate (ANTHROPIC_API_KEY): schemi standard</Badge>}</p>
          <p className="small muted">Dimensione massima dei file da importare: {d.data.maxUploadMb} MB. Dati presenti: {num(c.sales)} righe di vendita, {num(c.customers)} clienti, {num(c.products)} prestazioni{c.demo_sales ? ` (di cui ${num(c.demo_sales)} righe dimostrative)` : ''}.</p>
        </Card>
        <Card title="Set dimostrativo">
          <p className="small muted">Dati fittizi ma coerenti con le sedi reali e il listino: 1.800 pazienti, 20 clienti B2B, 15 mesi di vendite, calendario promozionale, campagne ed esposizione. Serve per vedere la dashboard prima degli import reali. Si carica solo su database senza vendite e si rimuove in un clic.</p>
          <div className="row">
            <button className="btn ghost" disabled={c.sales > 0} onClick={() => setConfirm('load')}>Carica set dimostrativo</button>
            <button className="btn danger" disabled={!c.demo_sales} onClick={() => setConfirm('clear')}>Rimuovi dati dimostrativi</button>
          </div>
        </Card>
      </div>
      <Card title="Ripartizione delle accettazioni StudioLab (B2C / B2B)" className="mt">
        <div className="form-grid">
          <Field label="Accettazioni Synclab dei punti TD" className="span2" help="Decisione del CEO del 09/11/2026 (salvo contrordine): i client StudioLab abbinati a una sede TD sono il &quot;Laboratorio in sede&quot; della sezione B2C; i client di Legal entity esterne e quelli non abbinati sono B2B. Spento: tutto StudioLab è B2B e la voce &quot;Laboratorio in sede&quot; sparisce dal menu.">
            <select data-testid="synclab-privati" value={String(v.synclab_privati_in_b2c ?? 'true')} onChange={(e) => setV({ ...v, synclab_privati_in_b2c: e.target.value })}>
              <option value="true">Nel B2C come &quot;Laboratorio in sede&quot; (predefinito)</option>
              <option value="false">Nel B2B (tutto StudioLab è B2B)</option>
            </select>
          </Field>
        </div>
      </Card>
      <div className="grid g2" style={{ marginTop: 16 }}>
        {GROUPS.map((g) => <Card key={g.title} title={g.title}><div className="form-grid">{g.keys.map(([k, l]) => <Field key={k} label={l} className={k === 'age_bands' || k === 'brand_claim' ? 'span2' : ''}><input value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>)}</div></Card>)}
        <Card title="Variabili d'ambiente (Suite)">
          <table className="t small"><tbody>
            <tr><td className="mono">ANTHROPIC_API_KEY</td><td>facoltativa: proposte di claim e lettura degli scostamenti su misura (altrimenti schemi standard)</td></tr>
            <tr><td className="mono">RETAIL_SESSION_SECRET</td><td>SESSION_SECRET dell'app di origine: serve a leggere le credenziali dei connettori cifrate prima del travaso (altrimenti vanno reinserite)</td></tr>
            <tr><td className="mono">MAX_UPLOAD_MB</td><td>limite dei file di import e delle foto</td></tr>
          </tbody></table>
        </Card>
      </div>
      <SezioneIntorno />
      {/* conferma con testo digitato (debug pre-produzione, A1): in produzione la richiede il server ed è riservata al titolare */}
      {confirm === 'load' && <PromptModal title="Carica set dimostrativo" label={`Vengono inseriti clienti, prestazioni, vendite, promozioni, campagne ed esposizione dimostrativi, marcati come demo. Per confermare scrivi: ${d.data.conferma_demo?.load || 'CARICA DATI DIMOSTRATIVI'}`} confirmText="Carica" help={d.data.demo_protetta ? 'Installazione di produzione: operazione riservata al titolare della Suite.' : undefined} onClose={() => setConfirm(null)} onConfirm={async (testo) => { const r = await api.post('/demo/load', { conferma: testo }); toast(`Demo caricata: ${num(r.sales)} righe di vendita`); d.reload(); }} />}
      {confirm === 'clear' && <PromptModal title="Rimuovi dati dimostrativi" label={`Vengono eliminate solo le righe marcate come demo (vendite, clienti, prestazioni, promozioni, campagne, esposizione, orari, dotazioni, budget). I dati reali e quelli importati dai gestionali restano. Per confermare scrivi: ${d.data.conferma_demo?.clear || 'RIMUOVI DATI DIMOSTRATIVI'}`} confirmText="Rimuovi" help={d.data.demo_protetta ? 'Installazione di produzione: operazione riservata al titolare della Suite.' : undefined} onClose={() => setConfirm(null)} onConfirm={async (testo) => { await api.post('/demo/clear', { conferma: testo }); toast('Dati dimostrativi rimossi'); d.reload(); }} />}
    </div>
  );
}

// Intorno (Google Places, docs/RETAIL_INTORNO.md): raggi, categorie attive, tetto giornaliero, contatore, prova della chiave e
// rilevazione mensile a mano. Le chiavi sono solo variabili d'ambiente: qui si vede se ci sono, mai il valore.
function SezioneIntorno() {
  const toast = useToast();
  const d = useApi('/intorno/impostazioni');
  const [v, setV] = useState(null);
  const [prova, setProva] = useState(null);
  const [busy, setBusy] = useState('');
  useEffect(() => { if (d.data) setV({ ...d.data.impostazioni }); }, [d.data]);
  if (d.error) return <div style={{ marginTop: 16 }}><Card title="Intorno"><p className="small red">{d.error.message}</p></Card></div>;
  if (!d.data || !v) return null;
  const { contatore: c, config, predefiniti } = d.data;
  const salva = async () => {
    try { await api.put('/intorno/impostazioni', { tetto_giornaliero: Number(v.tetto_giornaliero), raggio_urbano: Number(v.raggio_urbano), raggio_extraurbano: Number(v.raggio_extraurbano), sottocategorie: v.sottocategorie }); toast('Impostazioni Intorno salvate'); d.reload(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const provaChiave = async () => { setBusy('prova'); try { setProva(await api.post('/intorno/prova')); d.reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); } };
  const job = async () => { setBusy('job'); try { const r = await api.post('/intorno/job'); toast(r.error ? r.error : r.skipped ? `Non eseguita: ${r.reason}` : `Rilevate ${r.eseguite?.length || 0} sedi${r.fermata_dal_tetto ? ' (fermata dal tetto giornaliero)' : ''}`, r.error ? 'err' : undefined); d.reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(''); } };
  const spunta = (k, on) => setV({ ...v, sottocategorie: on ? [...v.sottocategorie, k] : v.sottocategorie.filter((x) => x !== k) });
  const cat = config.categorie;
  return (
    <div className="grid g2" style={{ marginTop: 16 }}>
      <Card title="Intorno: cosa c'è intorno alle sedi" actions={<button className="btn sm" onClick={salva}>Salva</button>}>
        <div className="form-grid">
          <Field label="Raggio delle sedi (m)" help={`Predefinito ${num(predefiniti.raggio_urbano)}`}><input type="number" min="100" max="50000" value={v.raggio_urbano} onChange={(e) => setV({ ...v, raggio_urbano: e.target.value })} /></Field>
          <Field label="Raggio delle sedi extraurbane (m)" help={`Predefinito ${num(predefiniti.raggio_extraurbano)}; "Sede extraurbana" si spunta in Amministrazione > Sedi`}><input type="number" min="100" max="50000" value={v.raggio_extraurbano} onChange={(e) => setV({ ...v, raggio_extraurbano: e.target.value })} /></Field>
          <Field label="Tetto giornaliero di chiamate a Google" help={`Predefinito ${num(predefiniti.tetto_giornaliero)}; oltre il tetto le rilevazioni si fermano con un errore`}><input type="number" min="0" value={v.tetto_giornaliero} onChange={(e) => setV({ ...v, tetto_giornaliero: e.target.value })} /></Field>
          <Field label="Chiamate"><input disabled value={`oggi ${num(c.oggi)} su ${num(c.tetto_giornaliero)} · nel mese ${num(c.mese)}`} /></Field>
        </div>
        <div style={{ marginTop: 12 }}>
          {Object.entries(cat).map(([k, ct]) => <div key={k} style={{ marginBottom: 8 }}>
            <div className="small strong" style={{ color: ct.colore }}>{ct.etichetta}</div>
            {config.sottocategorie.filter((s) => s.categoria === k).map((s) => <label key={s.chiave} className="small" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginRight: 14 }} title={s.fonti.join(' + ')}>
              <input type="checkbox" style={{ width: 'auto' }} checked={v.sottocategorie.includes(s.chiave)} onChange={(e) => spunta(s.chiave, e.target.checked)} />{s.etichetta}</label>)}
          </div>)}
          <p className="small muted" style={{ marginBottom: 0 }}>Ogni categoria attiva costa una chiamata per rilevazione (il laboratorio di analisi due). {config.formula}.</p>
        </div>
      </Card>
      <Card title="Chiavi Google e prova" actions={<><button className="btn sm ghost" disabled={busy === 'job'} onClick={job} title="Rileva ora le sedi senza una rilevazione nel mese, fino al tetto">{busy === 'job' ? 'In corso…' : 'Esegui ora la rilevazione mensile'}</button><button className="btn sm" disabled={busy === 'prova'} onClick={provaChiave}>{busy === 'prova' ? 'Provo…' : 'Prova la chiave'}</button></>}>
        <table className="t small"><tbody>
          <tr><td className="mono">GOOGLE_MAPS_SERVER_KEY</td><td>{config.mock ? <Badge tone="grey">risposte di prova (INTORNO_MOCK)</Badge> : config.chiave_server ? <Badge tone="green">impostata</Badge> : <Badge tone="red">mancante</Badge>} Places API (New) e Geocoding, solo lato server</td></tr>
          <tr><td className="mono">GOOGLE_MAPS_BROWSER_KEY</td><td>{config.chiave_browser ? <Badge tone="green">impostata</Badge> : <Badge tone="grey">mancante: niente mappa, resta la tabella</Badge>} Maps JavaScript, limitata al dominio della Suite</td></tr>
        </tbody></table>
        {prova && <div style={{ marginTop: 12 }}>
          <p className="small" style={{ margin: '0 0 6px' }}>{prova.ok ? <Badge tone="green">risposta {prova.status}</Badge> : <Badge tone="red">{prova.status ? `errore ${prova.status}` : 'nessuna risposta'}</Badge>} chiave {prova.chiave} · {num(prova.ms)} ms · {num(prova.luoghi)} farmacie entro {metri(prova.richiesta.corpo.locationRestriction.circle.radius)}{prova.errore ? ` · ${prova.errore}` : ''}</p>
          <pre className="small" style={{ maxHeight: 320, overflow: 'auto', background: '#f3f6f6', padding: 10, borderRadius: 8, whiteSpace: 'pre-wrap' }}>{prova.risposta_grezza || '(risposta vuota)'}</pre>
        </div>}
        <p className="small muted" style={{ marginBottom: 0 }}>La prova fa una chiamata (conteggiata nel tetto) di farmacie entro 500 m dalla prima sede con coordinate e mostra la risposta grezza di Google. Rilevazione mensile automatica ogni giorno per le sedi non ancora rilevate nel mese ({c.giorno ? `oggi ${itDate(c.giorno)}` : ''}).</p>
      </Card>
    </div>
  );
}

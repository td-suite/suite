import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApi, Card, Field, Loading, Badge, useToast, ConfirmModal } from '../components/ui.jsx';
import { num } from '../format.js';

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
  const save = async () => { try { await api.put('/settings', v); toast('Impostazioni salvate'); d.reload(); } catch (e) { toast(e.message, 'err'); } };
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
      <div className="grid g2">
        {GROUPS.map((g) => <Card key={g.title} title={g.title}><div className="form-grid">{g.keys.map(([k, l]) => <Field key={k} label={l} className={k === 'age_bands' || k === 'brand_claim' ? 'span2' : ''}><input value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>)}</div></Card>)}
        <Card title="Variabili d'ambiente (Suite)">
          <table className="t small"><tbody>
            <tr><td className="mono">ANTHROPIC_API_KEY</td><td>facoltativa: proposte di claim e lettura degli scostamenti su misura (altrimenti schemi standard)</td></tr>
            <tr><td className="mono">RETAIL_SESSION_SECRET</td><td>SESSION_SECRET dell'app di origine: serve a leggere le credenziali dei connettori cifrate prima del travaso (altrimenti vanno reinserite)</td></tr>
            <tr><td className="mono">MAX_UPLOAD_MB</td><td>limite dei file di import e delle foto</td></tr>
          </tbody></table>
        </Card>
      </div>
      {confirm === 'load' && <ConfirmModal title="Carica set dimostrativo" text="Vengono inseriti clienti, prestazioni, vendite, promozioni, campagne ed esposizione dimostrativi. Procedere?" confirmText="Carica" onClose={() => setConfirm(null)} onConfirm={async () => { const r = await api.post('/demo/load'); toast(`Demo caricata: ${num(r.sales)} righe di vendita`); d.reload(); }} />}
      {confirm === 'clear' && <ConfirmModal danger title="Rimuovi dati dimostrativi" text="Vengono eliminati vendite, clienti, prestazioni, promozioni, campagne ed esposizione del set dimostrativo. I dati importati dai gestionali restano." confirmText="Rimuovi" onClose={() => setConfirm(null)} onConfirm={async () => { await api.post('/demo/clear'); toast('Dati dimostrativi rimossi'); d.reload(); }} />}
    </div>
  );
}

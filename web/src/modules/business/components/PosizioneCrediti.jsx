// Scheda account del Business Hub · posizione creditizia del cliente dal widget Recupero Crediti (v0.95.0): aperto, scaduto, ultima
// fase della scala, promesse. Sola lettura; chi ha il widget apre da qui la scheda crediti. Se il widget non è attivo non mostra nulla.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api as suite } from '../../../api.js';
import { Card, Badge } from './ui.jsx';

const eur = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' }).format(Number(n || 0));
const itData = (d) => { const s = String(d || '').slice(0, 10); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : ''; };
const STATO = { REGOLARE: ['green', 'Regolare'], SCADUTO: ['amber', 'Scaduto'], IN_SOLLECITO: ['amber', 'In sollecito'], PROMESSA: ['blue', 'Promessa o piano di rientro'], SOSPESO: ['blue', 'Scala sospesa'], CONTESTAZIONE: ['mauve', 'Contestazione aperta'], LEGALE: ['red', 'Area legale'], ESCLUSO: ['grey', 'Escluso dai solleciti'] };

export default function PosizioneCrediti({ orgId }) {
  const [d, setD] = useState(null);
  useEffect(() => { let vivo = true; setD(null); if (orgId) suite.get(`/crediti/posizione-cliente/${orgId}`, { silent: true }).then((x) => vivo && setD(x)).catch(() => vivo && setD({ attivo: false })); return () => { vivo = false; }; }, [orgId]);
  if (!d?.attivo) return null;
  const p = d.posizione;
  return (
    <Card title="Crediti verso il cliente" className="mt" actions={d.apre && <Link className="btn sm ghost" to={`/crediti/clienti/${orgId}`}>Apri nel Recupero Crediti</Link>}>
      {!p ? <div className="small muted">Nessuna fattura aperta.</div> : <div className="grid g3">
        <div className="kpi card"><div className="lbl">Fatture aperte</div><div className="val">{eur(p.totale)}</div><div className="foot">{p.fatture} {p.fatture === 1 ? 'fattura' : 'fatture'}</div></div>
        <div className="kpi card accent"><div className="lbl">Scaduto</div><div className="val">{eur(p.scaduto)}</div><div className="foot">{p.giorni_max ? `fino a ${p.giorni_max} giorni di ritardo` : 'nessun ritardo'}</div></div>
        <div className="kpi card"><div className="lbl">Stato</div><div className="val" style={{ fontSize: 16 }}><Badge tone={STATO[p.stato]?.[0]}>{STATO[p.stato]?.[1] || p.stato}</Badge></div><div className="foot">{p.fase_label ? `ultima fase: ${p.fase_label}` : 'nessun sollecito inviato'}{p.promessa ? ` · impegno al ${itData(p.promessa.data)}` : ''}{p.contestato > 0 ? ` · contestati ${eur(p.contestato)}` : ''}</div></div>
      </div>}
    </Card>
  );
}

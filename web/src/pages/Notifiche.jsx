// Notifiche (v0.99.3, richiesta del CEO del 26/11/2026): pagina con tutte le notifiche dell'utente, ognuna collegata alla pagina che la
// riguarda. Ci arrivano il riquadro "notifiche da leggere" della Home (che prima portava alla Bacheca) e "Vedi tutte" della campanella.
// Aprire una notifica la segna letta e porta al suo collegamento; "Segna letta" la segna senza aprirla.
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Icon } from '../components/Icons.jsx';
import { Card, Empty, PageHead, useToast } from '../components/ui.jsx';
import { timeAgo } from '../format.js';

const ICONA = { NEWS: 'news', CIRCOLARE: 'file', AVVISO: 'alert', EVENTO: 'calendar', MODULO: 'grid' };
const TIPO = { NEWS: 'News', CIRCOLARE: 'Circolare', AVVISO: 'Avviso', EVENTO: 'Evento', MODULO: 'Widget', SISTEMA: 'Sistema', INFO: 'Informazione' };
const giorno = (d) => { const x = new Date(d); const oggi = new Date(); const ieri = new Date(Date.now() - 86400000); const s = (a, b) => a.toDateString() === b.toDateString(); return s(x, oggi) ? 'Oggi' : s(x, ieri) ? 'Ieri' : x.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); };

export default function Notifiche() {
  const [solo, setSolo] = useState('nonlette');
  const [data, setData] = useState(null);
  const toast = useToast();
  const navigate = useNavigate();
  const load = useCallback(() => api.get(`/notifications?limit=300${solo === 'nonlette' ? '&solo=nonlette' : ''}`, { silent: true }).then(setData).catch((e) => toast(e, 'err')), [solo, toast]);
  useEffect(() => { load(); }, [load]);
  const segna = async (ids) => { try { await api.post('/notifications/read', ids ? { ids } : { all: true }, { silent: true }); load(); } catch (e) { toast(e, 'err'); } };
  const apri = (n) => {
    if (!n.read_at) api.post('/notifications/read', { ids: [n.id] }, { silent: true }).then(load).catch(() => {});
    if (!n.link) return;
    if (/^https?:/.test(n.link) || n.link.startsWith('/go/')) window.open(n.link, '_blank', 'noopener'); else navigate(n.link);
  };
  const rows = data?.rows || [];
  const gruppi = []; for (const n of rows) { const g = giorno(n.created_at); if (!gruppi.length || gruppi[gruppi.length - 1].g !== g) gruppi.push({ g, righe: [] }); gruppi[gruppi.length - 1].righe.push(n); }
  return (
    <div className="page">
      <PageHead title="Notifiche" icon="bell" sub={data ? `${data.unread} da leggere su ${data.totale}` : ''}
        actions={<div className="row" style={{ gap: 8 }}>
          <div className="tabs" role="tablist" style={{ margin: 0 }}>{[['nonlette', 'Da leggere'], ['tutte', 'Tutte']].map(([k, l]) => <button key={k} role="tab" aria-selected={solo === k} className={solo === k ? 'on' : ''} onClick={() => setSolo(k)}>{l}</button>)}</div>
          <button className="btn ghost" disabled={!data?.unread} onClick={() => segna(null)}>Segna tutte come lette</button>
        </div>} />
      <Card flush>
        {!data ? <div className="empty">Carico le notifiche…</div> : !rows.length ? <Empty icon="bell" title={solo === 'nonlette' ? 'Nessuna notifica da leggere' : 'Nessuna notifica'}>{solo === 'nonlette' ? 'Le notifiche già lette sono in "Tutte".' : 'Qui compariranno circolari, avvisi ed eventi che ti riguardano.'}</Empty> : (
          <div className="notif-pagina">
            {gruppi.map((gr) => <div key={gr.g}>
              <div className="notif-giorno">{gr.g}</div>
              {gr.righe.map((n) => (
                <div key={n.id} className={`notif-riga ${n.read_at ? '' : 'unread'}`}>
                  <a href={n.link || '#'} className="notif-corpo" onClick={(e) => { e.preventDefault(); apri(n); }} aria-label={`${n.title}${n.link ? ': apri' : ''}`}>
                    <span className="notif-ico"><Icon name={ICONA[n.kind] || 'info'} /></span>
                    <span className="notif-testo"><span className="t">{n.title}</span>{n.body && <span className="b">{n.body}</span>}
                      <span className="when">{TIPO[n.kind] || n.kind}{n.module_name ? ` · ${n.module_name}` : ''} · {timeAgo(n.created_at)}{n.link ? '' : ' · senza collegamento'}</span></span>
                  </a>
                  <div className="notif-az">
                    {n.link && <button className="btn sm" onClick={() => apri(n)}>Apri</button>}
                    {!n.read_at && <button className="btn sm ghost" onClick={() => segna([n.id])}>Segna letta</button>}
                  </div>
                </div>))}
            </div>)}
            {rows.length >= 300 && <div className="empty">Mostrate le 300 più recenti.</div>}
          </div>)}
      </Card>
    </div>
  );
}

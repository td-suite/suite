// Cruscotto: KPI personali (miei aperti, da confermare), KPI dei gestori (da prendere in carico, in scadenza entro 24 ore, sforati),
// ultimi movimenti sui ticket visibili.
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { base, qs, useApi } from '../api.js';
import { useAuth, isGestore } from '../auth.jsx';
import { Card, Loading, Empty, PageHead } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { StatoBadge, PrioBadge } from '../components.jsx';
import { itDateTime, residuo } from '../format.js';

function Kpi({ label, value, foot, to, tone }) {
  const nav = useNavigate();
  return <div className={`card kpi tk-kpi ${tone || ''} ${to ? 'click' : ''}`} onClick={to ? () => nav(to) : undefined} role={to ? 'link' : undefined}><div className="lbl">{label}</div><div className="val">{value ?? '-'}</div>{foot && <div className="foot">{foot}</div>}</div>;
}

export default function Cruscotto() {
  const { user } = useAuth();
  const nav = useNavigate();
  const gest = isGestore(user);
  const badges = useApi('/badges');
  const miei = useApi(`/tickets${qs({ mine: 1, aperti: 1, pageSize: 8 })}`);
  const gestione = useApi(gest ? `/tickets${qs({ gestiti: 1, aperti: 1, pageSize: 50 })}` : null);
  const recenti = useApi(`/tickets${qs({ pageSize: 10 })}`);
  const g = gestione.data?.rows || [];
  const in24 = g.filter((t) => !t.risolto_at && t.stato !== 'IN_ATTESA' && new Date(t.sla_risoluzione_scadenza) - Date.now() < 24 * 3600_000 && new Date(t.sla_risoluzione_scadenza) > Date.now()).length;
  const daPrendere = g.filter((t) => t.stato === 'APERTO' && !t.assegnatario_user_id).length;
  const b = badges.data || {};
  return (
    <div className="page">
      <PageHead title="Ticket" icon="ticket" sub="Richieste e segnalazioni ai responsabili delle caselle dell'organigramma, con protocollo, priorità e tempi di risposta (SLA). Chiunque può aprire un ticket e seguirne la cronologia." actions={<Link className="btn" to={`${base}/nuovo`}><Icon name="plus" />Nuovo ticket</Link>} />
      <div className="tk-kpis">
        <Kpi label="I miei ticket aperti" value={b.miei} foot="richiesti da me, non ancora chiusi" to={`${base}/miei`} />
        <Kpi label="In attesa della mia conferma" value={b.da_confermare} foot="risolti: conferma la chiusura o riapri" to={`${base}/miei?stato=RISOLTO`} tone={b.da_confermare > 0 ? 'warn' : ''} />
        {gest && <Kpi label="Da prendere in carico" value={gestione.data ? daPrendere : '-'} foot="aperti nelle mie caselle, senza assegnatario" to={`${base}/gestione?stato=APERTO`} tone={daPrendere > 0 ? 'info' : ''} />}
        {gest && <Kpi label="In scadenza entro 24 ore" value={gestione.data ? in24 : '-'} foot="risoluzione attesa entro un giorno" to={`${base}/gestione`} tone={in24 > 0 ? 'warn' : ''} />}
        {gest && <Kpi label="SLA sforati" value={b.sforati} foot="risposta o risoluzione oltre la scadenza" to={`${base}/gestione?sforati=1`} tone={b.sforati > 0 ? 'late' : ''} />}
      </div>
      <div className="grid tk-two">
        <Card title="I miei ticket aperti" icon="user" flush actions={<Link to={`${base}/miei`} className="small">Tutti i miei</Link>}>
          {miei.error ? <Empty icon="alert" title="Dati non disponibili">{miei.error.message}</Empty> : !miei.data ? <Loading /> : !miei.data.rows.length ? <Empty icon="ticket" title="Nessun ticket aperto">Apri il primo ticket da "Nuovo ticket": scegli la categoria, descrivi la richiesta e la casella destinataria riceve l'avviso.</Empty> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Protocollo</th><th>Titolo</th><th>Casella</th><th>Stato</th><th>Scadenza</th></tr></thead>
              <tbody>{miei.data.rows.map((t) => (
                <tr key={t.id} className="click" onClick={() => nav(`${base}/${t.id}`)}>
                  <td className="tk-prot">{t.protocollo}</td>
                  <td><div className="strong">{t.riservato && <Icon name="lock" title="Riservato" />} {t.titolo}</div><div className="small muted">{t.categoria_nome} · <PrioBadge priorita={t.priorita} /></div></td>
                  <td className="small">{t.unit_nome}</td>
                  <td><StatoBadge stato={t.stato} /></td>
                  <td className={`small ${t.sla_risoluzione_in_ritardo ? 'tk-late' : ''}`}>{t.stato === 'IN_ATTESA' ? 'congelata' : residuo(t.sla_risoluzione_scadenza)}</td>
                </tr>))}</tbody>
            </table></div>)}
        </Card>
        {gest ? (
          <Card title="Da gestire: i più urgenti" icon="users" flush actions={<Link to={`${base}/gestione`} className="small">Tutti da gestire</Link>}>
            {gestione.error ? <Empty icon="alert" title="Dati non disponibili">{gestione.error.message}</Empty> : !gestione.data ? <Loading /> : !g.length ? <Empty icon="check" title="Nessun ticket da gestire">Le caselle di cui sei responsabile non hanno ticket aperti.</Empty> : (
              <div className="table-wrap"><table className="t">
                <thead><tr><th>Protocollo</th><th>Titolo</th><th>Richiedente</th><th>Stato</th><th>Scadenza</th></tr></thead>
                <tbody>{g.slice(0, 8).map((t) => (
                  <tr key={t.id} className="click" onClick={() => nav(`${base}/${t.id}`)}>
                    <td className="tk-prot">{t.protocollo}</td>
                    <td><div className="strong">{t.riservato && <Icon name="lock" title="Riservato" />} {t.titolo}</div><div className="small muted">{t.unit_nome} · <PrioBadge priorita={t.priorita} /></div></td>
                    <td className="small">{t.richiedente_nome}</td>
                    <td><StatoBadge stato={t.stato} /></td>
                    <td className={`small ${t.sla_risoluzione_in_ritardo ? 'tk-late' : ''}`}>{t.stato === 'IN_ATTESA' ? 'congelata' : residuo(t.sla_risoluzione_scadenza)}</td>
                  </tr>))}</tbody>
              </table></div>)}
          </Card>
        ) : (
          <Card title="Come funziona" icon="info">
            <div className="tk-steps">
              <div><div><b>Apri.</b> Scegli la categoria: la casella destinataria è proposta da sola; descrivi la richiesta senza dati di pazienti.</div></div>
              <div><div><b>Segui.</b> Il responsabile della casella prende in carico, commenta e risolve entro lo SLA della priorità. Ricevi una notifica a ogni passo.</div></div>
              <div><div><b>Chiudi.</b> Quando il ticket è risolto confermi la chiusura con una valutazione, oppure lo riapri entro sette giorni.</div></div>
            </div>
            <Link to={`${base}/guida`} className="small">Leggi la guida completa</Link>
          </Card>
        )}
      </div>
      <Card title="Ultimi movimenti" icon="clock" flush actions={<Link to={`${base}/archivio`} className="small">Archivio</Link>}>
        {recenti.error ? <Empty icon="alert" title="Dati non disponibili">{recenti.error.message}</Empty> : !recenti.data ? <Loading /> : !recenti.data.rows.length ? <Empty icon="ticket" title="Nessun ticket">Ancora nessun ticket visibile per te.</Empty> : (
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Protocollo</th><th>Titolo</th><th>Casella</th><th>Richiedente</th><th>Priorità</th><th>Stato</th><th>Aggiornato</th></tr></thead>
            <tbody>{recenti.data.rows.slice().sort((a, b2) => new Date(b2.updated_at) - new Date(a.updated_at)).map((t) => (
              <tr key={t.id} className="click" onClick={() => nav(`${base}/${t.id}`)}>
                <td className="tk-prot">{t.protocollo}</td>
                <td className="strong">{t.riservato && <Icon name="lock" title="Riservato" />} {t.titolo}</td>
                <td className="small">{t.unit_nome}</td>
                <td className="small">{t.richiedente_nome}</td>
                <td><PrioBadge priorita={t.priorita} /></td>
                <td><StatoBadge stato={t.stato} /></td>
                <td className="small muted">{itDateTime(t.updated_at)}</td>
              </tr>))}</tbody>
          </table></div>)}
      </Card>
    </div>
  );
}

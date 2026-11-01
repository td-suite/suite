// "Il mio spazio" del Portale Service (richiesta del CEO, 01/11/2026): solo per l'accesso esterno Cliente service. Riunisce, letti dai
// widget della Suite senza uscire dal portale, ciò che riguarda la sua Legal entity: non conformità aperte con stato, ordini in corso con
// fase, circolari recenti del segmento Clienti service con presa visione, ticket aperti. Per agire il cliente apre il widget in una scheda
// nuova ("Apri in …", target _blank, rel noopener). Stile del sito (sito.css): fascia .hero, riquadri .card.kpi, tabelle .t, badge.
// Dati: GET /api/service/mio-spazio (404 per chiunque non sia Cliente service; cache per utente 60 s, "Aggiorna" la rinnova).
// Vista come Legal entity del personale TD: GET /api/service/mio-spazio?org_id=<id>, stessa pagina intestata "Vista del personale TD: come
// la vede il cliente"; sezioni senza grant "non disponibili", presa visione = lettori tra gli accessi della Legal entity, ticket degli accessi.
import React, { useState } from 'react';
import { Loading, useApi } from '../../../components/ui.jsx';
import { fmtDate, fmtDateTime } from '../../../format.js';
import { useDati } from '../dati.js';
import { useServizio } from '../index.jsx';
import { Piede, Ico } from './comuni.jsx';

// Toni dei badge del sito per gli stati dei widget
const TONO_NC = { INVIATA_SEDE: 'b-red', RISPOSTA_SEDE: 'b-blue', IN_TRATTAMENTO: 'b-mauve', APERTA: 'b-grey' };
const TONO_GRAVITA = { CRITICA: 'b-red', MAGGIORE: 'b-mauve', MINORE: 'b-grey' };
const TONO_FASE = { 1: 'b-grey', 2: 'b-blue', 3: 'b-teal', 4: 'b-mauve', 5: 'b-green' };
const TONO_TICKET = { APERTO: 'b-blue', IN_CORSO: 'b-teal', IN_ATTESA: 'b-mauve', RISOLTO: 'b-green' };

/** Pulsante "Apri in <widget>": il widget della Suite in una scheda nuova, sulla pagina giusta */
function ApriIn({ href, widget, sm }) {
  if (!href) return null;
  return <a className={`btn${sm ? ' sm ghost' : ' sm'}`} href={href} target="_blank" rel="noopener" title={`Apri in ${widget} (scheda nuova)`}>{sm ? 'Apri' : `Apri in ${widget}`} <Ico n="external" s={14} /></a>;
}

/** Sezione: intestazione con conteggio e "Apri in …", poi tabella o stato vuoto esplicito */
function Sezione({ id, titolo, widget, s, vuoto, colonne, riga, nota, vista }) {
  return (
    <div className="card mt" id={id}>
      <div className="hd"><h2>{titolo}</h2><span className="spacer" />
        {s?.disponibile && <span className="badge b-teal">{s.totale ?? s.righe?.length ?? 0}</span>}
        {s?.disponibile && <ApriIn href={s.link} widget={widget} />}
      </div>
      {!s?.disponibile ? (
        <div className="bd"><div className="alert info"><Ico n="info" s={18} /><div>{widget} non è disponibile per il tuo accesso{s?.motivo ? `: ${s.motivo.toLowerCase()}` : ''}. {vista ? 'Nella vista come Legal entity ogni sezione segue i tuoi widget: chiedi il grant all\'amministrazione.' : <>Per l'abilitazione scrivi a <a href="mailto:service@toscanadiagnostica.it">service@toscanadiagnostica.it</a>.</>}</div></div></div>
      ) : (
        <div className="bd flush table-wrap">
          {nota && <div className="small muted" style={{ padding: '10px 16px 0' }}>{nota}</div>}
          <table className="t"><thead><tr>{colonne.map((c) => <th key={c} className={c === 'Apri' ? 'num' : undefined}>{c}</th>)}</tr></thead><tbody>
            {!s.righe?.length ? <tr><td colSpan={colonne.length} className="empty">{vuoto}</td></tr> : s.righe.map(riga)}
          </tbody></table>
        </div>
      )}
    </div>
  );
}

export default function MioSpazio() {
  const [giro, setGiro] = useState(0);
  const { vista: scelta } = useServizio();   // personale TD: Legal entity scelta in "Visualizza come"
  const qs = new URLSearchParams();
  if (scelta?.id) qs.set('org_id', scelta.id);
  if (giro) qs.set('rinnova', '1');
  const d = useApi(`/service/mio-spazio${qs.toString() ? `?${qs}` : ''}`, [giro, scelta?.id]);
  const meta = useDati('meta');
  if (d.loading && !d.data) return <div className="page"><Loading /></div>;
  if (d.error) return <div className="page"><div className="alert warn"><Ico n="info" s={18} /><div>{scelta ? 'La Legal entity scelta non è un cliente service (CLIENTE con sedi SERVICE attive): scegline un\'altra o torna alla versione standard.' : <>Il mio spazio non è disponibile. {d.error.status === 404 ? '' : d.error.message}</>}</div></div></div>;
  const x = d.data;
  const { kpi } = x;
  const vista = Boolean(x.vista);
  const vai = (k) => document.getElementById(`ms-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const riquadri = [
    ['nc', 'Non conformità aperte', kpi.nc_aperte, x.nc?.disponibile ? `${x.nc.per_stato?.INVIATA_SEDE || 0} in attesa di una ${vista ? 'risposta del cliente' : 'tua risposta'}` : 'widget non disponibile', true],
    ['ordini', 'Ordini in corso', kpi.ordini_in_corso, x.ordini?.disponibile ? (x.ordini.struttura ? `struttura ${x.ordini.struttura.name}` : 'nessuna struttura collegata') : 'widget non disponibile'],
    ['circolari', 'Circolari da leggere', kpi.circolari_da_leggere, x.circolari?.disponibile ? (vista ? `senza lettori della Legal entity, su ${x.circolari.totale}` : `su ${x.circolari.totale} pubblicate per i clienti service`) : 'widget non disponibile'],
    ['ticket', 'Ticket aperti', kpi.ticket_aperti, x.ticket?.disponibile ? (vista ? 'aperti dagli accessi del cliente' : 'aperti da te, non ancora chiusi') : 'widget non disponibile'],
  ];
  return (
    <div className="page">
      <div className="hero">
        {vista && <div className="vista-kicker">Vista del personale TD: come la vede il cliente</div>}
        <h1>Il mio spazio{vista ? ` · ${x.legal_entity.name}` : ''}</h1>
        <div className="sub"><strong>{x.legal_entity.name}</strong>{x.legal_entity.code ? ` (${x.legal_entity.code})` : ''}: le tue non conformità, i tuoi ordini, le circolari per i clienti service e i tuoi ticket, letti dai widget della Suite. Per rispondere, ordinare o aprire una richiesta usa "Apri in …": il widget si apre in una scheda nuova.</div>
        <div className="pills">
          {x.punti_service.map((p) => <span key={p.id} className="pill" style={{ cursor: 'default' }} title={[p.code, p.city].filter(Boolean).join(' · ')}>{p.name}{p.city ? ` · ${p.city}` : ''}</span>)}
        </div>
      </div>

      <div className="grid g4">
        {riquadri.map(([k, lbl, val, foot, accent]) => (
          <div key={k} className={`card kpi clickable${accent ? ' accent' : ''}`} role="button" tabIndex={0} onClick={() => vai(k)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), vai(k))}>
            <div className="lbl">{lbl}</div><div className="val">{val == null ? '–' : val}</div><div className="foot">{foot}</div><div className="act">Vedi elenco</div>
          </div>
        ))}
      </div>

      <Sezione id="ms-nc" titolo="Non conformità aperte" widget="Non conformità" s={x.nc} vista={vista} vuoto="Nessuna non conformità aperta."
        colonne={['Numero', 'Data', 'Tipo', 'Gravità', 'Stato', 'Sede', 'Apri']}
        riga={(n) => (
          <tr key={n.id}>
            <td><span className="doc-code">{n.numero}</span></td>
            <td className="small" style={{ whiteSpace: 'nowrap' }}>{fmtDate(n.data)}</td>
            <td><div className="doc-title">{n.tipo || '–'}</div><div className="doc-sintesi">{n.macro ? n.macro.charAt(0) + n.macro.slice(1).toLowerCase() : ''}</div></td>
            <td><span className={`badge ${TONO_GRAVITA[n.gravita] || 'b-grey'}`}>{n.gravita ? n.gravita.charAt(0) + n.gravita.slice(1).toLowerCase() : '–'}</span></td>
            <td><span className={`badge ${TONO_NC[n.stato] || 'b-grey'}`}>{n.stato_label}</span>{n.sla_scaduta && <div className="small" style={{ color: 'var(--red, #b42318)' }}>oltre il termine di risposta</div>}</td>
            <td className="small">{n.sede}</td>
            <td><div className="doc-actions"><ApriIn href={n.link} widget="Non conformità" sm /></div></td>
          </tr>
        )} />

      <Sezione id="ms-ordini" titolo="Ordini in corso" widget="Ordini" s={x.ordini} vista={vista} vuoto="Nessun ordine in corso." nota={x.ordini?.nota}
        colonne={['Numero', 'Data', 'Fase', 'Struttura', 'Apri']}
        riga={(o) => (
          <tr key={o.id}>
            <td><span className="doc-code">{o.numero}</span>{o.urgente && <> <span className="badge b-red">urgente</span></>}</td>
            <td className="small" style={{ whiteSpace: 'nowrap' }}>{fmtDate(o.data)}</td>
            <td><span className={`badge ${TONO_FASE[o.fase] || 'b-grey'}`}>{o.fase ? `Fase ${o.fase} · ` : ''}{o.fase_label}</span>{o.ddt && <div className="small muted">DDT {o.ddt}</div>}</td>
            <td className="small">{o.struttura}</td>
            <td><div className="doc-actions"><ApriIn href={o.link} widget="Ordini" sm /></div></td>
          </tr>
        )} />

      <Sezione id="ms-circolari" titolo="Circolari recenti per i clienti service" widget="Circolari" s={x.circolari} vista={vista} vuoto="Nessuna circolare pubblicata per i clienti service."
        colonne={['Protocollo', 'Titolo', 'Data', 'Presa visione', 'Apri']}
        riga={(c) => (
          <tr key={c.id}>
            <td><span className="doc-code">{c.protocollo}</span></td>
            <td><div className="doc-title">{c.titolo}</div></td>
            <td className="small" style={{ whiteSpace: 'nowrap' }}>{fmtDate(c.data)}</td>
            <td>{vista
              ? <span className={`badge ${c.lettori ? (c.lettori >= c.accessi ? 'b-green' : 'b-blue') : 'b-red'}`} title="Accessi esterni della Legal entity che hanno confermato la presa visione">{c.lettori} su {c.accessi} {c.accessi === 1 ? 'accesso' : 'accessi'}</span>
              : c.presa_visione ? <span className="badge b-green" title={fmtDateTime(c.presa_visione_at)}>Sì, il {fmtDate(c.presa_visione_at)}</span> : <span className="badge b-red">Da leggere</span>}</td>
            <td><div className="doc-actions"><ApriIn href={c.link} widget="Circolari" sm /></div></td>
          </tr>
        )} />

      <Sezione id="ms-ticket" titolo={vista ? 'Ticket aperti dagli accessi del cliente' : 'I tuoi ticket aperti'} widget="Ticket" s={x.ticket} vista={vista} vuoto="Nessun ticket aperto."
        colonne={['Numero', 'Oggetto', 'Stato', 'Data', 'Apri']}
        riga={(t) => (
          <tr key={t.id}>
            <td><span className="doc-code">{t.numero}</span></td>
            <td><div className="doc-title">{t.oggetto}</div><div className="doc-sintesi">Priorità {t.priorita}{t.richiedente ? ` · ${t.richiedente}` : ''}</div></td>
            <td><span className={`badge ${TONO_TICKET[t.stato] || 'b-grey'}`}>{t.stato_label}</span></td>
            <td className="small" style={{ whiteSpace: 'nowrap' }}>{fmtDate(t.data)}</td>
            <td><div className="doc-actions"><ApriIn href={t.link} widget="Ticket" sm /></div></td>
          </tr>
        )} />

      <div className="row mt small muted" style={{ alignItems: 'center' }}>
        <span>Aggiornato al {fmtDateTime(x.letto_at)}{x.da_cache ? ' (riepilogo dell\'ultimo minuto)' : ''}.</span>
        <button className="btn sm ghost" disabled={d.loading} onClick={() => setGiro((g) => g + 1)}>Aggiorna</button>
      </div>
      <Piede meta={meta.data?.meta} />
    </div>
  );
}

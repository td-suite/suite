// Servizi (voci di menu.json) con la rimappatura del CEO (01/11/2026): Vademecum → pagina interna che incorpora il Vademecum online;
// Circolari e aggiornamenti → widget Circolari; Ordine del materiale → widget Ordini; Portale NC → widget Non conformità; Check-up e
// promozioni resta segnaposto "in allestimento". GET /api/service/servizi dice per ogni widget se l'utente lo vede e con quale indirizzo
// (/<modulo> dentro la Suite, /go/<modulo> se non è ancora travasato). Chi non vede il widget trova il motivo e l'alternativa.
import React, { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHead, Loading, Empty, useApi } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useDati, base, linkSuite } from '../dati.js';
import { Piede, StatoDati } from './comuni.jsx';

const ICONE = { book: 'doc', list: 'list', folder: 'folder', star: 'star', shield: 'shield', link: 'external' };
const ico = (v) => ICONE[v.icon] || v.icon || 'external';
const esterno = (href) => /^https?:/.test(href) || href.startsWith('/go/');

function Alternative({ v }) {
  return (
    <>
      {v.box && <a className="card sv-linkbox" href={v.box.url} target="_blank" rel="noopener"><div className="bd"><div className="ico"><Icon name={ICONE[v.box.icon] || 'folder'} /></div><div><div className="t">{v.box.titolo}</div><div className="small muted">{v.box.testo || ''}</div><div className="u">{v.box.url.replace('https://', '')}</div></div><Icon name="external" /></div></a>}
      {v.modulo_sgi && <a className="btn ghost" href={linkSuite('m', v.modulo_sgi)} target="_blank" rel="noopener"><Icon name="file" />Apri il modulo {v.modulo_sgi}</a>}
    </>
  );
}

/** Scheda di una voce (pagina Tutti i servizi) */
function Voce({ v }) {
  const corpo = <><div className="ico"><Icon name={ico(v)} /></div><div><div className="t">{v.label}</div><div className="small muted">{v.descrizione}</div>
    <div className="sv-dest">{v.tipo === 'interno' ? 'Pagina del portale' : v.tipo === 'widget' ? (v.accessibile ? `Apre il widget ${v.modulo_nome}` : `Widget ${v.modulo_nome} non abilitato per il tuo account`) : v.tipo === 'esterno' ? `Sito esterno · ${v.href.replace(/^https?:\/\//, '')}` : 'Sezione in allestimento'}</div></div></>;
  if (v.tipo === 'widget' && !v.accessibile) return <Link className="card sv-voce off" to={`${base}/servizi/${v.id}`}><div className="bd">{corpo}</div></Link>;
  if (v.tipo === 'interno') return <Link className="card sv-voce" to={`${base}/${v.to}`}><div className="bd">{corpo}</div></Link>;
  if (v.tipo === 'widget') return esterno(v.href) ? <a className="card sv-voce" href={v.href} target="_blank" rel="noopener"><div className="bd">{corpo}</div></a> : <Link className="card sv-voce" to={v.href}><div className="bd">{corpo}</div></Link>;
  if (v.tipo === 'esterno') return <a className="card sv-voce" href={v.href} target={v.blank ? '_blank' : undefined} rel="noopener"><div className="bd">{corpo}</div></a>;
  return <Link className="card sv-voce" to={`${base}/${v.to}`}><div className="bd">{corpo}</div></Link>;
}

export default function Servizi() {
  const st = useDati('meta');
  const sv = useApi('/service/servizi');
  const blocco = StatoDati({ st });
  if (blocco) return blocco;
  return (
    <div className="page sv-page">
      <PageHead title="Servizi" icon="grid" sub="Le sezioni del portale dedicate ai laboratori clienti. Circolari, ordini del materiale e non conformità si gestiscono direttamente nei widget della Suite." />
      {sv.loading && !sv.data ? <Loading /> : sv.error ? <Empty icon="alert" title="Servizi non disponibili">{sv.error.message}</Empty> : (
        <div className="grid g2">{sv.data.voci.map((v) => <Voce key={v.id} v={v} />)}</div>
      )}
      <Piede meta={st.data.meta} />
    </div>
  );
}

/** /service/servizi/<id>: widget → apre il modulo della Suite; voce senza link → pagina "in allestimento" come sul sito */
export function Servizio() {
  const { id } = useParams();
  const nav = useNavigate();
  const sv = useApi('/service/servizi');
  const v = sv.data?.voci?.find((x) => x.id === id);
  useEffect(() => {
    if (!v) return;
    if (v.tipo === 'interno') nav(`${base}/${v.to}`, { replace: true });
    else if (v.tipo === 'widget' && v.accessibile) { if (esterno(v.href)) window.location.assign(v.href); else nav(v.href, { replace: true }); }
  }, [v, nav]);
  if (sv.loading && !sv.data) return <div className="page"><Loading /></div>;
  if (sv.error) return <div className="page"><Empty icon="alert" title="Servizi non disponibili">{sv.error.message}</Empty></div>;
  if (!v) return <div className="page"><Empty icon="info" title="Sezione inesistente"><Link to={`${base}/servizi`}>Torna ai servizi</Link></Empty></div>;
  if (v.tipo === 'interno' || (v.tipo === 'widget' && v.accessibile)) return <div className="page"><Loading text={`Apro ${v.tipo === 'widget' ? `il widget ${v.modulo_nome}` : v.label}`} /></div>;
  return (
    <div className="page sv-page">
      <PageHead title={v.label} icon={ico(v)} sub={v.descrizione} />
      {v.tipo === 'widget' ? (
        <div className="sv-alert warn"><Icon name="lock" className="ico" /><div><strong>Il widget {v.modulo_nome} non è abilitato per il tuo account.</strong> Questa voce del portale apre il widget {v.modulo_nome} della Suite: per l'abilitazione scrivi a <a href="mailto:service@toscanadiagnostica.it">service@toscanadiagnostica.it</a> o apri un ticket.{v.box || v.modulo_sgi ? ' Nel frattempo puoi usare l\'alternativa qui sotto.' : ''}</div></div>
      ) : v.tipo === 'esterno' ? (
        <div className="sv-alert"><Icon name="external" className="ico" /><div>Questa sezione è un sito esterno: <a href={v.href} target="_blank" rel="noopener">{v.href}</a></div></div>
      ) : !v.box && (
        <div className="sv-alert"><Icon name="info" className="ico" /><div><strong>Sezione in allestimento.</strong> Sarà attiva a breve. Nel frattempo il Laboratorio di Analisi risponde a <a href="mailto:laboratorio@toscanadiagnostica.it">laboratorio@toscanadiagnostica.it</a> e allo 055 7765108, e il Service a <a href="mailto:service@toscanadiagnostica.it">service@toscanadiagnostica.it</a>.</div></div>
      )}
      <div className="sv-actions start" style={{ flexDirection: 'column', alignItems: 'stretch' }}><Alternative v={v} /></div>
      <div className="sv-actions start mt"><Link className="btn ghost" to={base}>Torna a Preparazioni e documenti</Link></div>
    </div>
  );
}

// Servizi (voci di menu.json) con la rimappatura del CEO (01/11/2026): Vademecum → pagina interna del portale; Circolari e
// aggiornamenti → widget Circolari; Ordine del materiale → widget Ordini; Portale NC → widget Non conformità; Check-up e promozioni
// resta segnaposto "in allestimento". GET /api/service/servizi dice per ogni widget se l'utente lo vede e con quale indirizzo
// (/<modulo> dentro la Suite, /go/<modulo> se non è ancora travasato). Chi non vede il widget trova il motivo e l'alternativa.
// Come sul sito (voci con blank=true) i widget si aprono in una SCHEDA NUOVA, con l'icona "esterno"; il Vademecum resta nel portale.
// Stile: riquadri .card.linkbox e pagina "in allestimento" di in-allestimento.html del sito.
import React, { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Loading, useApi } from '../../../components/ui.jsx';
import { useDati, base, linkSuite } from '../dati.js';
import { Piede, StatoDati, Ico } from './comuni.jsx';
import { useServizio } from '../index.jsx';

// icone di menu.json → icone del sito (shell.js)
const ICONE = { book: 'book', list: 'list', folder: 'folder', star: 'star', shield: 'shield', link: 'link', doc: 'doc' };
const ico = (v) => ICONE[v?.icon] || 'link';
const esterno = (href) => /^https?:/.test(href) || href.startsWith('/go/');
/** La voce apre una scheda nuova? (widget abilitati e siti esterni) */
export const inSchedaNuova = (v) => (v.tipo === 'widget' && v.accessibile) || (v.tipo === 'esterno' && v.blank !== false);

function Voce({ v }) {
  const nuova = inSchedaNuova(v);
  const dest = v.tipo === 'interno' ? 'Pagina del portale' : v.tipo === 'widget' ? (v.accessibile ? `Apre il widget ${v.modulo_nome} in una nuova scheda` : `Widget ${v.modulo_nome} non abilitato per il tuo account`)
    : v.tipo === 'esterno' ? v.href.replace(/^https?:\/\//, '') : 'Sezione in allestimento';
  const corpo = (
    <div className="bd">
      <div className="ico"><Ico n={ico(v)} s={34} /></div>
      <div><div className="t">{v.label}</div><div className="d">{v.descrizione}</div><div className="u">{dest}</div></div>
      <div className="go">{nuova && <Ico n="external" s={20} />}</div>
    </div>
  );
  if (nuova) return <a className={`card linkbox${v.evidenza ? ' evid' : ''}`} href={v.href} target="_blank" rel="noopener">{corpo}</a>;
  const to = v.tipo === 'interno' ? `${base}/${v.to}` : `${base}/servizi/${v.id}`;
  return <Link className={`card linkbox${v.tipo === 'widget' ? ' voce-off' : ''}`} to={to}>{corpo}</Link>;
}

export default function Servizi() {
  const st = useDati('meta');
  const sv = useApi('/service/servizi');
  const blocco = StatoDati({ st });
  if (blocco) return blocco;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Servizi</h1><div className="sub">Le sezioni del portale dedicate ai laboratori clienti. Circolari, ordini del materiale e non conformità si gestiscono nei widget della Suite, che si aprono in una nuova scheda.</div></div></div>
      {sv.loading && !sv.data ? <Loading /> : sv.error ? <div className="alert warn"><Ico n="info" s={18} /><div>Servizi non disponibili: {sv.error.message}</div></div> : (
        <div>{sv.data.voci.map((v) => <Voce key={v.id} v={v} />)}</div>
      )}
      <Piede meta={st.data.meta} />
    </div>
  );
}

/** /service/servizi/<id>: widget abilitato → apre il modulo della Suite (la voce di menu apre già una scheda nuova);
 *  widget non abilitato, segnaposto o sito esterno → pagina "in allestimento" come sul sito */
export function Servizio() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useServizio();
  const sv = useApi('/service/servizi');
  const st = useDati('meta');
  const v = sv.data?.voci?.find((x) => x.id === id);
  useEffect(() => {
    if (!v) return;
    if (v.tipo === 'interno') nav(`${base}/${v.to}`, { replace: true });
    else if (v.tipo === 'widget' && v.accessibile) { if (esterno(v.href)) window.location.replace(v.href); else nav(v.href, { replace: true }); }
  }, [v, nav]);
  if (sv.loading && !sv.data) return <div className="page"><Loading /></div>;
  if (sv.error) return <div className="page"><div className="alert warn"><Ico n="info" s={18} /><div>Servizi non disponibili: {sv.error.message}</div></div></div>;
  if (!v) return <div className="page"><div className="alert info"><Ico n="info" s={18} /><div>Sezione inesistente. <Link to={`${base}/servizi`}>Torna ai servizi</Link></div></div></div>;
  if (v.tipo === 'interno' || (v.tipo === 'widget' && v.accessibile)) return <div className="page"><Loading text={`Apro ${v.tipo === 'widget' ? `il widget ${v.modulo_nome}` : v.label}`} /></div>;
  // per il Cliente service la home del portale è "Il mio spazio": Preparazioni e documenti è /service/preparazioni
  const torna = <Link className="btn ghost" to={user?.cliente_service ? `${base}/preparazioni` : base}>Torna a Preparazioni e documenti</Link>;
  return (
    <div className="page">
      <div className="page-head"><div><h1>{v.label}</h1><div className="sub">{v.descrizione || ''}</div></div></div>
      {v.tipo === 'widget' && <div className="alert warn"><Ico n="info" s={18} /><div><strong>Il widget {v.modulo_nome} non è abilitato per il tuo account.</strong> Questa voce del portale apre il widget {v.modulo_nome} della Suite: per l'abilitazione scrivi a <a href="mailto:service@toscanadiagnostica.it">service@toscanadiagnostica.it</a> o apri un ticket.{v.box || v.modulo_sgi ? ' Nel frattempo puoi usare l\'alternativa qui sotto.' : ''}</div></div>}
      {v.tipo === 'esterno' && <div className="alert info"><Ico n="info" s={18} /><div>Questa sezione è un sito esterno: <a href={v.href} target="_blank" rel="noopener">{v.href}</a></div></div>}
      {v.box ? (
        <a className="card linkbox" href={v.box.url} target="_blank" rel="noopener"><div className="bd"><div className="ico"><Ico n={ICONE[v.box.icon] || 'link'} s={34} /></div><div><div className="t">{v.box.titolo}</div><div className="d">{v.box.testo || ''}</div><div className="u">{v.box.url.replace('https://', '')}</div></div><div className="go"><Ico n="link" s={20} /></div></div></a>
      ) : v.tipo === 'segnaposto' && (
        <div className="alert info"><Ico n="info" s={18} /><div><strong>Sezione in allestimento.</strong> Sarà attiva a breve. Nel frattempo il Laboratorio di Analisi risponde a <a href="mailto:laboratorio@toscanadiagnostica.it">laboratorio@toscanadiagnostica.it</a> e allo 055 7765108, e il Service a <a href="mailto:service@toscanadiagnostica.it">service@toscanadiagnostica.it</a>.</div></div>
      )}
      {v.modulo_sgi ? <div className="row"><a className="btn" href={linkSuite('m', v.modulo_sgi)} target="_blank" rel="noopener"><Ico n="print" s={15} /> Apri il modulo {v.modulo_sgi}</a>{torna}</div> : torna}
      <Piede meta={st.data?.meta} />
    </div>
  );
}

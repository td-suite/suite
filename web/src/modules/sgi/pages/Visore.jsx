// Indice REG006, Mappa concettuale (MAN005) e Politica integrata (POL001): sul sito sono scorciatoie che aprono il PDF in una nuova
// scheda; nella Suite il PDF si apre dentro la pagina (visualizzatore del browser, dalla cache della Suite) con i dati del documento
// e i pulsanti per aprirlo a schermo intero, scaricarlo, inviarlo per e-mail (busta) o copiarne il link pubblico (catena).
// Classi e stile del sito (page-head, card, doc-code, badge, .viewer come vademecum.html del Portale Service).
import React from 'react';
import { useToast } from '../../../components/ui.jsx';
import { useDati, useStato, docUrl, fileUrl, linkPubblico, copiaLink, mailtoDoc, copiaLinkDoc, senzaNumero } from '../dati.js';
import { DOC_SCORCIATOIE, trovaDocumento, codiceBase } from '../filtri.js';
import { Piede, StatoDati, Ico } from './comuni.jsx';

const TITOLI = { reg006: 'Indice REG006', mappa: 'Mappa concettuale', politica: 'Politica integrata' };
const SOTTO = {
  reg006: 'Indice generale dei documenti del Sistema di Gestione Integrato, nella revisione in vigore: è la fonte del cruscotto.',
  mappa: 'Vista d\'insieme del Sistema di Gestione Integrato: aree, norme di riferimento, documenti cardine e loro relazioni.',
  politica: 'La Politica integrata di Toscana Diagnostica, nella revisione in vigore.',
};

export default function Visore({ tipo }) {
  const st = useDati('docs', 'meta');
  const stato = useStato();
  const toast = useToast();
  const blocco = StatoDati({ st });
  if (blocco) return blocco;
  const d = trovaDocumento(st.data.docs, DOC_SCORCIATOIE[tipo]);
  const META = st.data.meta;
  const origine = stato?.origine;
  if (!d || !d.pdf) {
    return <div className="page"><div className="alert warn"><Ico n="info" s={18} /><div>Il documento {DOC_SCORCIATOIE[tipo]} non è presente nella pubblicazione del {META?.build}.</div></div><Piede meta={META} /></div>;
  }
  const b = codiceBase(d.code);
  const pdf = docUrl(d);
  const copia = async (url) => { if (await copiaLink(url)) toast(`Link copiato come collegamento: ${url}`); };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{TITOLI[tipo]}</h1>
          <div className="sub">{SOTTO[tipo]}</div>
        </div>
        <div className="row">
          <a className="btn" href={pdf} target="_blank" rel="noopener">Apri a schermo intero</a>
          <a className="btn ghost" href={fileUrl(`docs/${d.pdf}`, true)}><Ico n="download" s={16} /> Scarica</a>
        </div>
      </div>
      <div className="card">
        <div className="bd row">
          <span className="doc-code">{d.code}</span>
          <span className="doc-title">{d.title}</span>
          <span className="badge b-blue">{senzaNumero(d.area)}</span>
          <span className="small muted">rev {d.rev} del {d.data}{d.pagine ? ` · ${d.pagine} pag.` : ''}</span>
          <span className="spacer" />
          <span className="doc-actions">
            <a className="iconbtn" href={mailtoDoc(d, origine)} onClick={() => copiaLinkDoc(d, origine).then(() => toast('E-mail aperta. I link sono anche negli appunti come collegamenti'))} title="Invia per e-mail (apre il tuo client di posta con i link al documento)"><Ico n="mail" s={16} /></a>
            <button className="iconbtn" title="Copia il link stabile (incollabile come collegamento cliccabile)" onClick={() => copia(linkPubblico(origine, 'doc', b))}><Ico n="link" s={16} /></button>
          </span>
        </div>
        {d.sintesi && d.sintesi !== d.title && <div className="bd doc-sintesi" style={{ paddingTop: 0 }}>{d.sintesi}</div>}
      </div>
      <div className="viewer mt"><iframe title={`${d.code} - ${d.title}`} src={pdf} /></div>
      <Piede meta={META} />
    </div>
  );
}

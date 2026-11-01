// Pezzi comuni delle pagine del Portale Service: piè di pagina come sul sito, stato "da caricare", errori di lettura.
import React from 'react';
import { Link } from 'react-router-dom';
import { Empty, Loading } from '../../../components/ui.jsx';
import { useServizio } from '../index.jsx';
import { base } from '../dati.js';

export function Piede({ meta }) {
  if (!meta) return null;
  return (
    <footer className="sv-foot">Toscana Diagnostica S.r.l. · Portale Service di Laboratorio · P. IVA 07528130482 · Via di Pratignone 13/4, 50019 Sesto Fiorentino (FI) ·
      documenti del Sistema di Gestione Integrato, indice REG006 rev. {meta.reg006_rev} del {meta.reg006_data} · pubblicazione del {meta.build} ·
      copia conforme di <a href="https://service.toscanadiagnostica.it" target="_blank" rel="noopener">service.toscanadiagnostica.it</a></footer>
  );
}

/** Caricamento, errore o specchio vuoto: null se i dati ci sono */
export function StatoDati({ st }) {
  const { user } = useServizio();
  if (st.loading) return <div className="page"><Loading /></div>;
  if (!st.error) return null;
  if (st.error.code === 'SPECCHIO_VUOTO' || st.error.status === 404) {
    return (
      <div className="page">
        <Empty icon="import" title="Portale Service da caricare">
          La Suite non ha ancora letto i contenuti del sito service.toscanadiagnostica.it (lo specchio parte all'avvio e ogni 6 ore).
          {user?.editor ? <> Da <Link to={`${base}/impostazioni`}>Impostazioni</Link> puoi provare l'origine, premere "Aggiorna adesso" oppure caricare lo ZIP del repository.</> : ' Riprova tra qualche minuto o avvisa la Qualità (HQS).'}
        </Empty>
      </div>
    );
  }
  return <div className="page"><Empty icon="alert" title="Errore nel caricamento dei dati del portale">{st.error.message}</Empty></div>;
}

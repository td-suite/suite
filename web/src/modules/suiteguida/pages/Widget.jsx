// Guida alla Suite · Guida al widget: da ogni widget la voce "Guida al widget" apre questa pagina. Dalla v0.89.1 (richiesta del CEO del
// 19/11/2026) ha lo stesso formato della pagina Chiedi di /suiteguida: un campo per cercare o chiedere, riferito al widget, e la guida
// testuale del widget da scaricare in PDF (estratto TD-SGI-MAN009_NN). Il testo dei capitoli resta in "Sfoglia la guida".
import React from 'react';
import { useParams } from 'react-router-dom';
import { ErrorBox } from '../../../components/ui.jsx';
import MAPPA from '../widget.json';
import Chiedi from './Chiedi.jsx';

export default function Widget() {
  const { key } = useParams();
  const w = MAPPA[key];
  if (!w) return <div className="page"><ErrorBox error={new Error('Per questo widget non c\'è ancora una guida')} /></div>;
  return <Chiedi key={key} widget={{ ...w, key }} />;
}

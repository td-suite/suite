import React from 'react';
import { useSearchParams } from 'react-router-dom';
import Warehouse from './Warehouse.jsx';
import Articles from './Articles.jsx';
import { SCHEDE_MAGAZZINO, schedaMagazzino } from '../lib/magazzino.js';

// v0.68.4 · Magazzino Centrale unico: "Giacenze Silva" (giacenze, lotti, visibilità dal feed Silva) e "Articoli ordinabili" (visibilità,
// confezione, categoria, codice Silva, etichetta abbinata: l'ex Catalogo articoli). La scheda è nell'indirizzo (?scheda=articoli).
export default function MagazzinoCentrale() {
  const [sp, setSp] = useSearchParams();
  const scheda = schedaMagazzino(sp.toString());
  const tabs = (
    <div className="tabs" role="tablist">
      {SCHEDE_MAGAZZINO.map((s) => <button key={s.key} role="tab" aria-selected={scheda === s.key} className={scheda === s.key ? 'on' : ''} onClick={() => setSp(s.key === 'giacenze' ? {} : { scheda: s.key })}>{s.label}</button>)}
    </div>
  );
  return scheda === 'articoli' ? <Articles tabs={tabs} evidenzia={Number(sp.get('articolo')) || null} /> : <Warehouse tabs={tabs} />;
}

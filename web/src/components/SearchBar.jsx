import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icons.jsx';

// Barra di ricerca grande della home: invio → /search?q=
export default function SearchBar({ initial = '', autoFocus, compact }) {
  const [q, setQ] = useState(initial);
  const navigate = useNavigate();
  const go = (e) => { e.preventDefault(); const v = q.trim(); if (v) navigate(`/search?q=${encodeURIComponent(v)}`); };
  return (
    <div className={`big-search ${compact ? 'compact' : ''}`}>
      <form onSubmit={go} role="search">
        <Icon name="search" className="lead" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca in tutta Toscana Diagnostica..." aria-label="Cerca in tutta Toscana Diagnostica" autoFocus={autoFocus} />
        <button className="btn" type="submit" aria-label="Cerca"><Icon name="arrowRight" /><span>Cerca</span></button>
      </form>
      {!compact && <div className="hint"><Icon name="sparkle" style={{ width: 14, height: 14, marginRight: 4 }} />Chiedi anche in linguaggio naturale: quali circolari devo ancora leggere?</div>}
    </div>
  );
}

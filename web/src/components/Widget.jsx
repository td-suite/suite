import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icons.jsx';
import { Popover } from './ui.jsx';
import { useAuth, isExternal } from '../auth.jsx';
import { MODULES, vociModulo } from '../modules/registry.js';

// Pagine del modulo per il menu "Apri pagina…" della card: voci del menu con percorso interno (to), visibili all'utente (profili, when),
// tranne quelle marcate paginaHome: false. Ogni pagina si apre in una scheda nuova.
export function paginePortale(meta, user) {
  if (!meta) return [];
  return vociModulo(meta, user).filter((i) => !i.group && typeof i.to === 'string' && i.paginaHome !== false)
    .map((i) => ({ label: i.label, icon: i.icon, href: `/${meta.key}${i.to ? `/${i.to}` : ''}` }));
}

// Riquadro quadrato di un modulo nella home. counter: { value, label } | undefined (skeleton finché countersLoading)
export default function Widget({ module: m, areaColor, areaKey, counter, countersLoading, profileLabel }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [menu, setMenu] = useState(false);
  // inside: modulo nativo o già travasato nella Suite (MIRROR/LIVE) → navigazione interna; altrimenti apre l'app originale via SSO
  const legacy = m.kind !== 'NATIVE' && !m.inside;
  const meta = MODULES[m.key];
  // Portali (Service, SGI: meta.homeSchedaNuova) aperti dal personale TD: scheda nuova e scelta della pagina (richiesta del CEO,
  // 01/11/2026: "il personale controlla i contenuti dei portali, non ci lavora dentro"). Per gli esterni la card resta com'è.
  const schedaNuova = !legacy && Boolean(meta?.homeSchedaNuova) && !isExternal(user);
  const href = m.href || m.route || '/';
  // in cima le voci extra del modulo (Portale Service: "Visualizza come Legal entity…"), poi le pagine del menu
  const pagine = schedaNuova ? [...(meta.paginaHomeExtra || []), ...paginePortale(meta, user)] : [];
  const open = () => {
    if (legacy) window.open(m.href || `/go/${m.key}`, '_blank', 'noopener');   // le app esterne si aprono in una scheda nuova: la Suite resta
    else if (schedaNuova) window.open(href, '_blank', 'noopener');
    else navigate(href);
  };
  const hasCounter = counter && counter.value != null;
  const card = (
    <button type="button" className={`widget ${areaKey || ''} ${hasCounter && Number(counter.value) > 0 ? 'live' : ''}`} style={{ '--area': areaColor }} onClick={open}
      aria-label={`${m.name}. ${m.tagline || ''}${hasCounter ? `. ${counter.value} ${counter.label || ''}` : ''}${legacy ? '. Apre l\'applicazione' : ''}${schedaNuova ? '. Si apre in una scheda nuova' : ''}`} title={schedaNuova ? `${m.name}: si apre in una scheda nuova` : m.tagline || m.name}>
      <span className="glow" aria-hidden="true" />
      {countersLoading && !counter && <span className="counter sk" aria-hidden="true" />}
      {hasCounter && <span className="counter" title={counter.label}>{counter.value}</span>}
      <div className="wi"><Icon name={m.icon} /></div>
      <div className="name">{m.name}</div>
      {hasCounter && counter.label ? <div className="tag live">{counter.label}</div> : <div className="tag">{m.module_mode === 'MIRROR' ? 'In collaudo nella Suite' : m.tagline}</div>}
      <div className="bottom">
        {(profileLabel || m.profile) ? <span className="prof">{profileLabel || m.profile}</span> : <span />}
        {(legacy || schedaNuova) && <span className="ext" title={legacy ? 'Apre l\'applicazione in una scheda nuova' : 'Si apre in una scheda nuova'}><Icon name="external" /></span>}
      </div>
    </button>
  );
  if (!schedaNuova || !pagine.length) return card;
  return (
    <div className="widget-wrap">
      {card}
      <button type="button" className="widget-pages" aria-haspopup="menu" aria-expanded={menu} title="Apri pagina…" aria-label={`Apri una pagina di ${m.name} in una scheda nuova`}
        onClick={(e) => { e.stopPropagation(); setMenu((x) => !x); }}><Icon name="chevronDown" /></button>
      <Popover open={menu} onClose={() => setMenu(false)} className="widget-pop">
        <div className="who"><div className="name">Apri pagina…</div><div className="small muted">{m.name} in una scheda nuova</div></div>
        {pagine.map((p) => (
          <a key={p.href} href={p.href} target="_blank" rel="noopener" role="menuitem" onClick={() => setMenu(false)}><Icon name={p.icon} />{p.label}<Icon name="external" className="ext" /></a>
        ))}
      </Popover>
    </div>
  );
}

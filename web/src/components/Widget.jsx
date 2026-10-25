import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icons.jsx';

// Riquadro quadrato di un modulo nella home. counter: { value, label } | undefined (skeleton finché countersLoading)
export default function Widget({ module: m, areaColor, areaKey, counter, countersLoading, profileLabel }) {
  const navigate = useNavigate();
  // inside: modulo nativo o già travasato nella Suite (MIRROR/LIVE) → navigazione interna; altrimenti apre l'app originale via SSO
  const legacy = m.kind !== 'NATIVE' && !m.inside;
  const open = () => {
    if (legacy) window.location.href = m.href || `/go/${m.key}`;
    else navigate(m.href || m.route || '/');
  };
  const hasCounter = counter && counter.value != null;
  return (
    <button type="button" className={`widget ${areaKey || ''} ${hasCounter && Number(counter.value) > 0 ? 'live' : ''}`} style={{ '--area': areaColor }} onClick={open}
      aria-label={`${m.name}. ${m.tagline || ''}${hasCounter ? `. ${counter.value} ${counter.label || ''}` : ''}${legacy ? '. Apre l\'applicazione' : ''}`} title={m.tagline || m.name}>
      <span className="glow" aria-hidden="true" />
      {countersLoading && !counter && <span className="counter sk" aria-hidden="true" />}
      {hasCounter && <span className="counter" title={counter.label}>{counter.value}</span>}
      <div className="wi"><Icon name={m.icon} /></div>
      <div className="name">{m.name}</div>
      {hasCounter && counter.label ? <div className="tag live">{counter.label}</div> : <div className="tag">{m.module_mode === 'MIRROR' ? 'In collaudo nella Suite' : m.tagline}</div>}
      <div className="bottom">
        {(profileLabel || m.profile) ? <span className="prof">{profileLabel || m.profile}</span> : <span />}
        {legacy && <span className="ext" title="Apre l'applicazione"><Icon name="external" /></span>}
      </div>
    </button>
  );
}

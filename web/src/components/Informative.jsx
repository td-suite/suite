// Le due informative della Suite (richiesta del CEO, 05/11/2026): Privacy e uso dell'intelligenza artificiale. URL e versioni arrivano
// da /api/auth/me (user.informative, app_settings consensi.*); qui le icone discrete in basso a sinistra della Home e nel piede della
// barra laterale, sempre in una nuova scheda.
import React from 'react';
import { useAuth } from '../auth.jsx';

export const URL_PREDEFINITI = { PRIVACY: 'https://www.toscanadiagnostica.it/documents/Privacy-Cookie-Policy.pdf', IA: '/informativa-ia' };
export const TITOLI = { PRIVACY: 'Informativa sulla privacy', IA: "Informativa sull'uso dell'intelligenza artificiale" };

// Scudo (privacy) e riquadro con la sigla IA, disegnati come le altre icone (tratto 1.9, currentColor)
export function IconaPrivacy({ size = 17 }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 5 3.5 8.3 8 9 4.5-.7 8-4 8-9V6l-8-3z" /><path d="M9 12l2 2 4-4" /></svg>;
}
export function IconaIA({ size = 17 }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="3.5" /><path d="M8 9v6" /><path d="M11.5 15l2.25-6 2.25 6M12.3 13h2.9" /></svg>;
}

export function useInformative() {
  const { user } = useAuth();
  const inf = user?.informative || {};
  return { PRIVACY: inf.PRIVACY?.url || URL_PREDEFINITI.PRIVACY, IA: inf.IA?.url || URL_PREDEFINITI.IA };
}

// variant: 'home' (fissa in basso a sinistra della pagina) oppure 'barra' (piede della barra laterale; non 'side', classe già della barra)
export default function InformativeIcone({ variant = 'home' }) {
  const url = useInformative();
  return (
    <div className={`informative-icone ${variant}`} role="navigation" aria-label="Informative">
      <a href={url.PRIVACY} target="_blank" rel="noopener noreferrer" title={`${TITOLI.PRIVACY} (si apre in una nuova scheda)`} aria-label={TITOLI.PRIVACY}><IconaPrivacy /></a>
      <a href={url.IA} target="_blank" rel="noopener noreferrer" title={`${TITOLI.IA} (si apre in una nuova scheda)`} aria-label={TITOLI.IA}><IconaIA /></a>
    </div>
  );
}

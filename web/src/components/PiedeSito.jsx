// Piè di pagina della Home come quello del sito www.toscanadiagnostica.it (richiesta del CEO, 05/11/2026): dati aziendali,
// prenotazione telefonica e supporto clienti, social network e gli allegati (Privacy e Cookie Policy, Informativa IA, Carta dei
// servizi se impostata). Niente informative per i pazienti né sui test genetici: non riguardano chi usa la Suite.
// I dati vengono da /api/company (Amministrazione > Impostazioni > Dati aziendali); i link delle informative da /api/auth/me.
import React from 'react';
import { useApi } from './ui.jsx';
import { useInformative, TITOLI } from './Informative.jsx';

const righe = (s) => String(s || '').split('\n').map((r) => r.trim()).filter(Boolean);
const Ico = ({ d, size = 16 }) => <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const SOCIAL = {
  facebook: { label: 'Facebook', d: <path d="M14 8h2V5h-2a3.5 3.5 0 0 0-3.5 3.5V11H8v3h2.5v7h3v-7H16l.5-3h-3V8.8c0-.5.3-.8.5-.8z" /> },
  instagram: { label: 'Instagram', d: <><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" /><circle cx="12" cy="12" r="3.6" /><circle cx="17.2" cy="6.8" r=".8" fill="currentColor" /></> },
  linkedin: { label: 'LinkedIn', d: <><path d="M7 10v7M7 7v.1M11 17v-4a2.5 2.5 0 0 1 5 0v4M11 10v7" /><rect x="3.5" y="3.5" width="17" height="17" rx="2.5" /></> },
};

export default function PiedeSito() {
  const { data } = useApi('/company');
  const url = useInformative();
  const c = data?.company || {};
  const social = ['facebook', 'instagram', 'linkedin'].filter((k) => c[`social_${k}`]);
  const sito = c.website ? (c.website.startsWith('http') ? c.website : `https://${c.website}`) : null;
  return (
    <footer className="piede-sito" aria-label="Dati aziendali">
      <div className="piede-sito-inner">
        <div className="blocco azienda">
          <div className="logo"><img src="/logo-dark.svg" alt="Toscana Diagnostica" onError={(e) => { e.currentTarget.style.display = 'none'; }} /></div>
          <div className="small brand">{c.legal_name || 'Toscana Diagnostica S.r.l.'}</div>
          <div className="small">{[c.address, [c.zip, c.city].filter(Boolean).join(' ') + (c.province ? ` (${c.province})` : '')].filter(Boolean).join(', ')}</div>
          <div className="small">{c.vat && <>P.IVA: {c.vat}</>}{c.tax_code && <> – C.F.: {c.tax_code}</>}</div>
          <div className="small">{c.rea && <>REA {c.rea}</>}{c.sdi_code && <> – Codice SDI: {c.sdi_code}</>}</div>
          <div className="small mt"><b>Mail:</b> <a href={`mailto:${c.email}`}>{c.email}</a></div>
          {c.pec && <div className="small"><b>PEC:</b> <a href={`mailto:${c.pec}`}>{c.pec}</a></div>}
          {sito && <div className="small"><b>Web:</b> <a href={sito} target="_blank" rel="noopener noreferrer">{c.website}</a></div>}
          {c.share_capital && <div className="small mt">Capitale Sociale: {c.share_capital.replace(/^€\s*/, '').replace(/\s*i\.v\.?\s*$/i, '')} euro i.v.</div>}
          {c.health_director && <div className="small mt">Direttore Sanitario: {c.health_director}</div>}
          {c.health_authorization && <div className="small">{c.health_authorization}</div>}
        </div>
        <div className="blocco orari">
          <div className="h">Prenotazione Telefonica</div>
          {righe(c.booking_hours).map((r) => <div key={r} className="small">{r}</div>)}
          <div className="h gap">Supporto Clienti</div>
          {righe(c.support_hours).map((r) => <div key={r} className="small">{r}</div>)}
          {c.support_phone && <a className="pill" href={`tel:${String(c.support_phone).replace(/\s/g, '')}`}><Ico d={<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />} />{c.support_phone}</a>}
          {c.support_email && <a className="pill" href={`mailto:${c.support_email}`}>{c.support_email}</a>}
        </div>
        <div className="blocco social">
          <div className="h">Social network</div>
          <div className="icone">{social.length ? social.map((k) => <a key={k} href={c[`social_${k}`]} target="_blank" rel="noopener noreferrer" title={SOCIAL[k].label} aria-label={SOCIAL[k].label}><Ico d={SOCIAL[k].d} size={18} /></a>) : <span className="small muted">Link ai profili da impostare in Amministrazione</span>}</div>
          <nav className="allegati" aria-label="Documenti">
            <a href={url.PRIVACY} target="_blank" rel="noopener noreferrer">Privacy e Cookie Policy</a>
            <a href={url.IA} target="_blank" rel="noopener noreferrer">{TITOLI.IA}</a>
            {c.service_charter_url && <a href={c.service_charter_url} target="_blank" rel="noopener noreferrer">Carta dei servizi</a>}
          </nav>
        </div>
      </div>
    </footer>
  );
}

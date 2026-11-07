// Business Hub · pulsanti di stampa del DB Opportunità, usati in Pipeline e in Clienti e prospect.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { BASE, scarica } from '../api.js';
import { useToast } from './ui.jsx';
import { LINEE } from '../format.js';

// Stampa del DB Opportunità (PDF su carta intestata o XLSX, tutte le 49 colonne) degli account filtrati nell'ordine della pipeline:
// censiti e poi fase per fase (07/11/2026, il CEO: "la stampa è molto bella, includiamola in Pipeline"). La tabella con la scelta
// delle colonne resta in /business/db-opportunita.
export function StampaDB({ righe, f, compatto = false }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const descr = [f.linea && `linea ${LINEE[f.linea]?.label}`, f.q && `ricerca "${f.q}"`, f.priorita && `priorità ${f.priorita}`, f.prov && `provincia ${f.prov}`, f.segmento && `segmento ${f.segmento}`, f.fase && `fase ${f.fase}`, f.stallo && 'solo in stallo', f.attivo && (f.attivo === '1' ? 'clienti attivi' : 'non attivi')].filter(Boolean).join(' · ');
  const go = async (formato) => {
    setBusy(formato);
    try { const ids = [...righe].sort((a, b) => a.fase_corrente - b.fase_corrente || (a.org_name || '').localeCompare(b.org_name || '')).map((a) => a.id); const n = await scarica('/hub/opportunita/export', { formato, ids, filtri: descr || undefined }, `DB_Opportunita.${formato}`); toast(`Scaricato ${n}`); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(''); }
  };
  return (
    <>
      <button className={`btn ghost ${compatto ? 'sm' : ''}`} disabled={Boolean(busy) || !righe.length} onClick={() => go('xlsx')} title="Tutte le colonne del DB Opportunità, righe filtrate">{busy === 'xlsx' ? 'Preparo…' : 'XLSX'}</button>
      <button className={`btn ghost ${compatto ? 'sm' : ''}`} disabled={Boolean(busy) || !righe.length} onClick={() => go('pdf')} title="Stampa su carta intestata, righe filtrate">{busy === 'pdf' ? 'Preparo…' : 'Stampa PDF'}</button>
      <Link className={`btn ghost ${compatto ? 'sm' : ''}`} to={`${BASE}/db-opportunita`} title="Tabella completa con scelta delle colonne">Tabella</Link>
    </>
  );
}

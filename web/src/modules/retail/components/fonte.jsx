// Dichiarazione della fonte nelle pagine di Retail (riordino del 09/11/2026): ogni pagina B2B dichiara StudioLab (Synclab) e l'ultimo
// checkpoint della copia; ogni pagina B2C dichiara GIPO o TuoTempo e l'ultimo import/allineamento. Nessun dato inventato: senza dati lo dice.
import React from 'react';
import { Link } from 'react-router-dom';
import { itDateTime, itDate } from '../format.js';
import { api } from '../api.js';

const NOMI = { requests: 'accettazioni', invoices: 'documenti', clients: 'clienti', 'price-lists': 'listini', exams: 'esami' };

/**
 * Riga "Fonte: StudioLab (Synclab Data API) · checkpoint accettazioni … · documenti …"; insiemi = quali checkpoint mostrare.
 * v0.68.5: con `d` (risposta delle API B2B) dichiara la grandezza principale: "Produzione accettata: Synclab, accettazioni (stati …),
 * importi di riga e sconto di testata come da impostazioni, copia al … · aggiornato alle HH:MM".
 */
export function FonteSynclab({ stato, insiemi = ['requests', 'invoices'], extra, d }) {
  const ins = stato?.insiemi || {};
  const vuoto = stato && !stato.conteggi?.requests && !stato.conteggi?.invoices;
  return (
    <>
      {d?.fonte_produzione && <div className="small fonte" data-testid="fonte-produzione" style={{ margin: '-6px 0 4px' }} title={d.stati_descritti ? `Stati della produzione accettata: ${d.stati_descritti}` : undefined}>
        <b>Produzione accettata</b> · {d.fonte_produzione}</div>}
      <div className="small muted fonte" data-testid="fonte-synclab" style={{ margin: d?.fonte_produzione ? '0 0 12px' : '-6px 0 12px' }}>
        <b>Fonte: StudioLab (Synclab Data API)</b>, copia locale in sola lettura · {insiemi.map((k) => `${NOMI[k] || k}: ${ins[k]?.checkpoint_at ? `checkpoint ${itDateTime(ins[k].checkpoint_at)}` : 'nessun checkpoint'}`).join(' · ')}{extra ? ` · ${extra}` : ''}
      </div>
      {vuoto && <div className="alert warn" style={{ marginBottom: 12 }}><div>Nessuna accettazione né documento importato dal gestionale: la copia si alimenta da <Link to="/admin/connectors/synclab"><b>Amministrazione &gt; Connettori &gt; StudioLAB &gt; Dati Synclab</b></Link>.</div></div>}
    </>
  );
}

/** Riga "Fonte: GIPO … ultimo import" oppure "Fonte: TuoTempo … ultimo allineamento". */
export function FonteB2C({ fonte, aggiornato, dettaglio }) {
  return <div className="small muted fonte" data-testid="fonte-b2c" style={{ margin: '-6px 0 12px' }}><b>Fonte: {fonte}</b> · {aggiornato ? `ultimo aggiornamento ${itDateTime(aggiornato)}` : 'mai aggiornato'}{dettaglio ? ` · ${dettaglio}` : ''}</div>;
}

/** Selettore del periodo (ultimi 12 mesi, mese, trimestre, anno) come nel profilo dei pazienti; value = { tipo, mese, trimestre, anno }. */
export function periodoQuery(p) { return p.tipo === 'mese' ? p.mese : p.tipo === 'trimestre' ? p.trimestre : p.tipo === 'anno' ? p.anno : '12m'; }
export function PeriodoSelect({ value, onChange, oggi, solo }) {
  const anno = oggi.slice(0, 4);
  const anni = Array.from({ length: 4 }, (_, i) => String(Number(anno) - i));
  const trimestri = anni.flatMap((y) => [4, 3, 2, 1].map((t) => `${y}-Q${t}`));
  const set = (k, v) => onChange({ ...value, [k]: v });
  const tipi = [['12m', 'Ultimi 12 mesi'], ['mese', 'Mese'], ['trimestre', 'Trimestre'], ['anno', 'Anno']].filter(([k]) => !solo || solo.includes(k));
  return (<>
    <label className="f">Periodo<select value={value.tipo} onChange={(e) => set('tipo', e.target.value)}>{tipi.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
    {value.tipo === 'mese' && <label className="f">Mese<input type="month" value={value.mese} onChange={(e) => set('mese', e.target.value)} /></label>}
    {value.tipo === 'trimestre' && <label className="f">Trimestre<select value={value.trimestre} onChange={(e) => set('trimestre', e.target.value)}>{trimestri.map((t) => <option key={t} value={t}>{t.slice(-1)}° trimestre {t.slice(0, 4)}</option>)}</select></label>}
    {value.tipo === 'anno' && <label className="f">Anno<select value={value.anno} onChange={(e) => set('anno', e.target.value)}>{anni.map((y) => <option key={y}>{y}</option>)}</select></label>}
  </>);
}
export const periodoIniziale = (oggi, tipo = '12m') => ({ tipo, mese: oggi.slice(0, 7), trimestre: `${oggi.slice(0, 4)}-Q${Math.ceil(Number(oggi.slice(5, 7)) / 3)}`, anno: oggi.slice(0, 4) });
export const intervallo = (per) => (per ? `${itDate(per.da)} – ${itDate(per.a)}` : '');

/** Variazione percentuale colorata (null = trattino). */
export function VarPct({ v, invert = false }) {
  if (v == null) return <span className="muted">–</span>;
  const good = invert ? v < 0 : v > 0;
  return <span style={{ color: v === 0 ? 'inherit' : good ? '#2f7d5b' : '#b3372f', fontWeight: 650 }}>{v > 0 ? '+' : ''}{Number(v).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%</span>;
}

/**
 * Fonte delle pagine B2C che leggono le vendite importate (GIPO) o le Key Entities di TuoTempo: chiede a /stats/fonti l'ultimo import GIPO
 * e l'ultimo allineamento TuoTempo. tipo = 'GIPO' | 'TUOTEMPO' | 'GIPO+TUOTEMPO' | 'SEDE' (registrazioni in sede, con le vendite GIPO).
 */
export function FonteB2CAuto({ tipo = 'GIPO' }) {
  const [d, setD] = React.useState(null);
  React.useEffect(() => { let vivo = true; api.get('/stats/fonti', { silent: true }).then((x) => vivo && setD(x)).catch(() => {}); return () => { vivo = false; }; }, []);
  if (!d) return null;
  const g = `GIPO: ${d.gipo.ultimo_import ? `ultimo import ${itDateTime(d.gipo.ultimo_import)}` : 'nessun import'}${d.gipo.ultima_vendita ? `, vendite fino al ${itDate(d.gipo.ultima_vendita)}` : ''}`;
  const t = `TuoTempo: ${d.tuotempo.ultimo_allineamento ? `ultimo allineamento ${itDateTime(d.tuotempo.ultimo_allineamento)}` : 'mai allineato'}`;
  const testo = tipo === 'TUOTEMPO' ? t : tipo === 'GIPO+TUOTEMPO' ? `${t} · ${g}` : tipo === 'SEDE' ? `registrazioni in sede (Retail) · ${g}` : g;
  return <div className="small muted fonte" data-testid="fonte-b2c" style={{ margin: '-6px 0 12px' }}><b>Fonte</b> · {testo}</div>;
}

/** Mini barre della produzione accettata giorno per giorno (cruscotti di Retail e scheda cliente). giorni = [{ giorno, valore, esami }]. */
export function BarreGiorni({ giorni = [], altezza = 70, fmtValore = (v) => String(v) }) {
  if (!giorni.length) return null;
  const max = Math.max(1, ...giorni.map((g) => Number(g.valore) || 0));
  const oggi = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  return (
    <div data-testid="barre-giorni">
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: altezza }} aria-hidden="true">
        {giorni.map((g) => {
          const fest = [0, 6].includes(new Date(`${g.giorno}T12:00:00Z`).getUTCDay());
          return <span key={g.giorno} title={`${g.giorno.slice(8, 10)}/${g.giorno.slice(5, 7)}: ${fmtValore(g.valore)} · ${g.esami} esami`}
            style={{ flex: 1, minWidth: 0, height: `${Math.max(g.valore ? 4 : 1, (Number(g.valore || 0) / max) * 100)}%`, borderRadius: '2px 2px 0 0',
              background: g.giorno === oggi ? 'var(--blue)' : fest ? 'color-mix(in srgb, var(--blue) 25%, transparent)' : 'color-mix(in srgb, var(--blue) 60%, transparent)' }} />;
        })}
      </div>
      <div className="small muted" style={{ display: 'flex', justifyContent: 'space-between' }}><span>{giorni[0].giorno.slice(8, 10)}/{giorni[0].giorno.slice(5, 7)}</span><span>{giorni[giorni.length - 1].giorno.slice(8, 10)}/{giorni[giorni.length - 1].giorno.slice(5, 7)}</span></div>
    </div>
  );
}

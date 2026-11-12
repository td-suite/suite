// Lab Control · Accettazioni: elenco paginato lato server con i filtri in alto (cliente, sede, data, fase, solo in ritardo, con NC, non
// fatturate, ricerca per numero, barcode o cognome sulle identità recenti). Colonne scelte per utente (ricordate in questo browser),
// ordinamento, export Excel senza nomi dei pazienti. Il clic sulla riga apre la scheda; il clic sul cliente apre il Business Hub (menu con
// gli altri collegamenti). I filtri stanno nell'indirizzo: i link dagli altri widget (Business Hub, Retail, NC) li impostano.
import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Badge, Card, ErrorBox, PageHead, Pager, Popover, Skeleton } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useApi, qs, base, apiBase } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ClienteLink, CopiaInfo, FaseBar, FiltroCliente, FiltroPeriodo, FiltroSede, gg, ora, dataOra, eur, num, durata, useFiltriUrl, useStatoLab } from './comuni.jsx';
import Documento from './Documento.jsx';

const COLONNE = {
  numero: { label: 'Numero', ord: 'numero' }, data: { label: 'Data e ora', ord: 'data' }, cliente: { label: 'Cliente', ord: 'cliente' }, sede: { label: 'Sede', ord: 'sede' },
  paziente: { label: 'Paziente' }, tipo: { label: 'Tipo' }, esami: { label: 'Pronti', num: true, title: 'Esami con referto pronto sul totale' }, campioni: { label: 'Camp.', num: true, title: 'Campioni' },
  fase: { label: 'Fase', ord: 'fase' }, aggiornata: { label: 'Aggiornata', ord: 'aggiornata' }, valore: { label: 'Valore', num: true }, fattura: { label: 'Fattura' },
  nc: { label: 'NC' }, ritardo: { label: 'Ritardo', ord: 'ritardo' },
};
const CHIAVE_COLONNE = (u) => `td-lc-colonne-${u?.id || 'x'}`;
const leggiColonne = (u, predefinite) => {
  try { const v = JSON.parse(localStorage.getItem(CHIAVE_COLONNE(u)) || 'null'); if (Array.isArray(v) && v.length) return v.filter((c) => COLONNE[c]); } catch { /* storage non disponibile */ }
  return predefinite?.length ? predefinite : PREDEFINITE;
};
// predefinite: tutte tranne tipo paziente, campioni e ultimo aggiornamento (si aggiungono da "Colonne"), così la tabella sta nella pagina
const PREDEFINITE = ['numero', 'data', 'cliente', 'sede', 'paziente', 'esami', 'fase', 'valore', 'fattura', 'nc', 'ritardo'];

export default function Accettazioni() {
  const { user } = useAuth();
  const st = useStatoLab();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [f, set] = useFiltriUrl(sp, setSp);
  const [testo, setTesto] = useState(f.q || '');
  const [colonne, setColonne] = useState(null);
  const [menuCol, setMenuCol] = useState(false);
  const [doc, setDoc] = useState(null);
  const q = useApi(`/lab/accettazioni${qs(f)}`, [sp.toString()]);
  const d = q.data;
  const cols = colonne || leggiColonne(user, st.data?.colonne_predefinite);
  const salvaColonne = (v) => { setColonne(v); try { localStorage.setItem(CHIAVE_COLONNE(user), JSON.stringify(v)); } catch { /* storage non disponibile */ } };
  const ordina = (c) => { const o = COLONNE[c]?.ord; if (!o) return; set({ ord: o, dir: d?.ord === o && d?.dir === 'desc' ? 'asc' : 'desc' }); };
  const apri = (r) => nav(`${base}/accettazioni/${encodeURIComponent(r.instance_id)}/${encodeURIComponent(r.id)}`);
  const exportUrl = `${apiBase}/lab/accettazioni.xlsx${qs(f)}`;
  const filtriAttivi = ['cliente', 'sede', 'fase', 'ritardo', 'nc', 'non_fatturate', 'q', 'in_corso', 'referti_aperti', 'non_eseguiti', 'stato', 'tipo', 'mdl'].filter((k) => f[k]).length;
  const cella = useMemo(() => ({
    numero: (r) => <b className="mono">{r.numero}</b>,
    data: (r) => <span className="nowrap" title={gg(r.data)}>{gg(r.data).slice(0, 5)} <span className="muted">{ora(r.creata_il)}</span></span>,
    cliente: (r) => <ClienteLink r={r} />,
    sede: (r) => (r.sede ? <span className="lc-ell" title={r.sede}>{r.sede.split(' ')[0]}</span> : <span className="muted">–</span>),
    paziente: (r) => (r.paziente ? <span className="lc-ell" title="Identità recente (Label)">{r.paziente}</span> : <span className="muted">{[r.eta != null ? `${r.eta} anni` : null, r.sesso].filter(Boolean).join(' · ') || '–'}</span>),
    tipo: (r) => <span className="small">{r.tipo_paziente || '–'}{r.medicina_lavoro && <Badge tone="mauve" title="Medicina del lavoro">MdL</Badge>}</span>,
    esami: (r) => <span title={`${r.esami_pronti} pronti, ${r.esami_validati} validati${r.esami_non_eseguiti ? `, ${r.esami_non_eseguiti} non eseguiti` : ''}`}><span className="nowrap">{r.esami_pronti}/{r.esami}</span>{r.esami_non_eseguiti ? <Badge tone="amber" title="Esami non eseguiti">{r.esami_non_eseguiti} NE</Badge> : null}</span>,
    campioni: (r) => r.campioni,
    fase: (r) => <FaseBar fase={r.fase} tappe={r.fase.tappe} compatta />,
    aggiornata: (r) => <span className="nowrap small">{dataOra(r.aggiornata_il, d?.adesso?.slice(0, 10)) || '–'}</span>,
    valore: (r) => (r.valore == null ? <span className="muted">–</span> : <span className="nowrap" title={r.valore_parziale ? 'Valore parziale: righe senza prezzo' : 'Produzione accettata'}>{eur(r.valore)}{r.valore_parziale ? '*' : ''}</span>),
    fattura: (r) => (r.fatture.length ? <button type="button" className="lc-link" onClick={(e) => { e.stopPropagation(); setDoc({ instanceId: r.instance_id, id: r.fatture[0].id }); }} title="Apri il documento economico">{r.fatture[0].numero || 'documento'}{r.fatture.length > 1 ? ` +${r.fatture.length - 1}` : ''}</button> : <span className="muted">–</span>),
    nc: (r) => (r.nc ? <Badge tone={r.nc.aperte ? 'red' : 'grey'} title={`${r.nc.totale} NC, ${r.nc.aperte} aperte`}>{r.nc.totale}</Badge> : null),
    ritardo: (r) => (r.ritardo.in_ritardo ? <Badge tone="red" title={r.ritardo.motivo}>{durata(r.ritardo.ore * 60)}</Badge> : r.ritardo.ore >= 1 ? <span className="small muted" title="Ore dall'accettazione">{durata(r.ritardo.ore * 60)}</span> : null),
  }), [d?.adesso]);

  return (
    <div className="page lc-page">
      <PageHead title="Accettazioni" icon="list" sub="Accettazioni StudioLab con lo stato di avanzamento fino al referto e alla chiusura"
        actions={<><a className="btn ghost" href={exportUrl} title="Excel con i filtri attuali, senza i nomi dei pazienti"><Icon name="sheet" />Excel</a></>} />
      <div className="lc-filtri" data-testid="lc-filtri">
        <FiltroCliente value={f.cliente} etichetta={d?.cliente_nome} onChange={(v) => set({ cliente: v })} />
        <FiltroSede sedi={st.data?.sedi} value={f.sede} onChange={(v) => set({ sede: v })} tutte={st.data?.tutte} />
        <FiltroPeriodo f={f} onChange={set} tutto />
        <select className="lc-sel" value={f.fase || ''} onChange={(e) => set({ fase: e.target.value })} aria-label="Fase">
          <option value="">Tutte le fasi</option>
          {(st.data?.fasi || []).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
        </select>
        <form className="lc-cerca" onSubmit={(e) => { e.preventDefault(); set({ q: testo.trim(), ...(testo.trim() && /\d/.test(testo) && !f.periodo ? { periodo: 'tutto' } : {}) }); }}>
          <input type="search" value={testo} onChange={(e) => { setTesto(e.target.value); if (!e.target.value) set({ q: '' }); }} placeholder="Numero, barcode o cognome" aria-label="Numero, barcode o cognome" />
        </form>
        <label className="lc-check"><input type="checkbox" checked={f.ritardo === '1'} onChange={(e) => set({ ritardo: e.target.checked ? '1' : '' })} />Solo in ritardo</label>
        {st.data?.nc_disponibile && <label className="lc-check"><input type="checkbox" checked={f.nc === '1'} onChange={(e) => set({ nc: e.target.checked ? '1' : '' })} />Con NC</label>}
        <label className="lc-check"><input type="checkbox" checked={f.non_fatturate === '1'} onChange={(e) => set({ non_fatturate: e.target.checked ? '1' : '' })} />Non fatturate</label>
        {filtriAttivi > 0 && <button type="button" className="btn sm ghost" onClick={() => { setTesto(''); setSp(new URLSearchParams(f.periodo ? { periodo: f.periodo } : {}), { replace: true }); }}>Togli i filtri</button>}
      </div>
      {(f.in_corso || f.referti_aperti || f.non_eseguiti || f.stato) && (
        <div className="lc-chips">
          {f.in_corso && <span className="lc-chip">In corso (stati 15, 18, 20, 25)<button type="button" onClick={() => set({ in_corso: '' })} aria-label="Togli"><Icon name="x" /></button></span>}
          {f.referti_aperti && <span className="lc-chip">Referto pronto, non chiusa<button type="button" onClick={() => set({ referti_aperti: '' })} aria-label="Togli"><Icon name="x" /></button></span>}
          {f.non_eseguiti && <span className="lc-chip">Con esami non eseguiti<button type="button" onClick={() => set({ non_eseguiti: '' })} aria-label="Togli"><Icon name="x" /></button></span>}
          {f.stato && <span className="lc-chip">Stato {f.stato}<button type="button" onClick={() => set({ stato: '' })} aria-label="Togli"><Icon name="x" /></button></span>}
        </div>
      )}
      <ErrorBox error={q.error} />
      {f.q && !/\d/.test(f.q) && <div className="small muted lc-nota">Il cognome si cerca solo sulle accettazioni degli ultimi giorni (identità recenti di Label).</div>}
      <Card flush className="lc-elenco" title={d ? `${num(d.totale)} accettazioni${d.filtri?.da ? ` dal ${gg(d.filtri.da)} al ${gg(d.filtri.a)}` : ''}` : 'Accettazioni'}
        actions={<span className="lc-azioni-el">{d && <CopiaInfo copia={d.copia} />}
          <span className="lc-rel"><button type="button" className="btn sm ghost" onClick={() => setMenuCol((x) => !x)} aria-expanded={menuCol}><Icon name="gear" />Colonne</button>
            <Popover open={menuCol} onClose={() => setMenuCol(false)} className="lc-pop lc-pop-col">
              <div className="who"><div className="name">Colonne dell'elenco</div><div className="small muted">Ricordate in questo browser</div></div>
              {Object.entries(COLONNE).map(([k, c]) => <label key={k} className="item"><input type="checkbox" checked={cols.includes(k)} onChange={(e) => salvaColonne(e.target.checked ? Object.keys(COLONNE).filter((x) => x === k || cols.includes(x)) : cols.filter((x) => x !== k))} />{c.title || c.label}</label>)}
              <button type="button" className="item" onClick={() => { try { localStorage.removeItem(CHIAVE_COLONNE(user)); } catch { /* */ } setColonne(null); setMenuCol(false); }}>Torna alle predefinite</button>
            </Popover></span></span>}>
        {!d ? <div className="lc-pad"><Skeleton lines={8} /></div> : !d.righe.length ? <div className="lc-pad muted">Nessuna accettazione con questi filtri.{d.filtri?.nc_non_disponibile ? ' Il modulo Non conformità non è attivo.' : ''}</div> : <>
          <div className="table-wrap lc-tab">
            <table className="t lc-t" data-testid="lc-tabella">
              <thead><tr>{cols.map((c) => <th key={c} className={`${COLONNE[c].num ? 'num' : ''} ${COLONNE[c].ord ? 'ord' : ''} c-${c}`} title={COLONNE[c].title} onClick={() => ordina(c)}
                aria-sort={d.ord === COLONNE[c].ord ? (d.dir === 'asc' ? 'ascending' : 'descending') : undefined}>{COLONNE[c].label}{d.ord === COLONNE[c].ord && <Icon name={d.dir === 'asc' ? 'arrowUp' : 'arrowDown'} />}</th>)}</tr></thead>
              <tbody>{d.righe.map((r) => (
                <tr key={`${r.instance_id}|${r.id}`} className={`click ${r.ritardo.in_ritardo ? 'rit' : ''}`} onClick={() => apri(r)}>
                  {cols.map((c) => <td key={c} className={`${COLONNE[c].num ? 'num' : ''} c-${c}`}>{cella[c](r)}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="lc-schede" data-testid="lc-schede">
            {d.righe.map((r) => (
              <div key={`${r.instance_id}|${r.id}`} className={`lc-riga ${r.ritardo.in_ritardo ? 'rit' : ''}`} onClick={() => apri(r)} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && apri(r)}>
                <div className="r1"><b className="mono">{r.numero}</b><span className="muted small">{gg(r.data)} {ora(r.creata_il)}</span>{r.ritardo.in_ritardo && <Badge tone="red">{durata(r.ritardo.ore * 60)}</Badge>}</div>
                <div className="r2"><ClienteLink r={r} />{r.sede && <span className="muted small"> · {r.sede}</span>}</div>
                <FaseBar fase={r.fase} tappe={r.fase.tappe} compatta />
                <div className="r3 small muted">{r.esami_pronti}/{r.esami} {r.esami === 1 ? 'esame pronto' : 'esami pronti'} · {r.campioni} {r.campioni === 1 ? 'campione' : 'campioni'}{r.valore != null ? ` · ${eur(r.valore)}` : ''}{r.fatture.length ? ` · fattura ${r.fatture[0].numero || ''}` : ''}{r.paziente ? ` · ${r.paziente}` : r.eta != null ? ` · ${r.eta} anni ${r.sesso || ''}` : ''}</div>
              </div>
            ))}
          </div>
          <div className="lc-pager"><Pager page={d.pagina} pageSize={d.per_pagina} total={d.totale} onChange={(p) => set({ pagina: p }, { pagina: false })} /></div>
          <div className="small muted lc-nota lc-pad">Valore = produzione accettata (stati {d.regola.stati.join(', ')}, {d.regola.sconto === 'APPLICA' ? 'con lo sconto di testata' : 'importi di riga'}); * = righe senza prezzo. Ritardo: oltre {d.soglia.ore_ritardo} ore dall'accettazione senza referto{Object.keys(d.soglia.soglie_fase || {}).length ? ', o ferma in una fase oltre la sua soglia' : ''}. Paziente: nome solo per le accettazioni degli ultimi giorni, altrimenti età e sesso.</div>
        </>}
      </Card>
      {doc && <Documento instanceId={doc.instanceId} id={doc.id} onClose={() => setDoc(null)} />}
    </div>
  );
}

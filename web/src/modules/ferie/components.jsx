// Componenti condivisi del Piano Ferie: badge di stato, riquadri del saldo, tabella delle richieste, griglia del piano.
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '../../components/ui.jsx';
import { Icon } from '../../components/Icons.jsx';
import { base } from './api.js';
import { STATO, MESI, GG, num, itData, periodo, quantita, giorniTra, weekday, quotaInData, oggiIso } from './format.js';

export const StatoBadge = ({ stato }) => <Badge tone={STATO[stato]?.tone || 'grey'}>{STATO[stato]?.label || stato}</Badge>;

// Riquadri del saldo: spettanza, maturato, residuo anno precedente, goduto, pianificato, in attesa, residuo
export function Saldo({ s, compatto }) {
  if (!s) return null;
  const voci = [
    { k: 'residuo', l: 'Residuo', v: s.residuo, cls: s.residuo < 0 ? 'neg' : 'main', foot: `disponibili per nuove richieste: ${num(s.disponibile)}` },
    { k: 'spettanza', l: `Spettanza ${s.anno}`, v: s.spettanza, foot: s.mesi < 12 ? `${s.mesi} mesi su 12 · ${num(s.giorni_annui)} giorni annui` : `${num(s.giorni_annui)} giorni annui` },
    { k: 'maturato', l: 'Maturato a oggi', v: s.maturato, foot: `${s.mesi_maturati} mesi conclusi` },
    { k: 'residuo_ap', l: 'Anno precedente', v: s.residuo_ap, foot: s.residuo_ap_fonte ? (s.residuo_ap_fonte === 'XLSX' ? 'da file HR' : 'inserito da HR') : 'non ancora inserito da HR' },
    { k: 'goduto', l: 'Goduti', v: s.goduto },
    { k: 'pianificato', l: 'Pianificati', v: s.pianificato, foot: 'approvati, da godere' },
    { k: 'in_attesa', l: 'In attesa', v: s.in_attesa, foot: 'richieste da approvare' },
  ];
  return (
    <div className={`fe-saldo ${compatto ? 'compatto' : ''}`}>
      {voci.map((x) => <div key={x.k} className={`fe-kpi ${x.cls || ''}`}><div className="l">{x.l}</div><div className="v">{num(x.v)}<small>gg</small></div>{x.foot && !compatto && <div className="f">{x.foot}</div>}</div>)}
      {s.rol && <div className="fe-kpi rol"><div className="l">ROL e permessi</div><div className="v">{s.rol.residuo == null ? '-' : num(s.rol.residuo)}<small>h</small></div>{!compatto && <div className="f">{s.rol.spettanza == null ? 'ore annue da impostare (HR)' : `spettanza ${num(s.rol.spettanza)} h · godute ${num(s.rol.goduto)} h`}</div>}</div>}
    </div>
  );
}

export function Avvisi({ avvisi }) {
  if (!avvisi?.length) return null;
  return <div className="fe-avvisi">{avvisi.map((a, i) => <div key={i} className={`alert ${a.grave ? 'err' : 'warn'}`}><Icon name="alert" /><span>{a.testo}</span></div>)}</div>;
}

export function TabellaRichieste({ rows, mostraPersona = true, mostraArea = false, vuoto = 'Nessuna richiesta' }) {
  const nav = useNavigate();
  if (!rows?.length) return <div className="empty compact"><Icon name="calendar" /><div className="small">{vuoto}</div></div>;
  return (
    <div className="table-wrap"><table className="t fe-table">
      <thead><tr>{mostraPersona && <th>Persona</th>}{mostraArea && <th>Area</th>}<th>Periodo</th><th className="num">Quantità</th><th>Stato</th><th>Note</th><th>Inserita</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.id} className="click" onClick={() => nav(`${base}/richieste/${r.id}`)}>
          {mostraPersona && <td className="strong">{r.persona}</td>}
          {mostraArea && <td className="small">{r.gruppo_nome}</td>}
          <td style={{ whiteSpace: 'nowrap' }}>{periodo(r)}{r.chiusura_id && <div className="small muted">chiusura collettiva</div>}</td>
          <td className="num" style={{ whiteSpace: 'nowrap' }}>{quantita(r)}</td>
          <td><StatoBadge stato={r.stato} />{r.sotto_copertura && ['RICHIESTA', 'APPROVATA'].includes(r.stato) && <div className="small fe-warn" title="Uno o più giorni scendono sotto la copertura minima della sede o dell'area"><Icon name="alert" /> copertura</div>}</td>
          <td className="small" style={{ maxWidth: 280 }}>{r.note}{r.nota_decisione && <div className="muted">{r.nota_decisione}</div>}</td>
          <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{itData(String(r.created_at).slice(0, 10))}</td>
        </tr>))}</tbody>
    </table></div>
  );
}

// Griglia del piano: persone × giorni di un mese (vista mese) o persone × settimane dell'anno (vista anno)
export function Griglia({ piano, anno, mese, vista = 'mese', onGiorno }) {
  const nav = useNavigate();
  const fest = useMemo(() => new Map((piano?.festivi || []).map((f) => [f.data, f.nome])), [piano]);
  const scop = useMemo(() => { const m = new Map(); for (const s of piano?.scoperture || []) { if (!m.has(s.data)) m.set(s.data, []); m.get(s.data).push(s); } return m; }, [piano]);
  const oggi = oggiIso();
  if (!piano) return null;
  const chius = (d) => (piano.chiusure || []).find((c) => d >= c.data_inizio && d <= c.data_fine);
  const cella = (pid, d) => {
    let best = null;
    for (const a of piano.assenze) { if (a.person_id !== pid) continue; const q = quotaInData(a, d); if (!q) continue; if (!best || q > best.q || (best.a.stato === 'RICHIESTA' && a.stato !== 'RICHIESTA')) best = { q, a }; }
    return best;
  };
  if (vista === 'anno') {
    // una colonna per mese, barre per settimane: conteggio dei giorni di assenza della persona nel mese
    return (
      <div className="fe-grid-wrap"><table className="fe-grid anno">
        <thead><tr><th className="nome">Persona</th>{MESI.map((m, i) => <th key={m} title={m}>{m.slice(0, 3)}</th>)}<th>Totale</th></tr></thead>
        <tbody>{piano.persone.map((p) => {
          let tot = 0;
          const celle = MESI.map((_, i) => {
            const mm = String(i + 1).padStart(2, '0');
            const giorni = giorniTra(`${anno}-${mm}-01`, `${anno}-${mm}-${String(new Date(Date.UTC(anno, i + 1, 0)).getUTCDate()).padStart(2, '0')}`);
            let n = 0, att = 0;
            for (const d of giorni) { if (!(p.settimana || [1, 2, 3, 4, 5]).includes(weekday(d)) || fest.has(d)) continue; const c = cella(p.id, d); if (c && c.a.tipo !== 'ROL') { if (c.a.stato === 'RICHIESTA') att += c.q; else n += c.q; } }
            tot += n;
            return <td key={mm} className={`m ${n ? 'on' : ''} ${att ? 'att' : ''}`} title={`${MESI[i]}: ${n} giorni${att ? `, ${att} in attesa` : ''}`}>{n ? num(n) : att ? <span className="att">{num(att)}</span> : ''}</td>;
          });
          return <tr key={p.id}><td className="nome"><div className="strong">{p.nome}</div>{p.ruolo && <div className="small muted">{p.ruolo}</div>}</td>{celle}<td className="tot">{num(tot)}</td></tr>;
        })}</tbody>
      </table></div>
    );
  }
  const mm = String(mese).padStart(2, '0');
  const giorni = giorniTra(`${anno}-${mm}-01`, `${anno}-${mm}-${String(new Date(Date.UTC(anno, mese, 0)).getUTCDate()).padStart(2, '0')}`);
  return (
    <div className="fe-grid-wrap"><table className="fe-grid">
      <thead>
        <tr><th className="nome" rowSpan={2}>Persona</th>{giorni.map((d) => { const s = scop.get(d); return <th key={d} className={`${s ? 'scop' : ''} ${fest.has(d) || weekday(d) >= 6 ? 'we' : ''} ${d === oggi ? 'oggi' : ''}`} title={[fest.get(d), s ? `Sotto la copertura minima: ${s.map((x) => `${x.ruolo} ${x.presenti}/${x.minimo}`).join(', ')}` : '', chius(d) ? `Chiusura: ${chius(d).descrizione}` : ''].filter(Boolean).join(' · ') || undefined} onClick={() => onGiorno?.(d)}>{d.slice(8, 10)}</th>; })}</tr>
        <tr>{giorni.map((d) => <th key={d} className={`gg ${fest.has(d) || weekday(d) >= 6 ? 'we' : ''} ${scop.has(d) ? 'scop' : ''}`}>{GG[weekday(d)]}</th>)}</tr>
      </thead>
      <tbody>{piano.persone.map((p) => (
        <tr key={p.id}>
          <td className="nome"><div className="strong">{p.nome}</div>{p.ruolo && <div className="small muted">{p.ruolo}</div>}</td>
          {giorni.map((d) => {
            const lavora = (p.settimana || [1, 2, 3, 4, 5]).includes(weekday(d)) && !fest.has(d);
            const c = cella(p.id, d);
            const cls = c ? (c.a.tipo === 'ROL' ? 'rol' : c.a.stato === 'RICHIESTA' ? 'att' : c.q < 1 ? 'half' : 'fer') : !lavora ? (fest.has(d) ? 'fest' : 'we') : chius(d) ? 'chius' : '';
            const t = c ? `${p.nome}: ${c.a.tipo === 'ROL' ? 'permesso ROL' : c.q < 1 ? 'mezza giornata' : 'ferie'} (${STATO[c.a.stato]?.label?.toLowerCase()}) ${periodo(c.a)}` : fest.get(d) || (chius(d) ? `Chiusura collettiva: ${chius(d).descrizione}` : undefined);
            return <td key={d} className={`c ${cls} ${d === oggi ? 'oggi' : ''} ${c && c.a.giorni !== undefined ? 'click' : ''}`} title={t} onClick={c && c.a.giorni !== undefined ? () => nav(`${base}/richieste/${c.a.id}`) : undefined}>{c ? (c.a.tipo === 'ROL' ? 'P' : c.a.stato === 'RICHIESTA' ? 'A' : c.q < 1 ? '½' : '') : ''}</td>;
          })}
        </tr>))}</tbody>
    </table></div>
  );
}

export function Legenda() {
  return (
    <div className="fe-legenda small">
      <span><i className="fer" />Ferie approvate</span><span><i className="half" />Mezza giornata</span><span><i className="att" />In attesa</span><span><i className="rol" />Permesso ROL</span>
      <span><i className="we" />Festivo o riposo</span><span><i className="chius" />Chiusura collettiva</span><span><i className="scop" />Giorno sotto la copertura minima</span>
    </div>
  );
}

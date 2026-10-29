// "Le tue royalties" (accessi esterni, 29/10/2026): pagina per il profilo PARTNER (struttura ospitante) con la tabella mesi × sedi
// ospitate dei soli report mensili confermati dall'amministratore, in linguaggio piano (base di calcolo, quota fissa, percentuale,
// IVA, totale) e il PDF del report. Gli amministratori la vedono per tutte le sedi ospitate del loro perimetro.
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useApi, Kpi, Card, Field, Loading, ErrorBox, Empty, Badge, Icon } from '../components/ui.jsx';
import { eur, itDate } from '../format.js';
import { qs, API_BASE } from '../api.js';

const MONTHS_OPTS = [6, 12, 24, 36];

export default function PartnerRoyalties() {
  const { user } = useAuth();
  const [sp] = useSearchParams();
  const [months, setMonths] = useState(12);
  const { data: d, error } = useApi(`/canoni/partner${qs({ months })}`);
  const focus = sp.get('period');   // dalla notifica "report confermato": il mese viene evidenziato
  const [open, setOpen] = useState(null);   // cella aperta: dettaglio del calcolo
  const partner = user.role === 'PARTNER';
  const cell = (siteId, p) => d?.cells?.[`${siteId}:${p}`] || null;
  const lastConfirmed = d ? Object.values(d.cells).sort((a, b) => String(b.confirmed_at).localeCompare(String(a.confirmed_at)))[0] : null;
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Le tue royalties</h1><div className="sub">{partner ? 'Canone mensile riconosciuto alla tua struttura per i punti prelievo Toscana Diagnostica che ospita: compaiono i soli mesi confermati dall\'amministratore, su cui emettere fattura' : 'Royalties mensili confermate delle sedi ospitate, come le vede il partner'}</div></div>
      </div>
      <div className="filters">
        <Field label="Periodo"><select value={months} onChange={(e) => setMonths(Number(e.target.value))}>{MONTHS_OPTS.map((m) => <option key={m} value={m}>ultimi {m} mesi</option>)}</select></Field>
      </div>
      <ErrorBox error={error} />
      {!d ? <Loading /> : <>
        <div className="grid g4">
          <Kpi accent label={`Totale confermato · ultimi ${d.months} mesi`} value={eur(d.grand.total)} foot={`${d.grand.n} report confermat${d.grand.n === 1 ? 'o' : 'i'} · ${d.sites.length} sed${d.sites.length === 1 ? 'e ospitata' : 'i ospitate'}`} />
          <Kpi label="Imponibile" value={eur(d.grand.taxable)} />
          <Kpi label="IVA" value={eur(d.grand.vat)} />
          <Kpi label="Ultimo report confermato" value={lastConfirmed ? itDate(lastConfirmed.confirmed_at) : '–'} foot={lastConfirmed ? `${eur(lastConfirmed.total)} · ${d.labels[Object.keys(d.cells).find((k) => d.cells[k] === lastConfirmed).split(':')[1]]}` : 'nessun mese confermato'} />
        </div>
        {!d.sites.length ? <div className="card" style={{ marginTop: 16 }}><Empty>Nessun punto prelievi ospitato nel tuo perimetro. Se la tua struttura ospita un corner Toscana Diagnostica, chiedi all'amministrazione di riallineare i perimetri dalla scheda della tua Legal entity.</Empty></div> : (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Mese</th>{d.sites.map((s) => <th key={s.id} className="num"><div>{s.name}</div><div className="small muted" style={{ fontWeight: 400 }}>{[s.royalty_fixed_monthly > 0 ? `${eur(s.royalty_fixed_monthly)}/mese` : null, s.royalty_pct > 0 ? `${s.royalty_pct}% su ${(s.base_label || '').toLowerCase()}` : null].filter(Boolean).join(' + ') || 'condizioni non impostate'}</div></th>)}<th className="num">Totale mese</th></tr></thead>
              <tbody>{d.periods.map((p) => (
                <tr key={p} style={focus === p ? { background: 'var(--silk, #eaf5f7)' } : undefined}>
                  <td><b>{d.labels[p]}</b>{focus === p && <div className="small muted">dalla notifica</div>}</td>
                  {d.sites.map((s) => { const c = cell(s.id, p); return (
                    <td key={s.id} className="num">
                      {c ? <button type="button" className="btn sm ghost" style={{ fontWeight: 600 }} onClick={() => setOpen(open?.key === `${s.id}:${p}` ? null : { key: `${s.id}:${p}`, site: s, period: p, c })} title="Dettaglio del calcolo">{eur(c.total)}</button>
                        : <span className="muted small">in attesa</span>}
                    </td>
                  ); })}
                  <td className="num strong">{d.totals[p]?.n ? eur(d.totals[p].total) : <span className="muted">–</span>}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr><td>Totale periodo</td>{d.sites.map((s) => <td key={s.id} className="num">{eur(d.periods.reduce((a, p) => a + (cell(s.id, p)?.total || 0), 0))}</td>)}<td className="num strong">{eur(d.grand.total)}</td></tr></tfoot>
            </table></div>
          </div>
        )}
        {open && (
          <div style={{ marginTop: 16 }}><Card title={`${open.site.name} · ${d.labels[open.period]}`} actions={<a className="btn sm" href={`${API_BASE}/canoni/sites/${open.site.id}/pdf?period=${open.period}`} target="_blank" rel="noopener"><Icon name="print" size={14} />Scarica il report PDF</a>}>
            <div className="grid g4">
              <Kpi label="Base di calcolo" value={eur(open.c.base)} foot={open.c.base_kind ? `${open.site.base_label || open.c.base_kind}` : ''} />
              <Kpi label={`Quota variabile${open.c.pct != null ? ` ${open.c.pct}%` : ''}`} value={eur(open.c.variable)} />
              <Kpi label="Quota fissa mensile" value={eur(open.c.fixed)} />
              <Kpi accent label={`Totale con IVA ${open.c.vat_rate ?? ''}%`} value={eur(open.c.total)} foot={`imponibile ${eur(open.c.taxable)} + IVA ${eur(open.c.vat)}`} />
            </div>
            <div className="small muted" style={{ marginTop: 10 }}><Badge tone="green">Confermato</Badge> il {itDate(open.c.confirmed_at)} su {open.c.reports} rendiconti giornalieri. Stato del pagamento: segue il flusso contabile ordinario (fattura della struttura ospitante), non tracciato qui.</div>
          </Card></div>
        )}
        <div style={{ marginTop: 16 }}><Card title="Come leggere la tabella">
          <p className="small" style={{ margin: 0 }}>Ogni cella è il canone del mese per il punto prelievi ospitato: quota fissa più la percentuale sulla base di calcolo (incassi della sede), più IVA. Il valore compare solo quando l'amministratore di Toscana Diagnostica conferma il report del mese, a inizio del mese successivo: da quel momento riceverai una notifica e potrai scaricare il PDF per emettere la fattura. "In attesa" significa che il mese non è ancora stato confermato.</p>
        </Card></div>
      </>}
    </div>
  );
}

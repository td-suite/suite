// Business Hub · v0.68.5 (CEO 10/11/2026): il cliente Service/MdL e il suo corrispondente nel gestionale StudioLab.
//  - ClientiGestionale: sotto il codice StudioLAB della scheda account, le sedi SERVICE con il loro codice (fonte unica: public.sites) e i
//    client Synclab abbinati alla Legal entity (codice, ragione sociale nel gestionale, attivo, sede); "Abbina al cliente del gestionale"
//    propone i client con le regole dell'allineamento automatico (codice StudioLAB, codice della Legal entity o della sede, partita IVA,
//    nome e comune; ambigui compresi) e la sede giusta; scegliendo, il codice si scrive nella sede se manca (lib/synclab/abbinamenti.js).
//  - ListinoGestionale: "Listino del gestionale (Synclab)" nella scheda Listino e offerta: listini base ed extra dei client abbinati,
//    stato, righe, anteprima, confronto con il listino del Business Hub e "Scarica XLSX".
import React, { useState } from 'react';
import { api, API_BASE } from '../api.js';
import { useApi, Card, Badge, Modal, Loading, ErrorBox, Empty, Icon, useToast } from './ui.jsx';
import { eur, num, itDateTime } from '../format.js';

export function ClientiGestionale({ a, edit, onDone }) {
  const [apri, setApri] = useState(false);
  const clienti = a.synclab_clients || [];
  const sedi = a.sedi_service_elenco || [];
  return (
    <div className="small" data-testid="clienti-gestionale" style={{ marginTop: 6 }}>
      {sedi.length > 1 && <div className="muted" style={{ marginBottom: 4 }}>Sedi SERVICE: {sedi.map((s, i) => <span key={s.id}>{i ? ' · ' : ''}{s.name}{s.city ? ` (${s.city})` : ''} <span className="mono strong">{s.studiolab_code || 'senza codice'}</span></span>)}</div>}
      {clienti.length ? <div>Nel gestionale: {clienti.map((c, i) => <span key={c.client_id}>{i ? ' · ' : ''}<span className="mono strong">{c.client_code || c.client_id}</span> {c.legal_name || ''} {c.active === false ? <Badge tone="grey">non attivo</Badge> : <Badge tone="green">attivo</Badge>}{c.stato === 'PROPOSTO' ? <> <Badge tone="amber">proposto</Badge></> : null}{c.site_id && sedi.length > 1 ? <span className="muted"> · {sedi.find((s) => s.id === c.site_id)?.name || ''}</span> : null}</span>)}</div>
        : <div className="muted">Nessun client del gestionale abbinato a questa Legal entity.</div>}
      {edit && <button className="btn sm ghost" style={{ marginTop: 6 }} data-testid="abbina-gestionale" onClick={() => setApri(true)}><Icon name="link" />Abbina al cliente del gestionale</button>}
      {apri && <AbbinaModal a={a} onClose={() => setApri(false)} onDone={() => { setApri(false); onDone?.(); }} />}
    </div>
  );
}

function AbbinaModal({ a, onClose, onDone }) {
  const toast = useToast();
  const [cerca, setCerca] = useState('');
  const [scelta, setScelta] = useState(null);   // { client_id, site_id }
  const q = useApi(`/hub/accounts/${a.id}/abbina-synclab?q=${encodeURIComponent(cerca)}`, [cerca]);
  const d = q.data;
  const conferma = async () => {
    try {
      const r = await api.post(`/hub/accounts/${a.id}/abbina-synclab`, { client_id: scelta.client_id, site_id: scelta.site_id ? Number(scelta.site_id) : null });
      toast(r.codice?.scritto ? `Abbinato: codice StudioLAB ${r.codice.codice} scritto nella sede` : r.codice?.motivo ? `Abbinato (${r.codice.motivo})` : 'Abbinato al cliente del gestionale');
      onDone();
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Modal wide title={`Abbina al cliente del gestionale · ${a.org_name}`} onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={!scelta} data-testid="abbina-conferma" onClick={conferma}>Abbina</button></>}>
      <div className="small muted" style={{ marginBottom: 8 }}>Proposti con le regole dell'allineamento automatico (codice StudioLAB della sede, codice della Legal entity o della sede, partita IVA, ragione sociale e comune), compresi i casi ambigui. La sede proposta viene da indirizzo, comune o nome della sede del client nel gestionale; il codice StudioLAB si scrive nella sede solo se non ne ha già uno.</div>
      <label className="f" style={{ display: 'block', marginBottom: 8 }}>Cerca nel gestionale<input value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="codice, ragione sociale, partita IVA, comune" /></label>
      <ErrorBox error={q.error} />
      {!d ? <Loading /> : !d.candidati.length ? <Empty>Nessun client del gestionale proposto: cerca per codice o ragione sociale</Empty> : (
        <div className="table-wrap" style={{ maxHeight: 360 }}><table className="t">
          <thead><tr><th /><th>Client nel gestionale</th><th>Perché</th><th>Sede</th></tr></thead>
          <tbody>{d.candidati.map((c) => {
            const on = scelta?.client_id === c.client_id;
            return (
              <tr key={c.client_id} className={on ? 'sel' : ''}>
                <td><input type="radio" name="client" checked={on} onChange={() => setScelta({ client_id: c.client_id, site_id: c.sede_proposta?.site_id || (c.sedi.length === 1 ? c.sedi[0].site_id : '') })} /></td>
                <td><span className="mono strong">{c.client_code}</span> {c.legal_name}{c.active === false && <> <Badge tone="grey">non attivo</Badge></>}<div className="small muted">{[c.city, c.site_description, c.site_city].filter(Boolean).join(' · ')}</div>
                  {c.gia_qui ? <Badge tone="green">già abbinato qui</Badge> : c.abbinato_a ? <Badge tone="amber">abbinato a un'altra Legal entity</Badge> : null}</td>
                <td className="small">{c.regola ? <Badge tone="blue">{c.regola.toLowerCase().replace('_', ' ')}</Badge> : <span className="muted">ricerca</span>}{c.motivo && <div className="amber">{c.motivo}</div>}</td>
                <td className="small">{on ? <select value={scelta.site_id || ''} onChange={(e) => setScelta({ ...scelta, site_id: e.target.value })}><option value="">Senza sede</option>{c.sedi.map((s) => <option key={s.site_id} value={s.site_id}>{s.name}{s.city ? ` (${s.city})` : ''}{s.studiolab_code ? ` · ${s.studiolab_code}` : ''}</option>)}</select>
                  : c.sede_proposta ? <>{c.sede_proposta.name} <span className="muted">({c.sede_proposta.regola?.toLowerCase().replace('_', ' ')})</span></> : <span className="muted">{c.sedi.length ? 'da scegliere' : 'nessuna sede SERVICE'}</span>}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
    </Modal>
  );
}

// decimali esatti come nel gestionale, con la virgola (nessun arrotondamento)
const dec = (v) => (v == null || v === '' ? '–' : String(v).replace('.', ','));
const IVA_ND = { not_available: 'n.d.', zero_rate_or_exempt: 'esente o 0%', taxable: 'imponibile' };
const ESITO = { DIVERSO: ['amber', 'prezzo diverso'], SOLO_SYNCLAB: ['grey', 'solo nel gestionale'], SENZA_PREZZO: ['grey', 'senza prezzo'], UGUALE: ['green', 'uguale'], SOLO_HUB: ['grey', 'solo nel Business Hub'] };
export function ListinoGestionale({ a }) {
  const q = useApi(`/hub/accounts/${a.id}/listino-synclab`);
  const [tutte, setTutte] = useState(null);
  const d = q.data;
  if (!d) return q.error ? <ErrorBox error={q.error} /> : null;
  return (
    <Card title="Listino del gestionale (Synclab)" className="mb2" actions={d.applicabile ? <a className="btn sm" data-testid="listino-synclab-xlsx" href={`${API_BASE}/hub/accounts/${a.id}/listino-synclab.xlsx`}><Icon name="download" />Scarica XLSX</a> : null}>
      <div data-testid="listino-gestionale">
        {!d.applicabile ? <div className="small muted">{d.motivo}. Abbina la Legal entity al cliente del gestionale (riquadro del codice StudioLAB in alto).</div> : <>
          {d.clients.map((c) => (
            <div key={c.client_id} style={{ marginBottom: 12 }}>
              <div className="small"><span className="mono strong">{c.client_code}</span> {c.legal_name}{c.site_name ? <span className="muted"> · sede {c.site_name}</span> : null}{c.orfani?.length ? <> · <Badge tone="red">{c.orfani.length} listino non nella copia</Badge></> : null}</div>
              {!c.listini.length ? <div className="small muted">Nessun listino associato nel gestionale.</div> : c.listini.map((l) => (
                <div key={l.id} style={{ marginTop: 6 }}>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                    <b>{l.code || l.id}</b><span>{l.description}</span><Badge tone={l.ruolo === 'BASE' ? 'teal' : 'mauve'}>{l.ruolo === 'BASE' ? 'listino base' : 'listino extra'}</Badge>
                    <Badge tone={l.state === 10 ? 'green' : l.state === 50 ? 'red' : 'amber'}>{l.stato}</Badge>{l.tipo && <span className="small muted">{l.tipo}</span>}<span className="small muted">{num(l.righe)} righe</span>
                    {d.hub ? <span className="small">confronto con il listino v{d.hub.versione} del Business Hub: <b className={l.confronto.diverse ? 'amber' : 'green'}>{num(l.confronto.diverse)} prezzi diversi</b>, {num(l.confronto.uguali)} uguali, {num(l.confronto.solo_synclab)} solo nel gestionale, {num(l.confronto.solo_hub)} solo nel Business Hub</span> : <span className="small muted">nessun listino del Business Hub da confrontare</span>}
                  </div>
                  <div className="table-wrap" style={{ maxHeight: 280, marginTop: 6 }}><table className="t small" data-testid="listino-gestionale-righe">
                    <thead><tr><th>Codice</th><th>Descrizione</th><th className="num">Lordo</th><th className="num">Sconto %</th><th className="num">Netto</th><th className="num">IVA</th></tr></thead>
                    <tbody>{l.anteprima.map((r) => <tr key={`${r.ord}-${r.exam_code}`}><td className="mono">{r.exam_code}</td><td>{r.description}</td><td className="num">{dec(r.lordo)}</td><td className="num">{dec(r.sconto)}</td><td className="num strong">{dec(r.netto)}</td><td className="num">{r.iva != null ? `${dec(r.iva)}%` : (IVA_ND[r.vat_treatment] || r.vat_treatment || '–')}</td></tr>)}</tbody>
                  </table></div>
                  {l.righe > l.anteprima.length && <div className="small muted">Anteprima delle prime {l.anteprima.length} righe su {num(l.righe)}: il file XLSX le contiene tutte.</div>}
                  {l.confronto.righe.length > 0 && <button className="btn sm ghost" style={{ marginTop: 4 }} onClick={() => setTutte(tutte === `${c.client_id}|${l.id}` ? null : `${c.client_id}|${l.id}`)}>{tutte === `${c.client_id}|${l.id}` ? 'Nascondi le differenze' : `Mostra le differenze di prezzo (${l.confronto.righe.length}${l.confronto.diverse > l.confronto.righe.length ? ` di ${l.confronto.diverse}` : ''})`}</button>}
                  {tutte === `${c.client_id}|${l.id}` && <div className="table-wrap" style={{ maxHeight: 280, marginTop: 6 }}><table className="t small" data-testid="listino-gestionale-diff">
                    <thead><tr><th>Codice</th><th>Descrizione</th><th className="num">Netto gestionale</th><th className="num">Business Hub</th><th className="num">Differenza</th><th>Esito</th></tr></thead>
                    <tbody>{l.confronto.righe.map((r) => <tr key={r.codice}><td className="mono">{r.codice}</td><td>{r.descrizione}</td><td className="num">{eur(r.synclab)}</td><td className="num">{eur(r.hub)}</td><td className="num strong">{r.differenza == null ? '–' : `${r.differenza > 0 ? '+' : ''}${eur(r.differenza)}`}{r.differenza_pct != null ? ` (${r.differenza_pct > 0 ? '+' : ''}${String(r.differenza_pct).replace('.', ',')}%)` : ''}</td><td><Badge tone={ESITO[r.esito][0]}>{ESITO[r.esito][1]}</Badge></td></tr>)}</tbody>
                  </table></div>}
                </div>
              ))}
            </div>
          ))}
          <div className="small muted">{d.nota}. Confronto con il listino corrente del Business Hub: prezzo offerto, altrimenti di listino.{d.checkpoint_listini ? ` Copia dei listini al ${itDateTime(d.checkpoint_listini)}.` : ''}</div>
        </>}
      </div>
    </Card>
  );
}

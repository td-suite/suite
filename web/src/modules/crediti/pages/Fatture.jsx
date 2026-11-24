// Fatture e partitario: elenco per stato, fatture da Synclab a richiesta, importazione del partitario della contabilità (anteprima e conferma),
// abbinamento alla Legal entity delle fatture del file il cui cliente non è stato riconosciuto.
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, Loading, Empty, PageHead, Badge, Tabs, SearchInput, DropZone, Modal, ErrorBox, Switch } from '../../../components/ui.jsx';
import { useApi } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Modalita, LinkCliente, useAzione, api } from '../components.jsx';
import { eur, itData, itDataOra, FASE, STATO_FATTURA, ORIGINE_SCADENZA } from '../format.js';

function Importa({ onClose, onFatto }) {
  const [file, setFile] = useState(null); const [completo, setCompleto] = useState(false); const [ant, setAnt] = useState(null); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false); const [fatto, setFatto] = useState(null);
  const invia = async (conferma, f = file, c = completo) => { setBusy(true); setErr(null); try { const fd = new FormData(); fd.append('file', f); fd.append('completo', String(c)); if (conferma) fd.append('conferma', 'true'); const r = await api.upload('/fatture-importa', fd); if (conferma) { setFatto(r); await onFatto(); } else setAnt(r); } catch (e) { setErr(e); setAnt(null); } finally { setBusy(false); } };
  return (
    <Modal wide title="Importa il partitario della contabilità" onClose={onClose} footer={fatto ? <button className="btn" onClick={onClose}>Chiudi</button> : <><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy || !ant} onClick={() => invia(true)}>Conferma l'importazione</button></>}>
      <ErrorBox error={err} />
      {fatto ? <div className="alert ok"><span>Importazione completata: {fatto.nuove} fatture nuove, {fatto.aggiornate} aggiornate, {fatto.incassi} incassi registrati, {fatto.chiuse} chiuse per assenza.</span></div> : <>
        <p className="small">File XLSX o CSV con una riga per documento. Colonne riconosciute: <strong>Numero</strong>, <strong>Importo</strong> o <strong>Residuo</strong> (obbligatorie), Data, Scadenza, Cliente, Partita IVA. La scadenza del file vince su quella calcolata dai termini di pagamento.</p>
        <DropZone accept=".xlsx,.csv" multiple={false} compact onFiles={(fs) => { setFile(fs[0]); invia(false, fs[0]); }}>{file ? <div className="small"><strong>{file.name}</strong> · clicca per cambiare file</div> : undefined}</DropZone>
        <label className="row" style={{ gap: 10, margin: '12px 0' }}><Switch checked={completo} onChange={(v) => { setCompleto(v); if (file) invia(false, file, v); }} label="File completo" /><span className="small"><strong>Il file contiene tutte le partite aperte.</strong> Solo con questa spunta le fatture aperte nella Suite che nel file non ci sono vengono chiuse come incassate secondo il partitario.</span></label>
        {busy && <Loading text="Lettura del file" />}
        {ant && !busy && <div>
          <div className="alert info"><span>Anteprima, nulla è stato scritto: {ant.righe} righe lette · {ant.nuove} fatture nuove · {ant.aggiornate} da aggiornare · {ant.incassi} incassi da registrare · {ant.invariate} invariate · {ant.chiuse} da chiudere per assenza · {ant.non_abbinate} righe con cliente non riconosciuto.</span></div>
          {ant.scartate.length > 0 && <p className="small cr-rosso">Righe scartate: {ant.scartate.slice(0, 8).map((s) => `riga ${s.riga} (${s.motivo})`).join('; ')}{ant.scartate.length > 8 ? ` e altre ${ant.scartate.length - 8}` : ''}</p>}
          {ant.anomalie.length > 0 && <div className="small"><strong>Da verificare, non modificate:</strong><ul>{ant.anomalie.slice(0, 10).map((a, i) => <li key={i}>n. {a.numero}: {a.testo}</li>)}</ul></div>}
          {ant.da_chiudere.length > 0 && <div className="small"><strong className="cr-rosso">Verranno chiuse per assenza dal file:</strong> {ant.da_chiudere.slice(0, 30).map((f) => `n. ${f.numero} (${eur(f.residuo)})`).join(', ')}{ant.da_chiudere.length > 30 ? ` e altre ${ant.da_chiudere.length - 30}` : ''}</div>}
          {ant.clienti_non_abbinati.length > 0 && <div className="small"><strong>Clienti del file non riconosciuti</strong> (le loro fatture entrano senza cliente e restano fuori dai solleciti finché non le abbini): {ant.clienti_non_abbinati.slice(0, 15).map((c) => `${c.cliente || 'senza nome'}${c.piva ? ` (${c.piva})` : ''}`).join(', ')}</div>}
        </div>}
      </>}
    </Modal>
  );
}

function AbbinaCliente({ f, onClose, onFatto }) {
  const [q, setQ] = useState(f.cliente || ''); const o = useApi(q.trim().length >= 2 ? `/organizzazioni?cerca=${encodeURIComponent(q.trim())}` : null, [q]); const [err, setErr] = useState(null);
  const righe = o.data?.righe || [];
  return (
    <Modal title={`Abbina "${f.cliente || 'senza nome'}" a una Legal entity`} onClose={onClose}>
      <ErrorBox error={err} />
      <p className="small">Tutte le fatture del partitario con lo stesso cliente{f.cliente_piva ? ` (P.IVA ${f.cliente_piva})` : ''} vengono abbinate insieme.</p>
      <SearchInput value={q} onChange={setQ} placeholder="Cerca la Legal entity" autoFocus />
      <div className="list" style={{ marginTop: 8 }}>{righe.map((x) => <button key={x.id} className="it" style={{ textAlign: 'left' }} onClick={async () => { try { const r = await api.put(`/fatture/${f.id}`, { organization_id: x.id }); await onFatto(r); onClose(); } catch (e) { setErr(e); } }}><span className="strong">{x.name}</span><span className="small muted"> · {x.kind}{x.vat_number ? ` · ${x.vat_number}` : ''}</span></button>)}{q.trim().length >= 2 && o.data && !righe.length && <span className="small muted">Nessuna Legal entity trovata</span>}</div>
    </Modal>
  );
}

export default function Fatture() {
  const [sp, setSp] = useSearchParams(); const stato = sp.get('stato') || 'APERTE'; const [q, setQ] = useState('');
  const d = useApi(`/fatture?stato=${stato}&cerca=${encodeURIComponent(q)}`, [stato, q]); const { user } = useAuth(); const az = useAzione(d.reload); const [m, setM] = useState(null);
  const righe = d.data?.righe || [];
  return (
    <div className="page">
      <PageHead title="Fatture e partitario" icon="sheet" sub="Le fatture arrivano da Synclab (clienti abbinati a una Legal entity) e dal partitario della contabilità, che porta scadenze e incassi registrati fuori dal conto collegato."
        actions={user.opera && <><button className="btn ghost" disabled={az.busy} onClick={() => az.fai(() => api.post('/fatture-sincronizza', {}), (r) => `Synclab: ${r.letti} documenti letti, ${r.nuovi} nuovi, ${r.aggiornati} aggiornati${r.tipo_non_indicato ? `, ${r.tipo_non_indicato} con tipo non indicato lasciati fuori` : ''}`)}>Aggiorna da Synclab</button><button className="btn" onClick={() => setM({ t: 'importa' })}>Importa il partitario</button></>} />
      <Modalita />
      <Tabs value={stato} onChange={(v) => setSp({ stato: v })} items={[{ value: 'APERTE', label: 'Aperte' }, { value: 'SCADUTE', label: 'Scadute' }, { value: 'CONTESTATE', label: 'Contestate' }, { value: 'SENZA_CLIENTE', label: 'Senza cliente' }, { value: 'NOTE', label: 'Note di credito' }, { value: 'PAGATE', label: 'Incassate' }]} />
      <div className="filters cr-gap"><SearchInput value={q} onChange={setQ} placeholder="Cerca per numero o cliente" /></div>
      {d.error ? <Empty icon="alert" title="Errore">{d.error.message}</Empty> : !d.data ? <Loading /> : (
        <Card flush className="cr-gap">{righe.length ? <div className="table-wrap"><table className="t"><thead><tr><th>Numero</th><th>Cliente</th><th>Data</th><th>Scadenza</th><th className="num">Importo</th><th className="num">Residuo</th><th className="num">Giorni</th><th>Stato</th></tr></thead>
          <tbody>{righe.map((f) => (
            <tr key={f.id}>
              <td className="strong">{f.numero}<div className="small muted">{f.fonte === 'SYNCLAB' ? 'Synclab' : f.fonte === 'CONTABILITA' ? 'Partitario' : 'A mano'}</div></td>
              <td>{f.organization_id ? <LinkCliente id={f.organization_id}>{f.cliente}</LinkCliente> : <>{f.cliente || 'senza nome'} {user.opera && <button className="btn sm ghost" onClick={() => setM({ t: 'cliente', f })}>Abbina</button>}</>}</td>
              <td>{itData(f.data)}</td><td>{itData(f.scadenza)}<div className={`small ${f.scadenza_origine === 'PREDEFINITA' ? 'cr-rosso' : 'muted'}`}>{ORIGINE_SCADENZA[f.scadenza_origine]}</div></td>
              <td className="num">{eur(f.importo)}</td><td className="num strong">{['APERTA', 'PARZIALE'].includes(f.stato) ? eur(f.residuo) : ''}</td><td className="num">{['APERTA', 'PARZIALE'].includes(f.stato) && f.giorni > 0 ? f.giorni : ''}</td>
              <td><Badge tone={STATO_FATTURA[f.stato]?.tone}>{STATO_FATTURA[f.stato]?.label}</Badge>{f.contestata && <div><Badge tone="mauve">Contestata</Badge></div>}{f.fase > 0 && ['APERTA', 'PARZIALE'].includes(f.stato) && <div className="small muted">{FASE[f.fase]}</div>}{f.nota && <div className="small muted">{f.nota}</div>}</td>
            </tr>))}</tbody></table></div> : <Empty compact icon="check">Nessuna fattura in questo elenco</Empty>}</Card>)}
      {(d.data?.importazioni || []).length > 0 && <Card title="Ultime importazioni del partitario" icon="clock" flush><table className="t"><tbody>{d.data.importazioni.map((i) => <tr key={i.id}><td>{i.filename}<div className="small muted">{itDataOra(i.at)} · {i.utente}</div></td><td className="small">{i.righe} righe · {i.nuove} nuove · {i.aggiornate} aggiornate · {i.chiuse} chiuse · {i.non_abbinate} senza cliente{i.completo ? ' · file completo' : ''}</td></tr>)}</tbody></table></Card>}
      {m?.t === 'importa' && <Importa onClose={() => setM(null)} onFatto={d.reload} />}
      {m?.t === 'cliente' && <AbbinaCliente f={m.f} onClose={() => setM(null)} onFatto={d.reload} />}
    </div>
  );
}

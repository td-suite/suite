// Scheda del cliente: posizione, fatture, comunicazioni, risposte, promesse, chiamate, registro dei contatti. Da qui CEO e CFO
// escludono o riammettono il cliente ai solleciti; l'Amministrazione tiene destinatari, termini, sospensioni, incassi e contestazioni.
import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, Kpi, Loading, Empty, PageHead, Badge, Field, Modal } from '../../../components/ui.jsx';
import { useApi, base } from '../api.js';
import { Modalita, StatoCliente, useAzione, api, Modulo } from '../components.jsx';
import { eur, itData, itDataOra, oggiIso, FASE, STATO_COM, STATO_FATTURA, statoFattura, CLASSE, ESITO, ORIGINE_SCADENZA, STATO_PRATICA } from '../format.js';
import { Testo } from './Comunicazioni.jsx';
import { EsitoChiamata } from './Chiamate.jsx';

export default function Cliente() {
  const { id } = useParams(); const d = useApi(`/clienti/${id}`, [id]); const az = useAzione(d.reload);
  const [m, setM] = useState(null); const utenti = useApi(d.data?.puoi?.operare ? '/utenti' : null, [d.data?.puoi?.operare]);
  const [s, setS] = useState(null);
  useEffect(() => { if (d.data) { const c = d.data.cliente; setS({ email_solleciti: c.email_solleciti || '', pec: c.pec_crediti || '', termini: c.termini || '', referente_user_id: c.referente_user_id || '', note: c.note || '', sospeso_fino: c.sospeso_fino || '', sospeso_motivo: c.sospeso_motivo || '' }); } }, [d.data]);
  if (d.error) return <div className="page"><Empty icon="alert" title="Scheda non disponibile">{d.error.message}</Empty></div>;
  if (!d.data || !s) return <div className="page"><Loading /></div>;
  const x = d.data, c = x.cliente, p = x.posizione, puoi = x.puoi;
  const aperte = x.fatture.filter((f) => ['APERTA', 'PARZIALE'].includes(f.stato)); const note = x.fatture.filter((f) => f.stato === 'NOTA_CREDITO' && -f.importo - f.incassato > 0.005);
  const post = (url, body, ok) => az.fai(() => api.post(url, body), ok);
  return (
    <div className="page">
      <PageHead crumb={<Link to={`${base}/clienti`}>Clienti e scaduto</Link>} title={c.name} icon="building"
        sub={<>{p ? <StatoCliente stato={p.stato} /> : <Badge tone="green">Nessuna partita aperta</Badge>} {c.vat_number ? ` P.IVA ${c.vat_number}` : ''}{c.city ? ` · ${c.city}` : ''}{x.account ? <> · <Link to={`/business/account/${x.account.id}`}>Scheda nel Business Hub</Link></> : ' · non presente nel Business Hub'}</>}
        actions={<>
          {puoi.dirigere && (c.escluso ? <button className="btn" disabled={az.busy} onClick={() => setM('riammetti')}>Riammetti ai solleciti</button> : <button className="btn danger" onClick={() => setM('escludi')}>Escludi dai solleciti</button>)}
          {puoi.operare && <button className="btn ghost" onClick={() => setM('promessa')}>Promessa di pagamento</button>}
          {puoi.chiamare && <button className="btn ghost" onClick={() => setM('chiamata')}>Registra una chiamata</button>}
        </>} />
      <Modalita />
      {c.escluso && <div className="alert warn cr-gap"><span><strong>Escluso dai solleciti</strong> {c.esclusione_fino ? `fino al ${itData(c.esclusione_fino)}` : 'fino a revoca'}{c.esclusa_da_nome ? ` da ${c.esclusa_da_nome}` : ''}: {c.esclusione_motivo}. Nessuna comunicazione parte verso questo cliente; fatture e incassi continuano ad aggiornarsi.</span></div>}
      {c.sospeso_fino >= oggiIso() && <div className="alert info cr-gap"><span>Scala sospesa fino al {itData(c.sospeso_fino)}: {c.sospeso_motivo}</span></div>}
      {p && <div className="grid g4 cr-gap">
        <Kpi label="Aperto" value={eur(p.totale)} foot={`${p.fatture} ${p.fatture === 1 ? 'fattura' : 'fatture'}`} />
        <Kpi label="Scaduto" value={eur(p.scaduto)} accent foot={p.giorni_max ? `fino a ${p.giorni_max} giorni di ritardo` : 'nessun ritardo'} />
        <Kpi label="Ultima fase" value={p.fase_label || 'Nessuna'} foot={p.ultimo_contatto ? `ultimo contatto ${itData(String(p.ultimo_contatto))}` : 'nessuna comunicazione inviata'} />
        <Kpi label="Contestato" value={eur(p.contestato)} foot={p.note_credito > 0 ? `note di credito da applicare ${eur(p.note_credito)}` : 'nessuna nota di credito libera'} />
      </div>}

      <Card title={`Fatture aperte (${aperte.length})`} icon="sheet" flush className="cr-gap" actions={puoi.operare && <button className="btn sm ghost" onClick={() => setM('fattura')}>Aggiungi a mano</button>}>
        {aperte.length ? <div className="table-wrap"><table className="t"><thead><tr><th>Numero</th><th>Data</th><th>Scadenza</th><th className="num">Importo</th><th className="num">Residuo</th><th className="num">Giorni</th><th>Fase</th><th></th></tr></thead>
          <tbody>{aperte.map((f) => (
            <tr key={f.id}>
              <td className="strong">{f.numero}<div className="small muted">{f.fonte === 'SYNCLAB' ? 'Synclab' : f.fonte === 'CONTABILITA' ? 'Partitario' : 'A mano'}</div></td><td>{itData(f.data)}</td>
              <td>{itData(f.scadenza)}<div className={`small ${f.scadenza_origine === 'PREDEFINITA' ? 'cr-rosso' : 'muted'}`}>{ORIGINE_SCADENZA[f.scadenza_origine]}</div></td>
              <td className="num">{eur(f.importo)}</td><td className="num strong">{eur(f.residuo)}</td><td className="num">{f.giorni > 0 ? f.giorni : ''}</td>
              <td>{f.contestata ? <Badge tone="mauve" title={f.contestazione_nota}>Contestata</Badge> : FASE[f.fase]}{f.fase_at && !f.contestata && <div className="small muted">{itData(String(f.fase_at))}</div>}{f.nota && <div className="small muted">{f.nota}</div>}</td>
              <td>{puoi.operare && <div className="cr-azioni">
                <button className="btn sm ghost" onClick={() => setM({ t: 'incasso', f })}>Incasso</button>
                <button className="btn sm ghost" onClick={() => setM({ t: 'contestazione', f })}>{f.contestata ? 'Chiudi contestazione' : 'Contestata'}</button>
                <button className="btn sm ghost" onClick={() => setM({ t: 'scadenza', f })}>Scadenza</button>
                {note.map((n) => <button key={n.id} className="btn sm ghost" disabled={az.busy} onClick={() => post(`/note-credito/${n.id}/applica`, { fattura_id: f.id }, (r) => `Nota di credito applicata per ${eur(r.importo)}`)}>Applica NC {n.numero}</button>)}
              </div>}</td>
            </tr>))}</tbody></table></div> : <Empty compact icon="check">Nessuna fattura aperta</Empty>}
      </Card>

      <div className="grid g2 cr-gap">
        <Card title="A chi scriviamo" icon="mail">
          <dl className="cr-kv">
            <dt>Destinatari</dt><dd>{x.destinatari?.to?.length ? x.destinatari.to.join(', ') : <span className="cr-rosso">nessun indirizzo: i solleciti restano in attesa</span>}{x.destinatari?.origine && <div className="small muted">da: {x.destinatari.origine}</div>}</dd>
            <dt>PEC (2° sollecito)</dt><dd>{x.destinatari?.pec || <span className="muted">non indicata</span>}</dd>
            <dt>Referente commerciale</dt><dd>{x.destinatari?.referente?.nome || <span className="muted">non indicato</span>}</dd>
            <dt>Termini di pagamento</dt><dd>{c.termini || x.termini_hub || <span className="cr-rosso">non indicati: scadenze calcolate con {x.termini_predefiniti}</span>}{!c.termini && x.termini_hub && <div className="small muted">dal Business Hub</div>}</dd>
          </dl>
        </Card>
        {puoi.operare ? <Card title="Scheda crediti" icon="edit" actions={<button className="btn sm" disabled={az.busy} onClick={() => az.fai(() => api.put(`/clienti/${id}`, { ...s, referente_user_id: s.referente_user_id ? Number(s.referente_user_id) : null }), 'Scheda salvata')}>Salva</button>}>
          <div className="form-grid">
            <Field label="Destinatari dei solleciti" help="Uno o più indirizzi separati da virgola. Vuoto: contatti amministrativi del Business Hub."><input value={s.email_solleciti} onChange={(e) => setS({ ...s, email_solleciti: e.target.value })} /></Field>
            <Field label="PEC"><input value={s.pec} onChange={(e) => setS({ ...s, pec: e.target.value })} placeholder={c.pec || ''} /></Field>
            <Field label="Termini di pagamento" help="Esempio: 30 gg f.m. data fattura. Vuoto: quelli del Business Hub."><input value={s.termini} onChange={(e) => setS({ ...s, termini: e.target.value })} placeholder={x.termini_hub || ''} /></Field>
            <Field label="Referente commerciale" help="Vuoto: il titolare dell'account nel Business Hub."><select value={s.referente_user_id} onChange={(e) => setS({ ...s, referente_user_id: e.target.value })}><option value="">Dal Business Hub</option>{(utenti.data?.righe || []).map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}</select></Field>
            <Field label="Sospendi la scala fino al"><input type="date" value={s.sospeso_fino} onChange={(e) => setS({ ...s, sospeso_fino: e.target.value })} /></Field>
            <Field label="Motivo della sospensione"><input value={s.sospeso_motivo} onChange={(e) => setS({ ...s, sospeso_motivo: e.target.value })} /></Field>
            <Field label="Note" className="span2"><textarea value={s.note} onChange={(e) => setS({ ...s, note: e.target.value })} /></Field>
          </div>
        </Card> : <Card title="Note" icon="info"><p className="small">{c.note || 'Nessuna nota'}</p></Card>}
      </div>

      <div className="grid g2 cr-gap">
        <Card title={`Comunicazioni (${x.comunicazioni.length})`} icon="mail" flush>
          {x.comunicazioni.length ? <table className="t"><tbody>{x.comunicazioni.map((k) => <tr key={k.id}><td><button className="cr-link" onClick={() => setM({ t: 'testo', id: k.id })}>{FASE[k.fase]}</button><div className="small muted">{itDataOra(k.inviata_at || k.creata_at)} · {eur(k.totale)}</div>{k.motivo_attesa && k.stato !== 'INVIATA' && <div className="cr-motivo">{k.motivo_attesa}</div>}</td><td><Badge tone={STATO_COM[k.stato]?.tone}>{STATO_COM[k.stato]?.label}</Badge>{k.pec_stato === 'DA_INVIARE' && <div className="small cr-rosso">PEC da inviare</div>}{k.pec_stato === 'INVIATA' && <div className="small muted">PEC inviata</div>}</td></tr>)}</tbody></table> : <Empty compact icon="mail">Nessuna comunicazione</Empty>}
        </Card>
        <Card title="Risposte, promesse e chiamate" icon="comment" flush>
          {(x.risposte.length + x.promesse.length + x.chiamate.length + x.attivita.filter((a) => a.stato === 'APERTA').length) ? <table className="t"><tbody>
            {x.attivita.filter((a) => a.stato === 'APERTA').map((a) => <tr key={`a${a.id}`}><td><span className="strong">Chiamata da fare</span> entro il {itData(a.entro)}<div className="small muted">{a.assegnata_a || 'nessun referente'} · {eur(a.totale)}{a.simulata ? ' · nata in Prova' : ''}</div></td><td><Badge tone="amber">Aperta</Badge></td></tr>)}
            {x.promesse.map((q) => <tr key={`p${q.id}`}><td><span className="strong">{q.piano ? 'Piano di rientro' : 'Promessa'}</span> al {itData(q.data)}{q.importo ? ` · ${eur(q.importo)}` : ''}<div className="small muted">{q.origine === 'RISPOSTA' ? 'dalla risposta del cliente' : q.origine === 'CHIAMATA' ? 'dalla chiamata' : 'registrata a mano'}{q.nota ? ` · ${q.nota}` : ''}</div>{q.piano && (q.rate || []).length > 0 && <div className="small muted">{q.rate.map((r) => `${itData(r.data)} ${eur(r.importo)}`).join(' · ')}</div>}</td>
              <td><Badge tone={q.stato === 'MANTENUTA' ? 'green' : q.stato === 'NON_RISPETTATA' ? 'red' : q.stato === 'DA_APPROVARE' ? 'amber' : q.stato === 'APERTA' ? 'blue' : 'grey'}>{{ APERTA: 'In corso', DA_APPROVARE: 'Da approvare', MANTENUTA: 'Mantenuta', NON_RISPETTATA: 'Non rispettata', ANNULLATA: 'Annullata' }[q.stato]}</Badge>
                {q.stato === 'DA_APPROVARE' && puoi.dirigere && <div className="cr-azioni" style={{ marginTop: 6 }}><button className="btn sm" disabled={az.busy} onClick={() => post(`/promesse/${q.id}/approva`, { approva: true }, 'Piano approvato')}>Approva</button><button className="btn sm ghost" disabled={az.busy} onClick={() => post(`/promesse/${q.id}/approva`, { approva: false }, 'Piano non approvato')}>Respingi</button></div>}
                {['APERTA'].includes(q.stato) && puoi.operare && <div style={{ marginTop: 6 }}><button className="btn sm ghost" onClick={() => setM({ t: 'annullaPromessa', q })}>Annulla</button></div>}</td></tr>)}
            {x.chiamate.map((h) => <tr key={`c${h.id}`}><td><span className="strong">Chiamata</span> del {itData(h.data)}: {ESITO[h.esito]}<div className="small muted">{h.utente}{h.interlocutore ? ` con ${h.interlocutore}` : ''}{h.nota ? ` · ${h.nota}` : ''}</div></td><td></td></tr>)}
            {x.risposte.map((r) => <tr key={`r${r.id}`}><td><span className="strong">Risposta</span> del {itDataOra(r.ricevuta_at)}<div className="small muted">{r.da_email} · {r.sintesi}</div>{r.effetto && <div className="small">{r.effetto}</div>}</td><td><Badge tone={CLASSE[r.classe]?.tone}>{CLASSE[r.classe]?.label}</Badge>{r.stato === 'DA_GESTIRE' && <div className="small cr-rosso"><Link to={`${base}/risposte`}>da gestire</Link></div>}</td></tr>)}
          </tbody></table> : <Empty compact icon="comment">Nulla da mostrare</Empty>}
        </Card>
      </div>

      {x.pratiche.length > 0 && <Card title="Area legale" icon="shield" flush className="cr-gap"><table className="t"><tbody>{x.pratiche.map((q) => <tr key={q.id}><td>{q.motivo}<div className="small muted">{itDataOra(q.creata_at)} · {eur(q.totale)}{q.simulata ? ' · nata in Prova' : ''}{q.esito ? ` · ${q.esito}` : ''}</div></td><td><Badge tone={STATO_PRATICA[q.stato]?.tone}>{STATO_PRATICA[q.stato]?.label}</Badge></td></tr>)}</tbody></table></Card>}

      <div className="grid g2 cr-gap">
        <Card title="Registro dei contatti" icon="clock">
          {x.eventi.length ? <ul className="cr-eventi">{x.eventi.map((e) => <li key={e.id}><div className="q">{itDataOra(e.at)}{e.utente ? ` · ${e.utente}` : ' · automatico'}</div>{e.testo}</li>)}</ul> : <Empty compact icon="clock">Nessun contatto registrato</Empty>}
        </Card>
        <div>
          <Card title="Fatture chiuse e note di credito" icon="folder" flush className="cr-gap">
            {x.fatture.filter((f) => !['APERTA', 'PARZIALE'].includes(f.stato)).length ? <table className="t"><tbody>{x.fatture.filter((f) => !['APERTA', 'PARZIALE'].includes(f.stato)).slice(0, 40).map((f) => <tr key={f.id}><td className="strong">{f.numero}<div className="small muted">{itData(f.data)}</div></td><td className="num">{eur(f.importo)}</td><td><Badge tone={statoFattura(f).tone}>{statoFattura(f).label}</Badge>{f.chiusa_origine && <div className="small muted">{{ BANCA: 'dalla banca', MANUALE: 'a mano', PARTITARIO: 'dal partitario', NOTA_CREDITO: 'con nota di credito' }[f.chiusa_origine]}</div>}</td></tr>)}</tbody></table> : <Empty compact icon="folder">Nessuna</Empty>}
          </Card>
          {x.esclusioni.length > 0 && <Card title="Esclusioni dai solleciti" icon="lock"><ul className="cr-eventi">{x.esclusioni.map((e) => <li key={e.id}><div className="q">{itDataOra(e.at)} · {e.utente || 'automatico'}</div>{e.azione === 'ESCLUSO' ? `Escluso${e.fino ? ` fino al ${itData(e.fino)}` : ' fino a revoca'}` : 'Riammesso'}{e.motivo ? `: ${e.motivo}` : ''}</li>)}</ul></Card>}
          {puoi.operare && p?.scaduto > 0 && <div style={{ marginTop: 12 }}><button className="btn ghost" onClick={() => setM('legale')}>Proponi il passaggio all'area legale</button></div>}
        </div>
      </div>

      {m === 'escludi' && <Modulo title="Escludi dai solleciti" danger conferma="Escludi" onClose={() => setM(null)} intro="Decisione riservata a CEO e CFO. Nessuna comunicazione partirà verso questo cliente; le comunicazioni in attesa vengono annullate. La decisione resta nel registro con il tuo nome."
        campi={[{ k: 'motivo', label: 'Motivo', type: 'textarea', required: true }, { k: 'fino', label: 'Fino al (vuoto: fino a revoca)', type: 'date' }]} onConfirm={(v) => api.post(`/clienti/${id}/esclusione`, { escluso: true, motivo: v.motivo, fino: v.fino || null }).then(() => { window.dispatchEvent(new Event('suite:badges')); return d.reload(); })} />}
      {m === 'riammetti' && <Modulo title="Riammetti ai solleciti" conferma="Riammetti" onClose={() => setM(null)} intro="Il cliente rientra nella scala dal prossimo giro del motore." campi={[{ k: 'motivo', label: 'Nota', type: 'textarea' }]} onConfirm={(v) => api.post(`/clienti/${id}/esclusione`, { escluso: false, motivo: v.motivo }).then(d.reload)} />}
      {m === 'promessa' && <Modulo title="Promessa di pagamento" onClose={() => setM(null)} intro="La scala resta sospesa fino alla data promessa più la tolleranza; se l'incasso non arriva riprende da sola."
        campi={[{ k: 'data', label: 'Entro il', type: 'date', required: true }, { k: 'importo', label: 'Importo (vuoto: tutto lo scaduto)', type: 'number' }, { k: 'nota', label: 'Nota', type: 'textarea' }]} onConfirm={(v) => api.post('/promesse', { organization_id: Number(id), ...v }).then(d.reload)} />}
      {m === 'legale' && <Modulo title="Proponi il passaggio all'area legale" onClose={() => setM(null)} intro="La proposta va autorizzata dal CFO o dal CEO. Nessuna comunicazione al cliente parte da qui." campi={[{ k: 'motivo', label: 'Motivo', type: 'textarea', required: true }]} onConfirm={(v) => api.post('/legale', { organization_id: Number(id), motivo: v.motivo }).then(d.reload)} />}
      {m === 'fattura' && <Modulo title="Fattura inserita a mano" onClose={() => setM(null)} intro="Per i documenti che non arrivano da Synclab né dal partitario." campi={[{ k: 'numero', label: 'Numero', required: true }, { k: 'data', label: 'Data', type: 'date', required: true }, { k: 'scadenza', label: 'Scadenza', type: 'date', required: true }, { k: 'importo', label: 'Importo', type: 'number', required: true }, { k: 'nota', label: 'Nota' }]}
        onConfirm={(v) => api.post('/fatture', { organization_id: Number(id), ...v }).then(d.reload)} />}
      {m === 'chiamata' && <EsitoChiamata orgId={Number(id)} cliente={c.name} onClose={() => setM(null)} onFatto={d.reload} />}
      {m?.t === 'incasso' && <Modulo title={`Incasso sulla fattura n. ${m.f.numero}`} iniziale={{ importo: m.f.residuo, data: oggiIso() }} onClose={() => setM(null)} intro="Per gli incassi che non passano dal conto collegato (assegno, compensazione, altro conto)."
        campi={[{ k: 'importo', label: 'Importo', type: 'number', required: true }, { k: 'data', label: 'Data', type: 'date', required: true }, { k: 'nota', label: 'Nota' }]} onConfirm={(v) => api.post(`/fatture/${m.f.id}/incasso`, v).then(d.reload)} />}
      {m?.t === 'contestazione' && <Modulo title={m.f.contestata ? `Chiudi la contestazione sulla n. ${m.f.numero}` : `Fattura n. ${m.f.numero} contestata`} onClose={() => setM(null)} intro={m.f.contestata ? 'La fattura rientra nella scala di sollecito.' : 'La fattura esce dalla scala di sollecito fino alla chiusura della contestazione.'}
        campi={[{ k: 'nota', label: m.f.contestata ? 'Come si è chiusa' : 'Cosa contesta il cliente', type: 'textarea', required: true }]} onConfirm={(v) => api.post(`/fatture/${m.f.id}/contestazione`, { aperta: !m.f.contestata, nota: v.nota }).then(d.reload)} />}
      {m?.t === 'scadenza' && <Modulo title={`Scadenza della fattura n. ${m.f.numero}`} iniziale={{ scadenza: m.f.scadenza }} onClose={() => setM(null)} campi={[{ k: 'scadenza', label: 'Nuova scadenza', type: 'date', required: true }, { k: 'motivo', label: 'Motivo', required: true }]} onConfirm={(v) => api.put(`/fatture/${m.f.id}`, v).then(d.reload)} />}
      {m?.t === 'annullaPromessa' && <Modulo title="Annulla la promessa" onClose={() => setM(null)} campi={[{ k: 'motivo', label: 'Motivo', required: true }]} onConfirm={(v) => api.post(`/promesse/${m.q.id}/annulla`, v).then(d.reload)} />}
      {m?.t === 'testo' && <Modal wide title="Comunicazione" onClose={() => setM(null)}><Testo id={m.id} /></Modal>}
    </div>
  );
}

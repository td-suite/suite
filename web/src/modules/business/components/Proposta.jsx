// Business Hub · scheda "Proposta e contratto" dell'account (processo Service, richiesta del CEO del 06/11/2026): checklist dei
// prerequisiti del kit (listino, referente, dati del cliente, credenziali StudioLAB, accesso alla Suite, offerta economica, lettera di
// offerta), collegamento alla form online, "Prepara la mail" con l'anteprima di testo e allegati, "Invia da service@" con conferma (e
// conferma del reinvio per la stessa versione del listino), allegati arrivati dal cliente da verificare ("È il contratto firmato"),
// anagrafiche ricevute con le differenze da applicare, esito della contrattualizzazione (comunicazioni, attivazione dei servizi).
import React, { useState } from 'react';
import { api, API_BASE } from '../api.js';
import { useApi, Card, Field, ErrorBox, Loading, Badge, Modal, Icon, Empty, ConfirmModal, useToast } from './ui.jsx';
import { itDate, itDateTime, bytes, EMAIL_STATO, FASI, num } from '../format.js';

const docUrl = (id, inline) => `${API_BASE}/hub/documenti/${id}${inline ? '?inline=1' : ''}`;
const COM = { interna: 'Avvenuta contrattualizzazione (interna)', benvenuto: 'Ringraziamento e benvenuto al cliente', laboratorio: 'Nuovo cliente al laboratorio' };

export default function Proposta({ a, onChange, vaiA }) {
  const toast = useToast();
  const q = useApi(`/hub/accounts/${a.id}/processo`);
  const [kit, setKit] = useState(null);         // anteprima del kit preparato
  const [opz, setOpz] = useState({ contatto_id: '', includi_password: false, vademecum: true });
  const [busy, setBusy] = useState('');
  const [manuale, setManuale] = useState(false);
  const [dati, setDati] = useState(null);
  const [mostraProposta, setMostraProposta] = useState(false);
  const d = q.data;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!d) return <Loading />;
  const edit = d.puo_modificare;
  const ricarica = () => { q.reload(); onChange?.(); };
  const run = async (k, fn, msg) => { setBusy(k); try { const r = await fn(); if (msg) toast(typeof msg === 'function' ? msg(r) : msg); ricarica(); return r; } catch (e) { toast(e.message, 'err'); return null; } finally { setBusy(''); } };
  const prepara = async () => {
    const r = await run('prepara', () => api.post(`/hub/accounts/${a.id}/kit/prepara`, { contatto_id: opz.contatto_id ? Number(opz.contatto_id) : null, includi_password: opz.includi_password, vademecum: opz.vademecum }));
    if (r) setKit({ ...r, oggettoEdit: r.oggetto, testoEdit: r.testo, altri: '' });
  };
  const azione = { listino: () => vaiA('listino'), offerta: () => vaiA('listino'), referente: () => vaiA('referenti'), lettera: () => vaiA('contratti'), dati: () => window.open('/admin/organizations', '_blank') };
  const contratti = d.documenti_contratto || [];
  const c = d.contrattualizzazione;
  // Cliente già attivo o contrattualizzato (fase 6-7): la proposta è una fase passata, la checklist del kit non va mostrata come
  // "da compilare" (CEO, 07/11/2026). Resta raggiungibile per una nuova proposta (es. revisione del listino).
  const acquisito = Boolean(a.cliente_attivo || Number(a.fase_corrente) >= 6 || d.contrattualizzato_at);
  const vociOk = d.prerequisiti.voci.filter((v) => v.ok).length;
  return (
    <>
      {d.contrattualizzato_at && <div className="alert info" style={{ marginBottom: 12 }}><b>Contratto firmato ricevuto il {itDateTime(d.contrattualizzato_at)}</b>{c?.fonte ? ` (${c.fonte})` : ''}: pipeline alla fase 6, servizi della Suite attivati, comunicazioni inviate. La fase 7 la conferma il CEO.</div>}
      <DaVerificare righe={d.da_verificare} edit={edit} busy={busy} run={run} />

      {acquisito && !mostraProposta && <Card title={a.cliente_attivo ? 'Cliente attivo' : 'Cliente contrattualizzato'} className="mb" actions={<Badge tone="green">{a.cliente_attivo ? 'attivo' : 'contratto firmato'}</Badge>}>
        <table className="t"><tbody>
          <tr><td className="muted">Fase</td><td>{FASI[a.fase_corrente]?.label || a.fase_corrente}{a.attivo_dal ? ` · attivo dal ${itDate(a.attivo_dal)}` : ''}</td></tr>
          <tr><td className="muted">Contratto</td><td>{contratti.length ? contratti.map((x) => <div key={x.id}><a href={docUrl(x.id)}>{x.etichetta || x.filename}</a> <span className="small muted">{itDate(x.created_at)}</span></div>) : c?.contratto?.protocol || <span className="muted">nessun contratto firmato registrato nel fascicolo (i contratti protocollati sono nella scheda Contratti)</span>}{' '}<button className="btn link small" onClick={() => vaiA('contratti')}>Vai ai contratti</button></td></tr>
          <tr><td className="muted">Listino StudioLAB</td><td>{d.listino ? `v${d.listino.versione}, ${d.listino.riepilogo?.esami} esami` : d.listino_nel_contratto ? <>Excel allegato al contratto: {d.listino_nel_contratto.filename}{edit && <> <button className="btn sm" disabled={Boolean(busy)} onClick={() => run('imp', () => api.post(`/hub/accounts/${a.id}/listini/da-contratto/${d.listino_nel_contratto.id}`, {}), (r) => `Listino v${r.versione} importato dal contratto: ${r.riepilogo.esami} esami`)}>Importa dal contratto</button></>}</> : <span className="muted">non caricato</span>} <button className="btn link small" onClick={() => vaiA('listino')}>Listino e offerta</button></td></tr>
          {d.offerta_contratto && <tr><td className="muted">Offerta economica</td><td>allegata al contratto: <a href={`${API_BASE}/contract-files/${d.offerta_contratto.id}`}>{d.offerta_contratto.filename}</a></td></tr>}
          <tr><td className="muted">Accesso alla Suite</td><td>{d.prerequisiti.voci.find((v) => v.key === 'accesso')?.ok ? 'creato' : <span className="muted">non creato</span>} <button className="btn link small" onClick={() => vaiA('portale')}>Portale</button></td></tr>
        </tbody></table>
        <div className="small muted" style={{ marginTop: 8 }}>La proposta al cliente è una fase già superata: il kit non è richiesto. {edit && <button className="btn link small" onClick={() => setMostraProposta(true)}>Prepara comunque una nuova proposta</button>}</div>
      </Card>}
      <div className="grid g2">
        {(!acquisito || mostraProposta) && <Card title="Proposta al cliente" actions={d.prerequisiti.pronto ? <Badge tone="green">pronta</Badge> : <Badge tone="red">prerequisiti mancanti</Badge>}>
          <ul className="checklist-pr">
            {d.prerequisiti.voci.map((v) => <li key={v.key} className={v.ok ? 'ok' : v.auto ? 'auto' : 'ko'}>
              <span className="ico">{v.ok ? '✓' : v.auto ? '•' : '✗'}</span>
              <div style={{ flex: 1 }}><div className="strong">{v.label}</div><div className="small muted">{v.dettaglio}</div></div>
              {!v.ok && edit && v.key === 'accesso' && d.referente?.email && <button className="btn sm ghost" disabled={Boolean(busy)} onClick={() => run('accesso', () => api.post(`/hub/accounts/${a.id}/accesso`, {}), (r) => (r.password_provvisoria ? `Accesso creato (posta in modalità registro: password provvisoria ${r.password_provvisoria})` : 'Accesso creato e invito inviato'))}>Crea accesso</button>}
              {!v.ok && edit && v.key === 'listino' && v.nel_contratto && <button className="btn sm" disabled={Boolean(busy)} onClick={() => run('imp', () => api.post(`/hub/accounts/${a.id}/listini/da-contratto/${v.nel_contratto.id}`, {}), (r) => `Listino v${r.versione} importato dal contratto: ${r.riepilogo.esami} esami`)}>Importa dal contratto</button>}
              {!v.ok && azione[v.key] && <button className="btn sm ghost" onClick={azione[v.key]}>{v.key === 'dati' ? 'Legal entity' : 'Vai'}</button>}
            </li>)}
          </ul>
          {d.accessi.length > 0 && <div className="small muted" style={{ marginTop: 8 }}>Accessi esterni della Legal entity: {d.accessi.map((u) => `${u.full_name} (${u.email}, ${u.widget ? `${u.widget} widget` : 'nessun widget'}${u.last_login_at ? `, ultimo accesso ${itDateTime(u.last_login_at)}` : ', mai entrato'})`).join(' · ')}</div>}
          <hr />
          <div className="form-grid">
            <Field label="Referente destinatario"><select value={opz.contatto_id} onChange={(e) => setOpz({ ...opz, contatto_id: e.target.value })} disabled={!edit}><option value="">{d.referente ? `${d.referente.nome} (principale)` : 'Nessun referente con email'}</option>{a.contatti.filter((x) => x.email && x.id !== d.referente?.id).map((x) => <option key={x.id} value={x.id}>{x.nome} · {x.email}</option>)}</select></Field>
            <Field label="Vademecum nel pacchetto"><select value={opz.vademecum ? '1' : '0'} onChange={(e) => setOpz({ ...opz, vademecum: e.target.value === '1' })} disabled={!edit}><option value="1">Con le pagine (PDF completo)</option><option value="0">Solo link e QR (allegati più leggeri)</option></select></Field>
            {d.studiolab?.ha_password && <label className="f inline span2"><input type="checkbox" checked={opz.includi_password} onChange={(e) => setOpz({ ...opz, includi_password: e.target.checked })} disabled={!edit} />Stampa la password StudioLAB nel pacchetto (altrimenti "comunicata separatamente")</label>}
          </div>
          {d.gia_inviato && <div className="alert warn small" style={{ marginTop: 10 }}>Il kit per il listino v{d.gia_inviato.listino_versione} è già stato inviato il {itDateTime(d.gia_inviato.inviato_at)}{d.gia_inviato.inviato_a ? ` a ${d.gia_inviato.inviato_a}` : ''}. Un nuovo invio chiede conferma.</div>}
          {edit && <div className="row" style={{ marginTop: 12 }}><button className="btn" disabled={!d.prerequisiti.pronto || Boolean(busy)} onClick={prepara}><Icon name="mail" />{busy === 'prepara' ? 'Preparo il kit… (qualche secondo)' : 'Prepara la mail'}</button>
            <span className="small muted">Genera il pacchetto della proposta, il MOD173 compilabile e il collegamento alla form; l'invio parte solo dopo l'anteprima.</span></div>}
        </Card>}

        <div>
          {(!acquisito || mostraProposta || d.form.link) && <Card title="Form online del cliente">
            {d.form.link ? <>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><code className="small" style={{ wordBreak: 'break-all' }}>{d.form.link}</code></div>
              <div className="small" style={{ marginTop: 6 }}>{d.form.valido ? <Badge tone="green">valido fino al {itDate(d.form.scade)}</Badge> : <Badge tone="red">{d.form.motivo}</Badge>} · riferimento nell'oggetto delle email: <span className="mono">{d.form.rif}</span></div>
              <div className="row" style={{ marginTop: 8, gap: 6 }}>
                <button className="btn sm ghost" onClick={() => { navigator.clipboard?.writeText(d.form.link); toast('Collegamento copiato'); }}><Icon name="link" />Copia</button>
                <a className="btn sm ghost" href={d.form.link} target="_blank" rel="noreferrer"><Icon name="eye" />Apri</a>
                {edit && <button className="btn sm ghost" onClick={() => run('link', () => api.post(`/hub/accounts/${a.id}/b2b-link`, { azione: 'rinnova' }), `Collegamento rinnovato per ${d.form.giorni} giorni`)}>Rinnova</button>}
                {edit && <button className="btn sm ghost" onClick={() => run('link', () => api.post(`/hub/accounts/${a.id}/b2b-link`, { azione: 'rigenera' }), 'Nuovo collegamento: il precedente non vale più')}>Nuovo collegamento</button>}
              </div>
            </> : <div className="small muted">Il collegamento nasce con la preparazione del kit (valido {d.form.giorni} giorni, Impostazioni).{edit && <> <button className="btn sm ghost" onClick={() => run('link', () => api.post(`/hub/accounts/${a.id}/b2b-link`, { azione: 'crea' }), 'Collegamento creato')}>Crealo ora</button></>}</div>}
            <div className="small muted" style={{ marginTop: 8 }}>Senza login: il cliente compila l'Anagrafica Clienti B2B (MOD173), carica il contratto firmato e gli allegati. La form salva nel fascicolo e con il contratto firmato avvia la contrattualizzazione.</div>
          </Card>}
          <Card title={acquisito ? 'Dati di avvio' : 'Avvio del cliente'} className={(!acquisito || mostraProposta || d.form.link) ? 'mt' : ''} actions={edit && !dati && <button className="btn sm ghost" onClick={() => setDati({ volumi_giornalieri_attesi: d.volumi_giornalieri_attesi ?? '', data_avvio_prevista: d.data_avvio_prevista ? String(d.data_avvio_prevista).slice(0, 10) : '', non_contattare: Boolean(a.non_contattare) })}><Icon name="edit" />Modifica</button>}>
            {!dati ? <table className="t"><tbody>
              <tr><td className="muted">Volumi giornalieri attesi</td><td>{d.volumi_giornalieri_attesi != null ? `${num(d.volumi_giornalieri_attesi)} esami al giorno` : a.volume_fy_atteso ? <span className="muted">dal volume annuo atteso ({num(a.volume_fy_atteso)})</span> : '–'}</td></tr>
              <tr><td className="muted">Data di avvio prevista</td><td>{d.data_avvio_prevista ? itDate(d.data_avvio_prevista) : '–'}</td></tr>
              <tr><td className="muted">Richiamo dei prospect</td><td>{a.non_contattare ? <Badge tone="red">non contattare</Badge> : 'sì, se resta prospect'}{a.ultimo_richiamo_at ? <span className="small muted"> · ultimo {itDate(a.ultimo_richiamo_at)}</span> : ''}</td></tr>
            </tbody></table> : <>
              <div className="form-grid">
                <Field label="Volumi giornalieri attesi (esami)"><input value={dati.volumi_giornalieri_attesi} onChange={(e) => setDati({ ...dati, volumi_giornalieri_attesi: e.target.value })} /></Field>
                <Field label="Data di avvio prevista"><input type="date" value={dati.data_avvio_prevista} onChange={(e) => setDati({ ...dati, data_avvio_prevista: e.target.value })} /></Field>
                <label className="f inline span2"><input type="checkbox" checked={dati.non_contattare} onChange={(e) => setDati({ ...dati, non_contattare: e.target.checked })} />Non contattare (escluso dal richiamo periodico dei prospect)</label>
              </div>
              <div className="row end" style={{ marginTop: 10 }}><button className="btn ghost" onClick={() => setDati(null)}>Annulla</button><button className="btn" onClick={async () => { await run('dati', () => api.put(`/hub/accounts/${a.id}`, dati), 'Dati salvati'); setDati(null); }}>Salva</button></div>
            </>}
            <div className="small muted" style={{ marginTop: 6 }}>{acquisito ? 'Dati facoltativi: servono per il laboratorio e per le statistiche; non sono richiesti per un cliente già attivo.' : 'Volumi e data di avvio vanno nell\'email al laboratorio quando arriva il contratto firmato.'}</div>
          </Card>
        </div>
      </div>

      {c && <Card title="Contrattualizzazione" className="mt">
        <table className="t"><tbody>
          <tr><td className="muted">Contratto firmato</td><td>{c.fonte} · {c.contratto?.protocol ? `${c.contratto.protocol}: ` : ''}{c.contratto?.esito}{c.documento_id ? <> · <a href={docUrl(c.documento_id)}>PDF</a></> : null}</td></tr>
          <tr><td className="muted">Pipeline</td><td>{c.fase ? `fase ${c.fase}` : 'già oltre la fase 6'}</td></tr>
          <tr><td className="muted">Servizi della Suite</td><td>profilo Cliente service su {c.attivazione?.accessi || 0} accessi{c.attivazione?.inviti?.length ? ` · invito a ${c.attivazione.inviti.map((x) => x.email).join(', ')}` : ''}</td></tr>
          {Object.entries(COM).map(([k, l]) => { const e = c.email?.[k]; return <tr key={k}><td className="muted">{l}</td><td>{e ? <><Badge tone={EMAIL_STATO[e.stato]?.tone || 'grey'}>{EMAIL_STATO[e.stato]?.label || e.stato}</Badge> <span className="small">a {(e.to || []).join(', ') || '–'}{e.cc?.length ? ` · cc ${e.cc.join(', ')}` : ''}</span>{e.errore ? <div className="small red">{e.errore}</div> : null}</> : '–'}</td></tr>; })}
        </tbody></table>
        {c.avvisi?.length > 0 && <div className="alert warn small" style={{ marginTop: 8 }}>{c.avvisi.map((x, i) => <div key={i}>{x}</div>)}</div>}
        {edit && <div className="row" style={{ marginTop: 8 }}><button className="btn sm ghost" onClick={() => run('attiva', () => api.post(`/hub/accounts/${a.id}/attiva-accessi`, {}), (r) => `Profilo Cliente service su ${r.accessi} accessi`)}>Riapplica i servizi agli accessi</button><span className="small muted">Dopo aver creato la sede SERVICE o un nuovo accesso esterno.</span></div>}
      </Card>}

      <div className="grid g2 mt">
        <Card title="Anagrafiche ricevute (MOD173)" flush>
          {d.anagrafiche.length ? <table className="t"><tbody>{d.anagrafiche.map((x) => <Anagrafica key={x.id} x={x} edit={edit} onDone={ricarica} />)}</tbody></table> : <Empty>Nessuna anagrafica compilata online</Empty>}
        </Card>
        <Card title="Contratto firmato e allegati nel fascicolo" flush actions={edit && !d.contrattualizzato_at && <button className="btn sm ghost" onClick={() => setManuale(true)}>Contratto firmato già nei documenti</button>}>
          {contratti.length ? <table className="t"><tbody>{contratti.map((x) => <tr key={x.id}><td><a href={docUrl(x.id)}><Icon name="download" />{x.filename}</a><div className="small muted">{x.etichetta || ''} · {bytes(x.size)} · {itDateTime(x.created_at)}</div></td></tr>)}</tbody></table> : <Empty>Nessun contratto firmato ricevuto</Empty>}
        </Card>
      </div>

      <Card title="Registro dei kit di proposta" className="mt" flush>
        {d.kit.length ? <table className="t"><thead><tr><th>Preparato</th><th>Listino</th><th>Allegati</th><th>Stato</th><th>Invio</th></tr></thead><tbody>
          {d.kit.map((k) => <tr key={k.id}>
            <td className="small">{itDateTime(k.preparato_at)}<div className="muted">{k.preparato_da || ''}</div></td>
            <td>v{k.listino_versione}</td>
            <td className="small">{(k.allegati || []).map((x) => x.filename).join(', ')}</td>
            <td><Badge tone={k.stato === 'INVIATO' ? 'green' : k.stato === 'FALLITO' ? 'red' : k.stato === 'ANNULLATO' ? 'grey' : 'blue'}>{k.stato.toLowerCase()}</Badge></td>
            <td className="small">{k.inviato_at ? <>{itDateTime(k.inviato_at)} · {EMAIL_STATO[k.inviato_stato]?.label || k.inviato_stato}<div className="muted">a {k.inviato_a}{k.inviato_cc ? ` · cc ${k.inviato_cc}` : ''}</div></> : k.stato === 'PREPARATO' && edit ? <><button className="btn sm ghost" onClick={async () => { const r = await api.get(`/hub/kit/${k.id}`); setKit({ id: k.id, from: d.casella, to: r.destinatari, cc: d.cc_fissi.filter((x) => !r.destinatari.includes(x)), oggetto: r.oggetto, testo: r.testo, allegati: r.allegati, avvisi: r.avvisi || [], oggettoEdit: r.oggetto, testoEdit: r.testo, altri: '', gia_inviato: d.gia_inviato ? { at: d.gia_inviato.inviato_at, versione: d.gia_inviato.listino_versione } : null, link: d.form.link }); }}>Anteprima e invio</button> <button className="btn sm ghost" onClick={() => run('ann', () => api.post(`/hub/kit/${k.id}/annulla`, {}), 'Kit annullato')}>Annulla</button></> : '–'}</td>
          </tr>)}
        </tbody></table> : <Empty>Nessun kit preparato</Empty>}
      </Card>

      {kit && <AnteprimaKit kit={kit} setKit={setKit} onClose={() => setKit(null)} onDone={() => { setKit(null); ricarica(); }} />}
      {manuale && <ContrattoManuale a={a} onClose={() => setManuale(false)} onDone={() => { setManuale(false); ricarica(); }} />}
    </>
  );
}

// Allegati arrivati dal cliente o dal partner (posta con il riferimento [TD-B2B-...]): un clic per dire cos'è
export function DaVerificare({ righe, edit, busy, run, chi = 'dal cliente', okMsg = 'Contratto firmato registrato: comunicazioni inviate e servizi attivati' }) {
  if (!righe?.length) return null;
  return (
    <Card title={`Allegati arrivati ${chi} da verificare (${righe.length})`} className="mb" flush>
      <table className="t"><tbody>{righe.map((x) => <tr key={x.id}>
        <td><a href={docUrl(x.id, true)} target="_blank" rel="noreferrer"><Icon name="eye" />{x.filename}</a><div className="small muted">{x.from_email ? `email da ${x.from_email}, ${itDateTime(x.received_at)}` : itDateTime(x.created_at)} · {bytes(x.size)}</div></td>
        <td style={{ whiteSpace: 'nowrap', width: 1 }}>{edit && <>
          <button className="btn sm" disabled={Boolean(busy)} onClick={() => run(`v${x.id}`, () => api.post(`/hub/documenti/${x.id}/verifica`, { esito: 'CONTRATTO' }), (r) => (r.contrattualizzazione?.gia ? 'PDF aggiunto: il contratto firmato era già stato ricevuto' : okMsg))}><Icon name="check" />È il contratto firmato</button>{' '}
          <button className="btn sm ghost" disabled={Boolean(busy)} onClick={() => run(`v${x.id}`, () => api.post(`/hub/documenti/${x.id}/verifica`, { esito: 'ALLEGATO' }), 'Registrato come allegato del contratto')}>Allegato del contratto</button>{' '}
          <button className="btn sm ghost" disabled={Boolean(busy)} onClick={() => run(`v${x.id}`, () => api.post(`/hub/documenti/${x.id}/verifica`, { esito: 'NON_PERTINENTE' }), 'Segnato come non pertinente')}>Non pertinente</button>
        </>}</td>
      </tr>)}</tbody></table>
    </Card>
  );
}

function Anagrafica({ x, edit, onDone }) {
  const toast = useToast();
  const [sel, setSel] = useState([]);
  const diff = x.differenze || [];
  const applica = async () => { try { const r = await api.post(`/hub/anagrafiche/${x.id}/applica`, { campi: sel }); toast(`${r.applicati} campi applicati alla Legal entity`); setSel([]); onDone(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <tr><td>
      <div className="row" style={{ gap: 8 }}><span className="strong">Versione {x.versione}</span><span className="small muted">{itDateTime(x.inviata_at)}</span>{x.documento_id && <a className="small" href={docUrl(x.documento_id)}><Icon name="download" />MOD173 compilato</a>}</div>
      {x.riempiti?.length > 0 && <div className="small">Completati nella Legal entity (erano vuoti): {x.riempiti.map((v) => v.label).join(', ')}</div>}
      {x.allegati?.length > 0 && <div className="small muted">File: {x.allegati.map((v) => v.etichetta).join(', ')}</div>}
      {diff.length > 0 ? <div style={{ marginTop: 6 }}>
        <div className="small strong">Differenze da verificare (la Suite ha già un valore):</div>
        <table className="t small"><tbody>{diff.map((v) => <tr key={v.campo}>
          <td style={{ width: 1 }}>{edit && <input type="checkbox" checked={sel.includes(v.campo)} onChange={() => setSel((s) => (s.includes(v.campo) ? s.filter((y) => y !== v.campo) : [...s, v.campo]))} />}</td>
          <td className="muted">{v.label}</td><td>{v.attuale}</td><td>→ <b>{v.proposto}</b></td></tr>)}</tbody></table>
        {edit && <button className="btn sm" disabled={!sel.length} onClick={applica}>Applica i campi scelti</button>}
      </div> : x.applicata_at ? <div className="small green">Differenze applicate il {itDateTime(x.applicata_at)}</div> : <div className="small muted">Nessuna differenza con la Suite</div>}
    </td></tr>
  );
}

// Anteprima della mail: mittente, destinatari, copie fisse, oggetto e testo modificabili, allegati con le dimensioni; conferma e invio.
// partner: invio del contratto al partner della linea Punti Prelievo (stessa meccanica, testi diversi)
export function AnteprimaKit({ kit, setKit, onClose, onDone, partner = false }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [reinvio, setReinvio] = useState(false);
  const tot = (kit.allegati || []).reduce((n, x) => n + Number(x.size || 0), 0);
  const invia = async (reinvia = false) => {
    setBusy(true);
    try {
      const r = await api.post(`/hub/kit/${kit.id}/invia`, { conferma: true, reinvia, oggetto: kit.oggettoEdit, testo: kit.testoEdit, altri: kit.altri.split(/[,;\s]+/).filter(Boolean) });
      const cosa = partner ? 'Contratto' : 'Kit';
      toast(r.stato === 'FALLITO' ? `Invio non riuscito: ${r.errore}` : r.stato === 'REGISTRATO' ? `${cosa} registrato (posta in modalità registro): pipeline alla fase 4` : `${cosa} inviato da ${r.from}: pipeline alla fase 4`, r.stato === 'FALLITO' ? 'err' : 'ok');
      onDone();
    } catch (e) {
      if (e.status === 409) setReinvio(e.message); else toast(e.message, 'err');
    } finally { setBusy(false); }
  };
  return (
    <Modal wide title={partner ? 'Anteprima del contratto al partner' : 'Anteprima del kit di proposta'} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Chiudi (resta preparato)</button><button className="btn" disabled={busy} onClick={() => invia(false)}><Icon name="mail" />{busy ? 'Invio…' : `Invia da ${kit.from}`}</button></>}>
      <table className="t"><tbody>
        <tr><td className="muted">Mittente</td><td className="strong">{kit.from}</td></tr>
        <tr><td className="muted">Destinatari</td><td>{kit.to.join(', ')}</td></tr>
        <tr><td className="muted">Copie fisse (sempre presenti)</td><td>{kit.cc.join(', ') || '–'}</td></tr>
        <tr><td className="muted">Allegati ({bytes(tot)})</td><td className="small">{(kit.allegati || []).map((x, i) => <div key={i}><Icon name="file" size={13} /> {x.filename} <span className="muted">· {bytes(x.size)} · {x.ruolo}</span></div>)}</td></tr>
        {kit.link && <tr><td className="muted">Form online</td><td className="small"><a href={kit.link} target="_blank" rel="noreferrer">{kit.link}</a></td></tr>}
      </tbody></table>
      {kit.gia_inviato && <div className="alert warn small" style={{ marginTop: 8 }}>Attenzione: {partner ? 'questo contratto è già stato inviato al partner' : `il kit per il listino v${kit.gia_inviato.versione} è già stato inviato`} il {itDateTime(kit.gia_inviato.at)}.</div>}
      {kit.avvisi?.length > 0 && <div className="alert warn small" style={{ marginTop: 8 }}>{kit.avvisi.map((x, i) => <div key={i}>{x}</div>)}</div>}
      <div className="form-grid mt">
        <Field label={`Altri destinatari (oltre al referente${partner ? ' del partner' : ''})`} className="span2"><input value={kit.altri} onChange={(e) => setKit({ ...kit, altri: e.target.value })} placeholder="indirizzi separati da virgola" /></Field>
        <Field label="Oggetto (il riferimento [TD-B2B-…] serve all'ascolto della casella e resta sempre)" className="span2"><input value={kit.oggettoEdit} onChange={(e) => setKit({ ...kit, oggettoEdit: e.target.value })} /></Field>
        <Field label="Testo (dal modello in Impostazioni)" className="span2"><textarea style={{ minHeight: 320 }} value={kit.testoEdit} onChange={(e) => setKit({ ...kit, testoEdit: e.target.value })} /></Field>
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>Con l'invio: email nel diario ({partner ? 'Contratto al partner' : 'Kit di proposta'}) e nel registro invii, pipeline alla fase 4 Offerta inviata con la data di oggi.</div>
      {reinvio && <ConfirmModal title={partner ? 'Inviare di nuovo il contratto?' : 'Inviare di nuovo il kit?'} text={`${reinvio}.`} confirmText="Sì, invia di nuovo" onClose={() => setReinvio(false)} onConfirm={async () => { setReinvio(false); await invia(true); }} />}
    </Modal>
  );
}

// Contratto firmato arrivato fuori dalla form e dalla casella (caricato a mano nei Documenti): stessa contrattualizzazione
function ContrattoManuale({ a, onClose, onDone }) {
  const toast = useToast();
  const pdf = a.documenti.filter((x) => /pdf/i.test(x.mime) || /\.pdf$/i.test(x.filename));
  const [id, setId] = useState('');
  const go = async () => { try { const r = await api.post(`/hub/accounts/${a.id}/contrattualizza`, { documento_id: Number(id) }); toast(r.gia ? 'PDF aggiunto: già contrattualizzato' : 'Contratto firmato registrato: comunicazioni inviate e servizi attivati'); onDone(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Modal title="Contratto firmato dai documenti dell'account" onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={!id} onClick={go}>È il contratto firmato</button></>}>
      <Field label="PDF del contratto firmato"><select value={id} onChange={(e) => setId(e.target.value)}><option value="">Scegli…</option>{pdf.map((x) => <option key={x.id} value={x.id}>{x.filename} ({itDateTime(x.created_at)})</option>)}</select></Field>
      <div className="small muted" style={{ marginTop: 8 }}>Caricalo prima dalla scheda Documenti. Con la conferma: contratto FIRMATO, pipeline alla fase 6, servizi della Suite attivati, email interna, benvenuto al cliente ed email al laboratorio.</div>
    </Modal>
  );
}

// Business Hub · scheda "Pacchetto di benvenuto" dell'account (richiesta del CEO del 06/11/2026): composizione (sezioni da includere,
// referente destinatario, data, password del portale referti sì/no), "Genera anteprima" (nuova versione nei Documenti dell'account,
// PDF in pagina), "Scarica", "Invia dalla casella della linea" (stesso riepilogo e copie fisse di "Scrivi al cliente", EMAIL_OUT nel
// diario con il PDF allegato) e registro delle versioni con l'invio. I modelli dei testi si modificano in Impostazioni.
import React, { useEffect, useMemo, useState } from 'react';
import { api, API_BASE, BASE } from '../api.js';
import { useApi, Card, Field, ErrorBox, Loading, Badge, Modal, Icon, Empty, useToast } from './ui.jsx';
import { itDate, itDateTime, bytes, EMAIL_STATO, LINEE } from '../format.js';

const docUrl = (id, inline) => `${API_BASE}/hub/documenti/${id}${inline ? '?inline=1' : ''}`;

export default function Pacchetto({ a, onChange }) {
  const toast = useToast();
  const q = useApi(`/hub/accounts/${a.id}/pacchetto`);
  const [escluse, setEscluse] = useState([]);
  const [contatto, setContatto] = useState('');
  const [password, setPassword] = useState(false);
  const [data, setData] = useState('');
  const [busy, setBusy] = useState(false);
  const [esito, setEsito] = useState(null);
  const [vista, setVista] = useState(null);     // versione in anteprima
  const [invio, setInvio] = useState(null);     // versione da inviare
  const d = q.data;
  useEffect(() => { if (d) { setContatto(d.contatto_predefinito ? String(d.contatto_predefinito) : ''); setData(d.data); if (d.versioni[0] && !vista) setVista(d.versioni[0]); } }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  if (q.error) return <ErrorBox error={q.error} />;
  if (!d) return <Loading />;
  const disp = d.disponibilita;
  const toggle = (k) => setEscluse((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]));
  const genera = async () => {
    setBusy(true); setEsito(null);
    try {
      const r = await api.post(`/hub/accounts/${a.id}/pacchetto`, { escluse, contatto_id: contatto ? Number(contatto) : null, includi_password: password, data });
      setEsito(r); toast(`Pacchetto v${r.versione} generato: ${r.pagine} pagine`);
      await q.reload(); onChange?.();
      setVista({ id: r.id, versione: r.versione, documento_id: r.documento_id, filename: r.filename, pagine: r.pagine, contatto_id: contatto ? Number(contatto) : null, data });
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  const ultima = d.versioni[0];
  return (
    <>
      <div className="grid g2">
        <Card title="Composizione" actions={<Badge tone={LINEE[a.linea].tone}>{d.linea_label}</Badge>}>
          <div className="small muted" style={{ marginBottom: 10 }}>Un unico PDF su carta intestata, con indice, numeri di pagina e segnalibri. Le sezioni senza dati non compaiono e lo si vede qui sotto.</div>
          <ul className="pk-sez">
            {d.sezioni.map((s) => {
              // offerta economica già nell'Allegato 1 della lettera di offerta: torna sezione a sé se la lettera si esclude
              const libera = s.nellaLettera && escluse.includes('offerta');
              const off = !s.fissa && s.motivo && !escluse.includes(s.key) && !libera;
              return (
                <li key={s.key} className={off ? 'off' : ''}>
                  <label className="f inline"><input type="checkbox" disabled={s.fissa || Boolean(off) || !d.puo_generare} checked={!off && !escluse.includes(s.key)} onChange={() => toggle(s.key)} />
                    <span className="strong">{s.titolo}</span>{s.fissa && <span className="small muted"> · sempre</span>}</label>
                  {s.key === 'offerta' && !off && <div className="small muted">{disp.offerta === 'PDF' ? `${disp.offerta_file.filename} (proposta ${disp.contratto.protocol || ''}, versione ${disp.offerta_file.version})` : `pagina "Offerta economica" con i dati della proposta: ${disp.proposta.map((x) => x.voce.toLowerCase()).join(', ')}`}</div>}
                  {s.key === 'credenziali' && <div className="small muted">{disp.accessi.length ? `${disp.accessi.length} accessi esterni della Legal entity` : 'nessun accesso esterno: crealo da Amministrazione > Legal entity > Accessi'}{disp.portale_referti ? ` · portale referti: ${disp.portale_referti.username || '–'}` : ''}</div>}
                  {s.key === 'listino' && !off && disp.listino && <div className="small muted">{disp.listino.filename} (dal listino StudioLAB v{disp.listino.versione})</div>}
                  {s.key === 'studiolab' && !off && disp.portale_referti && <div className="small muted">{disp.portale_referti.url || ''}{disp.portale_referti.username ? ` · utente ${disp.portale_referti.username}` : ''}</div>}
                  {s.key === 'vademecum' && <div className="small muted">{disp.service_attivo ? 'PDF dallo specchio del Portale Service, in coda (se non disponibile: link e QR)' : 'Portale Service non avviato: link e QR al Vademecum online'}</div>}
                  {off && <div className={`small ${s.nellaLettera ? 'muted' : 'red'}`}>{s.motivo}</div>}
                </li>
              );
            })}
          </ul>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <Field label="Referente destinatario" help="Il nome va nella lettera e nell'email">
              <select value={contatto} onChange={(e) => setContatto(e.target.value)} disabled={!d.puo_generare}><option value="">Nessuno (Gentile Cliente)</option>{d.contatti.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.ruolo ? ` · ${c.ruolo}` : ''}{c.email ? '' : ' (senza email)'}</option>)}</select>
            </Field>
            <Field label="Data del pacchetto" help="Copertina, lettera e piano 30-60-90"><input type="date" value={data} onChange={(e) => setData(e.target.value)} disabled={!d.puo_generare} /></Field>
            {disp.portale_referti?.ha_password && <div className="span2">
              <label className="f inline"><input type="checkbox" checked={password} onChange={(e) => setPassword(e.target.checked)} disabled={!d.puo_generare} />Includi la password del portale referti nel pacchetto</label>
              {password ? <div className="alert warn small" style={{ marginTop: 6 }}>La password viene stampata nel PDF, che resta nei Documenti dell'account e parte per email: chiunque riceva il file la legge. Senza la spunta il pacchetto riporta "comunicata separatamente".</div>
                : <div className="small muted">Senza la spunta il pacchetto riporta "comunicata separatamente".</div>}
            </div>}
          </div>
          {d.puo_generare ? <div className="row" style={{ marginTop: 14, gap: 8 }}>
            <button className="btn" disabled={busy} onClick={genera}><Icon name="file" />{busy ? 'Generazione… (qualche secondo)' : 'Genera anteprima'}</button>
            <a className="small" href={`${BASE}/impostazioni#pacchetto`}>Modelli della lettera e dell'email</a>
          </div> : <div className="small muted" style={{ marginTop: 12 }}>Il pacchetto lo genera chi gestisce la linea {d.linea_label}.</div>}
          {esito?.avvisi?.length > 0 && <div className="alert warn small" style={{ marginTop: 10 }}>{esito.avvisi.map((x, i) => <div key={i}>{x}</div>)}</div>}
        </Card>

        <Card title={vista ? `Anteprima · versione ${vista.versione}` : 'Anteprima'} actions={vista?.documento_id && <div className="row" style={{ gap: 6 }}>
          <a className="btn sm ghost" href={docUrl(vista.documento_id)}><Icon name="download" />Scarica</a>
          {d.puo_generare && <button className="btn sm dark" onClick={() => setInvio(vista)}><Icon name="mail" />Invia dalla casella della linea</button>}
        </div>} flush>
          {vista?.documento_id ? <iframe className="pk-pdf" title="Anteprima del pacchetto" src={`${docUrl(vista.documento_id, true)}#view=FitH`} />
            : <Empty>{ultima ? 'Scegli una versione dal registro' : 'Nessun pacchetto generato: componi e premi "Genera anteprima"'}</Empty>}
        </Card>
      </div>

      <Card title="Registro dei pacchetti" className="mt" flush>
        {d.versioni.length ? <table className="t"><thead><tr><th>Versione</th><th>Data</th><th>Pagine</th><th>Destinatario</th><th>Sezioni</th><th>Invio</th><th /></tr></thead><tbody>
          {d.versioni.map((v) => {
            const n = (v.sezioni || []).filter((s) => s.inclusa).length;
            const st = v.inviato_stato ? EMAIL_STATO[v.inviato_stato] : null;
            return (
              <tr key={v.id} className={vista?.id === v.id ? 'sel' : ''}>
                <td className="strong">v{v.versione}{v.password_inclusa && <> <Badge tone="mauve">con password</Badge></>}</td>
                <td>{itDate(v.data)}<div className="small muted">generato {itDateTime(v.created_at)}{v.created_by_name ? ` · ${v.created_by_name}` : ''}</div></td>
                <td>{v.pagine}<div className="small muted">{v.bytes ? bytes(v.bytes) : ''}</div></td>
                <td>{v.destinatario || '–'}</td>
                <td className="small">{n} sezioni{(v.sezioni || []).some((s) => !s.inclusa) ? <div className="muted">non incluse: {(v.sezioni || []).filter((s) => !s.inclusa).map((s) => s.titolo).join(', ')}</div> : null}</td>
                <td>{st ? <><Badge tone={st.tone}>{st.label}</Badge><div className="small muted">{itDateTime(v.inviato_at)}{v.inviato_a ? ` · ${v.inviato_a}` : ''}</div></> : <span className="muted small">non inviato</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{v.documento_id ? <>
                  <button className="btn sm ghost" onClick={() => setVista(v)}>Anteprima</button>{' '}
                  <a className="iconbtn" title="Scarica" href={docUrl(v.documento_id)}><Icon name="download" /></a>
                  {d.puo_generare && <button className="iconbtn" title="Invia" onClick={() => setInvio(v)}><Icon name="mail" /></button>}
                </> : <span className="small muted">documento eliminato</span>}</td>
              </tr>
            );
          })}
        </tbody></table> : <Empty>Nessun pacchetto generato</Empty>}
      </Card>

      {invio && <InviaPacchetto a={a} v={invio} contatti={d.contatti} onClose={() => setInvio(null)} onDone={async () => { setInvio(null); await q.reload(); onChange?.(); }} />}
    </>
  );
}

// Invio dalla casella della linea: destinatari dai referenti (o liberi), copie fisse sempre presenti, testo dal modello, riepilogo e conferma
function InviaPacchetto({ a, v, contatti, onClose, onDone }) {
  const toast = useToast();
  const conEmail = contatti.filter((c) => c.email);
  const preset = conEmail.find((c) => c.id === v.contatto_id) || conEmail.find((c) => c.principale);
  const [f, setF] = useState({ to: preset ? [preset.email] : [], altri: '', cc_extra: '', subject: '', testo: '' });
  const [riep, setRiep] = useState(null);
  const [busy, setBusy] = useState(false);
  const cid = preset?.id || v.contatto_id || null;
  // indirizzi della Legal entity e delle strutture del gruppo, selezionabili come destinatari (07/11/2026, CEO: "anche tutti gli altri indirizzi")
  const altriIndirizzi = useMemo(() => { const seen = new Set(conEmail.map((c) => c.email.toLowerCase())); const out = [];
    const add = (email, label) => { const e = String(email || '').trim(); if (!e || seen.has(e.toLowerCase())) return; seen.add(e.toLowerCase()); out.push({ email: e, label }); };
    add(a.org_email, `${a.org_name} (email)`); add(a.org_pec, `${a.org_name} (PEC)`);
    for (const sd of a.sedi || []) { add(sd.email, sd.nome || 'struttura'); add(sd.pec, `${sd.nome || 'struttura'} (PEC)`); }
    return out; }, [a, conEmail]);
  const testo = useApi(`/hub/accounts/${a.id}/pacchetto/email${cid ? `?contatto_id=${cid}` : ''}`);
  useEffect(() => { if (testo.data) setF((x) => ({ ...x, subject: x.subject || testo.data.oggetto, testo: x.testo || testo.data.testo })); }, [testo.data]);
  const body = useMemo(() => () => ({ to: [...f.to, ...f.altri.split(/[,;\s]+/).filter(Boolean)], cc_extra: f.cc_extra.split(/[,;\s]+/).filter(Boolean), subject: f.subject, testo: f.testo, documenti: [v.documento_id], contatto_id: cid, pacchetto_id: v.id }), [f, v, cid]);
  const toggle = (e) => setF((x) => ({ ...x, to: x.to.includes(e) ? x.to.filter((y) => y !== e) : [...x.to, e] }));
  const anteprima = async () => { setBusy(true); try { setRiep(await api.post(`/hub/accounts/${a.id}/email/anteprima`, body())); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const invia = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/hub/accounts/${a.id}/email/invia`, { ...body(), conferma: true });
      toast(r.stato === 'FALLITO' ? `Invio non riuscito: ${r.errore}` : r.stato === 'REGISTRATO' ? 'Pacchetto registrato (posta in modalità registro)' : 'Pacchetto inviato e registrato nel diario', r.stato === 'FALLITO' ? 'err' : 'ok');
      onDone();
    } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  if (riep) return (
    <Modal wide title="Conferma l'invio del pacchetto" onClose={onClose} footer={<><button className="btn ghost" onClick={() => setRiep(null)}>Torna al messaggio</button><button className="btn" disabled={busy} onClick={invia}><Icon name="mail" />{busy ? 'Invio…' : 'Conferma e invia'}</button></>}>
      <table className="t"><tbody>
        <tr><td className="muted">Mittente</td><td className="strong">{riep.from}</td></tr>
        <tr><td className="muted">Destinatari</td><td>{riep.to.join(', ')}</td></tr>
        <tr><td className="muted">Copie fisse (sempre presenti)</td><td>{riep.cc_fissi.join(', ') || '–'}</td></tr>
        <tr><td className="muted">Copie</td><td>{riep.cc.join(', ') || '–'}</td></tr>
        <tr><td className="muted">Oggetto</td><td>{riep.subject}</td></tr>
        <tr><td className="muted">Allegato</td><td>{riep.allegati.map((x) => `${x.filename} (${bytes(x.size)})`).join(', ')}</td></tr>
      </tbody></table>
      {v.password_inclusa && <div className="alert warn small" style={{ marginTop: 10 }}>Questa versione contiene la password del portale referti.</div>}
      {riep.avvisi.length > 0 && <div className="alert warn small" style={{ marginTop: 10 }}>{riep.avvisi.join(' · ')}</div>}
      <div className="small muted" style={{ marginTop: 10 }}>L'email resta nel diario dell'account (Email inviata, con il PDF), nel registro invii e nel registro dei pacchetti.</div>
    </Modal>
  );
  return (
    <Modal wide title={`Invia il pacchetto v${v.versione} · da ${a.casella}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={busy || !f.subject || !f.testo} onClick={anteprima}>Riepilogo prima dell'invio</button></>}>
      <div className="form-grid">
        <div className="span2"><div className="row" style={{ justifyContent: 'space-between' }}><div className="small strong muted">Destinatari dai referenti</div>{conEmail.length > 1 && <button className="btn link small" onClick={() => setF((x) => ({ ...x, to: [...new Set([...x.to, ...conEmail.map((c) => c.email)])] }))}>Seleziona tutti i referenti</button>}</div>
          {conEmail.length ? conEmail.map((c) => <label key={c.id} className="f inline"><input type="checkbox" checked={f.to.includes(c.email)} onChange={() => toggle(c.email)} />{c.nome}{c.ruolo ? ` (${c.ruolo})` : ''} · {c.email}</label>) : <div className="small muted">Nessun referente con email: aggiungilo in Referenti o scrivi l'indirizzo qui sotto (cliente o punto prelievi).</div>}
          {altriIndirizzi.length > 0 && <><div className="small strong muted" style={{ marginTop: 6 }}>Altri indirizzi dell'anagrafica</div>{altriIndirizzi.map((x) => <label key={x.email} className="f inline"><input type="checkbox" checked={f.to.includes(x.email)} onChange={() => toggle(x.email)} />{x.label} · {x.email}</label>)}</>}
        </div>
        <Field label="Altri destinatari"><input value={f.altri} onChange={(e) => setF({ ...f, altri: e.target.value })} placeholder="indirizzi separati da virgola" /></Field>
        <Field label="Altre copie (oltre a quelle fisse)"><input value={f.cc_extra} onChange={(e) => setF({ ...f, cc_extra: e.target.value })} /></Field>
        <Field label="Oggetto" className="span2"><input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
        <Field label="Testo" className="span2"><textarea style={{ minHeight: 200 }} value={f.testo} onChange={(e) => setF({ ...f, testo: e.target.value })} /></Field>
        <div className="span2 small muted"><Icon name="file" size={14} /> Allegato: {v.filename || `Pacchetto v${v.versione}`}{v.pagine ? ` · ${v.pagine} pagine` : ''}</div>
      </div>
    </Modal>
  );
}

// Impostazioni: modelli della lettera del CEO (per linea) e dell'email, con i segnaposto. Solo l'Admin del modulo salva.
export function PacchettoModelli() {
  const toast = useToast();
  const q = useApi('/hub/pacchetto/modelli');
  const [f, setF] = useState(null);
  const [linea, setLinea] = useState('SRV');
  useEffect(() => { if (q.data) setF({ lettera: { ...q.data.lettera }, email: q.data.email }); }, [q.data]);
  if (!q.data || !f) return null;
  const salva = async (extra = {}) => { try { const r = await api.put('/hub/pacchetto/modelli', extra.ripristina ? { ripristina: true } : { lettera: f.lettera, email: f.email }); toast(r.avvisi?.length ? r.avvisi.join(' · ') : 'Modelli salvati', r.avvisi?.length ? 'err' : 'ok'); q.reload(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <Card title="Pacchetto di benvenuto · modelli dei testi" className="mt" actions={<button className="btn sm ghost" onClick={() => salva({ ripristina: true })}>Ripristina i testi predefiniti</button>}>
      <div id="pacchetto" className="small muted" style={{ marginBottom: 10 }}>Segnaposto: {'{{cliente}}'}, {'{{referente}}'}, {'{{data}}'}, {'{{owner}}'}; nella lettera {'{{referenti}}'} su una riga da sola inserisce il blocco dei contatti (dallo specchio del Portale Service e dai Dati aziendali). Una riga vuota separa i paragrafi. La firma (Francesco Epifani, Chief Executive Officer) la aggiunge il pacchetto. Oggetto dell'email: "{q.data.oggetto}".</div>
      <div className="tabs" style={{ marginBottom: 8 }}>{['SRV', 'PP', 'MDL'].map((l) => <button key={l} className={linea === l ? 'on' : ''} onClick={() => setLinea(l)}>Lettera · {LINEE[l].label}</button>)}</div>
      <textarea style={{ minHeight: 320, width: '100%' }} value={f.lettera[linea]} onChange={(e) => setF({ ...f, lettera: { ...f.lettera, [linea]: e.target.value } })} />
      <Field label="Email di accompagnamento" className="mt"><textarea style={{ minHeight: 160 }} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <div className="row end" style={{ marginTop: 10 }}><button className="btn" onClick={() => salva()}>Salva i modelli</button></div>
    </Card>
  );
}

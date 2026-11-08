// Business Hub · scheda "Punto prelievi" dell'account della linea Punti Prelievo (richiesta del CEO del 06/11/2026). Anagrafica del punto
// (flagship o corner dalla sede TD collegata, tipo previsto finché la sede non c'è, partner ospitante, referente, date di avvio, fascicolo di
// autorizzazione, contratto PP o locazione della sede), invio del contratto al partner da network@ con l'anteprima (stessa meccanica del kit
// di proposta: components/Proposta.jsx), collegamento alla form del partner, allegati arrivati da verificare, contratto firmato caricato a
// mano ("ricevuto per altri canali"), "Avvia il punto prelievi" per il flagship e passi dell'avvio con l'esito e "Riprova".
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, API_BASE, BASE } from '../api.js';
import { useApi, Card, Field, ErrorBox, Loading, Badge, Modal, Icon, Empty, UploadButton, useToast } from './ui.jsx';
import { AnteprimaKit, DaVerificare } from './Proposta.jsx';
import { eur, itDate, itDateTime, bytes, EMAIL_STATO, DOSSIER_STATUS, STATUS, TIPO_PUNTO, STATO_PASSO, today } from '../format.js';

const docUrl = (id) => `${API_BASE}/hub/documenti/${id}`;

export default function PuntoPrelievi({ a, onChange, vaiA }) {
  const toast = useToast();
  const q = useApi(`/hub/accounts/${a.id}/punto`);
  const [busy, setBusy] = useState('');
  const [kit, setKit] = useState(null);
  const [ana, setAna] = useState(null);
  const [contatto, setContatto] = useState('');
  const [dataAvvio, setDataAvvio] = useState('');
  const d = q.data;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!d) return <Loading />;
  const edit = d.puo_modificare;
  const ricarica = () => { q.reload(); onChange?.(); };
  const run = async (k, fn, msg) => { setBusy(k); try { const r = await fn(); if (msg) toast(typeof msg === 'function' ? msg(r) : msg); ricarica(); return r; } catch (e) { toast(e.message, 'err'); return null; } finally { setBusy(''); } };
  const tipo = d.tipo?.tipo;
  const avviato = Boolean(d.avvio.avviato_at);
  const prepara = async () => {
    const r = await run('prepara', () => api.post(`/hub/accounts/${a.id}/contratto-partner/prepara`, { contatto_id: contatto ? Number(contatto) : null }));
    if (r) setKit({ ...r, oggettoEdit: r.oggetto, testoEdit: r.testo, altri: '' });
  };
  const caricaFirmato = (files) => {
    const fd = new FormData(); fd.append('file', files[0]);
    return run('firmato', () => api.post(`/hub/accounts/${a.id}/contratto-firmato`, fd), (r) => (r.gia ? 'PDF aggiunto: il contratto firmato era già stato ricevuto' : `Contratto firmato registrato: avvio del punto prelievi, ${r.avvio?.fatti ?? 0} passi su ${r.avvio?.previsti ?? 0} fatti`));
  };
  const riprova = (passi) => run('riprova', () => api.post(`/hub/accounts/${a.id}/avvio/riprova`, passi ? { passi } : {}), (r) => `Passi eseguiti: ${r.eseguiti.map((x) => `${x.key.toLowerCase()} ${STATO_PASSO[x.stato]?.label}`).join(', ') || 'nessuno'}`);
  const daRiprovare = d.avvio.piano.filter((p) => avviato && ['FALLITO', 'DA_FARE'].includes(p.stato));
  return (
    <>
      {d.tipo?.avvisi?.length > 0 && <div className="alert warn small" style={{ marginBottom: 12 }}>{d.tipo.avvisi.map((x, i) => <div key={i}>{x}</div>)}</div>}
      <DaVerificare righe={d.da_verificare} edit={edit} busy={busy} run={run} chi="dal partner" okMsg="Contratto firmato registrato: avvio del punto prelievi" />

      <div className="grid g2">
        <Card title="Anagrafica del punto prelievi" actions={edit && <button className="btn sm ghost" onClick={() => setAna({ pp_site_id: a.pp_site_id || '', pp_nome: a.pp_nome || '', pp_tipo_previsto: a.pp_tipo_previsto || '', data_avvio_prevista: d.date.prevista ? String(d.date.prevista).slice(0, 10) : '', data_avvio_effettiva: d.date.effettiva ? String(d.date.effettiva).slice(0, 10) : '' })}><Icon name="edit" />Modifica</button>}>
          <table className="t"><tbody>
            <tr><td className="muted">Tipo</td><td>{tipo ? <><Badge tone={TIPO_PUNTO[tipo].tone}>{TIPO_PUNTO[tipo].label}</Badge> <span className="small muted">{d.tipo.fonte === 'sede' ? 'dalla sede' : 'previsto, da confermare con la sede'}</span><div className="small muted">{TIPO_PUNTO[tipo].long}</div></> : <span className="red">da definire</span>}</td></tr>
            <tr><td className="muted">Sede TD</td><td>{d.sede ? <><span className="strong">{d.sede.name}</span> <span className="small muted mono">{d.sede.code}</span><div className="small muted">{d.indirizzo}{d.sede.opening_hours ? ` · ${d.sede.opening_hours}` : ''}</div></> : <span className="muted">non ancora in anagrafica{a.pp_nome ? ` (nome: ${a.pp_nome})` : ''}</span>}</td></tr>
            {tipo === 'CORNER' && <tr><td className="muted">Partner ospitante</td><td>{d.partner?.name || a.org_name}</td></tr>}
            <tr><td className="muted">Referente del partner</td><td>{d.referente ? <>{d.referente.nome}<div className="small muted">{[d.referente.ruolo, d.referente.email, d.referente.telefono].filter(Boolean).join(' · ')}</div></> : <button className="btn sm ghost" onClick={() => vaiA('referenti')}>Aggiungi il referente</button>}</td></tr>
            <tr><td className="muted">Avvio previsto</td><td>{d.date.prevista ? itDate(d.date.prevista) : '–'}</td></tr>
            <tr><td className="muted">Avvio effettivo</td><td>{d.date.effettiva ? <span className="strong">{itDate(d.date.effettiva)}</span> : <span className="muted">da definire (l'annuncio al laboratorio parte quando la imposti)</span>}</td></tr>
            <tr><td className="muted">Autorizzazione</td><td>{d.fascicolo ? <Link to={`${BASE}/fascicoli/${d.fascicolo.id}`}><Badge tone={DOSSIER_STATUS[d.fascicolo.status]?.tone}>{DOSSIER_STATUS[d.fascicolo.status]?.label}</Badge>{d.fascicolo.authorized_at ? ` il ${itDate(d.fascicolo.authorized_at)}` : ''}</Link> : <span className="muted">nessun fascicolo{tipo === 'CORNER' ? ' (nasce con il contratto PP)' : ''}</span>}</td></tr>
            <tr><td className="muted">{tipo === 'FLAGSHIP' ? 'Locazione della sede' : 'Contratto PP'}</td><td>{tipo === 'FLAGSHIP'
              ? d.locazione?.tenure === 'LOCAZIONE' ? <><Link to={`${BASE}/sedi`}>{d.locazione.rent_amount != null ? `canone ${eur(d.locazione.rent_amount)} ${String(d.locazione.rent_period || 'MESE').toLowerCase()}` : 'canone non indicato'}{d.locazione.landlord_name ? ` · ${d.locazione.landlord_name}` : ''}</Link>{d.locazione.avvisi?.length > 0 && <div className="small amber">{d.locazione.avvisi.join('; ')}</div>}</>
                : <span className="muted">{d.locazione ? `sede ${String(d.locazione.tenure || '').toLowerCase()} (Amministrazione > Sedi)` : 'sede non collegata'}</span>
              : d.contratto ? <Link to={`${BASE}/contratti/${d.contratto.id}`}>{d.contratto.protocol || `bozza #${d.contratto.id}`} <Badge tone={STATUS[d.contratto.status]?.tone}>{STATUS[d.contratto.status]?.label}</Badge></Link> : <span className="muted">nessuno: <Link to={`${BASE}/contratti/nuovo/PP`}>nuova proposta</Link></span>}</td></tr>
          </tbody></table>
          <div className="row" style={{ marginTop: 10, gap: 6, flexWrap: 'wrap' }}>
            {d.fascicolo ? <Link className="btn sm ghost" to={`${BASE}/fascicoli/${d.fascicolo.id}`}><Icon name="folder" />Fascicolo di autorizzazione</Link> : <Link className="btn sm ghost" to={`${BASE}/fascicoli`}><Icon name="folder" />Fascicoli autorizzazione</Link>}
            <a className="btn sm ghost" href="/admin/sites"><Icon name="building" />Scheda Sede in Amministrazione</a>
          </div>
        </Card>

        <div>
          {tipo === 'CORNER' && d.contrattualizzato_at && <Card title="Contratto al partner da network@" actions={<Badge tone="green">firmato</Badge>}>
            <div className="alert info small">Contratto firmato ricevuto il {itDateTime(d.contrattualizzato_at)}{d.contrattualizzazione?.fonte ? ` (${d.contrattualizzazione.fonte})` : ''}: contratto {d.contratto?.protocol || ''} firmato, pipeline alla fase 6, avvio del punto prelievi qui sotto. La fase 7 la conferma il CEO.</div>
            {d.contrattualizzazione?.avvisi?.length > 0 && <div className="alert warn small" style={{ marginTop: 8 }}>{d.contrattualizzazione.avvisi.map((x, i) => <div key={i}>{x}</div>)}</div>}
            {edit && <div className="row" style={{ marginTop: 8 }}><button className="btn sm ghost" disabled={Boolean(busy)} onClick={() => run('attiva', () => api.post(`/hub/accounts/${a.id}/attiva-accessi`, {}), (r) => `Profilo Partner ospitante su ${r.accessi} accessi`)}>Riapplica il profilo Partner ospitante</button><span className="small muted">Dopo un nuovo accesso esterno della Legal entity.</span></div>}
          </Card>}
          {tipo === 'CORNER' && !d.contrattualizzato_at && <Card title="Contratto al partner da network@" actions={d.prerequisiti.pronto ? <Badge tone="green">pronto</Badge> : <Badge tone="red">prerequisiti mancanti</Badge>}>
            <ul className="checklist-pr">{d.prerequisiti.voci.map((v) => <li key={v.key} className={v.ok ? 'ok' : 'ko'}><span className="ico">{v.ok ? '✓' : '✗'}</span><div style={{ flex: 1 }}><div className="strong">{v.label}</div><div className="small muted">{v.dettaglio}</div></div>{!v.ok && v.key === 'referente' && <button className="btn sm ghost" onClick={() => vaiA('referenti')}>Vai</button>}{!v.ok && v.key === 'contratto' && <button className="btn sm ghost" onClick={() => vaiA('contratto')}>Vai</button>}</li>)}</ul>
            {d.gia_inviato && <div className="alert warn small" style={{ marginTop: 8 }}>Questo contratto è già stato inviato il {itDateTime(d.gia_inviato.inviato_at)}{d.gia_inviato.inviato_a ? ` a ${d.gia_inviato.inviato_a}` : ''}: un nuovo invio chiede conferma.</div>}
            {edit && <div className="form-grid" style={{ marginTop: 10 }}><Field label="Referente destinatario"><select value={contatto} onChange={(e) => setContatto(e.target.value)}><option value="">{d.referente ? `${d.referente.nome} (principale)` : 'Nessun referente con email'}</option>{a.contatti.filter((x) => x.email && x.id !== d.referente?.id).map((x) => <option key={x.id} value={x.id}>{x.nome} · {x.email}</option>)}</select></Field></div>}
            {edit && <div className="row" style={{ marginTop: 10 }}><button className="btn" disabled={!d.prerequisiti.pronto || Boolean(busy) || Boolean(d.contrattualizzato_at)} onClick={prepara}><Icon name="mail" />{busy === 'prepara' ? 'Preparo…' : 'Invia il contratto al partner da network@'}</button></div>}
            <div className="small muted" style={{ marginTop: 8 }}>Da {d.casella} con le copie fisse ({d.cc_fissi.join(', ')}): il PDF del contratto, il riferimento {d.form.rif || '[TD-B2B-…]'} nell'oggetto per l'ascolto della risposta e il collegamento alla form del partner (dati del referente e caricamento del contratto firmato). Anteprima prima dell'invio; pipeline alla fase 4.</div>
          </Card>}
          {tipo === 'FLAGSHIP' && <Card title="Avvio del punto prelievi flagship">
            <div className="small" style={{ marginBottom: 8 }}>Il flagship non ha un contratto con un partner: vale la locazione della sede. Con "Avvia il punto prelievi" partono l'annuncio al laboratorio, il primo ordine standard, la dotazione, il fondo cassa e POS, i rifiuti speciali; la pipeline va alla fase 6 (la 7 la conferma il CEO).</div>
            {!avviato && d.locazione?.avvisi?.length > 0 && <div className="alert warn small" style={{ marginBottom: 8 }}>{d.locazione.avvisi.join('; ')}: l'avvio non è bloccato (decisione del CEO), completa i dati in Amministrazione &gt; Sedi.</div>}
            {d.fascicolo?.status === 'AUTORIZZATO' && !avviato && <div className="alert info small" style={{ marginBottom: 8 }}>Autorizzazione sanitaria rilasciata{d.fascicolo.authorized_at ? ` il ${itDate(d.fascicolo.authorized_at)}` : ''}: il punto prelievi si può avviare.</div>}
            {avviato ? <div className="small">Avviato il {itDateTime(d.avvio.avviato_at)}{d.date.effettiva ? `, avvio effettivo ${itDate(d.date.effettiva)}` : ''}.</div>
              : edit && <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <Field label="Data di avvio effettiva (obbligatoria)"><input type="date" value={dataAvvio} onChange={(e) => setDataAvvio(e.target.value)} /></Field>
                <button className="btn" disabled={!dataAvvio || Boolean(busy)} onClick={() => run('avvia', () => api.post(`/hub/accounts/${a.id}/avvio`, { data: dataAvvio }), (r) => `Punto prelievi avviato: ${r.riepilogo.fatti} passi su ${r.riepilogo.previsti} fatti`)}><Icon name="check" />{busy === 'avvia' ? 'Avvio…' : 'Avvia il punto prelievi'}</button>
              </div>}
          </Card>}
          {!tipo && <Card title="Tipo del punto prelievi"><Empty>Collega la sede TD (Modifica) o indica il tipo previsto: flagship (sede TD in locazione o di proprietà) o corner (sede del partner).</Empty></Card>}
          {tipo === 'CORNER' && <Card title="Form online del partner" className="mt">
            {d.form.link ? <>
              <code className="small" style={{ wordBreak: 'break-all' }}>{d.form.link}</code>
              <div className="small" style={{ marginTop: 6 }}>{d.form.valido ? <Badge tone="green">valido fino al {itDate(d.form.scade)}</Badge> : <Badge tone="red">{d.form.motivo}</Badge>} · riferimento <span className="mono">{d.form.rif}</span></div>
              <div className="row" style={{ marginTop: 8, gap: 6 }}>
                <button className="btn sm ghost" onClick={() => { navigator.clipboard?.writeText(d.form.link); toast('Collegamento copiato'); }}><Icon name="link" />Copia</button>
                <a className="btn sm ghost" href={d.form.link} target="_blank" rel="noreferrer"><Icon name="eye" />Apri</a>
                {edit && <button className="btn sm ghost" onClick={() => run('link', () => api.post(`/hub/accounts/${a.id}/b2b-link`, { azione: 'rinnova' }), `Collegamento rinnovato per ${d.form.giorni} giorni`)}>Rinnova</button>}
              </div>
            </> : <div className="small muted">Il collegamento nasce con l'invio del contratto (valido {d.form.giorni} giorni).</div>}
            <div className="small muted" style={{ marginTop: 8 }}>Senza login: il partner verifica i dati del referente e carica il contratto firmato in PDF; con il contratto parte l'avvio del punto prelievi.</div>
          </Card>}
        </div>
      </div>

      {tipo !== 'FLAGSHIP' && <Card title="Contratto firmato nel fascicolo del punto prelievi" className="mt" flush actions={edit && tipo === 'CORNER' && <UploadButton label={busy === 'firmato' ? 'Carico…' : 'Carica il PDF firmato (ricevuto per altri canali)'} accept="application/pdf,.pdf" disabled={Boolean(busy)} onFiles={caricaFirmato} />}>
        {d.documenti_contratto.length ? <table className="t"><tbody>{d.documenti_contratto.map((x) => <tr key={x.id}><td><a href={docUrl(x.id)}><Icon name="download" />{x.filename}</a><div className="small muted">{x.etichetta || ''} · {bytes(x.size)} · {itDateTime(x.created_at)}</div></td></tr>)}</tbody></table>
          : <Empty>Nessun contratto firmato: arriva dalla form del partner, dalla risposta a network@ (un clic su "È il contratto firmato") o dal caricamento qui sopra</Empty>}
        {d.contrattualizzazione?.fascicolo?.esito && <div className="small muted" style={{ padding: '6px 14px' }}>Fascicolo di autorizzazione: {d.contrattualizzazione.fascicolo.esito}.</div>}
      </Card>}

      <Card title="Avvio del punto prelievi" className="mt" flush
        actions={<>{d.avvio.riepilogo && avviato && <Badge tone={d.avvio.riepilogo.completo ? 'green' : 'mauve'}>{d.avvio.riepilogo.fatti} di {d.avvio.riepilogo.previsti} fatti</Badge>}{' '}{edit && daRiprovare.length > 0 && <button className="btn sm" disabled={Boolean(busy)} onClick={() => riprova(null)}><Icon name="arrow" />{busy === 'riprova' ? 'Riprovo…' : 'Riprova i passi da completare'}</button>}</>}>
        <table className="t"><thead><tr><th style={{ width: 28 }} /><th>Passo</th><th>Stato</th><th>Esito</th><th>Quando</th><th /></tr></thead><tbody>
          {d.avvio.piano.map((p) => <tr key={p.key}>
            <td className="mono muted" style={{ whiteSpace: 'nowrap', width: 36 }}>{p.lettera})</td>
            <td><div className="strong">{p.label}</div>{p.to?.length ? <div className="small muted">a {p.to.join(', ')}{p.cc?.length ? ` · cc ${p.cc.join(', ')}` : ''}</div> : <div className="small muted">{destinatariPasso(p.key, d.dest)}</div>}</td>
            <td><Badge tone={STATO_PASSO[p.stato]?.tone || 'grey'}>{avviato || p.stato === 'NON_PREVISTO' ? STATO_PASSO[p.stato]?.label || p.stato : 'non ancora avviato'}</Badge>{p.email_stato ? <div className="small muted">{EMAIL_STATO[p.email_stato]?.label}</div> : null}</td>
            <td className="small">{p.errore ? <span className="red">{p.errore}</span> : p.esito || p.motivo || '–'}{p.dati?.order_id ? <div><a href={`/orders/ordini/${p.dati.order_id}`} className="small">Apri in Ordini: {p.dati.number}</a></div> : null}</td>
            <td className="small muted">{p.at ? itDateTime(p.at) : '–'}{p.tentativi > 1 ? <div>{p.tentativi} tentativi</div> : null}</td>
            <td style={{ width: 1 }}>{edit && avviato && ['FALLITO', 'DA_FARE'].includes(p.stato) && <button className="btn sm ghost" disabled={Boolean(busy)} onClick={() => riprova([p.key])}>Riprova</button>}</td>
          </tr>)}
        </tbody></table>
        <div className="small muted" style={{ padding: '8px 14px' }}>
          {tipo === 'CORNER' ? 'Parte da solo quando arriva il contratto firmato (form del partner, risposta a network@ confermata, caricamento manuale).' : tipo === 'FLAGSHIP' ? 'Parte con "Avvia il punto prelievi".' : ''} Ogni passo è nel diario con l'esito; un passo riuscito non si ripete. L'annuncio al laboratorio aspetta la data di avvio effettiva, il primo ordine la sede TD collegata: partono da soli quando ci sono. Email da {d.casella} con le copie fisse; destinatari e testi in Impostazioni.
        </div>
      </Card>

      {d.kit.length > 0 && <Card title="Registro degli invii del contratto al partner" className="mt" flush>
        <table className="t"><thead><tr><th>Preparato</th><th>Allegati</th><th>Stato</th><th>Invio</th></tr></thead><tbody>
          {d.kit.map((k) => <tr key={k.id}>
            <td className="small">{itDateTime(k.preparato_at)}<div className="muted">{k.preparato_da || ''}</div></td>
            <td className="small">{(k.allegati || []).map((x) => x.filename).join(', ')}</td>
            <td><Badge tone={k.stato === 'INVIATO' ? 'green' : k.stato === 'FALLITO' ? 'red' : k.stato === 'ANNULLATO' ? 'grey' : 'blue'}>{k.stato.toLowerCase()}</Badge></td>
            <td className="small">{k.inviato_at ? <>{itDateTime(k.inviato_at)} · {EMAIL_STATO[k.inviato_stato]?.label || k.inviato_stato}<div className="muted">a {k.inviato_a}{k.inviato_cc ? ` · cc ${k.inviato_cc}` : ''}</div></>
              : k.stato === 'PREPARATO' && edit ? <><button className="btn sm ghost" onClick={async () => { const r = await api.get(`/hub/kit/${k.id}`); setKit({ id: k.id, from: d.casella, to: r.destinatari, cc: d.cc_fissi.filter((x) => !r.destinatari.includes(x)), oggetto: r.oggetto, testo: r.testo, allegati: r.allegati, avvisi: r.avvisi || [], oggettoEdit: r.oggetto, testoEdit: r.testo, altri: '', gia_inviato: d.gia_inviato ? { at: d.gia_inviato.inviato_at } : null, link: d.form.link }); }}>Anteprima e invio</button> <button className="btn sm ghost" onClick={() => run('ann', () => api.post(`/hub/kit/${k.id}/annulla`, {}), 'Invio annullato')}>Annulla</button></> : '–'}</td>
          </tr>)}
        </tbody></table>
      </Card>}

      {kit && <AnteprimaKit partner kit={kit} setKit={setKit} onClose={() => setKit(null)} onDone={() => { setKit(null); ricarica(); }} />}
      {ana && <Modal title="Anagrafica del punto prelievi" onClose={() => setAna(null)} footer={<><button className="btn ghost" onClick={() => setAna(null)}>Annulla</button><button className="btn" onClick={async () => { const r = await run('ana', () => api.put(`/hub/accounts/${a.id}/punto`, { ...ana, pp_site_id: ana.pp_site_id ? Number(ana.pp_site_id) : null }), (x) => (x.ripresa?.eseguiti?.length ? `Salvato: eseguiti ${x.ripresa.eseguiti.map((y) => y.key.toLowerCase()).join(', ')}` : 'Anagrafica salvata')); if (r) setAna(null); }}>Salva</button></>}>
        <div className="form-grid">
          <Field label="Sede TD (Punto prelievi)" className="span2" help="Il tipo flagship o corner si deriva dalla sede: titolo di godimento e Legal entity ospitante (Amministrazione > Sedi)">
            <select value={ana.pp_site_id} onChange={(e) => setAna({ ...ana, pp_site_id: e.target.value })}><option value="">Non ancora in anagrafica</option>
              {d.sede && <option value={d.sede.id}>{d.sede.name} ({d.sede.code})</option>}
              {d.sedi_candidate.filter((s) => s.id !== d.sede?.id).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code}) · {s.tenure === 'OSPITATA' ? `corner, ospitata da ${s.host_name || '–'}` : 'flagship'}</option>)}</select>
          </Field>
          <Field label="Nome del punto (finché la sede non c'è)"><input value={ana.pp_nome} onChange={(e) => setAna({ ...ana, pp_nome: e.target.value })} /></Field>
          <Field label="Tipo previsto (senza sede)"><select value={ana.pp_tipo_previsto} onChange={(e) => setAna({ ...ana, pp_tipo_previsto: e.target.value })}><option value="">–</option><option value="CORNER">Corner (sede del partner)</option><option value="FLAGSHIP">Flagship (sede TD)</option></select></Field>
          <Field label="Data di avvio prevista"><input type="date" value={ana.data_avvio_prevista} onChange={(e) => setAna({ ...ana, data_avvio_prevista: e.target.value })} /></Field>
          <Field label="Data di avvio effettiva" help={avviato ? 'Se l\'annuncio al laboratorio aspetta la data, parte al salvataggio' : ''}><input type="date" value={ana.data_avvio_effettiva} max={undefined} onChange={(e) => setAna({ ...ana, data_avvio_effettiva: e.target.value })} /></Field>
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>Collegare la sede fa partire il primo ordine se aspettava la sede e allinea le royalties visibili al partner in Cash. Oggi: {itDate(today())}.</div>
      </Modal>}
    </>
  );
}

function destinatariPasso(key, dest = {}) {
  const k = { CONFERMA: 'conferma', AVVIO_LAB: 'avvio', DOTAZIONE: 'dotazione', FONDO_CASSA: 'amministrazione', RIFIUTI: 'rifiuti' }[key];
  if (key === 'CREDENZIALI') return 'referente del partner (invito senza copie, benvenuto con le copie fisse)';
  if (key === 'PRIMO_ORDINE') return 'Ordini: bozza per l\'Area Operations, quantità 1 per articolo destinato ai Punti Prelievo';
  return k ? `a ${(dest[k] || []).join(', ') || 'nessuno (Impostazioni)'}` : '';
}

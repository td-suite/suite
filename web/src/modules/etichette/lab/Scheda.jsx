// Lab Control · Scheda dell'accettazione: testata (cliente con il Business Hub e gli altri collegamenti, sede, tipo paziente, medicina del
// lavoro, paziente solo se identità recente), linea del tempo delle fasi con date e durate, COSA È STATO RICHIESTO (esami con stato, date e
// prezzi; campioni con il legame esame ↔ campione), totali; pulsanti Etichetta (sezione Label, su questa accettazione), Fattura (se ci sono
// documenti collegati: dalla copia Synclab, il PDF resta in StudioLab), Non conformità (modulo NC LIVE) e "Aggiorna dal gestionale".
import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Card, ErrorBox, PageHead, Skeleton, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { api, useApi, base } from '../api.js';
import { CopiaInfo, LineaTempo, ClienteLink, Voci, gg, ora, dataOra, eur, num, durata, aggiornata } from './comuni.jsx';
import Documento from './Documento.jsx';

const TONO = { NON_ESEGUITO: 'amber', PRONTO: 'green', VALIDATO: 'teal', ESEGUITO: 'blue', DA_ESEGUIRE: 'grey', CANCELLATO: 'grey' };

export default function Scheda() {
  const { inst, id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const q = useApi(`/lab/accettazioni/${encodeURIComponent(inst)}/${encodeURIComponent(id)}`, [inst, id]);
  const [doc, setDoc] = useState(null);
  const [aggiorno, setAggiorno] = useState(false);
  const [mostraCanc, setMostraCanc] = useState(false);
  const d = q.data;
  const aggiorna = async () => {
    setAggiorno(true);
    try {
      const r = await api.post(`/lab/accettazioni/${encodeURIComponent(inst)}/${encodeURIComponent(id)}/aggiorna`);
      toast(r.esito === 'LETTA' ? 'Accettazione riletta dal gestionale' : r.messaggio || r.esito, r.esito === 'LETTA' ? 'ok' : 'err');
      if (r.esito === 'LETTA') q.reload();
    } catch (e) { toast(e, 'err'); } finally { setAggiorno(false); }
  };
  if (!d) return <div className="page lc-page"><PageHead title={`Accettazione`} icon="list" crumb={<Link to={`${base}/accettazioni`}>← Accettazioni</Link>} /><ErrorBox error={q.error} />{!q.error && <Skeleton lines={10} />}</div>;
  const a = d.accettazione;
  const righe = d.righe.filter((r) => mostraCanc || !r.cancellata);
  const canc = d.righe.filter((r) => r.cancellata).length;
  const t = d.totali;
  const fatture = d.fatture.filter((f) => f.nella_copia || f.numero);
  const oggi = d.oggi;
  const nc = d.nc || [];
  return (
    <div className="page lc-page lc-scheda">
      <PageHead crumb={<Link to={`${base}/accettazioni`}>← Accettazioni</Link>}
        title={<>Accettazione {a.numero}{d.fase.key === 'NC' ? <Badge tone="red">NC mai arrivato</Badge> : <Badge tone={d.fase.key === 'CHIUSO' ? 'grey' : d.fase.key === 'REFERTO' ? 'green' : 'blue'}>{d.fase.label}</Badge>}{d.ritardo.in_ritardo && <Badge tone="red" title={d.ritardo.motivo}>in ritardo</Badge>}</>}
        sub={`${gg(a.data)} ${ora(a.creata_il)} · stato ${a.stato} (${d.fase.stato_label || ''})${d.fonte === 'GESTIONALE' ? ` · letta dal gestionale ${aggiornata(d.letto_il) || ''}` : ''}`}
        actions={<div className="lc-pulsanti" data-testid="lc-pulsanti">
          <button type="button" className="btn" onClick={() => nav(`${base}/label?acc=${encodeURIComponent(`${a.instance_id}|${a.id}`)}`)} title="Anteprima e stampa Zebra delle etichette di questa accettazione"><Icon name="printer" />Etichetta</button>
          {fatture.length > 0 && <button type="button" className="btn" data-testid="lc-btn-fattura" onClick={() => setDoc(fatture[0])} title="Documento economico dalla copia Synclab (il PDF resta in StudioLab)"><Icon name="doc" />Fattura{fatture.length > 1 ? ` (${fatture.length})` : ''}</button>}
          {d.nc_disponibile && a.numero && <Link className="btn ghost" to={`/nc/desk/${encodeURIComponent(a.numero)}`} title="Desk NC con il numero di accettazione"><Icon name="alert" />{nc.length ? `Non conformità (${nc.length})` : 'Apri NC'}</Link>}
          <button type="button" className="btn ghost" onClick={aggiorna} disabled={aggiorno || !d.data_api?.ok} title={d.data_api?.ok ? 'Lettura puntuale di questa accettazione dal gestionale' : d.data_api?.motivo}><Icon name="refresh" />{aggiorno ? 'Leggo…' : 'Aggiorna dal gestionale'}</button>
        </div>} />
      <div className="lc-testa"><CopiaInfo copia={d.copia} extra={d.fonte === 'GESTIONALE' ? `questa scheda: gestionale ${aggiornata(d.letto_il)}` : null} />{d.stampe.ok > 0 && <span className="small muted">Etichette stampate {d.stampe.ok} {d.stampe.ok === 1 ? 'volta' : 'volte'}</span>}</div>

      <Card className="lc-testata-card">
        <div className="lc-testata">
          <div><span>Cliente</span><b><ClienteLink r={{ ...a, link_cliente: d.collegamenti?.cliente?.principale ? { href: d.collegamenti.cliente.principale, titolo: 'Business Hub' } : null }} /></b><em>{a.client_code ? `codice StudioLab ${a.client_code}` : ''}{a.org_name && a.org_name !== a.cliente ? ` · ${a.org_name}` : ''}</em></div>
          <div><span>Sede</span><b>{a.site_id ? <Link to={`${base}/accettazioni?sede=${a.site_id}`}>{a.sede}</Link> : <span className="muted">non abbinata</span>}</b><em>{a.abbinamento === 'DA_ABBINARE' ? 'client da abbinare' : a.abbinamento === 'PROPOSTO' ? 'abbinamento proposto' : ''}</em></div>
          <div><span>Paziente</span><b>{d.paziente ? `${d.paziente.cognome || ''} ${d.paziente.nome || ''}` : <span className="muted">{[a.eta != null ? `${a.eta} anni` : null, a.sesso].filter(Boolean).join(' · ') || 'non disponibile'}</span>}</b><em>{d.paziente ? `nato/a il ${gg(d.paziente.nascita)}${d.paziente.sesso ? ` · ${d.paziente.sesso}` : ''} · identità recente` : 'nome solo per le accettazioni degli ultimi giorni'}</em></div>
          <div><span>Tipo paziente</span><b>{a.tipo_paziente || '–'}</b><em>{a.medicina_lavoro ? 'medicina del lavoro' : ''}</em></div>
          <div><span>Accettazione → referto</span><b>{d.tat_min != null ? durata(d.tat_min) : d.ritardo.ore != null ? `${durata(d.ritardo.ore * 60)} finora` : '–'}</b><em>{d.ritardo.in_ritardo ? d.ritardo.motivo : `soglia ${d.soglia.ore_ritardo} ore`}</em></div>
          <div><span>Ultimo aggiornamento</span><b>{dataOra(a.aggiornata_il, oggi) || '–'}</b><em>{a.referto_il ? `referto ${dataOra(a.referto_il, oggi)}` : ''}</em></div>
        </div>
      </Card>

      <Card title="Avanzamento" icon="clock" className="lc-avanz">
        <LineaTempo fase={d.fase} oggi={oggi} />
        <div className="lc-esami-av">
          <span><b>{num(d.fase.esami.totale)}</b> esami</span><span><b>{num(d.fase.esami.eseguiti)}</b> eseguiti</span><span><b>{num(d.fase.esami.validati)}</b> validati</span>
          <span><b>{num(d.fase.esami.pronti)}</b> referto pronto</span>{d.fase.esami.non_eseguiti > 0 && <span className="warn"><b>{num(d.fase.esami.non_eseguiti)}</b> non eseguiti</span>}
        </div>
      </Card>

      <Card title={`Cosa è stato richiesto: ${num(righe.filter((r) => !r.cancellata).length)} esami`} icon="list" flush
        actions={canc > 0 && <label className="lc-check small"><input type="checkbox" checked={mostraCanc} onChange={(e) => setMostraCanc(e.target.checked)} />Mostra le {canc} righe cancellate</label>}>
        <div className="table-wrap"><table className="t lc-t-esami" data-testid="lc-esami">
          <thead><tr><th>Esame</th><th>Stato</th><th>Eseguito</th><th>Validato</th><th>Campioni</th><th className="num">Lordo</th><th className="num">Sconto</th><th className="num">Netto</th></tr></thead>
          <tbody>{righe.map((r, i) => (
            <tr key={r.id || i} className={r.cancellata ? 'canc' : ''}>
              <td><b className="mono">{r.codice || '–'}</b> <span className="lc-desc">{r.descrizione || ''}</span></td>
              <td data-l="Stato"><Badge tone={TONO[r.stato]}>{r.stato_label}</Badge></td>
              <td className="nowrap small" data-l="Eseguito">{dataOra(r.eseguito_il, oggi) || '–'}</td>
              <td className="nowrap small" data-l="Validato">{dataOra(r.validato_il, oggi) || '–'}</td>
              <td className="small mono" data-l="Campioni">{r.campioni.map((c) => c.barcode || c.id).join(' ') || '–'}</td>
              <td className="num" data-l="Lordo">{eur(r.lordo)}</td>
              <td className="num small" data-l="Sconto">{r.sconto_riga ? `${eur(r.sconto_riga)}${r.sconto_pct ? ` (${num(r.sconto_pct)}%)` : ''}` : '–'}</td>
              <td className="num" data-l="Netto">{eur(r.netto)}</td>
            </tr>
          ))}</tbody>
          <tfoot>
            <tr><td colSpan={5}>Totale righe{t.righe_senza_prezzo ? ` (${t.righe_senza_prezzo} senza prezzo)` : ''}</td><td className="num">{eur(t.lordo)}</td><td className="num">{eur(t.sconti_riga)}</td><td className="num">{eur(t.netto_righe)}</td></tr>
            {t.sconto_testata_pct ? <tr><td colSpan={7}>Sconto di testata {num(t.sconto_testata_pct)}% {t.sconto_testata_applicato ? '(applicato al valore)' : '(non applicato: importi di riga come il report del gestionale)'}</td><td className="num">{eur(t.sconto_testata)}</td></tr> : null}
            <tr className="tot"><td colSpan={7}>Valore (produzione accettata){t.valore_erogata ? '' : ': stato fuori dalla produzione'}</td><td className="num">{eur(t.valore)}</td></tr>
          </tfoot>
        </table></div>
      </Card>

      <Card title={`Campioni: ${num(d.campioni.length)}`} icon="tag" flush>
        {!d.campioni.length ? <div className="lc-pad muted">Nessun campione nell'accettazione.</div> : (
          <div className="table-wrap"><table className="t lc-t-camp" data-testid="lc-campioni">
            <thead><tr><th>Barcode</th><th>Contenitore</th><th>Materiale</th><th>Esami</th><th>Raccolto</th><th>Check-in</th><th>Preparato</th><th>Check-out</th></tr></thead>
            <tbody>{d.campioni.map((c) => (
              <tr key={c.id}><td className="mono"><b>{c.barcode || '–'}</b></td><td data-l="Contenitore">{c.contenitore || '–'}</td><td data-l="Materiale">{c.materiale || '–'}</td><td className="mono small" data-l="Esami">{c.esami.join(' ') || '–'}</td>
                <td className="nowrap small" data-l="Raccolto">{dataOra(c.raccolto_il || c.prelevato_il, oggi) || '–'}</td><td className="nowrap small" data-l="Check-in">{dataOra(c.checkin_il, oggi) || <span className={c.raccolto_il ? 'lc-warn' : ''}>{c.raccolto_il ? 'non arrivato' : '–'}</span>}</td>
                <td className="nowrap small" data-l="Preparato">{dataOra(c.preparato_il, oggi) || '–'}</td><td className="nowrap small" data-l="Check-out">{dataOra(c.checkout_il, oggi) || '–'}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>

      <div className="lc-due">
        <Card title="Documenti economici" icon="doc">
          {!d.fatture.length ? <div className="muted">Nessun documento collegato all'accettazione (non fatturata).</div> : (
            <ul className="lc-lista">{d.fatture.map((f) => <li key={f.id}>
              {f.nella_copia ? <button type="button" className="lc-link" onClick={() => setDoc(f)}>{f.tipo === 'credit_note' ? 'Nota di credito' : 'Fattura'} {f.numero}</button> : <span className="muted">Documento non ancora nella copia</span>}
              <span className="muted small"> {gg(f.data)}{f.totale != null ? ` · ${eur(f.totale)}` : ''}{f.annullato ? ' · annullato' : ''}</span></li>)}</ul>
          )}
          <div className="small muted">Il PDF dei documenti resta in StudioLab: la Data API non lo fornisce.</div>
        </Card>
        <Card title="Non conformità" icon="alert">
          {!d.nc_disponibile ? <div className="muted">Il modulo Non conformità non è attivo.</div> : !nc.length ? <div className="muted">Nessuna NC su questa accettazione.</div> : (
            <ul className="lc-lista">{nc.map((n) => <li key={n.id}><Link to={`/nc/nc/${n.id}`}>{n.codice}</Link> <Badge tone={['CHIUSA', 'VERIFICATA'].includes(n.stato) ? 'grey' : 'red'}>{n.stato.toLowerCase().replace(/_/g, ' ')}</Badge><span className="muted small"> {n.tipo || ''}</span></li>)}</ul>
          )}
          {d.nc_disponibile && a.numero && <Link className="btn sm ghost" to={`/nc/desk/${encodeURIComponent(a.numero)}`}>Apri NC nel Desk</Link>}
        </Card>
      </div>

      <div className="lc-due">
        <Card title="Collegamenti del cliente" icon="external" className="lc-coll"><div className="menu-pop lc-statico"><Voci dati={d.collegamenti?.cliente} titolo={a.cliente} /></div></Card>
        {d.collegamenti?.sede && <Card title="Collegamenti della sede" icon="building" className="lc-coll"><div className="menu-pop lc-statico"><Voci dati={d.collegamenti.sede} titolo={a.sede} /></div></Card>}
      </div>
      {doc && <Documento instanceId={a.instance_id} id={doc.id} onClose={() => setDoc(null)} />}
    </div>
  );
}

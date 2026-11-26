// Impostazioni: destinatari e ora dell'email quotidiana, soglia per la normativa, profilo dell'azienda su cui il modello giudica l'utilità.
import React, { useEffect, useState } from 'react';
import { Card, Loading, Empty, PageHead, Badge, Field, Switch, useToast } from '../../../components/ui.jsx';
import { api, useApi } from '../api.js';

const itData = (d) => { const s = String(d || '').slice(0, 10); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : ''; };
const itDataOra = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

export default function Impostazioni() {
  const d = useApi('/impostazioni'); const toast = useToast(); const [v, setV] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (d.data) setV(d.data.valori); }, [d.data]);
  if (d.error) return <div className="page"><Empty icon="alert" title="Errore">{d.error.message}</Empty></div>;
  if (!d.data || !v) return <div className="page"><Loading /></div>;
  const x = d.data; const ro = !x.modificabili;
  const salva = async (chiavi) => { setBusy(true); try { const r = await api.put('/impostazioni', Object.fromEntries(chiavi.map((k) => [k, v[k]]))); toast(r.cambiate.length ? 'Impostazioni salvate' : 'Nessuna modifica'); await d.reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  const inviaOra = async () => { setBusy(true); try { const r = await api.post('/email/invia', {}); toast(r.inviata ? `Email ${r.esito === 'REGISTRATA' ? 'solo registrata (posta non attiva)' : 'inviata'}: ${r.voci} novità a ${r.destinatari.join(', ')}` : `Email non inviata: ${r.saltata || r.errore}`, r.inviata ? 'ok' : 'err'); await d.reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(false); } };
  return (
    <div className="page">
      <PageHead title="Impostazioni di Public Affairs" icon="gear" sub={ro ? 'Sola lettura: le impostazioni le modifica il profilo Direzione.' : 'Email, soglie e profilo dell\'azienda.'} />
      <div className="grid g2 pa-gap">
        <Card title="Email quotidiana" icon="mail" actions={!ro && <button className="btn sm" disabled={busy} onClick={() => salva(['destinatari', 'ora_invio', 'invio_attivo', 'soglia_normativa'])}>Salva</button>}>
          <label className="row" style={{ gap: 10, marginBottom: 12 }}><Switch disabled={ro} checked={v.invio_attivo} onChange={(c) => setV({ ...v, invio_attivo: c })} label="Invio attivo" /><span className="small">Una email al giorno, solo se ci sono novità.</span></label>
          <div className="form-grid">
            <Field label="Destinatari" className="span2" help={`Indirizzi separati da virgola. Vuoto: il titolare della Suite. Oggi riceve: ${x.destinatari_effettivi.join(', ') || 'nessuno'}.`}><input disabled={ro} value={v.destinatari || ''} onChange={(e) => setV({ ...v, destinatari: e.target.value })} /></Field>
            <Field label="Ora di invio (ora di Roma)" help="Non prima della lettura quotidiana: se è più presto, l'email parte dopo la lettura."><input type="number" min="5" max="22" disabled={ro} value={v.ora_invio} onChange={(e) => setV({ ...v, ora_invio: e.target.value })} /></Field>
            <Field label="Normativa nell'email" help="Avvisi e bandi entrano sempre."><select disabled={ro} value={v.soglia_normativa} onChange={(e) => setV({ ...v, soglia_normativa: e.target.value })}><option value="ALTA">Solo utilità alta</option><option value="MEDIA">Utilità alta e media</option><option value="BASSA">Tutta</option></select></Field>
          </div>
          <p className="small" style={{ marginTop: 10 }}>Posta della Suite: {x.posta.provider === 'graph' ? <Badge tone="green">attiva</Badge> : <Badge tone="red">non attiva su questo server</Badge>} · Modello AI: {x.ai ? <Badge tone="green">attivo</Badge> : <Badge tone="red">non attivo: nessuna sintesi</Badge>}</p>
          {!ro && <button className="btn ghost" disabled={busy} onClick={inviaOra}>Invia ora le novità in attesa</button>}
        </Card>
        <Card title="Lettura delle fonti" icon="clock" actions={!ro && <button className="btn sm" disabled={busy} onClick={() => salva(['ora_lettura', 'max_novita_fonte'])}>Salva</button>}>
          <div className="form-grid">
            <Field label="Ora della lettura quotidiana (ora di Roma)" help="Le fonti si leggono una volta al giorno a quest'ora. L'email parte dopo la lettura."><input type="number" min="5" max="22" disabled={ro} value={v.ora_lettura} onChange={(e) => setV({ ...v, ora_lettura: e.target.value })} /></Field>
            <Field label="Tetto di novità per lettura di una pagina" help="Oltre questo numero la Suite pensa a un cambio di struttura del sito: registra le voci senza avviso e segnala la fonte."><input type="number" min="5" max="200" disabled={ro} value={v.max_novita_fonte} onChange={(e) => setV({ ...v, max_novita_fonte: e.target.value })} /></Field>
          </div>
        </Card>
      </div>
      <Card title="Profilo dell'azienda per il modello AI" icon="edit" className="pa-gap pa-prof" actions={!ro && <div className="row" style={{ gap: 8 }}><button className="btn sm ghost" onClick={() => setV({ ...v, profilo: x.predefinite.profilo })}>Ripristina</button><button className="btn sm" disabled={busy} onClick={() => salva(['profilo'])}>Salva</button></div>}>
        <p className="small muted">È il testo su cui il modello giudica se un atto è utile: che cosa fa l'azienda, che cosa le interessa e che cosa no. Più è preciso, meno rumore arriva nell'email.</p>
        <textarea disabled={ro} value={v.profilo} onChange={(e) => setV({ ...v, profilo: e.target.value })} aria-label="Profilo dell'azienda" />
      </Card>
      <div className="grid g2">
        <Card title="Ultime email" icon="mail" flush>{x.invii.length ? <table className="t"><tbody>{x.invii.map((i) => <tr key={i.giorno}><td className="nowrap">{itData(i.giorno)}</td><td className="small">{i.voci} novità · {i.esito === 'INVIATA' ? 'inviata' : i.esito === 'REGISTRATA' ? 'solo registrata (posta non attiva)' : `non riuscita: ${i.errore}`}<div className="muted">{i.destinatari}</div></td></tr>)}</tbody></table> : <Empty compact icon="mail">Nessuna email inviata</Empty>}</Card>
        <Card title="Registro" icon="shield" flush>{x.registro.length ? <table className="t"><tbody>{x.registro.map((r, i) => <tr key={i}><td className="small nowrap">{itDataOra(r.at)}</td><td className="small">{r.label}<div className="muted">{r.utente}</div></td></tr>)}</tbody></table> : <Empty compact icon="shield">Nessuna operazione</Empty>}</Card>
      </div>
    </div>
  );
}

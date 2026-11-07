// Intorno di un indirizzo valutato (o di una rilevazione qualsiasi aperta per id) e riquadro "Il territorio" del Cruscotto Retail:
// confronto tra le sedi, "Valuta un indirizzo" (indirizzo → geocodifica → conferma → rilevazione) ed elenco degli indirizzi valutati.
// docs/RETAIL_INTORNO.md
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useApi, Card, Loading, ErrorBox, Empty, Field, Badge, useToast, Icon, Modal, ConfirmModal } from '../components/ui.jsx';
import Intorno, { Punteggio, metri } from '../components/Intorno.jsx';
import { useAuth, canWrite, isAdmin } from '../auth.jsx';
import { api, base } from '../api.js';
import { num, itDate } from '../format.js';

export default function IntornoRilevazione() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const d = useApi(`/intorno/rilevazioni/${id}`, [id]);
  const [busy, setBusy] = useState(false);
  const [elimina, setElimina] = useState(false);
  if (d.error) return <div className="page"><ErrorBox error={d.error} /></div>;
  if (!d.data) return <div className="page"><Loading /></div>;
  const r = d.data;
  const rileva = async () => {
    setBusy(true);
    try { const n = await api.post(`/intorno/rilevazioni/${r.id}/rileva`); toast(`Nuova rilevazione: ${n.luoghi.filter((l) => l.presente).length} luoghi`); nav(`${base}/intorno/${n.id}`); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>{r.site_id ? r.site_name : 'Indirizzo valutato'}</h1>
          <div className="sub">{r.site_id ? 'Rilevazione dello storico della sede' : r.etichetta}{r.geocodifica?.precision ? ` · geocodificato ${r.geocodifica.precision === 'civico' ? 'al civico' : r.geocodifica.precision === 'via' ? 'alla via' : 'al comune'}` : ''} · {Number(r.lat).toFixed(5)}, {Number(r.lng).toFixed(5)}</div></div>
        <div className="row">
          <button className="btn ghost" onClick={() => nav(base)}>Cruscotto</button>
          {r.site_id && <Link className="btn ghost" to={`${base}/sedi/${r.site_id}`}>Scheda della sede</Link>}
          {!r.site_id && isAdmin(user) && <button className="btn ghost" onClick={() => setElimina(true)}><Icon name="trash" />Elimina</button>}
        </div>
      </div>
      <Intorno rilevazione={r} storico={r.storico} config={r.config} onApri={(rid) => nav(`${base}/intorno/${rid}`)}
        azioni={canWrite(user) && <button className="btn sm" disabled={busy} onClick={rileva}><Icon name="refresh" />{busy ? 'Rilevo…' : 'Rileva adesso'}</button>} />
      {elimina && <ConfirmModal danger title="Elimina l'indirizzo valutato" text={`Vengono eliminate tutte le rilevazioni di "${r.etichetta}". Le rilevazioni delle sedi non si toccano.`} confirmText="Elimina"
        onClose={() => setElimina(false)} onConfirm={async () => { await api.del(`/intorno/valutazioni/${r.id}`); toast('Indirizzo valutato eliminato'); nav(base); }} />}
    </div>
  );
}

/** Modale "Valuta un indirizzo": indirizzo e raggio → geocodifica → conferma dell'indirizzo trovato → rilevazione */
export function ValutaIndirizzo({ onClose, raggioPredefinito = 3000 }) {
  const nav = useNavigate();
  const [indirizzo, setIndirizzo] = useState('');
  const [raggio, setRaggio] = useState(String(raggioPredefinito));
  const [geo, setGeo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const cerca = async () => { setBusy(true); setErr(null); try { setGeo(await api.post('/intorno/geocodifica', { indirizzo })); } catch (e) { setErr(e); } finally { setBusy(false); } };
  const valuta = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post('/intorno/valuta', { indirizzo, lat: geo.lat, lng: geo.lng, raggio: Number(raggio), geocodifica: { label: geo.label, precision: geo.precision, place_id: geo.place_id } });
      onClose(); nav(`${base}/intorno/${r.id}`);
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <Modal title="Valuta un indirizzo" onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Annulla</button>
      {!geo ? <button className="btn" disabled={busy || indirizzo.trim().length < 4} onClick={cerca}>{busy ? 'Cerco…' : 'Trova l\'indirizzo'}</button>
        : <><button className="btn ghost" disabled={busy} onClick={() => setGeo(null)}>Cambia indirizzo</button><button className="btn" disabled={busy} onClick={valuta}>{busy ? 'Rilevo… (qualche secondo)' : 'Conferma e rileva'}</button></>}
    </>}>
      <ErrorBox error={err} />
      <div className="form-grid">
        <Field label="Indirizzo" className="span2" help="Via, civico e comune: es. Via Roma 10, Prato"><input value={indirizzo} disabled={Boolean(geo)} autoFocus onChange={(e) => setIndirizzo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !geo && indirizzo.trim().length >= 4 && cerca()} /></Field>
        <Field label="Raggio" help="3 km in città, 10 km fuori"><select value={raggio} disabled={busy} onChange={(e) => setRaggio(e.target.value)}>{[1000, 2000, 3000, 5000, 10000].map((m) => <option key={m} value={m}>{metri(m)}</option>)}</select></Field>
      </div>
      {geo && <div className="alert" style={{ marginTop: 12 }}><div>
        <div>Trovato: <b>{geo.label}</b> <Badge tone={geo.precision === 'civico' ? 'green' : geo.precision === 'via' ? 'blue' : 'mauve'}>{geo.precision === 'civico' ? 'al civico' : geo.precision === 'via' ? 'alla via' : 'solo il comune'}</Badge>{geo.prova && <> <Badge tone="grey">geocodifica di prova</Badge></>}</div>
        <div className="small muted">Coordinate {geo.lat.toFixed(6)}, {geo.lng.toFixed(6)}. Se l'indirizzo è giusto conferma: la rilevazione usa una chiamata a Google per categoria attiva (17 con tutte le categorie, il laboratorio di analisi ne usa due) e resta negli "Indirizzi valutati" con il suo storico.</div>
      </div></div>}
    </Modal>
  );
}

/** Riquadro "Il territorio" del Cruscotto: confronto tra le sedi e indirizzi valutati */
export function Territorio() {
  const nav = useNavigate();
  const { user } = useAuth();
  const d = useApi('/intorno/confronto');
  const [valuta, setValuta] = useState(false);
  const sedi = d.data?.sedi || [];
  const val = d.data?.valutazioni || [];
  const n = (r, k) => r.sintesi?.categorie?.[k]?.entro_1000 ?? null;
  return (
    <div style={{ marginTop: 16 }}>
      <Card title="Il territorio" flush actions={<>
        <span className="small muted">luoghi aperti entro 1 km dall'ultima rilevazione (Google Places)</span>
        {canWrite(user) && <button className="btn sm" onClick={() => setValuta(true)}><Icon name="map" />Valuta un indirizzo</button>}
      </>}>
        {d.error ? <ErrorBox error={d.error} /> : !d.data ? <Loading /> : !sedi.length ? <Empty>Nessuna sede attiva nel network</Empty> : <div className="table-wrap"><table className="t">
          <thead><tr><th>Sede</th><th>Rilevazione</th><th className="num">Concorrenti</th><th className="num">Prescrittori</th><th className="num">Attrattori</th><th className="num">Contesto</th><th>Attrattività (componenti)</th><th>Novità</th></tr></thead>
          <tbody>{sedi.map((s) => <tr key={s.site_id} className="click" onClick={() => nav(`${base}/sedi/${s.site_id}`)}>
            <td><div className="strong">{s.name}</div><div className="small muted">{s.city || ''}{s.extraurbana ? ' · extraurbana' : ''}{!s.ha_coordinate ? ' · senza coordinate' : ''}</div></td>
            <td className="small">{s.rilevazione_id ? <>{itDate(s.data)}{s.prova && <> <Badge tone="grey">prova</Badge></>}<div className="muted">raggio {metri(s.raggio_m)}</div></> : <span className="muted">mai rilevata</span>}</td>
            <td className="num strong">{s.rilevazione_id ? num(n(s, 'CONCORRENTE')) : '–'}</td><td className="num">{s.rilevazione_id ? num(n(s, 'PRESCRITTORE')) : '–'}</td>
            <td className="num">{s.rilevazione_id ? num(n(s, 'ATTRATTORE')) : '–'}</td><td className="num">{s.rilevazione_id ? num(n(s, 'CONTESTO')) : '–'}</td>
            <td>{s.punteggio ? <Punteggio p={s.punteggio} compatto /> : <span className="muted">–</span>}</td>
            <td className="small">{s.confronto?.confrontabile ? `+${s.confronto.nuovi} / −${s.confronto.scomparsi}` : '–'}</td>
          </tr>)}</tbody></table></div>}
      </Card>
      {val.length > 0 && <div style={{ marginTop: 16 }}><Card title="Indirizzi valutati" flush>
        <table className="t"><thead><tr><th>Indirizzo</th><th>Ultima rilevazione</th><th className="num">Concorrenti</th><th className="num">Prescr. + attr.</th><th>Attrattività (componenti)</th><th className="num">Rilevazioni</th></tr></thead>
          <tbody>{val.map((v) => <tr key={v.id} className="click" onClick={() => nav(`${base}/intorno/${v.id}`)}>
            <td className="strong">{v.etichetta}{v.prova && <> <Badge tone="grey">prova</Badge></>}</td><td className="small">{itDate(v.data)} · raggio {metri(v.raggio_m)}</td>
            <td className="num strong">{num(n(v, 'CONCORRENTE'))}</td><td className="num">{num((n(v, 'PRESCRITTORE') || 0) + (n(v, 'ATTRATTORE') || 0))}</td>
            <td><Punteggio p={v.punteggio} compatto /></td><td className="num">{num(v.n_rilevazioni)}</td>
          </tr>)}</tbody></table>
      </Card></div>}
      {valuta && <ValutaIndirizzo onClose={() => setValuta(false)} raggioPredefinito={d.data?.config?.raggi?.urbano || 3000} />}
    </div>
  );
}

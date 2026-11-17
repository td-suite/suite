// Sviluppo rete (richiesta del CEO del 17/11/2026, docs/RETAIL_SVILUPPO_RETE.md): tre pagine sugli stessi dati.
//  Posizionamento: ogni sede TD accanto ai concorrenti rilevati da Google intorno; prezzi dei concorrenti inseriti a mano.
//  Valuta un indirizzo: elenco degli indirizzi valutati e, nella scheda di ciascuno, resa attesa dalle sedi simili, B2B e rete.
//  Dove aprire: i comuni della Toscana in classifica, con le componenti del punteggio sempre in vista.
import React, { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useApi, Card, Loading, ErrorBox, Empty, Field, Badge, useToast, Icon, Modal, Kpi } from '../components/ui.jsx';
import { metri } from '../components/Intorno.jsx';
import { ValutaIndirizzo } from './IntornoRilevazione.jsx';
import { useAuth, canWrite, isAdmin } from '../auth.jsx';
import { api, base } from '../api.js';
import { num, itDate, eur, eur0, today, SITE_KIND } from '../format.js';

const voto = (r) => (r == null ? '–' : String(Number(r).toFixed(1)).replace('.', ','));
const km = (n) => (n == null ? '–' : `${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 1 })} km`);
const Stelle = ({ rating, n }) => (rating == null ? <span className="muted">senza voto</span> : <span><b>★ {voto(rating)}</b> <span className="muted small">({num(n)})</span></span>);
const Sabato = ({ v }) => (v == null ? <span className="muted">–</span> : v ? <Badge tone="green">aperto</Badge> : <Badge tone="grey">chiuso</Badge>);

// ------------------------------------------------------------------------------------------------ 1. Posizionamento
function PrezzoModal({ sede, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ place_id: '', concorrente: '', prestazione: '', prezzo: '', prezzo_td: '', rilevato_il: today(), fonte: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const n = (v) => (v === '' ? null : Number(String(v).replace(',', '.')));
  const ok = f.concorrente.trim().length > 1 && f.prestazione.trim().length > 1 && Number.isFinite(n(f.prezzo));
  const salva = async () => {
    setBusy(true);
    try { await api.post('/rete/prezzi', { site_id: sede.site_id, place_id: f.place_id || null, concorrente: f.concorrente.trim(), prestazione: f.prestazione.trim(), prezzo: n(f.prezzo), prezzo_td: n(f.prezzo_td), rilevato_il: f.rilevato_il, fonte: f.fonte.trim() || null }); toast('Prezzo registrato'); onSaved(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Prezzo di un concorrente · ${sede.name}`} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn" disabled={!ok || busy} onClick={salva}>Registra</button></>}>
      <div className="small muted" style={{ marginBottom: 10 }}>Google non pubblica i prezzi: qui si annota quello letto sul sito, al telefono o su un volantino del concorrente, accanto al prezzo TD dello stesso giorno.</div>
      <div className="form-grid">
        <Field label="Concorrente" className="span2"><select value={f.place_id} onChange={(e) => { const l = sede.elenco.find((x) => x.place_id === e.target.value); setF({ ...f, place_id: e.target.value, concorrente: l ? l.nome : f.concorrente }); }}>
          <option value="">Scrivi il nome qui sotto</option>{(sede.elenco || []).map((l) => <option key={l.place_id} value={l.place_id}>{l.nome} · {metri(l.distanza_m)}</option>)}</select></Field>
        <Field label="Nome del concorrente" className="span2"><input value={f.concorrente} onChange={set('concorrente')} /></Field>
        <Field label="Prestazione" className="span2" help="Come la chiamiamo noi: es. Emocromo, Check-up tiroide"><input value={f.prestazione} onChange={set('prestazione')} /></Field>
        <Field label="Prezzo del concorrente (€)"><input inputMode="decimal" value={f.prezzo} onChange={set('prezzo')} /></Field>
        <Field label="Prezzo TD (€)"><input inputMode="decimal" value={f.prezzo_td} onChange={set('prezzo_td')} /></Field>
        <Field label="Rilevato il"><input type="date" value={f.rilevato_il} onChange={set('rilevato_il')} /></Field>
        <Field label="Fonte" help="Sito, telefono, volantino"><input value={f.fonte} onChange={set('fonte')} /></Field>
      </div>
    </Modal>
  );
}

function SedePosizione({ s, scrive, ricarica }) {
  const toast = useToast();
  const [aperta, setAperta] = useState(false);
  const [prezzo, setPrezzo] = useState(false);
  const scegli = async (place_id) => { try { await api.put(`/rete/sedi/${s.site_id}/scheda-google`, { place_id: place_id || null }); toast(place_id ? 'Scheda Google della sede impostata' : 'Scelta annullata'); ricarica(); } catch (e) { toast(e.message, 'err'); } };
  const eliminaPrezzo = async (id) => { try { await api.del(`/rete/prezzi/${id}`); ricarica(); } catch (e) { toast(e.message, 'err'); } };
  const sopra = s.td?.rating != null && s.rating_medio != null ? Math.round((s.td.rating - s.rating_medio) * 10) / 10 : null;
  return (
    <Card title={<span>{s.name} <span className="muted small">{s.city || ''}</span></span>} flush actions={<>
      {s.rilevazione ? <span className="small muted">rilevazione del {itDate(s.rilevazione.data)}{s.rilevazione.prova ? ' · di prova' : ''} · raggio {metri(s.raggio_m)}</span> : null}
      <Link className="btn sm ghost" to={`${base}/b2c/sedi/${s.site_id}`}>Scheda e mappa</Link>
      {s.rilevazione && <button className="btn sm ghost" onClick={() => setAperta(!aperta)}>{aperta ? 'Chiudi' : `Concorrenti (${num(s.concorrenti.nel_raggio)})`}</button>}
    </>}>
      {!s.rilevazione ? <Empty>{s.ha_coordinate ? 'Sede mai rilevata: apri la scheda della sede e premi "Rileva adesso".' : 'Sede senza coordinate: geocodificala dalla scheda della sede.'}</Empty> : <div style={{ padding: 14 }}>
        <div className="grid g4">
          <div><div className="lbl small muted">La nostra scheda Google</div>{s.td ? <div><Stelle rating={s.td.rating} n={s.td.n_recensioni} /><div className="small muted">{s.td.nome}</div></div>
            : <div className="small">Non riconosciuta.{scrive && s.candidate?.length > 0 && <select style={{ marginTop: 4 }} value="" onChange={(e) => e.target.value && scegli(e.target.value)}><option value="">Scegli tra i luoghi entro 150 m</option>{s.candidate.map((c) => <option key={c.place_id} value={c.place_id}>{c.nome} · {metri(c.distanza_m)}</option>)}</select>}
              {(!s.candidate || !s.candidate.length) && <div className="muted">Nessun luogo entro 150 m: la sede non risulta a Google tra laboratori, centri e studi medici.</div>}</div>}
            {s.scheda_scelta && scrive && <button className="btn sm ghost" style={{ marginTop: 4 }} onClick={() => scegli(null)}>Cambia</button>}</div>
          <div><div className="lbl small muted">Posto per voto</div><div className="strong" style={{ fontSize: 20 }}>{s.posto_rating ? `${s.posto_rating}° su ${s.su}` : '–'}</div>
            <div className="small muted">{s.rating_medio != null ? `media concorrenti ★ ${voto(s.rating_medio)}${sopra != null ? ` (noi ${sopra >= 0 ? '+' : ''}${String(sopra).replace('.', ',')})` : ''}` : 'nessun concorrente con almeno 10 recensioni'}</div></div>
          <div><div className="lbl small muted">Posto per recensioni</div><div className="strong" style={{ fontSize: 20 }}>{s.posto_recensioni ? `${s.posto_recensioni}°` : '–'}</div>
            <div className="small muted">{s.recensioni_mediana != null ? `mediana concorrenti ${num(s.recensioni_mediana)}` : ''}{s.piu_recensito ? ` · primo: ${s.piu_recensito.nome} (${num(s.piu_recensito.n_recensioni)})` : ''}</div></div>
          <div><div className="lbl small muted">Concorrenti</div><div className="strong" style={{ fontSize: 20 }}>{num(s.concorrenti.entro_1000)} <span className="small muted">entro 1 km</span></div>
            <div className="small muted">{num(s.concorrenti.entro_500)} entro 500 m · {num(s.concorrenti.nel_raggio)} nel raggio · sabato aperti {num(s.sabato.aperti)} su {num(s.sabato.con_orari)}{s.td ? <> · noi <Sabato v={s.td.sabato} /></> : null}</div></div>
        </div>
        {(s.nuovi.length > 0 || s.scomparsi.length > 0 || s.migliore) && <div className="small" style={{ marginTop: 10 }}>
          {s.migliore && <span>Miglior voto: <b>{s.migliore.nome}</b> ★ {voto(s.migliore.rating)} ({num(s.migliore.n_recensioni)}) a {metri(s.migliore.distanza_m)}. </span>}
          {s.nuovi.length > 0 && <span><Badge tone="red">nuovi</Badge> {s.nuovi.map((x) => `${x.nome} (${metri(x.distanza_m)})`).join(', ')}. </span>}
          {s.scomparsi.length > 0 && <span><Badge tone="green">scomparsi</Badge> {s.scomparsi.map((x) => x.nome).join(', ')}.</span>}
        </div>}
        {aperta && <div className="table-wrap" style={{ marginTop: 12 }}><table className="t"><thead><tr><th>Concorrente</th><th>Tipo</th><th className="num">Distanza</th><th>Voto</th><th>Sabato</th><th></th></tr></thead>
          <tbody>{s.td && <tr style={{ background: 'var(--soft, #eef5f6)' }}><td className="strong">{s.td.nome} <Badge tone="teal">noi</Badge></td><td className="small">Toscana Diagnostica</td><td className="num">–</td><td><Stelle rating={s.td.rating} n={s.td.n_recensioni} /></td><td><Sabato v={s.td.sabato} /></td><td></td></tr>}
            {s.elenco.map((l) => <tr key={l.place_id}><td><div className="strong">{l.nome}{l.novita === 'NUOVO' && <> <Badge tone="red">nuovo</Badge></>}</div><div className="small muted">{l.indirizzo}</div></td>
              <td className="small">{l.sottocategoria.replace(/_/g, ' ')}</td><td className="num">{metri(l.distanza_m)}</td><td><Stelle rating={l.rating} n={l.n_recensioni} /></td><td><Sabato v={l.sabato} /></td>
              <td className="small">{l.sito && /^https?:\/\//.test(l.sito) ? <a href={l.sito} target="_blank" rel="noopener noreferrer">sito</a> : ''}</td></tr>)}</tbody></table></div>}
        <div style={{ marginTop: 12 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}><div className="lbl small muted">Prezzi dei concorrenti (inseriti a mano)</div>{scrive && <button className="btn sm ghost" onClick={() => setPrezzo(true)}><Icon name="plus" />Aggiungi un prezzo</button>}</div>
          {s.prezzi.length === 0 ? <div className="small muted">Nessun prezzo registrato.</div> : <table className="t" style={{ marginTop: 6 }}><thead><tr><th>Prestazione</th><th>Concorrente</th><th className="num">Loro</th><th className="num">Noi</th><th className="num">Differenza</th><th>Rilevato</th><th></th></tr></thead>
            <tbody>{s.prezzi.map((p) => { const d = p.prezzo_td != null ? Number(p.prezzo_td) - Number(p.prezzo) : null; return <tr key={p.id}><td className="strong">{p.prestazione}</td><td>{p.concorrente}</td><td className="num">{eur(p.prezzo)}</td><td className="num">{eur(p.prezzo_td)}</td>
              <td className="num">{d == null ? '–' : <Badge tone={d > 0 ? 'red' : d < 0 ? 'green' : 'grey'}>{d > 0 ? 'noi +' : d < 0 ? 'noi −' : ''}{eur(Math.abs(d))}</Badge>}</td>
              <td className="small">{itDate(p.rilevato_il)}{p.fonte ? ` · ${p.fonte}` : ''}</td><td>{scrive && <button className="btn sm ghost" title="Elimina" onClick={() => eliminaPrezzo(p.id)}><Icon name="trash" /></button>}</td></tr>; })}</tbody></table>}
        </div>
      </div>}
      {prezzo && <PrezzoModal sede={s} onClose={() => setPrezzo(false)} onSaved={() => { setPrezzo(false); ricarica(); }} />}
    </Card>
  );
}

export function Posizionamento() {
  const { user } = useAuth();
  const d = useApi('/rete/posizionamento');
  const sedi = d.data?.sedi || [];
  const ril = sedi.filter((s) => s.rilevazione);
  const conVoto = ril.filter((s) => s.td?.rating != null);
  const media = conVoto.length ? conVoto.reduce((a, s) => a + s.td.rating, 0) / conVoto.length : null;
  const primi = ril.filter((s) => s.posto_rating === 1).length;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Posizionamento</h1><div className="sub">Ogni sede accanto ai concorrenti che Google trova intorno: voto, recensioni, sabato, ingressi e uscite. I dati vengono dalla rilevazione mensile dell'Intorno.</div></div></div>
      {d.error ? <ErrorBox error={d.error} /> : !d.data ? <Loading /> : <>
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <Kpi accent label="Sedi rilevate" value={`${num(ril.length)} su ${num(sedi.length)}`} foot={`${num(sedi.length - ril.length)} da rilevare`} />
          <Kpi label="Voto medio delle nostre schede" value={media == null ? '–' : `★ ${voto(media)}`} foot={`${num(conVoto.length)} schede riconosciute su ${num(ril.length)}`} />
          <Kpi label="Sedi prime per voto nella loro zona" value={num(primi)} foot="tra chi ha almeno 10 recensioni" />
          <Kpi label="Concorrenti nuovi dall'ultima rilevazione" value={num(ril.reduce((a, s) => a + s.nuovi.length, 0))} foot={`${num(ril.reduce((a, s) => a + s.scomparsi.length, 0))} scomparsi`} />
        </div>
        {!sedi.length ? <Card><Empty>Nessuna sede attiva nel network</Empty></Card> : <div style={{ display: 'grid', gap: 16 }}>{sedi.map((s) => <SedePosizione key={s.site_id} s={s} scrive={canWrite(user)} ricarica={d.reload} />)}</div>}
        <div className="small muted" style={{ marginTop: 12 }}>Il posto per voto considera solo chi ha almeno 10 recensioni. Le altre sedi Toscana Diagnostica non sono contate tra i concorrenti. Voti, recensioni e orari sono quelli pubblicati su Google alla data della rilevazione.</div>
      </>}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ 2. Valuta un indirizzo
export function ValutaIndirizzoPagina() {
  const nav = useNavigate();
  const { user } = useAuth();
  const d = useApi('/intorno/confronto');
  const [apri, setApri] = useState(false);
  const val = d.data?.valutazioni || [];
  const n = (r, k) => r.sintesi?.categorie?.[k]?.entro_1000 ?? 0;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Valuta un indirizzo</h1><div className="sub">Scrivi un indirizzo: la Suite rileva cosa c'è intorno (concorrenti, medici, farmacie, centri commerciali, servizi), mette accanto clienti B2B, prospect e sedi TD vicine e dice quanto rendono le sedi TD con l'intorno più simile.</div></div>
        {canWrite(user) && <button className="btn" onClick={() => setApri(true)}><Icon name="map" />Valuta un indirizzo</button>}</div>
      {d.error ? <ErrorBox error={d.error} /> : !d.data ? <Loading /> : <Card title="Indirizzi valutati" flush>
        {!val.length ? <Empty>Nessun indirizzo valutato. Premi "Valuta un indirizzo".</Empty> : <table className="t"><thead><tr><th>Indirizzo</th><th>Ultima rilevazione</th><th className="num">Concorrenti entro 1 km</th><th className="num">Prescrittori</th><th className="num">Attrattori</th><th className="num">Contesto</th><th className="num">Rilevazioni</th></tr></thead>
          <tbody>{val.map((v) => <tr key={v.id} className="click" onClick={() => nav(`${base}/intorno/${v.id}`)}>
            <td className="strong">{v.etichetta}{v.prova && <> <Badge tone="grey">prova</Badge></>}</td><td className="small">{itDate(v.data)} · raggio {metri(v.raggio_m)}</td>
            <td className="num strong">{num(n(v, 'CONCORRENTE'))}</td><td className="num">{num(n(v, 'PRESCRITTORE'))}</td><td className="num">{num(n(v, 'ATTRATTORE'))}</td><td className="num">{num(n(v, 'CONTESTO'))}</td><td className="num">{num(v.n_rilevazioni)}</td>
          </tr>)}</tbody></table>}
      </Card>}
      {apri && <ValutaIndirizzo onClose={() => setApri(false)} raggioPredefinito={d.data?.config?.raggi?.urbano || 3000} />}
    </div>
  );
}

/** Riquadri della valutazione nella scheda di un indirizzo: resa dalle sedi simili, rete, B2B. Restituisce anche i punti per la mappa. */
export function ResaValutazione({ dati }) {
  const v = dati;
  if (!v) return <Loading />;
  const s = v.resa.stima;
  const intervallo = (x, f) => (x.min === x.max ? f(x.min) : `${f(x.min)} – ${f(x.max)}`);
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="grid g3" style={{ marginBottom: 16 }}>
        <div className="card kpi"><div className="lbl">Resa delle sedi TD più simili (al mese)</div>
          {s ? <><div className="val">{intervallo(s.accettazioni_mese, num)} <span className="small muted">accettazioni</span></div><div className="foot">{intervallo(s.ricavi_mese, eur0)} di ricavi B2C · mediana {num(s.accettazioni_mese.mediana)} accettazioni, {eur0(s.ricavi_mese.mediana)}</div></>
            : <div className="foot">Non calcolabile: {num(v.resa.base.sedi_con_vendite)} sedi TD con intorno rilevato e vendite negli ultimi 12 mesi (ne servono almeno 2).</div>}</div>
        <Kpi label="Sede TD più vicina" value={v.rete.piu_vicina ? km(v.rete.piu_vicina.km) : '–'} foot={v.rete.piu_vicina ? `${v.rete.piu_vicina.name}${v.rete.entro_5_km.length > 1 ? ` · ${num(v.rete.entro_5_km.length)} sedi TD entro 5 km` : v.rete.piu_vicina.km < 3 ? ' · sotto 3 km: rischio di togliere pazienti a una nostra sede' : ''}` : 'nessuna sede con coordinate'} />
        <Kpi label="B2B nel raggio o nel comune" value={`${num(v.b2b.clienti.length)} clienti · ${num(v.b2b.prospect_totale)} prospect`} foot={v.comune ? `${v.comune.nome} (${v.comune.provincia}): ${num(v.comune.popolazione)} residenti (${v.comune.popolazione_anno})` : ''} />
      </div>
      <div style={{ display: 'grid', gap: 16 }}>
        <Card title="Su quali sedi poggia la stima" flush>
          {!v.resa.simili.length ? <Empty>Nessuna sede TD confrontabile.</Empty> : <table className="t"><thead><tr><th>Sede</th><th className="num">Concorrenti</th><th className="num">Prescr.</th><th className="num">Attr.</th><th className="num">Residenti</th><th className="num">Accettazioni / mese</th><th className="num">Ricavi / mese</th></tr></thead>
            <tbody><tr style={{ background: 'var(--soft, #eef5f6)' }}><td className="strong">Questo indirizzo</td><td className="num">{num(v.caratteristiche.concorrenti)}</td><td className="num">{num(v.caratteristiche.prescrittori)}</td><td className="num">{num(v.caratteristiche.attrattori)}</td><td className="num">{v.comune ? num(v.comune.popolazione) : '–'}</td><td className="num">?</td><td className="num">?</td></tr>
              {v.resa.simili.map((x) => <tr key={x.site_id}><td><div className="strong">{x.name}</div><div className="small muted">{SITE_KIND[x.kind] || x.kind}{x.km != null ? ` · a ${km(x.km)}` : ''} · {num(x.mesi)} mesi di dati</div></td>
                <td className="num">{num(x.car.concorrenti)}</td><td className="num">{num(x.car.prescrittori)}</td><td className="num">{num(x.car.attrattori)}</td><td className="num">{x.popolazione ? num(x.popolazione) : '–'}</td><td className="num strong">{num(x.accettazioni_mese)}</td><td className="num">{eur0(x.ricavi_mese)}</td></tr>)}</tbody></table>}
          <div className="small muted" style={{ padding: '8px 14px' }}>{v.resa.nota} Confronto {v.resa.base.solo_punti_prelievo ? 'con i soli punti prelievo' : 'con tutte le sedi del network (meno di 3 punti prelievo con dati)'}; luoghi contati entro 1 km.</div>
        </Card>
        <Card title="Clienti B2B, prospect e centri commerciali" flush>
          <div style={{ padding: 14 }}>
            <div className="lbl small muted">Centri commerciali nel raggio</div>
            <div className="small" style={{ marginBottom: 10 }}>{!v.centri_commerciali_rilevati ? 'Categoria non letta in questa rilevazione: premi "Rileva adesso".' : v.centri_commerciali.length ? v.centri_commerciali.map((c) => `${c.nome} (${metri(c.distanza_m)})`).join(', ') : 'Nessuno.'}</div>
            <div className="lbl small muted">Clienti B2B attivi</div>
            <div className="small" style={{ marginBottom: 10 }}>{v.b2b.clienti.length ? v.b2b.clienti.map((c) => `${c.nome}${c.distanza_m != null ? ` (${metri(c.distanza_m)})` : ` (${c.citta || 'nel comune'})`}`).join(', ') : 'Nessuno nel raggio o nel comune.'}</div>
            <div className="lbl small muted">Prospect del Business Hub ({num(v.b2b.prospect_totale)})</div>
            {v.b2b.prospect.length === 0 ? <div className="small">Nessuno nel raggio o nel comune.</div> : <table className="t" style={{ marginTop: 4 }}><tbody>{v.b2b.prospect.slice(0, 12).map((p) => <tr key={p.id}><td className="strong">{p.nome}</td><td className="small">{String(p.categoria || '').replace(/_/g, ' ').toLowerCase()}</td><td className="small">{p.linea}</td><td className="num">{p.distanza_m != null ? metri(p.distanza_m) : p.comune}</td></tr>)}</tbody></table>}
            {v.b2b.prospect_totale > 12 && <div className="small muted">e altri {num(v.b2b.prospect_totale - 12)}: l'elenco completo è in Business Hub &gt; Ricerca prospect.</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}
export const puntiMappa = (v) => (!v ? [] : [
  ...v.b2b.clienti.filter((c) => c.lat != null).map((c) => ({ lat: c.lat, lng: c.lng, nome: c.nome, tipo: 'Cliente B2B attivo', colore: '#0a7d4f' })),
  ...v.b2b.prospect.filter((p) => p.lat != null).map((p) => ({ lat: p.lat, lng: p.lng, nome: p.nome, tipo: 'Prospect del Business Hub', colore: '#d97a00' })),
]);

// ------------------------------------------------------------------------------------------------ 3. Dove aprire
const COMP = [['bacino', 'Bacino'], ['concorrenza', 'Concorrenza'], ['traino', 'Traino'], ['spazio', 'Spazio'], ['b2b', 'B2B']];
function Barre({ c, pesi }) {
  return <div style={{ display: 'flex', gap: 8, flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>{COMP.map(([k, l]) => <span key={k} className="small" title={`${l}: ${c[k] == null ? 'non rilevato' : `${String(c[k]).replace('.', ',')} su ${pesi[k]}`}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
    <span className="muted">{l.slice(0, 3)}</span><span style={{ display: 'inline-block', width: 26, height: 6, borderRadius: 3, background: 'var(--line, #dbe5e7)', overflow: 'hidden' }}><span style={{ display: 'block', height: '100%', width: `${c[k] == null ? 0 : (100 * c[k]) / pesi[k]}%`, background: c[k] == null ? 'transparent' : '#1C505E' }} /></span></span>)}</div>;
}

export function DoveAprire() {
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const d = useApi('/rete/comuni');
  const [prov, setProv] = useState('');
  const [presenti, setPresenti] = useState(false);
  const [soloRil, setSoloRil] = useState(false);
  const [busy, setBusy] = useState(null);
  const [imp, setImp] = useState(null);
  const tutti = d.data?.comuni || [];
  const province = useMemo(() => [...new Set(tutti.map((c) => c.provincia))].sort(), [tutti]);
  const righe = tutti.filter((c) => (!prov || c.provincia === prov) && (presenti || !c.presente) && (!soloRil || c.rilevato));
  const rileva = async (c) => { setBusy(c.istat); try { const r = await api.post(`/rete/comuni/${c.istat}/rileva`); toast(`${c.nome}: ${r.luoghi} luoghi, ${r.n_chiamate} chiamate a Google`); d.reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(null); } };
  const escludi = async (c, escluso) => { try { await api.put(`/rete/comuni/${c.istat}`, { escluso }); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const scansiona = async () => { setBusy('lotto'); try { const r = await api.post('/rete/comuni/scansione', { limite: 5 }); toast(r.fermata_dal_tetto ? `Fermata dal tetto giornaliero di Google dopo ${r.rilevati.length} comuni` : `${r.rilevati.length} comuni rilevati, ${r.restanti} ancora da rilevare`); d.reload(); } catch (e) { toast(e.message, 'err'); } finally { setBusy(null); } };
  const salvaImp = async () => { try { await api.put('/rete/impostazioni', { soglia_abitanti: Number(imp.soglia_abitanti), comuni_per_notte: Number(imp.comuni_per_notte), scansione_attiva: Boolean(imp.scansione_attiva) }); toast('Impostazioni salvate'); setImp(null); d.reload(); } catch (e) { toast(e.message, 'err'); } };
  const R = d.data?.riepilogo; const I = d.data?.impostazioni;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Dove aprire</h1><div className="sub">I comuni della Toscana in classifica per bacino, concorrenza, traino, spazio rispetto alla nostra rete e presenza di clienti e prospect B2B. Il punteggio si legge sempre con le sue componenti.</div></div>
        <div className="row">{isAdmin(user) && I && <button className="btn ghost" onClick={() => setImp({ ...I })}><Icon name="gear" />Soglia e scansione</button>}
          {isAdmin(user) && <button className="btn" disabled={busy != null} onClick={scansiona}><Icon name="refresh" />{busy === 'lotto' ? 'Rilevo…' : 'Rileva i prossimi 5'}</button>}</div></div>
      {d.error ? <ErrorBox error={d.error} /> : !d.data ? <Loading /> : <>
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <Kpi accent label="Comuni in classifica" value={num(R.in_classifica)} foot={`sopra ${num(I.soglia_abitanti)} residenti, su ${num(R.totale)} comuni toscani`} />
          <Kpi label="Rilevati con Google" value={`${num(R.rilevati)} su ${num(R.in_classifica)}`} foot={I.scansione_attiva ? `scansione notturna: ${num(I.comuni_per_notte)} comuni per notte` : 'scansione notturna spenta'} />
          <Kpi label="Clienti B2B e prospect" value={`${num(R.clienti_b2b)} · ${num(R.prospect)}`} foot="clienti attivi e prospect del Business Hub" />
          <Kpi label="Sedi TD con coordinate" value={num(R.sedi_td)} foot="per la distanza dalla rete" />
        </div>
        <Card title="Classifica" flush actions={<>
          <select style={{ width: 'auto' }} value={prov} onChange={(e) => setProv(e.target.value)}><option value="">Tutte le province</option>{province.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          <label className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}><input type="checkbox" style={{ width: 'auto' }} checked={soloRil} onChange={(e) => setSoloRil(e.target.checked)} />solo rilevati</label>
          <label className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}><input type="checkbox" style={{ width: 'auto' }} checked={presenti} onChange={(e) => setPresenti(e.target.checked)} />anche dove siamo già</label>
        </>}>
          {!righe.length ? <Empty>Nessun comune con questi filtri.</Empty> : <div className="table-wrap"><table className="t">
            <thead><tr><th className="num">#</th><th>Comune</th><th className="num">Residenti</th><th className="num">Punteggio</th><th>Componenti</th><th className="num">Concorrenti</th><th className="num" title="Medici, farmacie, centri commerciali, supermercati entro 3 km dal centro">Med. · farm. · c.comm. · superm.</th><th className="num">Sede TD più vicina</th><th className="num" title="Clienti B2B attivi e prospect del Business Hub nel comune">B2B</th><th></th></tr></thead>
            <tbody>{righe.map((c, i) => <tr key={c.istat}>
              <td className="num muted">{i + 1}</td>
              <td><div className="strong">{c.nome} <span className="muted small">{c.provincia}</span></div><div className="small muted">{c.presente ? <Badge tone="teal">siamo già qui</Badge> : null}{c.rilevato ? <> rilevato il {itDate(c.rilevato_il)}{c.prova ? ' (prova)' : ''}</> : c.errore ? <span title={c.errore}> errore nell'ultima rilevazione</span> : ' da rilevare'}</div></td>
              <td className="num">{num(c.popolazione)}</td>
              <td className="num"><span className="strong" style={{ fontSize: 16 }}>{String(c.punteggio).replace('.', ',')}</span><div className="small muted">su {c.su}{!c.completo ? ' (parziale)' : ''}</div></td>
              <td><Barre c={c.componenti} pesi={d.data.pesi} /></td>
              <td className="num">{c.rilevato ? <><span className="strong">{num(c.concorrenti)}</span><div className="small muted">{String(c.concorrenti_10k).replace('.', ',')} ogni 10.000</div></> : '–'}</td>
              <td className="num small">{c.rilevato ? <span title={c.al_massimo.length ? `Google restituisce al massimo 20 luoghi per ricerca: per ${c.al_massimo.join(', ').toLowerCase()} il numero è un minimo` : ''}>{['medico', 'farmacia', 'centro_commerciale', 'supermercato'].map((k) => (c.dettaglio[k] == null ? '–' : `${c.dettaglio[k]}${c.dettaglio[k] >= 20 ? '+' : ''}`)).join(' · ')}</span> : '–'}</td>
              <td className="num">{km(c.km_td)}<div className="small muted">{c.sede_vicina || ''}</div></td>
              <td className="num">{num(c.clienti)} · {num(c.prospect)}</td>
              <td><div className="row tight">{c.rilevazione_id && <button className="btn sm ghost" title="Luoghi rilevati e mappa" onClick={() => nav(`${base}/intorno/${c.rilevazione_id}`)}><Icon name="map" /></button>}
                {canWrite(user) && <button className="btn sm ghost" disabled={busy != null} title="Rileva adesso con Google (circa 9 chiamate)" onClick={() => rileva(c)}><Icon name="refresh" />{busy === c.istat ? '…' : ''}</button>}
                {canWrite(user) && <button className="btn sm ghost" title="Togli dalla classifica" onClick={() => escludi(c, true)}><Icon name="trash" /></button>}</div></td>
            </tr>)}</tbody></table></div>}
        </Card>
        {d.data.esclusi.length > 0 && <div className="small" style={{ marginTop: 10 }}>Tolti dalla classifica: {d.data.esclusi.map((c) => <span key={c.istat} style={{ marginRight: 8 }}>{c.nome} {canWrite(user) && <button className="btn sm ghost" onClick={() => escludi(c, false)}>rimetti</button>}</span>)}</div>}
        <div className="small muted" style={{ marginTop: 12 }}>{d.data.formula}<br />Residenti: censimento permanente ISTAT 2021. La quota di anziani non è ancora caricata e non entra nel punteggio. Concorrenti e traino sono contati da Google entro {metri(d.data.raggio_m)} dal centro del comune; un comune non rilevato ha un punteggio parziale e sta in fondo. {num(d.data.sotto_soglia)} comuni sono sotto la soglia di residenti.</div>
      </>}
      {imp && <Modal title="Soglia e scansione" onClose={() => setImp(null)} footer={<><button className="btn ghost" onClick={() => setImp(null)}>Annulla</button><button className="btn" onClick={salvaImp}>Salva</button></>}>
        <div className="form-grid">
          <Field label="Soglia di residenti" help="Sotto questa soglia un comune non entra in classifica e non viene rilevato"><input type="number" min="0" value={imp.soglia_abitanti} onChange={(e) => setImp({ ...imp, soglia_abitanti: e.target.value })} /></Field>
          <Field label="Comuni per notte" help="Ogni comune costa circa 9 chiamate a Google, dentro il tetto giornaliero dell'Intorno"><input type="number" min="0" max="100" value={imp.comuni_per_notte} onChange={(e) => setImp({ ...imp, comuni_per_notte: e.target.value })} /></Field>
          <Field label="Scansione notturna"><label className="row tight small"><input type="checkbox" checked={Boolean(imp.scansione_attiva)} onChange={(e) => setImp({ ...imp, scansione_attiva: e.target.checked })} />attiva</label></Field>
        </div>
      </Modal>}
    </div>
  );
}

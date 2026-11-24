// Quadratura con la banca (v0.95.0): i movimenti del conto (Enable Banking) a fronte delle autorizzazioni al pagamento, degli incassi
// riconciliati dal Recupero Crediti e del conto economico del periodo. Prospetto di controllo, in sola lettura.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { qs } from '../api.js';
import { useApi, Card, Kpi, Badge, Loading, ErrorBox } from '../components/ui.jsx';
import { eur, itDate } from '../format.js';
import { base } from '../paths.js';

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const CRED = { ABBINATO: 'Abbinati a fatture clienti', PROPOSTO: 'Proposte da confermare', DA_ABBINARE: 'Senza abbinamento', IGNORATO: 'Non sono fatture clienti (POS, giroconti, altro)', NON_ESAMINATO: 'Non ancora esaminati' };

export default function Quadratura() {
  const oggi = new Date(); const [anno, setAnno] = useState(oggi.getFullYear()); const [mese, setMese] = useState(oggi.getMonth() + 1);
  const d = useApi(`/controllo/quadratura${qs({ anno, mese: mese || '' })}`, [anno, mese]);
  const x = d.data;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Quadratura con la banca</h1><div className="sub">I movimenti del conto a fronte di ciò che la Suite sa: autorizzazioni al pagamento, incassi dei clienti riconciliati, conto economico. Sola lettura.</div></div>
        <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}><select style={{ width: 'auto' }} value={mese} onChange={(e) => setMese(Number(e.target.value))} aria-label="Mese"><option value={0}>Anno intero</option>{MESI.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          <select style={{ width: 'auto' }} value={anno} onChange={(e) => setAnno(Number(e.target.value))} aria-label="Anno">{[0, 1, 2].map((k) => <option key={k} value={oggi.getFullYear() - k}>{oggi.getFullYear() - k}</option>)}</select><Link className="btn ghost" to={`${base}/banca`}>Conti e movimenti</Link></div></div>
      <ErrorBox error={d.error} />
      {!x && !d.error && <Loading />}
      {x && <>
        {x.copertura.avviso && <div className="alert warn" style={{ marginBottom: 16 }}><span>{x.copertura.avviso}. {!x.copertura.collegata && <Link to={`${base}/banca`}>Collega un conto</Link>}</span></div>}
        <div className="grid g4" style={{ marginBottom: 16 }}>
          <Kpi label={`Entrate in banca, ${x.periodo.etichetta}`} value={eur(x.banca.entrate)} foot={`${x.banca.n_entrate} movimenti`} />
          <Kpi label="Uscite in banca" value={eur(x.banca.uscite)} foot={`${x.banca.n_uscite} movimenti`} />
          <Kpi label="Saldo del periodo" value={eur(x.banca.saldo_periodo)} accent foot="entrate meno uscite" />
          <Kpi label="Saldo dei conti oggi" value={x.conti.some((c) => c.saldo != null) ? eur(x.conti.reduce((s, c) => s + Number(c.saldo || 0), 0)) : 'n.d.'} foot={`${x.conti.length} ${x.conti.length === 1 ? 'conto collegato' : 'conti collegati'}`} />
        </div>

        <Card title="Uscite e autorizzazioni al pagamento" icon="edit" style={{ marginBottom: 16 }}>
          <p className="small">Ogni uscita dovrebbe avere un'istanza firmata. Abbinamento per importo uguale più IBAN del beneficiario, CRO o nome; con il solo importo vale soltanto se il candidato è unico (segnato come debole).</p>
          <div className="grid g3" style={{ margin: '10px 0' }}>
            <Kpi label="Uscite con istanza" value={eur(x.uscite.con_istanza.importo)} foot={`${x.uscite.con_istanza.n} movimenti`} />
            <Kpi label="Uscite senza istanza" value={eur(x.uscite.senza_istanza.importo)} foot={`${x.uscite.senza_istanza.n} movimenti: paghe, imposte, commissioni, addebiti diretti e ciò che non è passato dalle autorizzazioni`} />
            <Kpi label="Istanze eseguite senza movimento" value={x.istanze.eseguite_senza_movimento.length} foot="registrate come eseguite, non trovate in banca" />
          </div>
          {x.istanze.firmate_con_movimento.length > 0 && <div className="alert info" style={{ marginBottom: 10 }}><div><strong>Istanze firmate che risultano già pagate in banca: manca la registrazione dell'esecuzione.</strong><ul className="small" style={{ margin: '6px 0 0' }}>{x.istanze.firmate_con_movimento.map((i) => <li key={i.id}><Link to={`${base}/istanze/${i.id}`}>{i.protocollo || `istanza ${i.id}`}</Link> · {i.beneficiario} · {eur(i.importo)} · movimento del {itDate(i.movimento_del)} ({i.per}){i.debole && <Badge tone="amber">debole</Badge>}</li>)}</ul></div></div>}
          {x.istanze.eseguite_senza_movimento.length > 0 && <details style={{ marginBottom: 10 }}><summary className="strong">Istanze eseguite nel periodo senza un movimento corrispondente ({x.istanze.eseguite_senza_movimento.length})</summary><div className="table-wrap"><table className="t"><tbody>{x.istanze.eseguite_senza_movimento.map((i) => <tr key={i.id}><td><Link to={`${base}/istanze/${i.id}`}>{i.protocollo || `istanza ${i.id}`}</Link></td><td>{i.beneficiario}</td><td className="small">eseguita il {itDate(i.eseguita)} · {i.metodo}</td><td className="num strong">{eur(i.importo)}</td></tr>)}</tbody></table></div><p className="small muted">Possibili ragioni: pagamento da un conto non collegato, F24, importo diverso per commissioni, data di esecuzione lontana più di 5 giorni dal movimento.</p></details>}
          <details><summary className="strong">Uscite senza istanza ({x.uscite.senza_istanza.n})</summary><div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}><table className="t"><thead><tr><th>Data</th><th>Controparte</th><th>Causale</th><th className="num">Importo</th></tr></thead><tbody>{x.uscite.elenco_senza.map((m) => <tr key={m.id}><td className="nowrap">{itDate(m.data)}</td><td>{m.controparte}</td><td className="small">{m.causale}</td><td className="num">{eur(m.importo)}</td></tr>)}</tbody></table></div></details>
          {x.uscite.abbinate.length > 0 && <details style={{ marginTop: 10 }}><summary className="strong">Uscite abbinate a un'istanza ({x.uscite.abbinate.length})</summary><div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}><table className="t"><tbody>{x.uscite.abbinate.map((m) => <tr key={m.id}><td className="nowrap">{itDate(m.data)}</td><td>{m.controparte}</td><td><Link to={`${base}/istanze/${m.istanza_id}`}>{m.protocollo || `istanza ${m.istanza_id}`}</Link> <span className="small muted">{m.per}</span>{m.debole && <Badge tone="amber">debole</Badge>}</td><td className="num">{eur(m.importo)}</td></tr>)}</tbody></table></div></details>}
        </Card>

        <Card title="Entrate e incassi dei clienti" icon="cash" style={{ marginBottom: 16 }}>
          {x.entrate.crediti ? <table className="t"><tbody>{Object.entries(CRED).filter(([k]) => x.entrate.crediti[k]).map(([k, l]) => <tr key={k}><td>{l}</td><td className="small muted">{x.entrate.crediti[k].n} movimenti</td><td className="num strong">{eur(x.entrate.crediti[k].importo)}</td></tr>)}<tr><td className="strong">Totale entrate</td><td></td><td className="num strong">{eur(x.entrate.totale)}</td></tr></tbody></table> : <p className="small muted">Il widget Recupero Crediti non è attivo: le entrate non sono classificate.</p>}
          <p className="small muted" style={{ marginTop: 8 }}>Gli incassi dei punti prelievo (contante e POS) passano dal Cash Management e arrivano in banca come versamenti e accrediti cumulativi: qui restano fra le entrate non riferite a fatture clienti. <Link to="/crediti/riconciliazione">Incassi da abbinare</Link></p>
        </Card>

        <Card title="A fronte del conto economico" icon="stats">
          {x.conto_economico && !x.conto_economico.errore ? <>
            <table className="t"><thead><tr><th></th><th className="num">Conto economico (competenza)</th><th className="num">Banca (cassa)</th><th className="num">Differenza</th></tr></thead><tbody>
              <tr><td className="strong">Ricavi / entrate</td><td className="num">{eur(x.conto_economico.ricavi)}</td><td className="num">{eur(x.banca.entrate)}</td><td className="num strong">{eur(x.lettura.ricavi_meno_entrate)}</td></tr>
              <tr><td className="strong">Costi / uscite</td><td className="num">{eur(x.conto_economico.costi_diretti + (x.conto_economico.costi_centrali || 0))}</td><td className="num">{eur(x.banca.uscite)}</td><td className="num strong">{eur(x.lettura.costi_meno_uscite)}</td></tr>
              <tr><td className="strong">Margine / saldo</td><td className="num">{eur(x.conto_economico.ricavi - x.conto_economico.costi_diretti - (x.conto_economico.costi_centrali || 0))}</td><td className="num">{eur(x.banca.saldo_periodo)}</td><td></td></tr>
            </tbody></table>
            <p className="small muted" style={{ marginTop: 8 }}>Le due colonne non devono coincidere: il conto economico registra la produzione e i costi di competenza (senza IVA dove detraibile), la banca registra incassi e pagamenti con i loro tempi, IVA compresa, e contiene anche imposte, finanziamenti e giroconti. La differenza sui ricavi è, in larga parte, credito verso clienti ancora da incassare o incassato di periodi precedenti. <Link to={`${base}/conto-economico`}>Conto economico di sede</Link></p>
          </> : <p className="small muted">Conto economico del periodo non disponibile{x.conto_economico?.errore ? `: ${x.conto_economico.errore}` : ''}.</p>}
        </Card>
      </>}
    </div>
  );
}

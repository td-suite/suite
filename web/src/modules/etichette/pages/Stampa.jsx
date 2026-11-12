// Lab Control > Label · Stampa etichette (pagina dell'operatore; v0.71.0: si apre anche dalla scheda di Lab Control con ?acc=<istanza>|<id>
// o con ?q=<numero>). Ricerca grande con il fuoco all'apertura, pensata anche per il lettore di barcode
// (il lettore "scrive" il codice e preme Invio = cerca); risultato unico → anteprima subito; "Stampa tutte" ben visibile; Ctrl+P stampa
// tutte le etichette dell'accettazione aperta (invece della stampa della pagina). Stampa con Zebra Browser Print sul PC della sede o, in
// mancanza, PDF di ripiego con la stessa resa dell'anteprima. Ogni stampa (o tentativo) va nel registro senza dati del paziente.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Card, ErrorBox, PageHead, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { api, qs, base } from '../api.js';
import { useAuth, isAdmin } from '../auth.jsx';
import { Anteprima, AvvisoValidazione, StatoZebra, GuidaBrowserPrint } from '../components.jsx';
import { configuraBrowserPrint, rileva, invia, ricordaScelta, zplConCopie } from '../lib/stampaZebra.js';
import { pdfEtichette, apriPdf } from '../lib/pdf.js';
import { itData, itDataOra } from '../format.js';

export default function Stampa() {
  const { user, stato } = useAuth();
  const toast = useToast();
  const input = useRef(null);
  const [q, setQ] = useState('');
  const [data, setData] = useState('');
  const [ris, setRis] = useState(null);
  const [cercando, setCercando] = useState(false);
  const [err, setErr] = useState(null);
  const [acc, setAcc] = useState(null);
  const [aprendo, setAprendo] = useState(false);
  const [sel, setSel] = useState(new Set());
  const [copie, setCopie] = useState(1);
  const [zebra, setZebra] = useState(null);
  const [guida, setGuida] = useState(false);
  const [stampando, setStampando] = useState(false);

  const cercaZebra = useCallback(async () => { setZebra(null); const z = await rileva(); setZebra(z); if (!z.ok) setGuida(false); }, []);
  useEffect(() => { configuraBrowserPrint(stato?.browser_print); cercaZebra(); }, [stato, cercaZebra]);
  const scegli = (s) => { ricordaScelta(s?.uid); setZebra((z) => ({ ...z, scelta: s })); };
  const fuoco = () => setTimeout(() => input.current?.focus(), 30);

  const apri = useCallback(async (r) => {
    setAprendo(true); setErr(null);
    try {
      const d = await api.get(`/accettazioni/${encodeURIComponent(r.instance_id)}/${encodeURIComponent(r.id)}`);
      setAcc(d); setSel(new Set(d.etichette.map((e) => e.chiave))); setCopie(1);
    } catch (e) { setErr(e); setAcc(null); }
    finally { setAprendo(false); }
  }, []);

  const cerca = async (e, valore = null) => {
    e?.preventDefault?.();
    const v = String(valore ?? q).trim();
    if (!v) return;
    setCercando(true); setErr(null); setAcc(null); setRis(null);
    try {
      const r = await api.get(`/cerca${qs({ q: v, data: /\d/.test(v) ? '' : data })}`);
      setRis(r);
      if (r.risultati?.length === 1) await apri(r.risultati[0]);
    } catch (e2) { setErr(e2); }
    finally { setCercando(false); }
  };

  const etichetteScelte = (tutte) => (acc?.etichette || []).filter((e) => tutte || sel.has(e.chiave));
  const registra = (lista, metodo, esito, extra = {}) => api.post('/stampe', {
    instance_id: acc.accettazione.instance_id, request_id: acc.accettazione.id, etichette: lista.length, copie, metodo, esito,
    stampante: metodo === 'ZEBRA' ? zebra?.scelta?.name || null : null, modello_id: acc.modello?.id || null, ...extra,
  }, { silent: true }).catch(() => null);

  const pdf = async (tutte = true) => {
    const lista = etichetteScelte(tutte);
    if (!lista.length || !acc) return;
    setStampando(true);
    try {
      apriPdf(await pdfEtichette(lista, acc.modello, { copie }), `etichette-${String(acc.accettazione.numero || '').replace(/[^\w-]+/g, '_')}.pdf`);
      await registra(lista, 'PDF', 'OK');
      toast(`PDF con ${lista.length * copie} etichett${lista.length * copie === 1 ? 'a' : 'e'}: stampalo sulla Zebra a dimensioni effettive`);
      setAcc((a) => (a ? { ...a, stampe: { ...a.stampe, ok: (a.stampe?.ok || 0) + 1, ultima: new Date().toISOString() } } : a));
    } catch (e) { toast(e, 'err'); await registra(lista, 'PDF', 'ERRORE', { errore: String(e.message || e).slice(0, 300) }); }
    finally { setStampando(false); }
  };

  const stampa = async (tutte = true) => {
    const lista = etichetteScelte(tutte);
    if (!lista.length || !acc || stampando) return;
    if (!zebra?.ok || !zebra.scelta) { await pdf(tutte); return; }
    setStampando(true);
    try {
      await invia(zebra.scelta, zplConCopie(lista.map((e) => e.zpl), copie));
      const r = await registra(lista, 'ZEBRA', 'OK');
      toast(`${lista.length * copie} etichett${lista.length * copie === 1 ? 'a inviata' : 'e inviate'} a ${zebra.scelta.name}${r?.ristampa ? ' (ristampa)' : ''}`);
      setAcc((a) => (a ? { ...a, stampe: { ok: (a.stampe?.ok || 0) + 1, ultima: new Date().toISOString() } } : a));
      setQ(''); fuoco();
    } catch (e) {
      await registra(lista, 'ZEBRA', 'ERRORE', { errore: String(e.message || e).slice(0, 300) });
      toast(`Stampa non riuscita: ${e.message}. Riprova o usa PDF`, 'err');
      cercaZebra();
    } finally { setStampando(false); }
  };

  // Ctrl+P (Cmd+P sul Mac) = Stampa tutte, quando un'accettazione è aperta
  const stampaRef = useRef(stampa);
  stampaRef.current = stampa;
  useEffect(() => {
    const k = (e) => { if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P') && acc) { e.preventDefault(); stampaRef.current(true); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [acc]);

  // apertura diretta dalla scheda di Lab Control (?acc=istanza|id) o con un numero (?q=)
  const [sp] = useSearchParams();
  const daLink = useRef(false);
  useEffect(() => {
    if (daLink.current) return;
    const acc0 = sp.get('acc'); const q0 = sp.get('q');
    if (acc0 && acc0.includes('|')) { daLink.current = true; const i = acc0.indexOf('|'); apri({ instance_id: acc0.slice(0, i), id: acc0.slice(i + 1) }); }
    else if (q0) { daLink.current = true; setQ(q0); cerca(null, q0); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, apri]);

  const cognome = q.trim() && !/\d/.test(q);
  const tutte = acc?.etichette?.length || 0;
  const scelte = sel.size;
  const zebraPronta = Boolean(zebra?.ok && zebra.scelta);
  const toggle = (k) => setSel((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <div className="page et-page">
      <PageHead title="Stampa etichette" icon="etichette" sub="Numero di accettazione, barcode della provetta o cognome del paziente"
        actions={<StatoZebra zebra={zebra} onRiprova={cercaZebra} onScegli={scegli} aperta={guida} setAperta={setGuida} />} />
      {guida && <GuidaBrowserPrint />}
      <AvvisoValidazione testo={stato?.avviso_validazione} />

      <form className="et-cerca" onSubmit={cerca} role="search">
        <Icon name="search" />
        <input ref={input} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Leggi il barcode o scrivi il numero di accettazione o il cognome" aria-label="Numero di accettazione, barcode o cognome" autoComplete="off" spellCheck={false} />
        {cognome && <label className="et-data"><span>Data</span><input type="date" value={data} onChange={(e) => setData(e.target.value)} aria-label="Data dell'accettazione (facoltativa)" /></label>}
        <button className="btn lg" disabled={cercando || !q.trim()}>{cercando ? 'Cerco…' : 'Cerca'}</button>
      </form>
      <div className="et-sotto small muted">Invio = cerca · un solo risultato si apre da solo · <b>Ctrl+P</b> = stampa tutte · il cognome si cerca sulle accettazioni degli ultimi giorni{stato?.data_api && !stato.data_api.ok ? ' · ricerca diretta nel gestionale non disponibile' : ''}</div>

      <ErrorBox error={err} />
      {ris?.messaggio && <div className="alert info"><Icon name="info" /><span>{ris.messaggio}</span></div>}
      {ris && ris.risultati?.length === 0 && !ris.messaggio && <div className="alert info"><Icon name="info" /><span>Nessuna accettazione trovata{ris.tipo === 'COGNOME' ? ' fra quelle degli ultimi giorni: prova con il numero di accettazione o il barcode' : ''}.</span></div>}
      {ris?.fuori > 0 && ris.risultati?.length > 0 && <div className="small muted">{ris.fuori} accettazion{ris.fuori === 1 ? 'e' : 'i'} fuori dal tuo perimetro di sedi non mostrat{ris.fuori === 1 ? 'a' : 'e'}.</div>}

      {ris?.risultati?.length > 1 && (
        <Card title={`${ris.risultati.length} accettazioni${ris.troppi ? ' (le prime 50)' : ''}`} icon="list" flush className="et-risultati">
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Accettazione</th><th>Data e ora</th><th>Paziente</th><th>Nascita</th><th>Cliente / sede</th><th className="num">Provette</th><th /></tr></thead>
              <tbody>
                {ris.risultati.map((r) => (
                  <tr key={`${r.instance_id}|${r.id}`} className={`click ${acc?.accettazione?.id === r.id ? 'sel' : ''}`} onClick={() => apri(r)}>
                    <td><b>{r.numero}</b>{!r.attiva && <> <Badge tone="grey">non attiva</Badge></>}</td>
                    <td>{itData(r.data)} {r.ora}</td>
                    <td>{r.cognome || r.nome ? `${r.cognome || ''} ${r.nome || ''}` : <span className="faint">da leggere all'apertura</span>}</td>
                    <td>{itData(r.nascita)}</td>
                    <td>{r.sede || r.cliente || <span className="faint">non abbinato</span>}</td>
                    <td className="num">{r.provette}</td>
                    <td className="actions"><button type="button" className="btn sm ghost">Apri</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {aprendo && <div className="alert info"><Icon name="refresh" /><span>Preparo le etichette…</span></div>}

      {acc && (
        <Card className="et-acc" title={<>Accettazione {acc.accettazione.numero}{acc.fonte === 'GESTIONALE' && <Badge tone="blue">dal gestionale</Badge>}</>} icon="etichette"
          actions={<>{acc.stampe?.ok > 0 && <Badge tone="amber" title="Le etichette di questa accettazione sono già state stampate">Già stampata {acc.stampe.ok} {acc.stampe.ok === 1 ? 'volta' : 'volte'} · ultima {itDataOra(acc.stampe.ultima)}</Badge>}
            {acc.fonte === 'COPIA' && <Link className="btn sm ghost" to={`${base}/accettazioni/${encodeURIComponent(acc.accettazione.instance_id)}/${encodeURIComponent(acc.accettazione.id)}`} title="Esami, campioni, avanzamento e fattura">Apri in Lab Control</Link>}</>}>
          <div className="et-testata">
            <div><span>Paziente</span><b>{acc.paziente ? `${acc.paziente.cognome || ''} ${acc.paziente.nome || ''}` : '—'}</b>{acc.paziente?.nascita && <em>nato/a il {itData(acc.paziente.nascita)}{acc.paziente.sesso ? ` · ${acc.paziente.sesso}` : ''}</em>}</div>
            <div><span>Data e ora</span><b>{itData(acc.accettazione.data)} {acc.accettazione.ora}</b><em>{acc.accettazione.stato_label || ''}</em></div>
            <div><span>Sede</span><b>{acc.accettazione.sede || '—'}</b><em>{acc.accettazione.cliente || ''}</em></div>
            <div><span>Modello</span><b>{acc.modello?.nome || 'nessun modello attivo'}</b><em>{acc.modello ? `${acc.modello.larghezza_mm}×${acc.modello.altezza_mm} mm · ${acc.modello.dpi} dpi` : ''}</em></div>
          </div>
          {!acc.paziente && <div className="alert warn"><Icon name="alert" /><span>{acc.paziente_messaggio || 'Nome del paziente non disponibile'}: le etichette escono senza nome. Controlla in StudioLab prima di stampare.</span></div>}

          <div className="et-azioni">
            <button type="button" className="btn lg et-tutte" onClick={() => stampa(true)} disabled={stampando || !tutte}>
              <Icon name="printer" />{zebraPronta ? `Stampa tutte (${tutte * copie})` : `Stampa tutte in PDF (${tutte * copie})`}
            </button>
            {scelte > 0 && scelte < tutte && <button type="button" className="btn" onClick={() => stampa(false)} disabled={stampando}>Stampa selezionate ({scelte * copie})</button>}
            <label className="et-copie"><span>Copie</span><input type="number" min="1" max="20" value={copie} onChange={(e) => setCopie(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} /></label>
            <div className="spacer" />
            <button type="button" className="btn ghost" onClick={() => pdf(scelte === tutte || scelte === 0)} disabled={stampando || !tutte}><Icon name="pdf" />PDF</button>
            <button type="button" className="btn ghost" onClick={() => setSel(scelte === tutte ? new Set() : new Set(acc.etichette.map((e) => e.chiave)))}>{scelte === tutte ? 'Deseleziona' : 'Seleziona tutte'}</button>
          </div>

          <div className="et-griglia">
            {acc.etichette.map((e) => (
              <label key={e.chiave} className={`et-label ${sel.has(e.chiave) ? 'on' : ''}`}>
                <div className="et-label-hd">
                  <input type="checkbox" checked={sel.has(e.chiave)} onChange={() => toggle(e.chiave)} aria-label={`Etichetta ${e.n}`} />
                  <b>{e.n}/{tutte}</b>
                  <span>{e.tipo === 'RICHIESTA' ? 'Etichetta richiesta' : e.contenitore || 'Provetta'}</span>
                  {e.materiale && <span className="muted">{e.materiale}</span>}
                </div>
                <Anteprima zpl={e.zpl} modello={acc.modello} larghezza="100%" titolo={`Etichetta ${e.n} di ${tutte}`} />
                <div className="et-label-ft">
                  {e.barcode ? <code>{e.barcode}</code> : <span className="faint">senza barcode</span>}
                  <span className="et-esami" title={e.esami.map((x) => [x.codice, x.descrizione].filter(Boolean).join(' ')).join(', ')}>{e.esami.map((x) => x.codice).filter(Boolean).join(' · ') || '—'}</span>
                </div>
                {e.avvisi?.map((a) => <div key={a} className="small et-warn">{a}</div>)}
              </label>
            ))}
            {!tutte && <div className="muted">Nessun campione in questa accettazione.</div>}
          </div>
        </Card>
      )}

      <Card title="Come si stampa" icon="info" className="et-guida">
        <ol>
          <li>Leggi con il lettore il <b>barcode</b> di una provetta o il numero dell'accettazione (Invio = cerca), oppure scrivi il <b>cognome</b> (accettazioni degli ultimi giorni).</li>
          <li>Controlla nell'anteprima nome, nascita e contenitore: <b>una etichetta per provetta</b>, con gli esami di quella provetta.</li>
          <li>Premi <b>Stampa tutte</b> (o Ctrl+P); per una sola provetta togli la spunta alle altre e premi "Stampa selezionate".</li>
          <li>In alto deve comparire <b>Zebra pronta</b>: se manca, premi "Come si fa"; intanto stampa in <b>PDF</b> sulla Zebra a dimensioni effettive.</li>
          <li>Una ristampa è sempre possibile e resta nel registro{isAdmin(user) ? ' (Registro stampe)' : ''}; nel registro non ci sono dati del paziente.</li>
        </ol>
      </Card>
    </div>
  );
}

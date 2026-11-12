// Lab Control > Label · Impostazioni Label (ADMIN): giorni di conservazione delle identità recenti, etichetta "richiesta", modello per sede, stato del job
// delle identità e della Data API, dati conservati.
import React, { useEffect, useState } from 'react';
import { Badge, Card, ErrorBox, Field, PageHead, Switch, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { api, useApi } from '../api.js';
import { itDataOra } from '../format.js';

export default function Impostazioni() {
  const toast = useToast();
  const imp = useApi('/impostazioni');
  const modelli = useApi('/modelli');
  const [f, setF] = useState(null);
  const [sedi, setSedi] = useState({});
  const [err, setErr] = useState(null);
  const [lavoro, setLavoro] = useState(false);
  useEffect(() => {
    if (!imp.data) return;
    setF({ giorni_identita: imp.data.giorni_identita, etichetta_richiesta: imp.data.etichetta_richiesta });
    setSedi(Object.fromEntries(imp.data.sedi.map((s) => [s.id, s.modello_id || ''])));
  }, [imp.data]);
  if (!imp.data || !f) return <div className="page"><ErrorBox error={imp.error} /></div>;
  const d = imp.data;
  const attivi = (modelli.data || []).filter((m) => m.attivo);
  const predef = attivi.find((m) => m.predefinito);

  const salva = async () => {
    setErr(null);
    try {
      const modelli_sede = d.sedi.filter((s) => String(s.modello_id || '') !== String(sedi[s.id] || '')).map((s) => ({ site_id: s.id, modello_id: sedi[s.id] ? Number(sedi[s.id]) : null }));
      const r = await api.put('/impostazioni', { giorni_identita: Number(f.giorni_identita), etichetta_richiesta: Boolean(f.etichetta_richiesta), modelli_sede });
      toast(r.purgate ? `Impostazioni salvate: tolte ${r.purgate.identita} identità oltre il nuovo limite` : 'Impostazioni salvate');
      imp.reload();
    } catch (e) { setErr(e); }
  };
  const esegui = async () => {
    setLavoro(true);
    try { const r = await api.post('/identita/esegui'); toast(r.skipped ? `Non eseguito: ${r.motivo}` : `Identità aggiornate: ${r.salvate} nuove su ${r.chiamate} letture${r.errori ? `, ${r.errori} errori` : ''}`, r.skipped || r.errori ? 'err' : 'ok'); imp.reload(); }
    catch (e) { toast(e, 'err'); } finally { setLavoro(false); }
  };

  return (
    <div className="page et-page">
      <PageHead title="Impostazioni Label" icon="gear" sub="Identità recenti, etichetta richiesta, modello per sede" actions={<button className="btn" onClick={salva}>Salva</button>} />
      <ErrorBox error={err} />
      <div className="et-due">
        <Card title="Identità recenti dei pazienti" icon="shield">
          <p className="small muted" style={{ marginTop: 0 }}>Cognome, nome, nascita e sesso delle accettazioni degli ultimi giorni, letti dal gestionale una accettazione alla volta: servono alla ricerca per cognome e alla stampa. Il codice fiscale non si conserva; le righe più vecchie si cancellano ogni giorno. La proiezione paziente della copia Synclab resta spenta.</p>
          <Field label={`Giorni di conservazione (1-${d.giorni_max})`} help="Predefinito 7. Riducendo il valore le identità più vecchie si cancellano subito.">
            <input type="number" min="1" max={d.giorni_max} value={f.giorni_identita} onChange={(e) => setF({ ...f, giorni_identita: e.target.value })} style={{ maxWidth: 120 }} />
          </Field>
          <dl className="et-dl">
            <dt>Conservate ora</dt><dd>{d.conservati.identita} identità{d.conservati.piu_vecchia ? ` · la più vecchia letta il ${itDataOra(d.conservati.piu_vecchia)}` : ''} · {d.conservati.letture_dirette} letture dirette dal gestionale</dd>
            <dt>Data API</dt><dd>{d.data_api.ok ? <Badge tone="green">Accesa</Badge> : <Badge tone="amber">{d.data_api.motivo}</Badge>}</dd>
            <dt>Ultimo giro</dt><dd>{d.job?.ultimo_giro ? itDataOra(d.job.ultimo_giro) : 'mai'}{d.job?.esito && !d.job.esito.skipped ? ` · ${d.job.esito.salvate ?? 0} nuove su ${d.job.esito.chiamate ?? 0} letture` : d.job?.esito?.motivo ? ` · ${d.job.esito.motivo}` : ''}</dd>
            <dt>Ultimo giro riuscito</dt><dd>{d.job?.ultimo_ok ? itDataOra(d.job.ultimo_ok) : 'mai'}{d.job?.errore && <div className="small et-warn">{d.job.errore}</div>}</dd>
          </dl>
          <button className="btn ghost" onClick={esegui} disabled={lavoro}><Icon name="refresh" />{lavoro ? 'Aggiorno…' : 'Aggiorna adesso'}</button>
          <div className="small muted" style={{ marginTop: 6 }}>Il job gira da solo ogni 15 minuti tra le 6 e le 22, al più 30 letture per giro.</div>
        </Card>
        <Card title="Etichette" icon="etichette">
          <label className="f inline"><Switch checked={f.etichetta_richiesta} onChange={(v) => setF({ ...f, etichetta_richiesta: v })} label="Etichetta richiesta" />Aggiungi un'etichetta "richiesta" senza barcode (con tutti gli esami)</label>
          <p className="small muted">Le etichette dei campioni sono sempre una per provetta, con gli esami di quella provetta.</p>
        </Card>
      </div>
      <Card title="Modello per sede" icon="building" flush>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Sede</th><th>Modello</th></tr></thead>
            <tbody>
              {d.sedi.map((s) => (
                <tr key={s.id}>
                  <td><b>{s.code}</b> {s.name}</td>
                  <td><select value={sedi[s.id] ?? ''} onChange={(e) => setSedi({ ...sedi, [s.id]: e.target.value })} aria-label={`Modello per ${s.code || s.name}`}>
                    <option value="">Predefinito{predef ? ` (${predef.nome})` : ''}</option>
                    {attivi.map((m) => <option key={m.id} value={m.id}>{m.nome}{m.validato_il ? '' : ' · da validare'}</option>)}
                  </select></td>
                </tr>
              ))}
              {!d.sedi.length && <tr><td colSpan={2} className="muted">Nessuna sede attiva in anagrafica.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

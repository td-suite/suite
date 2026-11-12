// Lab Control · Impostazioni (ADMIN): soglia di ritardo e soglie per fase, ore dei campioni in viaggio, finestra dei conteggi, giorni delle
// identità recenti (impostazione di Label), colonne predefinite dell'elenco. Le altre impostazioni di Label sono in "Impostazioni Label".
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, ErrorBox, Field, PageHead, Skeleton, useToast } from '../../../components/ui.jsx';
import { api, useApi, base } from '../api.js';

const NOMI_COL = { numero: 'Numero', data: 'Data e ora', cliente: 'Cliente', sede: 'Sede', paziente: 'Paziente', tipo: 'Tipo paziente', esami: 'Esami', campioni: 'Campioni', fase: 'Fase', aggiornata: 'Ultimo aggiornamento', valore: 'Valore', fattura: 'Fattura', nc: 'NC', ritardo: 'Ritardo' };

export default function ImpostazioniLab() {
  const toast = useToast();
  const imp = useApi('/lab/impostazioni');
  const label = useApi('/impostazioni');
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { if (imp.data) setF({ ...imp.data, soglie: Object.fromEntries(imp.data.stati_soglia.map((s) => [s.stato, imp.data.soglie_fase?.[s.stato] ?? ''])), colonne: imp.data.colonne_predefinite || imp.data.colonne.filter((c) => !['tipo', 'campioni', 'aggiornata'].includes(c)) }); }, [imp.data]);
  const [giorni, setGiorni] = useState('');
  useEffect(() => { if (label.data) setGiorni(label.data.giorni_identita); }, [label.data]);
  if (!f) return <div className="page lc-page"><ErrorBox error={imp.error} /><Skeleton lines={6} /></div>;
  const salva = async () => {
    setErr(null);
    try {
      await api.put('/lab/impostazioni', {
        ore_ritardo: Number(f.ore_ritardo), ore_campioni: Number(f.ore_campioni), giorni_finestra: Number(f.giorni_finestra),
        soglie_fase: Object.fromEntries(Object.entries(f.soglie).map(([k, v]) => [k, v === '' || v == null ? null : Number(v)])),
        colonne_predefinite: f.colonne.length === imp.data.colonne.length ? null : f.colonne,
      });
      if (label.data && Number(giorni) !== Number(label.data.giorni_identita)) await api.put('/impostazioni', { giorni_identita: Number(giorni) });
      toast('Impostazioni salvate'); imp.reload(); label.reload();
    } catch (e) { setErr(e); }
  };
  const tutte = imp.data.colonne;
  return (
    <div className="page lc-page">
      <PageHead title="Impostazioni di Lab Control" icon="gear" sub="Soglie dei ritardi, campioni in viaggio, identità recenti, colonne predefinite"
        actions={<><Link className="btn ghost" to={`${base}/label/impostazioni`}>Impostazioni Label</Link><button className="btn" onClick={salva}>Salva</button></>} />
      <ErrorBox error={err} />
      <div className="lc-due">
        <Card title="Ritardi" icon="alert">
          <Field label="Ore dall'accettazione oltre cui è in ritardo (senza referto pronto)" help="Predefinito 72. Vale per le accettazioni in attesa, prelievo eseguito, in lavorazione e in firma.">
            <input type="number" min="1" max="2000" value={f.ore_ritardo} onChange={(e) => setF({ ...f, ore_ritardo: e.target.value })} style={{ maxWidth: 120 }} />
          </Field>
          <div className="lc-soglie">
            <div className="small muted">Soglie per fase (facoltative): ore dall'ultimo aggiornamento del gestionale in quello stato. Vuoto = spenta.</div>
            {imp.data.stati_soglia.map((s) => (
              <label key={s.stato} className="f inline"><span>{s.stato} · {s.label}</span>
                <input type="number" min="1" max="2000" value={f.soglie[s.stato]} onChange={(e) => setF({ ...f, soglie: { ...f.soglie, [s.stato]: e.target.value } })} placeholder="spenta" style={{ maxWidth: 110 }} /></label>
            ))}
          </div>
          <Field label="Finestra (giorni)" help="Predefinito 60: in lavorazione, ritardi e campioni in viaggio contano solo le accettazioni degli ultimi N giorni (le più vecchie mai chiuse nel gestionale restano nell'elenco).">
            <input type="number" min="7" max="365" value={f.giorni_finestra} onChange={(e) => setF({ ...f, giorni_finestra: e.target.value })} style={{ maxWidth: 120 }} />
          </Field>
        </Card>
        <Card title="Campioni e identità" icon="tag">
          <Field label="Campioni raccolti e non arrivati da più di (ore)" help="Predefinito 24: il cruscotto e la pagina Campioni li evidenziano.">
            <input type="number" min="1" max="720" value={f.ore_campioni} onChange={(e) => setF({ ...f, ore_campioni: e.target.value })} style={{ maxWidth: 120 }} />
          </Field>
          <Field label="Giorni delle identità recenti (Label, 1-30)" help="Nome del paziente solo per le accettazioni di questi giorni; il codice fiscale non si conserva. Riducendo il valore le identità più vecchie si cancellano subito.">
            <input type="number" min="1" max="30" value={giorni} onChange={(e) => setGiorni(e.target.value)} style={{ maxWidth: 120 }} disabled={!label.data} />
          </Field>
        </Card>
      </div>
      <Card title="Colonne predefinite dell'elenco" icon="list">
        <p className="small muted" style={{ marginTop: 0 }}>Per chi non ha ancora scelto le sue colonne (ognuno le cambia dall'elenco con "Colonne"; la scelta resta nel suo browser).</p>
        <div className="lc-colonne">
          {tutte.map((c) => <label key={c} className="lc-check"><input type="checkbox" checked={f.colonne.includes(c)} onChange={(e) => setF({ ...f, colonne: e.target.checked ? tutte.filter((x) => x === c || f.colonne.includes(x)) : f.colonne.filter((x) => x !== c) })} />{NOMI_COL[c] || c}</label>)}
        </div>
      </Card>
    </div>
  );
}

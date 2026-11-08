// Piano ferie per area: Direzione, Laboratorio e ogni sede. Vista mese (persone × giorni) e vista anno (persone × mesi), giorni sotto
// la copertura minima in rosso, chiusure collettive, festivi; esportazione XLSX e PDF dell'area o di tutte le aree visibili.
import React, { useEffect, useMemo, useState } from 'react';
import { apiBase, qs, useApi } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Card, Loading, Empty, PageHead, Field, Seg } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { Griglia, Legenda } from '../components.jsx';
import { MESI, itData, num, oggiIso } from '../format.js';

export default function Piano() {
  const { user } = useAuth();
  const g = useApi('/gruppi');
  const oggi = oggiIso();
  const [gruppo, setGruppo] = useState('');
  const [anno, setAnno] = useState(Number(oggi.slice(0, 4)));
  const [mese, setMese] = useState(Number(oggi.slice(5, 7)));
  const [vista, setVista] = useState('mese');
  const gruppi = g.data?.gruppi || [];
  useEffect(() => { if (!gruppo && gruppi.length) setGruppo((gruppi.find((x) => x.mio) || gruppi[0]).key); }, [gruppi, gruppo]);
  const { data: piano, loading, error } = useApi(gruppo ? `/piano${qs({ gruppo, anno })}` : null, [gruppo, anno]);
  const perArea = useMemo(() => ({ fisse: gruppi.filter((x) => x.area !== 'Sedi'), sedi: gruppi.filter((x) => x.area === 'Sedi') }), [gruppi]);
  const scopMese = (piano?.scoperture || []).filter((s) => vista === 'anno' || s.data.slice(5, 7) === String(mese).padStart(2, '0'));
  const chiusure = piano?.chiusure || [];
  if (g.data && !gruppi.length) return <div className="page"><PageHead title="Piano per area" icon="calendar" /><Card><Empty icon="calendar" title="Nessun piano da mostrare">{g.data.contratti === false ? 'Il modulo Contratti del personale non è ancora avviato: il perimetro dei dipendenti non è disponibile.' : 'Non ci sono dipendenti nella tua area, oppure il tuo profilo non è nel perimetro.'}</Empty></Card></div>;
  return (
    <div className="page">
      <PageHead title="Piano per area" icon="calendar" sub="Chi è in ferie e quando, area per area. I colleghi vedono nomi e periodi; i saldi restano riservati."
        actions={<>
          <a className="btn ghost" href={`${apiBase}/export/piano.xlsx${qs({ gruppo, anno })}`} target="_blank" rel="noopener"><Icon name="sheet" />XLSX</a>
          <a className="btn ghost" href={`${apiBase}/export/piano.pdf${qs({ gruppo, anno, mese: vista === 'mese' ? mese : '' })}`} target="_blank" rel="noopener"><Icon name="pdf" />PDF {vista === 'mese' ? 'del mese' : 'dell\'anno'}</a>
          {gruppi.length > 1 && <a className="btn ghost" href={`${apiBase}/export/piano.xlsx${qs({ gruppo: 'TUTTI', anno })}`} target="_blank" rel="noopener" title="Un foglio per ogni area visibile"><Icon name="download" />Tutte le aree</a>}
        </>} />
      <div className="filters">
        <Field label="Area"><select value={gruppo} onChange={(e) => setGruppo(e.target.value)}>
          {perArea.fisse.map((x) => <option key={x.key} value={x.key}>{x.nome} ({x.persone})</option>)}
          {perArea.sedi.length > 0 && <optgroup label="Sedi">{perArea.sedi.map((x) => <option key={x.key} value={x.key}>{x.nome} ({x.persone})</option>)}</optgroup>}
        </select></Field>
        <Field label="Anno"><select value={anno} onChange={(e) => setAnno(Number(e.target.value))}>{[anno - 1, anno, anno + 1].map((a) => <option key={a} value={a}>{a}</option>)}</select></Field>
        <div className="fe-nav">
          <Seg value={vista} onChange={setVista} items={[{ value: 'mese', label: 'Mese' }, { value: 'anno', label: 'Anno' }]} label="Vista" />
          {vista === 'mese' && <>
            <button type="button" className="btn ghost sm" aria-label="Mese precedente" onClick={() => (mese === 1 ? (setMese(12), setAnno(anno - 1)) : setMese(mese - 1))}><Icon name="back" /></button>
            <select value={mese} onChange={(e) => setMese(Number(e.target.value))} aria-label="Mese">{MESI.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
            <button type="button" className="btn ghost sm" aria-label="Mese successivo" onClick={() => (mese === 12 ? (setMese(1), setAnno(anno + 1)) : setMese(mese + 1))}><Icon name="arrowRight" /></button>
          </>}
        </div>
      </div>
      <Card flush title={piano ? `${piano.nome} · ${vista === 'mese' ? `${MESI[mese - 1]} ${anno}` : anno}` : 'Piano'} icon="calendar"
        actions={piano ? <span className="small muted">{piano.persone.length} {piano.persone.length === 1 ? 'persona' : 'persone'}{piano.regole?.length ? ` · copertura: ${piano.regole.map((r) => `${r.ruolo} ≥ ${r.minimo}`).join(', ')}` : ' · nessuna regola di copertura'}</span> : null}>
        {error ? <Empty icon="alert" title="Errore">{error.message}</Empty> : !piano && loading ? <Loading /> : piano && (piano.persone.length ? <Griglia piano={piano} anno={anno} mese={mese} vista={vista} /> : <Empty icon="users" title="Nessuna persona in quest'area" compact />)}
        <Legenda />
      </Card>
      <div className="fe-two">
        <Card title={`Sotto la copertura minima ${vista === 'mese' ? `(${MESI[mese - 1]})` : `(${anno})`}`} icon="alert">
          {!piano?.regole?.length ? <div className="small muted">Nessuna regola di copertura per quest'area (Impostazioni del modulo).</div>
            : !scopMese.length ? <div className="small muted">Con le ferie approvate la copertura minima è sempre rispettata.</div>
              : <ul className="fe-list">{scopMese.slice(0, 40).map((s, i) => <li key={i}><span className="strong">{itData(s.data)}</span><span className="small">{s.ruolo}: {num(s.presenti)} presenti su {s.minimo}</span></li>)}</ul>}
        </Card>
        <Card title="Chiusure collettive" icon="building">
          {!chiusure.length ? <div className="small muted">Nessuna chiusura collettiva nell'anno per quest'area.</div>
            : <ul className="fe-list">{chiusure.map((c) => <li key={c.id}><span className="strong">{itData(c.data_inizio)} → {itData(c.data_fine)}</span><span className="small muted">{c.descrizione}{c.gruppo === 'TUTTE' ? ' (tutte le aree)' : ''}</span></li>)}</ul>}
        </Card>
      </div>
    </div>
  );
}

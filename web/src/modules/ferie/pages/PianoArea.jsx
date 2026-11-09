// Piano dell'area <nome> <anno>: tutte le persone dell'area (persone × mesi, persone × settimane, persone × giorni del mese), stato del
// piano di ciascuna, copertura minima con i giorni scoperti in rosso, modifica dei periodi direttamente nella griglia del mese (con nota;
// motivo obbligatorio nei piani definitivi), "Approva" e "Rendi definitivo" per persona e per tutta l'area, riapertura con motivo,
// variazioni da decidere, export XLSX e PDF dell'area. Per ogni persona "approva: <nome>" dall'anagrafica (superiore diretto, CEO
// 09/11/2026): le azioni compaiono solo su chi l'utente approva; i riporti dei livelli sotto sono in sola lettura. Il selettore delle
// aree serve all'amministratore e a chi ha riporti in più aree; il dipendente vede la propria area, senza saldi e note.
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, apiBase, qs, useApi } from '../api.js';
import { Card, Loading, Empty, PageHead, Field, Seg, Modal, PromptModal, ConfirmModal, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { StatoPianoBadge, Griglia, GrigliaMesi, GrigliaSettimane, Legenda, PeriodoModal } from '../components.jsx';
import { MESI, STATO_PIANO, itData, itDataOra, num, oggiIso, periodo, quantita } from '../format.js';

export default function PianoArea() {
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const oggi = oggiIso();
  const anno = Number(sp.get('anno')) || Number(oggi.slice(0, 4));
  const gruppoQ = sp.get('gruppo') || '';
  const [vista, setVista] = useState('mesi');
  const [mese, setMese] = useState(Number(oggi.slice(5, 7)));
  const [modal, setModal] = useState(null);
  const aree = useApi(`/aree?anno=${anno}`, [anno]);
  const lista = aree.data?.aree || [];
  const gruppo = gruppoQ || (lista.find((a) => a.gestita && !a.mia) || lista.find((a) => a.gestita) || lista.find((a) => a.mia) || lista[0])?.key || '';
  const { data, loading, error, reload } = useApi(gruppo ? `/area${qs({ gruppo, anno })}` : null, [gruppo, anno]);
  const set = (k, v) => { const o = { gruppo, anno: String(anno), [k]: String(v) }; setSp(o); };
  useEffect(() => { if (vista === 'mese' && anno !== Number(oggi.slice(0, 4))) setMese(1); }, [anno]);   // eslint-disable-line react-hooks/exhaustive-deps
  const ricarica = () => { reload(); aree.reload(); window.dispatchEvent(new Event('suite:badges')); };
  const fatto = (msg) => { toast(msg); setModal(null); ricarica(); };
  const azione = async (fn, msg) => { try { await fn(); fatto(msg); } catch (e) { toast(e, 'err'); } };

  if (aree.data && !lista.length) return <div className="page"><PageHead title="Piano dell'area" icon="calendar" /><Card><Empty icon="calendar" title="Nessun piano da mostrare">{aree.data.contratti === false ? 'Il modulo Contratti del personale non è ancora avviato: il perimetro dei dipendenti non è disponibile.' : 'Non sei nel perimetro del Piano Ferie e non gestisci nessuna area.'}</Empty></Card></div>;
  const selettore = lista.length > 1;
  const persone = data?.persone || [];
  const gestisce = data?.gestisce;
  const onCella = (p, d, per) => {
    const pi = p.piano;
    if (!pi) return;
    const motivo = pi.stato === 'DEFINITIVO';
    if (per) setModal({ tipo: 'modifica', persona: p, periodo: per, motivo });
    else setModal({ tipo: 'nuovo', persona: p, iniziale: { data_inizio: d, data_fine: d }, motivo });
  };
  const scopMese = (data?.scoperture || []).filter((s) => vista !== 'mese' || Number(s.data.slice(5, 7)) === mese);
  return (
    <div className="page">
      <PageHead title={data ? `Piano dell'area ${data.nome} ${anno}` : 'Piano dell\'area'} icon="calendar"
        sub={gestisce ? 'Rivedi i piani dei tuoi diretti: modifica i periodi nella griglia del mese, approva e rendi definitivo. Gli altri piani dell\'area li vedi in sola lettura: li approva il superiore diretto indicato.' : 'Il piano della tua area: nomi, periodi e chi approva ciascun piano (dall\'anagrafica).'}
        actions={<>
          {gestisce && data.azioni.approva_area > 0 && <button className="btn primary" onClick={() => setModal({ tipo: 'blocco', azione: 'approva' })}><Icon name="check" />Approva tutta l'area ({data.azioni.approva_area})</button>}
          {gestisce && data.azioni.definitivi_area > 0 && <button className="btn" onClick={() => setModal({ tipo: 'blocco', azione: 'definitivi' })}><Icon name="lock" />Rendi definitivi ({data.azioni.definitivi_area})</button>}
          <a className="btn ghost" href={`${apiBase}/export/piano.xlsx${qs({ gruppo, anno })}`} target="_blank" rel="noopener"><Icon name="sheet" />XLSX</a>
          <a className="btn ghost" href={`${apiBase}/export/piano.pdf${qs({ gruppo, anno, mese: vista === 'mese' ? mese : '' })}`} target="_blank" rel="noopener"><Icon name="pdf" />PDF {vista === 'mese' ? 'del mese' : 'dell\'anno'}</a>
        </>} />
      <div className="filters">
        {selettore && <Field label="Area"><select value={gruppo} onChange={(e) => set('gruppo', e.target.value)}>
          {lista.map((x) => <option key={x.key} value={x.key}>{x.area === 'Sedi' ? `Sede ${x.nome}` : x.nome} ({x.persone}){x.mia ? ' · la mia' : ''}</option>)}
        </select></Field>}
        <Field label="Anno"><select value={anno} onChange={(e) => set('anno', e.target.value)}>{[anno - 1, anno, anno + 1].map((a) => <option key={a} value={a}>{a}</option>)}</select></Field>
        <div className="fe-nav">
          <Seg value={vista} onChange={setVista} items={[{ value: 'mesi', label: 'Mesi' }, { value: 'settimane', label: 'Settimane' }, { value: 'mese', label: gestisce ? 'Mese (modifica)' : 'Mese' }]} label="Vista" />
          {vista === 'mese' && <>
            <button type="button" className="btn ghost sm" aria-label="Mese precedente" disabled={mese === 1} onClick={() => setMese(mese - 1)}><Icon name="back" /></button>
            <select value={mese} onChange={(e) => setMese(Number(e.target.value))} aria-label="Mese">{MESI.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
            <button type="button" className="btn ghost sm" aria-label="Mese successivo" disabled={mese === 12} onClick={() => setMese(mese + 1)}><Icon name="arrowRight" /></button>
          </>}
        </div>
      </div>
      {error ? <Card><Empty icon="alert" title="Errore">{error.message}</Empty></Card> : !data && loading ? <Loading /> : data && <>
        <div className="fe-kpis">
          {Object.entries(STATO_PIANO).map(([k, v]) => <div key={k} className={`fe-kpi ${k === 'PROPOSTO' && data.stati[k] ? 'warn' : ''}`}><div className="l">{v.breve}</div><div className="v">{data.stati[k] || 0}</div></div>)}
          <div className={`fe-kpi ${data.scoperture.length ? 'neg' : ''}`}><div className="l">Giorni scoperti</div><div className="v">{new Set(data.scoperture.map((s) => s.data)).size}</div><div className="f">{data.regole.length ? data.regole.map((r) => `${r.ruolo} ≥ ${r.minimo}`).join(', ') : 'nessuna regola di copertura'}</div></div>
          {gestisce && <div className={`fe-kpi ${data.variazioni.length ? 'warn' : ''}`}><div className="l">Variazioni da decidere</div><div className="v">{data.variazioni.length}</div></div>}
        </div>
        {data.scadenza && <div className="alert info"><Icon name="clock" /><span>I dipendenti inviano il piano {anno} entro il {itData(data.scadenza)}.</span></div>}
        <Card flush title={`${data.nome} · ${vista === 'mese' ? `${MESI[mese - 1]} ${anno}` : anno}`} icon="calendar"
          actions={<span className="small muted">{persone.length} {persone.length === 1 ? 'persona' : 'persone'}{gestisce && vista !== 'mese' ? ' · per modificare apri la vista Mese' : gestisce ? ' · clicca un giorno per aggiungere, un periodo per spostarlo o toglierlo' : ''}</span>}>
          {!persone.length ? <Empty icon="users" title="Nessuna persona in quest'area" compact />
            : vista === 'mesi' ? <GrigliaMesi piano={data} periodi={data.periodi} anno={anno} onMese={(m) => { setMese(m); setVista('mese'); }} />
              : vista === 'settimane' ? <GrigliaSettimane piano={data} periodi={data.periodi} anno={anno} onSettimana={(m) => { setMese(m); setVista('mese'); }} />
                : <Griglia piano={data} periodi={data.periodi} anno={anno} mese={mese} onCella={onCella} puoModificare={(p) => p.gestisce && p.piano && (p.piano.azioni?.modifica || p.piano.azioni?.modifica_con_motivo)} />}
          <Legenda />
        </Card>
        <Card title="Persone e stato del piano" icon="users" flush>
          <div className="table-wrap"><table className="t fe-table">
            <thead><tr><th>Persona</th><th>Piano</th><th>Approva</th>{gestisce && <><th className="num">Spettanti</th><th className="num">Pianificati</th><th className="num">Da pianificare</th></>}<th>Inviato</th><th>Approvato</th>{gestisce && <th>Azioni</th>}</tr></thead>
            <tbody>{persone.map((p) => {
              const a = p.piano?.azioni || {};
              return (
                <tr key={p.id} className={p.io ? 'fe-row-io' : ''}>
                  <td className="strong">{p.nome}{p.io && <span className="small muted"> (tu)</span>}<div className="small muted">{p.ruolo}{p.ha_accesso === false ? ' · senza accesso alla Suite' : ''}</div>{p.piano?.note && <div className="small">Note: {p.piano.note}</div>}</td>
                  <td>{p.piano ? <StatoPianoBadge stato={p.piano.stato} /> : '-'}{p.piano && <div className="small muted">versione {p.piano.versione}</div>}</td>
                  <td className="small">{p.gestisce ? <b>tu</b> : <span className={p.senza_superiore ? 'fe-neg' : ''}>{p.approva}</span>}{p.sola_lettura && <div className="muted">sola lettura</div>}{p.senza_superiore && <div className="muted">senza superiore in anagrafica</div>}</td>
                  {gestisce && <><td className="num">{p.saldo ? num(p.saldo.spettanza + p.saldo.residuo_ap) : ''}</td><td className="num">{p.saldo ? num(p.saldo.pianificato_totale) : ''}</td>
                    <td className={`num strong ${p.saldo?.da_pianificare < 0 ? 'fe-neg' : ''}`}>{p.saldo ? num(p.saldo.da_pianificare) : ''}</td></>}
                  <td className="small">{p.piano?.inviato_at ? itDataOra(p.piano.inviato_at) : ''}</td>
                  <td className="small">{p.piano?.approvato_at ? itDataOra(p.piano.approvato_at) : ''}{p.piano?.approvato_da_nome ? <div className="muted">{p.piano.approvato_da_nome}</div> : null}</td>
                  {gestisce && <td className="row tight" style={{ flexWrap: 'wrap' }}>
                    {a.prendi_in_carico && <button className="btn ghost sm" onClick={() => azione(() => api.post(`/piani/${p.piano.id}/prendi-in-carico`), 'Piano preso in carico')}>Prendi in carico</button>}
                    {a.approva && <button className="btn sm primary" onClick={() => setModal({ tipo: 'approva', persona: p })}><Icon name="check" />Approva</button>}
                    {a.definitivo && <button className="btn sm" onClick={() => setModal({ tipo: 'definitivo', persona: p })}><Icon name="lock" />Rendi definitivo</button>}
                    {a.riapri && <button className="btn ghost sm" onClick={() => setModal({ tipo: 'riapri', persona: p })}><Icon name="unlock" />Riapri</button>}
                  </td>}
                </tr>);
            })}</tbody>
          </table></div>
        </Card>
        <div className="fe-two">
          {gestisce ? (
            <Card title="Variazioni da decidere" icon="refresh" flush>
              {!data.variazioni.length ? <Empty icon="check" title="Nessuna variazione in attesa" compact /> : (
                <div className="table-wrap"><table className="t fe-table"><thead><tr><th>Persona</th><th>Variazione</th><th>Note</th><th /></tr></thead>
                  <tbody>{data.variazioni.map((v) => <tr key={v.id}>
                    <td className="strong">{v.persona}</td>
                    <td className="small">{v.variazione_proposta ? (v.variazione_proposta.tipo === 'RIMOZIONE' ? `Togliere ${periodo(v)}` : `Spostare ${periodo(v)} al ${itData(v.variazione_proposta.data_inizio)} → ${itData(v.variazione_proposta.data_fine)}`) : `Aggiungere ${periodo(v)} (${quantita(v)})`}</td>
                    <td className="small">{v.variazione_proposta?.note || v.note}</td>
                    <td className="row tight"><button className="btn sm primary" onClick={() => azione(() => api.post(`/variazioni/${v.id}/approva`, {}), 'Variazione approvata')}><Icon name="check" />Approva</button>
                      <button className="btn sm ghost" onClick={() => setModal({ tipo: 'rifiuta', variazione: v })}><Icon name="x" />Rifiuta</button></td>
                  </tr>)}</tbody></table></div>)}
            </Card>
          ) : <div />}
          <div className="grid">
            <Card title={`Sotto la copertura minima ${vista === 'mese' ? `(${MESI[mese - 1]})` : `(${anno})`}`} icon="alert">
              {!data.regole.length ? <div className="small muted">Nessuna regola di copertura per quest'area (Impostazioni del modulo).</div>
                : !scopMese.length ? <div className="small muted">Con i periodi del piano la copertura minima è sempre rispettata.</div>
                  : <ul className="fe-list">{scopMese.slice(0, 40).map((s, i) => <li key={i}><span className="strong fe-neg">{itData(s.data)}</span><span className="small">{s.ruolo}: {num(s.presenti)} presenti su {s.minimo}</span></li>)}</ul>}
            </Card>
            <Card title="Chiusure collettive" icon="building">
              {!data.chiusure.length ? <div className="small muted">Nessuna chiusura collettiva nell'anno per quest'area.</div>
                : <ul className="fe-list">{data.chiusure.map((c) => <li key={c.id}><span className="strong">{itData(c.data_inizio)} → {itData(c.data_fine)}</span><span className="small muted">{c.descrizione}{c.gruppo === 'TUTTE' ? ' (tutte le aree)' : ''}</span></li>)}</ul>}
            </Card>
          </div>
        </div>
      </>}

      {modal?.tipo === 'nuovo' && <PeriodoModal pianoId={modal.persona.piano.id} titolo="Aggiungi un periodo" persona={`${modal.persona.nome} · piano ${STATO_PIANO[modal.persona.piano.stato]?.label?.toLowerCase()}`} modo="responsabile" motivoObbligatorio={modal.motivo}
        iniziale={modal.iniziale} onClose={() => setModal(null)} avviso={modal.persona.piano.stato === 'PROPOSTO' || modal.persona.piano.stato === 'BOZZA' ? 'Modificando il piano lo prendi in carico: il dipendente non potrà più cambiarlo finché non lo approvi.' : null}
        onSalva={async (b) => { await api.post(`/piani/${modal.persona.piano.id}/periodi`, b); fatto('Periodo aggiunto'); }} />}
      {modal?.tipo === 'modifica' && <PeriodoModal pianoId={modal.persona.piano.id} titolo="Periodo del piano" persona={`${modal.persona.nome} · ${periodo(modal.periodo)}`} modo="responsabile" motivoObbligatorio={modal.motivo}
        iniziale={modal.periodo} esistente={modal.periodo} onClose={() => setModal(null)}
        onSalva={async (b) => { await api.put(`/piani/${modal.persona.piano.id}/periodi/${modal.periodo.id}`, b); fatto('Periodo spostato'); }}
        onTogli={async (nota) => { await api.del(`/piani/${modal.persona.piano.id}/periodi/${modal.periodo.id}`, { nota }); fatto('Periodo tolto'); }} />}
      {modal?.tipo === 'approva' && <NotaModal titolo={`Approva il piano ${anno} di ${modal.persona.nome}`} testo={modal.persona.piano.stato === 'BOZZA' ? 'Il dipendente non ha ancora inviato il piano: approvandolo i periodi inseriti diventano approvati.' : 'I periodi del piano diventano approvati. Potrai ancora modificarlo finché non lo rendi definitivo.'}
        conferma="Approva" onClose={() => setModal(null)} onConferma={(nota) => azione(() => api.post(`/piani/${modal.persona.piano.id}/approva`, { nota }), 'Piano approvato')} />}
      {modal?.tipo === 'definitivo' && <NotaModal titolo={`Rendi definitivo il piano ${anno} di ${modal.persona.nome}`} testo="Il piano si blocca: da ora i periodi li cambiano solo il responsabile o l'amministratore, con motivo; il dipendente propone variazioni."
        conferma="Rendi definitivo" onClose={() => setModal(null)} onConferma={(nota) => azione(() => api.post(`/piani/${modal.persona.piano.id}/definitivo`, { nota }), 'Piano definitivo')} />}
      {modal?.tipo === 'riapri' && <PromptModal title={`Riapri il piano ${anno} di ${modal.persona.nome}`} label="Motivo (lo legge il dipendente)" type="textarea" minLength={3} confirmText="Riapri"
        onClose={() => setModal(null)} onConfirm={async (nota) => { await api.post(`/piani/${modal.persona.piano.id}/riapri`, { nota }); toast('Piano riaperto: torna approvato'); ricarica(); }} />}
      {modal?.tipo === 'rifiuta' && <PromptModal title={`Rifiuta la variazione di ${modal.variazione.persona}`} label="Motivo (lo legge il dipendente)" type="textarea" minLength={3} confirmText="Rifiuta"
        onClose={() => setModal(null)} onConfirm={async (nota) => { await api.post(`/variazioni/${modal.variazione.id}/rifiuta`, { nota }); toast('Variazione non accolta'); ricarica(); }} />}
      {modal?.tipo === 'blocco' && <ConfirmModal title={modal.azione === 'approva' ? `Approva tutta l'area ${data.nome}` : `Rendi definitivi i piani dell'area ${data.nome}`}
        text={modal.azione === 'approva' ? `Approvi i ${data.azioni.approva_area} piani inviati o in revisione. I piani ancora in bozza restano da inviare.` : `Rendi definitivi i ${data.azioni.definitivi_area} piani approvati.`}
        confirmText={modal.azione === 'approva' ? 'Approva tutti' : 'Rendi definitivi'} onClose={() => setModal(null)}
        onConfirm={async () => { const r = await api.post(`/area/${modal.azione === 'approva' ? 'approva' : 'definitivi'}`, { gruppo, anno }); toast(`${r.fatti.length} piani ${modal.azione === 'approva' ? 'approvati' : 'resi definitivi'}${r.saltati.length ? ` · ${r.saltati.length} non toccati (${r.saltati.map((x) => `${x.persona}: ${x.motivo}`).join('; ')})` : ''}`); ricarica(); }} />}
    </div>
  );
}

function NotaModal({ titolo, testo, conferma, onClose, onConferma }) {
  const [nota, setNota] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={titolo} onClose={onClose} footer={<><button className="btn ghost" onClick={onClose}>Annulla</button><button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); await onConferma(nota); setBusy(false); }}>{conferma}</button></>}>
      <div className="fe-form"><p className="small">{testo}</p><Field label="Nota per il dipendente (facoltativa)"><textarea rows={2} maxLength={1000} value={nota} onChange={(e) => setNota(e.target.value)} /></Field></div>
    </Modal>
  );
}

// La mia catena <anno>: l'albero dei riporti del responsabile secondo l'anagrafica ("Dipende da" di Amministrazione > Persone), con lo stato
// del piano e i saldi di ciascuno (CEO, 09/11/2026: "dobbiamo recepire non solo le aree ma anche il secondo livello ... Segui
// pedissequamente quanto indicato in organigramma"). I piani dei DIRETTI li approva e li rende definitivi il responsabile (azioni sulla
// riga); i livelli sotto li vede in sola lettura, con "approva: <nome>". L'amministratore sceglie da quale persona partire.
import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, base, qs, useApi } from '../api.js';
import { Card, Loading, Empty, PageHead, Field, Seg, ConfirmModal, Badge, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { StatoPianoBadge } from '../components.jsx';
import { STATO_PIANO, num, oggiIso } from '../format.js';

export default function Catena() {
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const anno0 = Number(oggiIso().slice(0, 4));
  const anno = Number(sp.get('anno')) || anno0;
  const personId = sp.get('person_id') || '';
  const { data, loading, error, reload } = useApi(`/catena${qs({ anno, person_id: personId })}`, [anno, personId]);
  const [modal, setModal] = useState(null);
  const set = (k, v) => { const o = { anno: String(anno), person_id: personId, [k]: String(v) }; setSp(Object.fromEntries(Object.entries(o).filter(([, x]) => x))); };
  const ricarica = () => { reload(); window.dispatchEvent(new Event('suite:badges')); };
  if (error) return <div className="page"><Empty icon="alert" title="Errore">{error.message}</Empty></div>;
  if (!data && loading) return <div className="page"><Loading /></div>;
  if (!data) return null;
  if (!data.radice) return <div className="page"><PageHead title="La mia catena" icon="tree" /><Card><Empty icon="info" title="Nessuna catena da mostrare">{data.motivo}</Empty></Card></div>;
  const righe = [];
  const giro = (n) => { righe.push(n); n.figli.forEach(giro); };
  giro(data.radice);
  const r = data.radice;
  return (
    <div className="page">
      <PageHead title={`${r.io ? 'La mia catena' : `Catena di ${r.nome}`} ${anno}`} icon="tree"
        sub="I tuoi riporti come indicato in anagrafica (Dipende da). I piani dei diretti li approvi e li rendi definitivi tu; quelli dei livelli sotto li vedi in sola lettura: li approva il loro superiore diretto."
        actions={<Seg value={anno} onChange={(a) => set('anno', a)} items={(data.anni || [anno0 - 1, anno0, anno0 + 1]).map((a) => ({ value: a, label: String(a) }))} label="Anno" />} />
      {data.admin && data.radici?.length > 0 && (
        <div className="filters">
          <Field label="Parti da"><select value={personId || r.id} onChange={(e) => set('person_id', e.target.value)}>
            {!data.radici.some((x) => x.id === r.id) && <option value={r.id}>{r.nome}</option>}
            {data.radici.map((x) => <option key={x.id} value={x.id}>{x.nome} ({x.riporti} {x.riporti === 1 ? 'diretto' : 'diretti'})</option>)}
          </select></Field>
        </div>
      )}
      <div className="fe-kpis">
        <div className="fe-kpi main"><div className="l">Persone nella catena</div><div className="v">{data.conta.persone}</div><div className="f">dipendenti del Piano Ferie</div></div>
        <div className="fe-kpi"><div className="l">Diretti</div><div className="v">{data.conta.diretti}</div><div className="f">{r.io ? 'li approvi tu' : `li approva ${r.nome}`}</div></div>
        {Object.entries(STATO_PIANO).map(([k, v]) => <div key={k} className={`fe-kpi ${k === 'PROPOSTO' && data.conta.stati[k] ? 'warn' : ''}`}><div className="l">{v.breve}</div><div className="v">{data.conta.stati[k] || 0}</div></div>)}
      </div>
      <Card flush title="Riporti e stato del piano" icon="tree" actions={<span className="small muted">Dall'anagrafica: Amministrazione &gt; Persone, "Dipende da"</span>}>
        <div className="table-wrap"><table className="t fe-table fe-catena">
          <thead><tr><th>Persona</th><th>Area</th><th>Piano {anno}</th><th>Approva</th><th className="num">Spettanti</th><th className="num">Pianificati</th><th className="num">Da pianificare</th><th>Azioni</th></tr></thead>
          <tbody>{righe.map((n) => {
            const a = n.piano?.azioni || {};
            return (
              <tr key={n.id} className={n.io ? 'fe-row-io' : n.senza_superiore || n.approvatore_irraggiungibile ? 'fe-row-warn' : ''}>
                <td><div className="fe-ramo" style={{ paddingLeft: n.livello * 22 }}>
                  {n.livello > 0 && <span className="fe-ramo-segno" aria-hidden="true">└</span>}
                  <div>
                    <div className="strong">{n.nome}{n.io && <span className="small muted"> (tu)</span>}</div>
                    <div className="small muted">{[n.ruolo, !n.in_perimetro && !n.io ? 'fuori dal Piano Ferie' : null].filter(Boolean).join(' · ')}</div>
                    <div className="row tight" style={{ flexWrap: 'wrap', marginTop: 2 }}>
                      {n.diretto && <Badge tone="teal">diretto</Badge>}
                      {n.sola_lettura && <Badge tone="grey">sola lettura</Badge>}
                      {n.interviene_admin && n.piano && ['PROPOSTO', 'IN_REVISIONE'].includes(n.piano.stato) && !n.approvatore_id && <Badge tone="amber">decide l'amministratore</Badge>}
                      {n.cessato && <Badge tone="red">cessato</Badge>}
                      {n.senza_accesso && <Badge tone="amber">senza accesso</Badge>}
                      {n.vertice && <Badge tone="blue">vertice</Badge>}
                    </div>
                  </div>
                </div></td>
                <td className="small">{n.gruppo_nome || ''}</td>
                <td>{n.piano ? <><StatoPianoBadge stato={n.piano.stato} breve />{n.piano.nota_approvatore && <div className="small muted">{n.piano.nota_approvatore}</div>}</> : <span className="small muted">-</span>}</td>
                <td className="small">{n.in_perimetro ? (n.vertice ? 'nessuno (vertice)' : n.approvatore || <span className="fe-neg">amministratore</span>) : ''}
                  {n.in_perimetro && (n.risalito || n.senza_superiore || n.approvatore_irraggiungibile) && <div className="muted">{n.approvatore_origine}</div>}</td>
                <td className="num">{n.saldo ? num(n.saldo.spettanza + n.saldo.residuo_ap) : ''}</td>
                <td className="num">{n.saldo ? num(n.saldo.pianificato_totale) : ''}</td>
                <td className={`num strong ${n.saldo?.da_pianificare < 0 ? 'fe-neg' : ''}`}>{n.saldo ? num(n.saldo.da_pianificare) : ''}</td>
                <td><div className="row tight" style={{ flexWrap: 'wrap' }}>
                  {a.approva && <button className="btn sm primary" title={n.diretto ? undefined : `Lo approva ${n.approvatore || 'l\'amministratore'}: intervieni come amministratore`} onClick={() => setModal({ azione: 'approva', n })}><Icon name="check" />Approva</button>}
                  {a.definitivo && <button className="btn sm" onClick={() => setModal({ azione: 'definitivo', n })}><Icon name="lock" />Rendi definitivo</button>}
                  {n.gruppo && !n.io && <Link className="btn ghost sm" to={`${base}/area${qs({ gruppo: n.gruppo, anno })}`}>Nell'area</Link>}
                </div></td>
              </tr>);
          })}</tbody>
        </table></div>
        {righe.length === 1 && <Empty icon="users" title="Nessun riporto" compact>In anagrafica nessuno dipende da {r.io ? 'te' : r.nome}.</Empty>}
      </Card>
      {modal && <ConfirmModal title={modal.azione === 'approva' ? `Approva il piano ${anno} di ${modal.n.nome}` : `Rendi definitivo il piano ${anno} di ${modal.n.nome}`}
        text={modal.azione === 'approva' ? 'I periodi del piano diventano approvati. Puoi ancora modificarlo dal piano dell\'area finché non lo rendi definitivo.' : 'Il piano si blocca: da ora i periodi li cambi solo tu (o l\'amministratore) con un motivo; il dipendente propone variazioni.'}
        confirmText={modal.azione === 'approva' ? 'Approva' : 'Rendi definitivo'} onClose={() => setModal(null)}
        onConfirm={async () => { await api.post(`/piani/${modal.n.piano.id}/${modal.azione}`, {}); toast(modal.azione === 'approva' ? 'Piano approvato' : 'Piano definitivo'); ricarica(); }} />}
    </div>
  );
}

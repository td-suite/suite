// Vista di una sintesi di Claude: giudizio, livello, aree con punti di forza / criticità / azioni per urgenza, piano di miglioramento,
// trend, note sulle terze parti; per la rete anche classifica e aree deboli; per i partner rischio residuo e classifica.
import React from 'react';
import { Card, Empty } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { Score, Level, Bar, UrgenzaBadge, RischioBadge } from './Score.jsx';
import { itDateTime, levelOf } from '../format.js';

export function Azioni({ items, empty = 'Nessuna azione suggerita' }) {
  const list = (items || []).slice().sort((a, b) => ['ALTA', 'MEDIA', 'BASSA'].indexOf(a.urgenza) - ['ALTA', 'MEDIA', 'BASSA'].indexOf(b.urgenza));
  if (!list.length) return <div className="small muted">{empty}</div>;
  return <ul className="au-azioni">{list.map((a, i) => <li key={i}><UrgenzaBadge u={a.urgenza} /><div>{a.descrizione}<div className="meta">{[a.responsabile_suggerito, a.entro_giorni != null ? `entro ${a.entro_giorni} giorni` : null].filter(Boolean).join(' · ')}</div></div></li>)}</ul>;
}
export function Piano({ fasi }) {
  if (!fasi?.length) return <div className="small muted">Nessun piano di miglioramento</div>;
  return <div className="au-piano">{fasi.map((f, i) => <div className="au-fase" key={i}><div className="n">{f.fase || i + 1}</div><div><div className="strong">{f.obiettivo}</div>{f.azioni?.length ? <ul style={{ margin: '4px 0', paddingLeft: 18 }}>{f.azioni.map((a, j) => <li key={j}>{a}</li>)}</ul> : null}<div className="small muted">{[f.scadenza ? `Scadenza: ${f.scadenza}` : null, f.indicatore ? `Indicatore: ${f.indicatore}` : null].filter(Boolean).join(' · ')}</div></div></div>)}</div>;
}
export function Aree({ aree }) {
  if (!aree?.length) return null;
  return <div className="au-aree">{aree.map((a, i) => <div className="au-area" key={i}>
    <div className="t"><span>{a.area}</span>{a.livello != null && <Score value={a.livello} />}</div>
    {a.livello != null && <Bar value={a.livello} />}
    {a.punti_di_forza?.length ? <><div className="k">Punti di forza</div><ul>{a.punti_di_forza.map((s, j) => <li key={j}>{s}</li>)}</ul></> : null}
    {a.criticita?.length ? <><div className="k">Criticità</div><ul>{a.criticita.map((s, j) => <li key={j}>{s}</li>)}</ul></> : null}
    {a.azioni?.length ? <><div className="k">Azioni</div><Azioni items={a.azioni} /></> : null}
  </div>)}</div>;
}

export default function Sintesi({ sintesi, scope = 'SEDE', actions, title }) {
  if (!sintesi) return <Card title={title || 'Sintesi'} icon="sparkle" actions={actions}><Empty icon="sparkle" title="Nessuna sintesi generata">Genera la sintesi con Claude: analizza gli audit presenti e produce il livello di allineamento con le azioni per urgenza.</Empty></Card>;
  const r = sintesi.result || {};
  const score = scope.startsWith('LEGAL') ? r.livello_conformita : r.livello_allineamento;
  const letter = r.livello_lettera || levelOf(score);
  return (
    <div className="au-synth">
      <Card title={title || (scope === 'TD' ? 'Sintesi della rete' : scope === 'SEDE' ? 'Sintesi della sede' : 'Sintesi ISO 37001')} icon="sparkle" actions={actions}>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 20, alignItems: 'start' }}>
          <div><Score value={score} big level={letter} /><div style={{ marginTop: 6 }}><Level letter={letter} /></div>{scope.startsWith('LEGAL') && <div style={{ marginTop: 6 }}><RischioBadge r={r.rischio_residuo} /></div>}</div>
          <div>
            <div className="au-giudizio">{r.giudizio}</div>
            <div className="small muted" style={{ marginTop: 8 }}>Generata il {itDateTime(sintesi.generated_at)}{sintesi.generated_by_name ? ` da ${sintesi.generated_by_name}` : ''} · modello {sintesi.model || 'n.d.'}{sintesi.inputs?.audit_ids ? ` · ${sintesi.inputs.audit_ids.length} audit considerati` : ''}{sintesi.inputs?.troncato ? ' · parte dei testi di terze parti è stata omessa per lunghezza' : ''}</div>
            {r.dati_sufficienti === false && <div className="au-alert warn" style={{ marginTop: 8 }}><Icon name="alert" className="ico" /><div>Dati pochi o incompleti: il giudizio va letto con cautela.</div></div>}
            <div className="small muted" style={{ marginTop: 6 }}>Giudizio assistito dall'intelligenza artificiale: va verificato da Qualità, che resta responsabile della valutazione.</div>
          </div>
        </div>
      </Card>
      {r.classifica?.length ? <Card title={scope === 'TD' ? 'Classifica delle sedi' : 'Classifica dei partner'} icon="list" flush>
        <table className="t au-table"><thead><tr><th>#</th><th>{scope === 'TD' ? 'Sede' : 'Partner'}</th><th>Livello</th><th></th>{scope !== 'TD' && <th>Rischio</th>}<th>Nota</th></tr></thead>
          <tbody>{r.classifica.map((c, i) => <tr key={i}><td className="muted">{i + 1}</td><td className="strong">{c.sede || c.partner}</td><td><Score value={c.livello} /></td><td><Level value={c.livello} letter={c.lettera} short /></td>{scope !== 'TD' && <td><RischioBadge r={c.rischio} /></td>}<td className="small">{c.nota}</td></tr>)}</tbody></table>
      </Card> : null}
      {r.aree_deboli?.length ? <Card title="Aree deboli ricorrenti nel network" icon="alert"><ul className="au-list">{r.aree_deboli.map((a, i) => <li key={i}><div><b>{a.area}</b> <span className="small muted">{(a.sedi_coinvolte || []).join(', ')}</span><div className="small">{a.descrizione}</div></div></li>)}</ul></Card> : null}
      {r.aree?.length ? <Card title="Aree di competenza" icon="grid"><Aree aree={r.aree} /></Card> : null}
      {(r.azioni_trasversali?.length || r.azioni?.length) ? <Card title={scope === 'TD' ? 'Azioni trasversali per urgenza' : 'Azioni per urgenza'} icon="check"><Azioni items={r.azioni_trasversali || r.azioni} /></Card> : null}
      {r.piano_miglioramento?.length ? <Card title="Piano di miglioramento" icon="calendar"><Piano fasi={r.piano_miglioramento} /></Card> : null}
      {(r.trend || r.note_terze_parti) && <Card title="Trend e terze parti" icon="stats">{r.trend && <p><b>Trend.</b> {r.trend}</p>}{r.note_terze_parti && <p><b>Terze parti.</b> {r.note_terze_parti}</p>}</Card>}
    </div>
  );
}

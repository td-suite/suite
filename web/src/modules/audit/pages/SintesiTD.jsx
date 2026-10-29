// Sintesi TD: giudizio complessivo sulle sedi (classifica, aree deboli ricorrenti, azioni trasversali, piano di rete) con Claude
import React, { useState } from 'react';
import { api, useApi } from '../api.js';
import { Card, Loading, Empty, PageHead, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useAuth, isAuditor } from '../index.jsx';
import { Score, Level } from '../components/Score.jsx';
import Sintesi from '../components/Sintesi.jsx';
import { itDateTime, pct } from '../format.js';

export default function SintesiTD() {
  const { user } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useApi('/sintesi/td');
  const [busy, setBusy] = useState(false);
  if (error) return <div className="page"><Empty icon="alert" title="Errore">{error.message}</Empty></div>;
  if (!data && loading) return <div className="page"><Loading /></div>;
  const auditor = isAuditor(user);
  const gen = async () => { setBusy(true); try { const r = await api.post('/sintesi/td'); toast(`Sintesi TD generata: ${pct(r.score)} (${r.level})`); reload(); } catch (e) { toast(e, 'err'); } setBusy(false); };
  return (
    <div className="page">
      <PageHead title="Sintesi TD" icon="sparkle" sub="Giudizio complessivo di Toscana Diagnostica: tutte le sedi con l'ultima sintesi o i punteggi degli ultimi 12 mesi, classifica, aree deboli ricorrenti nel network, azioni trasversali per urgenza, piano di miglioramento di rete."
        actions={auditor && <button className="btn" disabled={busy} onClick={gen}><Icon name="sparkle" />{busy ? 'Analisi in corso' : data.sintesi ? 'Rigenera con Claude' : 'Genera con Claude'}</button>} />
      {data.ai && !data.ai.enabled && <div className={`au-alert ${data.ai.mock ? 'warn' : 'err'}`}><Icon name="alert" className="ico" /><div>{data.ai.message}</div></div>}
      <Sintesi sintesi={data.sintesi} scope="TD" />
      {data.storico?.length > 1 && <Card title="Sintesi precedenti" icon="clock" flush style={{ marginTop: 14 }}><table className="t au-table"><thead><tr><th>Data</th><th>Livello</th><th></th><th>Modello</th></tr></thead><tbody>{data.storico.map((s) => <tr key={s.id}><td>{itDateTime(s.generated_at)}</td><td><Score value={s.score} /></td><td><Level letter={s.level} /></td><td className="small muted">{s.model}</td></tr>)}</tbody></table></Card>}
    </div>
  );
}

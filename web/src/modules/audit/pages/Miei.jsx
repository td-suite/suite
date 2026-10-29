// I miei audit: per il site manager l'auto-audit del mese corrente (creato al volo) e gli audit della sua sede; per gli altri profili
// gli audit in carico (condotti, da verificare, delle sedi gestite).
import React from 'react';
import { Link } from 'react-router-dom';
import { base, useApi } from '../api.js';
import { Card, Loading, Empty, PageHead, Badge } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { useAuth, isSite } from '../index.jsx';
import { KindBadge, StatusBadge, ScoreCell, Level } from '../components/Score.jsx';
import { mese, dataAudit, soggetto, itDateTime } from '../format.js';

export default function Miei() {
  const { user } = useAuth();
  const { data, loading, error } = useApi('/audits/miei');
  if (error) return <div className="page"><Empty icon="alert" title="Errore">{error.message}</Empty></div>;
  if (!data && loading) return <div className="page"><Loading /></div>;
  const site = isSite(user);
  const correnti = data.rows.filter((a) => data.correnti.includes(a.id));
  const altri = data.rows.filter((a) => !data.correnti.includes(a.id));
  return (
    <div className="page">
      <PageHead title="I miei audit" icon="check" sub={site ? `Auto-audit del mese di ${mese(data.period)} della tua sede: compila tutte le voci, salva quando vuoi e poi invia a Qualità entro fine mese.` : 'Gli audit che hai in carico: auto-audit inviati dalle sedi da verificare, audit che conduci, audit delle sedi che gestisci.'} />
      {correnti.length > 0 && <div className="grid au-two">{correnti.map((a) => (
        <Card key={a.id} title={`Auto-audit ${mese(a.period)} · ${a.site_name}`} icon="audit" actions={<StatusBadge s={a.status} />}>
          <div className="row" style={{ gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
            <div><div className="small muted">Punteggio sede</div><ScoreCell a={a} /></div>
            <div><div className="small muted">Livello</div><Level letter={a.level} /></div>
            <div><div className="small muted">NC</div><b>{a.n_nc}</b></div>
            <div className="spacer" />
            <Link className="btn" to={`${base}/miei/${a.id}`}><Icon name={a.status === 'BOZZA' ? 'edit' : 'eye'} />{a.status === 'BOZZA' ? 'Compila' : 'Apri'}</Link>
          </div>
          {a.status === 'BOZZA' && <div className="au-alert warn" style={{ marginTop: 12, marginBottom: 0 }}><Icon name="alert" className="ico" /><div>Non ancora inviato: entro la fine del mese compila le voci e premi "Invia a Qualità".</div></div>}
          {a.status === 'INVIATO' && <div className="au-alert" style={{ marginTop: 12, marginBottom: 0 }}><Icon name="info" className="ico" /><div>Inviato il {itDateTime(a.conducted_at)}: in attesa della verifica di Qualità.</div></div>}
          {a.status === 'VERIFICATO' && <div className="au-alert ok" style={{ marginTop: 12, marginBottom: 0 }}><Icon name="check" className="ico" /><div>Verificato da {a.verified_by_name || 'Qualità'} il {itDateTime(a.verified_at)}: la colonna Verifica è visibile nel modulo.</div></div>}
        </Card>))}</div>}
      <Card title={site ? 'Audit della tua sede' : 'Audit in carico'} icon="folder" flush>
        {!altri.length ? <Empty icon="folder" title={site ? 'Nessun altro audit' : 'Nessun audit in carico'}>{site ? 'Qui compaiono i mesi precedenti, gli audit interni e i rapporti di terze parti della tua sede.' : 'Gli auto-audit inviati dalle sedi compaiono qui da verificare; gli audit interni e sui partner che conduci restano qui fino alla chiusura.'}</Empty> : (
          <div className="table-wrap"><table className="t au-table">
            <thead><tr><th>Data / mese</th><th>Tipo</th><th>Sede / partner</th><th>Condotto da</th><th>Stato</th><th>Punteggio</th><th>Livello</th><th>NC</th><th></th></tr></thead>
            <tbody>{altri.map((a) => <tr key={a.id}>
              <td><Link className="strong" to={`${base}/audit/${a.id}`}>{dataAudit(a)}</Link></td><td><KindBadge k={a.kind} /></td><td>{soggetto(a)}</td><td className="small">{a.header?.effettuato_da || a.conducted_by_name || '–'}</td><td><StatusBadge s={a.status} /></td><td><ScoreCell a={a} /></td><td><Level letter={a.level} short /></td><td>{a.n_nc || 0}</td>
              <td className="actions"><Link className="btn sm ghost" to={`${base}/audit/${a.id}`}>{a.kind === 'AUTO' && a.status === 'INVIATO' && !site ? 'Verifica' : 'Apri'}</Link></td></tr>)}</tbody>
          </table></div>)}
      </Card>
      {!site && <div className="small muted" style={{ marginTop: 10 }}>Gli audit interni e sui partner si creano dalle pagine <Link to={`${base}/sedi`}>Sedi</Link> e <Link to={`${base}/partner`}>Partner ISO 37001</Link>.</div>}
    </div>
  );
}

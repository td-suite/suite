import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { base, useApi } from '../api.js';
import { useAuth, canEdit } from '../auth.jsx';
import { Card, Loading, Empty, Badge, PageHead } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { STATO, SEGMENTO, itDate } from '../format.js';

export default function Cruscotto() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { data, error } = useApi('/circolari/riepilogo');
  const caps = useApi('/capabilities');
  const stati = data?.stati || {};
  return (
    <div className="page">
      <PageHead title="Circolari aziendali" icon="doc" sub="Registro unico delle circolari: protocollo TD-AAAA/NNN assegnato alla pubblicazione, impaginazione sulla carta intestata in Word e PDF, archivio con ricerca sul contenuto, invio ai clienti." actions={canEdit(user) && <Link className="btn" to={`${base}/nuova`}><Icon name="plus" />Nuova circolare</Link>} />
      {error && <Empty icon="alert" title="Dati non disponibili">{error.message}</Empty>}
      <div className="circ-kpis">
        <div className="card kpi"><div className="lbl">Pubblicate</div><div className="val">{stati.PUBBLICATA || 0}</div><div className="foot">in vigore</div></div>
        <div className="card kpi"><div className="lbl">Bozze</div><div className="val">{stati.BOZZA || 0}</div><div className="foot">da completare</div></div>
        <div className="card kpi"><div className="lbl">Superate o annullate</div><div className="val">{(stati.SUPERATA || 0) + (stati.ANNULLATA || 0)}</div><div className="foot">restano in archivio</div></div>
        <div className="card kpi"><div className="lbl">Invii</div><div className="val">{data?.invii?.n || 0}</div><div className="foot">{data?.invii?.inviati || 0} email consegnate al server di posta</div></div>
        <div className="card kpi"><div className="lbl">Letture dal QR</div><div className="val">{data?.letture || 0}</div><div className="foot">aperture della versione digitale</div></div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)' }}>
        <Card title="Ultime circolari pubblicate" icon="news" flush actions={<Link to={`${base}/archivio`} className="small">Archivio completo</Link>}>
          {!data ? <Loading /> : !data.ultime.length ? <Empty icon="doc" title="Nessuna circolare pubblicata">{canEdit(user) ? 'Crea la prima circolare da "Nuova circolare": da un file del laboratorio o compilando la scheda.' : 'Le circolari pubblicate compariranno qui.'}</Empty> : (
            <div className="table-wrap"><table className="t">
              <thead><tr><th>Protocollo</th><th>Titolo</th><th>Destinatari</th><th>Data</th><th></th></tr></thead>
              <tbody>{data.ultime.map((c) => (
                <tr key={c.id} className="click" onClick={() => nav(`${base}/${c.id}`)}>
                  <td className="circ-prot">{c.protocollo}</td>
                  <td><div className="strong">{c.titolo}</div><div className="small muted">{c.tipo} · {c.linea}</div></td>
                  <td className="small">{SEGMENTO[c.segmento] || c.segmento}</td>
                  <td className="small">{itDate(c.data)}</td>
                  <td><Badge tone={STATO[c.stato].tone}>{STATO[c.stato].label}</Badge></td>
                </tr>))}</tbody>
            </table></div>)}
        </Card>
        <div className="grid">
          <Card title="Per anno" icon="calendar">
            {!data ? <Loading /> : !data.anni.length ? <div className="muted small">Nessun protocollo assegnato.</div> : data.anni.map((a) => <div key={a.anno} className="row between" style={{ padding: '4px 0' }}><Link to={`${base}/archivio?anno=${a.anno}`}>{a.anno}</Link><span className="strong">{a.n}</span></div>)}
          </Card>
          <Card title="Stato del sistema" icon="gear">
            <div className="small">
              <div className="row between" style={{ padding: '4px 0' }}><span>PDF (LibreOffice)</span>{caps.data ? <Badge tone={caps.data.pdf ? 'green' : 'amber'}>{caps.data.pdf ? 'attivo' : 'non disponibile'}</Badge> : <span className="muted">...</span>}</div>
              <div className="row between" style={{ padding: '4px 0' }}><span>Strutturazione con Claude</span>{caps.data ? <Badge tone={caps.data.ai ? 'green' : 'amber'}>{caps.data.ai ? 'attiva' : 'non configurata'}</Badge> : <span className="muted">...</span>}</div>
              <div className="muted" style={{ marginTop: 8 }}>Senza PDF la circolare resta in Word; senza Claude la bozza grezza viene strutturata con regole semplici e si rifinisce a mano.</div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

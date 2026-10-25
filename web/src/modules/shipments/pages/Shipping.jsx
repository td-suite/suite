import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n.jsx';
import { Card, useApi } from '../components/ui.jsx';
import { OrdersTable } from '../components/orders.jsx';
import { qs } from '../api.js';
import { projectPath } from '../format.js';

export default function Shipping({ project, orderType }) {
  const { t } = useT();
  const [tab, setTab] = useState('ready');
  const status = tab === 'ready' ? 'ASSIGNED' : tab === 'new' ? 'NEW' : tab === 'transit' ? 'SHIPPED' : 'DELIVERED';
  const { data } = useApi(`/orders${qs({ project, status, order_type: orderType || '', limit: 500 })}`, [tab]);
  const p = projectPath(project);
  const title = orderType === 'KIT_AND_EXAM' ? t('nav.shipKitExam') : orderType === 'KIT_ONLY' ? t('nav.shipKit') : t('ship.title');
  return (
    <div className="page">
      <div className="page-head"><div><h1>{title}</h1><div className="sub">{t('ship.sub')}</div></div></div>
      <div className="tabs">{[['new', t('ship.toAssign')], ['ready', t('ship.ready')], ['transit', t('ship.inTransit')], ['delivered', t('ship.delivered')]].map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
      <Card flush>
        <OrdersTable rows={data} project={project} columns={tab === 'ready' || tab === 'new' ? ['ref', 'patient', 'kit', 'mode', 'status', 'date'] : ['ref', 'patient', 'kit', 'mode', 'status', 'tracking', tab === 'transit' ? 'shipped' : 'delivered']}
          actions={(o) => <Link className="btn sm" to={`/${p}/richieste/${o.id}`}>{tab === 'new' ? t('ord.assign') : tab === 'ready' ? t('ord.ship') : t('c.open')}</Link>} />
      </Card>
    </div>
  );
}

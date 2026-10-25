import React from 'react';
import { Link } from 'react-router-dom';
import { useT, LangToggle } from '../i18n.jsx';
import { Icon, useApi } from '../components/ui.jsx';

// Scelta del progetto (Endeavor DNA / Lifestyle). Nella Suite è una pagina normale: niente intestazione né uscita propria.
export default function Home() {
  const { t } = useT();
  const e = useApi('/orders/counts?project=ENDEAVOR');
  const l = useApi('/orders/counts?project=LIFESTYLE');
  const se = useApi('/kits/summary?project=ENDEAVOR');
  const sl = useApi('/kits/summary?project=LIFESTYLE');
  const openN = (c) => (c.data?.byStatus || []).filter((x) => !['CLOSED', 'CANCELLED'].includes(x.status)).reduce((a, x) => a + x.n, 0);
  const stockN = (s) => s.data?.byStatus?.find((x) => x.status === 'IN_STOCK')?.n || 0;
  return (
    <div className="page home">
      <div className="page-head">
        <div><h1>{t('home.title')}</h1><div className="sub">{t('home.sub')}</div></div>
        <div className="row"><span className="small muted">{t('c.lang')}</span><LangToggle persist /></div>
      </div>
      <div className="projects">
        <Link to="endeavor" className="pcard">
          <div className="ic"><Icon name="dna" /></div>
          <h2>{t('proj.ENDEAVOR')}</h2>
          <p>{t('proj.ENDEAVOR.desc')}</p>
          <div className="kpis"><div><b>{stockN(se)}</b><span>{t('home.stock')}</span></div><div><b>{openN(e)}</b><span>{t('home.open_req')}</span></div>{e.data?.inbox ? <div><b>{e.data.inbox}</b><span>{t('dash.inbox').toLowerCase()}</span></div> : null}</div>
          <div className="go">{t('home.open')} →</div>
        </Link>
        <Link to="lifestyle" className="pcard ls">
          <div className="ic"><Icon name="heart" /></div>
          <h2>{t('proj.LIFESTYLE')}</h2>
          <p>{t('proj.LIFESTYLE.desc')}</p>
          <div className="kpis"><div><b>{stockN(sl)}</b><span>{t('home.stock')}</span></div><div><b>{openN(l)}</b><span>{t('home.open_req')}</span></div></div>
          <div className="go">{t('home.open')} →</div>
        </Link>
      </div>
    </div>
  );
}

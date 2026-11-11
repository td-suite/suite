// Label (chiave tecnica `etichette`, area Retail and Flow Management dopo il Business Hub), v0.69.0: etichette per provetta dalle
// accettazioni StudioLab e stampa sulla Zebra della sede (Zebra Browser Print, ripiego PDF). OPERATORE: Stampa etichette per le sedi del
// proprio perimetro; ADMIN: anche Modelli, Registro stampe e Impostazioni.
export default {
  key: 'etichette',
  title: 'Label',
  kicker: 'Retail and Flow',
  area: 'RETAIL_FLOW',
  nav: [
    { to: '', icon: 'etichette', label: 'Stampa etichette', end: true },
    { group: 'Amministrazione', profiles: ['ADMIN'] },
    { to: 'modelli', icon: 'tag', label: 'Modelli', profiles: ['ADMIN'] },
    { to: 'registro', icon: 'list', label: 'Registro stampe', profiles: ['ADMIN'] },
    { to: 'impostazioni', icon: 'gear', label: 'Impostazioni', profiles: ['ADMIN'] },
  ],
};

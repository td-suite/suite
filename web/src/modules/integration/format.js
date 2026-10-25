export const itDate = (iso) => { if (!iso) return ''; const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
export const itDateTime = (d) => (d ? new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const ROLE = { ADMIN: 'Amministratore', EDITOR: 'Editor', VIEWER: 'Sola lettura' };
export const USTATUS = { ACTIVE: { label: 'Attivo', tone: 'green' }, PENDING: { label: 'In attesa di abilitazione', tone: 'mauve' }, DISABLED: { label: 'Disabilitato', tone: 'grey' } };
export const AUTH = { ENTRA: 'Microsoft 365', LOCAL: 'Email e password', BOTH: 'Microsoft 365 o password' };

// Preferenze personali dell'app (notifiche email delle NC, telefono di reperibilità). Account e password sono della Suite.
import React, { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { Card, Field, useToast } from '../components/ui.jsx';
import { ROLE } from '../format.js';

export default function Notifiche() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [notify, setNotify] = useState(user.notify_email !== false);
  const [tel, setTel] = useState(user.telefono || '');
  const savePrefs = async () => { try { await api.put('/auth/me/preferences', { notify_email: notify, telefono: tel }); toast('Preferenze salvate'); refresh(); } catch (e) { toast(e.message, 'err'); } };
  return (
    <div className="page">
      <div className="page-head"><div><h1>Le mie notifiche</h1><div className="sub">Come il modulo Non conformità ti avvisa. Account, password e profilo si gestiscono dalla Suite.</div></div></div>
      <div className="grid g2">
        <Card title="Account nel modulo">
          <div className="small muted">Nome</div><div className="strong">{user.full_name}</div>
          <div className="small muted mt">Email</div><div>{user.email}</div>
          <div className="small muted mt">Profilo</div><div>{ROLE[user.role] || user.role}</div>
          {user.role === 'SEDE' && <><div className="small muted mt">Sedi</div><div>{(user.sedi || []).length} sede/i associate</div></>}
        </Card>
        <Card title="Notifiche">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label className="f inline"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Ricevi le email delle non conformità {user.role === 'SEDE' ? '(nuove NC, solleciti, chiusure)' : '(risposte delle sedi, escalation)'}</label>
            <Field label="Telefono di reperibilità"><input value={tel} onChange={(e) => setTel(e.target.value)} placeholder="es. 055 0000000" /></Field>
            <div><button className="btn" onClick={savePrefs}>Salva preferenze</button></div>
          </div>
        </Card>
      </div>
    </div>
  );
}

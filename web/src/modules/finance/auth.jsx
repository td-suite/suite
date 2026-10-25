// Adattatore di autenticazione: nella Suite l'utente del modulo arriva dalla cornice (ModuleFrame → /api/finance/state).
// useAuth() del modulo restituisce { user, authMethod, logout } con la stessa forma che le pagine dell'app si aspettano:
// user.role è il profilo del grant Suite (SUPPORT, CEO, CFO, VIEWER), user.is_admin vale anche per OWNER e ADMIN della Suite,
// authMethod è il metodo di accesso della sessione Suite (ENTRA per Microsoft 365: necessario alla firma).
import React, { createContext, useContext } from 'react';
import { useAuth as useSuiteAuth } from '../../auth.jsx';

const Ctx = createContext({ user: null, authMethod: null, logout: () => {} });

export function FinanceAuthProvider({ user, children }) {
  const suite = useSuiteAuth();
  const value = { loading: false, user, authMethod: user?.auth_method || suite?.authMethod || null, onboarding: null, logout: suite?.logout || (() => {}), refresh: suite?.refresh || (() => {}) };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
export const isAdmin = (u) => Boolean(u?.is_admin);
export const canManage = (u) => u?.role === 'SUPPORT' || isAdmin(u);
export const isSigner = (u) => ['CEO', 'CFO'].includes(u?.role);

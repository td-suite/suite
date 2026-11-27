// Adattatore di autenticazione: l'utente del modulo arriva dalla Suite (ModuleFrame → props moduleUser).
// useAuth() ritorna { user } con user.role = profilo del grant Suite (ADMIN, HR, VIEWER); gli helper dell'app restano identici.
import React, { createContext, useContext } from 'react';

const AuthCtx = createContext({ user: null });

export function AuthProvider({ user, children }) {
  return <AuthCtx.Provider value={{ user, loading: false, onboarding: null, authMethod: 'SUITE' }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
// LP = profilo "Liberi professionisti (gestione)" (v0.99.12): aggiunge, modifica, cessa ed elimina i SOLI liberi professionisti,
// compensi compresi; mai i dipendenti (lo garantisce il server). canWrite vale quindi anche per lui, ma solo nelle sue pagine.
export const soloLp = (u) => u?.role === 'LP';
export const canWrite = (u) => ['ADMIN', 'HR', 'LP'].includes(u?.role);
export const isAdmin = (u) => u?.role === 'ADMIN';
// chi può eliminare una persona: l'amministratore; il profilo LP i soli liberi professionisti (gli unici che vede)
export const canDelete = (u) => isAdmin(u) || soloLp(u);
export const soloMdl = (u) => u?.role === 'MDL';
export const seesCosts = (u) => ['ADMIN', 'HR', 'LP'].includes(u?.role);

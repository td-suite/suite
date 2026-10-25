// Contatori e eventi in tempo reale (SSE) del modulo: nell'app vivevano in App.jsx (sidebar con i badge).
// Nella Suite la sidebar è disegnata dalla Suite: i contatori restano disponibili alle pagine (cruscotto) tramite LiveCtx,
// ogni evento SSE aggiorna i badge e segnala alle pagine di ricaricare (tick).
import React, { createContext, useCallback, useEffect, useState } from 'react';
import { api, apiBase } from './api.js';
import { isLab, isSede } from './auth.jsx';
import { useToast } from './components/ui.jsx';

export const LiveCtx = createContext({ counts: {}, tick: 0, refreshCounts: () => {} });

export function useLive(user) {
  const [counts, setCounts] = useState({});
  const [tick, setTick] = useState(0);
  const toast = useToast();
  const refreshCounts = useCallback(() => { api.get('/nc/counts', { silent: true }).then(setCounts).catch(() => {}); }, []);
  useEffect(() => {
    refreshCounts();
    let es = null;
    try { es = new EventSource(`${apiBase}/events`); } catch { es = null; }
    if (es) {
      es.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          if (ev.type === 'hello') return;
          setTick((t) => t + 1); refreshCounts();
          if (ev.type === 'nc.replied' && isLab(user)) toast(`Risposta ricevuta: ${ev.label}`);
          if (ev.type === 'nc.created' && isSede(user)) toast(`Nuova non conformità: ${ev.codice}`);
        } catch { /* ignora */ }
      };
    }
    const iv = setInterval(refreshCounts, 120000);
    return () => { es?.close(); clearInterval(iv); };
  }, [refreshCounts, toast, user]);
  return { counts, tick, refreshCounts };
}

export function LiveProvider({ user, children }) {
  const live = useLive(user);
  return <LiveCtx.Provider value={live}>{children}</LiveCtx.Provider>;
}

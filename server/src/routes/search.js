// Ricerca unificata: full-text su search_index filtrato per audience + trigram sul titolo.
// Risposta in linguaggio naturale con Claude solo se abilitata (search.ai_enabled) e la domanda lo richiede; mai i risultati sensibili.
import { Router } from 'express';
import { z } from 'zod';
import { ah, parse, getSetting } from '../lib/util.js';
import { search } from '../lib/search.js';
import { aiEnabled, answerSearch } from '../lib/claude.js';

const r = Router();
const AI_TIMEOUT_MS = 8000;
const AI_MAX_RESULTS = 12;

// Domanda in linguaggio naturale: più di tre parole oppure termina con un punto interrogativo
const isNaturalLanguage = (s) => /\?\s*$/.test(s) || s.trim().split(/\s+/).filter(Boolean).length > 3;

const withTimeout = (p, ms) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(Object.assign(new Error('Tempo scaduto'), { code: 'AI_TIMEOUT' })), ms);
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

r.get('/search', ah(async (req, res) => {
  const { q: text, kind } = parse(z.object({ q: z.string().trim().min(2, 'inserisci almeno due caratteri').max(200), kind: z.string().max(20).optional() }), req.query);
  const rows = await search(req.user, text, kind || '');
  const results = rows.map((x) => ({ kind: x.kind, ref_id: x.ref_id, title: x.title, snippet: x.snippet, link: x.link, module_key: x.module_key }));

  let answer;
  let ai = { enabled: false };
  if (aiEnabled() && isNaturalLanguage(text)) {
    const setting = await getSetting('search.ai_enabled', false);
    const on = setting === true || setting === 'true' || setting?.enabled === true;
    if (on) {
      ai = { enabled: true };
      // Solo risultati non sensibili, al massimo 12; teniamo la posizione originale per rimappare le citazioni
      const safeIdx = [];
      rows.forEach((x, i) => { if (!x.sensitive && safeIdx.length < AI_MAX_RESULTS) safeIdx.push(i); });
      const safe = safeIdx.map((i) => ({ kind: rows[i].kind, title: rows[i].title, snippet: rows[i].snippet, body: rows[i].body }));
      try {
        const a = await withTimeout(answerSearch(text, safe, { userId: req.user.id }), AI_TIMEOUT_MS);
        // Nel testo le citazioni [n] diventano posizioni (1 = primo) nella lista results; sources = indici (da 0) in results
        const textOut = a.text.replace(/\[(\d+)\]/g, (m, n) => (safeIdx[Number(n) - 1] != null ? `[${safeIdx[Number(n) - 1] + 1}]` : m));
        answer = { text: textOut, sources: a.sources.map((n) => safeIdx[n - 1]).filter((i) => i != null) };
      } catch (e) {
        ai = { enabled: true, skipped: e.code === 'AI_TIMEOUT' ? 'timeout' : 'error' };
        if (e.code !== 'AI_TIMEOUT') console.warn('[search:ai]', e.message);
      }
    }
  }
  res.json({ q: text, results, answer, ai });
}));

export default r;

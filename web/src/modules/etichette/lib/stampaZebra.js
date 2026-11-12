// Label · stampa sulla Zebra della sede con Zebra Browser Print (il programma locale di Zebra installato sul PC della sede).
// Browser Print espone un piccolo servizio locale: https://127.0.0.1:9101 (prima scelta: la Suite è in https) e http://127.0.0.1:9100.
// Le poche chiamate usate (l'SDK JavaScript ufficiale non è incluso):
//   GET  <base>/available              → { printer: [{ name, uid, connection, deviceType, ... }] }
//   GET  <base>/default?type=printer   → la stampante predefinita di Browser Print (vuoto se non c'è)
//   POST <base>/write  { device, data } → invia lo ZPL alla stampante (corpo text/plain come l'SDK: niente preflight CORS)
// Requisiti sul PC (docs/LAB_CONTROL.md): Browser Print installato e avviato; la prima volta aprire https://127.0.0.1:9101/ssl_support e
// accettare il certificato locale; alla prima richiesta della Suite Browser Print chiede di consentire il dominio (Accetta); il browser
// può chiedere il permesso di accedere ai dispositivi della rete locale (Consenti). La stampante scelta si ricorda PER QUESTO PC
// (localStorage: è una preferenza del dispositivo, non un dato).
const CHIAVE = 'td-etichette-stampante';
let basi = ['https://127.0.0.1:9101', 'http://127.0.0.1:9100'];
let baseAttiva = null;

/** Indirizzi di Browser Print (dal server: in collaudo il finto Browser Print). */
export function configuraBrowserPrint(urls) { if (Array.isArray(urls) && urls.length) { basi = urls.map((u) => String(u).replace(/\/+$/, '')); baseAttiva = null; } }

async function chiama(base, percorso, { metodo = 'GET', corpo, ms = 2500 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${base}${percorso}`, { method: metodo, mode: 'cors', credentials: 'omit', cache: 'no-store', signal: ctl.signal,
      headers: corpo ? { 'Content-Type': 'text/plain;charset=UTF-8' } : undefined, body: corpo });
    const testo = await r.text();
    if (!r.ok) throw new Error(`Browser Print risponde ${r.status}${testo ? `: ${testo.slice(0, 120)}` : ''}`);
    return testo;
  } finally { clearTimeout(t); }
}
const json = (t) => { try { return t ? JSON.parse(t) : null; } catch { return null; } };
const normalizza = (d) => (d && typeof d === 'object' && (d.name || d.uid) ? { name: d.name || d.uid, uid: d.uid || d.name, connection: d.connection || '', deviceType: d.deviceType || 'printer', provider: d.provider || '', manufacturer: d.manufacturer || '', version: d.version || 0 } : null);

/**
 * Rileva Browser Print e le stampanti. Ritorna { ok, base, stampanti: [...], predefinita, scelta, errore }.
 * scelta = la stampante ricordata su questo PC se c'è ancora, altrimenti la predefinita di Browser Print, altrimenti la prima.
 */
export async function rileva() {
  let ultimoErrore = null;
  for (const base of baseAttiva ? [baseAttiva, ...basi.filter((b) => b !== baseAttiva)] : basi) {
    try {
      const disp = json(await chiama(base, '/available'));
      const stampanti = (Array.isArray(disp?.printer) ? disp.printer : []).map(normalizza).filter(Boolean);
      let predefinita = null;
      try { predefinita = normalizza(json(await chiama(base, '/default?type=printer'))); } catch { /* nessuna predefinita */ }
      if (predefinita && !stampanti.some((s) => s.uid === predefinita.uid)) stampanti.unshift(predefinita);
      baseAttiva = base;
      const ricordata = leggiScelta();
      const scelta = stampanti.find((s) => s.uid === ricordata) || predefinita || stampanti[0] || null;
      return { ok: true, base, stampanti, predefinita, scelta };
    } catch (e) { ultimoErrore = e; }
  }
  baseAttiva = null;
  return { ok: false, base: null, stampanti: [], predefinita: null, scelta: null, errore: ultimoErrore?.name === 'AbortError' ? 'nessuna risposta' : (ultimoErrore?.message || 'non raggiungibile') };
}

export function leggiScelta() { try { return localStorage.getItem(CHIAVE) || null; } catch { return null; } }
export function ricordaScelta(uid) { try { if (uid) localStorage.setItem(CHIAVE, uid); else localStorage.removeItem(CHIAVE); } catch { /* archivio del browser non disponibile */ } }

/** Invia lo ZPL alla stampante (una sola richiesta con tutte le etichette e le copie). */
export async function invia(stampante, zpl) {
  if (!baseAttiva) throw new Error('Browser Print non trovato');
  if (!stampante) throw new Error('Nessuna stampante Zebra scelta');
  const device = { name: stampante.name, uid: stampante.uid, connection: stampante.connection, deviceType: stampante.deviceType || 'printer', provider: stampante.provider, manufacturer: stampante.manufacturer, version: stampante.version };
  await chiama(baseAttiva, '/write', { metodo: 'POST', corpo: JSON.stringify({ device, data: zpl }), ms: 15000 });
}

/** ZPL di più etichette con le copie: ogni etichetta ripetuta `copie` volte di seguito (stesso ordine delle provette). */
export function zplConCopie(zpls, copie = 1) {
  const n = Math.max(1, Math.min(20, Number(copie) || 1));
  return zpls.flatMap((z) => Array.from({ length: n }, () => String(z).trim())).join('\n');
}

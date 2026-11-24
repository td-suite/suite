// Ricerca prospect · lettura sicura dei siti pubblici. Regole: solo http/https verso indirizzi PUBBLICI (ogni risposta DNS e ogni
// reindirizzamento è controllato: niente reti private, locali o di metadati, il collegamento usa l'IP verificato), robots.txt
// rispettato, poche pagine per sito con una pausa tra una e l'altra, dimensione e tempo limitati, nessun cookie, nessun modulo inviato.
// Il programma si presenta con il proprio nome e il sito di Toscana Diagnostica.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

export const UA = 'ToscanaDiagnosticaSuite/1.0 (ricerca anagrafica aziendale; +https://www.toscanadiagnostica.it)';
const MAX_BYTES = 1_500_000;
const TIMEOUT = 12_000;
const provaLocale = () => process.env.NODE_ENV === 'test' && process.env.SCOUTING_CONSENTI_LOCALE === '1';

export function ipPubblico(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || b === 0)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === '::' || x === '::1' || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb') || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('ff')) return false;
    const m = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return ipPubblico(m[1]);
    return true;
  }
  return false;
}

// lookup che scarta ogni indirizzo non pubblico: il collegamento parte solo verso un IP verificato
function lookupSicuro(hostname, opts, cb) {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const ok = addrs.filter((a) => provaLocale() || ipPubblico(a.address));
    if (!ok.length) return cb(Object.assign(new Error('Indirizzo non pubblico'), { code: 'NON_PUBBLICO' }));
    if (opts && opts.all) return cb(null, ok);
    return cb(null, ok[0].address, ok[0].family);
  });
}

export function normUrl(u, base = null) {
  try {
    const s = String(u || '').trim();
    if (!s) return null;
    const x = new URL(base ? s : (/^https?:\/\//i.test(s) ? s : `https://${s}`), base || undefined);
    if (!['http:', 'https:'].includes(x.protocol)) return null;
    if (x.username || x.password) return null;
    x.hash = '';
    return x.toString();
  } catch { return null; }
}
export const dominioDi = (u) => { try { return new URL(normUrl(u)).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };

function unaRichiesta(url, { maxBytes = MAX_BYTES, timeout = TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    const x = new URL(url);
    if (net.isIP(x.hostname) && !provaLocale() && !ipPubblico(x.hostname)) return reject(Object.assign(new Error('Indirizzo non pubblico'), { code: 'NON_PUBBLICO' }));
    const lib = x.protocol === 'https:' ? https : http;
    const req = lib.request(x, { method: 'GET', lookup: lookupSicuro, timeout, headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/plain,application/xml;q=0.8', 'Accept-Language': 'it-IT,it;q=0.9' } }, (res) => {
      const chunks = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n > maxBytes) { res.destroy(); resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), troncato: true }); } else chunks.push(c); });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('Tempo scaduto'), { code: 'TEMPO' })));
    req.on('error', reject);
    req.end();
  });
}

function decodifica(buf, tipo) {
  const m = String(tipo || '').match(/charset=([\w-]+)/i) || buf.subarray(0, 2000).toString('latin1').match(/<meta[^>]+charset=["']?([\w-]+)/i);
  const cs = (m ? m[1] : 'utf-8').toLowerCase();
  try { return new TextDecoder(cs === 'iso-8859-1' || cs === 'latin1' ? 'windows-1252' : cs).decode(buf); } catch { return buf.toString('utf8'); }
}

/** Scarica una pagina pubblica seguendo al massimo 4 reindirizzamenti (ognuno controllato): { ok, status, url, testo, tipo, errore, sfida } */
export async function scarica(url, opts = {}) {
  let u = normUrl(url);
  if (!u) return { ok: false, errore: 'Indirizzo non valido' };
  try {
    for (let i = 0; i < 5; i += 1) {
      const r = await unaRichiesta(u, opts);
      if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.location) {
        const next = normUrl(r.headers.location, u);
        if (!next) return { ok: false, url: u, errore: 'Reindirizzamento non valido' };
        u = next; continue;
      }
      const tipo = String(r.headers['content-type'] || '');
      const testo = /text|html|xml|json/i.test(tipo) || !tipo ? decodifica(r.body, tipo) : '';
      // pagina di controllo anti-robot: si dichiara, non si ritenta e non si aggira
      const sfida = (r.status === 403 || r.status === 503 || r.status === 202) && /just a moment|cf-chl|sgcaptcha|captcha|attention required/i.test(testo.slice(0, 4000));
      return { ok: r.status >= 200 && r.status < 300, status: r.status, url: u, tipo, testo, sfida, corpo: opts.conCorpo ? r.body : undefined, troncato: Boolean(r.troncato), errore: r.status >= 400 ? (sfida ? 'Sito protetto da un controllo anti-robot' : `Risposta ${r.status}`) : null };
    }
    return { ok: false, url: u, errore: 'Troppi reindirizzamenti' };
  } catch (e) {
    return { ok: false, url: u, errore: e.code === 'NON_PUBBLICO' ? 'Indirizzo non pubblico' : e.code === 'TEMPO' ? 'Il sito non risponde' : e.code === 'ENOTFOUND' ? 'Dominio inesistente' : `Sito non raggiungibile (${e.code || e.message})` };
  }
}

/** robots.txt: regole Disallow/Allow per il nostro programma o per tutti (*). Ritorna (percorso) => consentito */
export function leggiRobots(txt) {
  const gruppi = []; let cur = null;
  for (const riga of String(txt || '').split(/\r?\n/)) {
    const l = riga.replace(/#.*/, '').trim(); if (!l) continue;
    const m = l.match(/^([A-Za-z-]+)\s*:\s*(.*)$/); if (!m) continue;
    const k = m[1].toLowerCase(); const v = m[2].trim();
    if (k === 'user-agent') { if (!cur || cur.regole.length) { cur = { agenti: [], regole: [] }; gruppi.push(cur); } cur.agenti.push(v.toLowerCase()); }
    else if ((k === 'disallow' || k === 'allow') && cur) cur.regole.push({ consenti: k === 'allow', percorso: v });
  }
  const mio = gruppi.find((g) => g.agenti.some((a) => a !== '*' && 'toscanadiagnosticasuite'.includes(a))) || gruppi.find((g) => g.agenti.includes('*'));
  const regole = (mio?.regole || []).filter((r) => r.percorso !== '' || r.consenti);
  const re = (p) => new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`);
  return (percorso) => {
    let best = null;
    for (const r of regole) if (r.percorso && re(r.percorso).test(percorso) && (!best || r.percorso.length > best.percorso.length || (r.percorso.length === best.percorso.length && r.consenti))) best = r;
    return best ? best.consenti : true;
  };
}
export const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));

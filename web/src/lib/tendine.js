// Ricerca nel testo in tutte le tendine della Suite (richiesta del CEO del 18/11/2026): il <select> del browser trova solo per iniziale.
// Qui, per ogni tendina con almeno SOGLIA voci, al clic (o alla prima lettera digitata) si apre un riquadro con un campo di ricerca
// che filtra le voci per qualunque parte del testo, senza distinguere maiuscole e accenti e in qualunque ordine delle parole.
// Vale per tutta la Suite senza toccare le singole pagine: la scelta scrive il valore nel <select> e lancia il suo evento "change",
// quindi React e i moduli ricevono la scelta come da una tendina normale. Su telefono e tablet resta il selettore del sistema.
// Una tendina resta quella del browser con l'attributo data-tendina="nativa".
const SOGLIA = 8;
const piatto = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const idonea = (sel) => sel instanceof HTMLSelectElement && !sel.multiple && !sel.disabled && sel.size <= 1 && sel.options.length >= SOGLIA && sel.dataset.tendina !== 'nativa';
const scrivi = (sel, valore) => {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, valore);
  sel.dispatchEvent(new Event('input', { bubbles: true }));
  sel.dispatchEvent(new Event('change', { bubbles: true }));
};

const CSS = `
.td-tendina { position: fixed; z-index: 100000; background: var(--card, #fff); color: var(--ink, #0f2a33); border: 1px solid var(--input-line, #c9d7da); border-radius: 10px;
  box-shadow: 0 12px 32px rgba(1, 33, 44, .22); display: flex; flex-direction: column; overflow: hidden; font: 14px/1.35 var(--font, system-ui, sans-serif); }
.td-tendina input { margin: 8px; padding: 7px 10px; border: 1px solid var(--input-line, #c9d7da); border-radius: 8px; background: var(--input, #fff); color: inherit; font: inherit; outline: none; width: auto; }
.td-tendina input:focus { border-color: var(--teal, #1C505E); }
.td-tendina ul { list-style: none; margin: 0; padding: 0 0 6px; overflow-y: auto; flex: 1; }
.td-tendina li { padding: 6px 12px; cursor: pointer; white-space: normal; overflow-wrap: anywhere; }
.td-tendina li.gruppo { cursor: default; font-size: 11.5px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--muted, #5b6f75); padding-top: 9px; }
.td-tendina li.no { cursor: default; color: var(--muted, #5b6f75); }
.td-tendina li.off { opacity: .45; cursor: default; }
.td-tendina li.att { background: var(--hover, #f4f8f9); }
.td-tendina li.sel { font-weight: 700; }
.td-tendina li mark { background: #ffe9a8; color: #0f2a33; border-radius: 2px; padding: 0; }
.td-tendina .conta { padding: 0 12px 6px; font-size: 12px; color: var(--muted, #5b6f75); }
.td-tendina .conta:empty { display: none; }
`;

let aperta = null;
function chiudi(rimettiFuoco = false) {
  if (!aperta) return;
  const { box, sel, togli } = aperta; aperta = null;
  togli(); box.remove();
  if (rimettiFuoco) sel.focus({ preventScroll: true });
}

function apri(sel, iniziale = '') {
  chiudi();
  const voci = [];
  for (const el of sel.children) {
    if (el.tagName === 'OPTGROUP') { for (const o of el.children) voci.push({ valore: o.value, testo: o.textContent || '', off: o.disabled || el.disabled, nel: el.label }); }
    else if (el.tagName === 'OPTION') voci.push({ valore: el.value, testo: el.textContent || '', off: el.disabled });
  }
  const box = document.createElement('div'); box.className = 'td-tendina'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Scegli una voce');
  const campo = document.createElement('input'); campo.type = 'search'; campo.placeholder = 'Cerca nel testo…'; campo.setAttribute('aria-label', 'Cerca nel testo'); campo.autocomplete = 'off'; campo.spellcheck = false; campo.value = iniziale;
  const conta = document.createElement('div'); conta.className = 'conta';
  const lista = document.createElement('ul'); lista.setAttribute('role', 'listbox');
  box.append(campo, conta, lista);
  // dentro una finestra (dialog, modale) il riquadro sta nella finestra stessa, così il fuoco non viene respinto
  (sel.closest('dialog[open]') || document.body).appendChild(box);
  const r = sel.getBoundingClientRect();
  const larg = Math.min(Math.max(r.width, 280), window.innerWidth - 16);
  const sotto = window.innerHeight - r.bottom - 12; const sopra = r.top - 12;
  const alto = Math.min(380, Math.max(sotto, sopra));
  box.style.width = `${larg}px`; box.style.maxHeight = `${alto}px`;
  box.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - larg - 8))}px`;
  if (sotto >= 220 || sotto >= sopra) box.style.top = `${r.bottom + 4}px`; else box.style.bottom = `${window.innerHeight - r.top + 4}px`;

  let visibili = []; let attiva = -1;
  const evidenzia = (testo, parole) => {
    const fr = document.createDocumentFragment(); const p = piatto(testo);
    if (!parole.length || p.length !== testo.length) { fr.append(testo); return fr; }   // lunghezze diverse (caratteri composti): niente evidenza
    const segni = new Array(testo.length).fill(false);
    for (const w of parole) { let i = p.indexOf(w); while (i >= 0) { for (let k = i; k < i + w.length; k++) segni[k] = true; i = p.indexOf(w, i + 1); } }
    let i = 0;
    while (i < testo.length) { let j = i; while (j < testo.length && segni[j] === segni[i]) j++; const pezzo = testo.slice(i, j); if (segni[i]) { const m = document.createElement('mark'); m.textContent = pezzo; fr.append(m); } else fr.append(pezzo); i = j; }
    return fr;
  };
  const segna = (i, scorri = true) => { attiva = i; for (const li of lista.children) li.classList.toggle('att', li.dataset.i !== undefined && Number(li.dataset.i) === i); if (scorri) lista.querySelector('li.att')?.scrollIntoView({ block: 'nearest' }); };
  const disegna = () => {
    const parole = piatto(campo.value).split(/\s+/).filter(Boolean);
    lista.textContent = ''; visibili = [];
    let ultimoGruppo = null;
    for (const v of voci) {
      const t = piatto(`${v.testo} ${v.nel || ''}`);
      if (!parole.every((w) => t.includes(w))) continue;
      if (v.nel && v.nel !== ultimoGruppo) { const g = document.createElement('li'); g.className = 'gruppo'; g.textContent = v.nel; lista.append(g); ultimoGruppo = v.nel; }
      const li = document.createElement('li'); li.setAttribute('role', 'option'); li.dataset.i = String(visibili.length);
      if (v.off) li.classList.add('off');
      if (v.valore === sel.value) li.classList.add('sel');
      li.append(evidenzia(v.testo.trim() || ' ', parole));
      lista.append(li); visibili.push(v);
    }
    if (!visibili.length) { const li = document.createElement('li'); li.className = 'no'; li.textContent = 'Nessuna voce contiene questo testo'; lista.append(li); }
    conta.textContent = parole.length ? `${visibili.length} di ${voci.length} voci` : '';
    const corrente = visibili.findIndex((v) => v.valore === sel.value && !v.off);
    segna(!parole.length && corrente >= 0 ? corrente : visibili.findIndex((v) => !v.off));
  };
  const scegli = (i) => { const v = visibili[i]; if (!v || v.off) return; const s = sel; chiudi(true); if (s.value !== v.valore) scrivi(s, v.valore); };
  const passo = (d) => { if (!visibili.length) return; let i = attiva; for (let k = 0; k < visibili.length; k++) { i = (i + d + visibili.length) % visibili.length; if (!visibili[i].off) break; } segna(i); };

  campo.addEventListener('input', disegna);
  campo.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); passo(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); passo(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); scegli(attiva); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); chiudi(true); }
    else if (e.key === 'Tab') { chiudi(true); }
  });
  lista.addEventListener('mousemove', (e) => { const li = e.target.closest('li[data-i]'); if (li && Number(li.dataset.i) !== attiva) segna(Number(li.dataset.i), false); });
  lista.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); const li = e.target.closest('li[data-i]'); if (li) scegli(Number(li.dataset.i)); });
  box.addEventListener('click', (e) => e.stopPropagation());
  const fuori = (e) => { if (!box.contains(e.target) && e.target !== sel) chiudi(); };
  const scorre = (e) => { if (!box.contains(e.target)) chiudi(); };
  const ridim = () => chiudi();
  document.addEventListener('mousedown', fuori, true); window.addEventListener('scroll', scorre, true); window.addEventListener('resize', ridim);
  const oss = new MutationObserver(() => { if (!sel.isConnected) chiudi(); }); oss.observe(document.body, { childList: true, subtree: true });
  aperta = { box, sel, togli: () => { document.removeEventListener('mousedown', fuori, true); window.removeEventListener('scroll', scorre, true); window.removeEventListener('resize', ridim); oss.disconnect(); } };
  disegna();
  campo.focus({ preventScroll: true });
  if (iniziale) campo.setSelectionRange(iniziale.length, iniziale.length);
}

export function installaTendine() {
  if (typeof window === 'undefined' || window.__tdTendine) return;
  window.__tdTendine = true;
  if (window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia?.('(any-pointer: fine)').matches) return;   // solo tocco: selettore del sistema
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey) return;
    const sel = e.target instanceof Element ? e.target.closest('select') : null;
    if (!idonea(sel)) return;
    e.preventDefault();
    if (aperta?.sel === sel) { chiudi(true); return; }
    sel.focus({ preventScroll: true }); apri(sel);
  }, true);
  document.addEventListener('keydown', (e) => {
    const sel = e.target;
    if (!idonea(sel) || e.ctrlKey || e.metaKey) return;
    const lettera = e.key.length === 1 && e.key !== ' ';
    if (lettera || e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apri(sel, lettera ? e.key : ''); }
  }, true);
}

// Lab Control > Label · Modelli dell'etichetta (ADMIN). Il disegno è ZPL con segnaposto ({COGNOME}, {BARCODE}, ...; {CAMPO:n} tronca a n caratteri),
// con misure del rotolo e risoluzione della stampante. Anteprima dal vivo con dati di esempio inventati (stesso renderer della stampa),
// comandi ZPL non supportati dall'anteprima e segnaposto sconosciuti segnalati, "Stampa di prova" sulla Zebra di questo PC o in PDF.
// Validazione: "Segna come validato" dopo il confronto con l'etichetta di StudioLab e la lettura con gli strumenti del laboratorio;
// cambiare disegno, misure o dpi toglie la validazione.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Card, ConfirmModal, ErrorBox, Field, PageHead, PromptModal, Switch, useToast } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { api, useApi } from '../api.js';
import { useAuth } from '../auth.jsx';
import { AvvisoValidazione } from '../components.jsx';
import { SEGNAPOSTO, riempiModello, analizzaZpl, segnapostoSconosciuti, svgEtichetta, dotDaMm } from '../lib/zpl.js';
import { configuraBrowserPrint, rileva, invia } from '../lib/stampaZebra.js';
import { pdfEtichette, apriPdf } from '../lib/pdf.js';
import { itData, itDataOra, oggiIso } from '../format.js';

// Dati di esempio INVENTATI per l'anteprima e la stampa di prova (nessun paziente reale)
export const ESEMPIO = () => ({ BARCODE: 'TD2600012345', ACCETTAZIONE: '2026/012345', COGNOME: 'ESEMPIO', NOME: 'ETICHETTA', NASCITA: '01/01/1980', SESSO: 'F', DATA: itData(oggiIso()), ORA: '08:30',
  CONTENITORE: 'PROVETTA EDTA', MATERIALE: 'SANGUE INTERO', ESAMI: 'EMO VES PCR', CLIENTE: 'Cliente di prova', SEDE: 'Punto prelievi di prova', N: '1', TOT: '3' });
const NUOVO = { id: null, nome: '', larghezza_mm: 50, altezza_mm: 25, dpi: 203, zpl: '^XA\n^CI28\n^PW400\n^LL200\n^FO16,16^A0N,28,28^FD{COGNOME} {NOME}^FS\n^FO16,60^BY2,3,70^BCN,70,Y,N,N,A^FD{BARCODE}^FS\n^XZ', attivo: true, note: '' };

export default function Modelli() {
  const { stato } = useAuth();
  const toast = useToast();
  const lista = useApi('/modelli');
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [valida, setValida] = useState(false);
  const [togli, setTogli] = useState(false);
  const [reale, setReale] = useState(false);
  const area = useRef(null);
  useEffect(() => { if (!f && lista.data?.length) setF({ ...lista.data[0] }); }, [lista.data, f]);
  useEffect(() => { configuraBrowserPrint(stato?.browser_print); }, [stato]);
  const cur = lista.data?.find((m) => m.id === f?.id) || null;
  const modificato = f && cur && ['nome', 'larghezza_mm', 'altezza_mm', 'dpi', 'zpl', 'attivo', 'note'].some((k) => String(f[k] ?? '') !== String(cur[k] ?? ''));

  const analisi = useMemo(() => {
    if (!f) return null;
    const w = dotDaMm(f.larghezza_mm, f.dpi), h = dotDaMm(f.altezza_mm, f.dpi);
    const pieno = riempiModello(f.zpl, ESEMPIO());
    const a = analizzaZpl(pieno, { larghezza: w, altezza: h });
    const et = a.etichette[0];
    const avvisi = [...a.avvisi];
    if (et && (et.larghezza !== w || et.altezza !== h)) avvisi.push(`^PW/^LL (${et.larghezza}×${et.altezza} dot) diversi dalle misure del rotolo (${w}×${h} dot a ${f.dpi} dpi)`);
    return { pieno, et, nonSupportati: a.nonSupportati, sconosciuti: segnapostoSconosciuti(f.zpl), avvisi,
      svg: et ? svgEtichetta(et, { dpi: f.dpi, larghezzaMm: Number(f.larghezza_mm), altezzaMm: Number(f.altezza_mm) }) : null };
  }, [f]);

  const inserisci = (s) => {
    const el = area.current;
    const tok = `{${s}}`;
    if (!el) return setF((x) => ({ ...x, zpl: x.zpl + tok }));
    const a = el.selectionStart ?? f.zpl.length, b = el.selectionEnd ?? a;
    const nuovo = f.zpl.slice(0, a) + tok + f.zpl.slice(b);
    setF((x) => ({ ...x, zpl: nuovo }));
    setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = a + tok.length; }, 0);
  };

  const salva = async () => {
    setSalvando(true); setErr(null);
    try {
      const corpo = { nome: f.nome, larghezza_mm: Number(f.larghezza_mm), altezza_mm: Number(f.altezza_mm), dpi: Number(f.dpi), zpl: f.zpl, attivo: Boolean(f.attivo), note: f.note || null };
      const r = f.id ? await api.put(`/modelli/${f.id}`, corpo) : await api.post('/modelli', corpo);
      toast(r.validazione_tolta ? 'Modello salvato: la validazione è stata tolta perché il disegno è cambiato' : 'Modello salvato');
      await lista.reload(); setF({ ...r });
    } catch (e) { setErr(e); } finally { setSalvando(false); }
  };
  const predefinito = async () => { try { await api.post(`/modelli/${f.id}/predefinito`); toast('Modello predefinito aggiornato'); await lista.reload(); } catch (e) { toast(e, 'err'); } };
  const ricarica = async () => { await lista.reload(); window.dispatchEvent(new Event('suite:etichette-stato')); };

  const prova = async (modo) => {
    const et = [{ zpl: analisi.pieno }];
    try {
      if (modo === 'PDF') { apriPdf(await pdfEtichette(et, f), 'etichetta-di-prova.pdf'); await api.post('/stampe', { etichette: 1, copie: 1, metodo: 'PROVA', esito: 'OK', stampante: 'PDF', modello_id: f.id || null }); return; }
      const z = await rileva();
      if (!z.ok || !z.scelta) throw new Error('Zebra Browser Print non trovato su questo PC: usa "PDF di prova" o vedi la guida in Stampa etichette');
      await invia(z.scelta, analisi.pieno);
      await api.post('/stampe', { etichette: 1, copie: 1, metodo: 'PROVA', esito: 'OK', stampante: z.scelta.name, modello_id: f.id || null });
      toast(`Etichetta di prova inviata a ${z.scelta.name}`);
    } catch (e) { toast(e, 'err'); }
  };

  return (
    <div className="page et-page">
      <PageHead title="Modelli dell'etichetta" icon="tag" sub="Disegno ZPL con segnaposto, misure del rotolo e risoluzione; anteprima con dati di esempio inventati"
        actions={<button className="btn ghost" onClick={() => { setF({ ...NUOVO, zpl: cur?.zpl || NUOVO.zpl, larghezza_mm: cur?.larghezza_mm || 50, altezza_mm: cur?.altezza_mm || 25, dpi: cur?.dpi || 203, nome: '' }); setErr(null); }}><Icon name="plus" />Nuovo modello</button>} />
      <AvvisoValidazione testo={stato?.avviso_validazione} />
      <div className="et-modelli">
        <div className="et-elenco">
          {(lista.data || []).map((m) => (
            <button key={m.id} type="button" className={`et-modello ${f?.id === m.id ? 'on' : ''}`} onClick={() => { setF({ ...m }); setErr(null); }}>
              <b>{m.nome}</b>
              <span className="small muted">{m.larghezza_mm}×{m.altezza_mm} mm · {m.dpi} dpi{m.sedi ? ` · ${m.sedi} sed${m.sedi === 1 ? 'e' : 'i'}` : ''}</span>
              <span className="row" style={{ gap: 4 }}>
                {m.predefinito && <Badge tone="teal">Predefinito</Badge>}
                {m.validato_il ? <Badge tone="green">Validato</Badge> : <Badge tone="amber">Da validare</Badge>}
                {!m.attivo && <Badge tone="grey">Disattivato</Badge>}
              </span>
            </button>
          ))}
          {f && !f.id && <div className="et-modello on"><b>Nuovo modello</b><span className="small muted">non ancora salvato</span></div>}
        </div>

        {f && analisi && (
          <div className="et-editor">
            <Card title={f.id ? f.nome || 'Modello' : 'Nuovo modello'} icon="edit"
              actions={f.id && <>
                {!cur?.predefinito && cur?.attivo && <button className="btn sm ghost" onClick={predefinito}>Imposta predefinito</button>}
                {cur?.validato_il ? <button className="btn sm ghost" onClick={() => setTogli(true)}>Togli validazione</button>
                  : <button className="btn sm" onClick={() => setValida(true)} disabled={modificato || !cur?.attivo} title={modificato ? 'Salva prima le modifiche' : ''}><Icon name="check" />Segna come validato</button>}
              </>}>
              <ErrorBox error={err} />
              {cur?.validato_il && <div className="alert ok"><Icon name="check" /><span>Validato dal laboratorio il {itDataOra(cur.validato_il)}{cur.validato_da_nome ? ` da ${cur.validato_da_nome}` : ''}: {cur.validazione_nota}</span></div>}
              <div className="et-campi">
                <Field label="Nome" className="largo"><input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="es. TD 50x25" /></Field>
                <Field label="Larghezza (mm)"><input type="number" min="10" max="120" step="0.5" value={f.larghezza_mm} onChange={(e) => setF({ ...f, larghezza_mm: e.target.value })} /></Field>
                <Field label="Altezza (mm)"><input type="number" min="5" max="200" step="0.5" value={f.altezza_mm} onChange={(e) => setF({ ...f, altezza_mm: e.target.value })} /></Field>
                <Field label="Risoluzione"><select value={f.dpi} onChange={(e) => setF({ ...f, dpi: Number(e.target.value) })}><option value={203}>203 dpi</option><option value={300}>300 dpi</option></select></Field>
                <label className="f inline"><Switch checked={f.attivo} onChange={(v) => setF({ ...f, attivo: v })} label="Attivo" />Attivo</label>
              </div>
              <div className="et-segnaposto">
                <span className="small muted">Inserisci:</span>
                {SEGNAPOSTO.map((s) => <button key={s} type="button" className="chip-btn" onClick={() => inserisci(s)}>{`{${s}}`}</button>)}
              </div>
              <Field label="ZPL" help="Comandi disegnati dall'anteprima: ^XA ^XZ ^FO ^FD ^FS ^A0 ^BC (Code 128, modo A automatico B/C) ^BY ^GB ^CI28 ^PW ^LL ^FB ^LH ^CF ^FX. {CAMPO:n} tronca a n caratteri; i campi vuoti non si stampano.">
                <textarea ref={area} className="et-zpl" value={f.zpl} onChange={(e) => setF({ ...f, zpl: e.target.value })} spellCheck={false} rows={14} />
              </Field>
              <Field label="Note"><input value={f.note || ''} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="es. misure del rotolo, foto dell'etichetta di StudioLab ricevuta il…" /></Field>
              <div className="row" style={{ marginTop: 12 }}>
                <button className="btn" onClick={salva} disabled={salvando || f.nome.trim().length < 2}>{salvando ? 'Salvo…' : 'Salva'}</button>
                {f.id && modificato && <button className="btn ghost" onClick={() => setF({ ...cur })}>Annulla le modifiche</button>}
              </div>
            </Card>

            <Card title="Anteprima" icon="eye" className="et-prev">
              <div className="row et-prev-azioni">
                <label className="f inline"><Switch checked={reale} onChange={setReale} label="Dimensione reale" />Dimensione reale</label>
                <div className="spacer" />
                <button className="btn sm ghost" onClick={() => prova('ZEBRA')}><Icon name="printer" />Stampa di prova</button>
                <button className="btn sm ghost" onClick={() => prova('PDF')}><Icon name="pdf" />PDF di prova</button>
              </div>
              {analisi.svg ? (
                <div className="et-anteprima grande" style={reale ? { width: `${f.larghezza_mm}mm`, height: `${f.altezza_mm}mm` } : { width: '100%', maxWidth: 520, aspectRatio: `${Number(f.larghezza_mm)} / ${Number(f.altezza_mm)}` }} dangerouslySetInnerHTML={{ __html: analisi.svg }} />
              ) : <div className="alert err"><Icon name="alert" /><span>Nessuna etichetta da disegnare: servono ^XA e ^XZ</span></div>}
              <div className="small muted" style={{ marginTop: 10 }}>{f.larghezza_mm}×{f.altezza_mm} mm · {dotDaMm(f.larghezza_mm, f.dpi)}×{dotDaMm(f.altezza_mm, f.dpi)} dot · dati inventati (ESEMPIO ETICHETTA, barcode TD2600012345). Il carattere 0 della Zebra è reso con un carattere condensato simile: le larghezze dei testi sono stimate.</div>
              {(analisi.nonSupportati.length > 0 || analisi.sconosciuti.length > 0 || analisi.avvisi.length > 0) && (
                <ul className="et-avvisi">
                  {analisi.nonSupportati.length > 0 && <li><b>Comandi non disegnati dall'anteprima</b> (la stampante li esegue): {analisi.nonSupportati.join(' ')}</li>}
                  {analisi.sconosciuti.length > 0 && <li><b>Segnaposto sconosciuti</b> (restano scritti così): {analisi.sconosciuti.join(' ')}</li>}
                  {analisi.avvisi.map((a) => <li key={a}>{a}</li>)}
                </ul>
              )}
            </Card>
          </div>
        )}
      </div>
      {valida && <PromptModal title="Segna come validato" label="Come è stato validato (chi, confronto con l'etichetta di StudioLab, lettura degli strumenti)" type="textarea" minLength={5}
        help="La validazione resta finché non cambiano disegno, misure o risoluzione."
        confirmText="Segna come validato" onClose={() => setValida(false)} onConfirm={async (nota) => { await api.post(`/modelli/${f.id}/valida`, { nota }); toast('Modello validato'); await ricarica(); }} />}
      {togli && <ConfirmModal title="Togli validazione" text={`Il modello "${f.nome}" tornerà "da validare" e il modulo mostrerà di nuovo l'avviso se nessun altro modello è validato.`} confirmText="Togli validazione"
        onClose={() => setTogli(false)} onConfirm={async () => { await api.del(`/modelli/${f.id}/valida`); toast('Validazione tolta'); await ricarica(); }} />}
    </div>
  );
}

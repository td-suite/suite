// Inbox: caricamento dei PDF (trascinamento multiplo), elaborazioni recenti con le schede trovate (stato, anomalie),
// "Conferma tutte le verdi" per elaborazione, elenco delle schede da confermare.
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, base, useApi } from '../api.js';
import { useAuth, isLab } from '../index.jsx';
import { Card, Loading, Empty, PageHead, Badge, DropZone, useToast, ConfirmModal } from '../../../components/ui.jsx';
import { Icon } from '../../../components/Icons.jsx';
import { SORGENTE, STATO_SCHEDA, STATO_ELAB, itDateTime, kb, pagineLabel } from '../format.js';

export const SorgenteBadge = ({ s }) => <Badge tone={SORGENTE[s]?.tone || 'grey'} dot={false}>{SORGENTE[s]?.breve || s || '-'}</Badge>;
export const StatoBadge = ({ s }) => <Badge tone={STATO_SCHEDA[s]?.tone || 'grey'}>{STATO_SCHEDA[s]?.label || s}</Badge>;
export function Anomalie({ list, compact }) {
  if (!list?.length) return <Badge tone="green" dot={false}>Nessuna anomalia</Badge>;
  if (compact) return <Badge tone="amber" dot={false} title={list.map((a) => a.testo).join('\n')}>{list.length} {list.length === 1 ? 'anomalia' : 'anomalie'}</Badge>;
  return <ul className="rf-anomalie">{list.map((a, i) => <li key={i}><Icon name="alert" />{a.testo}</li>)}</ul>;
}

export default function Inbox() {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const elab = useApi('/elaborazioni?limit=40');
  const bozze = useApi('/schede?stato=BOZZA');
  const [busy, setBusy] = useState(false);
  const [esito, setEsito] = useState(null);
  const [verdi, setVerdi] = useState(null);
  const lab = isLab(user);

  const carica = async (files) => {
    const pdf = files.filter((f) => /\.pdf$/i.test(f.name));
    if (!pdf.length) return toast('Carica solo file PDF', 'err');
    const fd = new FormData();
    for (const f of pdf.slice(0, 20)) fd.append('file', f, f.name);
    setBusy(true);
    try {
      const r = await api.upload('/elaborazioni', fd);
      setEsito(r.elaborazioni);
      const schede = r.elaborazioni.reduce((n, e) => n + e.schede.length, 0);
      const scartati = r.elaborazioni.filter((e) => e.stato === 'SCARTATO').length;
      toast(`${r.elaborazioni.length} PDF elaborati: ${schede} ${schede === 1 ? 'scheda trovata' : 'schede trovate'}${scartati ? `, ${scartati} ${scartati === 1 ? 'scartato' : 'scartati'}` : ''}`, scartati && !schede ? 'err' : 'ok');
      elab.reload(); bozze.reload();
    } catch (e) { toast(e, 'err'); }
    setBusy(false);
  };
  const confermaVerdi = async (e) => {
    setBusy(true);
    try {
      const r = await api.post(`/elaborazioni/${e.id}/conferma-verdi`);
      toast(`${r.confermate.length} ${r.confermate.length === 1 ? 'scheda confermata' : 'schede confermate'}${r.non_coerenti.length ? `, ${r.non_coerenti.length} da rivedere (controllo di coerenza non superato)` : ''}`, r.non_coerenti.length ? 'err' : 'ok');
      elab.reload(); bozze.reload();
    } catch (err) { toast(err, 'err'); }
    setBusy(false); setVerdi(null);
  };

  return (
    <div className="page">
      <PageHead title="Inbox" icon="upload" sub="Carica i PDF dei laboratori esterni (Bianalisi Firenze, Cerba RDI Limena, Cerba Nuova Igea). Ogni paziente diventa una scheda da controllare e confermare: la conferma produce il DOCX e il PDF sul format Toscana Diagnostica." />

      {lab ? (
        <Card title="Carica referti" icon="upload">
          <DropZone onFiles={carica} accept="application/pdf,.pdf" multiple>
            <Icon name="upload" />
            <div>{busy ? 'Elaborazione in corso: estrazione del testo e lettura dei referti' : 'Trascina qui i PDF dei referti (anche più file e PDF uniti con più pazienti) oppure clicca per sceglierli'}</div>
            <div className="small muted">Massimo 20 PDF per volta, 20 MB ciascuno. I PDF che non sono referti vengono scartati con un messaggio.</div>
          </DropZone>
          {esito && (
            <ul className="rf-esito">
              {esito.map((e, i) => (
                <li key={i} className={e.stato === 'SCARTATO' ? 'ko' : 'ok'}>
                  <Icon name={e.stato === 'SCARTATO' ? 'x' : 'check'} />
                  <div>
                    <div className="strong">{e.filename} {e.sorgente && <SorgenteBadge s={e.sorgente} />} {e.ocr && <Badge tone="amber" dot={false}>OCR</Badge>}</div>
                    {e.stato === 'SCARTATO' ? <div className="small">{e.motivo_scarto}</div> : <div className="small">{e.pagine} {e.pagine === 1 ? 'pagina' : 'pagine'}, {e.schede.length} {e.schede.length === 1 ? 'scheda' : 'schede'}: {e.schede.map((s) => <Link key={s.id} to={`${base}/schede/${s.id}`}>{s.cognome_nome || 'paziente'}{s.anomalie?.length ? ` (${s.anomalie.length})` : ''}</Link>).reduce((acc, x, j) => (j ? [...acc, ', ', x] : [x]), [])}</div>}
                  </div>
                </li>))}
            </ul>)}
        </Card>
      ) : <div className="rf-alert"><Icon name="info" className="ico" /><span>Il caricamento e la conferma dei referti sono riservati al personale di laboratorio (profilo Laboratorio). Qui vedi le elaborazioni e le schede in consultazione.</span></div>}

      <Card title={`Schede da confermare${bozze.data ? ` (${bozze.data.length})` : ''}`} icon="edit" flush>
        {!bozze.data ? <Loading /> : !bozze.data.length ? <Empty icon="check" title="Nessuna scheda in attesa" compact>Tutte le schede caricate sono state confermate o scartate.</Empty> : (
          <div className="table-wrap"><table className="t rf-table">
            <thead><tr><th>Paziente</th><th>Sorgente</th><th>Accettazione / Referto</th><th>Pagine</th><th>Anomalie</th><th>Caricata</th><th></th></tr></thead>
            <tbody>{bozze.data.map((s) => (
              <tr key={s.id} className="click" onClick={() => nav(`${base}/schede/${s.id}`)}>
                <td><div className="strong">{s.cognome_nome || <span className="muted">senza nome</span>}</div><div className="small muted">{s.data_nascita}{s.sesso ? ` · ${s.sesso}` : ''}</div></td>
                <td><SorgenteBadge s={s.sorgente} />{s.ocr && <> <Badge tone="amber" dot={false}>OCR</Badge></>}</td>
                <td className="small">{s.accettazione || s.referto_codice || '-'}{s.data_acc || s.referto_data ? <div className="muted">{s.data_acc || s.referto_data}</div> : null}</td>
                <td className="small">{pagineLabel(s.pagine)}<div className="muted ellipsis" style={{ maxWidth: 180 }} title={s.elaborazione_filename}>{s.elaborazione_filename}</div></td>
                <td><Anomalie list={s.anomalie} compact /></td>
                <td className="small muted">{itDateTime(s.created_at)}</td>
                <td className="actions"><Link className="btn sm" to={`${base}/schede/${s.id}`} onClick={(e) => e.stopPropagation()}><Icon name="eye" />Apri</Link></td>
              </tr>))}</tbody>
          </table></div>)}
      </Card>

      <Card title="Elaborazioni recenti" icon="clock" flush>
        {!elab.data ? <Loading /> : !elab.data.length ? <Empty icon="upload" title="Nessun PDF caricato" compact>I PDF caricati compaiono qui con le schede trovate.</Empty> : (
          <div className="table-wrap"><table className="t rf-table">
            <thead><tr><th>File</th><th>Sorgente</th><th>Stato</th><th>Schede</th><th>Caricato</th><th></th></tr></thead>
            <tbody>{elab.data.map((e) => (
              <tr key={e.id}>
                <td><div className="strong ellipsis" style={{ maxWidth: 320 }} title={e.filename}>{e.filename}</div><div className="small muted">{kb(e.size)} · {e.pagine} {e.pagine === 1 ? 'pagina' : 'pagine'}{e.ocr ? ' · OCR' : ''}</div></td>
                <td><SorgenteBadge s={e.sorgente} /></td>
                <td><Badge tone={STATO_ELAB[e.stato]?.tone || 'grey'}>{STATO_ELAB[e.stato]?.label || e.stato}</Badge>{e.motivo_scarto && <div className="small muted" style={{ maxWidth: 320 }}>{e.motivo_scarto}</div>}</td>
                <td className="small">{e.n_schede ? <>{e.n_schede} {e.n_schede === 1 ? 'scheda' : 'schede'}<div className="muted">{e.n_bozze ? `${e.n_bozze} da confermare` : ''}{e.n_bozze && e.n_confermate ? ', ' : ''}{e.n_confermate ? `${e.n_confermate} confermate` : ''}{e.n_scartate ? `, ${e.n_scartate} scartate` : ''}</div></> : <span className="muted">-</span>}</td>
                <td className="small muted">{itDateTime(e.created_at)}<div>{e.uploaded_by_nome}</div></td>
                <td className="actions">{lab && e.n_verdi > 0 && <button className="btn sm" disabled={busy} onClick={() => setVerdi(e)}><Icon name="check" />Conferma tutte le verdi ({e.n_verdi})</button>}</td>
              </tr>))}</tbody>
          </table></div>)}
      </Card>

      {verdi && <ConfirmModal title="Conferma tutte le schede senza anomalie" text={`Verranno confermate ${verdi.n_verdi} schede di "${verdi.filename}" che non hanno anomalie: per ciascuna il controllo di coerenza viene eseguito e, se superato, si producono DOCX e PDF sul format TD. Le schede che non superano il controllo restano in bozza.`} confirmText="Conferma le verdi" onConfirm={() => confermaVerdi(verdi)} onClose={() => setVerdi(null)} />}
    </div>
  );
}

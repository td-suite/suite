// Rimborso Spese · scheda completa della nota per il client e per il PDF: righe con giustificativi e avvisi, riepilogo, controlli
// dell'invio, storico, responsabile previsto, veicoli e benefit della persona, eccezione al giustificativo.
import { many, one } from '../db.js';
import { righe, categorieMap, haEccezione, benefitPersona, vetturaNelMese, vistaNota, oggi } from './core.js';
import { riepilogo, controlliInvio, doppioni, controllaMassimali, finestraInvio, STATO_LABEL, METODI, destinatariValidi } from './calcoli.js';
import { MODULI_CARTACEI, RIF_PROCEDURA } from '../config.js';

export const TESTO_GIUSTIFICATIVO = 'Allegare tutti i giustificativi originali (ricevute, fatture, scontrini). I rimborsi senza giustificativo non saranno liquidati.';

/** Spese della persona in tutte le note (per i doppioni tra mesi diversi) */
export const speseDellaPersona = (personId) => many(`SELECT s.id, s.nota_id, s.data, s.importo, s.categoria_id, s.esclusa, n.anno, n.mese FROM spese s JOIN note n ON n.id = s.nota_id WHERE n.person_id = $1`, [personId]);

export async function scheda(n, ctx, { perPdf = false } = {}) {
  const { spese, viaggi, allegati } = await righe(n.id);
  const cat = await categorieMap();
  const eccezione = await haEccezione(n.person_id);
  const s = ctx.settings;
  const tutte = await speseDellaPersona(n.person_id);
  const doppi = doppioni(tutte);
  const mesiNote = new Map(tutte.map((x) => [x.nota_id, `${x.anno}-${String(x.mese).padStart(2, '0')}`]));
  const massimali = controllaMassimali(spese, cat);
  const ctl = controlliInvio({ nota: n, spese, viaggi, allegati, categorie: cat, eccezione, oggi: oggi(), giornoLimite: s.giorno_limite, doppi, massimali });
  const allegatiDi = (tipo, id) => allegati.filter((a) => a.riga_tipo === tipo && a.riga_id === id);
  const pieno = n.person_id === ctx.personId || ctx.isPC || ctx.isTitolare;
  const benefit = await benefitPersona(n.person_id, { pieno });
  const vettura = vetturaNelMese(benefit.vetture, n.anno, n.mese);
  const veicoli = await many('SELECT * FROM veicoli WHERE person_id=$1 ORDER BY attivo DESC, id', [n.person_id]);
  const persona = await one(`SELECT p.id, p.last_name, p.first_name, p.kind, p.job_title, s.name AS site_name, jr.name AS role_name, ou.name AS unit_name, coalesce(ou.name, jr.name, p.job_title) AS funzione
      FROM public.people p LEFT JOIN public.sites s ON s.id = p.site_id LEFT JOIN public.job_roles jr ON jr.id = p.role_id LEFT JOIN public.org_units ou ON ou.id = p.unit_id WHERE p.id=$1`, [n.person_id]);
  const eventi = await many(`SELECT e.*, u.full_name AS utente FROM eventi e LEFT JOIN public.users u ON u.id = e.user_id WHERE e.nota_id=$1 ORDER BY e.at, e.id`, [n.id]);
  const fc = new Map(benefit.fuel_card.map((f) => [f.id, f]));
  const out = {
    nota: { ...vistaNota(n, ctx), stato_label: STATO_LABEL[n.stato] },
    persona: { ...persona, nome: `${persona.last_name} ${persona.first_name}` },
    spese: spese.map((x) => ({ ...x, metodo_label: METODI[x.metodo], fuel_card: x.fuel_card_id ? fc.get(x.fuel_card_id) || null : null, allegati: allegatiDi('SPESA', x.id),
      avvisi: ctl.righe.get(`S:${x.id}`) || [], doppione_di: (doppi.get(x.id) || []).map((d) => ({ ...d, mese: mesiNote.get(d.nota_id) })),
      giustificativo_obbligatorio: Boolean(cat.get(x.categoria_id)?.giustificativo_obbligatorio) && !eccezione })),
    viaggi: viaggi.map((x) => ({ ...x, allegati: allegatiDi('VIAGGIO', x.id), avvisi: ctl.righe.get(`V:${x.id}`) || [] })),
    allegati_nota: allegati.filter((a) => a.riga_tipo === 'NOTA'),
    riepilogo: riepilogo({ spese, viaggi, anticipi: n.anticipi, categorie: cat }),
    controlli: { bloccanti: ctl.bloccanti, avvisi: ctl.avvisi, finestra: finestraInvio({ anno: n.anno, mese: n.mese, oggi: oggi(), giornoLimite: s.giorno_limite }) },
    eventi,
    eccezione,
    testo_giustificativo: TESTO_GIUSTIFICATIVO,
    vettura_aziendale: vettura,
    benefit,
    veicoli: pieno ? veicoli : veicoli.map((v) => ({ id: v.id, marca: v.marca, modello: v.modello, targa: v.targa, tariffa: v.tariffa, tariffa_fonte: v.tariffa_fonte, attivo: v.attivo })),
    tariffa_default: s.tariffa_km_default != null && s.tariffa_km_default !== '' ? { tariffa: Number(s.tariffa_km_default), fonte: s.tariffa_km_default_fonte || '', unica: s.tariffa_km_unica !== false && s.tariffa_km_unica !== 'false' } : null,
    responsabile_previsto: null,
    moduli_cartacei: MODULI_CARTACEI, rif_procedura: RIF_PROCEDURA,
    // invio del PDF di approvazione a destinatari esterni: chi lo riceve e l'esito dell'ultimo invio
    invio_approvazione: (() => { const dest = destinatariValidi(s.destinatari_approvazione); return { attivo: s.invio_approvazione_attivo !== false && dest.length > 0, destinatari: dest, mittente: s.mittente_approvazione,
      esito: n.email_approvazione_esito || null, errore: n.email_approvazione_errore || null, at: n.email_approvazione_at || null }; })(),
  };
  if (n.stato === 'BOZZA') {
    const p = ctx.perim.persone.get(n.person_id);
    const auto = Boolean(p?.vertice) && ctx.user?.level === 'OWNER' && n.person_id === ctx.personId;
    out.responsabile_previsto = p ? { id: p.approvatore_id, nome: p.approvatore_nome, al_pc: p.al_pc && !auto, automatica: auto, origine: p.origine } : null;
  }
  if (!perPdf) out.categorie = [...cat.values()].filter((c) => c.attiva || spese.some((x) => x.categoria_id === c.id));
  return out;
}

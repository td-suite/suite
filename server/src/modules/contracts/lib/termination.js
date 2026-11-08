// Cessazioni con decorrenza raggiunta: la persona passa a CESSATO (public.people), i riporti passano al suo responsabile,
// l'approvatore ferie viene azzerato e le aree di cui era referente tornano al calcolo automatico. Stessa logica dell'app di
// origine (eseguita all'apertura dell'elenco risorse), qui anche come lavoro di sfondo giornaliero con modulo LIVE.
import { many, q } from '../db.js';
import { reindexPerson } from './people.js';
import { effettiCessazione } from '../../../lib/cessazione.js';
import { autoAccountForPerson } from '../../../lib/accounts.js';

export async function applyDueTerminations() {
  const due = await many(`UPDATE public.people p SET status='CESSATO', updated_at=now()
    WHERE p.terminated_at IS NOT NULL AND p.terminated_at <= CURRENT_DATE AND p.status IN ('ATTIVO','IMPEGNO')
      AND EXISTS (SELECT 1 FROM person_ext x WHERE x.person_id = p.id)
    RETURNING id, manager_person_id AS manager_id`);
  for (const x of due) {
    await q('UPDATE public.people SET manager_person_id=$2, updated_at=now() WHERE manager_person_id=$1 AND id<>$1', [x.id, x.manager_id && x.manager_id !== x.id ? x.manager_id : null]);
    await q('UPDATE person_ext SET approver_id=NULL WHERE approver_id=$1', [x.id]);
    await q('UPDATE areas SET head_person_id=NULL WHERE head_person_id=$1', [x.id]);
    reindexPerson(x.id);
    // A11: accessi disattivati (gli amministratori restano da confermare, con avviso), incarichi chiusi, avviso responsabile di sede
    await effettiCessazione(x.id, { origine: 'Contratti del personale, cessazione con decorrenza raggiunta' }).catch((e) => console.warn('[cessazione]', x.id, e.message));
  }
  return due.length;
}

/**
 * Prese di servizio con decorrenza raggiunta (08/11/2026, CEO: una persona con contratto confermato e iniziato il 02/11 non compariva in
 * Persone): CANDIDATO o IMPEGNO con assunzione (people.hired_at), contratto di lavoro o incarico LP iniziato entro oggi → ATTIVO, con
 * reindicizzazione; l'accesso nasce da solo se l'email è di un dominio automatico (lib/accounts.js) e le regole di accesso propongono
 * i grant. Gira ogni giorno, all'apertura dell'elenco risorse e dopo ogni salvataggio di contratto.
 */
export async function applyDueHires(actor = null) {
  const due = await many(`UPDATE public.people p SET status='ATTIVO', hired_at=coalesce(p.hired_at, d.inizio), updated_at=now()
    FROM (SELECT p2.id, least(p2.hired_at, e.start_date, l.start_date) AS inizio FROM public.people p2
            LEFT JOIN employments e ON e.resource_id=p2.id LEFT JOIN lp_contracts l ON l.resource_id=p2.id
          WHERE p2.status IN ('CANDIDATO','IMPEGNO') AND p2.kind <> 'ESTERNO'
            AND least(p2.hired_at, e.start_date, l.start_date) <= CURRENT_DATE
            AND (p2.terminated_at IS NULL OR p2.terminated_at > CURRENT_DATE)
            AND EXISTS (SELECT 1 FROM person_ext x WHERE x.person_id = p2.id)) d
    WHERE p.id = d.id RETURNING p.id, p.last_name, p.first_name`);
  for (const x of due) { reindexPerson(x.id); autoAccountForPerson(x.id, actor); }
  return due.length;
}

// Cessazioni con decorrenza raggiunta: la persona passa a CESSATO (public.people), i riporti passano al suo responsabile,
// l'approvatore ferie viene azzerato e le aree di cui era referente tornano al calcolo automatico. Stessa logica dell'app di
// origine (eseguita all'apertura dell'elenco risorse), qui anche come lavoro di sfondo giornaliero con modulo LIVE.
import { many, q } from '../db.js';
import { reindexPerson } from './people.js';

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
  }
  return due.length;
}

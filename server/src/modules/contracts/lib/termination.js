// Cessazioni con decorrenza raggiunta: la risorsa passa a CESSATO, i riporti passano al suo responsabile, l'approvatore
// ferie viene azzerato e le aree di cui era referente tornano al calcolo automatico. Stessa logica dell'app di origine
// (eseguita all'apertura dell'elenco risorse), qui anche come lavoro di sfondo giornaliero con modulo LIVE.
import { many, q } from '../db.js';

export async function applyDueTerminations() {
  const due = await many("UPDATE resources SET status='CESSATO', updated_at=now() WHERE terminated_at IS NOT NULL AND terminated_at <= CURRENT_DATE AND status IN ('ATTIVO','IMPEGNO') RETURNING id, manager_id");
  for (const x of due) {
    await q('UPDATE resources SET manager_id=$2, updated_at=now() WHERE manager_id=$1 AND id<>$1', [x.id, x.manager_id && x.manager_id !== x.id ? x.manager_id : null]);
    await q('UPDATE resources SET approver_id=NULL WHERE approver_id=$1', [x.id]);
    await q('UPDATE areas SET head_resource_id=NULL WHERE head_resource_id=$1', [x.id]);
  }
  return due.length;
}

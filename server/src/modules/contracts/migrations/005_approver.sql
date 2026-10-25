-- Chi approva ferie, permessi e richieste (se diverso dal responsabile gerarchico)
ALTER TABLE resources ADD COLUMN approver_id INT REFERENCES resources(id) ON DELETE SET NULL;

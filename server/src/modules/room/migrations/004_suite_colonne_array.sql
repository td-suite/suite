-- Suite TD: le due colonne array dell'app (disponibilita.sedi TEXT[], posizioni.giorni SMALLINT[]) diventano JSONB.
-- Il job di travaso della Suite serializza i valori strutturati letti dall'origine come JSON ("[]", "[\"id\"]"): in una colonna
-- array PostgreSQL questo fallisce (malformed array literal), in JSONB no. Il contenuto resta lo stesso elenco; le query del
-- modulo che usavano cardinality() e ANY() usano jsonb_array_length() e l'operatore ?. Il resto dello schema è quello dell'app.
ALTER TABLE disponibilita ALTER COLUMN sedi DROP DEFAULT;
ALTER TABLE disponibilita ALTER COLUMN sedi TYPE JSONB USING to_jsonb(sedi);
ALTER TABLE disponibilita ALTER COLUMN sedi SET DEFAULT '[]'::jsonb;
ALTER TABLE posizioni ALTER COLUMN giorni DROP DEFAULT;
ALTER TABLE posizioni ALTER COLUMN giorni TYPE JSONB USING to_jsonb(giorni);
ALTER TABLE posizioni ALTER COLUMN giorni SET DEFAULT '[]'::jsonb;

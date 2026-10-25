-- Premio MBO in cifra fissa annua (dirigenti): se valorizzato prevale sulla percentuale
ALTER TABLE employments ADD COLUMN mbo_amount NUMERIC(12,2);

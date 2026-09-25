-- C2 identifica una boleta por evento/referencia y un lector por su ID técnico.
-- Mantener además las claves compuestas originales para las FK de D1.
ALTER TABLE boleta ADD CONSTRAINT boleta_evento_referencia_key UNIQUE (evento_id, referencia);
ALTER TABLE lector ADD CONSTRAINT lector_id_key UNIQUE (lector_id);
ALTER TABLE intento ADD CONSTRAINT intento_evento_origen_key UNIQUE (evento_id, id_origen);

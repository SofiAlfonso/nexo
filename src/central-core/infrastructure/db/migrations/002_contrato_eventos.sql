-- A single commercial agreement covers all three pilot events.
CREATE TABLE m4_liquidacion.contrato_eventos (
    contrato_id text NOT NULL REFERENCES m4_liquidacion.contratos(id),
    evento_id text PRIMARY KEY REFERENCES m1_config_permisos.eventos(id)
);

INSERT INTO m4_liquidacion.contrato_eventos(contrato_id, evento_id)
SELECT id, evento_id FROM m4_liquidacion.contratos;

ALTER TABLE m4_liquidacion.contratos DROP COLUMN evento_id;

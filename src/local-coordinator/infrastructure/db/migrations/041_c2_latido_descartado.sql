-- Latidos E1 descartados por C2 tras un conflicto de idempotencia en C4 (HTTP 409).
-- Los latidos no pasan por el outbox; cuando uno envenena un lote, el despachador lo retira y
-- reenvía solo las decisiones. Aquí queda constancia, solo de adición, de lo retirado y por qué.
CREATE TABLE latido_descartado (
  id bigserial PRIMARY KEY,
  evento_id text NOT NULL,
  id_origen text NOT NULL,
  lector_id text NOT NULL,
  punto_id text NOT NULL,
  id_lote text NOT NULL,
  motivo text NOT NULL CHECK (motivo IN ('conflicto-e1')),
  registro jsonb NOT NULL,
  descartado_en timestamptz NOT NULL,
  UNIQUE (evento_id, id_origen, id_lote)
);
CREATE INDEX latido_descartado_evento_idx ON latido_descartado (evento_id, descartado_en);

CREATE TRIGGER latido_descartado_solo_adicion
  BEFORE UPDATE OR DELETE ON latido_descartado
  FOR EACH ROW EXECUTE FUNCTION prohibir_cambios_bitacora();

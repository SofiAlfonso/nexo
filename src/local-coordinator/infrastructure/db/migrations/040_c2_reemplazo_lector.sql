-- PU-05-02: reemplazo del lector de un punto y solicitud de revocación de su credencial (ADR-008).
-- La asignación vigente sigue siendo `lector.punto_id`; al reemplazar, el lector anterior queda
-- `revocado` y deshabilitado (C2 lo rechaza aunque la CA no esté disponible) y se registra el
-- cierre aquí. Las tres tablas son solo de adición: un lector reemplazado no vuelve a usarse.
CREATE TABLE reemplazo_lector (
  id bigserial PRIMARY KEY,
  evento_id text NOT NULL,
  punto_id text NOT NULL,
  lector_anterior text NOT NULL,
  lector_nuevo text NOT NULL,
  motivo text NOT NULL CHECK (motivo IN ('lost', 'compromised', 'retired')),
  reemplazado_en timestamptz NOT NULL,
  CHECK (lector_anterior <> lector_nuevo),
  UNIQUE (evento_id, lector_anterior),
  FOREIGN KEY (evento_id, punto_id) REFERENCES punto (evento_id, punto_id),
  FOREIGN KEY (evento_id, lector_anterior) REFERENCES lector (evento_id, lector_id),
  FOREIGN KEY (evento_id, lector_nuevo) REFERENCES lector (evento_id, lector_id)
);
CREATE INDEX reemplazo_lector_punto_idx ON reemplazo_lector (evento_id, punto_id, reemplazado_en);

CREATE TABLE solicitud_revocacion (
  id bigserial PRIMARY KEY,
  reemplazo_id bigint NOT NULL UNIQUE REFERENCES reemplazo_lector (id),
  evento_id text NOT NULL,
  lector_id text NOT NULL,
  motivo text NOT NULL CHECK (motivo IN ('lost', 'compromised', 'retired')),
  solicitada_en timestamptz NOT NULL,
  UNIQUE (evento_id, lector_id),
  FOREIGN KEY (evento_id, lector_id) REFERENCES lector (evento_id, lector_id)
);

-- Entrada de `revoked.json` que confirma la revocación de la credencial solicitada.
CREATE TABLE revocacion_credencial (
  solicitud_id bigint PRIMARY KEY REFERENCES solicitud_revocacion (id),
  numero_serie text NOT NULL CHECK (numero_serie ~ '^[0-9A-F]+$'),
  huella_sha256 text NOT NULL CHECK (huella_sha256 ~ '^[0-9a-f]{64}$'),
  revocada_en timestamptz NOT NULL,
  registrada_en timestamptz NOT NULL
);

CREATE TRIGGER reemplazo_lector_solo_adicion
  BEFORE UPDATE OR DELETE ON reemplazo_lector
  FOR EACH ROW EXECUTE FUNCTION prohibir_cambios_bitacora();
CREATE TRIGGER solicitud_revocacion_solo_adicion
  BEFORE UPDATE OR DELETE ON solicitud_revocacion
  FOR EACH ROW EXECUTE FUNCTION prohibir_cambios_bitacora();
CREATE TRIGGER revocacion_credencial_solo_adicion
  BEFORE UPDATE OR DELETE ON revocacion_credencial
  FOR EACH ROW EXECUTE FUNCTION prohibir_cambios_bitacora();

-- D1: el recinto conserva autoridad y evidencia; C4 no escribe estas tablas.
CREATE TABLE permiso_version (
  evento_id text NOT NULL,
  version bigint NOT NULL CHECK (version >= 0),
  desde_version bigint NOT NULL CHECK (desde_version >= 0),
  tipo text NOT NULL CHECK (tipo IN ('instantanea', 'cambios')),
  paquete jsonb NOT NULL CHECK (jsonb_typeof(paquete) = 'object'),
  emitido_en timestamptz NOT NULL,
  vigente_hasta timestamptz NOT NULL,
  apertura_en timestamptz NOT NULL,
  cierre_en timestamptz NOT NULL,
  version_politicas bigint NOT NULL CHECK (version_politicas >= 0),
  instalado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (evento_id, version),
  CHECK (version >= desde_version),
  CHECK (cierre_en > apertura_en)
);

CREATE TABLE boleta (
  cliente_id text NOT NULL,
  evento_id text NOT NULL,
  boleteria_id text NOT NULL,
  referencia_externa text NOT NULL,
  codigo text NOT NULL,
  zona text NOT NULL,
  anulada_en timestamptz,
  version_permiso bigint NOT NULL CHECK (version_permiso >= 0),
  PRIMARY KEY (cliente_id, evento_id, boleteria_id, referencia_externa),
  UNIQUE (evento_id, codigo)
);
CREATE INDEX boleta_evento_referencia_idx ON boleta (evento_id, referencia_externa);

CREATE TABLE punto (
  evento_id text NOT NULL,
  punto_id text NOT NULL,
  zonas text[] NOT NULL CHECK (cardinality(zonas) > 0),
  habilitado boolean NOT NULL DEFAULT true,
  PRIMARY KEY (evento_id, punto_id)
);

CREATE TABLE lector (
  evento_id text NOT NULL,
  lector_id text NOT NULL,
  punto_id text NOT NULL,
  habilitado boolean NOT NULL DEFAULT true,
  PRIMARY KEY (evento_id, lector_id),
  FOREIGN KEY (evento_id, punto_id) REFERENCES punto (evento_id, punto_id)
);
CREATE INDEX lector_punto_idx ON lector (evento_id, punto_id);

CREATE TABLE latido (
  evento_id text NOT NULL,
  lector_id text NOT NULL,
  secuencia bigint NOT NULL CHECK (secuencia >= 0),
  estado_lector text NOT NULL,
  pendientes_diario bigint NOT NULL CHECK (pendientes_diario >= 0),
  diario_total bigint NOT NULL CHECK (diario_total >= 0),
  version_permisos bigint CHECK (version_permisos >= 0),
  instante_lector timestamptz NOT NULL,
  recibido_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (evento_id, lector_id),
  FOREIGN KEY (evento_id, lector_id) REFERENCES lector (evento_id, lector_id)
);
CREATE INDEX latido_recibido_idx ON latido (recibido_en);

CREATE TABLE intento (
  id_origen text PRIMARY KEY,
  contenido_hash text NOT NULL CHECK (contenido_hash ~ '^[0-9a-f]{64}$'),
  evento_id text NOT NULL,
  lector_id text NOT NULL,
  punto_id text NOT NULL,
  codigo text NOT NULL,
  proposito text NOT NULL CHECK (proposito IN ('ingreso', 'reingreso')),
  zona_solicitada text NOT NULL,
  instante_lector timestamptz NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (evento_id, lector_id) REFERENCES lector (evento_id, lector_id),
  FOREIGN KEY (evento_id, punto_id) REFERENCES punto (evento_id, punto_id)
);
CREATE INDEX intento_evento_creado_idx ON intento (evento_id, creado_en DESC);

CREATE TABLE decision (
  id_origen text PRIMARY KEY REFERENCES intento (id_origen),
  decision text NOT NULL CHECK (decision IN ('aceptado', 'rechazado', 'sin-respuesta')),
  motivo text NOT NULL,
  proposito text CHECK (proposito IN ('ingreso', 'reingreso')),
  admision boolean NOT NULL DEFAULT false,
  concurrente boolean NOT NULL DEFAULT false,
  anulacion_en_transito boolean NOT NULL DEFAULT false,
  version_permisos bigint NOT NULL CHECK (version_permisos >= 0),
  evidencia jsonb NOT NULL CHECK (jsonb_typeof(evidencia) = 'object'),
  instante_decision timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT admision OR (decision = 'aceptado' AND proposito = 'ingreso')),
  CHECK (decision = 'aceptado' OR proposito IS NULL)
);
CREATE INDEX decision_instante_idx ON decision (instante_decision DESC);

CREATE TABLE consumo (
  cliente_id text NOT NULL,
  evento_id text NOT NULL,
  boleteria_id text NOT NULL,
  referencia_externa text NOT NULL,
  proposito text NOT NULL DEFAULT 'PRIMER_INGRESO' CHECK (proposito = 'PRIMER_INGRESO'),
  id_origen text NOT NULL UNIQUE REFERENCES decision (id_origen),
  consumido_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consumo_unico UNIQUE (cliente_id, evento_id, boleteria_id, referencia_externa, proposito),
  FOREIGN KEY (cliente_id, evento_id, boleteria_id, referencia_externa)
    REFERENCES boleta (cliente_id, evento_id, boleteria_id, referencia_externa)
);

CREATE TABLE bitacora (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  evento_id text NOT NULL,
  tipo text NOT NULL,
  id_origen text NOT NULL,
  evidencia jsonb NOT NULL CHECK (jsonb_typeof(evidencia) = 'object'),
  registrado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (evento_id, tipo, id_origen)
);
CREATE INDEX bitacora_registrado_idx ON bitacora (registrado_en);

CREATE FUNCTION prohibir_cambios_bitacora() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La bitacora es solo de adicion: % prohibido', TG_OP;
END;
$$;
CREATE TRIGGER bitacora_solo_adicion
  BEFORE UPDATE OR DELETE ON bitacora
  FOR EACH ROW EXECUTE FUNCTION prohibir_cambios_bitacora();

CREATE TABLE outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bitacora_id bigint NOT NULL UNIQUE REFERENCES bitacora (id),
  evento_id text NOT NULL,
  tipo text NOT NULL,
  id_origen text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'enviado')),
  intentos integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  proximo_intento_en timestamptz NOT NULL DEFAULT now(),
  ultimo_error text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  enviado_en timestamptz,
  UNIQUE (evento_id, tipo, id_origen),
  CHECK ((estado = 'pendiente' AND enviado_en IS NULL) OR
         (estado = 'enviado' AND enviado_en IS NOT NULL))
);
CREATE INDEX outbox_pendiente_idx ON outbox (proximo_intento_en, id) WHERE estado = 'pendiente';

CREATE TABLE lote_diario (
  id_lote text PRIMARY KEY,
  evento_id text NOT NULL,
  lector_id text NOT NULL,
  contenido_hash text NOT NULL CHECK (contenido_hash ~ '^[0-9a-f]{64}$'),
  acuse jsonb NOT NULL CHECK (jsonb_typeof(acuse) = 'object'),
  recibido_en timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (evento_id, lector_id) REFERENCES lector (evento_id, lector_id)
);

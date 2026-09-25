-- Compatibilidad con la unidad de validación de C2. No alterar la migración ya publicada.
CREATE TABLE evento (
  evento_id text PRIMARY KEY,
  cliente_id text NOT NULL,
  boleteria_id text NOT NULL,
  recinto_id text NOT NULL,
  estado text NOT NULL,
  apertura_en timestamptz NOT NULL,
  cierre_en timestamptz NOT NULL,
  version_permisos bigint NOT NULL DEFAULT 0 CHECK (version_permisos >= 0),
  version_politicas bigint NOT NULL DEFAULT 0 CHECK (version_politicas >= 0),
  reingreso_permitido boolean NOT NULL DEFAULT false,
  permisos_recibidos_en timestamptz,
  CHECK (cierre_en > apertura_en)
);

ALTER TABLE lector ADD COLUMN revocado boolean NOT NULL DEFAULT false;

ALTER TABLE boleta RENAME COLUMN referencia_externa TO referencia;
ALTER TABLE boleta RENAME COLUMN version_permiso TO version;
ALTER TABLE boleta ADD COLUMN anulacion_recibida_en timestamptz;

-- A C2 le basta con evento/referencia: se preserva la clave global de consumo
-- completando cliente/boletería desde la identidad técnica del evento.
CREATE FUNCTION completar_boleta_d1() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  alcance evento%ROWTYPE;
BEGIN
  SELECT * INTO alcance FROM evento WHERE evento_id = NEW.evento_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evento % no existe', NEW.evento_id USING ERRCODE = '23503';
  END IF;
  IF NEW.cliente_id IS NOT NULL AND NEW.cliente_id <> alcance.cliente_id
     OR NEW.boleteria_id IS NOT NULL AND NEW.boleteria_id <> alcance.boleteria_id THEN
    RAISE EXCEPTION 'Alcance de boleta diferente del evento' USING ERRCODE = '23514';
  END IF;
  NEW.cliente_id := alcance.cliente_id;
  NEW.boleteria_id := alcance.boleteria_id;
  NEW.codigo := COALESCE(NEW.codigo, NEW.referencia);
  RETURN NEW;
END;
$$;
CREATE TRIGGER boleta_alcance
  BEFORE INSERT OR UPDATE ON boleta
  FOR EACH ROW EXECUTE FUNCTION completar_boleta_d1();

ALTER TABLE intento RENAME COLUMN contenido_hash TO huella;
ALTER TABLE intento ADD COLUMN decision text CHECK (decision IN ('aceptado', 'rechazado', 'sin-respuesta'));
ALTER TABLE intento ADD COLUMN motivo text;
ALTER TABLE intento ADD COLUMN respuesta jsonb CHECK (respuesta IS NULL OR jsonb_typeof(respuesta) = 'object');
ALTER TABLE intento ADD COLUMN decidido_en timestamptz;
ALTER TABLE intento ADD CONSTRAINT intento_decision_completa
  CHECK ((decision IS NULL AND motivo IS NULL AND respuesta IS NULL AND decidido_en IS NULL) OR
         (decision IS NOT NULL AND motivo IS NOT NULL AND respuesta IS NOT NULL AND decidido_en IS NOT NULL));

ALTER TABLE consumo RENAME COLUMN referencia_externa TO referencia;
ALTER TABLE consumo ADD COLUMN punto_id text;
ALTER TABLE consumo ADD COLUMN lector_id text;
ALTER TABLE consumo DROP CONSTRAINT consumo_id_origen_fkey;
ALTER TABLE consumo ADD CONSTRAINT consumo_id_origen_fkey
  FOREIGN KEY (id_origen) REFERENCES intento (id_origen);

ALTER TABLE bitacora RENAME COLUMN evidencia TO contenido;

ALTER TABLE outbox ALTER COLUMN bitacora_id DROP NOT NULL;
ALTER TABLE outbox ALTER COLUMN payload DROP NOT NULL;
ALTER TABLE outbox ADD COLUMN registro jsonb CHECK (registro IS NULL OR jsonb_typeof(registro) = 'object');
ALTER TABLE outbox ADD CONSTRAINT outbox_registro_presente CHECK (registro IS NOT NULL OR payload IS NOT NULL);
CREATE TABLE outbox_envio (
  outbox_id bigint PRIMARY KEY REFERENCES outbox (id),
  id_lote text NOT NULL,
  acusado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE outbox_reintento (
  outbox_id bigint PRIMARY KEY REFERENCES outbox (id),
  intentos integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  proximo_intento_en timestamptz NOT NULL DEFAULT now(),
  ultimo_error text
);
-- El contenido de E1 no puede reescribirse al actualizar el estado del transporte.
CREATE TRIGGER outbox_solo_adicion
  BEFORE UPDATE OR DELETE ON outbox
  FOR EACH ROW EXECUTE FUNCTION prohibir_cambios_bitacora();

CREATE TABLE diario_lote (
  id_lote text PRIMARY KEY,
  evento_id text NOT NULL,
  lector_id text NOT NULL,
  acuse jsonb NOT NULL CHECK (jsonb_typeof(acuse) = 'object'),
  recibido_en timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (evento_id, lector_id) REFERENCES lector (evento_id, lector_id)
);
CREATE TABLE intento_diario (
  evento_id text NOT NULL,
  id_origen text NOT NULL,
  id_lote text NOT NULL REFERENCES diario_lote (id_lote),
  lector_id text NOT NULL,
  punto_id text NOT NULL,
  codigo text NOT NULL,
  proposito text NOT NULL CHECK (proposito IN ('ingreso', 'reingreso')),
  zona_solicitada text NOT NULL,
  motivo_local text NOT NULL,
  instante_lector timestamptz NOT NULL,
  recibido_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (evento_id, id_origen)
);

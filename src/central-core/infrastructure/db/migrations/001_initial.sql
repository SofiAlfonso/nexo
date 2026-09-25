CREATE SCHEMA m1_config_permisos;
CREATE SCHEMA m2_evidencia;
CREATE SCHEMA m3_conciliacion;
CREATE SCHEMA m4_liquidacion;
CREATE SCHEMA auth;

CREATE TABLE m1_config_permisos.clientes (
    id text PRIMARY KEY,
    nombre text NOT NULL
);

CREATE TABLE m1_config_permisos.recintos (
    id text PRIMARY KEY,
    cliente_id text NOT NULL REFERENCES m1_config_permisos.clientes(id),
    nombre text NOT NULL
);

CREATE TABLE m1_config_permisos.eventos (
    id text PRIMARY KEY,
    recinto_id text NOT NULL REFERENCES m1_config_permisos.recintos(id),
    nombre text NOT NULL,
    nombre_corto text NOT NULL,
    boleteria text NOT NULL,
    apertura timestamptz NOT NULL,
    cierre timestamptz NOT NULL,
    admisiones_estimadas integer NOT NULL DEFAULT 0 CHECK (admisiones_estimadas >= 0),
    gratuito boolean NOT NULL DEFAULT false,
    estado text NOT NULL DEFAULT 'preparacion'
        CHECK (estado IN ('preparacion', 'abierto', 'cerrado')),
    version_permisos integer NOT NULL DEFAULT 0 CHECK (version_permisos >= 0),
    ultimo_cambio_recibido timestamptz,
    apertura_confirmada_en timestamptz,
    apertura_confirmada_por bigint,
    UNIQUE (id, recinto_id),
    CHECK (cierre > apertura)
);

CREATE TABLE m1_config_permisos.zonas (
    id text PRIMARY KEY,
    evento_id text NOT NULL REFERENCES m1_config_permisos.eventos(id),
    nombre text NOT NULL,
    UNIQUE (evento_id, id),
    UNIQUE (evento_id, nombre)
);

CREATE TABLE m1_config_permisos.puntos (
    id text PRIMARY KEY,
    evento_id text NOT NULL REFERENCES m1_config_permisos.eventos(id),
    nombre text NOT NULL,
    zona_id text,
    estado text NOT NULL DEFAULT 'sin-abrir'
        CHECK (estado IN ('en-linea', 'sin-comunicacion', 'averiado', 'en-pausa', 'sin-abrir')),
    creado_en timestamptz NOT NULL DEFAULT now(),
    UNIQUE (evento_id, id),
    FOREIGN KEY (evento_id, zona_id) REFERENCES m1_config_permisos.zonas(evento_id, id)
);

CREATE TABLE m1_config_permisos.punto_zonas (
    evento_id text NOT NULL,
    punto_id text NOT NULL,
    zona_id text NOT NULL,
    PRIMARY KEY (evento_id, punto_id, zona_id),
    FOREIGN KEY (evento_id, punto_id) REFERENCES m1_config_permisos.puntos(evento_id, id),
    FOREIGN KEY (evento_id, zona_id) REFERENCES m1_config_permisos.zonas(evento_id, id)
);

CREATE TABLE m1_config_permisos.lectores (
    id text PRIMARY KEY,
    evento_id text NOT NULL,
    punto_id text NOT NULL,
    familia text,
    procedencia text,
    credencial text,
    desde timestamptz,
    hasta timestamptz,
    FOREIGN KEY (evento_id, punto_id) REFERENCES m1_config_permisos.puntos(evento_id, id)
);

CREATE TABLE m1_config_permisos.politicas (
    evento_id text PRIMARY KEY REFERENCES m1_config_permisos.eventos(id),
    version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
    reingreso_permitido boolean NOT NULL DEFAULT false,
    reingreso_tras_min integer NOT NULL DEFAULT 10 CHECK (reingreso_tras_min >= 0),
    reingreso_suspendido boolean NOT NULL DEFAULT false,
    actualizada_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE m1_config_permisos.versiones_politica (
    evento_id text NOT NULL REFERENCES m1_config_permisos.eventos(id),
    version integer NOT NULL CHECK (version >= 0),
    reingreso_permitido boolean NOT NULL,
    reingreso_tras_min integer NOT NULL CHECK (reingreso_tras_min >= 0),
    reingreso_suspendido boolean NOT NULL,
    creada_en timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (evento_id, version)
);

CREATE TABLE m1_config_permisos.boletas (
    evento_id text NOT NULL REFERENCES m1_config_permisos.eventos(id),
    referencia text NOT NULL,
    zona_id text NOT NULL,
    anulada boolean NOT NULL DEFAULT false,
    anulacion_emitida_en timestamptz,
    anulacion_recibida_en timestamptz,
    excluida boolean NOT NULL DEFAULT false,
    version integer NOT NULL CHECK (version >= 0),
    PRIMARY KEY (evento_id, referencia),
    FOREIGN KEY (evento_id, zona_id) REFERENCES m1_config_permisos.zonas(evento_id, id)
);
CREATE INDEX boletas_zona_idx ON m1_config_permisos.boletas(evento_id, zona_id);

CREATE TABLE m1_config_permisos.cambios_permisos (
    evento_id text NOT NULL REFERENCES m1_config_permisos.eventos(id),
    version integer NOT NULL CHECK (version >= 0),
    referencia text NOT NULL,
    operacion text NOT NULL CHECK (operacion IN ('alta', 'anulacion', 'cambio-zona')),
    zona_id text,
    recibido_en timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (evento_id, version),
    FOREIGN KEY (evento_id, zona_id) REFERENCES m1_config_permisos.zonas(evento_id, id)
);
CREATE INDEX cambios_permisos_ref_idx
    ON m1_config_permisos.cambios_permisos(evento_id, referencia);

CREATE TABLE m1_config_permisos.controles_preparacion (
    evento_id text NOT NULL REFERENCES m1_config_permisos.eventos(id),
    id text NOT NULL,
    titulo text NOT NULL,
    confirmado boolean NOT NULL DEFAULT false,
    confirmado_en timestamptz,
    confirmado_por bigint,
    PRIMARY KEY (evento_id, id)
);

CREATE TABLE auth.operadores (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario text NOT NULL UNIQUE,
    nombre text NOT NULL,
    rol text NOT NULL CHECK (rol IN ('SUPERVISOR', 'LIDER_TECNICO', 'LOGISTICA', 'CIERRE', 'FINANZAS')),
    contrasena_hash text NOT NULL CHECK (contrasena_hash LIKE '$argon2%'),
    activo boolean NOT NULL DEFAULT true,
    creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth.sesiones (
    id text PRIMARY KEY,
    operador_id bigint NOT NULL REFERENCES auth.operadores(id),
    creada_en timestamptz NOT NULL DEFAULT now(),
    expira_en timestamptz NOT NULL,
    revocada_en timestamptz,
    CHECK (expira_en > creada_en)
);
CREATE INDEX sesiones_operador_idx ON auth.sesiones(operador_id);
CREATE INDEX sesiones_expira_idx ON auth.sesiones(expira_en);

ALTER TABLE m1_config_permisos.eventos
    ADD CONSTRAINT eventos_apertura_operador_fk
    FOREIGN KEY (apertura_confirmada_por) REFERENCES auth.operadores(id);
ALTER TABLE m1_config_permisos.controles_preparacion
    ADD CONSTRAINT controles_operador_fk
    FOREIGN KEY (confirmado_por) REFERENCES auth.operadores(id);

CREATE TABLE m2_evidencia.lotes (
    id_lote text PRIMARY KEY,
    evento_id text NOT NULL,
    recinto_id text NOT NULL,
    coordinador_id text NOT NULL,
    emitido_en timestamptz NOT NULL,
    recibido_en timestamptz NOT NULL DEFAULT now(),
    contenido_hash text NOT NULL,
    acuse jsonb,
    UNIQUE (id_lote, evento_id),
    FOREIGN KEY (evento_id, recinto_id) REFERENCES m1_config_permisos.eventos(id, recinto_id),
    CHECK (jsonb_typeof(acuse) = 'object')
);
CREATE INDEX lotes_evento_fecha_idx ON m2_evidencia.lotes(evento_id, recibido_en DESC);

CREATE TABLE m2_evidencia.evidencias (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    id_lote text NOT NULL,
    evento_id text NOT NULL REFERENCES m1_config_permisos.eventos(id),
    tipo text NOT NULL CHECK (tipo IN ('decision', 'intento-diario', 'latido-punto', 'estado-coordinador')),
    id_origen text NOT NULL,
    contenido_hash text NOT NULL,
    contenido jsonb NOT NULL CHECK (jsonb_typeof(contenido) = 'object'),
    ocurrido_en timestamptz NOT NULL,
    recibido_en timestamptz NOT NULL DEFAULT now(),
    UNIQUE (evento_id, tipo, id_origen),
    FOREIGN KEY (id_lote, evento_id) REFERENCES m2_evidencia.lotes(id_lote, evento_id)
);
CREATE INDEX evidencias_evento_fecha_idx ON m2_evidencia.evidencias(evento_id, ocurrido_en DESC);
CREATE INDEX evidencias_lote_idx ON m2_evidencia.evidencias(id_lote);

CREATE TABLE m2_evidencia.decisiones (
    evidencia_id bigint PRIMARY KEY REFERENCES m2_evidencia.evidencias(id),
    evento_id text NOT NULL REFERENCES m1_config_permisos.eventos(id),
    id_origen text NOT NULL,
    referencia text,
    zona_id text,
    punto_id text,
    lector_id text,
    instante_decision timestamptz NOT NULL,
    decision text NOT NULL CHECK (decision IN ('aceptado', 'rechazado', 'sin-respuesta')),
    motivo text NOT NULL,
    proposito text NOT NULL CHECK (proposito IN ('ingreso', 'reingreso')),
    admision boolean NOT NULL DEFAULT false,
    concurrente boolean NOT NULL DEFAULT false,
    anulacion_en_transito boolean NOT NULL DEFAULT false,
    latencia_ms numeric(12,3) CHECK (latencia_ms >= 0),
    via text,
    version_permisos integer CHECK (version_permisos >= 0),
    version_politicas integer CHECK (version_politicas >= 0),
    antiguedad_permisos_s integer CHECK (antiguedad_permisos_s >= 0),
    UNIQUE (evento_id, id_origen),
    CHECK (NOT admision OR (decision = 'aceptado' AND proposito = 'ingreso')),
    FOREIGN KEY (evento_id, punto_id) REFERENCES m1_config_permisos.puntos(evento_id, id)
);
CREATE INDEX decisiones_evento_fecha_idx ON m2_evidencia.decisiones(evento_id, instante_decision DESC);
CREATE INDEX decisiones_evento_referencia_idx ON m2_evidencia.decisiones(evento_id, referencia);
CREATE INDEX decisiones_punto_fecha_idx ON m2_evidencia.decisiones(punto_id, instante_decision DESC);

CREATE TABLE m2_evidencia.puntos_estado (
    evento_id text NOT NULL,
    punto_id text NOT NULL,
    lector_id text,
    estado text NOT NULL DEFAULT 'sin-abrir'
        CHECK (estado IN ('en-linea', 'sin-comunicacion', 'averiado', 'en-pausa', 'sin-abrir')),
    ultima_comunicacion timestamptz,
    pendientes_diario integer NOT NULL DEFAULT 0 CHECK (pendientes_diario >= 0),
    diario_total integer NOT NULL DEFAULT 0 CHECK (diario_total >= 0),
    version_permisos integer NOT NULL DEFAULT 0 CHECK (version_permisos >= 0),
    latido_secuencia bigint,
    actualizado_en timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (evento_id, punto_id),
    FOREIGN KEY (evento_id, punto_id) REFERENCES m1_config_permisos.puntos(evento_id, id)
);

CREATE TABLE m2_evidencia.conteos_minuto (
    evento_id text NOT NULL REFERENCES m1_config_permisos.eventos(id),
    punto_id text NOT NULL,
    minuto timestamptz NOT NULL,
    intentos integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
    aceptados integer NOT NULL DEFAULT 0 CHECK (aceptados >= 0),
    admisiones integer NOT NULL DEFAULT 0 CHECK (admisiones >= 0),
    reingresos integer NOT NULL DEFAULT 0 CHECK (reingresos >= 0),
    rechazados integer NOT NULL DEFAULT 0 CHECK (rechazados >= 0),
    sin_respuesta integer NOT NULL DEFAULT 0 CHECK (sin_respuesta >= 0),
    PRIMARY KEY (evento_id, punto_id, minuto),
    FOREIGN KEY (evento_id, punto_id) REFERENCES m1_config_permisos.puntos(evento_id, id)
);
CREATE INDEX conteos_minuto_fecha_idx ON m2_evidencia.conteos_minuto(evento_id, minuto DESC);

CREATE TABLE m2_evidencia.eventos_estado (
    evento_id text PRIMARY KEY REFERENCES m1_config_permisos.eventos(id),
    coordinador_estado text NOT NULL DEFAULT 'sin-autoridad'
        CHECK (coordinador_estado IN ('operando', 'sin-autoridad', 'protegiendo')),
    coordinador_desde timestamptz,
    coordinador_id text,
    enlace_en_linea boolean NOT NULL DEFAULT false,
    enlace_caida_desde timestamptz,
    outbox_pendientes integer NOT NULL DEFAULT 0 CHECK (outbox_pendientes >= 0),
    outbox_edad_max_s integer NOT NULL DEFAULT 0 CHECK (outbox_edad_max_s >= 0),
    ultimo_lote_recibido timestamptz,
    version_permisos integer NOT NULL DEFAULT 0 CHECK (version_permisos >= 0),
    version_politicas integer NOT NULL DEFAULT 0 CHECK (version_politicas >= 0),
    actualizado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE m2_evidencia.incidentes (
    id text PRIMARY KEY,
    evento_id text NOT NULL REFERENCES m1_config_permisos.eventos(id),
    tipo text NOT NULL,
    clasificacion text NOT NULL,
    prioridad text NOT NULL CHECK (prioridad IN ('critica', 'alta', 'media', 'baja')),
    punto_id text,
    componente text,
    zona_id text,
    titulo text NOT NULL,
    descripcion text NOT NULL,
    responsable text,
    estado text NOT NULL DEFAULT 'nuevo'
        CHECK (estado IN ('nuevo', 'en-curso', 'resuelto', 'descartado')),
    recibida_en timestamptz NOT NULL DEFAULT now(),
    actuada_en timestamptz,
    resuelta_en timestamptz,
    recuperada_en timestamptz,
    meta_recuperacion_s integer,
    reloj_desde timestamptz,
    destacado boolean NOT NULL DEFAULT false,
    checklist jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(checklist) = 'array'),
    UNIQUE (evento_id, id),
    FOREIGN KEY (evento_id, punto_id) REFERENCES m1_config_permisos.puntos(evento_id, id),
    FOREIGN KEY (evento_id, zona_id) REFERENCES m1_config_permisos.zonas(evento_id, id)
);
CREATE INDEX incidentes_evento_estado_idx ON m2_evidencia.incidentes(evento_id, estado, recibida_en DESC);

CREATE TABLE m2_evidencia.acciones (
    id text PRIMARY KEY,
    evento_id text NOT NULL REFERENCES m1_config_permisos.eventos(id),
    incidente_id text,
    tipo text NOT NULL CHECK (tipo IN ('redirigir', 'credencial', 'promover', 'reingresos', 'preliminar')),
    titulo text NOT NULL,
    detalle text NOT NULL,
    si text NOT NULL,
    no text,
    rol text NOT NULL CHECK (rol IN ('SUPERVISOR', 'LIDER_TECNICO', 'LOGISTICA', 'CIERRE', 'FINANZAS')),
    enlace text,
    decisiva boolean NOT NULL DEFAULT false,
    estado text NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'aprobada', 'rechazada', 'caducada')),
    creada_en timestamptz NOT NULL DEFAULT now(),
    decidida_en timestamptz,
    operador_id bigint REFERENCES auth.operadores(id),
    nota text,
    FOREIGN KEY (evento_id, incidente_id) REFERENCES m2_evidencia.incidentes(evento_id, id)
);
CREATE INDEX acciones_evento_estado_idx ON m2_evidencia.acciones(evento_id, estado, creada_en DESC);

CREATE TABLE m2_evidencia.bitacora (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    evento_id text NOT NULL REFERENCES m1_config_permisos.eventos(id),
    incidente_id text REFERENCES m2_evidencia.incidentes(id),
    accion_id text REFERENCES m2_evidencia.acciones(id),
    evidencia_id bigint REFERENCES m2_evidencia.evidencias(id),
    operador_id bigint REFERENCES auth.operadores(id),
    autor text NOT NULL,
    tipo text NOT NULL,
    texto text NOT NULL,
    creada_en timestamptz NOT NULL DEFAULT now(),
    datos jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(datos) = 'object')
);
CREATE INDEX bitacora_evento_fecha_idx ON m2_evidencia.bitacora(evento_id, creada_en DESC);
CREATE INDEX bitacora_incidente_fecha_idx ON m2_evidencia.bitacora(incidente_id, creada_en);

CREATE FUNCTION m2_evidencia.rechazar_modificacion_bitacora()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'La bitácora es de solo adición' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER bitacora_solo_adicion
    BEFORE UPDATE OR DELETE ON m2_evidencia.bitacora
    FOR EACH ROW EXECUTE FUNCTION m2_evidencia.rechazar_modificacion_bitacora();

CREATE TABLE m3_conciliacion.conciliaciones (
    evento_id text PRIMARY KEY REFERENCES m1_config_permisos.eventos(id),
    estado text NOT NULL DEFAULT 'sin-iniciar'
        CHECK (estado IN ('sin-iniciar', 'en-curso', 'preliminar', 'conciliado')),
    preliminar_en timestamptz,
    definitivo_en timestamptz,
    preliminar_por bigint REFERENCES auth.operadores(id),
    definitivo_por bigint REFERENCES auth.operadores(id),
    actualizado_en timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE m3_conciliacion.diferencias (
    id text PRIMARY KEY,
    evento_id text NOT NULL REFERENCES m1_config_permisos.eventos(id),
    referencia text,
    tipo text NOT NULL,
    descripcion text NOT NULL,
    estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'resuelta')),
    detectada_en timestamptz NOT NULL DEFAULT now(),
    resuelta_en timestamptz,
    resolucion text,
    UNIQUE (evento_id, id)
);
CREATE INDEX diferencias_pendientes_idx ON m3_conciliacion.diferencias(evento_id, estado);

CREATE TABLE m3_conciliacion.resoluciones (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    evento_id text NOT NULL,
    diferencia_id text NOT NULL,
    opcion text NOT NULL,
    operador_id bigint NOT NULL REFERENCES auth.operadores(id),
    creada_en timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (evento_id, diferencia_id) REFERENCES m3_conciliacion.diferencias(evento_id, id)
);

CREATE TABLE m4_liquidacion.contratos (
    id text PRIMARY KEY,
    cliente_id text NOT NULL REFERENCES m1_config_permisos.clientes(id),
    evento_id text NOT NULL UNIQUE REFERENCES m1_config_permisos.eventos(id),
    tarifa_por_admision numeric(18,4) NOT NULL DEFAULT 0 CHECK (tarifa_por_admision >= 0),
    minimo numeric(18,2) NOT NULL DEFAULT 0 CHECK (minimo >= 0),
    moneda char(3) NOT NULL DEFAULT 'COP',
    condiciones jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(condiciones) = 'object')
);

CREATE TABLE m4_liquidacion.liquidaciones (
    evento_id text PRIMARY KEY REFERENCES m1_config_permisos.eventos(id),
    contrato_id text NOT NULL REFERENCES m4_liquidacion.contratos(id),
    admisiones integer NOT NULL CHECK (admisiones >= 0),
    subtotal numeric(18,2) NOT NULL CHECK (subtotal >= 0),
    total numeric(18,2) NOT NULL CHECK (total >= 0),
    saldo_cobrado boolean NOT NULL DEFAULT false,
    cobrado_en timestamptz,
    calculada_en timestamptz NOT NULL DEFAULT now(),
    cerrada_en timestamptz
);

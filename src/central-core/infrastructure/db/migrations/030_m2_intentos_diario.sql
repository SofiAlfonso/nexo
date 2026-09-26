-- M2 (PU-04-05): proyección de intentos recuperados del diario del lector (H1 → E1) sin decisión de C2.
-- Se consolidan como `pendiente` y no tienen columnas de decisión ni admisión: la nube no autoriza y
-- no hay aceptación retroactiva. Solo adición; una decisión posterior de C2 llega como otra evidencia.
CREATE TABLE m2_evidencia.intentos_diario (
    evidencia_id bigint PRIMARY KEY REFERENCES m2_evidencia.evidencias(id),
    evento_id text NOT NULL REFERENCES m1_config_permisos.eventos(id),
    id_origen text NOT NULL,
    referencia text NOT NULL,
    zona_solicitada text NOT NULL,
    proposito text NOT NULL CHECK (proposito IN ('ingreso', 'reingreso')),
    punto_id text NOT NULL,
    lector_id text NOT NULL,
    motivo_local text NOT NULL,
    instante_lector timestamptz NOT NULL,
    recibido_en_coordinador timestamptz NOT NULL,
    estado text NOT NULL DEFAULT 'pendiente' CHECK (estado = 'pendiente'),
    UNIQUE (evento_id, id_origen)
);
CREATE INDEX intentos_diario_punto_idx ON m2_evidencia.intentos_diario(evento_id, punto_id, instante_lector DESC);

-- M3: detalle de una diferencia (prototipo §9): título, origen, cantidad de casos, referencia al
-- intento que la originó, opciones de resolución sugeridas (la primera es la sugerida) y el rol
-- que la resolvió. `resolucion` ya guarda el texto/opción elegida.
ALTER TABLE m3_conciliacion.diferencias
    ADD COLUMN titulo text NOT NULL DEFAULT '',
    ADD COLUMN origen text NOT NULL DEFAULT '',
    ADD COLUMN casos integer NOT NULL DEFAULT 0 CHECK (casos >= 0),
    ADD COLUMN intento_id text,
    ADD COLUMN opciones jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(opciones) = 'array'),
    ADD COLUMN resuelta_por text
        CHECK (resuelta_por IN ('SUPERVISOR', 'LIDER_TECNICO', 'LOGISTICA', 'CIERRE', 'FINANZAS'));

-- Secuencia para los `id` legibles DIF-NNN que exige el contrato O2 `Diferencia`.
CREATE SEQUENCE m3_conciliacion.diferencias_id_seq;

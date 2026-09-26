-- C3 (dentro de M1): versiones P1 de la boletería ya traducidas y aplicadas al modelo canónico.
-- Idempotencia por (evento, versión externa): repetir la misma huella no cambia nada y una huella
-- distinta es un conflicto de integridad. Solo adición: no se corrigen importaciones pasadas.
CREATE TABLE m1_config_permisos.importaciones_boleteria (
    evento_id text NOT NULL REFERENCES m1_config_permisos.eventos(id),
    evento_externo text NOT NULL,
    version_externa integer NOT NULL CHECK (version_externa >= 0),
    huella text NOT NULL CHECK (huella ~ '^[0-9a-f]{64}$'),
    instantanea boolean NOT NULL,
    cambios_recibidos integer NOT NULL CHECK (cambios_recibidos >= 0),
    cambios_aplicados integer NOT NULL CHECK (cambios_aplicados >= 0),
    version_permisos_desde integer NOT NULL CHECK (version_permisos_desde >= 0),
    version_permisos_hasta integer NOT NULL CHECK (version_permisos_hasta >= version_permisos_desde),
    importada_en timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (evento_id, version_externa)
);

CREATE FUNCTION m1_config_permisos.prohibir_cambios_importacion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'importaciones_boleteria es solo de adicion: % prohibido', TG_OP;
END;
$$;
CREATE TRIGGER importaciones_boleteria_solo_adicion
    BEFORE UPDATE OR DELETE ON m1_config_permisos.importaciones_boleteria
    FOR EACH ROW EXECUTE FUNCTION m1_config_permisos.prohibir_cambios_importacion();

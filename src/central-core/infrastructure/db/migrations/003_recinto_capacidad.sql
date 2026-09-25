ALTER TABLE m1_config_permisos.recintos
    ADD COLUMN capacidad integer CHECK (capacidad > 0);

-- T12/M4: detalle de la liquidación (importe, anticipo, saldo/devolución, costos, contribución y
-- margen) que exige el prototipo §9 y el contrato O2 `Liquidacion`. `total` ya guardaba el
-- importe facturado (cargo base + admisiones facturables); se documenta y se completa con el
-- resto del desglose.
COMMENT ON COLUMN m4_liquidacion.liquidaciones.total IS
    'Importe facturado: cargo base del evento más admisiones facturables por la tarifa unitaria.';

ALTER TABLE m4_liquidacion.liquidaciones
    ADD COLUMN excluidas integer NOT NULL DEFAULT 0 CHECK (excluidas >= 0),
    ADD COLUMN facturables integer NOT NULL DEFAULT 0 CHECK (facturables >= 0),
    ADD COLUMN anticipo numeric(18,2) NOT NULL DEFAULT 0 CHECK (anticipo >= 0),
    ADD COLUMN saldo numeric(18,2) NOT NULL DEFAULT 0 CHECK (saldo >= 0),
    ADD COLUMN devolucion numeric(18,2) NOT NULL DEFAULT 0 CHECK (devolucion >= 0),
    ADD COLUMN costos numeric(18,2) NOT NULL DEFAULT 0 CHECK (costos >= 0),
    ADD COLUMN contribucion numeric(18,2) NOT NULL DEFAULT 0,
    ADD COLUMN margen numeric(6,4) NOT NULL DEFAULT 0,
    ADD COLUMN cobro_vence_en timestamptz;

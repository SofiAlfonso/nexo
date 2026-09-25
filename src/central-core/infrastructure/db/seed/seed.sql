-- Run after D2 migrations with psql --set=operator_password_hash=<argon2 hash>.
-- No personal data or plaintext credentials are stored.
INSERT INTO m1_config_permisos.clientes(id, nombre)
VALUES ('CLI-001', 'Club Deportivo Cordillera (ficticio)')
ON CONFLICT (id) DO NOTHING;

INSERT INTO m1_config_permisos.recintos(id, cliente_id, nombre, capacidad)
VALUES ('REC-01', 'CLI-001', 'Estadio Cordillera', 20000)
ON CONFLICT (id) DO UPDATE
    SET capacidad = COALESCE(m1_config_permisos.recintos.capacidad, EXCLUDED.capacidad);

INSERT INTO m1_config_permisos.eventos
    (id, recinto_id, nombre, nombre_corto, boleteria, apertura, cierre,
     admisiones_estimadas, gratuito, estado, version_permisos, ultimo_cambio_recibido)
VALUES
    ('EVT-2026-01', 'REC-01', 'Fecha 12 · Cordillera vs. Andes FC', 'Fecha 12',
     'TaquillaAndina', '2026-08-30 17:00:00-05', '2026-08-30 20:15:00-05',
     14212, false, 'cerrado', 1, '2026-08-30 16:20:00-05'),
    ('EVT-2026-02', 'REC-01', 'Fecha 14 · Cordillera vs. Real Pacífico', 'Fecha 14',
     'TaquillaAndina', now() - interval '1 hour', now() + interval '6 hours',
     15000, false, 'abierto', 1, now() - interval '1 minute'),
    ('EVT-2026-03', 'REC-01', 'Fecha 16 · Cordillera vs. Unión Norte', 'Fecha 16',
     'TaquillaAndina', '2026-10-04 17:00:00-05', '2026-10-04 20:15:00-05',
     0, true, 'preparacion', 1, '2026-10-04 16:20:00-05')
ON CONFLICT (id) DO NOTHING;

INSERT INTO m1_config_permisos.zonas(id, evento_id, nombre)
VALUES
    ('Z-NORTE', 'EVT-2026-02', 'Norte'),
    ('Z-SUR', 'EVT-2026-02', 'Sur'),
    ('Z-ORIENTAL', 'EVT-2026-02', 'Oriental'),
    ('Z-OCCIDENTAL', 'EVT-2026-02', 'Occidental'),
    ('Z-PALCOS', 'EVT-2026-02', 'Palcos')
ON CONFLICT (id) DO NOTHING;

INSERT INTO m1_config_permisos.puntos(id, evento_id, nombre, zona_id)
SELECT 'P-' || lpad(n::text, 2, '0'), 'EVT-2026-02',
       'Puerta ' || zona || ' ' || (n - inicio + 1), zona_id
FROM generate_series(1, 20) AS n
CROSS JOIN LATERAL (
    SELECT CASE WHEN n <= 5 THEN 'Norte' WHEN n <= 9 THEN 'Sur'
                WHEN n <= 14 THEN 'Oriental' WHEN n <= 18 THEN 'Occidental'
                ELSE 'Palcos' END AS zona,
           CASE WHEN n <= 5 THEN 'Z-NORTE' WHEN n <= 9 THEN 'Z-SUR'
                WHEN n <= 14 THEN 'Z-ORIENTAL' WHEN n <= 18 THEN 'Z-OCCIDENTAL'
                ELSE 'Z-PALCOS' END AS zona_id,
           CASE WHEN n <= 5 THEN 1 WHEN n <= 9 THEN 6
                WHEN n <= 14 THEN 10 WHEN n <= 18 THEN 15 ELSE 19 END AS inicio
) AS grupo
ON CONFLICT (id) DO NOTHING;

INSERT INTO m1_config_permisos.punto_zonas(evento_id, punto_id, zona_id)
SELECT evento_id, id, zona_id FROM m1_config_permisos.puntos
WHERE evento_id = 'EVT-2026-02'
ON CONFLICT DO NOTHING;
INSERT INTO m1_config_permisos.punto_zonas(evento_id, punto_id, zona_id)
VALUES ('EVT-2026-02', 'P-01', 'Z-PALCOS'),
       ('EVT-2026-02', 'P-07', 'Z-PALCOS')
ON CONFLICT DO NOTHING;

INSERT INTO m1_config_permisos.lectores
    (id, evento_id, punto_id, familia, procedencia, credencial, desde)
SELECT 'LX-2210-' || lpad((100 + n * 7)::text, 4, '0'),
       'EVT-2026-02', 'P-' || lpad(n::text, 2, '0'),
       'Zebra TC21', CASE WHEN n <= 14 THEN 'Cliente' ELSE 'Alquiler' END,
       'CRED-P-' || lpad(n::text, 2, '0') || '-A',
       '2026-09-16 15:20:00-05'::timestamptz
FROM generate_series(1, 20) AS n
ON CONFLICT (id) DO NOTHING;

INSERT INTO m1_config_permisos.politicas
    (evento_id, version, reingreso_permitido, reingreso_tras_min, reingreso_suspendido)
VALUES ('EVT-2026-02', 1, false, 10, false)
ON CONFLICT (evento_id) DO NOTHING;
INSERT INTO m1_config_permisos.versiones_politica
    (evento_id, version, reingreso_permitido, reingreso_tras_min, reingreso_suspendido)
VALUES ('EVT-2026-02', 1, false, 10, false)
ON CONFLICT (evento_id, version) DO NOTHING;

-- Identifiers match the prototype's TA-88dd-dddd reference generation.
WITH grupos(zona_id, inicio, cantidad) AS (
    VALUES ('Z-NORTE', 0, 4980), ('Z-SUR', 4980, 3360),
           ('Z-ORIENTAL', 8340, 4010), ('Z-OCCIDENTAL', 12350, 3360),
           ('Z-PALCOS', 15710, 530)
)
INSERT INTO m1_config_permisos.boletas
    (evento_id, referencia, zona_id, version, anulada, anulacion_emitida_en, anulacion_recibida_en)
SELECT 'EVT-2026-02',
       'TA-' || (8800 + (n / 1000))::text || '-' || lpad((n % 1000)::text, 4, '0'),
       zona_id, 1, n = 1,
       CASE WHEN n = 1 THEN now() - interval '5 minutes' END,
       CASE WHEN n = 1 THEN now() - interval '4 minutes' END
FROM grupos CROSS JOIN LATERAL generate_series(inicio, inicio + cantidad - 1) AS n
ON CONFLICT (evento_id, referencia) DO NOTHING;

INSERT INTO m2_evidencia.puntos_estado(evento_id, punto_id)
SELECT evento_id, id FROM m1_config_permisos.puntos
WHERE evento_id = 'EVT-2026-02'
ON CONFLICT (evento_id, punto_id) DO NOTHING;
INSERT INTO m2_evidencia.eventos_estado(evento_id, version_permisos, version_politicas)
VALUES ('EVT-2026-02', 1, 1)
ON CONFLICT (evento_id) DO NOTHING;

INSERT INTO m3_conciliacion.conciliaciones(evento_id, estado, preliminar_en, definitivo_en)
VALUES
    ('EVT-2026-01', 'conciliado', '2026-08-30 20:30:00-05', '2026-08-31 10:00:00-05'),
    ('EVT-2026-02', 'sin-iniciar', NULL, NULL),
    ('EVT-2026-03', 'sin-iniciar', NULL, NULL)
ON CONFLICT (evento_id) DO NOTHING;

INSERT INTO m4_liquidacion.contratos
    (id, cliente_id, tarifa_por_admision, minimo, moneda, condiciones)
VALUES
    ('CT-2026-014', 'CLI-001', 0.40, 500.00, 'USD',
     '{"acordadoEn":"2026-08-20","origen":"Acuerdo nuevo · piloto de tres eventos","recompraDias":60,"anticipoEvento01":"3500.00","costosEvento01":"318.00","costosTopeEvento03":"600.00"}'::jsonb)
ON CONFLICT (id) DO UPDATE
    SET condiciones = EXCLUDED.condiciones || m4_liquidacion.contratos.condiciones;

INSERT INTO m4_liquidacion.contrato_eventos(contrato_id, evento_id)
VALUES
    ('CT-2026-014', 'EVT-2026-01'),
    ('CT-2026-014', 'EVT-2026-02'),
    ('CT-2026-014', 'EVT-2026-03')
ON CONFLICT (evento_id) DO NOTHING;

INSERT INTO m4_liquidacion.liquidaciones
    (evento_id, contrato_id, admisiones, subtotal, total, saldo_cobrado, cobrado_en, cerrada_en)
VALUES
    ('EVT-2026-01', 'CT-2026-014', 14212, 6184.80, 6184.80, true,
     '2026-08-31 10:00:00-05', '2026-08-31 10:00:00-05')
ON CONFLICT (evento_id) DO NOTHING;

INSERT INTO auth.operadores(usuario, nombre, rol, contrasena_hash)
VALUES
    ('supervisor', 'Supervisor del operador', 'SUPERVISOR', :'operator_password_hash'),
    ('lider-tecnico', 'Líder técnico', 'LIDER_TECNICO', :'operator_password_hash'),
    ('logistica', 'Logística de puerta', 'LOGISTICA', :'operator_password_hash'),
    ('cierre', 'Responsable de cierre', 'CIERRE', :'operator_password_hash'),
    ('finanzas', 'Líder comercial y financiero', 'FINANZAS', :'operator_password_hash')
ON CONFLICT (usuario) DO NOTHING;

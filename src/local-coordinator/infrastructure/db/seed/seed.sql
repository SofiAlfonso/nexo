-- Local fixture only: no buyer identity, credentials, or real signed P2 package.
-- Run after migrations; seed.ts applies this file in a database transaction.
-- Re-running refreshes only the demo event's open window; confirmed consumptions
-- and audit/outbox rows are never reset.
INSERT INTO evento (
  evento_id, cliente_id, boleteria_id, recinto_id, estado,
  apertura_en, cierre_en, version_permisos, version_politicas,
  reingreso_permitido, permisos_recibidos_en
) VALUES (
  'EVT-2026-02', 'CLI-001', 'BOL-01', 'REC-01', 'abierto',
  now() - interval '1 hour', now() + interval '12 hours', 1, 1,
  false, now() - interval '1 minute'
)
ON CONFLICT (evento_id) DO UPDATE SET
  estado = EXCLUDED.estado,
  apertura_en = EXCLUDED.apertura_en,
  cierre_en = EXCLUDED.cierre_en,
  version_permisos = EXCLUDED.version_permisos,
  version_politicas = EXCLUDED.version_politicas,
  reingreso_permitido = false,
  permisos_recibidos_en = EXCLUDED.permisos_recibidos_en;

-- Provenance of the pre-installed demo permission version. Deliberately not a
-- signed P2 response: only C4 may issue a real signed package.
INSERT INTO permiso_version (
  evento_id, version, desde_version, tipo, paquete, emitido_en,
  vigente_hasta, apertura_en, cierre_en, version_politicas
)
SELECT evento_id, 1, 0, 'instantanea',
  jsonb_build_object('fixture', 'demo-only', 'eventoId', evento_id,
                     'hastaVersion', 1, 'firma', NULL),
  permisos_recibidos_en, cierre_en, apertura_en, cierre_en, 1
FROM evento
WHERE evento_id = 'EVT-2026-02'
ON CONFLICT (evento_id, version) DO UPDATE SET
  paquete = EXCLUDED.paquete,
  emitido_en = EXCLUDED.emitido_en,
  vigente_hasta = EXCLUDED.vigente_hasta,
  apertura_en = EXCLUDED.apertura_en,
  cierre_en = EXCLUDED.cierre_en,
  version_politicas = EXCLUDED.version_politicas;

WITH asignacion AS (
  SELECT n,
    CASE WHEN n <= 5 THEN 'Norte'
         WHEN n <= 9 THEN 'Sur'
         WHEN n <= 14 THEN 'Oriental'
         WHEN n <= 18 THEN 'Occidental'
         ELSE 'Palcos' END AS zona
  FROM generate_series(1, 20) AS n
)
INSERT INTO punto (evento_id, punto_id, zonas, habilitado)
SELECT 'EVT-2026-02', 'P-' || lpad(n::text, 2, '0'),
  CASE WHEN n IN (1, 7) THEN ARRAY[zona, 'Palcos'] ELSE ARRAY[zona] END,
  true
FROM asignacion
ON CONFLICT (evento_id, punto_id) DO UPDATE SET zonas = EXCLUDED.zonas
WHERE punto.zonas IS DISTINCT FROM EXCLUDED.zonas;

INSERT INTO lector (evento_id, lector_id, punto_id, habilitado, revocado)
SELECT 'EVT-2026-02', 'LX-2210-' || lpad((100 + 7 * n)::text, 4, '0'),
  'P-' || lpad(n::text, 2, '0'), true, false
FROM generate_series(1, 20) AS n
ON CONFLICT (evento_id, lector_id) DO NOTHING;

-- Five zone distributions: 4,980 + 3,360 + 4,010 + 3,360 + 530 = 16,240.
-- Samples at P-01: TA-8800-0000 valid, TA-8804-0980 other zone,
-- TA-8800-0001 annulled, TA-8800-0002 already used; any absent code
-- is unknown. Racing an unused reference at P-01/P-02 exercises
-- the global unique-consumption constraint.
WITH grupos(zona, inicio, cantidad) AS (
  VALUES ('Norte', 0, 4980),
         ('Sur', 4980, 3360),
         ('Oriental', 8340, 4010),
         ('Occidental', 12350, 3360),
         ('Palcos', 15710, 530)
)
INSERT INTO boleta (
  evento_id, referencia, zona, anulada_en, anulacion_recibida_en, version
)
SELECT 'EVT-2026-02',
  'TA-' || (8800 + (n / 1000))::text || '-' || lpad((n % 1000)::text, 4, '0'),
  zona,
  CASE WHEN n = 1 THEN now() - interval '5 minutes' ELSE NULL END,
  CASE WHEN n = 1 THEN now() - interval '4 minutes' ELSE NULL END,
  1
FROM grupos
CROSS JOIN LATERAL generate_series(inicio, inicio + cantidad - 1) AS n
ON CONFLICT (evento_id, referencia) DO UPDATE SET zona = EXCLUDED.zona
WHERE boleta.zona IS DISTINCT FROM EXCLUDED.zona;

UPDATE boleta
SET anulada_en = LEAST(COALESCE(anulada_en, now() - interval '5 minutes'),
                       now() - interval '5 minutes'),
    anulacion_recibida_en = LEAST(COALESCE(anulacion_recibida_en, now() - interval '4 minutes'),
                                  now() - interval '4 minutes')
WHERE evento_id = 'EVT-2026-02'
  AND referencia = 'TA-8800-0001'
  AND (anulada_en IS NULL OR anulacion_recibida_en IS NULL
       OR anulada_en > now() OR anulacion_recibida_en > now());

-- Deterministic used-ticket fixture: preserve the complete original
-- acceptance (identity, decision, consumption, immutable audit and outbox).
-- Re-running the seed cannot make this ticket available again.
INSERT INTO intento (
  evento_id, id_origen, huella, lector_id, punto_id, codigo, proposito,
  zona_solicitada, instante_lector, decision, motivo, respuesta, decidido_en
)
VALUES (
  'EVT-2026-02', 'seed:used:EVT-2026-02:TA-8800-0002',
  '1d26a4f2de55e46762986d7485dd11f5184a1ca1be1f29967b3a8b3bf1229672',
  'LX-2210-0107', 'P-01', 'TA-8800-0002', 'ingreso', 'Norte',
  now() - interval '2 minutes', 'aceptado', 'PERMISO_VIGENTE',
  jsonb_build_object(
    'idOrigen', 'seed:used:EVT-2026-02:TA-8800-0002',
    'decision', 'aceptado', 'motivo', 'PERMISO_VIGENTE',
    'proposito', 'ingreso', 'admision', true, 'concurrente', false,
    'anulacionEnTransito', false, 'versionPermisos', 1,
    'evidencia', jsonb_build_object(
      'via', 'Coordinador COORD-A', 'versionPermisos', 1,
      'versionPoliticas', 1, 'antiguedadPermisosS', 60
    ),
    'instanteDecision', now() - interval '2 minutes', 'repetida', false
  ),
  now() - interval '2 minutes'
)
ON CONFLICT (id_origen) DO NOTHING;

INSERT INTO decision (
  id_origen, decision, motivo, proposito, admision, concurrente,
  anulacion_en_transito, version_permisos, evidencia, instante_decision
)
VALUES (
  'seed:used:EVT-2026-02:TA-8800-0002',
  'aceptado', 'PERMISO_VIGENTE', 'ingreso', true, false,
  false, 1,
  '{"via":"Coordinador COORD-A","versionPermisos":1,"versionPoliticas":1,"antiguedadPermisosS":60}',
  now() - interval '2 minutes'
)
ON CONFLICT (id_origen) DO NOTHING;

INSERT INTO consumo (
  cliente_id, evento_id, boleteria_id, referencia, id_origen,
  punto_id, lector_id, consumido_en
)
VALUES (
  'CLI-001', 'EVT-2026-02', 'BOL-01', 'TA-8800-0002',
  'seed:used:EVT-2026-02:TA-8800-0002',
  'P-01', 'LX-2210-0107', now() - interval '2 minutes'
)
ON CONFLICT (cliente_id, evento_id, boleteria_id, referencia, proposito) DO NOTHING;

INSERT INTO bitacora (evento_id, tipo, id_origen, contenido)
VALUES (
  'EVT-2026-02', 'decision', 'seed:used:EVT-2026-02:TA-8800-0002',
  jsonb_build_object(
    'tipo', 'decision', 'idOrigen', 'seed:used:EVT-2026-02:TA-8800-0002',
    'lectorId', 'LX-2210-0107', 'puntoId', 'P-01', 'codigo', 'TA-8800-0002',
    'zona', 'Norte', 'zonaSolicitada', 'Norte',
    'decision', 'aceptado', 'motivo', 'PERMISO_VIGENTE',
    'proposito', 'ingreso', 'admision', true, 'concurrente', false,
    'anulacionEnTransito', false,
    'evidencia', jsonb_build_object(
      'via', 'Coordinador COORD-A', 'versionPermisos', 1,
      'versionPoliticas', 1, 'antiguedadPermisosS', 60
    ),
    'instanteLector', now() - interval '2 minutes',
    'instanteDecision', now() - interval '2 minutes'
  )
)
ON CONFLICT (evento_id, tipo, id_origen) DO NOTHING;

INSERT INTO outbox (bitacora_id, evento_id, tipo, id_origen, registro)
SELECT id, evento_id, tipo, id_origen, contenido
FROM bitacora
WHERE evento_id = 'EVT-2026-02'
  AND tipo = 'decision'
  AND id_origen = 'seed:used:EVT-2026-02:TA-8800-0002'
ON CONFLICT (evento_id, tipo, id_origen) DO NOTHING;

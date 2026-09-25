-- Local fixture only: no buyer identity, credentials, or real signed P2 package.
-- Run after migrate(pool), in one psql transaction (seed.ps1 uses --single-transaction).
-- Re-running refreshes only the demo event's open window; confirmed consumptions
-- and audit/outbox rows are never reset.
INSERT INTO evento (
  evento_id, cliente_id, boleteria_id, recinto_id, estado,
  apertura_en, cierre_en, version_permisos, version_politicas,
  reingreso_permitido, permisos_recibidos_en
) VALUES (
  'EVT-2026-02', 'CLI-001', 'BOL-01', 'REC-01', 'abierto',
  now() - interval '1 hour', now() + interval '6 hours', 1, 1,
  false, now() - interval '1 minute'
)
ON CONFLICT (evento_id) DO UPDATE SET
  apertura_en = EXCLUDED.apertura_en,
  cierre_en = EXCLUDED.cierre_en,
  permisos_recibidos_en = EXCLUDED.permisos_recibidos_en;

WITH asignacion AS (
  SELECT n,
    CASE WHEN n <= 5 THEN 'Z-NORTE'
         WHEN n <= 9 THEN 'Z-SUR'
         WHEN n <= 14 THEN 'Z-ORIENTAL'
         WHEN n <= 18 THEN 'Z-OCCIDENTAL'
         ELSE 'Z-PALCOS' END AS zona
  FROM generate_series(1, 20) AS n
)
INSERT INTO punto (evento_id, punto_id, zonas, habilitado)
SELECT 'EVT-2026-02', 'P-' || lpad(n::text, 2, '0'),
  CASE WHEN n IN (1, 7) THEN ARRAY[zona, 'Z-PALCOS'] ELSE ARRAY[zona] END,
  true
FROM asignacion
ON CONFLICT (evento_id, punto_id) DO NOTHING;

INSERT INTO lector (evento_id, lector_id, punto_id, habilitado, revocado)
SELECT 'EVT-2026-02', 'LX-2210-' || lpad((100 + 7 * n)::text, 4, '0'),
  'P-' || lpad(n::text, 2, '0'), true, false
FROM generate_series(1, 20) AS n
ON CONFLICT (evento_id, lector_id) DO NOTHING;

-- Five zone distributions: 4,980 + 3,360 + 4,010 + 3,360 + 530 = 16,240.
-- Samples at P-01: TA-8800-0000 valid, TA-8804-0980 other zone,
-- TA-8800-0001 annulled; any absent code is unknown. Reusing a valid
-- reference exercises "already consumed"; racing it at P-01/P-07 exercises
-- the global unique-consumption constraint.
WITH grupos(zona, inicio, cantidad) AS (
  VALUES ('Z-NORTE', 0, 4980),
         ('Z-SUR', 4980, 3360),
         ('Z-ORIENTAL', 8340, 4010),
         ('Z-OCCIDENTAL', 12350, 3360),
         ('Z-PALCOS', 15710, 530)
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
ON CONFLICT (evento_id, referencia) DO NOTHING;

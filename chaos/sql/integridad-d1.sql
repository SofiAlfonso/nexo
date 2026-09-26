-- Integridad de D1 (C2) para F1–F4. Solo lectura.
-- Variables psql: evento, desde, hasta (ventana de la perturbación) y restaurado
-- (instante de la reversión). Ejemplo:
--   psql -At -v evento=EVT-2026-02 -v desde=2026-09-26T04:00:00Z \
--        -v hasta=2026-09-26T04:05:00Z -v restaurado=2026-09-26T04:05:00Z -f integridad-d1.sql
SELECT json_build_object(
  'intentos', (SELECT count(*) FROM intento WHERE evento_id = :'evento'),
  'decisiones', (
    SELECT coalesce(json_object_agg(d, n), '{}'::json) FROM (
      SELECT coalesce(decision, 'sin-decision') AS d, count(*) AS n
      FROM intento WHERE evento_id = :'evento' GROUP BY 1
    ) x
  ),
  'consumos', (SELECT count(*) FROM consumo WHERE evento_id = :'evento'),
  -- N3: boletas con más de un consumo (UNIQUE consumo_unico debe dejarlo en 0).
  'boletasConMasDeUnConsumo', (
    SELECT count(*) FROM (
      SELECT 1 FROM consumo WHERE evento_id = :'evento'
      GROUP BY cliente_id, boleteria_id, referencia, proposito HAVING count(*) > 1
    ) x
  ),
  'consumosSinDecisionAceptada', (
    SELECT count(*) FROM consumo c JOIN intento i ON i.id_origen = c.id_origen
    WHERE c.evento_id = :'evento' AND i.decision IS DISTINCT FROM 'aceptado'
  ),
  'aceptadosSinConsumo', (
    SELECT count(*) FROM intento i
    WHERE i.evento_id = :'evento' AND i.decision = 'aceptado'
      AND NOT EXISTS (SELECT 1 FROM consumo c WHERE c.id_origen = i.id_origen)
  ),
  -- Evidencia perdida en origen: decisiones definitivas sin fila de outbox (invariante 7).
  'decisionesSinOutbox', (
    SELECT count(*) FROM intento i
    WHERE i.evento_id = :'evento' AND i.decision IN ('aceptado', 'rechazado')
      AND NOT EXISTS (
        SELECT 1 FROM outbox o WHERE o.evento_id = i.evento_id AND o.tipo = 'decision' AND o.id_origen = i.id_origen
      )
  ),
  'outbox', (
    SELECT json_build_object(
      'total', count(*),
      'acusadas', count(e.outbox_id),
      'pendientes', count(*) - count(e.outbox_id),
      'pendienteMasAntiguo', min(o.creado_en) FILTER (WHERE e.outbox_id IS NULL)
    )
    FROM outbox o LEFT JOIN outbox_envio e ON e.outbox_id = o.id
    WHERE o.evento_id = :'evento' AND o.tipo = 'decision'
  ),
  -- T2: filas pendientes al restaurar y proporción acusada en 5 minutos (KR2.1 ≥ 99,5 %).
  'drenado', (
    SELECT json_build_object(
      'pendientesAlRestaurar', count(*),
      'acusadasEn5Min', count(*) FILTER (WHERE e.acusado_en <= :'restaurado'::timestamptz + interval '5 minutes'),
      'sinAcusar', count(*) FILTER (WHERE e.acusado_en IS NULL),
      'ultimoAcuse', max(e.acusado_en),
      'maxAntiguedadS', extract(epoch FROM (:'restaurado'::timestamptz - min(o.creado_en)))
    )
    FROM outbox o LEFT JOIN outbox_envio e ON e.outbox_id = o.id
    WHERE o.evento_id = :'evento' AND o.tipo = 'decision'
      AND o.creado_en < :'restaurado'::timestamptz
      AND (e.acusado_en IS NULL OR e.acusado_en >= :'restaurado'::timestamptz)
  ),
  -- Decisiones tomadas durante la perturbación (F3: cero aceptaciones sin D1).
  'ventana', (
    SELECT coalesce(json_object_agg(d, n), '{}'::json) FROM (
      SELECT decision AS d, count(*) AS n FROM intento
      WHERE evento_id = :'evento' AND decidido_en >= :'desde'::timestamptz AND decidido_en < :'hasta'::timestamptz
      GROUP BY 1
    ) x
  ),
  'consumosEnVentana', (
    SELECT count(*) FROM consumo
    WHERE evento_id = :'evento' AND consumido_en >= :'desde'::timestamptz AND consumido_en < :'hasta'::timestamptz
  )
);
-- Identificadores de decisiones en el outbox con su estado de acuse (para cruzar con D2).
SELECT o.id_origen || E'\t' || CASE WHEN e.outbox_id IS NULL THEN 'pendiente' ELSE 'acusada' END
FROM outbox o LEFT JOIN outbox_envio e ON e.outbox_id = o.id
WHERE o.evento_id = :'evento' AND o.tipo = 'decision';

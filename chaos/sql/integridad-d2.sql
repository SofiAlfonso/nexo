-- Integridad de D2 (C4, M2) para F1–F4. Solo lectura. Variable psql: evento.
SELECT json_build_object(
  'decisiones', (SELECT count(*) FROM m2_evidencia.decisiones WHERE evento_id = :'evento'),
  'admisiones', (SELECT count(*) FROM m2_evidencia.decisiones WHERE evento_id = :'evento' AND admision),
  -- N3: una boleta con más de una admisión en la evidencia central.
  'boletasConMasDeUnaAdmision', (
    SELECT count(*) FROM (
      SELECT 1 FROM m2_evidencia.decisiones WHERE evento_id = :'evento' AND admision
      GROUP BY referencia HAVING count(*) > 1
    ) x
  ),
  'evidenciasPorTipo', (
    SELECT coalesce(json_object_agg(tipo, n), '{}'::json) FROM (
      SELECT tipo, count(*) AS n FROM m2_evidencia.evidencias WHERE evento_id = :'evento' GROUP BY 1
    ) x
  ),
  'ultimaRecepcion', (SELECT max(recibido_en) FROM m2_evidencia.evidencias WHERE evento_id = :'evento')
);
SELECT id_origen FROM m2_evidencia.decisiones WHERE evento_id = :'evento';

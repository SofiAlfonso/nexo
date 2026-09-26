# Guion del video demo (5–8 min)

Guion de referencia para grabar la demostración del taller 3, en el orden de
la rúbrica: aplicación, observabilidad, un fallo (F1–F4) y su recuperación,
cierre. Cada paso cita el comando o la vista real del repositorio; no se
incluye ninguna funcionalidad que no esté implementada (ver
[`docs/coherencia/matriz.md`](../coherencia/matriz.md) para el estado exacto
de cada ADR y [`README.md`](../../README.md) para los comandos completos).

Antes de grabar: dejar Minikube arrancado, el stack desplegado
(`node deploy/scripts/up.mjs`) y sembrado, y un port-forward de Grafana listo
(`kubectl -n nexo-observability port-forward svc/nexo-otel-lgtm 3000:3000`).
Quien grabe debe confirmar que los cinco usuarios de laboratorio
(`supervisor`, `lider-tecnico`, `logistica`, `cierre`, `finanzas`, ADR-016)
ya tienen contraseña sembrada.

## 1. Apertura (30 s)

- Título: NEXO — control de acceso B2B para estadios (ST1625, taller 3).
- Una frase de propósito: coordinar la validación de boletas en las puertas
  de un recinto con una única autoridad local (C2), sincronización
  recuperable hacia un núcleo central (C4) y observabilidad de extremo a
  extremo.
- Mostrar brevemente el árbol del repositorio (sección "Árbol general" del
  README) para ubicar C1–C5 y D1–D2.

## 2. Login y panel con datos reales (60–90 s)

- Abrir `src/central-core/web/` servido por C4 (URL local del panel).
- Iniciar sesión con uno de los cinco usuarios sembrados (ADR-016); mostrar
  que el selector de rol del prototipo original ya no existe: el rol viene
  del usuario autenticado.
- Recorrer 2–3 vistas con datos reales de D2 (resumen, puertas, incidentes),
  señalando que ninguna usa el simulador original del prototipo (T30/T32,
  evidencia comparativa en `docs/evidence/ui/`).

## 3. Puertas en vivo (60–90 s)

- Arrancar el lector emulado (`npm run dev:reader` en local, o el Job
  `nexo-reader-load` / `deploy/scripts/load` en Minikube) con el perfil
  `nominal` contra C2.
- Mostrar en `#/puertas` cómo llegan validaciones en vivo; señalar que la
  decisión ya fue tomada por C2 (D1) antes de llegar al panel.

## 4. Validación manual y trazabilidad (45–60 s)

- Desde `#/lector`, ejecutar una validación manual contra C2 con credencial
  de lector web (T31).
- Mostrar la misma validación reflejada en el panel (`#/puertas`) y, si
  Grafana está disponible, la traza o el evento correspondiente.

## 5. Observabilidad (60–90 s)

- En Grafana (`http://localhost:3000`, tras el port-forward), abrir el
  dashboard de "operación del evento" (`observability/dashboards/`) y
  señalar en vivo al menos dos de las seis métricas obligatorias: N1
  (admisiones/ingreso), T1 (latencia de validación) y T2 (pendientes de
  sincronización), citando `docs/observability/justificacion-metricas.md`.
- Mencionar brevemente que N3/A1 usa como proxy
  `nexo_c4_lotes_evidencia_total{resultado="conflicto",tipo="decision"}` (recorte b de la
  matriz de coherencia), sin necesidad de profundizar en cámara.

## 6. Un fallo (F1–F4) y su recuperación (90–120 s)

Elegir **un solo** experimento según cuál esté disponible y evidenciado al
momento de grabar (ver estado real en `docs/context/taller3.md` §5, Fase 5,
y `docs/fault-experiments/`; T51–T57 seguían `pendiente` al cierre de esta
sesión). Guion genérico, válido para cualquiera de los cuatro:

1. Mostrar el archivo `chaos/experiments/<experimento>/experiment.yaml`.
2. Ejecutar `node chaos/scripts/nexo-chaos.ts validate …` y luego `plan …`.
3. Ejecutar `node chaos/scripts/nexo-chaos.ts run … --confirm` y narrar la
   hipótesis (por ejemplo, para F1 RED-01: "el corte del enlace
   recinto–central no debe impedir que C2 siga aceptando y rechazando
   localmente").
4. Mostrar en Grafana o en el panel el efecto esperado (degradación
   temporal, crecimiento de pendientes, alerta disparada) según la métrica
   que ese fallo mueve (tabla 3.1 de `docs/context/gaps.md`).
5. Ejecutar `node chaos/scripts/nexo-chaos.ts restore` y mostrar la
   recuperación: drenaje del outbox, alerta que se apaga, o validaciones que
   vuelven a su latencia normal.

Si al momento de grabar F1–F4 aún no tienen evidencia formal ejecutada en
Minikube, usar en su lugar la evidencia de carga ya documentada en
`docs/evidence/load/f1-c2-degradacion-2026-09-25.md` (C2 con C4 inaccesible,
sin dobles consumos, outbox drenando) y decirlo explícitamente en el video:
es una prueba de integración equivalente, no una ejecución de
`nexo-chaos` en el clúster.

## 7. Cierre (30–45 s)

- Desde `#/cierre`, mostrar el cierre preliminar y, si los datos del evento
  lo permiten, la liquidación (T31).
- Resumen final: qué invariantes quedaron demostrados (autoridad única de
  C2, consumo atómico, bitácora de solo adición) y qué queda pendiente de
  PoC según la matriz de coherencia (por ejemplo, mTLS bloqueante ADR-008,
  aislamiento multicliente ADR-009 recortado).
- Cierre con el repositorio (`github.com/SofiAlfonso/nexo`) y agradecimiento.

## Notas de grabación

- Ninguna pantalla debe mostrar datos de boleto/QR completos, datos
  personales ni secretos (ADR-006, advertencia de seguridad del README).
- Si algo falla en vivo durante la grabación, preferir cortar y repetir esa
  sección antes que narrar una funcionalidad que no ocurrió en pantalla.
- Duración objetivo total: 5 a 8 minutos; los tiempos de cada sección son
  orientativos y se ajustan al recortar.

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

## 4. Historial del lector y trazabilidad (45–60 s)

- Abrir `#/lector` y mostrar los intentos ya registrados de un punto, que
  vienen de D2. La vista **no** valida boletas: el flujo "Prueba un caso"
  simulaba una V1 contra un endpoint inexistente y se retiró como recorte
  (PR #33; recorte i de la
  [matriz §3](../coherencia/matriz.md)). Decirlo en cámara: la única
  autoridad de validación es C2 y el panel no la reemplaza.
- Si Grafana está disponible, mostrar la traza lector → C2 → D1 de uno de
  esos intentos (Tempo). No hay Span Link C2→C4 (recorte a).

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

Los cuatro experimentos se ejecutaron en Minikube el 26-09-2026, con
evidencia versionada ([`docs/fault-experiments/`](../fault-experiments/README.md),
[`chaos/evidence/`](../../chaos/evidence/README.md)). Se recomienda **F1
RED-01**, el más demostrativo de la autoridad local y del outbox. Hay dos
formas de mostrarlo.

**A. En vivo** (si el clúster está libre; un solo experimento a la vez):

1. Mostrar `chaos/experiments/red-01-central-connection/experiment.yaml`.
2. Ejecutar `node chaos/scripts/nexo-chaos.ts validate …` y luego `plan …`.
3. Arrancar la carga (`node deploy/scripts/load.mjs`) y ejecutar
   `node chaos/scripts/nexo-chaos.ts run … --confirm`. Narrar la hipótesis:
   sin C4, C2 sigue aceptando y rechazando en D1 y acumula el outbox E1.
4. En el tablero de sincronización y resiliencia, mostrar cómo crecen los
   pendientes de T2 mientras N2 y T1 no cambian.
5. Al restaurar (el temporizador o `nexo-chaos.ts restore`), mostrar el
   drenaje del outbox.

**B. Con la evidencia versionada** (si no se puede ejecutar en vivo). Decir
explícitamente que son capturas de la corrida del 26-09-2026:

1. Mostrar [f1-red-01.md](../fault-experiments/f1-red-01.md) (hipótesis y
   resultado: **aprobada**).
2. Mostrar los paneles del corte de 300 s:
   [t2-pendientes.png](../../chaos/evidence/red-01-central-connection/capturas/t2-pendientes.png)
   (hasta 1246 pendientes durante el corte),
   [n2-disponibilidad.png](../../chaos/evidence/red-01-central-connection/capturas/n2-disponibilidad.png)
   (100 %) y
   [t1-p95.png](../../chaos/evidence/red-01-central-connection/capturas/t1-p95.png)
   (p95 de C2 ≈ 24 ms).
3. Mostrar el cierre en
   [integridad.json](../../chaos/evidence/red-01-central-connection/integridad.json):
   1410 pendientes al restaurar, los 1410 con acuse en 15 s, 0 pérdidas y
   0 duplicados.

Mencionar en una frase los otros tres resultados, sin forzarlos:

- **F2 SER-06**, aprobada con degradación prevista: con `otel-lgtm` caído
  15 min, la validación siguió, la cola llegó a 185/10000 y drenó, pero no
  hubo alerta porque Grafana vive dentro de `otel-lgtm`.
- **F3 BD-01**, aprobada con degradación prevista: sin D1 no hubo
  aceptaciones, pero la caída solo se ve en el lector
  ([lector-por-fase.txt](../../chaos/evidence/bd-01-local-persistence/lector-por-fase.txt)).
- **F4 REC-01**, no concluyente: A6 no se disparó con el límite de 100m.

No mostrar una alerta de fallo disparada: ninguna se disparó durante F1–F4
([informe §2.3](../informe/taller3.md)).

## 7. Cierre (30–45 s)

- Desde `#/cierre`, mostrar el cierre preliminar y, si los datos del evento
  lo permiten, la liquidación. `#/cierre` también resuelve eventos `cerrado`
  (PR #32).
- Resumen final: qué invariantes quedaron demostrados (autoridad única de
  C2, consumo atómico, bitácora de solo adición y outbox), con 0 duplicados
  y 0 pérdidas en F1–F4. Luego, qué queda pendiente de PoC según la matriz
  de coherencia: el corte de 15 min de ADR-002 y ADR-011, el mTLS
  bloqueante de ADR-008 y el aislamiento multicliente recortado de
  ADR-009. Cerrar con las brechas de observabilidad de §8.3 del informe:
  el *dead-man's switch* externo, el readiness de C2 dependiente de D1 y
  una variante fuerte de F4.
- Cierre con el repositorio (`github.com/SofiAlfonso/nexo`) y agradecimiento.

## Notas de grabación

- Ninguna pantalla debe mostrar datos de boleto/QR completos, datos
  personales ni secretos (ADR-006, advertencia de seguridad del README).
- Si algo falla en vivo durante la grabación, preferir cortar y repetir esa
  sección antes que narrar una funcionalidad que no ocurrió en pantalla.
- Duración objetivo total: 5 a 8 minutos; los tiempos de cada sección son
  orientativos y se ajustan al recortar.

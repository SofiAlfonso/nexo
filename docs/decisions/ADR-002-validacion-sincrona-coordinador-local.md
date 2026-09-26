# ADR-002: Validación síncrona mediante coordinador local compartido, sin depender de la nube por escaneo

- **Estado**: Pendiente de PoC
- **Fecha**: 14 de septiembre de 2026 (registro del taller 2); actualizado 25 de septiembre de 2026
- **Origen**: taller 2, entregable 02 (docs/context/taller2.md §3)

## Contexto
Cada lector debe obtener una decisión de la misma autoridad lógica del evento, también durante un corte de internet. Un lector aislado no autoriza; una solicitud sin respuesta puede haber sido confirmada en D1. Encolar la solicitud o recibir un acuse de sincronización no demuestra que el ingreso haya sido aceptado.

## Decisión
Un coordinador local compartido por evento decide síncronamente; la nube solo sincroniza y observa después. C1 persiste `idOrigen` antes de enviar V1, repite el mismo intento y contenido para recuperar el resultado, y no habilita el paso sin respuesta utilizable. C2 responde aceptación solo tras el commit durable en D1.

## Alternativas consideradas
- Nube por escaneo: introduce dependencia del enlace central en cada decisión.
- Cola en memoria: encolar no equivale a aceptar ni garantiza recuperación durable.
- «Exactly once» del transporte: no sustituye identidad persistente e idempotencia.
- Intermediario durable como solución completa: el transporte no decide ni impide por sí solo otro uso.

## Consecuencias
- La operación elegible puede continuar en modo local sin internet, con una autoridad válida.
- Se requieren identidad persistente, idempotencia y sincronización posterior que no conceda otro ingreso.
- Sin respuesta, C1 registra incertidumbre y no habilita el paso.

## Criterio para aceptar
En pruebas por evento y modo conectado/local, medir al menos 95 % de solicitudes con respuesta en ≤300 ms (SLO de T2 §8.2, ventanas de un minuto) y reportar además el p95 frente a 500 ms (CA2). Incluir tardías, errores y sin respuesta en el denominador; comprobar continuidad durante un corte central de 15 min (CA1), sin doble aceptación ni pérdida.

## Aplicación en el taller 3
- `src/reader-client/` (C1) conserva el diario e intenta V1; `src/local-coordinator/` (C2+D1) decide sin esperar a C4.
- D7 mide tanto el SLO de 300 ms como el p95 frente a 500 ms; las tardías y sin respuesta permanecen en el denominador.
- RED-01 corta el enlace recinto-central y verifica que la validación local continúa; la PoC aporta evidencia, no cambia aún el estado del ADR.
- 26-09-2026: PoC ejecutada en Minikube con F1 RED-01, **aprobada**: C4 cortado 300 s, N2 100 %, p95 de C2 ≈ 24 ms, 0 duplicados ([f1-red-01.md](../fault-experiments/f1-red-01.md)). El estado no cambia, porque el criterio exige un corte de 15 min y F1 cortó 5 min ([matriz §3](../coherencia/matriz.md), recorte k).

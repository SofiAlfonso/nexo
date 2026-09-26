# ADR-011: Separación entre validación síncrona y sincronización recuperable

- **Estado**: Pendiente de PoC
- **Fecha**: 14 de septiembre de 2026 (registro del taller 2); actualizado 25 de septiembre de 2026
- **Origen**: taller 2, entregable 02 (docs/context/taller2.md §3)

## Contexto

C2 debe decidir localmente cada escaneo aunque se interrumpa el enlace con C4.
La evidencia central se transfiere después y una entrega repetida no debe crear otra admisión.
Encolar una solicitud no equivale a aceptarla; una aceptación exige persistencia de la decisión local.

## Decisión

La validación es síncrona y decisiva en C2; la sincronización E1 se realiza al menos una vez con deduplicación en destino.
En D1, consumo, decisión, idempotencia y fila de outbox se confirman en una misma transacción antes de responder.
El emisor usa lotes acotados, reintentos y prioridad inferior a V1; los diarios locales permiten recuperar evidencia sin nueva autorización.

## Alternativas consideradas

- Colas solo en memoria: pierden pendientes ante reinicios.
- Garantía «exactly once» del transporte: no reemplaza la idempotencia del receptor.
- Kafka como requisito: añade operación sin resolver por sí solo la atomicidad local.
- Omitir deduplicación: los reintentos generarían evidencia duplicada.

## Consecuencias

Hay que retener y medir el outbox hasta recibir confirmación segura; un acuse aislado no justifica borrar copias locales.
La caída de la conexión central aumenta pendientes, pero no concede usos nuevos ni interrumpe casos elegibles.
Se debe conservar el `idOrigen` de cada intento a través de reintentos y lotes.

## Criterio para aceptar

Tras un corte de 15 minutos, acreditar que al menos 99,5 % de pendientes se drena en cinco minutos sin pérdida ni duplicados; conectado, al menos 95 % de las validaciones debe ser visible en cinco segundos.
Al repetir un `idOrigen` o lote, C4 debe conservar una sola evidencia y C2 la decisión original.

## Aplicación en el taller 3

- Implementar outbox transaccional en D1 y E1 `POST /v1/lotes-evidencia` con máximo 100 registros, idempotente por `idOrigen` y lote.
- Medir T2 (cantidad, edad y drenaje de pendientes) y ejecutar F1 RED-01 desde `chaos/experiments/`.
- 26-09-2026: PoC ejecutada con F1 RED-01, **aprobada**: 1410/1410 pendientes drenados en 15 s, sin pérdidas ni duplicados ([f1-red-01.md](../fault-experiments/f1-red-01.md)). El estado no cambia, porque el criterio exige un corte de 15 min y F1 cortó 5 min.

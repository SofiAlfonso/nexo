# ADR-004: Bitácora de solo adición e idempotente como fuente de conciliación y admisiones facturables

- **Estado**: Aceptado
- **Fecha**: 14 de septiembre de 2026 (registro del taller 2)
- **Origen**: taller 2, entregable 02 (docs/context/taller2.md §3)

## Contexto
La decisión de puerta se toma con las versiones de permisos y políticas conocidas en ese momento. La conciliación reúne decisiones únicas y resuelve diferencias sin reescribir qué se decidió. Los logs técnicos no sustituyen evidencia de negocio para auditoría, cierre y facturación.

## Decisión
Mantener una bitácora idempotente de solo adición como fuente de conciliación y admisiones facturables. Confirmar la decisión, evidencia y salida de auditoría con la transacción local; consolidar en M2 sin volver a autorizar. Registrar correcciones y resoluciones mediante nuevas entradas, nunca con `UPDATE` ni `DELETE` de entradas previas.

## Alternativas consideradas
- Actualizar o borrar: destruye la evidencia original y la historia de resoluciones.
- Solo estado derivado: no permite reconstruir por qué se decidió y facturó.
- Logs operativos: son telemetría técnica, no evidencia de negocio.
- Sobrescribir: oculta decisiones o diferencias anteriores.

## Consecuencias
- La evidencia debe conservarse 90 días y su recuperación debe poder verificarse.
- Las resoluciones se añaden y las proyecciones se derivan; no se exige event sourcing de todo el estado.
- El envío recuperable y la recepción idempotente requieren controlar duplicados sin borrar historia.

## Criterio para aceptar
Comprobar que `UPDATE` y `DELETE` de la bitácora fallan y que repetir un lote no duplica una decisión; reconstruir admisiones y un cierre desde evidencia conservada 90 días. Verificar cobertura y resolución documentada de pendientes antes del cierre definitivo (RN-08).

## Aplicación en el taller 3
- `src/local-coordinator/` registra decisión y salida de auditoría junto al consumo en D1; la migración impide `UPDATE`/`DELETE` de la bitácora.
- `src/central-core/modules/evidence-ingestion/` (M2) deduplica los lotes recibidos; `src/central-core/modules/reconciliation/` (M3) deriva admisiones y añade resoluciones.
- Las pruebas de integración verifican la prohibición de modificar entradas y la recepción idempotente.

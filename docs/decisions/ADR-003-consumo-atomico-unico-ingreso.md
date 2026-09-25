# ADR-003: Consumo atómico y global del único ingreso de cada boleta

- **Estado**: Aceptado (PoC bloqueante en NEXO_04)
- **Fecha**: 14 de septiembre de 2026 (registro del taller 2)
- **Origen**: taller 2, entregable 02 (docs/context/taller2.md §3)

## Contexto
Dos puertas pueden presentar copias de la misma boleta al mismo tiempo. RN-04 admite una sola primera aceptación por boleta y evento, y una retransmisión del mismo intento no es una nueva presentación. La sincronización central ocurre después y no puede ser la fuente de autoridad para decidir el consumo.

## Decisión
Confirmar atómicamente un único consumo global por boleta: la primera confirmación gana y las demás presentaciones se rechazan. La clave de consumo comprende cliente, evento, boletería, referencia externa y propósito `PRIMER_INGRESO`, sin zona, punto ni lector. En T1, consumo, decisión, identidad idempotente del intento y salida de auditoría se confirman en una transacción durable antes de responder.

## Alternativas consideradas
- Consumo por punto o turno: permitiría ganadores independientes en puertas distintas.
- Aceptar duplicados: contradice la admisión única.
- Contadores no atómicos: no garantizan un ganador ante solicitudes concurrentes.

## Consecuencias
- Un consumo confirmado nunca se reinicializa, ni por cambios de permisos ni al sincronizar.
- Deduplicar intentos por `idOrigen` y asegurar unicidad del consumo son garantías distintas.
- Ante estado incierto, no se autoriza un nuevo ingreso.
- La exclusión de operaciones concurrentes se establece por boleta, no por evento completo.

## Criterio para aceptar
Demostrar exactamente una aceptación de presentaciones simultáneas sin fallas y, con fallas, a lo sumo una; cero boletas con doble consumo (Q2, CA3). Tras una caída y reintento, la misma identidad de intento recupera su resultado sin repetir el consumo.

## Aplicación en el taller 3
- D1 en `src/local-coordinator/` impone `UNIQUE` sobre la clave de consumo de la boleta; C2 usa una transacción por intento.
- `tests/resilience/` ejecuta EXP 03 (reintento tras caída) y EXP 04 (500 boletas con dos solicitudes simultáneas).
- `src/shared/domain/` define las reglas de elegibilidad, pero solo el commit local confirma el ingreso.

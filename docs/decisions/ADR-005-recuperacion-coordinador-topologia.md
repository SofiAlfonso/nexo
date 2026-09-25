# ADR-005: Recuperación segura del coordinador y selección de topología mediante PoC y piloto

- **Estado**: Pendiente de PoC
- **Fecha**: 14 de septiembre de 2026 (registro del taller 2); actualizado 25 de septiembre de 2026
- **Origen**: taller 2, entregable 02 (docs/context/taller2.md §3)

## Contexto
Después de fallar C2 o D1, una copia incompleta podría volver a aceptar una boleta ya consumida. La réplica no sustituye el respaldo, y el nodo único no protege frente a destrucción total del disco. La continuidad se subordina a conservar los consumos confirmados y excluir una autoridad anterior antes de reabrir.

## Decisión
No fijar aún la topología definitiva: comparar nodo durable único, primario con réplica síncrona y promoción manual segura, y plataforma de tres nodos con mayoría. No autorizar con estado incierto; reabrir solo con consumos completos y autoridad anterior excluida. Seleccionar la topología al cerrar el tercer piloto.

## Alternativas consideradas
- Promover una copia atrasada: puede perder consumos confirmados y admitirlos de nuevo.
- Activo-activo multirregión: no resuelve por sí solo la autoridad única requerida.
- Reabrir con estado incierto: arriesga doble aceptación.

## Consecuencias
- Objetivo de cero consumos confirmados perdidos en las fallas habilitadas; el nodo único conserva el riesgo de destrucción total del disco.
- Una caída de C2 o D1 detiene nuevas aceptaciones hasta recuperar una autoridad con estado cierto.
- La topología final queda condicionada por PoC y piloto, no por el diagrama ni por la configuración candidata.
- Ni la nube ni una copia atrasada se promueven como autoridad por un timeout.

## Criterio para aceptar
Probar recuperación y restauración: presentar nuevamente boletas consumidas y exigir rechazo; demostrar cero consumos confirmados perdidos y exclusión de la autoridad anterior (Q4, CA3). Comparar las tres candidatas y seleccionar una al cierre del tercer piloto.

## Aplicación en el taller 3
- La PoC usa solo `nodo-unico`: PostgreSQL 16 para D1 en su propio StatefulSet en `nexo-venue`, junto a `src/local-coordinator/` como C2.
- BD-01 prueba que D1 indisponible detiene aceptaciones nuevas y que al volver no se duplican consumos.
- RED-06, BD-06, EXP 07 y las otras dos topologías candidatas quedan fuera de esta PoC; la elección final sigue pendiente del piloto.

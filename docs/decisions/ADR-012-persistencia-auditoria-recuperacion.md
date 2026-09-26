# ADR-012: Persistencia de auditoría y recuperación ante fallas

- **Estado**: Pendiente de PoC (actualizado)
- **Fecha**: 14 de septiembre de 2026 (registro del taller 2); actualizado 25 de septiembre de 2026
- **Origen**: taller 2, entregable 02 (docs/context/taller2.md §3)

## Contexto

Una aceptación no puede perder su consumo confirmado ni su evidencia al fallar la base o el coordinador.
El taller 2 distinguió D1 autoritativo, D2 para seguimiento y un archivo verificable de 90 días en D3 o D2.
La alternativa de objetos en D3 añade un componente que no necesita la PoC de 12 horas.

## Decisión

Persistir consumo, decisión, idempotencia y salida de auditoría en D1 antes de responder; D2 conserva la réplica central de evidencia para seguimiento y cierre.
Para el taller 3, D1 será una instancia separada de PostgreSQL 16 en el recinto y se adopta la alternativa de retener los 90 días en PostgreSQL D2, sin MinIO ni D3 separado (G02, G13).
La auditoría no se reconstruye a partir de logs técnicos ni de la telemetría.

## Alternativas consideradas

- Solo objetos: no reemplazan el estado transaccional necesario para decidir.
- Copias de siete días o logs de 30 días como auditoría: no cubren los 90 días exigidos.
- Confiar solo en el standby: una réplica no sustituye un respaldo independiente.
- Activo-activo multirregión: excede el alcance y complica la autoridad única.
- Archivo D3 en MinIO: opción original recortada para la PoC; debe reevaluarse al dimensionar un piloto.

## Consecuencias

D2 asumirá retención y consulta del archivo de negocio durante 90 días; D1 mantendrá su autoridad hasta cierre verificado.
La recuperación debe preservar consumos confirmados (RPO cero para las fallas habilitadas), y un nodo único no cubre la destrucción total del disco.
Siguen pendientes las pruebas de respaldo, restauración y reconstrucción de un cierre.

## Criterio para aceptar

Restaurar D1, presentar otra vez boletas ya consumidas y exigir rechazo; verificar conservación de decisiones e idempotencia tras el fallo.
Leer evidencia retenida en D2 por lote y reconstruir un cierre, con respaldo independiente comprobado.

## Aplicación en el taller 3

- Desplegar D1 PostgreSQL 16 separado de C2 en `nexo-venue` y D2 en `nexo-central`.
- Ejecutar F3 BD-01: al quedar D1 indisponible, ninguna nueva aceptación; tras recuperarlo, los consumos anteriores siguen rechazando duplicados.
- 26-09-2026: F3 BD-01 ejecutado, **aprobada con degradación prevista**: ninguna aceptación sin D1 y 0 boletas con más de un consumo tras recuperarlo ([f3-bd-01.md](../fault-experiments/f3-bd-01.md)). El estado no cambia, porque falta la restauración desde un respaldo independiente.

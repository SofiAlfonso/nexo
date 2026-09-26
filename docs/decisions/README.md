# Decisiones de arquitectura (ADRs)

Registro de las decisiones de arquitectura de NEXO. ADR-001 a ADR-013 resumen el registro del taller 2 (entregable 02, [taller2.md §3](../context/taller2.md)) con su estado actual; ADR-014 en adelante son decisiones del taller 3. Aquí no va código, configuración ni resultados de pruebas: solo la decisión y su justificación.

## Índice

| ADR | Título | Estado |
|---|---|---|
| [001](ADR-001-estilo-capas-monolito-modular.md) | Estilo por capas con núcleo central como monolito modular | Aceptado |
| [002](ADR-002-validacion-sincrona-coordinador-local.md) | Validación síncrona mediante coordinador local compartido | Pendiente de PoC |
| [003](ADR-003-consumo-atomico-unico-ingreso.md) | Consumo atómico y global del único ingreso de cada boleta | Aceptado (PoC bloqueante en NEXO_04) |
| [004](ADR-004-bitacora-solo-adicion.md) | Bitácora de solo adición e idempotente | Aceptado |
| [005](ADR-005-recuperacion-coordinador-topologia.md) | Recuperación segura del coordinador y selección de topología | Pendiente de PoC |
| [006](ADR-006-datos-sin-identidad-portador.md) | Modelo de datos sin identidad del portador | Aceptado |
| [007](ADR-007-modelo-canonico-ingesta.md) | Modelo canónico de ingesta con adaptador delgado por boletería | Pendiente de PoC |
| [008](ADR-008-identidad-dispositivos.md) | Identidad y confianza de los dispositivos | Pendiente de PoC (bloqueante) |
| [009](ADR-009-aislamiento-cliente-evento.md) | Aislamiento lógico y autorización por cliente y evento | Pendiente de PoC (recortada en el taller 3) |
| [010](ADR-010-resolucion-credenciales-permisos.md) | Resolución de credenciales y actualización de permisos | Pendiente de PoC (bloqueante) |
| [011](ADR-011-validacion-sincrona-sincronizacion-recuperable.md) | Separación entre validación síncrona y sincronización recuperable | Pendiente de PoC |
| [012](ADR-012-persistencia-auditoria-recuperacion.md) | Persistencia de auditoría y recuperación ante fallas | Pendiente de PoC (actualizado) |
| [013](ADR-013-observabilidad-extremo-a-extremo.md) | Observabilidad de extremo a extremo separada de la auditoría | Pendiente de PoC (actualizado) |
| [014](ADR-014-runtime-typescript-node-24.md) | Runtime TypeScript sobre Node.js 24 LTS | Aceptado |
| [015](ADR-015-laboratorio-local-minikube.md) | Laboratorio local en Minikube en lugar de Docker Compose | Aceptado |
| [016](ADR-016-identidad-operadores-laboratorio.md) | Identidad de operadores de laboratorio | Aceptado |

## Convenciones

- Archivo: `ADR-0NN-<tema-kebab>.md`, numeración correlativa, sin reutilizar números.
- Estados: `Propuesto`, `Pendiente de PoC`, `Aceptado`, `Reemplazado por ADR-0NN`, `Descartado`. Un calificativo entre paréntesis explica matices (por ejemplo, "recortada en el taller 3").
- Un ADR aceptado no se reescribe: si la decisión cambia, se crea uno nuevo que lo reemplaza. Los ajustes de alcance o evidencia de la PoC se anotan con fecha en "Aplicación en el taller 3".
- Toda desviación entre lo desplegado y un ADR se anota con fecha en "Aplicación en el taller 3" del ADR afectado.

## Plantilla

```markdown
# ADR-0NN: <Título>

- **Estado**: <Propuesto | Pendiente de PoC | Aceptado | Reemplazado por ADR-0NN | Descartado>
- **Fecha**: <día de mes de año>
- **Origen**: <taller, entregable o decisión que lo motiva>

## Contexto
<Problema y fuerzas en juego.>

## Decisión
<Qué se decide.>

## Alternativas consideradas
- <Alternativa>: <por qué se descarta>.

## Consecuencias
- <Efectos positivos y negativos.>

## Criterio para aceptar
<Evidencia verificable que confirma la decisión.>

## Aplicación en el taller 3
- <Cómo se implementa o verifica en la PoC, con rutas del repositorio.>
```

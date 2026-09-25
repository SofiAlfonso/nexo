# Cliente de puerta / lector (C1)

**Responsabilidad**: C1, lector emulado y generador de carga; registra la
presentación, conserva un diario local de eventos, solicita una decisión al
coordinador local (C2) y comunica el resultado al operador o dispositivo
de puerta.

**Qué no debe implementarse aquí**: lógica de decisión de acceso. El
lector **no** decide el acceso de forma autónoma bajo ninguna
circunstancia, incluso ante pérdida de conectividad con C2.

**Componente relacionado**: C1 — Cliente de puerta o lector.

**Stack**: TypeScript y Node 24.

## Estructura interna

- `index.ts` — punto de entrada del componente.
- `application/` — ciclo de presentación, diario y coordinación del envío.
- `infrastructure/` — cliente V1/H1, diario durable e identidad estable
  `idOrigen`.
- `cli/` — ejecución del lector emulado y perfiles de carga.

El lector envía heartbeats cada 10 s. Los perfiles de carga viven en
`tests/load/`. Para arrancar N lectores y obtener el contador independiente,
consulte [CLI](cli/README.md) y [formato de boletas y perfiles](../../tests/load/README.md).

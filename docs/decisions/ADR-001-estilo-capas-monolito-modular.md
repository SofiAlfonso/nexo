# ADR-001: Estilo por capas con núcleo central como monolito modular

- **Estado**: Aceptado
- **Fecha**: 14 de septiembre de 2026 (registro del taller 2)
- **Origen**: taller 2, entregable 02 (docs/context/taller2.md §3)

## Contexto
NEXO separa la decisión de acceso local de la consolidación, conciliación y liquidación centrales. M1 configura eventos y permisos, M2 ingiere evidencia, M3 concilia y M4 gestiona contratación y liquidación. Compartir un núcleo no debe permitir que un módulo escriba los datos de otro ni que el dominio dependa de SQL o HTTP.

## Decisión
Organizar C4 en capas de canales, aplicación, dominio e infraestructura, con M1 a M4 dentro de un único núcleo central. C2 es una unidad desplegable separada que conserva la dirección de dependencias entre capas; C3 es un adaptador de M1 dentro de C4. La custodia de escritura permanece en cada módulo aunque compartan base de datos.

## Alternativas consideradas
- Microservicios: no se justifican servicios independientes sin una necesidad demostrada.
- Monolito no modular: no protege los límites ni la custodia de escritura.
- Arquitectura dirigida por eventos como estilo principal: la sincronización asíncrona no sustituye la decisión local.
- Cliente-servidor sin núcleo: no ofrece la organización de reglas y responsabilidades del dominio.

## Consecuencias
- C4 escala como conjunto; microservicios solo se considerarían ante necesidad demostrada.
- Nombrar módulos no impide su acoplamiento: deben verificarse las dependencias entre ellos.
- Los puertos y adaptadores separan el dominio de la persistencia y del transporte.

## Criterio para aceptar
Verificar que el dominio no importe SQL ni HTTP, que las escrituras respeten el dueño M1–M4 y que no haya dependencias indebidas entre módulos. C2 debe decidir localmente sin convertir a C4 en autoridad por escaneo.

## Aplicación en el taller 3
- G07 sitúa las capas en `src/central-core/modules/<modulo>/{domain,application,infrastructure,api}`; una regla ESLint impide importar `infrastructure` de otro módulo.
- `src/central-core/` contiene C4 y sus módulos M1–M4; sus carpetas globales quedan para composición y elementos compartidos.
- `src/local-coordinator/` aloja C2+D1 como unidad separada; `src/shared/domain/` contiene el dominio reutilizable sin dependencia de infraestructura.

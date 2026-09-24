# Simulación de fallos (chaos engineering)

**Responsabilidad**: alojar la estructura para experimentos de fallos
reproducibles y reversibles sobre NEXO: definiciones de experimentos,
scripts de ejecución y evidencia resultante.

**Qué no debe implementarse aquí**: la inyección de fallos en sí. Esta
versión solo reserva carpetas, plantillas vacías y README explicativos por
experimento.

**Componente relacionado**: principalmente C2 (coordinador local), D1
(persistencia transaccional local) y la conexión C2–C4, además del stack de
observabilidad (Collector/exportación).

**Decisiones pendientes**: formato final de las plantillas de experimento
(YAML), y calendario de habilitación de cada experimento.

## Herramientas previstas

- Toxiproxy para perturbaciones de red.
- Scripts de Kubernetes para detener o reiniciar componentes.
- Límites de recursos de Kubernetes y, si se aprueba posteriormente,
  stress-ng.
- Generador de carga o solicitudes.
- Scripts PowerShell para Windows.
- Archivos de configuración YAML por experimento.

## Subcarpetas

- `experiments/` — un directorio por experimento (ver READMEs individuales).
- `scripts/` — scripts compartidos de ejecución/soporte de experimentos.
- `evidence/` — evidencia generada por los experimentos.

## Suite inicial de experimentos reservados

1. `experiments/red-01-central-connection/` — RED-01: interrupción entre el
   coordinador local y el núcleo central.
2. `experiments/ser-06-observability-outage/` — SER-06: interrupción del
   Collector o de la exportación hacia Grafana Cloud.
3. `experiments/bd-01-local-persistence/` — BD-01: indisponibilidad de la
   persistencia transaccional local.
4. `experiments/rec-01-coordinator-cpu/` — REC-01: presión o limitación de
   CPU del coordinador local.

# REC-01 — Presión/limitación de CPU del coordinador local

**Responsabilidad**: reservar el espacio para el experimento REC-01, que
aplicará límites o presión de CPU sobre el coordinador local (C2) para
observar el impacto en la latencia de validación.

**Qué no debe implementarse aquí todavía**: la limitación de recursos en sí
ni scripts de ejecución. Solo la carpeta y este README.

**Componente relacionado**: C2 (coordinador local), evaluado contra el
objetivo de latencia (≥95 % de solicitudes de validación en ≤300 ms).

**Decisiones pendientes**: mecanismo de presión (límites de recursos de
Kubernetes vs. stress-ng, pendiente de aprobación), duración del
experimento y criterios de éxito/rollback.

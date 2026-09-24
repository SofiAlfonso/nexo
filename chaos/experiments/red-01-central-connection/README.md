# RED-01 — Interrupción coordinador local ↔ núcleo central

**Responsabilidad**: reservar el espacio para el experimento RED-01, que
interrumpirá la conectividad de red entre el coordinador local (C2) y el
núcleo central (C4) para observar el comportamiento del sistema.

**Qué no debe implementarse aquí todavía**: la perturbación de red en sí
(p. ej. configuración de Toxiproxy) ni scripts de ejecución. Solo la
carpeta y este README.

**Componente relacionado**: C2 (coordinador local) y C4 (núcleo central); a
través de esta prueba se valida que C2 sigue siendo la única autoridad de
validación aun sin conectividad hacia C4.

**Decisiones pendientes**: mecanismo exacto de interrupción (Toxiproxy vs.
reglas de red de Kubernetes), duración del experimento y criterios de
éxito/rollback.

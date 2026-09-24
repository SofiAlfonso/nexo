# BD-01 — Indisponibilidad de la persistencia transaccional local

**Responsabilidad**: reservar el espacio para el experimento BD-01, que
provocará la indisponibilidad de D1 (persistencia transaccional local del
coordinador) para observar el comportamiento de C2 ante esa falla.

**Qué no debe implementarse aquí todavía**: la interrupción en sí ni
scripts de ejecución. Solo la carpeta y este README.

**Componente relacionado**: D1 (persistencia transaccional local) y C2
(coordinador local), que depende de D1 para confirmar consumo, decisión,
idempotencia y outbox antes de aceptar.

**Decisiones pendientes**: mecanismo de indisponibilidad (detener el motor
de base de datos vs. bloquear el volumen), duración del experimento y
criterios de éxito/rollback.

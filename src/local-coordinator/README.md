# Coordinador local (C2)

**Responsabilidad**: unidad desplegable separada en el recinto. Es la
**única autoridad lógica de validación del evento**: evalúa reglas y
confirma durablemente consumo, decisión, idempotencia y outbox (ver D1)
antes de devolver una aceptación al cliente de puerta (C1).

**Qué no debe implementarse aquí**: reglas de negocio que dependan de
disponibilidad del núcleo central (C4) para decidir en el momento del
evento; la validación debe poder resolverse localmente. Tampoco debe
delegarse la autoridad de decisión a la nube/plataforma central.

**Componente relacionado**: C2 — Coordinador local, junto con D1
(persistencia transaccional local).

**Decisiones pendientes**: tecnología del coordinador, esquema de D1 y
protocolo de sincronización/outbox hacia C4.

# Núcleo central (C4)

**Responsabilidad**: monolito modular organizado internamente por capas
(`api/`, `application/`, `domain/`, `infraestructure/`) que aloja los
módulos de negocio M1–M4, el adaptador de boletería (C3, asociado a M1) y
sirve el panel de operación (C5).

**Qué no debe implementarse aquí**:
- Microservicios independientes por módulo (M1–M4 viven dentro del mismo
  monolito modular).
- Lógica de autorización de acceso en tiempo real del evento — esa
  autoridad es exclusiva de C2 (coordinador local).
- Reglas de autorización o liquidación dentro del panel de operación (C5).

**Componente relacionado**: C4 (núcleo central), C3 (adaptador de
boletería, dentro de M1) y C5 (panel de operación, servido desde aquí).

**Decisiones pendientes**: stack tecnológico del monolito, límites exactos
entre capas y contratos entre módulos M1–M4.

## Estructura interna

- `api/` — capa de presentación/API del núcleo central.
- `application/` — casos de uso y orquestación de aplicación.
- `domain/` — modelo de dominio y reglas de negocio.
- `infrastructure/` — integraciones técnicas (persistencia D2, mensajería,
  etc.).
- `modules/` — módulos de negocio M1–M4:
  - `configuration-permissions/` (M1): configuración y permisos, incluye el
    adaptador de boletería (C3).
  - `evidence-ingestion/` (M2): ingesta de intentos y evidencia.
  - `reconciliation/` (M3): conciliación.
  - `contracting-settlement/` (M4): contratación y liquidación.

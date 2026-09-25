# Núcleo central (C4)

**Responsabilidad**: monolito modular organizado internamente por capas
(`api/`, `application/`, `domain/`, `infrastructure/`) que aloja los
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

**Stack**: TypeScript, Node 24, Fastify, `pg`, `decimal.js`, `argon2`
(login de operadores por rol) y `zod`.

## Estructura interna

- Cada módulo tiene sus propias capas en
  `modules/<m>/{domain,application,infrastructure,api}/`:
  - `configuration-permissions/` (M1): configuración y permisos; incluye el
    adaptador de boletería (C3).
  - `evidence-ingestion/` (M2): ingesta de intentos y evidencia.
  - `reconciliation/` (M3): conciliación.
  - `contracting-settlement/` (M4): contratación y liquidación.
- Las carpetas globales son solo para elementos compartidos:
  - `api/` — servidor HTTP Fastify y raíz de composición.
  - `application/` — solo cableado, sin lógica de negocio.
  - `domain/` — kernel compartido (tipos de eventos y cliente).
  - `infrastructure/` — conexión a D2 (`infrastructure/db/`) y telemetría.
- `web/` — panel C5; prototipo portado y servido como archivos estáticos por C4.
- Una regla de ESLint impide que un módulo importe el `infrastructure/` de
  otro módulo.

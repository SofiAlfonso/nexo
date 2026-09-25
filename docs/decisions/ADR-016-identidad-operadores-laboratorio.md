# ADR-016: Identidad de operadores de laboratorio

- **Estado**: Aceptado
- **Fecha**: 25 de septiembre de 2026
- **Origen**: taller 3, decisión Q14 de la orquestación (docs/context/taller3.md D8)

## Contexto

El prototipo C5 permite elegir un rol en la barra superior, pero ese selector solo cambia autor, avatar y filtro, no autentica personas.
La decisión D8 de taller 3 proponía un token estático por rol como identidad de laboratorio.
Para atribuir acciones al operador en D2 se necesita identificar al usuario sin presentar la PoC como identidad empresarial completa.

## Decisión

El panel C5 exige inicio de sesión con usuario y contraseña, con un usuario sembrado en D2 por cada rol del prototipo: Supervisor del operador, Líder técnico, Logística de puerta, Responsable de cierre y Líder comercial y financiero.
Guardar hashes con argon2; proporcionar las contraseñas fuera de Git mediante variables de entorno o Secret.
Mantener sesión en cookie firmada y `httpOnly`; obtener el rol del usuario autenticado en lugar del selector del prototipo y registrar al usuario como autor en D2.
La capacidad `identidadOperadores` (identidad real, SSO, MFA y autorización por cliente y evento) sigue pendiente de PoC, no queda resuelta por este login local.

## Alternativas consideradas

- Token estático por rol (D8): permite suplantar indistintamente a quienes comparten rol y no atribuye acciones a usuarios.
- OIDC/Keycloak: aumenta el costo de despliegue e integración para la PoC de 12 horas.
- Sin autenticación: deja las acciones del panel sin autor verificable.

## Consecuencias

El sembrado y la sesión deben proteger credenciales y claves de firma fuera del repositorio; no se registran contraseñas en logs.
La autoría de laboratorio deja de depender de un selector manipulable, pero no demuestra autorización real de roles ni aislamiento multicliente de ADR-009.
La transición desde el prototipo debe preservar vistas y flujos sin conservar su selector de rol.

## Criterio para aceptar

Comprobar que cada uno de los cinco usuarios puede iniciar sesión, recibe únicamente su rol desde D2 y deja su identidad como autor de una acción.
Sin sesión o con contraseña inválida no se permiten acciones; una cookie alterada se rechaza y los secretos no aparecen en Git.

## Aplicación en el taller 3

- Sustituir el selector en `src/central-core/web/` por login y sesión; sembrar cinco usuarios con hash argon2 en D2.
- Inyectar contraseñas y clave de firma mediante variables/Secret y dejar `identidadOperadores` marcada como PoC pendiente.

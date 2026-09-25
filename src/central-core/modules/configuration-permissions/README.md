# M1: configuración y permisos

Implementa configuración, permisos y el adaptador C3 de boletería.
Contiene sus capas `domain/`, `application/`, `infrastructure/` y `api/`.
Un módulo no importa el `infrastructure/` de otro módulo; se comunica por su `application/` (consultas B1–B4).
Se completa en la ola 1.

P2: `registrarRutasPermisos(fastify, servicio)` registra `GET /v1/permisos`;
`crearServicioPermisos(pool?)` compone repositorios D2. La composición debe pasar
su pool compartido; sin él se crea uno con `createD2Pool()` que el invocador
debe cerrar. La instantánea lee `boletas` no anuladas ni excluidas hasta
`version_permisos` y las envía como altas; las consultas incrementales leen
`cambios_permisos` posteriores. El campo `vigenteHasta` vence cinco minutos
después de la emisión. La firma HMAC-SHA256 usa JSON de claves ordenadas recursivamente
(arrays en orden original), bytes UTF-8 y valor base64url; `kid` es `m1-v1`.
Configure `PERMISOS_FIRMA_SECRETO` con una clave compartida con C2; si falta,
se utiliza **`nexo-desarrollo-inseguro` solo para desarrollo local**, nunca para producción.

Esquema D2: `m1_config_permisos` según `001_initial.sql`. Al no existir columna
`actual`, se selecciona el evento `abierto` o el `preparacion` de ID más alto;
los `cerrado` no se distribuyen. El evento debe tener una fila en `politicas`;
el punto debe tener zona principal y al menos una fila en `punto_zonas`.
Se envían nombres de `zonas`, no identificadores internos. Los timestamps
`apertura` y `cierre` definen la ventana absoluta de P2; sus segundos del día
para O2 se calculan en la zona local del proceso Node. La anulación incremental
usa `cambios_permisos.recibido_en` como `anuladaEn` (el historial no guarda el
instante de emisión). Solo se consultan columnas de configuración de puntos;
el estado operativo y la telemetría pertenecen a M2.

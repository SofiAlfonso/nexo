# M1: configuración y permisos

Implementa configuración, permisos y el adaptador C3 de boletería.
Contiene sus capas `domain/`, `application/`, `infrastructure/` y `api/`.
Un módulo no importa el `infrastructure/` de otro módulo; se comunica por su `application/` (consultas B1–B4).

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
usa el instante de anulación emitido por la boletería (`boletas.anulacion_emitida_en`)
como `anuladaEn`, o `cambios_permisos.recibido_en` si no existe. Solo se consultan columnas de configuración de puntos;
el estado operativo y la telemetría pertenecen a M2.

## Adaptador C3 (P1 → modelo canónico, ADR-007)

`iniciarAdaptadorBoleteria(pool, config, log)` (desde `api/`) sondea la boletería cada
`BOLETERIA_INTERVALO_MS` (5000 por omisión) con `GET /versiones` y `GET /versiones/{n}`; C4 lo
arranca solo si `BOLETERIA_URL` está definida. `BOLETERIA_EVENTO_EXTERNO` (`TA-FECHA-14` por
omisión) enlaza el evento externo con el evento actual de M1, cuya columna `boleteria` debe
coincidir con la del índice.

- `domain/boleteria.ts` traduce localidades a zonas por nombre normalizado (sin tildes ni
  mayúsculas), `cambio-localidad` a `cambio-zona` y descarta `comprador`: ningún dato personal
  llega a D2. Una localidad desconocida rechaza la versión completa.
- `infrastructure/importaciones-pg.ts` aplica cada versión externa en una transacción de D2 con el
  evento bloqueado: solo los cambios efectivos consumen una versión canónica (una por cambio, PK de
  `cambios_permisos`); repetir una emisión vigente o reanular no crea versiones; nunca se
  deshace una anulación. `importaciones_boleteria` (migración 020, solo adición) guarda la huella
  SHA-256 del contenido (sin comprador ni `publicadaEn`): repetir versión y huella es idempotente,
  otra huella es conflicto de integridad.
- Cada ciclo verifica que la última versión importada conserve su huella y que la boletería no
  haya retrocedido; si no, C3 se detiene con `conflicto` y no importa nada más (una boletería
  reiniciada sin estado no puede reescribir el historial).

C3 no decide ingresos: solo publica versiones que P2 distribuye; C2 sigue siendo la autoridad.
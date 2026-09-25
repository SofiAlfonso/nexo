# D1: PostgreSQL 16 del coordinador local

`createD1Pool(env?)` exige `D1_DATABASE_URL` (opcional `D1_POOL_MAX`, entero positivo; predeterminado 10); quien crea el pool llama `pool.end()`. `await migrate(pool)` aplica `migrations/001_initial.sql` y futuras migraciones numeradas. Las carga relativas a `import.meta.url`, usa un advisory lock de sesión para serializar ejecutores, aplica cada archivo y su entrada en `d1_schema_migrations` en una misma transacción y comprueba el SHA-256 en reinicios. No modificar archivos ya aplicados. El proceso debe poder leer los `.sql` en ejecución.

Las aplicaciones deben agrupar `intento`, `decision`, el eventual `consumo`, `bitacora` y `outbox` en **una transacción con un solo cliente `pool.connect()`**. No responder `aceptado` antes de `COMMIT`. Para dos presentaciones simultáneas de la misma boleta, bloquear la fila `boleta` con `SELECT ... FOR UPDATE` y consultar `consumo`; el `UNIQUE` sigue siendo la protección definitiva. Ante conflicto en `intento.id_origen`, comparar `contenido_hash` (SHA-256 del contenido canónico V1); si coincide devolver la decisión guardada, de lo contrario responder conflicto de integridad. No actualizar una decisión existente. `sin-respuesta` nunca crea consumo. El despachador E1 marca `outbox` como `enviado` **solo después** del acuse de C4; errores incrementan `intentos` y retrasan `proximo_intento_en`. No borrar filas confirmadas.

Todas las columnas `*_en` y `instante_*` son `timestamptz`; identificadores, motivos y estados indicados como `text` se guardan literalmente (JSON externo usa camelCase).

| Tabla | Columnas exactas |
|---|---|
| `d1_schema_migrations` | `version integer PK`, `filename text`, `checksum text`, `applied_at timestamptz` |
| `permiso_version` | `evento_id text`, `version bigint` (PK junto a evento), `desde_version bigint`, `tipo text` (`instantanea`/`cambios`), `paquete jsonb` (P2 completo, incluida firma), `emitido_en timestamptz`, `vigente_hasta timestamptz`, `apertura_en timestamptz`, `cierre_en timestamptz`, `version_politicas bigint`, `instalado_en timestamptz` |
| `boleta` | `cliente_id text`, `evento_id text`, `boleteria_id text`, `referencia_externa text` (PK compuesto), `codigo text` (único por evento), `zona text`, `anulada_en timestamptz NULL`, `version_permiso bigint` |
| `punto` | `evento_id text`, `punto_id text` (PK compuesto), `zonas text[]`, `habilitado boolean` |
| `lector` | `evento_id text`, `lector_id text` (PK compuesto), `punto_id text` (FK a punto), `habilitado boolean` |
| `latido` | `evento_id text`, `lector_id text` (PK compuesto, FK a lector), `secuencia bigint`, `estado_lector text`, `pendientes_diario bigint`, `diario_total bigint`, `version_permisos bigint NULL`, `instante_lector timestamptz`, `recibido_en timestamptz` |
| `intento` | `id_origen text PK`, `contenido_hash text` (hex SHA-256), `evento_id text`, `lector_id text`, `punto_id text`, `codigo text`, `proposito text` (`ingreso`/`reingreso`), `zona_solicitada text`, `instante_lector timestamptz`, `creado_en timestamptz` |
| `decision` | `id_origen text PK` (FK a intento), `decision text` (`aceptado`/`rechazado`/`sin-respuesta`), `motivo text`, `proposito text NULL`, `admision boolean`, `concurrente boolean`, `anulacion_en_transito boolean`, `version_permisos bigint`, `evidencia jsonb`, `instante_decision timestamptz` |
| `consumo` | `cliente_id text`, `evento_id text`, `boleteria_id text`, `referencia_externa text`, `proposito text` (solo `PRIMER_INGRESO`, predeterminado), `id_origen text` (único, FK a decision), `consumido_en timestamptz`. `UNIQUE (cliente_id, evento_id, boleteria_id, referencia_externa, proposito)`; **no incluye zona, punto ni lector**. |
| `bitacora` | `id bigint identity PK`, `evento_id text`, `tipo text`, `id_origen text`, `evidencia jsonb`, `registrado_en timestamptz`; `UNIQUE (evento_id, tipo, id_origen)`. El trigger `bitacora_solo_adicion` rechaza todo `UPDATE`/`DELETE`. |
| `outbox` | `id bigint identity PK`, `bitacora_id bigint` (único, FK), `evento_id text`, `tipo text`, `id_origen text`, `payload jsonb`, `estado text` (`pendiente`/`enviado`), `intentos integer`, `proximo_intento_en timestamptz`, `ultimo_error text NULL`, `creado_en timestamptz`, `enviado_en timestamptz NULL`; `UNIQUE (evento_id, tipo, id_origen)`. |
| `lote_diario` | `id_lote text PK`, `evento_id text`, `lector_id text` (FK), `contenido_hash text` (hex SHA-256), `acuse jsonb`, `recibido_en timestamptz`. Repetir lote devuelve acuse guardado; registros H1 se preservan como evidencia sin autorizar. |

Ninguna tabla almacena comprador ni secretos. `permiso_version` guarda paquetes firmados y las filas `boleta`/`punto` representan el estado aplicado por C2 tras verificar firma, versión y continuidad.

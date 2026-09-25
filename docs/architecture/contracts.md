# Contratos entre componentes

Fuente única de verdad: [`src/shared/contracts/`](../../src/shared/contracts/) (paquete `@nexo/shared/contracts`), con esquemas [zod](https://zod.dev) y tipos inferidos. Este documento resume la semántica; ante una diferencia manda el código. Ejemplos válidos en [`tests/fixtures/`](../../tests/fixtures/), verificados por `tests/unit/contracts/fixtures.test.ts`.

Semántica de origen: taller 2 §4.3 y §5.4, taller 3 §3.3 y prototipo §6, §7, §8 y §12. Los contratos no cambian sin acuerdo de la sesión orquestadora (PR aparte que se fusiona primero).

```ts
import { RUTAS, SolicitudValidacion, type RespuestaValidacion } from '@nexo/shared/contracts';
const solicitud = SolicitudValidacion.parse(req.body);
```

`RUTAS` es el catálogo de método, ruta, servidor, esquemas de cuerpo, consulta y respuesta y estado HTTP de éxito de cada operación.

## Convenciones

- JSON en UTF-8; nombres de campos en español, como el lenguaje ubicuo.
- Instantes de máquina (V1, H1, E1, P1, P2) en ISO 8601 con zona (`2026-09-16T17:42:10.120-05:00`).
- En O2 los campos terminados en `S` son segundos desde la medianoche local del día del evento (como `ahoraS` del prototipo), con el reloj real del servidor. `EstadoActual.ahora` da además el instante ISO.
- Importes como texto decimal (`"6184.80"`), calculados con `decimal.js` (PB-18).
- Errores: `{ error, mensaje, detalles? }` con `error` en `CodigoError` (`SOLICITUD_INVALIDA` 400, `NO_AUTENTICADO` 401, `NO_AUTORIZADO` 403, `NO_ENCONTRADO` 404, `CONFLICTO_IDEMPOTENCIA` 409, `CONFLICTO_ESTADO` 409, `LOTE_DEMASIADO_GRANDE` 413, `ERROR_INTERNO` 500, `NO_DISPONIBLE` 503).
- Enumerados iguales al prototipo (`dominio.js`). Los estados usan sus valores literales (`en-linea`, `sin-respuesta`, `en-curso`…). Motivos, tipos de incidente y roles viajan por su **clave** (`PERMISO_VIGENTE`, `SIN_COMUNICACION`, `SUPERVISOR`); el texto visible está en `MOTIVO_TEXTO`, `TIPO_INCIDENTE_TEXTO`, `ROL_TEXTO`, `ESTADO_PUNTO_TEXTO` y `PRIORIDAD_TEXTO`.

| Enumerado | Valores |
|---|---|
| `Decision` | `aceptado`, `rechazado`, `sin-respuesta` (nunca equivale a aceptación) |
| `Motivo` | `PERMISO_VIGENTE`, `REINGRESO_AUTORIZADO`, `ZONA_NO_AUTORIZADA`, `BOLETA_ANULADA`, `FUERA_DE_HORARIO`, `USO_YA_REGISTRADO`, `USO_CONCURRENTE`, `REINGRESO_SUSPENDIDO`, `CODIGO_DESCONOCIDO`, `SIN_COORDINADOR`, `PUNTO_SUSPENDIDO` |
| `Proposito` | `ingreso`, `reingreso` |
| `EstadoPunto` | `en-linea`, `sin-comunicacion`, `averiado`, `en-pausa`, `sin-abrir` |
| `EstadoCoordinador` | `operando`, `sin-autoridad`, `protegiendo` |
| `EstadoEvento` | `preparacion`, `abierto`, `cerrado` |
| `TipoIncidente` | `SIN_COMUNICACION`, `LECTOR_AVERIADO`, `COORDINADOR`, `ENLACE_NUBE`, `PERMISOS`, `LATENCIA`, `FALSA_ALARMA` (taxonomía v1) |
| `Prioridad` | `critica`, `alta`, `media`, `baja` |
| `EstadoIncidente` | `nuevo`, `en-curso`, `resuelto`, `descartado` |
| `TipoAccion` / `EstadoAccion` | `redirigir`, `credencial`, `promover`, `reingresos`, `preliminar` / `pendiente`, `aprobada`, `rechazada`, `caducada` |
| `EstadoConciliacion` | `sin-iniciar`, `en-curso`, `preliminar`, `conciliado` |
| `Rol` | `SUPERVISOR`, `LIDER_TECNICO`, `LOGISTICA`, `CIERRE`, `FINANZAS` |

## V1. Validación (C1 → C2)

`POST /v1/validaciones`, HTTPS con mTLS. Cuerpo `SolicitudValidacion`: `idOrigen`, `eventoId`, `lectorId`, `puntoId`, `codigo`, `proposito` (por defecto `ingreso`), `zonaSolicitada`, `instanteLector`. Respuesta `RespuestaValidacion`: `decision`, `motivo`, `proposito` resuelto, `admision`, `concurrente`, `anulacionEnTransito`, `versionPermisos`, `evidencia {via, versionPermisos, versionPoliticas, antiguedadPermisosS}`, `instanteDecision`, `repetida`.

- Mismo `idOrigen` y contenido: devuelve la decisión original con `repetida: true`. Mismo `idOrigen` y contenido distinto: 409 `CONFLICTO_IDEMPOTENCIA` (PB-04).
- Consumo, decisión, idempotencia y outbox en una sola transacción de D1 (T1); nunca se responde aceptación antes del commit.
- Si C2 no puede confirmar (D1 caída, BD-01) responde `sin-respuesta`. Un timeout del lector también cuenta como `sin-respuesta` y el intento queda en su diario.
- `lectorId` debe coincidir con la credencial mTLS.
- `idOrigen` recomendado: `<lectorId>:<secuencia>`, estable entre reintentos.

## H1. Latido y diario (C1 → C2)

- `POST /v1/heartbeats`, cada 10 s. Cuerpo `Latido` (`secuencia`, `estadoLector`, `pendientesDiario`, `diarioTotal`, `versionPermisos`); respuesta `AcuseLatido {recibidoEn, intervaloS}`. Un punto pasa a `sin-comunicacion` a los 30 s sin latido (meta KR1.2: 60 s).
- `POST /v1/diario/lotes`, receptor separado de V1. Cuerpo `LoteDiario` con 1 a 500 `RegistroDiario`; respuesta `AcuseLoteDiario {aceptados, duplicados, yaDecididos, repetido}`. Recupera evidencia **sin nueva autorización**; idempotente por `idLote` y por `idOrigen`. `yaDecididos` lista los intentos que C2 sí había decidido (respuesta perdida).

## E1. Consolidación (C2 → C4, M2)

`POST /v1/lotes-evidencia`, HTTPS saliente. Cuerpo `LoteEvidencia {idLote, recintoId, eventoId, coordinadorId, emitidoEn, registros}` con 1 a 100 registros (`MAX_REGISTROS_LOTE`, `loteEvidenciaMax`). Registros por `tipo`:

| `tipo` | Contenido | `idOrigen` |
|---|---|---|
| `decision` | Decisión de V1 con zona, motivo, admisión, evidencia e instantes | El del lector |
| `intento-diario` | Intento recuperado por H1, sin decisión | El del lector |
| `latido-punto` | Último latido de un punto (C2 puede agrupar) | Generado por C2 |
| `estado-coordinador` | Estado de C2, versiones y outbox (`outboxPendientes`, `outboxEdadMaxS`) | Generado por C2 |

- Al menos una vez, con espera creciente y tope, prioridad inferior a V1. M2 deduplica por (`eventoId`, `tipo`, `idOrigen`); el mismo `idLote` devuelve el acuse original con `repetido: true`.
- Respuesta `AcuseLoteEvidencia {aceptados, duplicados, repetido, resultados[]}`. El acuse no autoriza a borrar copias locales (ADR-011).
- El panel deriva de E1 la antigüedad de los datos del recinto (SER-05), el estado de puntos y la regla de latido > 60 s.

## P2. Distribución de permisos (C4, M1 → C2)

`GET /v1/permisos?eventoId=EVT-2026-02&desdeVersion=n`, solicitado por el recinto. Respuesta `PaquetePermisos`: `tipo` (`instantanea` si `desdeVersion=0`, si no `cambios`), `desdeVersion`, `hastaVersion`, `vigenteHasta`, `ventana`, `politicas`, `puntos[] {puntoId, zonas}`, `cambios[]` (`alta`, `anulacion`, `cambio-zona`, cada uno con `version` y `referencia`) y `firma {algoritmo, kid, valor}` sobre el JSON canónico sin `firma`. C2 rechaza firma inválida, otro evento, retrocesos y huecos. Sin datos personales.

## P1. Boletería simulada (externa → C3)

`GET /versiones` → `IndiceVersiones`; `GET /versiones/{n}` → `VersionBoleteria` (versión 0 = instantánea). Modelo **externo** (`localidad` en mayúsculas, `operacion`: `emision`, `anulacion`, `cambio-localidad`); C3 lo traduce al canónico en M1. Puede traer `comprador` (datos personales ficticios) que C3 descarta antes de guardar. Repetir versión y contenido es idempotente y nunca reinicia consumos.

## Auth del panel

Usuario y contraseña por rol (ADR-016), argon2 en D2, cookie firmada `nexo_sesion` (HttpOnly, SameSite=Lax). El rol sale del usuario.

| Ruta | Cuerpo | Respuesta |
|---|---|---|
| `POST /api/auth/login` | `SolicitudLogin {usuario, contrasena}` | 200 `Sesion {operador {usuario, nombre, rol, rolTexto}, expiraEn}` + cookie; 401 genérico |
| `POST /api/auth/logout` | — | 204, cookie expirada |
| `GET /api/auth/me` | — | 200 `Sesion` o 401 |

Todas las demás rutas `/api/*` exigen la cookie; las acciones se registran con el rol como autor.

## O2. Operación (C5 → C4)

Formas alineadas con el `store` del prototipo para que `api.js` reemplace a `simulador.js` sin tocar las vistas. Nodo único: `coordinador` no tiene réplica ni repuesto.

| Método y ruta | Cuerpo o consulta | Respuesta |
|---|---|---|
| `GET /api/eventos/actual/estado` | — | `EstadoActual` (evento, coordinador, nube, integración, conteo, admisiones por zona, serie, métricas, conciliación, preparación) |
| `GET /api/puntos` | — | `ListaPuntos` (`PuntoResumen[]`) |
| `GET /api/puntos/{id}` | — | `PuntoDetalle` (más latencias, recientes, preparación, lectores, actividad) |
| `GET /api/intentos` | `?limite=1..200&puntoId=` | `ListaIntentos` |
| `GET /api/boletas/{ref}` | — | `Boleta` |
| `GET /api/incidentes`, `GET /api/incidentes/{id}` | — | `ListaIncidentes`, `Incidente` |
| `POST /api/incidentes/{id}/acciones` | `AccionIncidente` por `accion`: `tomar`, `nota {texto}`, `escalar`, `descartar`, `resolver`, `actualizar {clasificacion?, prioridad?, responsable?}`, `destacar {valor?}`, `checklist {indice}` | `Incidente` |
| `GET /api/acciones`, `POST /api/acciones/{id}` | `DecisionAccion {aprobar, nota?}` | `ListaAcciones`, `Accion` |
| `GET /api/actividad` | — | `ListaActividad` |
| `POST /api/preparacion/controles/{id}`, `POST /api/preparacion/confirmar` | `CambioControl {ok}` / — | `Preparacion` |
| `POST /api/cierre/preliminar`, `POST /api/cierre/definitivo`, `POST /api/cierre/cobro` | `SolicitudCierre {nota?}` | `Conciliacion`; 409 `CONFLICTO_ESTADO` con `detalles.pendientes` si faltan condiciones |
| `POST /api/cierre/diferencias/{id}` | `ResolucionDiferencia {opcion}` | `Conciliacion` |
| `GET /api/stream` | — | SSE, ver abajo |

`Liquidacion` (M4) está definida para el cierre; su ruta (`GET /api/liquidacion`) y `GET /api/contrato` se agregan después de M1.

### SSE `GET /api/stream`

`text/event-stream`; `event:` es el tipo, `data:` el JSON y `id:` una secuencia monótona. Al conectar o reconectar, C4 envía primero `estado` completo (la reconexión recupera el estado). Comentario `: ping` cada 15 s. Tipos (`EventoStream`): `estado` (`EstadoActual`), `punto` (`PuntoResumen`), `intento` (`Intento`), `incidente` (`Incidente`), `accion` (`Accion`), `aviso` (`{texto, tono}`), `diferencia` (`Diferencia`).

## Fixtures

`tests/fixtures/<contrato>/<Esquema>.<caso>.json`; el prefijo es el nombre del esquema exportado. `tests/fixtures/invalid/` contiene casos que deben fallar. La prueba exige al menos un fixture por cada cuerpo y respuesta del catálogo `RUTAS`. Los datos siguen la semilla del prototipo (evento `EVT-2026-02`, puntos `P-01` a `P-20`, lectores `LX-2210-…`, boletas `TA-88dd-dddd`) y no contienen datos personales reales.

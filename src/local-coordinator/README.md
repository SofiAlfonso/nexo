# Coordinador local C2

C2 es la **única autoridad** de ingreso del recinto. El lector C1 nunca decide sin
confirmación de C2; C4 recibe evidencia, pero nunca autoriza. En D1, consumo único,
idempotencia por `idOrigen`, decisión y outbox se confirman en una misma transacción;
la bitácora y el outbox son solo-adición. Un timeout no revierte un commit tardío:
el lector conserva el intento en su diario y reintenta con el mismo `idOrigen`.

## API

| Método | Ruta | Función |
| --- | --- | --- |
| POST | `/v1/validaciones` | V1: decisión o `sin-respuesta` ante falta de confirmación |
| POST | `/v1/heartbeats` | H1: latido del lector |
| POST | `/v1/diario/lotes` | H1: recuperar evidencia, sin decidir de nuevo |
| GET | `/salud` | Proceso vivo |
| GET | `/listo` | D1 disponible; 503 si no lo está |

## Ejecución local

Node 24: `npm start -w @nexo/local-coordinator` (o `node src/local-coordinator/index.ts`,
que es lo que usan `npm run dev` y la imagen Docker). `npm run dev` pasa
`PORT=$COORDINATOR_PORT` (acordado: 8081; C4 8080) y toma D1 de las variables `D1_*` de `deploy/compose/.env.example`.
Sin configuración de D1 se crea un almacén **volátil de demostración**, con puntos,
lectores y boletas de prueba. Para D1 persistente, inicie PostgreSQL del archivo
`deploy/compose/docker-compose.dev.yml` y configure `LOCAL_POSTGRES_HOST=localhost`,
`LOCAL_POSTGRES_PORT=5433`, `LOCAL_POSTGRES_DB=nexo_venue` y
`LOCAL_POSTGRES_USER=nexo_venue`; la contraseña se proporciona por variable de
entorno, nunca se guarda en Git. C2 aplica las migraciones de D1 al arrancar
(idempotentes); la semilla del evento (evento, puntos, lectores, boletas) debe
estar instalada antes de aceptar ingresos. `CENTRAL_URL` habilita el envío E1
(`POST /v1/lotes-evidencia`, lotes ≤100, backoff exponencial, prioridad inferior a V1).
La descarga de permisos P2 desde C4 aún no está conectada: C2 usa los permisos ya
presentes en D1.

| Variable | Predeterminado | Descripción |
| --- | --- | --- |
| `PORT` | `8081` | Puerto HTTP |
| `HOST` | `0.0.0.0` | Interfaz de escucha |
| `EVENTO_ID` | `EVT-2026-02` | Evento activo |
| `RECINTO_ID` | `REC-01` | Recinto |
| `COORDINADOR_ID` | `COORD-A` | Nodo de autoridad |
| `CENTRAL_URL` | sin valor | Sin valor, E1 apagado |
| `PLAZO_VALIDACION_MS` | `500` | Plazo máximo de V1 |
| `LOTE_EVIDENCIA_MAX` | `100` | Capacidad máxima por lote E1 |
| `INTERVALO_LATIDO_S` | `10` | Cadencia solicitada al lector |
| `LOCAL_POSTGRES_HOST` | sin valor | Sin valor, D1 en memoria |
| `LOCAL_POSTGRES_PORT` | `5432` | Puerto D1 (`5433` desde Compose) |
| `LOCAL_POSTGRES_DB` | `nexo_venue` | Base D1 |
| `LOCAL_POSTGRES_USER` | `nexo_venue` | Usuario D1 |
| `LOCAL_POSTGRES_PASSWORD` | sin valor | Contraseña D1, solo en entorno |
| `D1_MIGRAR` | `true` | `false` si las migraciones de D1 las aplica otro paso |
| `D1_DATABASE_URL` | sin valor | Alternativa a `LOCAL_POSTGRES_*` (URL `postgres://`) |
| `D1_HOST`, `D1_PORT`, `D1_POSTGRES_DB`, `D1_POSTGRES_USER`, `D1_POSTGRES_PASSWORD` | `localhost`, `5433` | Variables de Compose; se usan si no hay `LOCAL_POSTGRES_HOST` ni `D1_DATABASE_URL` |

Ejemplo de V1 en PowerShell (la primera boleta Norte de la semilla):

```powershell
@'
{"idOrigen":"LX-2210-107:ejemplo1","eventoId":"EVT-2026-02","lectorId":"LX-2210-107","puntoId":"P-01","codigo":"TA-8800-0001","proposito":"ingreso","zonaSolicitada":"Norte","instanteLector":"2026-09-25T17:00:00.000Z"}
'@ | Set-Content -Encoding utf8 solicitud.json
curl.exe -H "Content-Type: application/json" --data-binary "@solicitud.json" http://localhost:8081/v1/validaciones
Remove-Item solicitud.json
```

En bash:

```bash
curl -H 'Content-Type: application/json' -d '{"idOrigen":"LX-2210-107:ejemplo1","eventoId":"EVT-2026-02","lectorId":"LX-2210-107","puntoId":"P-01","codigo":"TA-8800-0001","proposito":"ingreso","zonaSolicitada":"Norte","instanteLector":"2026-09-25T17:00:00.000Z"}' http://localhost:8081/v1/validaciones
```

En producción, V1/H1 requieren mTLS; el enlace entre `lectorId` y el
certificado es trabajo de T25, no está habilitado todavía.

## Reemplazo de lector en un punto (PU-05-02)

Con D1 en PostgreSQL y la misma configuración de C2:

```powershell
$env:COORDINATOR_TLS_REVOKED_FILE = 'deploy/certs/private/revoked.json'
node src/local-coordinator/infrastructure/cli/reemplazar-lector.ts --punto P-01 --anterior LX-2210-107 --nuevo LX-2210-200 --motivo lost --certs-script scripts/certs.mjs
```

En una transacción de D1 se cierra la asignación anterior: el lector queda `revocado` y C2 lo rechaza aunque la CA no esté disponible. El lector nuevo queda asignado al punto y se registra la solicitud de revocación de la credencial anterior. Con `--certs-script`, C2 ejecuta `scripts/certs.mjs revoke` y registra el número de serie y la huella que quedaron en `revoked.json`. El servidor TLS relee esa lista en cada solicitud. Sin `--certs-script`, la revocación queda pendiente (código de salida 2) hasta que el custodio de la CA la ejecute; `--pendientes` confirma o reintenta las solicitudes abiertas. Repetir el mismo reemplazo es idempotente. Una identidad revocada nunca se reasigna.

# F1 — C2 con C4 caído: degradación y corrección (25-09-2026)

**Resultado: la degradación no venía de C4.** Tenía dos causas en C2 y D1, y
las dos quedaron corregidas. Con C4 inaccesible, 20 lectores y 49,5 TPS,
C2 respondió en 300 ms o menos al 100 % de las V1. No hubo dobles consumos
y, en la misma ventana, se drenaron 10 000 registros del diario H1.

## Síntoma de partida

S2-integrity midió con un D1 nuevo, C2 real y `CENTRAL_URL` inaccesible
(apéndice de [t24-2026-09-25.md](t24-2026-09-25.md)): 0 de 2970 V1 respondidas en
300 ms o menos, p95 de 2747 ms, 97 decisiones en D1, 2095 `intento_diario`
y 2192 filas de outbox pendientes.

## Causa demostrada

1. **Fila caliente en `boleta`.** La mezcla del perfil pico envía el 65 % de
   las lecturas a boletas ya usadas. En un D1 recién sembrado solo hay una:
   `TA-8800-0002` (la exportación lista `usadas: ['TA-8800-0002']`). Por eso
   unas 32 V1/s tomaban `SELECT … FOR UPDATE` sobre la misma fila y
   retenían el candado hasta el fsync del `COMMIT`. El muestreo de
   `pg_stat_activity` en la corrida degradada muestra de 8 a 9 sesiones
   esperando `tuple`/`transactionid` en ese `SELECT` y a quien tiene el
   candado en `WALSync`. Cuando el commit tarda, esas esperas ocupan las
   10 conexiones del pool. Entonces las demás V1, incluidas las válidas,
   agotan `connectionTimeoutMillis` (400 ms) o `lock_timeout` (500 ms) y
   responden "sin confirmación". Los reintentos del lector, que llegan 2 s
   después con el mismo `idOrigen`, suman más carga y el sistema queda en
   un colapso metaestable.
2. **Lotes H1 en el pool de V1.** `registrarLote` hacía cuatro viajes por
   registro, hasta 2000 para un lote de 500, dentro de una transacción que
   ocupaba una conexión del mismo pool que V1. Con 20 lectores entregando
   su diario a la vez, el pool se agotaba aunque la fila caliente ya
   estuviera corregida: 3,6 % de V1 en 300 ms o menos, con latencias de
   unos 417 ms, el plazo de conexión. Esto confirma la hipótesis de
   S2-integrity, pero como segundo amplificador.

`CENTRAL_URL` no es la causa. Con backoff, el despachador E1 hace unos
pocos intentos por minuto y reutiliza el lote pendiente sin consultar D1.
El colapso se reproduce igual **sin** `CENTRAL_URL` (tabla A, filas 3 y 4).
La corrida de S2-integrity sin C4 que cumplió T1 usó un D1 con consumos
acumulados de corridas previas, así que la exportación ofrecía muchas
boletas usadas y no existía la fila caliente.

## Corrección (`src/local-coordinator/infrastructure/persistence/postgres/`)

- `unidad-postgres.ts`: la boleta y su consumo se leen primero sin
  candado. Si ya hay consumo o anulación confirmados, el único resultado
  posible es un rechazo y ese estado no se revierte, así que no se bloquea
  la fila. Solo cuando la boleta podría aceptarse se toma `FOR UPDATE` y
  se vuelve a leer `consumo`. El `UNIQUE` de `consumo` sigue siendo la
  garantía de consumo único.
- `almacen-postgres.ts`: V1 usa en exclusiva el pool principal de 10
  conexiones. El diario H1, el outbox E1 y la lectura de versiones pasan
  a un pool de fondo de 2 conexiones. C2 atiende un lote H1 a la vez: el
  concurrente recibe 503 y C1 reintenta el mismo lote en su siguiente
  sincronización. El lote se procesa por conjuntos (`= ANY`,
  `jsonb_array_elements`) en unos 7 viajes, sin depender del número de
  registros. El acuse y la idempotencia no cambian.

## Método

- Windows, Node 24.13.0, PostgreSQL 16 (Testcontainers), D1 nuevo con
  migraciones y `seed.sql` del repositorio. No se usó `nexo-dev`.
- **Extremo a extremo (tabla A):** C2 real (`main.ts`) como proceso, en un
  puerto propio y con `CENTRAL_URL` hacia un puerto cerrado. Lector real
  `src/reader-client/cli/worker.ts`, con perfil `pico`, `--evento
  EVT-2026-02`, 20 lectores, `timeoutMs` 2000 y reintento de las
  `sin-respuesta` (las mismas opciones que usó T24). T1 se calcula como en
  T24: `latenciaMs ≤ 300` sin timeout. El script de reproducción no se
  versionó.
- Como la latencia de fsync del Docker compartido varía entre corridas
  (fila 2 frente a fila 5), el commit lento se fijó con
  `commit_delay`/`commit_siblings=0` de PostgreSQL. En dos corridas se
  interpuso un proxy TCP con retardo; en Windows, sus `setTimeout(3)`
  suman unos 10 ms por sentido.
- **Regresión (tabla B):**
  `tests/integration/coordinator/f1-degradacion.test.ts`. Arma C2 como
  `main.ts`, con los pools reales y E1 hacia un puerto cerrado, y envía
  49,5 TPS con la mezcla pico durante 20 s. Mientras tanto, cada uno de los
  20 lectores entrega un lote H1 de 500 registros y lo reintenta hasta
  recibir el acuse. D1 usa `commit_delay` de 20 ms.

### Tabla A — extremo a extremo, C1 real

| # | Condición | Código | Duración | ≤300 ms | p95 | Sin respuesta | Resultado en D1 |
|---|---|---|---:|---:|---:|---:|---|
| 1 | C4 inaccesible | antes | 30 s | 1050/1485 (70,7 %) | 510 ms | 141 | 1458 intentos, 39 `intento_diario` |
| 2 | Sin `CENTRAL_URL` | antes | 30 s | 1477/1485 (99,5 %) | 97 ms | 0 | 1486 intentos |
| 3 | C4 inaccesible, proxy de 3 ms | antes | 30 s | 4/1485 (0,3 %) | 521 ms | 1475 | **13 intentos**, 208 `intento_diario` |
| 4 | Sin `CENTRAL_URL`, proxy de 3 ms | antes | 30 s | 5/1485 (0,3 %) | 521 ms | 1474 | **12 intentos**, 427 `intento_diario` |
| 5 | C4 inaccesible | antes | 60 s | 2970/2970 (100 %) | 43 ms | 0 | disco rápido en ese momento |
| 6 | C4 inaccesible, `commit_delay` de 20 ms | antes | 60 s | 2216/2970 (74,6 %) | 511 ms | 429 | 2801 intentos, 224 `intento_diario`, 55 lotes |
| 7 | C4 inaccesible, proxy de 3 ms | solo fila caliente | 30 s | 1483/1485 (99,9 %) | 254 ms | 0 | 1486 intentos |
| 8 | C4 inaccesible | después | 60 s | 2957/2970 (99,6 %) | 104 ms | 4 | 2971 intentos |
| 9 | C4 inaccesible, `commit_delay` de 20 ms | después | 60 s | **2970/2970 (100 %)** | 50 ms | 0 | 2971 intentos |
| 10 | C4 inaccesible, `commit_delay` de 40 ms | después | 30 s | **1485/1485 (100 %)** | 77 ms | 0 | 1486 intentos |

Ninguna corrida tuvo dobles consumos. Los conteos de D1 incluyen el intento
de la semilla. Las filas 3, 4 y 6 reproducen el síntoma de S2-integrity:
casi ninguna decisión llega a D1 y el diario empieza a crecer.

### Tabla B — prueba de regresión, D1 con `commit_delay` de 20 ms

| Código | Diario H1 simultáneo | ≤300 ms | p95 / p99 | Diario drenado |
|---|---|---:|---:|---|
| antes (10 s) | no | 12/495 (2,4 %) | 514 / 517 ms | — |
| solo fila caliente (10 s) | no | 495/495 (100 %) | 187 / 204 ms | — |
| solo fila caliente (20 s) | 20 × 500 | 36/990 (3,6 %) | 417 / 499 ms | — |
| **después** (20 s) | 20 × 500 | **990/990 (100 %)** | 175 / 222 ms | 10 000/10 000 en D1 y outbox en 20 s |

Criterio F1: al menos 99 % de V1 en 300 ms o menos con C4 inaccesible y
20 lectores a unos 49 TPS, sin dobles consumos, y el diario sigue drenando.
Se cumple en las filas 8 a 10 y en la última fila de la tabla B. Para
repetir la prueba:
`npx vitest run --config vitest.integration.config.ts tests/integration/coordinator/f1-degradacion.test.ts`
(variables opcionales `F1_DURACION_S`, `F1_COMMIT_DELAY_US` y
`F1_LOTES_POR_LECTOR`).

## Límites

- Son corridas cortas de 20 a 60 s con un evento, no el perfil pico
  completo de una hora y tres eventos.
- `commit_delay` emula un fsync lento de forma uniforme. No reproduce
  pausas irregulares del disco ni contención de CPU.
- Si V1 supera la capacidad del pool principal por otra razón, por
  ejemplo una red C2–D1 muy lenta, las validaciones que ya vencieron
  siguen ocupando su conexión hasta la siguiente sentencia acotada por
  `statement_timeout`. Aplicar ese plazo en el caso de uso le corresponde
  a `src/shared/domain`, no a este cambio.

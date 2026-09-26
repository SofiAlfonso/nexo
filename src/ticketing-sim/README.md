# Boletería simulada

Sistema externo de prueba fuera de C4 (namespace `nexo-external`). Publica versiones
inmutables de emisiones y anulaciones por el contrato P1; no decide ingresos. La
semilla piloto contiene 16.240 boletas y únicamente datos ficticios. Las primeras
diez incluyen un comprador ficticio para comprobar que el adaptador central descarta
esos datos personales. No usar datos reales.

Se inicia desde la raíz con `node src/ticketing-sim/index.ts`. Por defecto usa
`0.0.0.0:8082` y la semilla piloto. Variables disponibles:

| Variable | Función |
| --- | --- |
| `PORT`, `TICKETING_PORT` | Puerto (`PORT` tiene prioridad; predeterminado 8082). |
| `HOST` | Dirección de escucha (predeterminado `0.0.0.0`). |
| `BOLETERIA_NOMBRE`, `BOLETERIA_EVENTO_EXTERNO` | Identificadores publicados en P1. |
| `TICKETING_SEMILLA` | `piloto` (predeterminado) o `vacia`. |
| `TICKETING_ESTADO_ARCHIVO` | Archivo JSON para restaurar al iniciar y guardar atómicamente tras cada cambio. |
| `TICKETING_ADMIN_TOKEN` | Si se define, exige `x-admin-token` en todas las rutas administrativas. |
| `TICKETING_URL` | URL base para el comando `anular` (predeterminado `http://localhost:8082`). |

`GET /versiones` devuelve el índice y `GET /versiones/:n` devuelve una versión P1.
`GET /salud` devuelve el estado y la última versión. Las rutas de prueba
`POST /admin/anulaciones` (`{"referencia":"…"}`), `POST /admin/emisiones` y
`POST /admin/cambios-localidad` (ambas `{"referencia":"…","localidad":"NORTE"}`)
publican versiones nuevas. Las localidades admitidas son NORTE, SUR, ORIENTAL,
OCCIDENTAL y PALCOS. Las rutas administrativas no forman parte de P1.

Para anular en vivo una boleta de prueba:

```powershell
npm run anular -w @nexo/ticketing-sim -- TA-8800-0005
```

O mediante HTTP (añadir `-H "x-admin-token: …"` si se configuró el token):

```sh
curl -X POST http://localhost:8082/admin/anulaciones -H "Content-Type: application/json" -d '{"referencia":"TA-8800-0005"}'
```

La versión resultante queda disponible en `GET /versiones/:n`; con
`TICKETING_ESTADO_ARCHIVO` también sobrevive a un reinicio.

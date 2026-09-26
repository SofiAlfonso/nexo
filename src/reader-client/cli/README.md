# CLI del lector

Ejecutar con Node 24 desde la raíz del repositorio:

```powershell
node src\reader-client\cli\index.ts start --perfil nominal --lectores 20 --coordinador http://localhost:8081 --boletas C:\nexo-datos\boletas.json --datos C:\nexo-datos\lector
node src\reader-client\cli\index.ts status --datos C:\nexo-datos\lector
node src\reader-client\cli\index.ts stop --datos C:\nexo-datos\lector
node src\reader-client\cli\index.ts report --datos C:\nexo-datos\lector
```

En producción use HTTPS con **tres flags obligatorios**: `--ca` (PEM de
la CA que firmó el certificado de C2), `--cert` (certificado PEM del lector)
y `--key` (clave privada PEM del lector). Para varios lectores en un mismo
`start`, tanto `--cert` como `--key` deben contener `{lectorId}`; cada lector
abre una conexión TLS propia con su certificado y se verifica el nombre
del servidor y la CA. Ejemplo:

```powershell
node scripts\certs.mjs init
node scripts\certs.mjs issue-server --dns localhost --ip 127.0.0.1
node scripts\certs.mjs issue-reader --reader-id LX-2210-0107
node src\reader-client\cli\index.ts start --perfil nominal --lectores 1 --coordinador https://localhost:8081 --boletas C:\nexo-datos\boletas.json --ca deploy\certs\private\ca.crt --cert deploy\certs\private\readers\LX-2210-0107\tls.crt --key deploy\certs\private\readers\LX-2210-0107\tls.key
```

Emita un certificado con `issue-reader --reader-id ID` **por cada lector**
seleccionado en el export de D1. Para ejecutar varios lectores en el mismo
proceso, sustituya las dos rutas individuales por
`--cert 'deploy\certs\private\readers\{lectorId}\tls.crt'` y
`--key 'deploy\certs\private\readers\{lectorId}\tls.key'`. La CA y las
credenciales generadas están en `deploy\certs\private\` (fuera de Git);
si usa `--store NAME` al emitirlas, ajuste todas las rutas a ese almacén.
El identificador de cada credencial debe coincidir exactamente con el
`lectorId` exportado por D1.

El `lectorId` debe existir en `lectores` del export real de D1 (por ejemplo
`LX-2210-0107`) y el certificado cliente debe llevar
`URI:urn:nexo:reader:<lectorId>` en su SAN; C2 verifica esa identidad
y su lista de revocación. El certificado de C2 debe tener un SAN
DNS/IP coincidente con la URL usada. `start` comprueba los archivos y
credenciales antes de iniciar la carga; el proceso solo persiste **rutas**,
no claves. HTTP sigue siendo el valor de laboratorio para `npm run dev`:
no se permiten flags TLS con HTTP, ni HTTPS sin los tres flags; no existe
opción para desactivar la verificación de C2. Una conexión no confirmada
nunca autoriza un ingreso.

`--datos` por defecto usa `%USERPROFILE%\.nexo\reader-client` y **no**
puede ubicarse dentro del repositorio. Ahí se guardan el diario JSONL de
cada lector (fsync antes de V1), el control del proceso, el log y el reporte
JSON por evento y por intento. `start` inicia el proceso de carga en segundo
plano; `stop` pide una parada ordenada y escribe un reporte parcial. Un
timeout cuenta como `sin-respuesta` y un reintento posterior usa el mismo
`idOrigen` durable; nunca abre la puerta desde el lector.

El archivo de `--boletas` procede de la semilla D1, no de valores inventados.
Ver [formato de exportación y casos](../../../tests/load/README.md); los
campos `estado`/`usada` deben coincidir con D1. El export puede incluir
`lectores: [{ lectorId, puntoId, eventoId, zonas: ["Sur"] }]` de D1; si
no lo incluye se generan identidades sintéticas **solo útiles contra el
servidor falso**, no para una corrida real con credenciales C2. Al seleccionar
una boleta, el CLI usa un lector del mismo evento y zona; para el caso
"otra zona" exige además un punto que no atienda la zona de la boleta
(importante si hay puntos multizona). Para los pares
necesita dos lectores compatibles por zona.

`--perfil nominal|pico|estres` selecciona los perfiles de `tests/load/`
(`estres` carga `stress.json`). `pico` define tres eventos y 60 lectores;
`--evento EVT-2026-02` restringe una prueba corta al evento activo. Use
`--duracion 15` para comprimir las fases de un perfil a 15 s preservando su
proporción y TPS; `--pares --pares-cantidad 500` programa dos solicitudes
simultáneas por boleta. `--timeout 500` establece el plazo V1 en milisegundos
(predeterminado: 500). El resumen sale por stdout/log; `report` muestra el
JSON persistido.

La revocación de credenciales corresponde a C2 (T25): el lector no
sustituye a C2 ni autoriza durante la pérdida del enlace.

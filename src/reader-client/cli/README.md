# CLI del lector

Ejecutar con Node 24 desde la raíz del repositorio:

```powershell
node src\reader-client\cli\index.ts start --perfil nominal --lectores 20 --coordinador http://localhost:8081 --boletas C:\nexo-datos\boletas.json --datos C:\nexo-datos\lector
node src\reader-client\cli\index.ts status --datos C:\nexo-datos\lector
node src\reader-client\cli\index.ts stop --datos C:\nexo-datos\lector
node src\reader-client\cli\index.ts report --datos C:\nexo-datos\lector
```

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

mTLS y revocación de credenciales por lector pertenecen a T25. Para un
laboratorio HTTP local, las identidades vienen del export D1; el lector
no sustituye a C2 ni autoriza durante la pérdida del enlace.

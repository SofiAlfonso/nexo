# Carga emulada T24

El CLI debe llamar `cargarPerfil(ruta)`, `cargarBoletas(ruta)` y
`ejecutarCarga({ perfil, exportacion, present, stdout: console.log })` desde
`src/reader-client/load/index.ts`. `present(intento)` recibe
`{ lectorIndex, codigo, zonaSolicitada, eventoId, idCarga, caso, expected, parId? }`
y devuelve una promesa `{ decision: 'aceptado' | 'rechazado' | 'sin-respuesta',
motivo?, solicitud?: { idOrigen }, idOrigen? }`.
El adaptador del CLI asigna credenciales a cada índice, persiste el diario,
reintenta con el mismo `idOrigen` real y envía heartbeat; **este módulo no autoriza
accesos ni sustituye al lector**. La demora máxima del callback para el informe
es `timeoutMs`. También puede llamar `ejecutarPares({ perfil, exportacion,
present, pares, stdout })` para EXP04; cada par comparte código pero usa dos
lectores e identificadores de origen distintos y se inicia simultáneamente.
Un par correcto tiene exactamente una aceptación, sin imponer cuál llega
primero; requiere dos lectores por evento. Los pares se espacian con la tasa
agregada de la **primera fase** del perfil (dos presentaciones por par).
`idCarga` es solo una correlación única por ejecución (UUID), nunca sustituye
`idOrigen`: `LectorEmulado.presentar` lo crea y lo persiste en su diario; el
callback puede devolver su resultado íntegro y el reporte usará
`solicitud.idOrigen`. En error o timeout sin respuesta del callback el reporte
deja `idOrigen` ausente, no inventa uno. Reconciliar esos intentos requiere el
diario del lector. No ejecutar dos cargas con el mismo diario sin verificar
el estado persistido de las presentaciones anteriores.
Ambos ejecutores aceptan `signal?: AbortSignal`: al abortar dejan de programar
envíos, esperan los pendientes (hasta `timeoutMs`) y devuelven un informe
parcial. `timeouts` incluye tanto el plazo del generador como cualquier
`sin-respuesta` devuelto por el lector o derivado de un error del callback.

La exportación JSON sembrada debe tener esta forma (ver `seed.example.json`):

```json
{
  "eventos": [{
    "eventoId": "EVT-TEST",
    "boletas": [
      { "codigo": "TEST-A", "zona": "Norte", "estado": "vigente", "usada": false },
      { "codigo": "TEST-B", "zona": "Sur", "estado": "anulada", "usada": false }
    ]
  }]
}
```

No incluya identidad del asistente ni datos personales. Cada `codigo` es
único dentro de su evento; las boletas `usada` ya están consumidas **en C2**
antes de arrancar la carga (no basta marcar el archivo). Las anulaciones
también deben estar propagadas a C2. Cada zona de la exportación debe figurar
en `zonas` del perfil y la ventana de ingreso debe estar abierta. Para el
caso de otra zona se reservan algunas boletas vigentes, que nunca se usan
como válidas en la misma ejecución. Aporte suficientes boletas vigentes
únicas para cada aceptación prevista y cada par; al agotarse se aborta en
vez de reutilizar una boleta. Los códigos desconocidos se generan evitando
colisiones con la exportación. Si se ejecutan perfiles sucesivos sobre la
misma base, restablezca los consumos de la semilla o exporte un conjunto
nuevo.

Los perfiles JSON declaran duración de fases, TPS agregado, eventos, lectores,
semilla y ponderación de casos. `nominal.json` programa 19.800 intentos en
60 minutos (840 s a 4,7142857 TPS y 60 s a 16,5 TPS por cuarto de hora);
`pico.json` programa 49,5 TPS agregados de tres eventos durante una hora;
`stress.json` programa cuatro niveles de diez minutos. Las cuentas por
fase son `floor(tps × segundos)` y las salidas se espacian sobre un reloj
monótono; si el proceso no alcanza la cadencia, `tpsDespachado` refleja
también el atraso. El resultado JSON incluye cada intento con esperado,
obtenido, timeout, latencia y horario relativo, métricas agregadas (incluidos
pares incorrectos y falsos rechazos de pares con dos rechazos) y
aceptaciones esperadas/obtenidas por evento. `formatearResumen` produce la
versión breve para stdout; `guardarReporteJson(ruta, reporte)` persiste el JSON
completo en la ruta provista por el llamador, fuera del repositorio de código.
Un timeout informa `sin-respuesta`, **no** demuestra
que C2 no haya confirmado: confronte el contador con D1/D2 para conciliar.

Prueba rápida: `npx vitest run --config tests/load/vitest.config.ts`.

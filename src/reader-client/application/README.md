# Aplicación del lector

`LectorEmulado` se exporta desde `application/index.ts`. Construirlo con
`{ lectorId, puntoId, eventoId, directorio, coordinador, timeoutMs?, heartbeatMs? }`;
`directorio` debe ser una ruta absoluta **fuera del repositorio**, persistente y
exclusiva del lector (por ejemplo un volumen local). `coordinador` acepta URL
base o un adaptador `CoordinadorLector` con `validar`, `latido` y `loteDiario`.
Para mTLS se puede instanciar `ClienteHttpCoordinador(url, fetchConfigurado)`
con un transporte seguro configurado fuera del repositorio.

Llamar `await iniciar()` antes de `presentar({ codigo, zonaSolicitada,
proposito? })`. El resultado incluye `solicitud`, `respuesta?`, `decision` y
`latenciaMs`. `reintentar(idOrigen)` retransmite el contenido original.
`sincronizarDiario()` envía lotes H1 pendientes y devuelve el número de
registros confirmados; `enviarLatido()` envía H1 inmediatamente; `estado()`
informa contadores y el último error de tareas periódicas; `await detener()`
cierra el diario. El lector nunca decide la admisión: solo una aceptación
confirmada por C2 puede autorizar. Un timeout (500 ms por defecto) devuelve
`sin-respuesta`.

El diario JSONL por identidad se sincroniza a disco antes de enviar V1 y al
registrar resultados, latidos, lotes o acuses. Conserva intentos sin decisión
confirmada y retransmite lotes con el mismo `idLote` hasta acuse completo; el
diario H1 solo recupera evidencia histórica y **no** solicita autorización.
Cada diario nuevo persiste una época aleatoria con la identidad para que su
secuencia reiniciada no colisione con `idOrigen` ni `idLote` de otro diario
del mismo lector; abrir el mismo diario conserva la época y los identificadores.
Los errores de V1 de integridad se lanzan; los errores de H1 manual se lanzan
y los de las tareas periódicas se registran mediante `logger.error`.

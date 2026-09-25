# Infraestructura del lector

`DiarioJsonl` guarda un archivo JSONL por `lectorId` en un volumen absoluto
fuera del repositorio. Persiste con `fsync` cada solicitud antes de V1 y cada
resultado, secuencia de latido, lote H1 y acuse. Tras reiniciar recupera los
intentos sin decisión y retransmite el mismo `idLote` hasta el acuse completo.
La ruta se reserva a un único proceso escritor por lector.

`ClienteHttpCoordinador` valida solicitudes y respuestas con los esquemas
compartidos V1/H1, aplica timeout y acepta una implementación `fetch` inyectada
para configurar TLS/mTLS sin secretos en el repositorio. No implementa
decisiones de acceso ni lógica de negocio central.

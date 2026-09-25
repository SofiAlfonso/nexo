# ADR-006: Modelo de datos sin identidad del portador

- **Estado**: Aceptado
- **Fecha**: 14 de septiembre de 2026 (registro del taller 2)
- **Origen**: taller 2, entregable 02 (docs/context/taller2.md §3)

## Contexto
La boleta es un permiso del evento, no una representación del portador ni el texto del QR. Para decidir un ingreso basta la referencia estable, el contexto del intento y los permisos versionados. Capturar datos del asistente ampliaría innecesariamente los datos que se integran, almacenan y respaldan.

## Decisión
Modelar la validación con `Boleta` e `IntentoDeValidacion` sin dato alguno de identidad del asistente. No incorporar nombres, documentos, contactos, pagos ni biometría del portador en integración, registros operativos, colas o respaldos; aplicar lista permitida y minimización a los datos recibidos de la boletería.

## Alternativas consideradas
- Capturar identidad o biometría: no se requiere para comprobar permisos e ingreso.
- Guardar datos del comprador: confunde la compra con la autorización de acceso.
- Persistir todo y ocultarlo en la interfaz: los datos seguirían presentes en almacenes y respaldos.

## Consecuencias
- Las referencias técnicas, intentos y permisos permiten decidir y auditar sin perfilar asistentes.
- La minimización debe extenderse a integraciones y observabilidad, no solo a las pantallas.
- Logs técnicos y métricas no deben usar datos personales ni la boleta como etiqueta métrica.
- Los códigos desconocidos se registran como referencia presentada sin fabricar una boleta.

## Criterio para aceptar
Inspeccionar esquema, contratos, muestras de integración, logs, colas, respaldos y telemetría: ninguno contiene identidad, contactos, pagos ni biometría del asistente (RN-10). Verificar también que los datos sintéticos y los artefactos versionados no incluyan datos personales.

## Aplicación en el taller 3
- `src/shared/domain/` y los contratos de C1/C2 en `src/reader-client/` y `src/local-coordinator/` mantienen referencias técnicas sin identidad del portador.
- `src/central-core/` ingiere solo campos canónicos permitidos; fixtures y datos semilla deben ser sintéticos.
- No se incluyen datos personales en Git, logs, telemetría ni fixtures.

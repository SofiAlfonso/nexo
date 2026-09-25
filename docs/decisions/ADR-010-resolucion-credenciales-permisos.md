# ADR-010: Resolución de credenciales y actualización de permisos

- **Estado**: Pendiente de PoC (bloqueante)
- **Fecha**: 14 de septiembre de 2026 (registro del taller 2); actualizado 25 de septiembre de 2026
- **Origen**: taller 2, entregable 02 (docs/context/taller2.md §3)

## Contexto

El texto de un QR no constituye por sí solo una identidad confiable de boleta.
La autoridad local necesita permisos y anulaciones actuales sin consultar a la boletería en cada escaneo.
El contrato real de resolución con el proveedor sigue sin acordarse; el simulador no demuestra compatibilidad con una boletería externa.

## Decisión

Acordar con la boletería una resolución autorizada de credenciales y una actualización recuperable de permisos versionados, compatible con QR dinámico.
El modelo canónico conservará identidad estable de cliente, evento, boletería y referencia, más permisos, anulaciones, origen, versión y vigencia.
C2 rechazará firmas inválidas, retrocesos, huecos y paquetes destinados a otro evento; repetir una versión no reinicia consumos.

## Alternativas consideradas

- Consultar al proveedor por escaneo: hace depender la validación local de la red externa.
- Sondeo sin garantía o archivo estático: no prueban recuperación de cambios ni anulaciones.
- Usar el texto del QR como identidad: no garantiza una referencia autorizada, especialmente con QR dinámico.
- Solo webhooks: no permiten recuperar por sí mismos huecos tras una desconexión.

## Consecuencias

El adaptador P1 debe ser específico de cada boletería sin cambiar el modelo de NEXO por evento.
No se compromete un piloto real sin interfaz autorizada y pruebas de rotación, anulación y recuperación durante cortes de 15 minutos.
La boletería simulada sirve para la PoC de flujo, no para dar por cerrado ese acuerdo.

## Criterio para aceptar

Con un proveedor autorizado, resolver una credencial dinámica, aplicar una anulación versionada y recuperar cambios perdidos tras 15 minutos sin conexión.
Comprobar que una versión repetida no concede un segundo consumo y que P2 rechaza contenido inválido, antiguo o ajeno al evento.

## Aplicación en el taller 3

- Simular P1 en `src/ticketing-sim/`: `GET /versiones` y `GET /versiones/{n}` con permisos versionados.
- C4 distribuye a C2 por P2, `GET /v1/permisos?desdeVersion=n`, con contenido firmado; contratos compartidos en `src/shared/contracts/`.

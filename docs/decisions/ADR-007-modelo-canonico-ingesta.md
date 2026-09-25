# ADR-007: Modelo canónico de ingesta con adaptador delgado por boletería

- **Estado**: Pendiente de PoC
- **Fecha**: 14 de septiembre de 2026 (registro del taller 2)
- **Origen**: taller 2, entregable 02 (docs/context/taller2.md §3)

## Contexto
La boletería es externa: emite permisos, cambios y anulaciones, pero no decide el acceso. NEXO debe reutilizar el conector en varios eventos del mismo proveedor sin programar por evento. P1 depende de un contrato autorizado de resolución y cambios; no se puede presuponer una API pública, QR dinámicos ni anulaciones disponibles sin esa interfaz.

## Decisión
Definir un modelo canónico de permisos y anulaciones con un adaptador delgado por boletería; expresar diferencias entre eventos mediante configuración. C3 traduce P1 hacia M1 sin decidir ingresos. El límite canónico identifica cliente, evento, boletería y referencia externa, junto con permisos, anulaciones, origen, versión y vigencia; repetir versión y contenido es idempotente y no reinicia consumos.

## Alternativas consideradas
- Integraciones por evento: exigen desarrollo específico para cada nueva operación.
- Exigir al proveedor el contrato de NEXO: no se puede imponer unilateralmente su interfaz.
- Esperar un estándar: posterga la integración sin resolver el contrato autorizado.

## Consecuencias
- La reutilización requiere cero desarrollo específico para los eventos 2 y 3 del mismo proveedor.
- No se presumen QR dinámicos ni anulaciones sin interfaz autorizada; acordar P1 bloquea el piloto real.
- Las versiones de permisos deben distribuirse sin restablecer consumos ya confirmados.
- C2 no puede presumir que conoce anulaciones posteriores a su última actualización.

## Criterio para aceptar
Probar con un contrato P1 autorizado la resolución, actualización recuperable y anulación, incluso durante cortes de 15 min (CA1); verificar cero desarrollo específico para eventos 2 y 3 del mismo proveedor (Q10). Sin esa prueba, no comprometer el piloto con público.

## Aplicación en el taller 3
- `src/ticketing-sim/` simula la boletería en `nexo-external` con contrato P1 y versiones de permisos y anulaciones.
- C3, dentro de M1 en `src/central-core/modules/configuration-permissions/`, traduce P1 al modelo canónico; no es servicio independiente.
- Probar una anulación hasta C2 y documentar la ventana en que todavía no ha llegado; el simulador aporta evidencia de PoC, no sustituye el acuerdo real con la boletería.

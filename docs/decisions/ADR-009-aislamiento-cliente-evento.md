# ADR-009: Aislamiento lógico y autorización por cliente y evento

- **Estado**: Pendiente de PoC (recortada en el taller 3)
- **Fecha**: 14 de septiembre de 2026 (registro del taller 2); actualizado 25 de septiembre de 2026
- **Origen**: taller 2, entregable 02 (docs/context/taller2.md §3)

## Contexto

NEXO presta servicio a varios clientes y eventos sobre una persistencia central compartida.
Una consulta, trabajador o panel no debe mostrar ni alterar datos de otro alcance.
El taller 2 eligió defensa en dos capas; el laboratorio de 12 horas solo contiene un cliente y un evento y no prueba el aislamiento multicliente.

## Decisión

La decisión original es PostgreSQL compartido con seguridad a nivel de filas (RLS) y autorización en aplicación; el cliente procede de la identidad autenticada, nunca de un parámetro arbitrario.
En el taller 3 se implementa solo autorización en aplicación para un cliente y un evento de laboratorio.
No se implementa RLS en este recorte ni se presenta el laboratorio como prueba de aislamiento entre clientes.

## Alternativas consideradas

- Filtros solo en código: aceptados temporalmente en la PoC, pero insuficientes como defensa definitiva ante una consulta omitida.
- Instancia por cliente: incrementa el costo y la operación respecto del PostgreSQL compartido.
- Cuenta compartida: no permite derivar ni auditar un cliente autenticado de forma fiable.

## Consecuencias

Quedan sin demostrar el aislamiento de consultas, archivos, paneles y trabajadores, así como el comportamiento de conexiones reutilizadas y roles sin elusión.
El informe debe registrar expresamente que el criterio de aceptación de RLS no tiene evidencia.
La implementación de laboratorio no autoriza un piloto multicliente.

## Criterio para aceptar

En una PoC posterior con al menos dos clientes y eventos, intentar lecturas y escrituras cruzadas mediante API, panel, archivos y trabajadores; ninguna debe prosperar.
Probar RLS con conexiones reutilizadas y roles de aplicación sin posibilidad de eludir las políticas; este criterio permanece pendiente y sin evidencia en el taller 3.

## Aplicación en el taller 3

- Aplicar autorización en C4 y C5 con un solo cliente y evento de laboratorio, sin RLS en D2 (recorte de D8).
- Documentar en el informe la ausencia de prueba de aislamiento y mantener la PoC pendiente.

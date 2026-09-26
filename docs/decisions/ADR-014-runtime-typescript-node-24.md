# ADR-014: Runtime TypeScript sobre Node.js 24 LTS

- **Estado**: Aceptado
- **Fecha**: 25 de septiembre de 2026
- **Origen**: taller 3, decisión Q1 de la orquestación (plan del taller 3, gap G09)

## Contexto

El taller 2 dejó sin fijar lenguaje y runtime para C1, C2 y C4 (§5.9).
El prototipo C5 ya está escrito en JavaScript, y el laboratorio dispone de 12 horas para integrar servicios y pruebas.
La decisión Q1 actualiza a Node.js 24 LTS la propuesta de Node 22 de taller 3 y G09.

## Decisión

Usar TypeScript sobre Node.js 24 LTS para C1, C2, C4, el adaptador de C5 y `nexo-chaos`.
Organizar el código con npm workspaces; emplear Fastify para HTTP, `pg` para PostgreSQL, Vitest para pruebas, zod para contratos, `decimal.js` para importes (PB-18) y argon2 para hashes de contraseñas.
Declarar `engines` como `>=24`, construir imágenes desde `node:24-alpine` y ejecutar CI con Node 24.

## Alternativas consideradas

- Node.js 22 LTS: ya está en mantenimiento y termina en abril de 2027, antes de un posible piloto.
- Go: obliga a mantener otro lenguaje junto al prototipo JavaScript durante una PoC corta.
- Java con Spring Boot: aumenta el costo de implementación e integración en 12 horas.

## Consecuencias

Un solo ecosistema comparte contratos, validación y herramientas entre componentes; la atomicidad del consumo sigue dependiendo de D1, no de Node.
El SDK OpenTelemetry de Node cubre trazas, métricas y logs.
Los módulos nativos como argon2 deben instalarse y verificarse dentro de la imagen elegida.

## Criterio para aceptar

Ejecutar instalación reproducible, compilación, lint y Vitest de todos los workspaces en Node 24, además de construir y arrancar las imágenes `node:24-alpine`.
Verificar importes decimales sin aritmética binaria de punto flotante y comprobar hash/validación con argon2.

## Aplicación en el taller 3

- Declarar workspaces, dependencias y `engines` en `package.json`; colocar los servicios en `src/` y `nexo-chaos` en `chaos/scripts/`.
- Actualizar Dockerfiles y el workflow de CI en `.github/workflows/` para Node 24, cerrando solo el pendiente de runtime de T2 §5.9.

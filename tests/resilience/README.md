# Integridad EXP 03/04

Ejecutar desde la raíz con Docker disponible:

```powershell
npx vitest run --config tests\resilience\vitest.config.ts
```

Las pruebas levantan su propio PostgreSQL 16 con Testcontainers y llaman a C2 mediante `app.inject`, sin usar puertos compartidos. EXP 03 descarta la primera respuesta, reinicia C2 con el mismo D1 y verifica idempotencia y conflicto de contenido. EXP 04 envía simultáneamente dos solicitudes por cada una de 500 boletas; limita a una pareja en vuelo para que la cola de conexiones no agote el plazo de 500 ms de V1. Se comprueban las respuestas y las filas de D1 (intento, consumo, bitácora y outbox).

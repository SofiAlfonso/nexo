# NEXO · Interfaz del recinto (C5)

Interfaz de **NEXO**, la plataforma B2B de control de acceso para estadios. Tiene
estilo de mesa de ayuda: una bandeja de incidentes con contadores, responsables y
plazos, y fichas de detalle con bitácora, propiedades y datos técnicos. Los datos
vienen del recinto en vivo (D2 vía C4): REST al arrancar y SSE (`/api/stream`)
después. Ya no hay una simulación local: la sirve `js/api.js`.

## Cómo ejecutarlo

C5 la sirve C4 (`npm run dev` en la raíz, o el `start` de `central-core`); abrir
`index.html` directamente sin backend solo tiene sentido en modo `?fixtures`
(añade ese parámetro a la URL), que carga instantáneas de
`tests/fixtures/O2/` para desarrollar la interfaz sin depender del backend.

Al entrar aparece la pantalla de acceso (ADR-016): usuario y contraseña contra
`POST /api/auth/login`. El rol viene de la sesión (`GET /api/auth/me` al
arrancar) y ya no hay un selector de rol en el cliente.

## Qué cambió frente a la versión anterior

| Problema | Solución |
| --- | --- |
| Difícil de comprender | Bienvenida y glosario del lenguaje ubicuo. Cada pantalla dice para qué sirve. Una frase resume el estado del evento («18 de 20 puertas validan con normalidad»). Los indicadores tienen ayuda en lenguaje llano y los códigos KR/CA pasan a segundo plano. Un diagrama en vivo muestra el recorrido de cada decisión. |
| Difícil de usar | Menos pantallas y un flujo de mesa de ayuda: la bandeja lleva al detalle y el detalle a la puerta. Hay acciones pendientes con Aprobar/Rechazar, búsqueda global (atajo `/`) y filtros por contador. |
| Poco atractivo | Sistema visual con la marca de la presentación (azul noche y cian), la tipografía Inter, iconos, tarjetas, fichas de color, anillos y gráficos, además de tema claro y oscuro. |
| Desalineado con los ADR | Las puertas ya no autorizan solas. Todas consultan un **coordinador local único** (D9, sin réplica en el taller 3), así que una boleta se consume una sola vez en todo el evento. Sin coordinador no se acepta nada: el intento queda en el diario del lector. |

## Pantallas

| Ruta | Pantalla | Para qué sirve | Metas |
| --- | --- | --- | --- |
| `#/inicio` | Resumen | Estado general, indicadores, recorrido de la decisión, puertas y zonas | O1 · KR1.1 · KR1.2 · CA2 |
| `#/incidentes` | Incidentes | Bandeja con contadores, tarjetas con plazos y acciones pendientes | O1 · O2 · KR1.3 · KR2.2 |
| `#/incidentes/INC-0001` | Detalle del incidente | Bitácora de solo adición, propiedades, pasos a seguir y tiempos | KR1.3 · KR2.1 · KR2.2 |
| `#/puertas/P-07` | Puertas | Lista y detalle: lector, credencial, diario e intentos | O2 · KR2.1 · KR2.2 |
| `#/lector` | Lector en puerta | Qué ve el operador, qué regla decidió y qué quedó registrado | R1 · KR4.1 · KR4.2 · CA3 |
| `#/cierre` | Cierre y liquidación | Recorrido del cierre, diferencias, conciliación, liquidación y contrato | O4 · O5 · KR4.3 · KR5.1 · KR5.3 |
| `#/preparacion` | Preparación | Controles previos, pruebas CA1–CA4, coordinador, integración y políticas | O3 · CA1–CA4 |

Ninguna pantalla cubre KR5.2 (recompra): esa evidencia son las fechas y el origen
de un contrato nuevo. La tarjeta del contrato queda pendiente de conectar
(post-M1): hoy solo muestra el evento activo.

## Estado en el hito M1

Hasta M1 solo `#/inicio` y `#/puertas` tienen conexión completa a datos vivos
(hidratación REST + actualización por SSE), junto con la ficha del coordinador
como nodo único (D9) y la antigüedad de los datos del recinto cuando no llegan
(SER-05). Las demás pantallas cargan con los mismos datos del API cuando existen,
o con un estado vacío claro cuando el endpoint correspondiente todavía no está
conectado; su conexión completa queda para después de M1. El lector físico de
prueba (`#/lector`) queda como una pantalla informativa: el botón de escaneo
avisa que el lector real se conecta más adelante.

## Alineación con el modelo de dominio y los ADR

| Decisión | Dónde se ve |
| --- | --- |
| ADR-001 · capas | `modelo/` (dominio) ← `api.js` (aplicación real: REST + SSE) ← `vistas/` (presentación). Las vistas nunca deciden. |
| ADR-002 · coordinador local | Todos los intentos pasan por el coordinador de C2; la interfaz solo refleja su decisión. La nube nunca autoriza. |
| ADR-003 · consumo único y global | Copias simultáneas en dos puertas: una se acepta y la otra se rechaza. |
| ADR-004 · bitácora de solo adición | Las notas y resoluciones se agregan y no se editan. Las admisiones se derivan de la primera aceptación correcta. |
| ADR-006 · sin identidad del portador | El lector y los registros no tienen campos personales. Los responsables son roles. |
| ADR-007 / ADR-010 · integración | Boletería del evento, permisos versionados y antigüedad tolerable. |
| ADR-008 · identidad de dispositivos | Credencial individual por lector, punto y evento, e historial de lectores. |
| ADR-009 · autorización por rol | El rol viene de la sesión (ADR-016); avatar y cierre de sesión en la barra superior. |
| ADR-011 · validación y sincronización separadas | Diario del lector → coordinador, y buzón del coordinador → nube. |
| ADR-013 · observabilidad | Latencia medida en el lector; KPI "Respuestas en ≤ 300 ms" (D11) con p95 en el pie. |
| ADR-016 · acceso al panel | Pantalla de usuario/contraseña; sin selector de rol en el cliente. |

Reglas del modelo de dominio que la interfaz hace cumplir:

- Solo la primera aceptación correcta genera admisión. Sin reingresos en el taller 3 (D10).
- Una solicitud sin respuesta nunca equivale a aceptación.
- Una anulación que no ha llegado no se presume conocida: se concilia después.
- Cambiar el lector no cambia la identidad del punto.
- Los conteos de boletas, rechazos y admisiones no se suman.
- No se declara conciliado sin cobertura completa y sin todas las diferencias resueltas.
- Tarifa: USD 500 + USD 0,40 por admisión. Anticipo: USD 500 + 50 % del uso estimado. El saldo se cobra hasta 30 días después de conciliar.

## Estructura

```
index.html              orden de carga
assets/fonts/           Inter y JetBrains Mono (licencia OFL)
fixtures/o2/            instantáneas O2 para el modo ?fixtures (copia de tests/fixtures/O2)
css/
  tokens.css            colores, tipografía y escala; tema claro y oscuro
  base.css              reinicio y utilidades
  layout.css            riel, barra superior, notificaciones
  components.css        botones, insignias, tarjetas, campos, bitácora, tablas, login
  screens.css           lo específico de cada pantalla
js/
  util.js               formato, escape de HTML y ranuras
  iconos.js             iconos Lucide incrustados (licencia ISC)
  modelo/dominio.js     reglas, umbrales, tarifa y traducciones KEY→texto
  store.js              estado central observable
  api.js                capa de aplicación real: REST (/api/*), SSE (/api/stream) y modo ?fixtures
  login.js              pantalla de acceso (ADR-016)
  router.js             enrutador por fragmento (hash)
  vistas/               una vista por pantalla, más comunes.js y ayuda.js
  app.js                armazón, búsqueda, tema, sesión y arranque
```

## Decisiones técnicas del frontend

- **Sin build.** Espacio de nombres global (`NEXO.*`) y enrutado por hash: JS de navegador plano, sin bundler ni frameworks nuevos.
- **Montar una vez y actualizar ranuras.** Cada vista construye su esqueleto y solo reescribe las ranuras (`data-slot`) cuyo HTML cambió. Así los campos no pierden el foco ni las listas el desplazamiento cuando llega un evento SSE.
- **Colores solo en `tokens.css`.** El color semántico (aceptado, rechazado, sin respuesta, en pausa) es independiente del acento y nunca se usa como adorno.
- **Preferencias locales.** El tema y la bienvenida se guardan en el navegador. Si el almacenamiento no está disponible, todo funciona igual.

## Compatibilidad

Versiones actuales de Chrome, Edge, Firefox y Safari. Se adapta a pantallas de teléfono.

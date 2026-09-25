# NEXO · Prototipo de interfaz

Prototipo de alta fidelidad de **NEXO**, la plataforma B2B de control de acceso para
estadios. Tiene estilo de mesa de ayuda: una bandeja de incidentes con contadores,
responsables y plazos, y fichas de detalle con bitácora, propiedades y datos técnicos.
Todo funciona sobre una simulación en vivo del evento.

> Las cifras son de ejemplo y el cliente es ficticio. El prototipo no demuestra
> viabilidad técnica ni comercial: muestra qué habría que medir.

## Cómo ejecutarlo

Abre `index.html` con doble clic. No necesita servidor, compilación, dependencias
ni conexión a internet: las fuentes y los iconos vienen incluidos.

La primera vez aparece una bienvenida que explica cómo usar la demostración. Puedes
volver a abrirla desde **Ayuda**, en el riel izquierdo.

## Qué cambió frente a la versión anterior

| Problema | Solución |
| --- | --- |
| Difícil de comprender | Bienvenida y glosario del lenguaje ubicuo. Cada pantalla dice para qué sirve. Una frase resume el estado del evento («18 de 20 puertas validan con normalidad»). Los indicadores tienen ayuda en lenguaje llano y los códigos KR/CA pasan a segundo plano. Un diagrama en vivo muestra el recorrido de cada decisión. |
| Difícil de usar | Menos pantallas y un flujo de mesa de ayuda: la bandeja lleva al detalle y el detalle a la puerta. Hay acciones pendientes con Aprobar/Rechazar, búsqueda global (atajo `/`) y filtros por contador. Los casos del lector se prueban con un botón. La simulación va en un panel plegable y baja a 1× cuando una decisión es tuya. |
| Poco atractivo | Nuevo sistema visual con la marca de la presentación (azul noche y cian), la tipografía Inter, iconos, tarjetas, fichas de color, anillos y gráficos, además de tema claro y oscuro. |
| Desalineado con los ADR | Las puertas ya no autorizan solas. Todas consultan un **coordinador local compartido**, así que una boleta se consume una sola vez en todo el evento. Sin coordinador no se acepta nada: el intento queda en el diario del lector. |

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
de un contrato nuevo. La tarjeta del contrato solo recuerda su ventana.

## El guion de la simulación

La demo arranca a las 17:52, con el ingreso cargado. Después ocurren estos incidentes,
todos derivados de las reglas del modelo:

| Hora | Qué pasa | Qué muestra | Decisión |
| --- | --- | --- | --- |
| 18:01 | P-16 pierde comunicación con el coordinador | Aparece «sin comunicación» a los 30 s. Sus intentos quedan en el diario, sin aceptación. Al volver sincroniza en menos de 5 min. | Redirigir el flujo |
| 18:04 | El lector de P-11 se avería | El repuesto necesita una credencial individual. Se mide la recuperación frente a la meta de 3 min. | Emitir credencial (la demo baja a 1×) |
| 18:06 | Se cae el enlace del estadio con la nube | **El ingreso sigue** con el coordinador local. La evidencia espera en el buzón. | — |
| 18:11 | Los permisos pasan de 5 min sin cambios | Restricción acordada: suspender los reingresos | Suspender reingresos |
| 18:15 | Vuelve el enlace | Llegan anulaciones atrasadas. Las boletas ya aceptadas pasan a conciliación. | — |
| 18:24 | Falla el coordinador primario | Ninguna puerta acepta hasta promover la réplica síncrona. Luego se restablece la protección. | Promover COORD-B (la demo baja a 1×) |
| 20:15 | Cierra la ventana | Preliminar en 30 min, diferencias, conciliación y liquidación | Entregar, resolver y conciliar |

Si nadie decide, el rol responsable simulado actúa solo después de un tiempo, y el
tiempo que tardó cuenta para la meta de 5 min.

Con los botones del panel **Demo** (abajo a la derecha) puedes cambiar la velocidad o
saltar a un momento: antes de abrir, pico de ingreso, incidentes, falla del
coordinador o cierre. La semilla es fija, así que el evento es reproducible.

## Alineación con el modelo de dominio y los ADR

| Decisión | Dónde se ve |
| --- | --- |
| ADR-001 · capas | `modelo/` (dominio) ← `simulador.js` (aplicación) ← `vistas/` (presentación). Las vistas nunca deciden. |
| ADR-002 · coordinador local compartido | Todos los intentos pasan por `dominio.decidir()`, que representa al coordinador. La nube nunca autoriza. |
| ADR-003 · consumo único y global | Copias simultáneas en dos puertas: una se acepta y la otra se rechaza. Caso «Copia en otra puerta» en el lector. |
| ADR-004 · bitácora de solo adición | Las notas y resoluciones se agregan y no se editan. Las admisiones se derivan de la primera aceptación correcta. |
| ADR-005 · recuperación segura | Falla de COORD-A con promoción manual, protección síncrona con COORD-C y pausa medida |
| ADR-006 · sin identidad del portador | El lector y los registros no tienen campos personales. Los responsables son roles. |
| ADR-007 / ADR-010 · integración | Adaptador por boletería, permisos versionados, antigüedad tolerable y anulaciones en tránsito |
| ADR-008 · identidad de dispositivos | Credencial individual por lector, punto y evento, e historial de lectores |
| ADR-009 · autorización por rol | Selector de rol en la barra superior y filtro «Asignados a mí» |
| ADR-011 · validación y sincronización separadas | Diario del lector → coordinador, y buzón del coordinador → nube |
| ADR-012 · persistencia | Réplica síncrona, exclusión de la autoridad anterior y evidencia de 90 días |
| ADR-013 · observabilidad | Latencia medida en el lector, con las solicitudes sin respuesta en el denominador y el corte informado aparte |

Reglas del modelo de dominio que la interfaz hace cumplir:

- Solo la primera aceptación correcta genera admisión. Un reingreso se acepta pero no se cobra.
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
css/
  tokens.css            colores, tipografía y escala; tema claro y oscuro
  base.css              reinicio y utilidades
  layout.css            riel, barra superior, panel Demo, notificaciones
  components.css        botones, insignias, tarjetas, campos, bitácora, tablas
  screens.css           lo específico de cada pantalla
js/
  util.js               formato, escape de HTML, ranuras y generador con semilla
  iconos.js             iconos Lucide incrustados (licencia ISC)
  modelo/dominio.js     reglas, umbrales, tarifa y servicio de decisión
  modelo/datos.js       cliente, contrato, eventos, zonas, puertas y boletas
  store.js              estado central observable
  simulador.js          capa de aplicación simulada y guion de incidentes
  router.js             enrutador por fragmento (hash)
  vistas/               una vista por pantalla, más comunes.js y ayuda.js
  app.js                armazón, búsqueda, tema, panel Demo y arranque
```

## Decisiones técnicas del frontend

- **Sin servidor.** Se usan un espacio de nombres global y enrutado por hash, porque los módulos ES fallan sobre `file://`. Migrar consiste en cambiar los `<script>` por `type="module"`.
- **Montar una vez y actualizar ranuras.** Cada vista construye su esqueleto y solo reescribe las ranuras (`data-slot`) cuyo HTML cambió. Así los campos no pierden el foco ni las listas el desplazamiento, aunque la demo se actualiza 4 veces por segundo.
- **Colores solo en `tokens.css`.** El color semántico (aceptado, rechazado, sin respuesta, en pausa) es independiente del acento y nunca se usa como adorno.
- **Preferencias locales.** El tema, la bienvenida y el estado del panel Demo se guardan en el navegador. Si el almacenamiento no está disponible, todo funciona igual.

## Compatibilidad

Versiones actuales de Chrome, Edge, Firefox y Safari. Se adapta a pantallas de teléfono.

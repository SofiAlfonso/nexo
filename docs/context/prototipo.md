# Prototipo de interfaz de NEXO: especificación para implementar el panel C5

Especificación autocontenida del prototipo del entregable 07 del taller 2 (`taller2/NEXO_07_Prototipo/`, abierto desde `index.html`). Sirve para portarlo como panel C5 del taller 3 sin tener que leer el código original. El resumen general del taller 2 está en [taller2.md](taller2.md) y el plan en [taller3.md](taller3.md).

Fuentes: el código del prototipo, su README y el registro de decisiones del equipo con quien construyó el prototipo (D-01 a D-27 y supuestos S-01 a S-07, 25 de septiembre de 2026), ya integrado en este documento. Las secciones 14 a 17 recogen de ese registro lo que no se ve en el código: principios, bloqueos, invariantes, reglas de medición, supuestos y el guion de fallas. El manual visual del prototipo es `taller2/NEXO_07_Prototipo-Manual.pdf` (58 páginas A4 horizontales, 57 capturas anotadas y una tabla de trazabilidad elemento → regla o ADR). Los tokens, componentes visuales y reglas de estilo están en [DESIGN.md](../../DESIGN.md); este archivo cubre comportamiento y datos.

Regla del taller 3: el simulador del prototipo no se recrea. Todo lo que hoy produce `simulador.js` debe venir de C4 (que lee D2) y, para la vista del lector, de C2. Lo que no tenga fuente real se elimina o se marca como pendiente.

## 1. Arquitectura del frontend

- HTML, CSS y JavaScript sin build ni dependencias; fuentes Inter y JetBrains Mono (OFL) e iconos Lucide (ISC) incluidos en `assets/` y `js/iconos.js`.
- `index.html` solo define el orden de carga; `app.js` construye el armazón. Orden: `util.js`, `iconos.js`, `modelo/dominio.js`, `modelo/datos.js`, `store.js`, `simulador.js`, `router.js`, `vistas/comunes.js`, las siete vistas, `vistas/ayuda.js`, `app.js`.
- Espacio de nombres global `window.NEXO` en lugar de módulos ES, porque los módulos fallan sobre `file://`. Al servirse desde C4 se puede migrar a `type="module"`.
- Enrutado por hash (`router.js`): `R.registrar(patron, vistaId)` con parámetros `:id`.
- Estado central observable (`store.js`): `inicializar`, `get`, `suscribir`, `notificar`, `reiniciar`, `alAvisar`, `avisar`. Las vistas no guardan datos; solo el simulador modifica el estado. En el taller 3 lo modifica el adaptador `api.js`.
- Cada vista expone `montar(contenedor, params)` y devuelve `{ actualizar(estado), desmontar() }`. Monta su esqueleto una vez y solo reescribe las ranuras `data-slot` cuyo HTML cambió (`u.ranura`), para no perder foco ni desplazamiento con 4 actualizaciones por segundo.
- Eventos por delegación: `data-accion` y `data-arg` dentro de cada vista (`comunes.delegar`), `data-app` en el armazón.
- Colores solo en `css/tokens.css`. Tema claro y oscuro (`data-theme` en `<html>`). Preferencias locales en `localStorage` mediante `u.prefs`: `tema`, `bienvenidaVista`, `dockAbierto`.
- CSS: `tokens.css` (colores, tipografía, escala), `base.css` (reinicio y utilidades), `layout.css` (riel, barra superior, panel Demo, notificaciones), `components.css` (botones, insignias, tarjetas, campos, bitácora, tablas), `screens.css` (pantallas).
- Compatibilidad declarada: Chrome, Edge, Firefox y Safari actuales; adaptable a teléfono.

Tokens principales: marca `--brand #0B1266`, cian `--cyan #38C6F4`, acento `--accent #2F6BFF`; semánticos `--ok #148F5E`, `--no #D2463E`, `--warn #C9780F`, `--violet #6F4FD8`, `--info #2F6BFF`, `--mute #7C879C` (cada uno con `-soft`); zonas `--z1` a `--z5`; fichas de bandeja `--t-red`, `--t-orange`, `--t-blue`, `--t-gold`, `--t-violet`, `--t-gray`; riel `--rail-w 84px`, barra `--top-h 64px`; radios 6, 8, 12 y 16 px. El color semántico (aceptado, rechazado, sin respuesta, en pausa) es independiente del acento y no se usa como adorno.

Regla de color (D-23): el color solo indica estado, y ningún archivo fuera de `tokens.css` escribe un color literal (las vistas usan `var(--…)`). La marca sale de la presentación del equipo; Inter para texto y JetBrains Mono para identificadores.

| Tono | Estado de punto | Decisión |
|---|---|---|
| Verde (`ok`) | En línea | Aceptado |
| Ámbar (`warn`) | Sin comunicación | Sin respuesta |
| Rojo (`no`) | Lector averiado | Rechazado |
| Morado (`violet`) | En pausa (sin coordinador) | |
| Gris (`mute`) | Sin abrir | |

## 2. Roles

Roles del servicio, nunca asistentes (ADR-006). Definidos en `dominio.Rol` y listados en `comunes.ROLES` en este orden:

| Rol | Uso en la interfaz |
|---|---|
| Supervisor del operador | Rol por defecto. Responsable de incidentes "Puerta sin comunicación" y "Permisos desactualizados"; aprueba redirigir flujo y suspender reingresos; confirma la apertura. |
| Líder técnico | Responsable de "Lector averiado" (acción de credencial), "Falla del coordinador", "Sin enlace con la nube" y "Latencia"; destino de "Escalar". |
| Logística de puerta | Responsable inicial de "Lector averiado". |
| Responsable de cierre | Entrega el informe preliminar; resuelve diferencias y concilia. |
| Líder comercial y financiero | Liquidación y registro del cobro. |

En el prototipo el rol se elige en un selector de la barra superior y solo cambia el autor de acciones y notas, el avatar y el filtro "Asignados a mí". No restringe permisos. Además de los roles aparecen dos autores de sistema: `NEXO` (detección automática) y `Sistema` (transiciones), con avatar "NX".

Taller 3: mantener el selector como identidad de laboratorio (token estático por rol) y registrar el rol como autor en D2. La autorización real por rol, cliente y evento (ADR-009) queda como decisión D8 del plan.

## 3. Armazón (`app.js`)

### 3.1 Riel de navegación

| Sección | Entrada | Ruta | Icono | Contador |
|---|---|---|---|---|
| Operación | Resumen | `#/inicio` | `layout-dashboard` | |
| Operación | Incidentes | `#/incidentes` (activa también en el detalle) | `siren` | incidentes abiertos (estado `nuevo` o `en-curso`) |
| Operación | Puertas | `#/puertas` | `door-open` | |
| Operación | Lector | `#/lector` | `scan-line` | |
| Después del evento | Cierre | `#/cierre` | `file-check-2` | diferencias abiertas |
| Antes del evento | Preparación | `#/preparacion` | `clipboard-check` | controles pendientes, solo si el evento está en preparación |

Al pie: botón Ayuda (abre el modal) y botón Tema (alterna claro y oscuro). Logo "NE**X**O" enlaza a `#/inicio`.

### 3.2 Barra superior

- Migas: "Operación > Resumen del evento", "Operación > Incidentes", "Incidentes > INC-0001", "Operación > Puertas · P-07", "Operación > Lector en puerta", "Después del evento > Cierre y liquidación", "Antes del evento > Preparación y apertura".
- Búsqueda global (atajo `/`, Enter abre el primer resultado, Escape limpia; mínimo 2 caracteres; hasta 7 resultados): puertas por id, nombre o zona (muestra estado visible); incidentes por id o título (prioridad y responsable); boleta por referencia exacta (admitida a qué hora y en qué puerta, anulada o habilitada sin usar). Si el texto tiene forma `TA-dddd-dddd` y no existe: "No existe en este evento: se rechazaría como código desconocido".
- Chip del evento: nombre del recinto, subtítulo según estado ("Fecha 14 · en preparación", "· ingreso abierto" con punto pulsante, "· ventana cerrada") y reloj del evento.
- Campana con el número de incidentes abiertos, enlaza a `#/incidentes`.
- Selector de rol con avatar.
- Título de la pestaña: "<pantalla> · NEXO".

### 3.3 Notificaciones

Toasts en la esquina (`aria-live="polite"`), máximo 3 visibles, 6 s (9 s si el tono es `violet`), con título, texto y enlace opcional "Ver". Tonos: `ok`, `no`, `warn`, `info`, `violet`. Avisos que emite hoy el simulador y que en el taller 3 deben llegar por el canal en vivo: ingreso abierto, ventana cerrada, puerta sin comunicación, sin enlace con la nube, coordinador sin autoridad, puertas operando, "tu decisión es necesaria", "todavía no se puede resolver".

### 3.4 Modal de ayuda (`vistas/ayuda.js`)

Se abre al primer ingreso (salvo que `bienvenidaVista` esté marcado) y desde el riel. Lema: "Una boleta. Una decisión. Un cierre verificable." Tres pestañas:

- Bienvenida: tres pasos (Integrar, Validar, Conciliar), instrucciones de uso, aviso de cifras ficticias y casilla "No volver a mostrar al abrir". Hay que reescribir las instrucciones que hablan de la simulación.
- Glosario: Cliente, Evento, Zona, Punto de validación, Boleta, Intento, Validación, Admisión, Coordinador local, Diario del lector, Buzón, Conciliación, Liquidación, Recompra.
- Pantallas y metas: Resumen (O1, KR1.1, KR1.2, CA2), Incidentes (O1, O2, KR1.3, KR2.2), Puertas (O2, KR2.1, KR2.2), Lector (R1, KR4.1, CA3), Cierre (O4, O5, KR4.3, KR5.1, KR5.3), Preparación (O3, CA1 a CA4). KR5.2 (recompra) no tiene pantalla.

Cierra con Escape, clic en el velo o botón.

### 3.5 Panel Demo (se elimina)

Panel plegable abajo a la derecha: reproducir o pausar, reloj, velocidad (1×, 10×, 30×, 60×) y saltos ("Antes de abrir" 16:20, "Pico de ingreso" 17:50, "Incidentes" 18:00, "Falla del coordinador" 18:23, "Cierre" 20:16, "Reiniciar" con la misma semilla). El propio prototipo dice que "reemplazan al backend y no son parte del producto". En el taller 3 no existe; los escenarios se producen con el generador de carga y `nexo-chaos`.

## 4. Componentes compartidos (`vistas/comunes.js`)

Todas devuelven HTML escapado.

| Componente | Qué muestra |
|---|---|
| `cabecera({kicker, icono, titulo, texto, acciones})` | Encabezado de página con antetítulo, título, explicación y barra de acciones. |
| `tip(texto, meta, izquierda)` | Icono de ayuda con explicación en lenguaje llano y la meta asociada (KR, CA o ADR) en cursiva. |
| `badge(texto, tono, extra)` | Insignia; `badge--live` para pulsante, `badge--sm`, `badge--plain`. |
| `estadoPunto(estado)` | Insignia del estado visible de un punto. |
| `decision(dec, sm)` | Insignia con icono: Aceptado (`circle-check`, ok), Rechazado (`circle-x`, no), Sin respuesta (`circle-pause`, warn). |
| `avatar(autor, grande)` | Iniciales del rol con color por rol; "NX" para NEXO y Sistema; ignora el sufijo "(simulado)". |
| `tipoInc(inc)` | Etiqueta corta, color e icono por tipo de incidente (tabla en la sección 8.1). |
| `estadoInc(inc)` | Nuevo (no, pulsante), En curso (info), Resuelto (ok), Falsa alarma (mute). |
| `slaActuacion(inc, ahora)` | Barra "Actuación": meta de 5 min desde la recepción; tonos info, warn al 70 %, no al vencer; texto "quedan …", "vencida" o la duración real. |
| `slaRecuperacion(inc, ahora)` | Barra "Recuperación" (lector, meta 3 min desde la falla) o "Sincronía" (sin comunicación, meta 5 min desde que vuelve la red; antes muestra "espera red"); si no hay meta, "Abierto hace" o "Resuelto en". |
| `sparkline(valores, alto)` | Línea con área en SVG. |
| `anillo(pct, tam, color)` | Anillo de progreso en SVG. |
| `barra(pct, tono)` | Barra horizontal. |
| `meta(cumple, evaluable)` | "Cumple", "No cumple" o "Sin datos aún". |
| `vacio(icono, titulo, texto)` | Estado vacío ilustrado. |
| `delegar(raiz, acciones)` | Delegación de clics por `data-accion`. |

Clases de CSS reutilizadas en varias pantallas: `card`, `card__head`, `card__body`, `grid--4`, `grid--2`, `grid--main-side`, `stack`, `hero`, `kpi`, `bubble--<tono>`, `notice--<tono>`, `btn`, `btn--primary`, `btn--ok`, `btn--ghost`, `btn--soft`, `btn--sm`, `btn--lg`, `btn--block`, `table`, `kv`, `feed`, `dot--<tono>`, `dot--pulse`, `mono`, `num`, `dim`, `idchip`, `tag--<tono>`, `prio--<id>`, `check`, `acc` (acordeón `<details>`).

## 5. Pantallas

Cada tabla indica la fuente real en el taller 3. "C4" significa la API O2 del núcleo central sobre D2; "C2" es el coordinador local.

### 5.1 Resumen (`#/inicio`, `vistas/pmu.js`)

Pregunta que responde: qué pasa ahora en las 20 puertas y qué necesita atención. Acciones de cabecera: "Probar el lector" y "Incidentes" con contador.

| Bloque | Contenido | Fuente real |
|---|---|---|
| Hero | Frase de estado según prioridad: en preparación ("El ingreso abre a las HH:MM", controles faltantes, botón a Preparación); cerrado ("La ventana de ingreso terminó", botón a Cierre); coordinador sin autoridad ("Ninguna puerta puede aceptar ahora", botón "Decidir ahora"); problemas ("N de 20 puertas validan con normalidad" y lista: Pxx sin comunicación, lector averiado en Pxx, sin enlace con la nube, reingresos suspendidos); normal ("Todo en orden"). Barra de la ventana de ingreso con transcurrido y restante. | Estado del evento, puntos, coordinador, enlace y políticas desde C4. |
| KPI Admisiones | Primeras aceptaciones frente a las estimadas, anillo con porcentaje. | Métrica N1. |
| KPI Decisiones por segundo | Último minuto, total de decisiones y sparkline de 20 minutos. | Serie por minuto en D2. |
| KPI Respuestas en ≤ 500 ms | Porcentaje sobre todas las solicitudes (las sin respuesta cuentan), p95 y número sin respuesta; "Cumple"/"No cumple" frente a 95 %. | Métrica T1; hay que decidir si el rótulo pasa a 300 ms (decisión D7 del plan). |
| KPI Visibles en ≤ 5 s | Decisiones visibles en el panel central en 5 s; las tomadas durante un corte se informan aparte. | Diferencia entre la hora de decisión y la de consolidación en D2. En el prototipo se simula con un aleatorio. |
| Cómo fluye cada decisión | Diagrama en vivo de cuatro nodos y tres enlaces: Lectores (en línea, sin comunicación, averiados, en diarios) → "Consulta síncrona < 500 ms" → Coordinador local (estado, primario, réplica, repuesto o excluidos) → "Evidencia y cambios, asíncrono" → Nube NEXO (buzón, recibidos, corte hace …) → "Permisos y anulaciones, versionados" → Boletería (versión de permisos, antigüedad del último cambio, cambios en camino). Enlaces `on`, `idle` u `off` ("interrumpido"). Insignia "Autoridad única activa" o "Sin autoridad: no se acepta". | Heartbeats, outbox, estado del enlace y versión de permisos reportados a C4. Adaptar el nodo del coordinador a `nodo-unico`. |
| Puertas | Rejilla de 20 fichas (id, punto de estado, nombre corto con color de zona, barra de decisiones por minuto, pie "Sin reporte hace …", "Fuera hace …", "N por sincronizar" o "N / min"); leyenda con conteo por estado. Enlaza a `#/puertas/:id`. | Proyección de puntos en D2. |
| Admisiones por zona | Barra por zona frente a las estimadas; aviso "No indican ocupación del recinto". | Consumos por zona en D2. |
| Ritmo de decisiones | Sparkline de 40 minutos y "N en el último minuto". | Serie por minuto. |
| Requiere tu atención | Aviso de acciones pendientes y hasta 4 incidentes abiertos por prioridad con su barra de actuación. | Incidentes y acciones en D2. |
| Últimas decisiones | 8 filas: hora, puerta, decisión, "Primer ingreso" o motivo. | Últimos intentos en D2. |
| Actividad | 7 entradas de la bitácora general con tono. | Bitácora de actividad en D2. |

### 5.2 Incidentes (`#/incidentes`, `vistas/alertas.js`)

Mesa de incidentes. Cabecera con el indicador KR1.3 "Actuación en < 5 min": incidentes con primera acción antes de 5 min desde la recepción, sobre los que ya actuaron o ya vencieron (los que siguen en plazo no cuentan todavía).

- Contadores que filtran (pestañas): Abiertos (rojo), Asignados a mí (naranja, responsable igual al rol actual), Por vencer (azul, sin actuar y con menos de 2 min de plazo), Destacados (dorado), Resueltos (violeta), Todos (gris).
- Barra: búsqueda por título, puerta o código; filtro por tipo; orden por prioridad (abiertos primero, luego prioridad y recencia), más recientes o vence antes; alternar tarjetas y lista.
- Tarjeta: etiqueta de tipo, prioridad, estado, estrella para destacar, título, lugar (zona > puerta o componente), "hace …", barras de actuación y recuperación, avatar y responsable ("Asignado a ti"), código. Clic abre el detalle.
- Lista: columnas Código, Incidente, Prioridad, Estado, Responsable, Actuación, Recibido.
- Panel lateral: "Acciones pendientes" (título, detalle, botones de la acción, rol, incidente, antigüedad; la línea "Aprobación automática (simulada) en …" se elimina); "Por vencer" (hasta 5 plazos: actuación de incidentes, sincronización o recuperación, informe preliminar, cierre definitivo, apertura); "Decisiones recientes" (5 acciones ya decididas: aprobada, rechazada o caducada, autor y hora; "Quedan en la bitácora; no se editan").
- Filtros persistentes en la sesión.

Acciones: `destacar(id)`, `abrir(id)`, `aprobar(accionId)`, `rechazar(accionId)`.

### 5.3 Detalle del incidente (`#/incidentes/:id`, `vistas/incidente.js`)

- Barra superior: volver, destacar, Tomar, Agregar nota, Escalar, Falsa alarma, Resolver, posición "i de N" y anterior o siguiente.
- Columna principal: cabecera (icono, título, "NEXO lo detectó automáticamente · código · hace …", estado, "Actuación en meta", "fuera de meta", "vencida" o "Sin actuar", tipo); aviso de acción pendiente con sus botones; bitácora de solo adición (autor, verbo según tipo de entrada: "registró el incidente", "agregó una nota", "actuó", "cambió el estado"; hora; texto); compositor de notas con "Las notas no se editan ni se borran".
- Propiedades: estado grande con línea de plazo ("ACTUACIÓN VENCE en …", "EN RECUPERACIÓN", "CERRADO a las … · duró …") y barras; Clasificación (taxonomía cerrada, obligatoria), Prioridad (obligatoria), Responsable (rol), Componente afectado y Recibido (solo lectura); botón Actualizar habilitado solo si hubo cambios.
- Lateral en acordeones: Puerta afectada (estado, lector, credencial, último reporte, en diario, enlace a la puerta) o Componente (coordinador: topología, primario, réplica, excluidos, estado; enlace a la nube: estado, buzón, "al menos una vez", "idempotente"; permisos: versión, antigüedad, tolerable 5 min, reingresos, cambios en camino); Registro de tiempos (recibido, primera acción, recuperado, cerrado; evidencia de KR1.3, KR2.1 y KR2.2); Pasos a seguir con casillas (deshabilitadas si está cerrado); Relacionados (misma puerta o mismo tipo, hasta 4).

Reglas de las acciones:

| Acción | Efecto |
|---|---|
| Tomar | Responsable pasa al rol actual; registra actuación ("Tomó el incidente"). |
| Agregar nota | Entrada `nota` en la bitácora; no detiene el reloj de actuación. |
| Escalar | Sube un nivel de prioridad (baja → media → alta → crítica), responsable Líder técnico, nota "Escalado al líder técnico." |
| Falsa alarma | Actuación, clasificación "Falsa alarma", estado `descartado`; "Sigue contando en el denominador de KR1.3 y se informa aparte". |
| Resolver | Solo si la causa ya no está activa (punto con diario pendiente, lector averiado, coordinador sin autoridad, enlace caído o buzón con registros). Si sigue activa: aviso "Todavía no se puede resolver". |
| Actualizar propiedades | Registra actuación con los campos cambiados. |
| Casilla de paso | Alterna el paso; al marcarlo registra actuación ("Completó "paso""). |

La primera acción o decisión (tomar, actualizar, aprobar o rechazar una acción, descartar, resolver) fija `actuadaEnS`, pasa el estado de `nuevo` a `en-curso` y agrega a la bitácora "Actuación <duración> después de recibirlo (en meta / fuera de la meta de 5 min)".

### 5.4 Puertas (`#/puertas`, `#/puertas/:id`, `vistas/punto.js`)

Sin id muestra `P-07`. Un punto es estable: cambiar su lector no cambia su identidad ni borra sus pendientes.

- Lista lateral con filtro por zona: punto de estado, id, nombre y "N/min" o el estado.
- Cabecera: nombre, estado, insignia "Flujo redirigido" si aplica, id, zonas hacia las que valida y explicación del estado; botón al incidente abierto o conteo de incidentes; botón "Probar en el lector" (fija la puerta en la vista del lector).
- Cuatro cifras: decisiones por minuto con sparkline de 30 min; p95 de respuesta de las últimas 60 decisiones (warn si supera 500 ms); en el diario del lector (pendientes, "sincronizando hace …" o total del evento); último reporte (""sin comunicación" a los 30 s (meta 60 s)").
- Actividad de la puerta: 8 entradas recientes.
- Lector asignado: id, familia, procedencia (Cliente o Alquiler), "Autenticado", credencial, alcance (evento y punto), vigente desde, vence al cerrar el evento, canal "Autenticación mutua"; historial de lectores (lector, desde, hasta, origen) y nota de recuperación si hubo cambio.
- Últimos intentos: 10 filas con hora, identificador de origen, boleta, decisión, motivo ("Primer ingreso · genera admisión"), respuesta en ms y vía.

### 5.5 Lector en puerta (`#/lector`, `vistas/lector.js`)

Lo que ve el operador y por qué. Selector de puerta en la cabecera.

- Teléfono simulado: barra (NEXO, puerta, wifi, hora), puerta y lector con zonas; en reposo "Listo para leer · Acerca un código QR o de barras"; con resultado, pantalla completa ACEPTADO, RECHAZADO o SIN RESPUESTA, subtítulo ("Primer ingreso · puede pasar", "Reingreso · puede pasar", "No permitir el paso", "No permitir el paso · reintentar"), motivo, boleta, zona y tiempo de respuesta; lecturas anteriores; pie "Sin datos personales del asistente".
- Modo: "Mis pruebas" (intentos manuales) o "Tráfico en vivo" (intentos recientes de la puerta).
- Aviso: evento en preparación (con botón para adelantar, que se elimina), ventana cerrada, o puerta no en línea ("Los intentos quedan en el diario del lector y ninguno se acepta").
- Casos de prueba:

| Caso | Resultado esperado |
|---|---|
| Boleta válida | Primer ingreso: se acepta y cuenta como admisión. |
| La misma boleta otra vez | Ya se usó hace menos de 10 min: se rechaza. |
| Boleta de otra zona | No autoriza la zona de esta puerta. |
| Boleta anulada | La boletería la anuló y el cambio ya llegó. |
| Código desconocido | No pertenece al evento; igual se registra. |
| Copia en otra puerta a la vez | El coordinador acepta solo una de las dos. |

- "Cómo decidió el coordinador": pasos en el orden de evaluación de la sección 7, marcando pasados, el que falló y los no evaluados.
- "Qué quedó registrado": identificador de origen, quién decidió, versiones de permisos y políticas, antigüedad de permisos, propósito, si genera cobro, datos del asistente "Ninguno", "90 días, sin cambios"; aviso de uso concurrente o de intento en diario.

Taller 3: cada caso debe enviar una solicitud V1 real a C2 con la credencial de un lector web. El prototipo muta boletas en memoria para fabricar el caso (marca una boleta como anulada, reusa la última); en el sistema real los casos necesitan boletas preparadas en la semilla (válidas sin usar, anuladas con el cambio ya recibido, de otra zona) y el caso "copia" necesita dos solicitudes concurrentes desde dos lectores.

### 5.6 Cierre y liquidación (`#/cierre`, `vistas/cierre.js`)

Solo se declara conciliado con cobertura completa y todas las diferencias resueltas.

- Recorrido de 6 pasos: Ventana cerrada; Registros completos (diarios, buzón y cambios al día); Informe preliminar (máximo 30 min); Diferencias resueltas; Conciliado (máximo 24 h); Saldo cobrado (hasta 30 días después).
- Aviso: ingreso aún abierto o sin empezar (la liquidación es estimada) o "Cierre definitivo conciliado … La evidencia queda archivada 90 días sin cambios".
- Diferencias: tarjetas con título, código, estado, origen, hora de detección, detalle y opciones (la primera es la sugerida) o la resolución agregada ("Resolución agregada: … · rol · hora"); botón "Resolver N con la opción sugerida" si hay más de una abierta. Tipos en la sección 9.
- Cobertura del cierre: puertas que entregaron todo (N / 20), intentos en diarios, decisiones en el buzón, cambios de la boletería en camino, campos completos (meta 99,9 %), registros perdidos (tolerancia cero).
- Conteo de decisiones: barra apilada y líneas de intentos recibidos, admisiones, reingresos, rechazos (desglose otra zona, anuladas, desconocidos, uso repetido) y sin respuesta; aviso de que las boletas habilitadas no se suman.
- Para declarar conciliado: lista de condiciones (sección 9), plazos restantes del preliminar y del definitivo, botones "Entregar informe preliminar" (habilitado con conciliación `en-curso`) y "Declarar conciliado" (habilitado solo en `preliminar` con todas las condiciones).
- Liquidación: cargo por evento, admisiones facturables × 0,40 (menos excluidas en el cierre), importe, anticipo (500 + 50 % de 15.000 estimadas), saldo por cobrar o devolución; fecha límite de cobro a 30 días; costos (trabajo USD 300 más escalación de USD 20 si hubo falla del coordinador), contribución y margen frente a 55 %; aviso de costos fijos de USD 9.050 y tope de trabajo USD 345; botón "Registrar el cobro del saldo". Insignia Estimada, Definitiva o Cobrado.
- Contrato: cliente, contrato, fecha, origen y los tres eventos con estado y monto; línea de recompra.

### 5.7 Preparación y apertura (`#/preparacion`, `vistas/config.js`)

Un control pendiente bloquea la apertura.

- Hero con anillo N/6 y estado: faltan controles (botón "Confirmar apertura" bloqueado), todo listo (botón activo), apertura confirmada, o ingreso ya abierto.
- Controles previos (casillas editables solo en preparación): ver sección 10.
- Puertas listas para abrir: tabla con puerta, zonas, lector y procedencia, compatible, credencial, permisos (versión), lectura de prueba.
- Pruebas de aceptación CA1 a CA4. En el prototipo los resultados están escritos a mano ("p95 de 312 ms", "48 de 48 casos"); en el taller 3 deben salir de las pruebas ejecutadas o mostrarse como pendientes.
- Coordinador del estadio: fichas COORD-A, B y C con su papel, topología "Candidata B", promoción manual, "pausa de 46 s". Hay que adaptarlo a `nodo-unico`.
- Integración con la boletería: adaptador, modelo canónico, instantánea inicial, versión actual, antigüedad tolerable 5 min, identidad del permiso "cliente + evento + boletería + referencia".
- Políticas del evento: reingreso tras 10 min, sin coordinador no se autoriza, permisos atrasados más de 5 min suspenden reingresos, sin datos personales, "NEXO decide; abrir la puerta es del cliente"; versión de políticas.

## 6. Estado que consume la interfaz

Campos del `store` y su origen en el taller 3.

| Campo | Contenido | Origen real |
|---|---|---|
| `evento` | `id`, `nombre`, `nombreCorto`, `recinto`, `boleteria`, `aperturaS`, `cierreS`, `admisionesEstimadas`, `gratuito`, `estado` (`preparacion`, `abierto`, `cerrado`), `versionPermisos`, `ultimoCambioRecibidoS`, `politicas {version, reingresoPermitido, reingresoTrasMin, reingresoSuspendido}` | M1 en D2 |
| `coordinador` | `topologia`, `primario`, `replica`, `repuesto`, `excluidos`, `estado`, `desdeS`, `pausas [{desdeS, hastaS}]` | Heartbeat de C2 hacia C4; reducir a nodo único |
| `puntos[]` | `id`, `nombre`, `zona`, `zonas[]`, `estado`, `ultimaComunicacionS`, `pendientesDiario`, `diarioTotal`, `sincronizandoDesdeS`, `decisionesMinuto`, `serie[30]`, `latencias[60]`, `recientes[12]`, `averiadoDesdeS`, `redirigido`, `recuperacionS`, `preparacion {lector, credencial, zonas, version, prueba}`, `lectores[] {id, familia, procedencia, credencial, desdeS, hastaS}`, `actividad[] {t, tipo, texto}` | Proyección de puntos en D2 alimentada por H1 y E1 |
| `boletas` | búsqueda por referencia: `ref`, `zona`, `consumidaEnS`, `consumidaEnPunto`, `ultimoUsoS`, `anulacion {emitidaEnS, recibidaEnS}`, `excluida`; total | M1 y consumos consolidados en D2 (consulta por referencia, no lista completa) |
| `ahoraS` | reloj del evento en segundos desde medianoche | Reloj real del servidor |
| `rol` | rol actual | Sesión de laboratorio |
| `nube` | `enLinea`, `caidaDesdeS`, `buzon`, `enviados` | Último lote E1 recibido y tamaño del outbox reportado |
| `integracion` | `enLinea`, `enTransito[]` | Estado de C3 y de la boletería simulada |
| `intentos[]` | recientes: `id` (idOrigen), `ref`, `zona`, `puntoId`, `lector`, `t`, `decision`, `motivo`, `proposito`, `admision`, `concurrente`, `latenciaMs`, `evidencia {via, versionPermisos, versionPoliticas, antiguedadPermisosS}`, `enDiario`, `manual` | M2 en D2 |
| `conteo` | `intentos`, `decisiones`, `aceptados`, `admisiones`, `reingresos`, `rechazados`, `desconocidos`, `zonaIncorrecta`, `anuladas`, `concurrentes`, `usoRegistrado`, `sinRespuesta`, `camposCompletos` | Agregados en D2 |
| `admisionesPorZona` | por nombre de zona | Agregado en D2 |
| `serie[40]` | `{minuto, decisiones}` | Agregado por minuto |
| `metricas` | `dps`, `p95Ms`, `solicitudes`, `enPlazo`, `visiblesTotal`, `visiblesEnPlazo`, `duranteCorte`, `sincronizaciones[] {puntoId, pendientes, duracionS}` | Métricas N y T; también en Grafana |
| `incidentes[]` | ver sección 8 | C4 |
| `acciones[]` | ver sección 8.2 | C4 |
| `actividad[40]` | `{t, texto, tono}` | C4 |
| `lector` | `puntoId`, `ultima`, `ultimaBoleta`, `historial`, `manuales` | Estado local de la vista más respuestas de C2 |
| `preparacion` | `confirmada`, `controles[] {id, titulo, ok, detalle}` | C4 |
| `conciliacion` | `estado` (`sin-iniciar`, `en-curso`, `preliminar`, `conciliado`), `preliminarEnS`, `definitivoEnS`, `diferencias[]`, `saldoCobrado` | M3 en D2 |

Datos fijos (`modelo/datos.js`) que deben quedar como semilla en D2:

- Cliente `CLI-001` "Club Deportivo Cordillera (ficticio)"; recinto `REC-01` "Estadio Cordillera", capacidad 20.000; boletería `BOL-01` "TaquillaAndina", "Adaptador TaquillaAndina v2.3", "Modelo canónico de permisos v1".
- Contrato `CT-2026-014`, acordado el 20 ago. 2026, "Acuerdo nuevo · piloto de tres eventos", tarifa USD 500 + USD 0,40. Eventos: `EVT-2026-01` "Fecha 12 · Cordillera vs. Andes FC", 30 ago. 2026, pagado, liquidado, 14.212 admisiones, anticipo 3.500, cobrado 6.184,80, costos 318; `EVT-2026-02` "Fecha 14 · Cordillera vs. Real Pacífico", 16 sep. 2026, pagado, en curso; `EVT-2026-03` "Fecha 16 · Cordillera vs. Unión Norte", 4 oct. 2026, gratuito, programado, tope de costos 600. Recompra: "Ventana de 60 días abierta desde el 30 ago. 2026".
- Evento en curso: apertura 17:00, cierre 20:15, 15.000 admisiones estimadas, permisos v37, políticas v2 con reingreso tras 10 min.
- Zonas (boletas / estimadas / color): Norte 4.980 / 4.600 / z1; Sur 3.360 / 3.100 / z2; Oriental 4.010 / 3.700 / z3; Occidental 3.360 / 3.100 / z4; Palcos 530 / 500 / z5. Total 16.240 boletas.
- Puntos `P-01` a `P-20`: Norte 1 a 5, Sur 6 a 9, Oriental 10 a 14, Occidental 15 a 18, Palcos 19 y 20; nombre "Puerta <zona> <n>"; `P-01` y `P-07` validan además hacia Palcos. Lector `LX-2210-<100 + 7i>` familia "Zebra TC21", procedencia Cliente para 1 a 14 y Alquiler para 15 a 20, credencial `CRED-P-xx-A`. Repuestos `LX-2210-0447` y `LX-2210-0452`.
- Referencias de boleta `TA-88dd-dddd` (técnicas, no identifican a nadie). Hasta 0,5 % se anulan durante el evento.

## 7. Enumerados, umbrales y reglas de decisión

Decisión: `aceptado`, `rechazado`, `sin-respuesta` (nunca equivale a aceptación).

Motivos (texto visible):

| Clave | Texto |
|---|---|
| `PERMISO_VIGENTE` | Permiso vigente para esta puerta y horario |
| `REINGRESO_AUTORIZADO` | Reingreso autorizado por la política del evento |
| `ZONA_NO_AUTORIZADA` | La boleta no autoriza la zona de esta puerta |
| `BOLETA_ANULADA` | Boleta anulada por la boletería |
| `FUERA_DE_HORARIO` | Fuera de la ventana de ingreso |
| `USO_YA_REGISTRADO` | Uso ya registrado; reingreso no permitido todavía |
| `USO_CONCURRENTE` | Otra puerta consumió esta boleta en el mismo instante |
| `REINGRESO_SUSPENDIDO` | Reingresos suspendidos: permisos desactualizados |
| `CODIGO_DESCONOCIDO` | Código desconocido para este evento |
| `SIN_COORDINADOR` | Sin respuesta del coordinador local |
| `PUNTO_SUSPENDIDO` | Punto fuera de servicio |

Estado visible de un punto (`estadoVisible`), en este orden: `sin-abrir` si el evento está en preparación; `averiado` si el lector está averiado; `en-pausa` si el coordinador no está operando; `sin-comunicacion` si no reporta desde hace 30 s o más (latido cada 10 s; la meta KR1.2 es 60 s); si no, `en-linea`. Textos y tonos: En línea (ok), Sin comunicación (warn), Lector averiado (no), En pausa (violet), Sin abrir (mute).

Estado del coordinador: `operando`, `sin-autoridad`, `protegiendo`. En el prototipo, tras promover la réplica hay 15 s de protección síncrona antes de volver a aceptar, y la pausa total se mide (D-09); con `nodo-unico` esa fase no existe.

Orden de evaluación de una validación (`dominio.decidir`, mostrado en la vista del lector):

1. ¿El lector alcanzó al coordinador? Punto averiado: sin respuesta, "Punto fuera de servicio". Sin comunicación o coordinador sin autoridad: sin respuesta, "Sin respuesta del coordinador local", vía "Diario del lector".
2. ¿El código pertenece al evento? Si no: rechazo, código desconocido (se registra sin fabricar boleta).
3. ¿La boleta sigue vigente? Anulación ya recibida: rechazo.
4. ¿Autoriza la zona de esta puerta? Si no: rechazo.
5. ¿Está dentro de la ventana de ingreso? Si no: rechazo.
6. ¿Es su primer uso? Consumida hace menos de 3 s: uso concurrente. Sin reingreso permitido: uso ya registrado. Reingresos suspendidos: rechazo. Último uso hace menos de 10 min: uso ya registrado. Si no: acepta como reingreso, sin admisión.
7. Acepta y consume el ingreso en una sola transacción; genera admisión. Si la anulación existía pero no había llegado, se acepta y se marca "anulación en tránsito" para conciliar.

Evidencia de cada decisión: vía ("Coordinador COORD-A" o "Diario del lector"), versión de permisos, versión de políticas, antigüedad de permisos.

En el taller 3 esta lógica vive en C2 (el dominio de T10 del plan). La vista solo muestra la respuesta. La regla de "uso concurrente" basada en 3 s es una aproximación del prototipo: en el sistema real el rechazo concurrente sale de la unicidad transaccional.

Umbrales (`dominio.Umbral`): sin comunicación 60 s; detección 30 s; visibilidad 5 s al 95 %; sincronización 300 s al 99,5 %; recuperación de punto 180 s; actuación 300 s al 80 %; latencia 500 ms al 95 %; trazabilidad 99,9 %; rechazos incorrectos 0,5 %; preliminar 1.800 s; definitivo 86.400 s; auditoría 90 días; antigüedad tolerable de permisos 300 s; reingreso tras 600 s; cobro de saldo 30 días.

Tarifa (`dominio.Tarifa`): importe = 500 + 0,40 × admisiones (0 si es gratuito); anticipo = 500 + 0,5 × 0,40 × estimadas; contribución = importe - costos; trabajo por evento 300, tope 345. En el taller 3 los importes se calculan con decimal (PB-18).

## 8. Incidentes

Estructura: `id` (`INC-0001`…), `tipo`, `clasificacion`, `prioridad`, `puntoId`, `componente`, `zona`, `titulo`, `descripcion`, `responsable`, `estado` (`nuevo`, `en-curso`, `resuelto`, `descartado`), `recibidaEnS`, `actuadaEnS`, `resueltaEnS`, `recuperadaEnS`, `metaRecuperacionS`, `relojDesdeS` (KR2.2 mide desde la falla; KR2.1 desde que vuelve la comunicación), `destacado`, `checklist[] {texto, hecho}`, `bitacora[] {t, autor, tipo: sistema | nota | accion | estado, texto}`. El campo `autoEnS` (actuación del personal simulado) se elimina.

Taxonomía cerrada "v1 · fijada antes del piloto". Prioridades: Crítica, Alta, Media, Baja.

### 8.1 Tipos, detección y respuesta

| Tipo | Etiqueta, color, icono | Se abre cuando | Prioridad y responsable | Meta | Pasos a seguir | Acción | Se resuelve cuando |
|---|---|---|---|---|---|---|---|
| Puerta sin comunicación | Conexión, warn, `wifi-off` | El punto lleva 30 s o más sin reportar | Alta, Supervisor | Sincronía 5 min desde que vuelve la red | Redirigir el flujo a las puertas vecinas; Revisar el enlace de red de la puerta; Confirmar la sincronización del diario | Redirigir el flujo (Redirigir / Posponer), rol Supervisor | El diario del punto queda en cero; si vuelve la red antes de actuar, la acción caduca |
| Lector averiado | Lector, no, `smartphone` | Logística reporta el lector averiado | Alta, Logística de puerta | Recuperación 3 min desde la falla | Retirar el lector averiado; Instalar el repuesto preparado; Emitir credencial individual para el punto; Probar una lectura correcta | Emitir credencial al repuesto (Emitir credencial / Rechazar), rol Líder técnico, decisiva | Repuesto instalado con credencial nueva y primera validación correcta |
| Falla del coordinador | Coordinador, no, `server` | El coordinador pierde la autoridad | Crítica, Líder técnico | Sin meta fija (la pausa se mide aparte) | Aislar el primario; Promover la réplica; Incorporar el repuesto como réplica síncrona; Confirmar que las puertas reanudan | Promover réplica (Promover / Rechazar), rol Líder técnico, decisiva | Autoridad restablecida; se informa la pausa |
| Sin enlace con la nube | Nube, info, `cloud-off` | Se corta el enlace recinto-nube | Alta, Líder técnico | Sin meta | Confirmar que las puertas siguen validando; Escalar al proveedor de conectividad; Vigilar la antigüedad de los permisos; Verificar el vaciado del buzón | Ninguna | Vuelve el enlace y el buzón queda en cero |
| Permisos desactualizados | Permisos, gold, `key-round` | Más de 5 min sin cambios de la boletería | Media, Supervisor | Sin meta | Decidir si se suspenden los reingresos; Informar a los operadores de puerta; Confirmar la llegada de los cambios | Suspender reingresos (Suspender / No aplicar), rol Supervisor | Llegan los cambios; se reanudan los reingresos |
| Latencia sobre el umbral | Latencia, violet, `gauge` | Una validación supera 1.150 ms (máximo una alerta cada 15 min) | Baja, Líder técnico | Sin meta | Revisar el enlace inalámbrico de la puerta; Comparar con la latencia de las puertas vecinas | Ninguna | Manual |
| Falsa alarma | Falsa alarma, mute, `eye-off` | Solo por clasificación manual | | | | | |

Con `nodo-unico` la falla del coordinador no tiene réplica que promover: la acción "Promover" y los pasos de réplica deben cambiar por "Reiniciar el coordinador y verificar consumos" o eliminarse (decisión pendiente del plan). Para los fallos del taller 3 conviene revisar si hacen falta tipos para "Persistencia local indisponible" (BD-01) y "Observabilidad caída" (SER-06); agregarlos cambia la taxonomía v1 y debe documentarse.

### 8.2 Acciones pendientes

Estructura: `id` (`ACC-n`), `tipo` (`redirigir`, `credencial`, `promover`, `reingresos`, `preliminar`), `titulo`, `detalle`, `si` (texto del botón de aprobar), `no` (texto del botón de rechazar, opcional), `rol`, `incidenteId`, `enlace`, `decisiva`, `estado` (`pendiente`, `aprobada`, `rechazada`, `caducada`), `creadaEnS`, `decididaEnS`, `autor`, `nota`.

| Tipo | Si se aprueba | Si se rechaza |
|---|---|---|
| `redirigir` | Marca el punto como "Flujo redirigido" a las dos puertas vecinas de la misma zona | Pospone; se crea una copia pendiente |
| `credencial` | Cierra la asignación del lector anterior, instala el repuesto con `CRED-P-xx-B` y recupera el punto | La puerta sigue fuera de servicio; nueva copia pendiente |
| `promover` | Excluye al primario, promueve la réplica y pasa a `protegiendo` | Mantiene la pausa; nueva copia pendiente |
| `reingresos` | `reingresoSuspendido = true` | Registra "decisión justificada" de no suspender |
| `preliminar` | Entrega el informe preliminar (creada al cerrar la ventana, rol Responsable de cierre, sin botón de rechazo) | |

Aprobar o rechazar cuenta como actuación del incidente. Una acción queda `caducada` cuando su causa desaparece. Se eliminan: la aprobación automática (`autoEnS`), el "personal simulado" y la reducción de velocidad de la demo.

Por qué son acciones y no automatismos (D-19): emitir la credencial del repuesto (ADR-008, autorización del dispositivo), suspender reingresos (ADR-010, restricción acordada con el cliente) y promover la réplica (ADR-005, promoción manual para no tener dos autoridades) están reservadas a una persona porque automatizarlas sería decidir por el negocio. "Redirigir el flujo" se presenta igual como acción pendiente. El taller 3 debe conservar esa regla: C4 propone la acción y solo una persona la aprueba.

En el taller 3 las acciones que dependen de una réplica o de un repuesto físico no tienen efecto real en el laboratorio; deben registrar la decisión en D2 y, si aplica, disparar la acción de laboratorio correspondiente (por ejemplo, volver a habilitar un lector emulado con credencial nueva).

## 9. Conciliación

Estructura de una diferencia: `id` (`DIF-001`…), `tipo`, `titulo`, `origen`, `detalle`, `casos`, `referencia`, `intentoId`, `opciones[] {id, texto, nota}`, `estado` (`abierta`, `resuelta`), `detectadaEnS`, `resolucion`, `resueltaPor`, `resueltaEnS`.

| Tipo | Se crea cuando | Opciones |
|---|---|---|
| `anulacion` | Llega una anulación de una boleta que ya había sido aceptada antes de recibirla. Título "<ref> aceptada antes de recibir su anulación"; origen "Integración con la boletería". | "Excluir del cobro" (no cuenta como admisión facturable; marca la boleta como excluida) o "Mantener la admisión" (solo si el cliente lo acuerda por escrito) |
| `diario` | Termina un episodio (corte de un punto o pausa del coordinador) y sus diarios ya se sincronizaron. Título "N intentos sin decisión confirmada". | "Registrar sin aceptación" (no generan admisión ni cobro) |

Resolver agrega la resolución; nunca borra la diferencia ni el intento.

Condiciones para declarar conciliado (`condicionesCierre`): ventana de ingreso cerrada; diarios de los 20 lectores sincronizados; todas las decisiones llegaron a la nube (buzón vacío y enlace arriba); cambios de la boletería al día; informe preliminar entregado; todas las diferencias resueltas. Declarar exige además estado `preliminar`.

Ciclo: al cerrar la ventana, el evento pasa a `cerrado`, la conciliación a `en-curso` y se crea la acción "Entregar el informe preliminar". Entregar lo pasa a `preliminar`; declarar, a `conciliado`; registrar cobro fija `saldoCobrado`.

Liquidación (`liquidacion`): excluidas = boletas consumidas y marcadas excluidas; facturables = admisiones - excluidas; importe, anticipo y saldo según la tarifa; costos = 300 + 20 si hubo incidente de coordinador; contribución y margen = (importe - costos) / importe.

## 10. Preparación

Controles previos (`preparacion.controles`); dos empiezan pendientes:

| id | Título | Detalle | Inicial |
|---|---|---|---|
| `permisos` | Boletas y reglas verificadas | Instantánea de 16.240 permisos y cambios hasta v37 instalados en el coordinador; 48 de 48 casos de reglas correctos. | Confirmado |
| `contingencia` | Conectividad y contingencia acordadas | Sin coordinador no se autoriza; con permisos de más de 5 min se suspenden reingresos; responsables por rol. | Confirmado |
| `reemplazo` | Puntos y repuestos probados | 20 puntos con lector y credencial; faltan los repuestos LX-2210-0447 y LX-2210-0452. | Pendiente |
| `integridad` | Integridad comprobada | Copias simultáneas: una sola aceptación; promoción ensayada con pausa de 46 s y ningún consumo perdido. | Confirmado |
| `privacidad` | Seguimiento exclusivo a la boleta | La integración descarta nombres, documentos, contactos, pagos y biometría antes de guardar, también en diarios y respaldos. | Confirmado |
| `adicionales` | Adicionales aceptados por el cliente | Alquiler de 6 lectores y soporte remoto; presencia en sitio no contratada. | Pendiente |

Confirmar la apertura exige los seis controles y queda en la actividad con el rol. En el prototipo, si al llegar las 17:00 faltan controles, el "supervisor simulado" los marca solo; en el taller 3 eso se elimina y la apertura depende de la confirmación real. Los detalles que citan resultados (48 de 48, 46 s) deben reemplazarse por la evidencia de las pruebas del taller 3.

## 11. Qué se elimina o cambia al conectar con el backend

| En el prototipo | En el taller 3 |
|---|---|
| `simulador.js` como capa de aplicación | `api.js`: carga inicial por REST, actualizaciones por SSE, acciones por `POST`; reconexión que recupera el estado completo (T2 §5.4, O2). |
| Guion de incidentes por minuto | Reglas de detección en C4 sobre datos reales (sección 8.1). |
| Generación de intentos, latencias y visibilidad aleatorias | Intentos reales de los lectores emulados; latencia medida en el lector; visibilidad calculada en D2. |
| Panel Demo, velocidades, saltos, reinicio con semilla | Se eliminan. |
| Botones "Adelantar la demo…" en Resumen, Lector, Cierre y Preparación | Se eliminan o se reemplazan por un aviso. |
| Personal simulado y aprobación automática | Se eliminan; si nadie actúa, el reloj de KR1.3 sigue corriendo. |
| Coordinador con primario, réplica y repuesto | Nodo único; mostrar estado y pausas medidas. |
| Casos del lector que mutan boletas | Boletas de prueba en la semilla y solicitudes V1 reales. |
| Resultados CA1 a CA4 escritos a mano | Resultados de las pruebas del repositorio o "Sin datos aún". |
| Fecha fija de vencimiento del saldo (16 sep. 2026 + 30 días) | Fecha de conciliación real + 30 días. |
| Reloj del evento simulado | Reloj real; el evento de demo se programa con apertura y cierre cercanos a la hora de la presentación. |

## 12. API que necesita la interfaz

Borrador derivado de las pantallas; completa la sección 3.3 de [taller3.md](taller3.md).

| Método y ruta | Uso | Pantallas |
|---|---|---|
| `GET /api/eventos/actual/estado` | Evento, políticas, coordinador, enlace, integración, conteos, métricas, series, admisiones por zona, conciliación, preparación | Todas |
| `GET /api/puntos`, `GET /api/puntos/{id}` | Lista y detalle con lectores, actividad, recientes, latencias y serie | Resumen, Puertas, Lector, Preparación |
| `GET /api/intentos?limite=&puntoId=` | Últimas decisiones | Resumen, Puertas, Lector |
| `GET /api/boletas/{ref}` | Búsqueda global | Barra superior |
| `GET /api/incidentes`, `GET /api/incidentes/{id}` | Bandeja y detalle con bitácora y checklist | Incidentes, detalle, Resumen |
| `POST /api/incidentes/{id}/acciones` | `tomar`, `nota`, `escalar`, `descartar`, `resolver`, `actualizar {clasificacion, prioridad, responsable}`, `destacar`, `checklist {indice}` | Detalle, bandeja |
| `GET /api/acciones`, `POST /api/acciones/{id}` | Acciones pendientes y decisión `{aprobar: true / false}` | Incidentes, detalle, Resumen |
| `GET /api/actividad` | Bitácora general | Resumen |
| `POST /api/preparacion/controles/{id}`, `POST /api/preparacion/confirmar` | Alternar control y confirmar apertura | Preparación |
| `POST /api/cierre/preliminar`, `POST /api/cierre/definitivo`, `POST /api/cierre/diferencias/{id}` `{opcion}`, `POST /api/cierre/cobro` | Ciclo de cierre | Cierre |
| `GET /api/liquidacion` | Liquidación calculada en M4 | Cierre |
| `GET /api/contrato` | Contrato y eventos | Cierre |
| `GET /api/stream` (SSE) | Eventos `estado`, `intento`, `incidente`, `accion`, `aviso`, `diferencia` | Todas |
| `POST /v1/validaciones` en C2 | Casos de prueba del lector con credencial de lector web | Lector |

Todas las acciones se registran con el rol como autor, en tablas de solo adición cuando son bitácora (ADR-004).

## 13. Diferencias con otros entregables a resolver

- Topología: el prototipo usa la candidata B de ADR-005 (primario con réplica síncrona); la configuración de NEXO_04 y el plan usan `nodo-unico`.
- Reingresos: el prototipo los acepta tras 10 min y los suspende con permisos atrasados; el caso de uso de clases y secuencia los excluye. Decidir si el taller 3 los implementa o los oculta.
- Latencia: el prototipo muestra 500 ms; el entregable 08 fija 300 ms al 95 % (decisión D7 del plan).
- Detección de "sin comunicación" a los 30 s: cumple la meta de 60 s de KR1.2; mantenerla.
- La vista del lector y el diagrama dicen "Consulta síncrona < 500 ms" y "Autenticación mutua": solo son ciertos si se implementan V1 con mTLS (decisión D8).
- Varias cifras de Preparación y del contrato son ficticias; deben venir de la semilla o de evidencia real.

## 14. Principios, bloqueos e invariantes

### 14.1 Principios de diseño

- Mesa de ayuda (D-02): O1 y O2 se miden como plazos (actuar en 5 min, recuperar en 3, sincronizar en 5), que es la forma de un ticket con SLA. Por eso la operación es una bandeja de incidentes con responsable, prioridad y plazo, y una ficha de detalle. Referencias visuales del equipo: Freshdesk y un panel tipo "My Work". Se descartó un tablero de alarmas sin responsable ni plazo.
- La lógica obedece al dominio y a los ADR, no solo la apariencia (D-03). La versión anterior del prototipo contradecía ADR-002 y ADR-003 con un "modo local" en el que cada lector aislado decidía solo y producía aceptaciones dobles (alternativa ADR-002-A04, descartada). No reintroducir ninguna forma de decisión en el lector ni en el navegador.
- Primero una frase, los códigos van a las ayudas (D-21): cada pantalla abre con su propósito y el Resumen con una frase de estado ("18 de 20 puertas validan con normalidad"). Los códigos KR y CA salieron de los títulos y viven en los `tip`. La versión anterior era difícil de entender; por eso existen la bienvenida con glosario, el diagrama en vivo del flujo y, en el lector, las siete preguntas de la decisión con check o X.
- El panel Demo está separado del producto (D-24) porque antes la barra de simulación se confundía con una función. En el taller 3 desaparece (sección 3.5).
- Capas (D-26): `modelo/` (dominio) ← `simulador.js` (aplicación) ← `vistas/` (presentación); las vistas nunca evalúan reglas. En el taller 3 la capa de aplicación es C4 o C2 y el navegador solo presenta.

### 14.2 Bloqueos intencionales (D-22)

Son criterios de aceptación del panel del taller 3; cada uno debe comprobarse también en el servidor, no solo deshabilitando un botón.

| N.º | La interfaz no permite | Regla | Dónde se verifica en el taller 3 |
|---|---|---|---|
| 1 | Resolver un incidente mientras su causa sigue activa | D-22 (resolver no borra el problema) | C4 rechaza `resolver` si la condición de la sección 5.3 sigue vigente |
| 2 | Declarar conciliado con diferencias abiertas o registros pendientes | "Regla 7" del prototipo (RN-08) | M3 evalúa las seis condiciones de la sección 9 antes de aceptar `definitivo` |
| 3 | Abrir el ingreso con controles previos pendientes | Tabla 11 del taller 1 | C4 rechaza `confirmar` con controles pendientes; sin "supervisor simulado" |
| 4 | Ver la identidad del portador | R1, ADR-006 | El dato no existe en ningún esquema, log ni traza |
| 5 | Editar o borrar una nota de la bitácora | ADR-004 | Tablas de bitácora de solo adición (trigger que bloquea UPDATE y DELETE) |

### 14.3 Invariantes (no cambiar sin revisar los ADR)

| N.º | Invariante del prototipo | Forma en el taller 3 |
|---|---|---|
| 1 | Solo `js/modelo/dominio.js` decide si una boleta entra | Solo el dominio de C2 decide. El panel no evalúa reglas; la vista del lector envía V1 a C2 y muestra la respuesta. |
| 2 | Un intento sin respuesta nunca se cuenta como aceptación | `sin-respuesta` no genera consumo, admisión ni cobro; cuenta en el denominador de N2 y T1. |
| 3 | Una boleta genera como máximo una admisión por evento | Unicidad de la clave de consumo en D1 (ADR-003). |
| 4 | La nube nunca autoriza un ingreso | C4 no expone ningún endpoint de validación. La vista del lector llega a C2 directamente (en Minikube, por un servicio del namespace del recinto), no a través de C4. |
| 5 | Ningún registro contiene datos personales del asistente | Aplica también a logs, trazas, métricas y respaldos (T2 §8.4). |
| 6 | La bitácora y las decisiones emitidas nunca se sobrescriben | Solo adición en D1 y D2; las resoluciones se agregan. |

## 15. Reglas de medición (D-17)

Las usan las barras de plazo, los KPI y las métricas del taller 3 (T41). Aplican igual en el panel y en Grafana.

| Indicador | Regla |
|---|---|
| CA2, respuesta en plazo | Las solicitudes sin respuesta cuentan como fuera de plazo (ADR-013). Umbral visible 500 ms en el prototipo; 300 ms en el taller 3 con el p95 frente a 500 (D11 del plan). |
| KR1.1, visible en 5 s | Las decisiones tomadas durante un corte del enlace se informan aparte ("N durante el corte, aparte"); no se ocultan ni se mezclan. |
| KR1.2, sin comunicación | Se muestra a los 30 s (latido cada 10 s, tres perdidos); la meta permite hasta 60 s. |
| KR1.3, actuación en menos de 5 min | El reloj corre desde la recepción del incidente, no desde que alguien lo abre. Solo cuentan en el denominador los incidentes ya actuados o con el plazo vencido. Las falsas alarmas siguen en el denominador. |
| KR2.1, sincronización en 5 min | El reloj empieza cuando vuelve la comunicación ("espera red" antes). |
| KR2.2, recuperación en 3 min | El reloj empieza con la falla. |

## 16. Supuestos del prototipo por validar

Valores que los documentos dejaban abiertos y que el prototipo fijó para funcionar. Ninguno es un resultado.

| ID | Supuesto | Dónde | Tratamiento en el taller 3 |
|---|---|---|---|
| S-01 | Reingreso permitido 10 min después del último uso | `Umbral.REINGRESO_MIN_S` | No se implementa reingreso (D10 del plan); política `reingresoPermitido = false`. |
| S-02 | Antigüedad tolerable de permisos: 5 min | `Umbral.ANTIGUEDAD_PERMISOS_S` | Se conserva como parámetro de configuración y se declara supuesto. |
| S-03 | "Sin comunicación" a los 30 s con latido cada 10 s | `Umbral.DETECCION_S` | Se conserva; el heartbeat de los lectores emulados usa 10 s (métrica T3). |
| S-04 | Escalación de USD 20 en los costos del evento | `liquidacion()` | Cifra ilustrativa; en M4 los costos del evento se registran como dato, no se deducen de un incidente. |
| S-05 | Topología B del coordinador (primario, réplica síncrona, repuesto) | `crearCoordinador()` | Se reemplaza por `nodo-unico` (D9 del plan). |
| S-06 | Horarios del guion de fallas | `GUION` | Se elimina el guion. Cifras como el 97 % de respuestas en plazo eran consecuencia del guion y no se citan como resultados; el informe del taller 3 solo cita valores medidos. |
| S-07 | Nombres ficticios: Club Deportivo Cordillera, Estadio Cordillera, TaquillaAndina, lectores Zebra TC21 | `datos.js` | Se conservan en la semilla y se rotulan como ficticios. |

## 17. Guion del prototipo y su equivalente en el taller 3

El prototipo reproducía cinco fallas con semilla fija (arranque 17:52, velocidad 30×). En el taller 3 no hay guion: cada situación se provoca con el generador de carga o con `nexo-chaos` y el panel la muestra porque está en D2.

| Hora en el prototipo | Falla | Prueba | Cómo se produce en el taller 3 |
|---|---|---|---|
| 18:01 a 18:10 | P-16 pierde comunicación con el coordinador | KR1.2, KR2.1 | Detener un lector emulado o cortar su tráfico hacia C2 (RED-02, EXP 02). No es uno de los cuatro fallos; queda como escenario de reserva. |
| 18:04 | Se avería el lector de P-11 | KR2.2, ADR-008 | Retirar un lector emulado y darle de alta a un repuesto con credencial nueva (requiere T25). Fuera de los cuatro fallos. |
| 18:06 a 18:15 | Cae el enlace del estadio con la nube | ADR-002, ADR-011 | F1 (RED-01): Toxiproxy corta el enlace recinto-central. |
| Hacia las 18:11 | Los permisos superan 5 min sin cambios | ADR-010 | Consecuencia de F1: sin enlace, C2 no recibe P2 y los permisos envejecen. Para verlo el corte debe durar más de 5 min (la corrida de evidencia de 15 min lo cubre). Con D10 no hay acción de suspender reingresos. |
| 18:24 | Falla el coordinador primario | ADR-005 | F3 (BD-01) deja a C2 sin autoridad y abre "Falla del coordinador" (D9); la caída del proceso de C2 se prueba en EXP 03. |
| No existe | Caída de observabilidad | ADR-013 | F2 (SER-06); no abre incidente en el panel (D12), su alerta va por Grafana. |
| No existe | Saturación de CPU del coordinador | REC-01 | F4; puede abrir "Latencia sobre el umbral" si una validación supera el umbral del incidente. |

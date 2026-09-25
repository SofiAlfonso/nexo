---
version: alpha
name: NEXO
description: >
  Sistema de diseño del panel de operación C5 de NEXO, control de acceso B2B para estadios.
  Mesa de ayuda sobria con marca azul noche y cian; el color solo comunica estado.
  Tomado del prototipo del entregable 07 (taller2/NEXO_07_Prototipo, copiado en src/central-core/web/) y de prototipo.md.
source:
  prototype: src/central-core/web/index.html
  stylesheets: [css/tokens.css, css/base.css, css/layout.css, css/components.css, css/screens.css]
  spec: docs/context/prototipo.md
themes: [light, dark]
colors:
  light:
    bg: "#F2F4F9"
    surface: "#FFFFFF"
    surface-2: "#F7F8FB"
    surface-3: "#EDF0F6"
    line: "#E4E8F0"
    line-2: "#D3D9E5"
    ink: "#172033"
    ink-2: "#4A556B"
    ink-3: "#8A94A8"
    brand: "#0B1266"
    brand-2: "#1E2C93"
    brand-ink: "#FFFFFF"
    cyan: "#38C6F4"
    accent: "#2F6BFF"
    accent-2: "#1F56E0"
    accent-soft: "#E9F0FF"
    accent-ink: "#FFFFFF"
    ok: "#148F5E"
    ok-soft: "#E3F5EC"
    no: "#D2463E"
    no-soft: "#FCEBEA"
    warn: "#C9780F"
    warn-soft: "#FDF1E1"
    violet: "#6F4FD8"
    violet-soft: "#EFEAFD"
    info: "#2F6BFF"
    info-soft: "#E9F0FF"
    mute: "#7C879C"
    mute-soft: "#EEF1F6"
    t-red: "#D96A5F"
    t-orange: "#DB8752"
    t-blue: "#6E90DD"
    t-gold: "#BF9F45"
    t-violet: "#A493E4"
    t-gray: "#BCC3D1"
    z1: "#2F6BFF"
    z2: "#22B5E6"
    z3: "#7A5AE0"
    z4: "#E0921E"
    z5: "#169C66"
    rail-a: "#0B1266"
    rail-b: "#1D2B8F"
    rail-ink: "rgba(255,255,255,.72)"
    rail-hover: "rgba(255,255,255,.08)"
    rail-active: "rgba(255,255,255,.16)"
    sim: "#0F172A"
    sim-ink: "#E2E8F0"
  dark:
    bg: "#0B101B"
    surface: "#131A29"
    surface-2: "#182132"
    surface-3: "#1F2A3E"
    line: "#243049"
    line-2: "#33405C"
    ink: "#E7EBF4"
    ink-2: "#A8B2C6"
    ink-3: "#6F7B93"
    accent: "#5B8CFF"
    accent-2: "#7AA2FF"
    accent-soft: "#19284B"
    accent-ink: "#0B101B"
    ok: "#3CC98C"
    ok-soft: "#0F2E24"
    no: "#F2766C"
    no-soft: "#3A1D1F"
    warn: "#F0A447"
    warn-soft: "#392A14"
    violet: "#A68DF6"
    violet-soft: "#271F45"
    info: "#5B8CFF"
    info-soft: "#19284B"
    mute: "#7C889F"
    mute-soft: "#1F2839"
    t-red: "#C4584E"
    t-orange: "#C77440"
    t-blue: "#5677C4"
    t-gold: "#A68936"
    t-violet: "#7E6BC6"
    t-gray: "#4A556B"
    rail-a: "#070B3F"
    rail-b: "#121C66"
typography:
  fontFamily:
    body: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    mono: '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace'
  base:
    fontSize: 14px
    lineHeight: 1.5
    fontFeatureSettings: '"cv11", "ss01"'
  page-title:
    fontSize: 24px
    fontWeight: 700
    letterSpacing: -0.02em
  kicker:
    fontSize: 12px
    fontWeight: 650
    textTransform: uppercase
    letterSpacing: 0.06em
    color: "{colors.accent}"
  ticket-title:
    fontSize: 20px
    fontWeight: 700
    lineHeight: 1.3
  hero-title:
    fontSize: 18px
    fontWeight: 700
  card-title:
    fontSize: 15px
    fontWeight: 650
  heading-default:
    fontWeight: 650
    letterSpacing: -0.01em
  kpi-value:
    fontSize: 30px
    fontWeight: 750
    letterSpacing: -0.03em
    lineHeight: 1.05
    fontVariantNumeric: tabular-nums
  mini-kpi-value:
    fontSize: 24px
    fontWeight: 750
  body-sm:
    fontSize: 13px
  caption:
    fontSize: 12px
    color: "{colors.ink-3}"
  label-caps:
    fontSize: 11.5px
    fontWeight: 650
    textTransform: uppercase
    letterSpacing: 0.05em
  mono:
    fontFamily: mono
    fontSize: 0.92em
    fontWeight: 500
    letterSpacing: -0.01em
rounded:
  xs: 6px
  sm: 8px
  md: 12px
  lg: 16px
  pill: 20px
  modal: 20px
spacing:
  gap: 16px
  page-x: 28px
  page-top: 24px
  page-bottom: 110px
  card-x: 18px
  card-y: 16px
  page-max-width: 1600px
elevation:
  sh-1: "0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06)"
  sh-2: "0 2px 4px rgba(16,24,40,.04), 0 8px 24px -6px rgba(16,24,40,.12)"
  sh-3: "0 12px 40px -8px rgba(16,24,40,.28)"
  focus: "0 0 0 3px rgba(47,107,255,.28)"
layout:
  rail-width: 84px
  topbar-height: 64px
  side-column: 360px
  breakpoints: { wide: 1360px, desktop: 1280px, tablet: 900px, phone: 700px }
components:
  button:
    height: 36px
    paddingX: 14px
    radius: "{rounded.sm}"
    fontSize: 13.5px
    fontWeight: 550
    background: "{colors.surface}"
    border: "1px solid {colors.line-2}"
  button-primary:
    background: "{colors.accent}"
    text: "{colors.accent-ink}"
    hover: "{colors.accent-2}"
  button-ok:
    background: "{colors.ok}"
    text: "{colors.accent-ink}"
  button-sm: { height: 30px, paddingX: 10px, fontSize: 12.5px, radius: 7px }
  button-lg: { height: 44px, paddingX: 20px, fontSize: 15px, radius: 10px }
  card:
    background: "{colors.surface}"
    border: "1px solid {colors.line}"
    radius: "{rounded.lg}"
    shadow: "{elevation.sh-1}"
  badge: { height: 24px, paddingX: 9px, radius: 12px, fontSize: 12px, fontWeight: 600 }
  tag: { height: 22px, radius: 6px, fontSize: 10.5px, fontWeight: 700, textTransform: uppercase }
  input: { minHeight: 38px, radius: "{rounded.sm}", border: "1px solid {colors.line-2}" }
  bubble: { size: 36px, radius: 10px }
  avatar: { size: 28px, sizeLg: 36px, radius: 50% }
  bar: { height: 6px, radius: 3px, track: "{colors.surface-3}" }
---

# DESIGN.md: panel de operación de NEXO

Guía de diseño para los agentes que construyen o modifican el panel C5 del taller 3. Los tokens del encabezado YAML son los valores exactos de `css/tokens.css` del prototipo; este texto explica cuándo y cómo usarlos. El comportamiento de cada pantalla (datos, acciones, reglas) está en [prototipo.md](docs/context/prototipo.md); este archivo cubre solo el aspecto visual y la interacción.

Regla de partida: portar el CSS del prototipo tal cual (`tokens.css`, `base.css`, `layout.css`, `components.css`, `screens.css`) y reutilizar sus clases. Un diseño nuevo solo se justifica si una pantalla necesita algo que el prototipo no tiene, y en ese caso debe salir de estos tokens y componentes.

## Overview

NEXO es una herramienta de trabajo para el supervisor, el líder técnico y el responsable de cierre durante un evento con 20 puertas abiertas. El panel tiene forma de mesa de ayuda: una bandeja de incidentes con responsable, prioridad y plazo, fichas de detalle con bitácora y un resumen en vivo que abre con una frase en lenguaje llano ("18 de 20 puertas validan con normalidad").

Personalidad: sobria, legible y confiable. La marca (azul noche y cian de la presentación del equipo) vive en el riel, el logo, la ayuda y la barra de la ventana de ingreso. El resto de la interfaz es neutra para que los colores de estado resalten. Lema de la ayuda: "Una boleta. Una decisión. Un cierre verificable."

Principios visuales:

1. Primero la frase, después las cifras, al final el detalle.
2. El color significa estado; nunca adorna.
3. Los códigos KR, CA y ADR no van en títulos: van en la ayuda contextual (`tip`).
4. Todo número que se compara (conteos, plazos, porcentajes) usa cifras tabulares; todo identificador técnico usa la fuente mono.
5. La interfaz se actualiza varias veces por segundo sin mover el foco ni el desplazamiento: se reescriben ranuras, no páginas.

## Colors

### Superficies y texto

- `bg` es el fondo de la aplicación; `surface` el de tarjetas, barra superior y modales; `surface-2` para cabeceras de tabla, pies, elementos cerrados o de solo lectura y estados hover; `surface-3` para pistas de barras, controles segmentados y chips de identificador.
- `line` separa (bordes de tarjeta, filas, divisores); `line-2` delimita controles (botones, campos, casillas).
- `ink` texto principal, `ink-2` texto secundario y descripciones, `ink-3` metadatos, horas, pies y placeholders.

### Marca

- `brand` y `brand-2`: degradado del riel (`rail-a` → `rail-b`, 180°) y de la cabecera de la ayuda (135°); fondo del avatar del sistema "NX", del ícono de lector y de la etiqueta de control CA.
- `cyan`: la "X" del logo NE**X**O, la marca de la entrada activa del riel y el extremo del degradado de la ventana de ingreso (`brand-2` → `cyan`).
- `accent`: enlaces, botón primario, foco, selección (`accent-soft`), paso actual del recorrido de cierre, líneas de sparkline y anillos.

### Estado (semántica)

Única fuente de color en contenido. Cada tono tiene su versión `-soft` para fondos.

| Tono | Punto de validación | Decisión | Incidente y otros |
|---|---|---|---|
| `ok` verde | En línea | Aceptado | Resuelto, cumple meta, control confirmado, paso hecho |
| `warn` ámbar | Sin comunicación | Sin respuesta | Prioridad alta, plazo por vencer, pendiente |
| `no` rojo | Lector averiado | Rechazado | Nuevo, prioridad crítica, vencido, no cumple |
| `violet` morado | En pausa (sin coordinador) | | Acción que espera una decisión humana |
| `info` azul | | | En curso, avisos informativos, sistema |
| `mute` gris | Sin abrir | | Falsa alarma, sin datos, repuesto |

El tema oscuro redefine los mismos nombres con valores más claros para mantener contraste; nunca se elige un color distinto por tema en una vista.

### Colores auxiliares

- `t-red`, `t-orange`, `t-blue`, `t-gold`, `t-violet`, `t-gray`: fichas de la bandeja de incidentes (contadores y etiquetas de tipo) y cuadros numerados del panel lateral. Son más apagados que los semánticos para que la bandeja no compita con los estados.
- `z1` a `z5`: una por zona del estadio (Norte, Sur, Oriental, Occidental, Palcos). Solo en el punto de zona (`zdot`) y en las barras de admisiones por zona.
- `sim` y `sim-ink`: fondo oscuro de la ayuda contextual y del teléfono del lector.

### Deuda a corregir al portar

El prototipo declara que solo `tokens.css` tiene colores literales, pero hay excepciones que deben pasar a tokens: el contador del riel (`#F0544B`), los avatares por rol (`avatar--r0` a `r4`), el teléfono y los resultados del lector (degradados `#16A36A → #0E7A4E`, `#E0564B → #B3362C`, `#E8962E → #B96D0E`, fondos `#0F172A`, `#1E293B`), el color del texto de énfasis de la ayuda (`#93C5FD`) y los grises del panel Demo (que desaparece). Propuesta: `--rail-badge`, `--role-0` a `--role-4` con su `-soft`, `--reader-ok`, `--reader-no`, `--reader-warn`, `--reader-bg`, `--reader-panel`.

## Typography

- Inter para todo el texto (variable 100 a 900, subconjuntos latin y latin-ext incluidos en `assets/fonts/`, `font-display: swap`); JetBrains Mono 500 para identificadores (`P-07`, `INC-0001`, `TA-8804-0061`, `LX-2210-0149`, `CRED-P-07-A`), horas y versiones (`v37`).
- Tamaño base 14 px con interlineado 1,5. Los encabezados usan peso 650 y tracking -0,01 em.
- Escala: título de página 24/700; título de incidente 20/700; título de puerta 20/700; frase del hero 18/700; título de tarjeta 15/650; KPI 30/750 con tracking -0,03 em; mini KPI 24/750; cuerpo 13 a 13,5; metadatos 12 a 11,5; rótulos en mayúsculas 10,5 a 12 con tracking 0,05 a 0,08 em.
- Los rótulos en mayúsculas se reservan para: antetítulo de página (`kicker`, en `accent`), cabeceras de tabla, títulos de acordeón, rótulos de contadores y la línea de plazo del incidente ("ACTUACIÓN VENCE").
- Utilidades: `.num` (cifras tabulares), `.mono`, `.dim` (`ink-3`), `.soft` (`ink-2`), `.strong`, `.ok-t`, `.no-t`, `.warn-t`, `.violet-t`.
- Idioma: español de Colombia. Títulos y encabezados con mayúscula solo inicial ("Resumen del evento", "Cierre y liquidación"). Horas en 24 h (`18:04`, `18:04:12` cuando importan los segundos); miles con punto (`15.000`); decimales con coma; moneda `USD 6.500,00`.

## Layout

### Armazón

- Rejilla de la aplicación: columna del riel de 84 px + contenido; fila de barra superior de 64 px + contenido; alto de ventana completo. Solo el contenido (`.main`) desplaza.
- Riel: degradado de marca, padding 14/10, entradas apiladas con icono de 22 px sobre texto de 10,5 px; la entrada activa lleva fondo `rail-active` y una barra cian de 3 px a la izquierda; contador rojo circular en la esquina; separador de 1 px; Ayuda y Tema al pie.
- Barra superior: fondo `surface`, borde inferior `line`, padding 0 20/24; de izquierda a derecha migas (15 px), búsqueda (máximo 420 px, alineada a la derecha), chip del evento, campana y selector de rol. Todos los controles de la barra miden 38 px de alto y son de pastilla (radio 20).
- Página (`.page`): padding 24/28 y 110 abajo, ancho máximo 1600 px centrado.
- Cabecera de página (`page-head`): antetítulo, título, párrafo (máximo 760 px, `ink-2`) y a la derecha la barra de acciones; separación inferior de 20 px.

### Rejillas

- `grid` con separación de 16 px; `grid--main-side` columna flexible + lateral de 360 px; `grid--2`, `grid--3`, `grid--4`.
- `stack`: separación vertical de 16 px entre hijos.
- Específicas: detalle de incidente `1fr / 290 / 300`; puertas `280 / 1fr`; lector `360 / 1fr`; rejilla de puertas `auto-fill minmax(118px, 1fr)` con 10 px; tarjetas de incidentes `auto-fill minmax(290px, 1fr)` con 14 px; casos del lector `auto-fill minmax(230px, 1fr)`.
- Elementos pegajosos a 16 px del borde: propiedades del incidente, lista de puertas y teléfono del lector.

### Adaptación

| Ancho | Cambio |
|---|---|
| ≤ 1360 px | Detalle de incidente pasa a dos columnas; el lateral baja a ancho completo. |
| ≤ 1280 px | `grid--main-side` pasa a una columna; `grid--4` a dos. |
| ≤ 1100 px | El diagrama "Cómo fluye cada decisión" se apila en vertical sin animación. |
| ≤ 1060 px | Lector en una columna, teléfono centrado. |
| ≤ 960 px | Puertas y detalle de incidente en una columna. |
| ≤ 900 px | Todas las rejillas a una columna; se ocultan búsqueda y chip del evento; padding de página 16. |
| ≤ 700 px | Riel de 58 px sin textos; barra superior de 56 px sin migas; notificaciones a ancho disponible. |

## Elevation & Depth

- `sh-1`: reposo de tarjetas, tarjetas de incidente, acciones pendientes y segmento activo.
- `sh-2`: hover de tarjetas interactivas (fichas de puerta, tarjetas de incidente, casos del lector), siempre junto con `translateY(-1px)` y borde `accent` o `line-2`.
- `sh-3`: capas flotantes: resultados de búsqueda, notificaciones, ayuda contextual y modal.
- `focus`: anillo de 3 px en `accent` al 28 % para todo elemento con foco de teclado (`:focus-visible`); no se usa `outline`.
- Capas (`z-index`): resultados de búsqueda 40, ayuda contextual 50, notificaciones 60, modal 80 con velo `rgba(8,12,30,.55)` y desenfoque de 3 px.
- Los elementos cerrados o de solo lectura bajan un nivel: fondo `surface-2` y sin sombra (`tcard--closed`, `dif--done`, `input--ro`).

## Shapes

- Radios: 6 (etiquetas, chips pequeños, casillas), 8 (botones, campos, fichas de puerta), 12 (avisos, bloques internos, nodos del diagrama, bitácora), 16 (tarjetas), 20 (pastillas de la barra superior, modal), 50 % (avatares, puntos, botones de icono).
- Burbujas de icono (`bubble`): cuadrado de 36 px con radio 10, fondo `-soft` y ícono del tono. Tamaños mayores: 44 (incidente), 48 (hero, lector), 52 (puerta).
- Puntos de estado (`dot`): círculo de 8 px; `dot--pulse` para estados que requieren atención. Punto de zona (`zdot`): cuadrado de 9 px con radio 3.
- Barras: 6 px de alto con radio 3 (4 px en fichas y medidores de plazo, 8 px en zonas y ventana de ingreso).

## Components

Clases del prototipo que deben reutilizarse. Nombres BEM en español.

### Acciones

- `btn` (36 px, radio 8, borde `line-2`); variantes `btn--primary` (acento), `btn--ok` (verde, para aprobar, resolver, registrar cobro), `btn--ghost` (sin borde, para volver o "Ver todo"), `btn--soft` (fondo `accent-soft`), `btn--danger` (texto rojo); tamaños `btn--sm` (30) y `btn--lg` (44); `btn--block`.
- Un solo botón primario por zona de la pantalla. Acciones irreversibles o que aprueban algo usan `btn--ok`; rechazar usa `btn` normal con ícono `x` en rojo.
- `btngroup` une botones con borde compartido (barra del incidente). `seg` es el control segmentado (fondo `surface-3`, opción activa `surface` con `sh-1`) para alternar vistas o modos. `toolbar` agrupa acciones con separación de 8.
- `iconbtn`: botón circular de 38 px para campana y cierre de modal. `star`: destacar incidente, dorado (`t-gold`) cuando está activo.

### Contenedores

- `card` con `card__head` (padding 16/18/0, título 15/650 y `tip` opcional, `spacer` para empujar acciones a la derecha), `card__body` (14/18/18) y `card__foot` (borde superior). Variantes `card--flat` y `card--tint`.
- `hero`: tarjeta ancha con burbuja de 48 px, frase y botón a la derecha; en el Resumen incluye a la derecha la ventana de ingreso con barra degradada y marcador circular.
- `kpi`: burbuja de tono, rótulo, `tip`, valor grande, pie en `ink-3` y a la derecha un anillo, un sparkline o una insignia "Cumple / No cumple". `minik` es la versión reducida de las puertas.
- `notice` y variantes `--ok`, `--warn`, `--no`, `--violet`: aviso en página con ícono del tono sobre fondo `-soft`; un botón opcional va a la derecha.
- `empty`: estado vacío con arte de 64 px (radio 20, fondo `ok-soft`), título 16 y texto de hasta 380 px. Todo listado vacío debe usarlo con una frase útil, nunca una tabla vacía.
- `modal` / `modal__box`: hasta 760 px (820 la ayuda), radio 20, entrada con `entrar`.
- `acc`: acordeón `<details>` con título en mayúsculas 11,5/700 y chevron que gira.

### Datos

- `badge` (pastilla de 24 px con punto del color actual; `badge--plain` sin punto, `badge--sm` de 20 px, `badge--live` con punto intermitente). Para estados de punto, decisión, incidente y cumplimiento.
- `tag`: etiqueta en mayúsculas sobre fondo `t-*` y texto blanco, para el tipo de incidente en la bandeja.
- `prio--critica|alta|media|baja` (texto) y `prio-dot` (cuadrado de 8 px): rojo, ámbar, dorado, verde.
- `idchip`: pastilla mono de 26 px sobre `surface-3` para códigos (`INC-0001`, `DIF-001`, metas en la ayuda).
- `avatar`: iniciales del rol en círculo de 28 (36 grande); un color por rol en el orden de `comunes.ROLES`; `avatar--sys` en `brand` para NEXO y Sistema. Nunca representa a un asistente.
- `table`: cabecera en mayúsculas 11,5/650 `ink-3` sobre `surface-2`, celdas 10/12, borde inferior `line`; `table--hover` cuando la fila abre un detalle; envolver en `tablewrap` para desplazamiento horizontal.
- `kv`: lista clave-valor en dos columnas, clave `ink-3`, valor alineado a la derecha 550.
- `lines`: filas de concepto e importe; `lines__total` con borde superior de 2 px en `ink`. Para liquidación y cobertura.
- `feed`: actividad con punto de tono, texto y hora mono.
- `tl`: bitácora de solo adición; entrada `sistema` con fondo `info-soft`, `estado` con `surface-2`, `nota` con borde izquierdo ámbar de 3 px. Nunca incluye controles de editar o borrar.
- `sla`: medidor de plazo (rótulo, valor a la derecha, barra de 4 px) para actuación, recuperación y sincronía.
- Gráficos: `spark` (línea de 2 px en `accent` sobre área `accent-soft`), `ring` (anillo de 7 px), `bar`, `stackbar` (barra apilada de 14 px con separadores de 2 px). Se dibujan en SVG sin librerías.

### Campos

- `field` con `field__lbl` (12,5/600, asterisco rojo si es obligatorio); `input`, `select` (chevron propio), `textarea` (mínimo 84 px); foco con borde `accent` y anillo `focus`; `input--ro` para solo lectura; `inputwrap` para ícono dentro del campo.
- `check`: casilla de 20 px, radio 6, verde al marcar y texto tachado en `ink-3`. Se usa para pasos del incidente y controles previos.

### Ayuda contextual

`tip`: ícono `circle-help` de 15 px en `ink-3` (acento al pasar) que muestra una caja oscura (`sim`) de hasta 260 px con la explicación en lenguaje llano y, debajo, la meta en azul claro (por ejemplo "KR1.2 · sin comunicación en máximo 60 s"). Se abre con hover y con foco de teclado. `tip--left` la alinea a la derecha cuando está cerca del borde.

### Notificaciones

`toast`: tarjeta de 360 px en la esquina superior derecha (debajo de la barra), burbuja de 32 px con ícono del tono, título 13,5, texto 13 y enlace "Ver"; máximo tres; se cierra sola a los 6 s (9 s las de tono `violet`, que piden una decisión).

## Screen patterns

Composición de cada pantalla con los componentes anteriores. Los contenidos están en prototipo.md §5.

- Resumen: `page-head` → `hero` → cuatro `kpi` en `grid--4` → `grid--main-side`. Columna principal: diagrama de flujo (`arch`: cuatro nodos con borde superior de 3 px del tono y tres enlaces animados; enlace caído en rayas rojas con "interrumpido"), rejilla de fichas de puerta (`gates` / `gate` con fondo `-soft` del estado y barra de 4 px), admisiones por zona (`zrow`) y ritmo (`spark`). Lateral: "Requiere tu atención" (`mini` con `sla`), últimas decisiones (`dlist`) y actividad (`feed`).
- Incidentes: tarjeta `inbox` con seis contadores (`tiles`, número blanco sobre `t-*` y barra superior de color en el seleccionado), barra de filtros y tarjetas (`tcard`) o tabla; lateral `side` con cuadros numerados (`sq`), acciones pendientes (`act`, `act--hot` con halo morado si es decisiva), plazos (`due`) e historial (`hist`).
- Detalle del incidente: barra de acciones (`tbar`) → rejilla `ticket` de tres columnas: principal (`tk-head`, aviso de decisión, `tl`, `composer`), propiedades (`props__state` con `due-line` en mayúsculas, campos, pie con botón Actualizar) y lateral en acordeones.
- Puertas: `gsplit` con lista (`glist` / `grow`, fila seleccionada en `accent-soft`) y detalle (`gdet`, cuatro `minik`, actividad, lector con `reader__art` en `brand`, tabla de intentos).
- Lector: `rgrid` con el teléfono a la izquierda (330 px, radio 44, pantalla oscura de 600 px; resultado a pantalla llena con degradado verde, rojo o ámbar, palabra de 30/800 y animación `estampa`) y a la derecha casos (`case`), recorrido de la decisión (`steps` con marcas verde, roja o ámbar y pasos no evaluados al 45 %) y evidencia (`kv`).
- Cierre: `stepper` de seis pasos (hecho en verde, actual con halo `accent-soft`, pendientes en gris) → aviso → `grid--main-side` con diferencias (`dif`), cobertura (`lines`), conteo (`stackbar`), condiciones (`conds` y `deadlines`), liquidación (`invoice`, `contrib`) y contrato (`evlist`, evento actual en `accent-soft`).
- Preparación: `hero` con anillo N/6 → controles (`ctls` / `ctl` con `check`) y tabla de puertas → lateral con pruebas (`calist` / `ca` con `ca__id` en `brand`), coordinador (`nodes` / `nodechip`), integración (`kv`) y políticas (`pols`).
- Ayuda: modal con cabecera degradada de marca, logo de 44 px, lema y pestañas; cuerpo con tres pasos, instrucciones, glosario (`gloss`) o mapa de pantallas (`mapi`).

## Iconography

- Iconos Lucide (licencia ISC) incrustados como SVG en `js/iconos.js`: `viewBox 0 0 24 24`, sin relleno, trazo `currentColor` de 2 px con extremos y uniones redondeados, `aria-hidden="true"`. Tamaños habituales: 22 (riel), 18 a 20 (burbujas, cabeceras), 16 (botones), 12 a 14 (inline).
- El ícono hereda el color del texto o de la burbuja; no se colorea por separado salvo con las utilidades `*-t`.
- Iconos disponibles: activity, arrow-left, arrow-right, arrow-up-right, ban, banknote, bell, book-open, building-2, calendar-clock, check, chevron-down, chevron-left, chevron-right, circle-alert, circle-check, circle-dashed, circle-dot, circle-help, circle-pause, circle-x, clipboard-check, clock, cloud, cloud-off, copy, cpu, database, door-open, eye, eye-off, fast-forward, file-check-2, file-text, filter, flag, gauge, git-merge, hand, history, hourglass, info, key-round, layout-dashboard, layout-grid, list, list-checks, loader, lock, map-pin, message-square-plus, moon, pause, play, plug, radio-tower, receipt, refresh-cw, repeat, rotate-ccw, route, scale, scan-line, search, send, server, settings-2, shield-alert, shield-check, siren, skip-forward, sliders-horizontal, smartphone, sparkles, split, star, sun, ticket, timer, trending-up, triangle-alert, unplug, user-round, users, wallet, wifi, wifi-off, workflow, x, zap. Si hace falta otro, se agrega de Lucide con el mismo formato.
- Asignaciones fijas: Resumen `layout-dashboard`, Incidentes `siren`, Puertas `door-open`, Lector `scan-line`, Cierre `file-check-2`, Preparación `clipboard-check`; aceptado `circle-check`, rechazado `circle-x`, sin respuesta `circle-pause`; tipos de incidente en prototipo.md §8.1.

## Motion

- Transiciones de 0,12 a 0,15 s en fondo, borde, sombra y color; barras y anillos animan su ancho u offset en 0,4 a 0,5 s.
- Animaciones con significado: `latido` y `halo` (punto pulsante de estado que requiere atención), `parpadeo` (insignia en vivo), `flujo` (punto que recorre un enlace activo del diagrama), `entrar` (notificaciones y modal, 0,2 a 0,25 s), `estampa` (resultado del lector), `pulso` (lector en reposo).
- Nada se mueve solo por decoración. `prefers-reduced-motion: reduce` desactiva todas las animaciones y transiciones.

## Accessibility

- Contraste: texto sobre `surface` con `ink` o `ink-2`; `ink-3` solo para metadatos. Los estados nunca dependen solo del color: siempre van con texto ("Sin comunicación") o ícono.
- Foco visible en todo control interactivo con el anillo `focus`. Atajo `/` para la búsqueda; Enter abre el primer resultado; Escape cierra búsqueda y modal.
- Roles ARIA: `aria-current="page"` en el riel, `aria-pressed` en controles segmentados, `role="tablist"` y `aria-selected` en los contadores, `role="checkbox"` y `aria-checked` en `check`, `role="dialog"` y `aria-modal` en la ayuda, `aria-live="polite"` en las notificaciones, `role="tooltip"` en `tip__box`, `aria-label` en todo botón de solo ícono.
- Tamaño mínimo de objetivo: 30 px (botón pequeño); 38 px en la barra superior.
- Actualizaciones en vivo: reescribir solo las ranuras (`data-slot`) que cambiaron para no perder foco, selección ni desplazamiento, y no reescribir un campo mientras tiene foco.

## Content and voice

- Frases cortas en segunda persona para el operador ("Requiere tu atención", "Nada espera tu decisión"). Explicar en lenguaje llano y dejar el código de meta en la ayuda.
- Cada pantalla abre con su propósito en una línea. Los estados vacíos dicen qué aparecerá ahí y cuándo.
- Vocabulario del dominio sin sinónimos: boleta (no ticket ni entrada), admisión, intento, punto de validación o puerta, lector, coordinador local, diario del lector, buzón, conciliación, liquidación.
- Precisiones que no se omiten: "Admisiones frente a lo estimado. No indican ocupación del recinto"; "Sin datos personales del asistente"; "Las notas no se editan ni se borran"; "La contribución no es utilidad".
- Los responsables son roles, nunca nombres de personas. Las cifras de ejemplo se rotulan como ficticias.

## Do's and Don'ts

Hacer:

- Reutilizar los tokens y las clases del prototipo; crear un token nuevo antes que escribir un color literal.
- Mostrar primero la frase de estado y después el detalle.
- Mostrar datos atrasados con su antigüedad ("Sin reporte hace 2 min", "Corte hace 4 min") en lugar de presentarlos como actuales.
- Indicar "Sin datos aún" cuando un indicador no tiene observaciones, en lugar de 0 % o 100 %.
- Deshabilitar con explicación: un botón bloqueado lleva al lado el motivo o la condición pendiente.
- Probar cada pantalla en tema claro y oscuro y en los anchos de la tabla de adaptación.

No hacer:

- Usar verde, rojo, ámbar o morado como adorno o como color de marca.
- Poner códigos KR, CA o ADR en títulos o botones.
- Mostrar el panel Demo, velocidades, saltos de reloj, "personal simulado" ni textos de "aprobación automática".
- Agregar campos de identidad del asistente o avatares de personas.
- Ofrecer editar o borrar notas, decisiones o resoluciones.
- Introducir librerías de componentes, frameworks de CSS o fuentes remotas: todo va incluido y funciona sin conexión.
- Mostrar cifras del prototipo (97 % en plazo, p95 de 312 ms, 48 de 48 casos) como si fueran resultados medidos.

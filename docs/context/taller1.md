# Resumen del taller 1: caso de negocio de NEXO

Resumen autocontenido del documento "Taller 1: Caso de negocio de NEXO. Plataforma B2B SaaS de control de acceso para eventos masivos" (Ana Sofía Alfonso Moncada, Santiago Álvarez Peña y Tomás Olarte Hernández; Arquitecturas Avanzadas de Software, 12 de septiembre de 2026). El original está en `taller1/taller1_NEXO.pdf`, generado desde `taller1/taller1_NEXO.tex`.

Todas las cifras son presupuestos en USD antes de impuestos, calculados con supuestos declarados. Ninguna es una medición de campo ni un contrato.

## 1. Qué es NEXO

NEXO es una plataforma B2B SaaS de control de acceso para eventos masivos. El foco inicial son los operadores de estadios colombianos, sin excluir otros recintos compatibles. Hace tres cosas encadenadas:

1. Integra los permisos y anulaciones que emite la boletería.
2. Decide cada validación en la puerta por código QR o de barras, según puerta, zona y horario.
3. Consolida esas decisiones en una vista común para el operador y en un cierre conciliado.

La unidad sobre la que actúa es la boleta dentro de un evento, nunca la persona. NEXO comunica el resultado de la validación; si no hay integración con torniquete, el personal de acceso permite o impide el paso según ese resultado. Una admisión registrada es una boleta correctamente aceptada conforme a permisos y reglas, contada una sola vez por evento, y no acredita el ingreso físico del portador.

Se consideran masivos los eventos con asistencia prevista de al menos 2.000 personas (definición operativa, no legal).

### 1.1 Problema

La venta de la boleta funciona. Lo que falla es lo que pasa después: la información del ingreso queda repartida entre boletería, cada puerta y el supervisor. Consecuencias:

- durante el evento nadie conoce el estado agregado del ingreso;
- ante un incidente hay que reconstruir qué pasó en cada punto;
- al cierre, las cifras no siempre son verificables contra un registro común.

Caso extremo: una misma boleta puede ser aceptada en una puerta y rechazada en otra por causas legítimas, y sin registros compartidos nadie puede demostrar cuál decisión fue correcta.

Costo modelado del problema por evento base: fuga del 1 % de 15.000 admisiones con boleta promedio de USD 15 (COP 60.000 a COP 4.000 por dólar) da USD 2.250; la reconstrucción del cierre (3 personas, 8 h, USD 8/h) da USD 190. Total cercano a USD 2.440, que no justifica por sí solo la tarifa de USD 6.500 (haría falta una fuga del 2,9 %). El argumento económico es reemplazar un gasto que el cliente ya hace en control de acceso y eliminar la conciliación manual; ese gasto actual es la cifra que falta levantar.

### 1.2 Quién compra y quién usa

- Compra: el responsable con autoridad presupuestal del operador o administrador del estadio (también otros recintos, clubes, productoras y organizadores con esa facultad).
- Usan: el equipo de logística y el personal de acceso.
- La boletería no es cliente, pero aporta permisos y anulaciones.
- El Puesto de Mando Unificado (PMU) recibe información, pero no se presume comprador.
- El portador presenta la boleta sin entregar su identidad.

Criterios de prioridad comercial: tres o más eventos al año, más de 10.000 asistentes esperados, o varias puertas y localidades.

### 1.3 Incluye y excluye

Incluye: integración de boletas y anulaciones con la boletería; validación por QR o código de barras según puerta, zona y horario; comunicación de cada decisión a dispositivos compatibles; monitoreo durante el evento; auditoría de decisiones; configuración inicial, capacitación, soporte remoto y cierre conciliado.

Excluye: venta de entradas y cobros al asistente; identidad personal; fabricación e instalación de hardware o redes; videovigilancia, evacuación y medición de multitudes; operación del personal de seguridad. Presencia en sitio e integraciones especiales se cotizan aparte.

### 1.4 Propuestas de valor y sus límites

| Propuesta | Beneficio y condición |
|---|---|
| Orquestación del ingreso | Estado de validaciones y puntos para coordinar respuestas; no predice filas. |
| Continuidad y recuperación | Operación local restringida, reemplazo compatible y sincronización; depende de preparación y reglas de contingencia. |
| Adopción sin inversión permanente | Dispositivos existentes o alquilados, sin compra obligatoria de lectores. El alquiler tiene costo. |
| Protección del aforo y contabilidad de accesos | Rechazo de usos contrarios a reglas conocidas y cierre conciliado. No garantiza ocupación física ni impide todos los cruces indebidos. |

La capacidad de leer un código y decidir no es ventaja competitiva: SECUTIX y WeezAccess ya validan boletas de terceros. La hipótesis de diferenciación es reutilizar conector, configuración y procedimiento de cierre para abaratar los eventos siguientes, más la confianza en un cierre conciliado.

## 2. Premisas, supuestos y restricciones

| ID | Condición | Decisión e impacto |
|---|---|---|
| P1 (premisa) | El ingreso se concentra antes del evento y en varios puntos; la información fragmentada retrasa la coordinación. | Monitoreo común y capacidad para picos. |
| P2 (premisa) | Los permisos dependen de zona, horario y uso; los lectores necesitan un estado de boleta consistente. | Reglas y auditoría; sincronización y contingencia restringida ante fallas. |
| S1 (supuesto) | Compra quien controla presupuesto y acceso; se prioriza recurrencia. | La validación comercial exige recompra del mismo cliente. |
| S2 (supuesto) | Capacidad de 2.000 a 60.000 y ocupación base del 75 %. | Media supuesta de 15.000 admisiones por evento; sensibilidad de ocupación del 10 % al 100 %. |
| S3 (supuesto) | USD 500 por evento más USD 0,40 por boleta correctamente aceptada, contada una vez por evento, desde la primera. | Hipótesis comercial, no precio validado. |
| S4 (supuesto) | Tres eventos del mismo cliente, un recinto y una integración. | Piloto de seis meses: hasta 20 puntos y 5 zonas; dos eventos pagados y uno gratuito. |
| R1 (restricción) | El permiso se verifica contra la boleta, sin identificar a quien la porta (minimiza exposición bajo la Ley 1581 de 2012, sin afirmar exención). | Solo datos técnicos: sin biometría, identidad ni pagos. Se auditan decisiones, no personas. |
| R2 (restricción) | Equipos existentes o alquilados. | Sin inventario propio; hardware y presencia se cotizan aparte. |

P1 y P2 no tienen observación de campo. S1 a S4 son supuestos por validar en el piloto.

## 3. Piloto

- Tres eventos del mismo cliente en un mismo recinto (estadio u otro compatible).
- Hasta 20 puntos de validación y 5 zonas, una sola boletería integrada, una familia de dispositivos.
- Dos eventos cobrados y uno gratuito. Al tamaño base, los dos cobrados suman USD 13.000 (unos COP 52 millones), ajustados al uso real.
- Acompañamiento con soporte remoto en preparación, ingreso y cierre; sin presencia permanente ni atención 24 h.

Tres limitaciones técnicas declaradas antes del piloto:

1. La información precargada en los lectores no conoce anulaciones posteriores a la carga.
2. Dos lectores aislados pueden autorizar la misma boleta antes de sincronizarse (pretix documenta la misma limitación).
3. Solo se habilita modo local si sus restricciones y coordinación evitan conflictos; si no, se limita la autorización y se activa la contingencia. Un servidor local que coordine lectores es una opción por evaluar, no infraestructura incluida.

## 4. Business Model Canvas (resumen)

| Bloque | Contenido |
|---|---|
| Socios clave | Boleterías con interfaces disponibles, integradores de acceso, aliados de alquiler, nube y observabilidad, logística del cliente. |
| Actividades clave | Integrar y configurar; probar carga y contingencia; operar, conciliar y mantener; vender y medir costos. |
| Recursos clave | Plataforma y reglas, conectores reutilizables, equipo técnico y comercial, procedimientos, nube y registros. |
| Propuesta de valor | Coordinar el ingreso con información común; recuperar la operación ante fallas acotadas; adoptar sin compra obligatoria de lectores; controlar y conciliar el uso de la boleta; sin reemplazar la boletería ni identificar asistentes. |
| Relación con clientes | Diagnóstico guiado, soporte por evento, cierre conjunto, autoservicio y recurrencia. |
| Canales | Venta directa, referidos de integradores y boleterías, demostración y piloto, contratación por evento o temporada. |
| Segmentos | Operadores y administradores de estadios; otros recintos y organizadores recurrentes; PMU y logística como usuarios, no compradores. |
| Costos | Fijos USD 9.050/mes; trabajo por evento USD 300; sin inventario propio. |
| Ingresos | USD 500/evento más USD 0,40 por boleta aceptada. Anticipo de 500 más 50 % del uso estimado, ajuste al conciliar. |

Regla de margen: si un evento exige desarrollo propio, se cotiza aparte o se descarta.

## 5. Modelo económico

### 5.1 Tarifa y contribución

- Ingreso por evento: I(N) = 500 + 0,40 N, con N = boletas correctamente aceptadas, una vez por boleta y evento. No se cobran rechazos, reingresos ni retransmisiones.
- Contribución: MC(N) = I(N) - 300.
- Evento base (15.000 admisiones): ingreso USD 6.500, contribución USD 6.200 (95,4 % del ingreso). La contribución no es utilidad.
- En moneda del comprador: un evento base cuesta unos COP 26 millones, cerca del 2,9 % de una taquilla de COP 900 millones.

| Admisiones por evento | Ingreso | Contribución | Eventos para equilibrio anual |
|---|---|---|---|
| 5.000 | 2.500 | 2.200 | 50 |
| 9.000 | 4.100 | 3.800 | 29 |
| 10.000 | 4.500 | 4.200 | 26 |
| 15.000 | 6.500 | 6.200 | 18 |

### 5.2 Costos fijos mensuales (USD 9.050)

| Partida | Cálculo | USD |
|---|---|---|
| Desarrollo senior | 160 h × 40 | 6.400 |
| Operación técnica | 40 h × 30 (no es cobertura 24/7) | 1.200 |
| Ventas | 20 h × 20 | 400 |
| Administración | Coordinación, contador, software contable, conectividad, bancos | 600 |
| Infraestructura técnica | Cesta de 403,80 más holgura de 46,20 | 450 |

Cesta de infraestructura (referencia DigitalOcean y Grafana Cloud): dos VM de 4 vCPU y 8 GiB (168), entorno de pruebas (12), balanceador (12), PostgreSQL primario y standby de 2 vCPU y 4 GiB (121,80), objetos (5), copias diarias (54), observabilidad (19), herramientas de desarrollo (12). Todo en una región, sin protección regional. Respaldos de 7 días y registros de 30 no sustituyen la auditoría de negocio de 90 días. Se excluyen lectores, red del recinto, operadores y API externas.

Trabajo por evento (USD 300 = 10 h a USD 30): 3 h de preparación, 1 h de cierre, 4 h de soporte durante el evento y 2 h de contingencia. Tres eventos simultáneos exigen tres personas a la vez.

### 5.3 Proyección y caja

| Periodo | Eventos | Ingresos | Trabajo | Fijos | Resultado |
|---|---|---|---|---|---|
| Año 1 (3 clientes) | 12 | 78.000 | 3.600 | 108.600 | -34.200 |
| Año 2 (6 clientes) | 36 | 234.000 | 10.800 | 108.600 | 114.600 |
| Año 3 (10 clientes) | 60 | 390.000 | 18.000 | 126.600 | 245.400 |

- Equilibrio: 108.600 / 6.200 = 17,52, es decir 18 eventos base al año (un evento y medio al mes).
- Embudo: 30 cuentas, 15 entrevistas, 6 demostraciones, 3 clientes con 4 eventos cada uno. Ciclo de venta de 3 a 6 meses.
- CAC: USD 400 × 12 / 3 = 1.600 por cliente.
- Arranque único: USD 2.400 (validación independiente 1.200, capacitación 600, evento gratuito 600).
- Cobro: anticipo antes del evento (USD 3.500 para 15.000 admisiones) y saldo hasta 30 días después de conciliar.
- Caja: punto más bajo de USD -53.000 en el mes 8; con colchón del 20 %, financiación ilustrativa de USD 63.600 (unos COP 254,4 millones).

## 6. Objetivos y resultados clave

Cinco objetivos y 14 KR, evaluados durante dos trimestres. Los KR comprometidos (C) exigen la meta completa; los aspiracionales (A) admiten el criterio de 0,7. Sin observaciones suficientes, el resultado es "no evaluable". Simulacros y operación real se reportan por separado.

Capacidad objetivo a probar: tres eventos simultáneos de 15.000 admisiones concentradas en 60 minutos, en hasta 60 puntos y con factor pico de tres: 37,5 decisiones por segundo; con cinco solicitudes por admisión, 187,5 solicitudes por segundo, más paneles, rechazos y reintentos. El plan incluye caída de una VM, failover de la base y recuperación. Superar estas pruebas demuestra capacidad técnica, no adopción.

| KR | Tipo | Meta |
|---|---|---|
| O1. Coordinar con información oportuna | | |
| KR1.1 Visibilidad oportuna | C | Al menos 95 % de las validaciones conectadas visibles en 5 s desde el registro en el lector. |
| KR1.2 Cobertura explícita | C | Todos los puntos habilitados representados; "sin comunicación" en máximo 60 s desde el último reporte. |
| KR1.3 Respuesta operativa | A | Acción o decisión del supervisor en menos de 5 min para al menos 80 % de las alertas confirmadas; mínimo 5 casos reales. |
| O2. Validación recuperable ante fallas acotadas | | |
| KR2.1 Sincronización íntegra | C | Al menos 99,5 % de los pendientes consolidados en 5 min tras recuperar comunicación estable. |
| KR2.2 Recuperación del punto | C | Punto averiado restablecido en máximo 3 min con repuesto preparado. |
| O3. Adopción repetible sin compra de lectores | | |
| KR3.1 Cero compra obligatoria | C | Tres pilotos sin compra obligatoria de lectores. |
| KR3.2 Reutilización del conector | C | Pilotos 2 y 3 sin adaptaciones específicas, con hasta 3 h de preparación y 1 h de cierre. |
| KR3.3 Aceptación operativa | A | Satisfacción promedio de al menos 4/5, ninguna bajo 3, con tres roles distintos. |
| O4. Contabilidad de accesos verificable | | |
| KR4.1 Rechazos incorrectos | C | Máximo 0,5 % sobre intentos que debían autorizarse; muestras de al menos 1.000. |
| KR4.2 Trazabilidad completa | C | Todos los intentos registrados; campos completos en al menos 99,9 %; cualquier pérdida incumple. |
| KR4.3 Cierre oportuno | C | Preliminar hasta 30 min y definitivo conciliado hasta 24 h después del cierre de la ventana de ingreso. |
| O5. Pago, recompra y contribución | | |
| KR5.1 Uso pagado | C | Dos eventos cobrados con precio aceptado antes de operar. |
| KR5.2 Recompra | C | Nueva contratación vinculante del mismo cliente dentro de 60 días del primer piloto pagado. |
| KR5.3 Contribución positiva | C | Contribución positiva en cada piloto pagado y margen agregado de al menos 55 %. |

Reglas de contabilidad: se concilian decisiones únicas, no la suma de boletas habilitadas, rechazos y admisiones (se solapan). Los reintentos de transmisión no crean decisiones. R1 impide inferir cruces físicos, ocupación o filas a partir de escaneos.

### 6.1 Condiciones de apertura CA1 a CA4

Obligatorias y no compensables con buenos KR.

| Control | Exigencia |
|---|---|
| CA1. Contingencia probada | Resolver todos los casos elegibles en tres interrupciones separadas de 15 min (internet, servicio central, integración) con carga prevista y respuestas esperadas fijadas antes. |
| CA2. Latencia del motor | p95 de hasta 500 ms desde recepción del identificador hasta respuesta, separando modo conectado y local. Las solicitudes sin respuesta cuentan como incumplimiento: al menos 95 % del total debe responder en 500 ms. |
| CA3. Reglas probadas | Rechazar todos los casos conocidos de duplicidad, anulación, zona u horario incorrecto, incluidos duplicados concurrentes y modos restringidos. |
| CA4. Presupuesto | Trabajo por evento hasta USD 345; infraestructura mensual hasta USD 450; piloto gratuito hasta USD 600. |

Controles previos a operar: lectores con versión requerida (un lector no preparado no autoriza localmente); desconexión no significa autorización ilimitada; puntos y reemplazo probados cuatro horas antes de abrir; fallas que permitan autorización indebida o pérdida de registros bloquean la modalidad; sin nombres, documentos, contactos, pagos ni biometría en integración y registros.

### 6.2 Indicadores reproducibles

| Indicador | Definición |
|---|---|
| Respuesta a alertas | Confirmadas con acción en menos de 5 min / total confirmado. |
| Sincronización | Pendientes consolidados en 5 min / total pendiente al recuperar. |
| Falsos rechazos | Rechazos de intentos autorizables / intentos autorizables en muestra independiente. |
| Trazabilidad | Intentos con campos completos / intentos recibidos según contador independiente; pérdida medida aparte con tolerancia cero. |
| Recompra | Al menos un evento adicional contratado por el mismo cliente tras el primer piloto pagado. |
| Margen agregado | (Ingresos - trabajo y excesos atribuibles) / ingresos de eventos pagados. |
| Costo técnico unitario | Factura técnica mensual / primeras admisiones del mes. |

## 7. Conclusiones y continuidad

- Viabilidad no demostrada: un evento base deja USD 6.200, pero 12 eventos en el año 1 pierden USD 34.200. El precio, el tamaño del mercado y la capacidad técnica siguen sin validarse.
- Decisión: piloto de tres eventos en un recinto con un cliente, dos cobrados por USD 13.000 al tamaño base y uno gratuito con recursos hasta USD 600. Deben cumplirse CA1 a CA4. Sin recompra no hay validación comercial. Autorizaciones indebidas sin resolver, pérdida de registros o diferencias no conciliadas bloquean el escalamiento.
- Continuidad arquitectónica: los KR de oportunidad de la información, recuperación ante fallas e integridad de registros convierten latencia, disponibilidad y trazabilidad en atributos de calidad de primer orden. Cada decisión técnica posterior debe demostrar que mejora alguno de esos resultados medidos y presupuestar su efecto económico. El caso de negocio no impone pila tecnológica.

## 8. Referencias citadas en el original

SECUTIX (Access Control; caso TuBoleta), pretix (pretixSCAN Proxy; precios), Osterwalder, Pigneur y Tucci (2005), Teece (2010), TicketSpice, Lemon.io, Computrabajo, Alegra, Skok (SaaS Metrics 2.0), Google OKR Playbook, Weezevent (WeezAccess), Crowder, Quentro, DigitalOcean, Grafana Labs, GitHub, Ley 1581 de 2012, DIMAYOR y PULEP.

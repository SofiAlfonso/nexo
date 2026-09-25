# Resumen del taller 2: entregables arquitectónicos de NEXO

Resumen autocontenido de los entregables del taller 2 (Ana Sofía Alfonso Moncada, Santiago Álvarez Peña y Tomás Olarte Hernández; Arquitecturas Avanzadas de Software, septiembre de 2026). El caso de negocio que los origina está resumido en [taller1.md](taller1.md).

Convención de estados usada en todo el taller 2: "aceptado" es una decisión vigente; "propuesto", un recurso por validar; "pendiente de PoC", un mecanismo que debe superar pruebas; "por acordar", una dependencia externa sin resolver. Ningún entregable del taller 2 presenta resultados medidos: todas las metas son por demostrar, y el taller 3 es la primera implementación.

## 1. Índice de entregables

| N.º | Entregable | Archivo original | Sección de este resumen |
|---|---|---|---|
| 01 | Modelo de dominio | `NEXO_01_ModeloDominio.pdf` / `.tex` | 2 |
| 02 | Registro de decisiones (ADR-001 a ADR-013) | `NEXO_02_ADRs_001-al-005.xlsx`, `NEXO_02_ADRs_006-al-013.xlsx` | 3 |
| 03 | Arquitectura de referencia | `NEXO_03_ArquitecturaReferencia.pdf` / `.tex` | 4 |
| 04 | Arquitectura de implementación y configuración | `NEXO_04_ArquitecturaImplementacion.pdf` / `.tex`, `NEXO_04_Configuracion.json` | 5 |
| 05 y 06 | Clases y secuencia del primer ingreso | `NEXO_05_06_PrimerIngreso.pdf` / `.tex` | 6 |
| 07 | Prototipo de interfaz | `NEXO_07_Prototipo.zip` (carpeta `NEXO_07_Prototipo/`), `NEXO_07_Prototipo-Manual.pdf` | 7 |
| 08 | Plataforma de observabilidad | `NEXO_08-11_Volumetria-Fallas-Observabilidad.pdf` / `.tex` | 8 |
| 09 | Plan de pruebas unitarias | mismo documento 08-11 | 9 |
| 10 | Volumetría | mismo documento 08-11 | 10 |
| 11 | Módulo de inyección de fallos | mismo documento 08-11 | 11 |

## 2. Modelo de dominio (entregable 01)

### 2.1 Subdominios y límites

- Dominio central: control de acceso y conciliación.
- Soporte comercial: contratación y liquidación.
- Actor externo: la boletería, que emite permisos, cambios y anulaciones.
- Fuera del modelo: venta de entradas, pagos de asistentes, biometría, seguridad física, inventario de lectores, contabilidad general, TAM, CAC, financiación y presupuesto de infraestructura.

El control de acceso conserva lo decidido con la información disponible en puerta; la conciliación revisa esa evidencia sin reescribirla; el soporte comercial usa las admisiones conciliadas para cobrar, sin decidir autorizaciones. Estos límites separan responsabilidades, no imponen servicios ni bases de datos independientes.

### 2.2 Lenguaje ubicuo

| Término | Significado |
|---|---|
| Cliente | Organización que contrata y paga. |
| Contrato | Acuerdo vinculante con eventos incluidos y tarifa; puede cubrir temporada y eventos gratuitos. |
| Recinto | Lugar físico reutilizable. |
| Evento | Unidad de operación contratada, en un recinto, con ventana de ingreso. |
| Zona | Localidad o área autorizable de un evento. |
| Punto de validación | Lugar habilitado para recibir intentos y comunicar decisiones; puede cambiar de lector. |
| Lector | Dispositivo que recibe la presentación y comunica la decisión; es un dato de asignación, no entidad. |
| Boletería | Proveedor externo; aparece como `Evento.boleteriaOrigen`. |
| Boleta | Permiso emitido para un evento; no representa al portador ni equivale al texto del QR. |
| Regla de validación | Condición por puerta, zona, horario, uso y contingencia (`Boleta.permisosVersionados`, `Evento.politicasVersionadas`). |
| Anulación | Cambio de la boletería que invalida un permiso. |
| Intento de validación | Presentación de un código en un punto; una retransmisión no crea otro intento. |
| Validación | Decisión de aceptar o rechazar con la información disponible. |
| Admisión | Primera aceptación correcta de una boleta para ingresar, una vez por boleta y evento. |
| Conciliación | Cierre que reúne decisiones únicas y resuelve pendientes sin borrar evidencia. |
| Liquidación | Importe del servicio por evento y seguimiento de cobros, saldo o devolución. |
| Recompra | Nueva contratación vinculante del mismo cliente para eventos no comprometidos antes. |

### 2.3 Entidades y atributos

| Entidad | Identidad | Atributos |
|---|---|---|
| `Cliente` | `id: ClienteId` | `razonSocial` |
| `Contrato` | `id: ContratoId` | `fechaAcuerdoVinculante`, `origenContratacion`, `tarifaAcordada: Tarifa`, `/esRecompra` |
| `Recinto` | `id: RecintoId` | `nombre`, `capacidad: EnteroPositivo` |
| `Evento` | `id: EventoId` | `boleteriaOrigen`, `ventanaIngreso`, `admisionesEstimadas`, `estado`, `modalidadCobro`, `politicasVersionadas` |
| `Zona` | `id: ZonaId` | `nombre` |
| `PuntoDeValidacion` | `id: PuntoId` | `ubicacion`, `habilitacion`, `modoOperacion`, `ultimaComunicacion`, `versionDisponible`, `asignacionesDeLector`, `alertasEIncidentes` |
| `Boleta` | `referenciaExterna` dentro de evento y boletería | `estadoConocido`, `permisosVersionados`, `historialDeCambios` |
| `IntentoDeValidacion` | `idOrigen` estable dentro del evento | `referenciaPresentada`, `lectorOrigen`, `fechaHora`, `proposito`, `zonaSolicitada?`, `decision`, `motivo`, `evidenciaAplicada`, `fechaConsolidacion?` |
| `Conciliacion` | `id: ConciliacionId` | `estado`, `entregaPreliminar?`, `entregaDefinitiva?`, `coberturaYPendientes`, `diferenciasYResoluciones` |
| `LiquidacionDeEvento` | `id: LiquidacionId` | `admisionesFacturables`, `importeServicio: Dinero`, `descuentosAcordados`, `cobrosYDevoluciones`, `costosAtribuibles` |

`DecisionValidacion` distingue `pendiente`, `aceptada` y `rechazada`; pendiente no significa autorizado. `EstadoConciliacion` distingue preparación, preliminar, excepción y conciliado. `fechaConsolidacion` indica recepción central, no autorización ni llegada física.

Objetos de valor: `Tarifa`, `BoleteriaOrigen`, `VentanaIngreso`, `PoliticaVersionada` (versión, vigencia, reglas de uso, reingreso y contingencia), `PermisoVersionado` (zonas, puntos, horarios y usos), `AsignacionLector`, `EvidenciaAplicada` (modo conectado o local, versiones, regla evaluada, resultado), `DiferenciaConciliacion`, `CambioBoleta`, `RegistroIncidente`, `CoberturaConciliacion`, `Descuento`, `MovimientoLiquidacion`, `CostoAtribuible`.

### 2.4 Agregados

Ocho raíces: `Cliente`, `Recinto`, `Contrato`, `Evento`, `Boleta`, `IntentoDeValidacion`, `Conciliacion`, `LiquidacionDeEvento`. `Zona` y `PuntoDeValidacion` pertenecen al agregado de `Evento`. Referenciar otro agregado no da propiedad sobre su ciclo de vida.

Relaciones principales: Cliente 1 a Contrato 0..*; Contrato 1 a Evento 1..*; Evento 0..* a Recinto 1; Evento 1 a Zona 0..* y a PuntoDeValidacion 0..*; PuntoDeValidacion 0..* a Zona 0..*; Evento 1 a Boleta 0..*; Boleta 0..* a Zona 0..* según versión; PuntoDeValidacion 1 a IntentoDeValidacion 0..*; Boleta 0..1 a IntentoDeValidacion 0..* (un código puede no resolverse); Evento 1 a Conciliacion 0..1 y a LiquidacionDeEvento 0..1.

### 2.5 Reglas de negocio

| Regla | Contenido |
|---|---|
| RN-01 | Cada evento pertenece al cliente de su contrato; zonas, puntos, permisos, intentos y cierres corresponden al mismo evento. |
| RN-02 | La boleta se identifica por evento, boletería y referencia externa estable. Un código desconocido se registra en `referenciaPresentada` sin fabricar una boleta. |
| RN-03 | Cada intento tiene un `idOrigen` estable y único dentro del evento. Retransmitir no crea otra decisión; volver a presentar sí crea otro intento. |
| RN-04 | Solo la primera aceptación correcta con propósito de ingreso genera una admisión por boleta y evento. |
| RN-05 | Aceptar exige zona identificada, punto habilitado, horario válido, permiso vigente y política aplicable; el intento conserva `evidenciaAplicada`. |
| RN-06 | El modo local de contingencia requiere restricciones y coordinación aprobadas; la precarga no acredita conocer anulaciones posteriores. |
| RN-07 | Una aceptación o rechazo emitidos se conservan con su evidencia (inmutables). |
| RN-08 | Preliminar hasta 30 min y definitivo conciliado hasta 24 h desde el fin de `ventanaIngreso`; exige cobertura de todos los puntos y resolución documentada de pendientes y diferencias. |
| RN-09 | Tarifa: USD 500 por evento más USD 0,40 por admisión desde la primera; se respetan gratuidad y descuentos acordados. |
| RN-10 | Boletas y registros no incluyen identidad, contactos, pagos ni biometría del asistente. |
| RN-11 | `/esRecompra` es verdadero con contrato previo del mismo cliente y un nuevo acuerdo vinculante con al menos un evento adicional; no cuentan renovaciones automáticas. |
| RN-12 | Anticipo de USD 500 más 50 % del uso estimado; saldo ajustado al uso real y cobrado hasta 30 días después de conciliar; el exceso se devuelve. |

## 3. Registro de decisiones (entregable 02)

Cuatro ADR aceptados (001, 003, 004, 006) y nueve pendientes de PoC. Fecha de revisión: 14 de septiembre de 2026.

| ADR | Título | Estado | Decisión | Alternativas descartadas | Consecuencias y criterio de aceptación |
|---|---|---|---|---|---|
| 001 | Estilo por capas con núcleo central como monolito modular | Aceptado | Capas (canales, aplicación, dominio, infraestructura) y módulos de negocio M1 a M4 dentro de un solo núcleo. | Microservicios; monolito no modular; dirigido por eventos como estilo principal; cliente-servidor sin núcleo. | El núcleo escala como conjunto; hay que verificar dependencias entre módulos. Microservicios solo ante necesidad demostrada. |
| 002 | Validación síncrona mediante coordinador local compartido, sin depender de la nube por escaneo | Pendiente de PoC | Un coordinador local por evento decide; la nube solo sincroniza y observa después. | Nube por escaneo; cola en memoria; "exactly once" del transporte; intermediario durable como solución completa. | Al menos 95 % en 500 ms; modo local sin internet; encolar no es aceptar; identidad persistente e idempotencia; sincronizar no concede otro uso. |
| 003 | Consumo atómico y global del único ingreso de cada boleta | Aceptado (PoC bloqueante en NEXO_04) | Un consumo global atómico por boleta; la primera confirmación gana, las demás se rechazan. | Consumo por punto o turno; aceptar duplicados; contadores no atómicos. | Clave de consumo independiente de zona, punto y lector; nunca reinicializar un consumo. |
| 004 | Bitácora de solo adición e idempotente como fuente de conciliación y admisiones facturables | Aceptado | Bitácora append-only e idempotente para auditoría, conciliación y facturación. | Actualizar o borrar; solo estado derivado; logs operativos; sobrescribir. | Resoluciones por adición; retención de 90 días; no obliga a event sourcing para todo el estado. |
| 005 | Recuperación segura del coordinador y selección de topología mediante PoC y piloto | Pendiente de PoC | No fijar topología; comparar tres candidatas: nodo durable único, primario con réplica síncrona y promoción manual segura, plataforma de tres nodos con mayoría. | Promover copia atrasada; activo-activo multirregión; reabrir con estado incierto. | Cero consumos confirmados perdidos; excluir la autoridad anterior; sin estado cierto no se autoriza. Selección al cerrar el tercer piloto. |
| 006 | Modelo de datos sin identidad del portador | Aceptado | Solo `IntentoDeValidacion` y `Boleta`; ningún dato del asistente. | Capturar identidad o biometría; guardar comprador; persistir todo y ocultar en UI. | Excluir nombres, documentos, contactos, pagos y biometría de integración, logs, colas y respaldos. |
| 007 | Modelo canónico de ingesta con adaptador delgado por boletería | Pendiente de PoC | Modelo canónico de permisos y anulaciones con un adaptador por boletería; diferencias entre eventos por configuración. | Integraciones por evento; exigir que el proveedor adopte el contrato de NEXO; esperar un estándar. | Cero desarrollo por evento; no asumir QR dinámicos ni anulaciones sin interfaz autorizada. |
| 008 | Identidad y confianza de los dispositivos | Pendiente de PoC (bloqueante) | Credencial individual por lector, autenticación mutua con el coordinador, respuestas vinculadas a intento, lector y alcance. | Clave compartida; confiar en la LAN o VPN; exigir hardware propio. | Credenciales revocables aun sin internet; antirrepetición; si el lector no puede registrar el intento no se aceptan nuevos accesos. |
| 009 | Aislamiento lógico y autorización por cliente y evento | Pendiente de PoC | PostgreSQL compartido con RLS más autorización en aplicación; el cliente se deriva de la identidad autenticada. | Filtros solo en código; instancia por cliente; cuenta compartida. | Aislamiento en consultas, archivos, paneles y trabajadores; probar conexiones reutilizadas y roles sin elusión. |
| 010 | Resolución de credenciales y actualización de permisos | Pendiente de PoC (bloqueante) | Contrato con el proveedor para resolver credenciales y actualizar permisos versionados, compatible con QR dinámico. | Consultar al proveedor en cada escaneo; sondeo sin garantía; archivo estático; usar el texto del QR como identidad; solo webhooks. | No comprometer piloto sin resolución autorizada; probar rotación, anulación y cortes de 15 min. |
| 011 | Separación entre validación síncrona y sincronización recuperable | Pendiente de PoC | Validación síncrona y decisiva; sincronización al menos una vez, con deduplicación. | Colas en memoria; "exactly once"; Kafka como requisito; omitir deduplicación. | Diarios locales; lotes con reintento y prioridad baja; 99,5 % de pendientes en 5 min; 95 % visible en 5 s. |
| 012 | Persistencia de auditoría y recuperación ante fallas | Pendiente de PoC | Separar estado autoritativo local, réplica central para seguimiento y archivo verificable de 90 días. Persistir consumo, decisión, idempotencia y salida de auditoría antes de responder. | Solo objetos; usar copias de 7 días o logs de 30 como auditoría; confiar solo en el standby; activo-activo multirregión. Retener 90 días en PostgreSQL queda en evaluación. | Restauraciones probadas; tras recuperar, volver a presentar boletas consumidas y exigir rechazo. |
| 013 | Observabilidad de extremo a extremo separada de la auditoría | Pendiente de PoC | OpenTelemetry en lector, coordinador, sincronización y panel; medir de extremo a extremo. | Solo logs al cierre; solo métricas de servidor; muestreo indiscriminado. | Denominador completo; reloj monotónico en el lector; la boleta no es etiqueta métrica; la caída de telemetría no detiene la validación. |

## 4. Arquitectura de referencia (entregable 03)

### 4.1 Idea de organización

Separar decidir el acceso de consolidar su evidencia. Los lectores consultan una autoridad local compartida por evento, que decide y confirma durablemente antes de responder. El núcleo central configura, recibe evidencia, concilia y liquida, pero no autoriza cada escaneo. La sincronización puede retrasarse sin convertir a los lectores en autoridades independientes.

C1 a C5 son identificadores propios de NEXO, no niveles del modelo C4. D1 a D3 son estados lógicos, no productos.

### 4.2 Componentes

| Elemento | Responsabilidad y límite | Ofrece / consume |
|---|---|---|
| C1. Cliente de puerta | Registra la presentación, pide y comunica el resultado; mantiene diario y supresión de repeticiones. No decide. | Consume V1 y H1; emite O1. |
| C2. Autoridad local | Resuelve credenciales, evalúa reglas y coordina el consumo único; una sola autoridad lógica por evento. | Ofrece V1 y H1; consume P2, T1, E1. |
| C3. Adaptador de boletería | Traduce permisos y cambios al modelo canónico; no decide. Es un adaptador de M1. | Consume el contrato del proveedor y P1. |
| C4/M1. Configuración y permisos | Recintos, eventos y permisos versionados sin restablecer consumos. | Ofrece P1, P2, B1, O2. |
| C4/M2. Ingesta de intentos | Consolida evidencia idempotente; no vuelve a autorizar. | Ofrece E1, B2, O2. |
| C4/M3. Conciliación | Cobertura, diferencias por adición y derivación de admisiones. | Ofrece B3; consume B1, B2. |
| C4/M4. Contratación y liquidación | Cliente, contrato, tarifa, cobros, saldo y devolución. | Ofrece B4; consume B1, B3. |
| C5. Canales de operación | Configuración, seguimiento y cierre según rol; sin reglas de cobro ni autorización. | Consume O2. |
| D1. Estado local | Permisos, intentos, consumo, decisión, evidencia y outbox; no hay aceptación antes del commit. | T1 para C2. |
| D2. Datos centrales | Operación por módulo y evidencia consolidada. | R1 por módulo. |
| D3. Archivo | Evidencia verificable durante 90 días. | A1. |
| S1. Seguridad | Autentica lector y usuario, limita cliente y evento, minimiza datos. | Transversal. |
| O1. Observabilidad | Mide el recorrido completo, acumulaciones y alertas; no condiciona el commit. | Recibe de C1, C2, C4 y C5. |

Custodia de escrituras: M1 posee `Recinto`, `Evento` (con `Zona` y `PuntoDeValidacion`) y `Boleta`; M2, `IntentoDeValidacion`; M3, `Conciliacion`; M4, `Cliente`, `Contrato` y `LiquidacionDeEvento`. Consultar otro módulo no permite escribir sus datos, aunque compartan base.

### 4.3 Contratos

| Contrato | Garantía |
|---|---|
| V1. Validación | C1 envía `idOrigen`, contenido estable, punto, propósito y zona. Mismo identificador y contenido recupera el resultado; distinto contenido se rechaza. Sin respuesta utilizable no se habilita paso. |
| T1. Transacción | Consumo, decisión, idempotencia y outbox en una sola transacción. Unicidad del consumo y deduplicación del intento son garantías distintas. |
| H1. Recuperación histórica | C1 entrega su diario a C2 por un receptor separado de V1; recupera evidencia sin nueva autorización. |
| E1. Consolidación | C2 envía lotes a M2 al menos una vez; M2 deduplica por intento y alcance. Un acuse no basta para borrar copias locales. |
| P1. Importación | Contrato externo con resolución autorizada, instantánea y recuperación de cambios. No se presume API pública, webhook ni QR dinámico. |
| P2. Distribución | M1 entrega a C2 permisos y políticas con origen, versión, vigencia y firma; C2 controla retrocesos, huecos y antigüedad. |
| O2. Operación | Casos de uso y consultas de cada módulo para C5 según rol; sin acceso directo a tablas. |
| B1 a B4 | Consultas internas: B1 configuración, B2 evidencia y cobertura, B3 cierre y admisiones, B4 contratación. En proceso, sin transporte remoto. |
| R1 y A1 | Repositorios por dueño de escritura; archivo con verificación de cobertura, integridad y lectura. |

### 4.4 Modos de operación

- Conectado: la autoridad local se comunica con el núcleo.
- Contingencia local: se mantiene la LAN y una autoridad válida aunque se pierda el enlace central.
- Un lector aislado no autoriza.
- Si vence el plazo de V1 sin respuesta, puede existir un consumo ya confirmado: C1 registra la incertidumbre, no habilita el paso, no inventa rechazo y no consulta otra autoridad.
- Si falla la autoridad, solo se reabre con consumos completos y excluyendo a la anterior. Una copia atrasada o la nube no se promueven por timeout.

### 4.5 Patrones declarados

| Patrón | ADR | Problema | Costo o límite |
|---|---|---|---|
| Capas y monolito modular | 001 | Separar reglas, coordinación y tecnología sin servicios independientes. | Escala como conjunto; nombrar módulos no evita acoplamiento. |
| Puertos y adaptadores | 001, 007 | Dominio independiente de SQL, transporte y boletería. | Más interfaces y traducciones. |
| Autoridad única y consumo transaccional | 002, 003, 005 | Evitar dos ganadores ante copias concurrentes. | Depende de LAN y estado durable; ante partición se sacrifica continuidad. |
| Outbox transaccional y consumidor idempotente | 004, 011 | Unir decisión y evidencia en un commit, con envío recuperable. | Acumulación y limpieza a gestionar. |
| Bitácora de solo adición | 004, 012 | Reconstruir qué se decidió y por qué se factura. | Retención y recuperación probada; no obliga a event sourcing. |

No se adopta arquitectura dirigida por eventos como estilo principal ni se exige broker. RabbitMQ o MQTT pueden evaluarse para transporte asíncrono; Kafka no es requisito.

### 4.6 Escenarios de atributos de calidad

| ID | Estímulo | Medida |
|---|---|---|
| Q1 | Solicitudes bajo carga, conectado y local | Al menos 95 % en 500 ms por prueba, evento y modo; tardías y sin respuesta en el denominador. |
| Q2 | Copias simultáneas de una boleta | Sin fallas, exactamente una aceptación; con fallas, a lo sumo una; cero dobles consumos. |
| Q3 | Corte de internet, servicio central o integración | Ensayos de 15 min sin doble aceptación ni pérdida. |
| Q4 | Caída de autoridad o pérdida de respuesta | Cero consumos confirmados perdidos. |
| Q5 | Retorno de comunicación con acumulación | Al menos 99,5 % consolidado en 5 min, manteniendo Q1. |
| Q6 | Validación o pérdida de comunicación de un punto | 95 % visible en 5 s; desconexión visible en 60 s; 80 % de alertas con actuación en menos de 5 min. |
| Q7 | Lecturas, errores y cortes | Cero pérdida; 99,9 % de campos completos; falsos rechazos hasta 0,5 %. |
| Q8 | Fin de la ventana de ingreso | Preliminar en 30 min, definitivo en 24 h, evidencia 90 días. |
| Q9 | Acceso a otro evento o cliente | Ningún acceso cruzado en batería negativa. |
| Q10 | Eventos 2 y 3 del mismo proveedor | Cero desarrollo específico; preparación hasta 3 h y cierre hasta 1 h. |

Carga de referencia: 15.000 admisiones en una hora con factor pico de tres dan 12,5 decisiones por segundo por evento y 37,5 para tres eventos.

### 4.7 Tecnologías

| Área | Mecanismo | Estado |
|---|---|---|
| Persistencia central | PostgreSQL gestionado, RLS donde corresponda | PostgreSQL es premisa presupuestal; RLS pendiente (ADR-009). |
| Persistencia local | Motor transaccional durable con unicidad; PostgreSQL candidato | Abierto (ADR-003, 005). |
| Transporte | Solicitud síncrona local y lotes HTTPS; mTLS | Propuesta (ADR-008, 011). |
| Auditoría y archivo | Base operativa más objetos, o todo en PostgreSQL | Alternativas de ADR-012. |
| Observabilidad | OpenTelemetry y backend gestionado o autogestionado | ADR-013. |
| Ejecución | Lenguaje, framework, runtime y nube | No fijados; cada elección requiere ADR propio. |

## 5. Arquitectura de implementación (entregable 04)

### 5.1 Unidades desplegables

| Referencia | Implementación | Estado |
|---|---|---|
| C1 | Aplicación en cada lector; persiste `idOrigen` antes de enviar | ADR-008 pendiente. |
| C2 y D1 | Autoridad y motor durable en el recinto | Producto, runtime y recuperación pendientes. |
| C3 | Adaptador dentro de C4, no servicio independiente | Contrato del proveedor por acordar. |
| C4 | Aplicación central sin sesión local y trabajadores en dos máquinas, mismo artefacto | ADR-001 aceptado; runtime pendiente. |
| C5 | Aplicación web servida por C4 | Identidad de operadores por seleccionar. |
| D2 | PostgreSQL gestionado, primario y réplica de espera en otra zona | RLS y promoción por probar. |
| D3 | Archivo de objetos, o retención completa en D2 | Por validar. |
| O1 | OpenTelemetry y backend por elegir | ADR-013 pendiente. |

C4 conserva las capas: canales, aplicación, dominio e infraestructura; el dominio no depende de SQL ni HTTP. C2 es una unidad separada con la misma dirección de dependencias.

### 5.2 Topología y fronteras

- Nube sin proveedor elegido; candidata de dos zonas. VPC `10.20.0.0/16`. Zona A: pública `10.20.1.0/24`, aplicación `10.20.2.0/24`, datos `10.20.3.0/24`. Zona B: `10.20.11.0/24`, `10.20.12.0/24`, `10.20.13.0/24`.
- Balanceador HTTPS delante de dos servidores con el mismo artefacto C4/C3/C5; servidores sin IP pública; D2 solo accesible desde aplicación.
- El recinto inicia E1 y la descarga de P2 por HTTPS saliente; no se publican puertos entrantes en el recinto. VLAN de validación separada de invitados, que no autentica por sí sola.
- El lector localiza a C2 por DNS del recinto con dirección reservada.

| Frontera | Control |
|---|---|
| Lector a C2 | mTLS, credencial individual limitada a cliente, evento, punto y periodo; plazo total 500 ms. |
| Recinto a nube | Conexión saliente, autenticación mutua propuesta, deduplicación, firma de P2. |
| Internet a balanceador | TLS 1.2 o superior, autenticación, límites de solicitud. |
| C4 a D2 | Subred privada, TLS, roles por módulo, RLS candidata. |
| C4 a D3 | Credencial restringida, cifrado en reposo, verificación de lectura. |
| Boletería a C3 | Especificación autorizada, firma y minimización antes de persistir; por acordar. |

### 5.3 Ambientes y configuración

| Ambiente | Recursos | Datos y pruebas | Retención |
|---|---|---|---|
| Desarrollo | Procesos locales y colector OTLP; C2/D1 y C4/D2 en una estación con bases y credenciales separadas | Sintéticos; unitarias e integración | 7 días |
| Pruebas | Nube reducida y equipo local de ensayo; debe reproducir fronteras y fallas | Sintéticos; carga, concurrencia, fallos, restauración | 30 días |
| Piloto | Dos zonas, balanceador, base con réplica, archivo, observabilidad, conjunto local | Reales; sin inyección disruptiva durante el ingreso | Evidencia 90, logs 30 |

Imágenes identificadas por digest, sin recompilar al promover; secretos fuera del repositorio e inyectados en ejecución; migraciones compatibles hacia atrás. Contenido de `NEXO_04_Configuracion.json` (estado `"propuesta-no-desplegable"`):

```json
{
  "versionEsquema": 1,
  "estado": "propuesta-no-desplegable",
  "decisionesPendientes": { "runtime": null, "proveedorNube": null, "gestorSecretos": null, "identidadOperadores": null },
  "pilotoCentral": {
    "regiones": 1, "zonasAcreditadas": 1, "maquinasAplicacion": 2, "vCpuPorMaquina": 4, "memoriaGiBPorMaquina": 8,
    "base": "PostgreSQL gestionado con standby", "vCpuBase": 2, "memoriaGiBBase": 4,
    "redesCandidatas": { "vpc": "10.20.0.0/16", "publica": "10.20.1.0/24", "aplicacion": "10.20.2.0/24", "datos": "10.20.3.0/24" }
  },
  "imagenes": { "central": null, "validador": null },
  "ambientes": [
    { "ambiente": "dev", "eventoId": "sintetico-dev", "modoAutoridad": "nodo-unico", "plazoValidacionMs": 500, "loteEvidenciaMax": 100,
      "retencionEvidenciaDias": 7, "retencionTelemetriaDias": 7, "destinoLocal": null, "destinoOtlp": "http://localhost:4318",
      "secretosRef": { "dispositivos": null, "servicio": null, "d1": null, "d2": null, "d3": null, "otlp": null } },
    { "ambiente": "test", "eventoId": "sintetico-test", "modoAutoridad": "nodo-unico", "plazoValidacionMs": 500, "loteEvidenciaMax": 100,
      "retencionEvidenciaDias": 30, "retencionTelemetriaDias": 30, "destinoLocal": null, "destinoOtlp": null, "secretosRef": { "dispositivos": null, "servicio": null, "d1": null, "d2": null, "d3": null, "otlp": null } },
    { "ambiente": "piloto", "eventoId": null, "modoAutoridad": "nodo-unico", "plazoValidacionMs": 500, "loteEvidenciaMax": 100,
      "retencionEvidenciaDias": 90, "retencionTelemetriaDias": 30, "destinoLocal": null, "destinoOtlp": null, "secretosRef": { "dispositivos": null, "servicio": null, "d1": null, "d2": null, "d3": null, "otlp": null } }
  ],
  "promocion": { "revision": null, "migraciones": [], "evidenciaPruebas": null, "aprobacion": null }
}
```

Reglas del esquema: campos desconocidos o ausentes se rechazan; `modoAutoridad` es `nodo-unico` como candidata y otras topologías solo en test; lote inicial de 100 y límite candidato de 1.000; HTTP solo para el colector en localhost de desarrollo; imágenes por SHA-256; secretos como `ref:nombre`, nunca su valor; los `null` no son desplegables.

### 5.4 Integraciones

| Integración | Protocolo | Formato | Sincronía | Error y reintento |
|---|---|---|---|---|
| V1. C1 a C2 | HTTPS con mTLS | JSON | Síncrona, plazo total | Mismo `idOrigen` y contenido recupera el resultado; conflicto se rechaza; sin respuesta no hay paso. |
| H1. C1 a C2 | HTTPS local con mTLS | JSON por lotes | Asíncrona | Al menos una vez; conserva pendiente si no hay decisión. |
| T1. C2 a D1 | Puerto transaccional local | Según motor | Síncrona | Nunca responde aceptación antes del commit. |
| R1. C4 a D2 | PostgreSQL con TLS | SQL parametrizado | Por transacción | Reintento acotado; ante commit incierto consultar la identidad de la operación. |
| E1. C2 a C4 | HTTPS saliente | JSON comprimido en lotes | Asíncrona, al menos una vez | Espera creciente con tope; prioridad inferior a V1; deduplicación por intento y alcance. |
| P2. C4 a C2 | HTTPS solicitado por el recinto | JSON firmado | Asíncrona | Recupera huecos; rechaza firma inválida, retroceso y paquete de otro evento. |
| P1. Boletería a C3 | Por acordar | Por acordar | Por acordar | Bloquea el compromiso del piloto hasta probar actualización recuperable. |
| O2. Navegador a C5/C4 | HTTPS y canal en vivo | JSON | Consulta y estado continuo | Reconexión recupera estado; la caída del panel no detiene V1. |
| O1. Componentes al backend | OTLP sobre HTTPS | Métricas, trazas, logs | Asíncrona | Cola acotada, descarte registrado; no condiciona el commit. |
| A1. C4 a D3 | HTTPS, API por elegir | Lotes de evidencia | Asíncrona | Reintento idempotente; no retira datos sin verificar. |

Contenido de V1: `idOrigen`, referencia, evento, punto, lector, propósito, zona y hora; devuelve decisión, motivo y evidencia. Límite canónico de P1 hacia M1: identidad estable (cliente, evento, boletería, referencia externa), permisos, anulaciones, origen, versión y vigencia; repetir versión y contenido es idempotente y nunca reinicia consumos.

### 5.5 Dimensionamiento y latencia

- 15.000 admisiones en una hora dan 4,17 admisiones por segundo; con 1,3 a 1,7 intentos por admisión, V1 recibe 5,42 a 7,08 solicitudes por segundo en promedio y 16,25 a 21,25 en pico por evento. Tres eventos simultáneos: 48,75 a 63,75, no exigibles a cada coordinador.
- Presupuesto de latencia de diseño medido desde C1: persistir intento 40 ms, ida por LAN 80 ms, evaluación y transacción en C2/D1 200 ms, vuelta 80 ms, comunicar 50 ms. Total 450 ms frente al umbral de 500 ms.
- Evidencia: 1,5 KB por registro; 29,25 a 38,25 MB por evento.

### 5.6 Comportamiento ante fallas

| Falla | Respuesta |
|---|---|
| Pérdida de internet o de C4 | C2 continúa con casos elegibles y versiones instaladas; acumula E1; no presume anulaciones no recibidas. |
| Pérdida de respuesta V1 | C1 registra incertidumbre y no habilita el paso; repetir el mismo intento consulta el resultado. |
| Falla de C2 o D1 | Se detienen nuevas aceptaciones; solo se reabre con consumos completos. |
| Caída de una máquina central | Retirarla del balanceador y reponerla desde el artefacto. |
| Caída de zona o región | Riesgo residual; C2 mantiene operación local elegible. |
| Acumulación de E1 | Lotes acotados con prioridad inferior a V1; 99,5 % en 5 min. |
| Error lógico replicado | Restaurar respaldo independiente; la réplica no sustituye el respaldo. |

Puerta de promoción: CA1 (cortes de 15 min), CA2 (95 % en 500 ms por modo), CA3 (rechazo de casos inválidos conocidos, incluidos duplicados concurrentes), CA4 (límites de USD 345, 450 y 600).

### 5.7 Seguridad

Amenazas y controles: doble ingreso (unicidad en T1); lector suplantado (mTLS y credencial individual); lector perdido (revocación persistida en C2 aun sin internet); repetición de aceptación (respuesta vinculada a intento, lector y contenido); acceso cruzado (autorización por alcance, RLS); filtración de secretos (secretos externos); datos personales inesperados (lista permitida y minimización); alteración de evidencia (solo adición); robo del equipo local (volumen cifrado); saturación por históricos (prioridad a V1 y límites de recursos).

### 5.8 Persistencia y respaldo

| Dato | Almacén | Retención | Recuperación |
|---|---|---|---|
| Consumos y decisiones | D1 | Hasta cierre verificado | Restaurar y volver a presentar boletas consumidas para comprobar rechazo. |
| Evidencia consolidada | D2 | Hasta archivo | Respaldo independiente del standby. |
| Archivo de negocio | D3 o D2 | 90 días | Lectura por lote y reconstrucción de un cierre. |
| Logs técnicos | Backend O1 | 30 días | No reconstruyen decisiones ni facturación. |

RPO de D1: cero consumos confirmados para las fallas habilitadas. El nodo único no lo garantiza ante destrucción total del disco. Respaldo diario de D2 y recuperación a un instante por WAL durante al menos siete días.

### 5.9 Decisiones abiertas al cierre del taller 2

Acordar P1 con la boletería; seleccionar runtime, proveedor de nube y gestor de secretos por ADR; aprobar o descartar las dos zonas; aprobar identidad de operadores y RPO/RTO; ejecutar PoC de consumo único, autenticación, aislamiento, recuperación, restauración y carga; registrar una promoción reproducible; elegir topología local al cerrar el tercer piloto. Mientras P1, ADR-003, ADR-005, ADR-008 y la restauración no cumplan sus pruebas, NEXO no opera con público.

## 6. Clases y secuencia del primer ingreso (entregables 05 y 06)

### 6.1 Caso

"Validar una boleta para su primer ingreso al evento". El operador presenta la credencial en un lector y recibe aceptación, rechazo o falta de respuesta; NEXO decide con los permisos y políticas de la autoridad local; el operador permite o impide el paso. Incluye presentación nueva, rechazo por reglas, retransmisión del mismo intento, conflicto de contenido, timeout y competencia entre dos puertas. Excluye reingresos, validaciones internas entre zonas, configuración, integración de cambios de la boletería, conciliación y liquidación. Reglas usadas: RN-01, 02, 03, 05, 06, 07 y 10; ADR-002, 003 y 004.

Condiciones: lector autenticado y asignado a un punto del evento; el alcance (cliente, evento, punto, lector) sale de la identidad técnica, no de la solicitud. La validez de boleta, zona, horario y permisos se verifica durante el caso. Cada presentación crea un `idOrigen` estable que se persiste antes de transmitir.

Resultados: la aceptación confirma consumo, decisión, evidencia y salida de auditoría en la misma transacción; el rechazo confirma decisión y evidencia sin consumo; la falta de respuesta nunca autoriza ni libera la boleta; repetir el mismo intento recupera su resultado.

### 6.2 Clases

| Clase | Operaciones | Papel |
|---|---|---|
| `Evento` | `admiteHorario`, `politicaPara` | Ventana y política aplicable. |
| `PuntoDeValidacion` | `habilita` (exige `ZonaId`) | Pertenencia al evento y habilitación del lector para zona e instante. |
| `Zona` | | Destino solicitado. |
| `Boleta` | `evaluarPermiso` | Identidad estable y permisos; no confirma consumo. |
| `IntentoDeValidacion` | `registrarDecision` | Distingue contenido repetido de presentación nueva; no se sobrescribe. |
| `LectorAcceso` | `presentar`, `comunicar`, `sinRespuesta` | Dispositivo; tiene un `DiarioLector` propio (1 a 1). |
| `DiarioLector` | `persistirNuevo`, `reservarComunicacion`, `registrarResultadoLocal` | Persistencia previa al envío y reserva antes de comunicar aceptación. |
| `ValidarPrimerIngreso` | `ejecutar` | Servicio de aplicación; usa una `UnidadValidacion` por solicitud. |
| `UnidadValidacion` (puerto) / `UnidadValidacionLocal` (adaptador) | `abrir`, `cargarParaActualizar`, `confirmar`, `cancelar` | Acceso a datos y unidad de trabajo sin SQL en el dominio. |
| `MotorPrimerIngreso` | `evaluar` | Evalúa reglas sin consultar persistencia; produce elegibilidad, no consumo. |

Valores y resultados: `ContextoIngreso` (entidades, alcance, hora, versiones y antigüedad de permisos; puede carecer de boleta o zona), `EvaluacionIngreso` (elegibilidad, motivo, evidencia; aún no autoriza), `ResultadoValidacion` (decisión confirmada y correlación con el intento), `AlcanceAutenticado`, `Apertura` con `EstadoApertura`, `EstadoComunicacion`, `ConsumoIngreso` (registro técnico de unicidad).

Clave de consumo: cliente, evento, boletería, referencia externa y propósito `PRIMER_INGRESO`. Excluye zona, punto y lector para impedir consumos independientes en puertas distintas. `cargarParaActualizar` serializa validación y cambios de permisos de la misma boleta; la exclusión es por boleta, no por evento. `reservarComunicacion` devuelve verdadero solo tras crear una reserva durable nueva; error o incertidumbre nunca es verdadero.

### 6.3 Secuencias

1. Decisión de un intento nuevo: el lector persiste; el servicio abre la unidad, carga el contexto, evalúa y confirma; la respuesta sale después del commit durable, sin esperar la auditoría central. Indicar aceptación exige reserva de comunicación.
2. Retransmisión, conflicto y falta de respuesta: mismo identificador y contenido recuperan el resultado; otro contenido produce conflicto. Al vencer el plazo se persiste `sinRespuesta` y se impide autorizar. Retransmitir no reinicia el plazo. Timeout no es rollback.
3. Intercalado con A primero: A protege la boleta; B espera; tras el commit de A, B registra rechazo por uso previo.
4. Concurrencia completa (`par`): la exclusión depende de la clave compartida y de la autoridad transaccional, no del orden.

Las vistas no demuestran aislamiento, recuperación ni el cumplimiento de 95 % en 500 ms: eso requiere pruebas sobre la implementación.

## 7. Prototipo de interfaz (entregable 07)

### 7.1 Tecnología

HTML, CSS y JavaScript sin build. Scripts cargados en orden fijo desde `index.html` bajo el espacio global `window.NEXO` (no módulos ES) para abrir con doble clic por `file://`. Enrutado por hash (`#/...`). Estado central observable en `store.js`; las vistas se suscriben y se repintan. Archivos: `js/app.js`, `js/router.js`, `js/store.js`, `js/util.js`, `js/iconos.js`, `js/simulador.js`, `js/modelo/dominio.js`, `js/modelo/datos.js`, `js/vistas/*`, `css/{tokens,base,layout,components,screens}.css`.

### 7.2 Pantallas

| Ruta | Vista | Propósito |
|---|---|---|
| `#/inicio` | Resumen (PMU) | Tablero operativo del evento. |
| `#/incidentes` | Alertas | Bandeja de incidentes. |
| `#/incidentes/:id` | Incidente | Detalle, checklist y acciones. |
| `#/puertas`, `#/puertas/:id` | Punto | Estado de puertas y lectores. |
| `#/lector` | Lector | Vista del operador de puerta. |
| `#/cierre` | Cierre | Conciliación, diferencias y liquidación. |
| `#/preparacion` | Configuración | Preparación previa y controles. |

Roles: Supervisor del operador, Líder técnico, Logística de puerta, Responsable de cierre, Líder comercial y financiero.

### 7.3 Datos y enumerados

Datos semilla (`datos.js`): 3 eventos del contrato (uno liquidado, uno actual, uno programado), 5 zonas (Norte, Sur, Oriental, Occidental, Palcos), 20 puntos con un lector cada uno, 16.240 boletas, 15.000 admisiones estimadas en el evento actual.

Campos que consume la interfaz:

- Evento: `id`, `nombre`, `nombreCorto`, `recinto`, `boleteria`, `aperturaS`, `cierreS`, `admisionesEstimadas`, `gratuito`, `estado`, `versionPermisos`, `ultimoCambioRecibidoS`, `politicas`.
- Coordinador: `topologia`, `primario`, `replica`, `repuesto`, `excluidos`, `estado`, `desdeS`, `pausas`.
- Punto: `id`, `nombre`, `zona`, `zonas`, `estado`, `ultimaComunicacionS`, `pendientesDiario`, `diarioTotal`, `sincronizandoDesdeS`, series de decisiones por minuto, `latencias`, `recientes`, `averiadoDesdeS`, `preparacion`, `lectores` (`id`, `familia`, `procedencia`, `credencial`, `desdeS`, `hastaS`).
- Boleta: `ref`, `zona`, `consumidaEnS`, `consumidaEnPunto`, `ultimoUsoS`, `anulacion`, `excluida`.
- Incidente: tipo, prioridad, responsable, estado, tiempos y checklist. Conciliación: `estado`, `preliminarEnS`, `definitivoEnS`, `diferencias`, `saldoCobrado`.

Enumerados de `dominio.js`:

- Decisión: `aceptado`, `rechazado`, `sin-respuesta` (nunca equivale a aceptación).
- Motivos: permiso vigente, reingreso autorizado, zona no autorizada, boleta anulada, fuera de horario, uso ya registrado, uso concurrente, reingreso suspendido por permisos desactualizados, código desconocido, sin coordinador, punto suspendido.
- Estado de punto: `en-linea`, `sin-comunicacion`, `averiado`, `en-pausa`, `sin-abrir`.
- Estado de coordinador: `operando`, `sin-autoridad`, `protegiendo` (promovido, restableciendo réplica síncrona).
- Tipos de incidente (taxonomía cerrada "v1 fijada antes del piloto"): puerta sin comunicación, lector averiado, falla del coordinador, sin enlace con la nube, permisos desactualizados, latencia sobre el umbral, falsa alarma. Prioridades: crítica, alta, media, baja.
- Umbrales: sin comunicación 60 s (latido cada 10 s, tres perdidos se detectan a los 30 s); visibilidad 5 s al 95 %; sincronización 300 s al 99,5 %; recuperación de punto 180 s; actuación 300 s al 80 %; latencia 500 ms al 95 %; trazabilidad 99,9 %; rechazos incorrectos 0,5 %; preliminar 1.800 s; definitivo 86.400 s; auditoría 90 días; antigüedad tolerable de permisos 300 s; reingreso tras 600 s; cobro de saldo 30 días.

### 7.4 Simulador

`simulador.js` es la capa de aplicación mientras no hay backend. Genera intentos con una curva de llegada por hora del evento y los decide con `dominio.decidir()`. Sigue un guion por minutos: P-16 pierde comunicación, P-11 se avería, cae el enlace a la nube, los permisos envejecen, P-16 se recupera, vuelve el enlace, falla el coordinador. Simula diarios locales que se sincronizan (`sincronizarDiarios()`) y un buzón de nube que se vacía al volver el enlace (`vaciarBuzon()`). Corre con `setInterval` a 4 Hz; ofrece `saltarA`, `reiniciar`, `pausar`, `iniciar`, `alternar` y `velocidad`; si el usuario no actúa sobre un incidente, un "personal simulado" lo resuelve. `app.js` arranca el simulador; `config.js` y `lector.js` llaman a `saltarA` y `alternarControl`.

Para conectarlo a un backend hay que quitar `NEXO.simulador` como fuente de verdad, alimentar `store` desde la red (REST más SSE o WebSocket) y convertir las acciones de usuario en llamadas `POST`. Endpoints que la interfaz necesitaría: estado del evento actual, lista y detalle de puntos, lista y detalle de incidentes, feed de intentos, validación desde la vista de lector, acciones sobre incidentes, cierre preliminar y definitivo, métricas del tablero, canal en vivo, estado y sincronización de la boletería, y estado del enlace y del buzón.

### 7.5 Diferencias con otros entregables a vigilar

- El prototipo modela reingresos (`REINGRESO_AUTORIZADO`, `REINGRESO_MIN_S`), que el caso de primer ingreso excluye.
- El coordinador del prototipo tiene `primario`, `replica` y estado `protegiendo`, propios de la topología con réplica síncrona, mientras la configuración de NEXO_04 fija `modoAutoridad: "nodo-unico"`.
- El umbral de latencia del prototipo es 500 ms; el documento 08 fija 300 ms (sección 8.2).

## 8. Plataforma de observabilidad (entregable 08)

### 8.1 Decisión

OpenTelemetry para instrumentación; exportación OTLP a un OpenTelemetry Collector local con lotes, reintentos y cola persistente. Grafana Cloud Free en desarrollo y PoC (USD 0: 10.000 series, 50 GB de logs, 50 GB de trazas, 3 usuarios, 14 días); Grafana Cloud Pro antes del primer evento operativo (USD 19, 30 días, ya incluido en los USD 450). W3C Trace Context. La validación nunca espera a Grafana y la evidencia de negocio vive en los almacenes de NEXO.

Volumen estimado con 3 logs y 10 spans de 1 KiB por intento: 0,74 GiB en el pico de tres eventos y 5,01 GiB en la prueba de resistencia de 6 h.

### 8.2 SLI y SLO

Errores, timeouts y solicitudes sin respuesta permanecen en el denominador. Un rechazo válido es una decisión disponible; "sin confirmación" es indisponibilidad del flujo.

| SLI | Tipo | Cálculo | SLO |
|---|---|---|---|
| Latencia de validación | Técnica | Respuestas en 300 ms o menos / solicitudes | ≥ 95 % (ventanas de 1 min) |
| Disponibilidad del flujo | Negocio | Decisiones definitivas / solicitudes del lector | ≥ 99,9 % |
| Disponibilidad central | Técnica | Prueba funcional exitosa / tiempo | ≥ 99,9 % en 30 días |
| Visibilidad | Técnica | Validaciones visibles en 5 s / conectadas | ≥ 95 % |
| Desconexión | Técnica | Edad desde heartbeat esperado | ≤ 60 s |
| Heartbeat | Técnica | p95 de confirmación | ≤ 1 s |
| Recuperación de punto | Técnica | Detección a primera validación correcta | ≤ 3 min |
| Pendientes | Técnica | Consolidados en 5 min / total al recuperar | ≥ 99,5 % |
| Evidencia completa | Negocio | Intentos con campos completos / intentos según contador independiente | ≥ 99,9 % |
| Pérdida de evidencia | Negocio | Intentos según contador independiente menos conciliados sin explicación | 0 |
| Consumos duplicados | Negocio | Boletas con más de un consumo válido | 0 |
| Falsos rechazos | Negocio | Rechazos de autorizables / autorizables según referencia independiente | ≤ 0,5 % |
| Cierre preliminar | Negocio | Informe menos cierre de ingreso | ≤ 30 min |
| Cierre definitivo | Negocio | Hasta conciliación sin diferencias | ≤ 24 h |
| Cobertura de puntos | Negocio | Puntos con estado vigente / habilitados | 100 % |
| Respuesta a alertas | Negocio | Confirmadas con acción en menos de 5 min / confirmadas | ≥ 80 %, mínimo 5 casos |
| Consulta del panel | Técnica | p95 | ≤ 2 s |
| Sincronización | Técnica | p95 de confirmación conectada | ≤ 2 s |
| Consulta de conciliación | Técnica | p95 | ≤ 5 s |
| Liquidación | Técnica | p95 tras conciliación válida | ≤ 5 s |

También se listan como indicadores de negocio del piloto: adopción sin compra, reutilización del conector, aceptación operativa, uso pagado, nueva contratación, y contribución y margen (su fuente de verdad son inventarios, horas, encuestas, contratos y cobros, no la telemetría).

El umbral de 300 ms al 95 % sustituye explícitamente el de 500 ms de CA2 del taller 1, conservando su denominador. El 99,9 % equivale a 43 min 12 s en 30 días, 19 solicitudes sin decisión en un evento base y 59 en tres.

### 8.3 Trazas

| Flujo | Spans |
|---|---|
| Validación conectada | `validation.process` → `policy.evaluate` → `permission.read` → `ticket.consume`; luego `ticket.consume` → `attempt.persist` → `outbox.enqueue` → `evidence.receive` → `panel.update` |
| Validación local y sincronización | `validation.process` → `attempt.persist` → `outbox.enqueue`; consolidación `evidence.sync` → `idempotency.check` → `evidence.persist` → `panel.update`. `evidence.sync` crea una traza nueva con Span Link a la validación original. |

Rechazos legítimos son resultados de negocio, no errores. Timeouts, respuestas malformadas, fallos de persistencia y "sin confirmación" son error técnico. Muestreo inicial del 100 % para validación, sincronización, permisos y conciliación; si el consumo supera el 70 %, solo se muestrean validaciones conectadas, rápidas y exitosas. `trace_id` y otros identificadores técnicos van en spans y logs, no como etiquetas métricas.

### 8.4 Logs

JSON estructurado con nombre estable, severidad, servicio, ambiente, resultado, código de motivo y contexto de traza. DEBUG solo local y hasta 24 h; INFO para decisiones (incluidas denegaciones legítimas); WARN para degradación recuperable, reintentos, modo local o cola cerca del límite; ERROR y FATAL con `error.type` normalizado. Cola local mínima de 1,4 GiB para logs y 6,1 GiB para logs y trazas, con alertas al 60 % y 80 %. Prohibido registrar QR, referencias completas de boleta, identidad, biometría, contraseñas, tokens, secretos, cookies, encabezados de autorización, cadenas de conexión, parámetros SQL y cuerpos completos; lista permitida en origen y segundo filtro en el Collector.

### 8.5 Tableros

Operación del evento (supervisor y soporte); Sincronización y resiliencia (pendientes, outbox, drenaje, idempotencia, autoridad, Collector); SLO, capacidad y costo (frente a USD 450); Conciliación y cierre; Adopción y resultados del piloto.

### 8.6 Alertas

| ID | Condición | Severidad |
|---|---|---|
| A1 | Consumo duplicado confirmado > 0 | Crítica, inmediata; detiene la prueba |
| A2 | Evidencia perdida > 0 | Crítica, inmediata |
| A3 | Evidencia completa < 99,9 % | Crítica, en cada control de cierre |
| A4 | Disponibilidad del flujo < 99,9 % | Crítica, dos ventanas de 1 min |
| A5 | Validaciones en 300 ms entre 95 % y 97 % | Advertencia, 5 min |
| A6 | Validaciones en 300 ms < 95 % | Crítica, dos ventanas de 1 min |
| A7 | Errores técnicos o sin respuesta > 5 % | Crítica, dos ventanas de 1 min |
| A8 | Punto sin comunicación más de 60 s | Crítica |
| A9 | Visibles en 5 s < 95 % | Crítica, dos ventanas de 5 min |
| A10 | Pendiente más antiguo entre 60 y 300 s | Advertencia, 3 min |
| A11 | Pendiente más antiguo > 300 s o recuperación < 99,5 % en 5 min | Crítica |
| A12 | Cola del Collector entre 60 % y 80 % | Advertencia, 5 min |
| A13 | Cola del Collector > 80 % | Crítica, 1 min |
| A14 | Telemetría descartada fuera de política o exportación fallida | Crítica operativa |
| A15 | Comprobación funcional central sin éxito | Crítica, dos evaluaciones de 1 min |
| A16 | Consumo de Grafana entre 70 % y 90 % | Advertencia, diaria |
| A17 | Consumo > 90 % o infraestructura proyectada > USD 450 | Crítica presupuestal |
| A18 | Preliminar no terminado en 30 min | Crítica de cierre |
| A19 | Definitivo no terminado en 24 h | Crítica de cierre |
| A20 | Punto no recuperado en 3 min con repuesto | Crítica |

La ausencia de datos durante un evento no se presenta como saludable. A1 y A2 no se silencian durante pruebas ni eventos.

## 9. Plan de pruebas unitarias (entregable 09)

Estrategia: pirámide de pruebas; dominio y casos de uso aislados de red, base de datos, archivos, reloj real, dispositivos y servicios externos mediante fakes, stubs, spies o mocks. Datos sintéticos y deterministas: reloj base 10 de octubre de 2026 a las 19:00 (America/Bogota), evento pagado con ventana 18:00 a 22:00, dos zonas y dos puntos, tarifa USD 500 más 0,40.

Casos de uso: CU-01 Configurar operación (alta), CU-02 Incorporar permisos (crítica), CU-03 Validar acceso (crítica), CU-04 Sincronizar evidencia (crítica), CU-05 Gestionar punto (alta), CU-06 Conciliar evento (crítica), CU-07 Liquidar evento (alta), CU-08 Determinar recompra (media).

Casos base (39, identificadores PU-xx-yy). Ejemplos que fijan comportamiento:

- PU-02-02 y 02-03: la anulación de la versión 4 no se revierte al recibir de nuevo la versión 3. PU-02-04: recargar el catálogo no libera un consumo. PU-02-05: un registro con nombre, email o documento se rechaza antes de persistir.
- PU-03-01: aceptar persiste una sola vez intento, consumo, decisión, evidencia y salida de sincronización antes de responder. PU-03-02 a 03-04: rechazo por zona, anulación y uso ya consumido. PU-03-05: retransmitir recupera la decisión original. PU-03-07: si la unidad de trabajo no confirma, el resultado es "sin confirmación", no rechazo.
- PU-04-02: el mismo lote dos veces se consolida una vez. PU-04-03: con timeout del receptor el registro sigue pendiente. PU-04-05: un intento histórico sin decisión se consolida como pendiente sin aceptación retroactiva.
- PU-05-02: reemplazar LEC-001 por LEC-002 cierra la asignación y pide revocar la credencial anterior. PU-05-04: si el lector no puede persistir, no se habilita aceptación.
- PU-06-04: primera aceptación, retransmisión, reingreso y acceso interno derivan exactamente una admisión.
- PU-07-01: 100 admisiones dan USD 540. PU-07-03: anticipo 520 y uso real de 25 dan importe 510 y devolución 10. PU-07-04: uso de 150 da 560 y saldo 40. PU-07-05: descuento de 20 sobre 540 da 520.
- PU-08-01 a 08-04: reglas de recompra.

Casos borde y de error (24, PB-xx):

| ID | Escenario | Resultado |
|---|---|---|
| PB-01 | EXT-001 existe en dos eventos o clientes | Permisos distintos; nada cruza. |
| PB-02 | Versión 4 recibida de nuevo con igual contenido | Repetida; no se duplica. |
| PB-03 | `idOrigen` vacío o nulo | Entrada inválida antes de evaluar permisos. |
| PB-04 | Reutilizar INT-001 cambiando boleta, lector o contenido | Error de integridad. |
| PB-05 | 17:59:59 para ventana que inicia 18:00 | Rechazo. |
| PB-06 | Exactamente 18:00:00 | Dentro de la ventana. |
| PB-07 | Exactamente 22:00:00 | Rechazo bajo intervalo semiabierto [inicio, fin) (decisión pendiente). |
| PB-08 | `zonaSolicitada` ausente | Rechazo por zona no identificada. |
| PB-09 | Punto PUE-GEN-01 deshabilitado | Rechazo por punto no habilitado. |
| PB-10 | Evento cerrado | Rechazo por estado del evento. |
| PB-11 | Lector pide operar localmente sin política de contingencia | "Sin confirmación"; cero apertura. |
| PB-12 | Repositorio de permisos lanza excepción controlada | "Sin confirmación"; ni rechazo ni consumo. |
| PB-13 | Falla la escritura del outbox antes del commit | Se revierte toda la operación. |
| PB-14 | Credencial del lector revocada o de otro evento | Se detiene por falta de confianza; no se consulta la boleta. |
| PB-15 | Preliminar a 30 min exactos y a 30 min + 1 ms | Dentro / fuera de plazo. |
| PB-16 | Definitivo a 24 h exactas y a 24 h + 1 ms | Dentro / fuera. |
| PB-17 | Evento pagado con cero admisiones | USD 500. |
| PB-18 | Una admisión | Exactamente USD 500,40, con decimal y no punto flotante. |
| PB-19 | Admisiones negativas | Rechazo. |
| PB-20 | Una admisión estimada para el anticipo | USD 500,20. |
| PB-21 | Falla el puerto de telemetría tras una decisión válida | La decisión no cambia ni se pierde. |
| PB-22 | Recompra firmada a los 60 días exactos | Cumple KR5.2. |
| PB-23 | Recompra a los 61 días | Es recompra, pero no acredita KR5.2. |
| PB-24 | Cobro a 30 días exactos y a 30 días + 1 ms | Dentro / vencido. |

Cobertura planificada: 8 de 8 casos de uso, 12 de 12 reglas, 3 de 3 resultados de validación, 63 casos (39 base y 24 borde). No se reportó cobertura de código porque no había implementación. Fuera del nivel unitario: transacciones reales de PostgreSQL, concurrencia entre procesos, contratos reales, red, dispositivos, Grafana, rendimiento y pantallas. Decisiones pendientes: rechazar o descartar campos personales inesperados; incluir o no el instante final de la ventana; condiciones de anticipo, devolución y cancelación; lenguaje y framework.

## 10. Volumetría (entregable 10)

Supuestos: 15.000 admisiones por evento; 3 eventos, 20 puntos y 5 zonas; 15.000 boletas base y 20.000 de capacidad; 1,3 intentos por admisión; 2 % de códigos desconocidos; pico de 3 veces el promedio en un minuto; intentos distribuidos 10 %, 20 %, 30 % y 40 % en los cuatro cuartos de la hora de ingreso.

Tamaño lógico por fila (supuesto PostgreSQL): `Boleta` 526 B (7,89 MB para 15.000), `IntentoDeValidacion` 400 B (19.800 intentos, 7,92 MB), `PuntoDeValidacion` 564 B. Crecimiento de unos 15,09 MiB por evento (17,60 MiB con capacidad completa). Tras implementar se medirán `pg_column_size`, `pg_table_size`, `pg_indexes_size` y `pg_total_relation_size`.

Usuarios por evento: 20 operadores, 2 supervisores, 1 configurador, 1 conciliador, 1 financiero, 2 de soporte (27 habilitados, 24 concurrentes en pico; 75 y 71 para tres eventos).

| Operación | 1 evento prom. | 1 evento pico | 3 eventos prom. | 3 eventos pico |
|---|---|---|---|---|
| Validar intento (TPS) | 5,50 | 16,50 | 16,50 | 49,50 |
| Sincronizar evidencia | 5,50 | 16,50 | 16,50 | 49,50 |
| Consultar panel | 0,40 | 2,00 | 1,20 | 6,00 |
| Heartbeat | 1,33 | 20,00 | 4,00 | 60,00 |
| Actualizar permisos | 33,33 | 100,00 | 100,00 | 300,00 |
| Consultar conciliación | 0,10 | 1,00 | 0,30 | 3,00 |

Envolvente técnica: 250 solicitudes por segundo para tres eventos (49,5 validaciones con hasta cinco solicitudes internas). Un intento aceptado hace tres lecturas y cuatro escrituras; uno rechazado, tres y tres.

Objetivos: validación al menos 95 % en 300 ms por modo; panel p95 de 2 s y 95 % visible en 5 s; heartbeat p95 de 1 s; sincronización p95 de 2 s y 99,5 % en 5 min; permisos p95 de lote de 2 s y 20.000 permisos en 10 min; conciliación p95 de 5 s; liquidación p95 de 5 s.

| Escenario | Configuración | Carga | Criterio |
|---|---|---|---|
| Nominal | 1 evento, 20 lectores, 19.800 intentos, 60 min | 5,50 TPS promedio, 16,50 pico | Todos los SLO; sin quiebre. |
| Pico | 3 eventos, 60 lectores, 59.400 intentos, 60 min | 49,50 TPS; 250 solicitudes técnicas | Cumplir por evento y modo. |
| Estrés | 3 eventos, cuatro niveles de 10 min | 49,50; 61,88; 74,25; 99 TPS | Primer quiebre esperado entre 74 y 99 TPS; detener ante duplicado o pérdida. |
| Resistencia | 3 eventos, 6 h, ráfaga de 1 min cada 15 min | 16,50 sostenidos, 49,50 en ráfaga | p95 y recursos no crecen más de 20 % entre horas. |

Todos exigen cero duplicados y pérdidas, evidencia completa de al menos 99,9 % y falsos rechazos de hasta 0,5 %.

## 11. Módulo de inyección de fallos (entregable 11)

Una perturbación puede reducir latencia o disponibilidad, pero nunca permitir consumos duplicados, perder consumos confirmados ni emitir una apertura sin decisión confirmada.

### 11.1 Catálogo

| ID | Perturbación | Comportamiento seguro esperado |
|---|---|---|
| RED-01 | Corte de internet entre recinto y nube durante 15 min | Validaciones elegibles continúan en la autoridad local; pendientes en outbox durable; sincronización posterior sin pérdidas ni duplicados. |
| RED-02 | Pérdida de conexión lector-coordinador | El lector no habilita paso y muestra "sin confirmación"; desconexión visible en 60 s. |
| RED-03 | Latencia, fluctuación y pérdida de paquetes lector-coordinador | Sin respuesta cuenta en el denominador; reintentos con el mismo identificador sin segunda aceptación. |
| RED-04 | Pérdida, duplicación o desorden de lotes hacia la nube | Pendientes hasta confirmación durable; recepción idempotente. |
| RED-05 | Corte o degradación con la boletería | Se conserva la última versión válida y se informa su antigüedad; no se presumen anulaciones no recibidas. |
| RED-06 | Partición entre nodos de la autoridad local | Solo la autoridad vigente o con cuórum acepta; sin split-brain. Condicionado a ADR-005. |
| SER-01 | Reinicio abrupto del coordinador con validaciones en curso | Solo sobreviven consumos confirmados; reintentos idempotentes; recupera estado antes de autorizar. |
| SER-02 | Núcleo central indisponible | Ingreso local continúa; gestión central degradada; evidencia local para sincronizar. |
| SER-03 | Adaptador de boletería devuelve expiraciones, 5xx, contenido inválido o versiones fuera de orden | Se rechaza la actualización y se conserva la última válida. |
| SER-04 | Módulo central de sincronización detenido | Lotes en bandeja durable; reintentos sin competir con la validación. |
| SER-05 | Proyección del panel indisponible o retrasada | La validación sigue; el panel muestra la antigüedad y no presenta datos viejos como actuales. |
| SER-06 | Collector detenido o Grafana Cloud indisponible | Validación y auditoría no se interrumpen; telemetría retenida y reenviada. |
| BD-01 | Base de datos de la autoridad local indisponible | Ninguna aceptación nueva; responde "sin confirmación"; no usa réplica desactualizada. |
| BD-02 | Contención sobre la misma boleta | Una sola operación consume; un duplicado detiene el experimento. |
| BD-03 | Caída tras el commit y antes de responder | El reintento recupera la decisión original. |
| BD-04 | Caída antes del commit o entre consumo y evento de sincronización | Sin confirmación no hay aceptación; consumo y registro de salida son atómicos. |
| BD-05 | Persistencia central indisponible durante la sincronización | El emisor no borra el pendiente hasta confirmación durable. |
| BD-06 | Promover una réplica atrasada | No se promueve sin demostrar estado completo. Condicionado a ADR-005. |
| REC-01 | Saturación progresiva de CPU del coordinador en carga nominal y pico | El deterioro se ve en métricas; las solicitudes sin respuesta siguen en el denominador; puede degradarse la disponibilidad, no la integridad. |
| REC-02 | Presión de memoria hasta reinicio | Recupera solo desde estado durable. |
| REC-03 | Disco lleno o de solo lectura en el coordinador | Alertas previas; sin persistencia se suspenden aceptaciones. |
| REC-04 | Cola de telemetría al 60 %, 80 % y 100 % | Alertas escalonadas; nunca afecta validación ni auditoría. |
| REC-05 | Pérdida de energía o sustitución de un lector | El diario sobrevive; el reemplazo usa credencial propia; recuperación en 3 min. |

### 11.2 Mecanismo `nexo-chaos`

Propuesto para Linux en un laboratorio aislado: Docker Compose con perfil `chaos`; Toxiproxy y `tc netem` para red; Docker y `stress-ng` para procesos y recursos; un generador que repite identificadores para probar idempotencia. El artefacto de NEXO no incluye condiciones artificiales ni se recompila.

| Elemento | Decisión |
|---|---|
| Interfaz | `validate`, `plan`, `run --confirm`, `status`, `abort`, `restore` sobre archivos YAML. |
| Parámetros | Ambiente, fallo, evento, punto, instancia, dependencia, intensidad, porcentaje, duración, aborto, reversión y responsable. |
| Radio inicial | Un evento, un punto y una instancia; 2 min por defecto, máximo 15 min. |
| Seguridad | Producción bloqueada, datos sintéticos, objetivos permitidos, una perturbación activa, plan obligatorio. |
| Reversión | Temporizador y watchdog restauran red, proceso, límites o volumen. Si falla, el laboratorio queda "no recuperado" y no admite otro experimento. |
| Trazabilidad | Versión, parámetros, operador, objetivos, tiempos, acciones, recuperación y enlaces a telemetría. |

### 11.3 Experimentos

Cada uno parte de cinco minutos de estado estable: un evento, 20 lectores, 5,5 TPS con ráfagas de 16,5, al menos 95 % en 300 ms, cero duplicados y pérdidas, evidencia completa de al menos 99,9 % y ninguna alerta crítica abierta.

| ID | Hipótesis | Perturbación | Verificación | Aborto |
|---|---|---|---|---|
| EXP 01 | La autoridad local valida sin nube y conserva pendientes. | Cortar centro, sincronización y telemetría 15 min. | Latencia ≥ 95 %; cero pérdida; ≥ 99,5 % drenado en 5 min. | Duplicado, pérdida, apertura insegura, > 5 % errores o cola > 80 %. |
| EXP 02 | Un lector aislado no decide ni afecta otros puntos. | Desconectar 1 de 20 lectores 2 min. | Cero aperturas; visible en 60 s; recuperación en 3 min. | Autorización aislada, rechazo falso, propagación o pérdida del diario. |
| EXP 03 | Un reintento recupera la decisión original. | Perder respuestas y reenviar el mismo `idOrigen`. | Misma decisión; un consumo; evidencia y outbox atómicos. | Decisiones distintas o doble consumo. |
| EXP 04 | La concurrencia admite una sola aceptación por boleta. | 500 boletas con dos solicitudes simultáneas desde lectores distintos. | 500 consumos; una aceptación y una denegación por boleta. | Dos aceptaciones o evidencia perdida. |
| EXP 05 | Sin persistencia durable no hay aceptación. | Disco al 60 %, 80 % y fallo de escritura. | Alertas; consumos previos íntegros; nuevas solicitudes sin confirmación. | Aceptación no persistida o corrupción. |
| EXP 06 | Observabilidad no participa en decisión ni auditoría. | Detener el Collector o su salida 15 min. | Latencia ≥ 95 %; evidencia íntegra; cola < 80 % y drenaje posterior. | Validación bloqueada o evidencia alterada. |
| EXP 07 | Solo la autoridad vigente acepta durante una partición. | Separar nodos locales 2 min (condicionado a ADR-005). | Nodo aislado con cero aceptaciones. | Split-brain o boleta reutilizada. |

Resultados posibles: aprobada, aprobada con degradación prevista, fallida, abortada por seguridad o no concluyente. La hipótesis exige evidencia independiente de solicitudes, decisiones, aperturas simuladas, persistencia, sincronización y recuperación; no basta con que el proceso siga vivo.

## 12. Qué queda abierto para el taller 3

- Runtime, lenguaje y framework (NEXO_04, ADR pendiente).
- Proveedor de nube, gestor de secretos e identidad de operadores.
- Topología local de ADR-005; la configuración usa `nodo-unico`.
- Contrato real con la boletería (P1); en laboratorio solo puede simularse.
- Backend de observabilidad definitivo; la decisión vigente es Grafana Cloud Free en PoC.
- Entorno del laboratorio de fallos: el entregable 11 propone Docker Compose; cualquier otro entorno exige actualizar esa decisión.
- PoC de ADR-002, 003, 005, 007 a 013: el taller 3 es la primera oportunidad de ejecutarlas y registrar su resultado.

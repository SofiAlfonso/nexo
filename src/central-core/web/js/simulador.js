/* ============================================================
   simulador.js — motor de la demostración

   Hace de capa de aplicación mientras no exista el backend. No
   inventa cifras: genera INTENTOS y los pasa por el servicio de
   dominio (el coordinador local), de modo que todo lo que se ve es
   consecuencia de una regla.

   Guion de incidentes (minutos desde la apertura, 17:00):
     61  P-16 pierde comunicación con el coordinador   (KR1.2, KR2.1)
     64  el lector de P-11 se avería                    (KR2.2, ADR-008)
     66  se cae el enlace del estadio con la nube       (ADR-002, ADR-011)
     71  los permisos superan la antigüedad tolerable   (ADR-010)
     70  P-16 recupera comunicación y sincroniza
     75  vuelve el enlace; llegan anulaciones atrasadas → diferencias
     84  falla el coordinador primario                  (ADR-005)
   ============================================================ */

NEXO.simulador = (function () {
  'use strict';

  var d = NEXO.dominio, u = NEXO.util, fmt = u.fmt;
  var D = d.Decision, M = d.Motivo, EP = d.EstadoPunto, EC = d.EstadoCoordinador, T = d.TipoIncidente;
  var HZ = 4;
  var MAX_INTENTOS = 300;
  var temporizador = null;
  var saltando = false;
  var ventana = [];            // decisiones recientes para el ritmo por segundo
  var hechos = {};             // pasos del guion ya aplicados

  var GUION = [
    { min: 61, paso: cortarPunto, arg: 'P-16' },
    { min: 64, paso: averiarLector, arg: 'P-11' },
    { min: 66, paso: cortarEnlace },
    { min: 70, paso: restablecerPunto, arg: 'P-16' },
    { min: 75, paso: restablecerEnlace },
    { min: 84, paso: fallarCoordinador }
  ];

  function E() { return NEXO.store.get(); }
  function rnd() { return E().rnd(); }

  // ==========================================================
  //  control de la demo
  // ==========================================================

  function iniciar() {
    var e = E();
    if (e.corriendo) return;
    e.corriendo = true;
    temporizador = setInterval(paso, 1000 / HZ);
    NEXO.store.notificar();
  }

  function pausar() {
    E().corriendo = false;
    if (temporizador) { clearInterval(temporizador); temporizador = null; }
    NEXO.store.notificar();
  }

  function alternar() { E().corriendo ? pausar() : iniciar(); }

  function velocidad(v) { E().velocidad = v; NEXO.store.notificar(); }

  function reiniciar() {
    var seguia = E().corriendo;
    pausar();
    hechos = {}; ventana = [];
    NEXO.store.reiniciar();
    if (seguia) iniciar();
  }

  /** Adelanta el reloj sin repintar en cada paso intermedio. */
  function saltarA(segundos) {
    var e = E(), guard = 0;
    saltando = true;
    while (e.ahoraS < segundos && guard++ < 40000) avanzar(e, 5);
    saltando = false;
    NEXO.store.notificar();
  }

  function paso() {
    var e = E();
    avanzar(e, e.velocidad / HZ);
    NEXO.store.notificar();
  }

  function avanzar(e, dt) {
    e.ahoraS += dt;
    abrirYCerrar(e);
    aplicarGuion(e);
    anularBoletas(e, dt);
    recibirCambios(e);
    latidos(e);
    coordinador(e);
    sincronizarDiarios(e);
    vaciarBuzon(e, dt);
    generarIntentos(e, dt);
    personalSimulado(e);
    metricas(e);
  }

  // ==========================================================
  //  ciclo del evento
  // ==========================================================

  function abrirYCerrar(e) {
    var ev = e.evento;
    if (ev.estado === 'preparacion' && e.ahoraS >= ev.aperturaS) {
      var faltan = e.preparacion.controles.filter(function (c) { return !c.ok; });
      if (!e.preparacion.confirmada || faltan.length) {
        faltan.forEach(function (c) { c.ok = true; });
        e.preparacion.confirmada = true;
        actividad(e, 'Controles previos confirmados por el supervisor (simulado).', 'info');
      }
      ev.estado = 'abierto';
      actividad(e, 'Se abrió la ventana de ingreso. Las 20 puertas validan contra el coordinador local.', 'ok');
      avisar({ titulo: 'Ingreso abierto', texto: 'Las puertas ya aceptan boletas.', tono: 'ok', enlace: '#/inicio' });
    }
    if (ev.estado === 'abierto' && e.ahoraS > ev.cierreS) {
      ev.estado = 'cerrado';
      e.conciliacion.estado = 'en-curso';
      actividad(e, 'Terminó la ventana de ingreso. Empieza el cierre: preliminar en 30 min.', 'info');
      nuevaAccion(e, {
        tipo: 'preliminar', titulo: 'Entregar el informe preliminar',
        detalle: 'Vence 30 minutos después del cierre de la ventana (KR4.3).',
        si: 'Entregar', no: null, rol: d.Rol.CIERRE, enlace: '#/cierre'
      });
      avisar({ titulo: 'Ventana cerrada', texto: 'Ya puedes preparar el cierre conciliado.', tono: 'info', enlace: '#/cierre' });
    }
  }

  function aplicarGuion(e) {
    if (e.evento.estado !== 'abierto') return;
    GUION.forEach(function (g, i) {
      if (hechos[i] || e.ahoraS < e.evento.aperturaS + g.min * 60) return;
      hechos[i] = true;
      g.paso(e, g.arg);
    });
  }

  // ---------- pasos del guion ----------

  function cortarPunto(e, id) {
    var p = e.puntosPorId[id];
    p.estado = EP.SIN_COMUNICACION;
    p.episodio = abrirEpisodio(e, 'corte-' + id, id + ' sin comunicación con el coordinador', [id]);
    registrarPunto(p, e, 'Dejó de reportar al coordinador local. Los intentos quedan en el diario del lector, sin aceptación.', 'warn');
    // El incidente se abre al DETECTARLO (latidos), no en este instante.
  }

  function restablecerPunto(e, id) {
    var p = e.puntosPorId[id];
    p.estado = EP.EN_LINEA;
    p.ultimaComunicacionS = e.ahoraS;
    p.redirigido = false;
    p.sincronizandoDesdeS = e.ahoraS;
    registrarPunto(p, e, 'Recuperó comunicación. Empieza a sincronizar su diario (' + p.pendientesDiario + ' intentos).', 'ok');
    var inc = incidenteAbiertoDe(e, T.SIN_COMUNICACION, id);
    if (inc) {
      inc.relojDesdeS = e.ahoraS;
      bitacora(inc, e, 'Sistema', 'estado', 'Comunicación restablecida. Sincronizando ' + p.pendientesDiario + ' intentos del diario (meta: 5 min desde ahora).');
    }
    cerrarAccionesDe(e, inc, 'Ya no aplica: la puerta recuperó comunicación.');
  }

  function averiarLector(e, id) {
    var p = e.puntosPorId[id];
    p.estado = EP.AVERIADO;
    p.averiadoDesdeS = e.ahoraS;
    registrarPunto(p, e, 'Lector ' + p.lectores[0].id + ' reportado averiado por logística de puerta.', 'no');
    var inc = abrirIncidente(e, {
      tipo: T.LECTOR_AVERIADO, prioridad: d.Prioridad.ALTA, puntoId: id,
      titulo: 'Lector averiado en ' + p.nombre,
      descripcion: 'Logística de puerta reportó que el lector ' + p.lectores[0].id + ' no enciende. ' +
        'La puerta no recibe intentos hasta instalar un repuesto. Meta: primera validación correcta en 3 minutos (KR2.2).',
      responsable: d.Rol.LOGISTICA,
      metaRecuperacionS: d.Umbral.RECUPERACION_PUNTO_S,
      checklist: ['Retirar el lector averiado', 'Instalar el repuesto preparado', 'Emitir credencial individual para el punto', 'Probar una lectura correcta']
    });
    nuevaAccion(e, {
      tipo: 'credencial', incidenteId: inc.id, decisiva: true,
      titulo: 'Emitir credencial al repuesto de ' + id,
      detalle: 'LX-2210-0447 queda autorizado solo para este evento y este punto (ADR-008). Sin credencial el lector no puede validar.',
      si: 'Emitir credencial', no: 'Rechazar', rol: d.Rol.LIDER_TECNICO, autoTrasS: 110
    });
  }

  function instalarRepuesto(e, p, inc) {
    var anterior = p.lectores[0];
    anterior.hastaS = e.ahoraS;
    p.lectores.unshift({
      id: 'LX-2210-0447', familia: 'Zebra TC21', procedencia: 'Alquiler',
      credencial: 'CRED-' + p.id + '-B', desdeS: e.ahoraS, hastaS: null
    });
    var dur = e.ahoraS - p.averiadoDesdeS;
    p.estado = EP.EN_LINEA;
    p.ultimaComunicacionS = e.ahoraS;
    p.recuperacionS = dur;
    p.averiadoDesdeS = null;
    registrarPunto(p, e, 'Repuesto LX-2210-0447 instalado con credencial CRED-' + p.id + '-B. Primera validación correcta ' + fmt.duracion(dur) + ' después de la falla.', 'ok');
    if (inc) {
      inc.recuperadaEnS = e.ahoraS;
      marcarChecklist(inc);
      resolverIncidente(e, inc, 'Sistema', 'Punto restablecido en ' + fmt.duracion(dur) +
        (dur <= d.Umbral.RECUPERACION_PUNTO_S ? ' (dentro de la meta de 3 min).' : ' (fuera de la meta de 3 min).') +
        ' La identidad del punto y su historial se conservan.');
    }
  }

  function cortarEnlace(e) {
    e.nube.enLinea = false;
    e.nube.caidaDesdeS = e.ahoraS;
    e.integracion.enLinea = false;
    actividad(e, 'Se cayó el enlace del estadio con la nube. El ingreso sigue: las puertas validan contra el coordinador local.', 'warn');
    abrirIncidente(e, {
      tipo: T.ENLACE_NUBE, prioridad: d.Prioridad.ALTA, componente: 'Enlace a la nube',
      titulo: 'El estadio perdió el enlace con la nube',
      descripcion: 'El coordinador local sigue decidiendo cada intento (ADR-002), así que las puertas no se detienen. ' +
        'Las decisiones se acumulan en el buzón y llegarán al panel central al volver el enlace (ADR-011). ' +
        'Tampoco llegan cambios de la boletería mientras dure el corte.',
      responsable: d.Rol.LIDER_TECNICO,
      checklist: ['Confirmar que las puertas siguen validando', 'Escalar al proveedor de conectividad', 'Vigilar la antigüedad de los permisos', 'Verificar el vaciado del buzón']
    });
    avisar({ titulo: 'Sin enlace con la nube', texto: 'El ingreso continúa con el coordinador local.', tono: 'warn', enlace: '#/incidentes' });
  }

  function restablecerEnlace(e) {
    e.nube.enLinea = true;
    e.integracion.enLinea = true;
    var dur = e.ahoraS - e.nube.caidaDesdeS;
    e.nube.caidaDesdeS = null;
    actividad(e, 'Volvió el enlace con la nube tras ' + fmt.duracion(dur) + '. Se envía el buzón (' + fmt.entero(e.nube.buzon) + ' registros).', 'ok');
    var inc = incidenteAbiertoDe(e, T.ENLACE_NUBE);
    if (inc) bitacora(inc, e, 'Sistema', 'estado', 'Enlace restablecido tras ' + fmt.duracion(dur) + '. Enviando ' + fmt.entero(e.nube.buzon) + ' registros del buzón en lotes idempotentes.');
    // Los cambios retenidos llegan ahora, en orden de versión.
    e.integracion.enTransito.forEach(function (b) { b.anulacion.recibidaEnS = e.ahoraS + 4 + rnd() * 20; });
  }

  function fallarCoordinador(e) {
    var c = e.coordinador;
    c.estado = EC.SIN_AUTORIDAD;
    c.desdeS = e.ahoraS;
    c.pausas.push({ desdeS: e.ahoraS, hastaS: null });
    c.episodio = abrirEpisodio(e, 'pausa-' + c.pausas.length, 'Pausa del coordinador (todas las puertas)', null);
    actividad(e, 'Falló ' + c.primario + '. Sin autoridad válida no se autoriza en ninguna puerta.', 'no');
    var inc = abrirIncidente(e, {
      tipo: T.COORDINADOR, prioridad: d.Prioridad.CRITICA, componente: 'Coordinador local',
      titulo: 'Falló el coordinador primario ' + c.primario,
      descripcion: 'Ninguna puerta puede aceptar hasta que haya una autoridad válida (ADR-005). ' +
        'Los intentos se guardan en los diarios de los lectores, sin aceptación. ' +
        'La réplica ' + c.replica + ' tiene todos los consumos confirmados porque la replicación es síncrona.',
      responsable: d.Rol.LIDER_TECNICO,
      checklist: ['Aislar ' + c.primario + ' para que no vuelva a autorizar', 'Promover ' + c.replica + ' a primario', 'Incorporar ' + c.repuesto + ' como réplica síncrona', 'Confirmar que las puertas reanudan']
    });
    nuevaAccion(e, {
      tipo: 'promover', incidenteId: inc.id, decisiva: true,
      titulo: 'Promover ' + c.replica + ' a coordinador primario',
      detalle: 'Confirma que ' + c.primario + ' quedó aislado. La promoción es manual para no tener dos autoridades a la vez.',
      si: 'Promover', no: 'Rechazar', rol: d.Rol.LIDER_TECNICO, autoTrasS: 70
    });
    avisar({ titulo: 'Coordinador sin autoridad', texto: 'Ninguna puerta acepta. Se requiere tu decisión.', tono: 'no', enlace: '#/incidentes/' + inc.id });
  }

  function promoverReplica(e, inc) {
    var c = e.coordinador;
    c.excluidos.push(c.primario);
    c.primario = c.replica;
    c.replica = c.repuesto;
    c.repuesto = '—';
    c.estado = EC.PROTEGIENDO;
    c.protegiendoHastaS = e.ahoraS + 15;
    actividad(e, c.primario + ' promovido. ' + c.replica + ' se incorpora como réplica síncrona antes de aceptar.', 'info');
    if (inc) {
      marcarChecklist(inc, 2);
      bitacora(inc, e, 'Sistema', 'estado', c.primario + ' es el nuevo primario; ' + c.excluidos[c.excluidos.length - 1] +
        ' quedó excluido. Restableciendo la réplica síncrona con ' + c.replica + '.');
    }
  }

  /** Transiciones del coordinador (protección síncrona antes de aceptar). */
  function coordinador(e) {
    var c = e.coordinador;
    if (c.estado === EC.PROTEGIENDO && e.ahoraS >= c.protegiendoHastaS) {
      c.estado = EC.OPERANDO;
      var pausa = c.pausas[c.pausas.length - 1];
      pausa.hastaS = e.ahoraS;
      var dur = pausa.hastaS - pausa.desdeS;
      actividad(e, 'Las puertas reanudan. Pausa total del coordinador: ' + fmt.duracion(dur) + '.', 'ok');
      e.puntos.forEach(function (p) {
        if (p.pendientesDiario > 0 && p.estado === EP.EN_LINEA) p.sincronizandoDesdeS = e.ahoraS;
      });
      var inc = incidenteAbiertoDe(e, T.COORDINADOR);
      if (inc) {
        inc.recuperadaEnS = e.ahoraS;
        marcarChecklist(inc);
        resolverIncidente(e, inc, 'Sistema', 'Autoridad restablecida con protección síncrona. Pausa medida: ' +
          fmt.duracion(dur) + '. Ningún consumo confirmado se perdió.');
      }
      c.episodio = null;
      avisar({ titulo: 'Puertas operando', texto: 'El coordinador recuperó la autoridad en ' + fmt.duracion(dur) + '.', tono: 'ok' });
    }
  }

  // ==========================================================
  //  integración con la boletería (ADR-010)
  // ==========================================================

  function anularBoletas(e, dt) {
    if (e.evento.estado !== 'abierto') return;
    var b = e.boletas;
    if (b.anuladas.length >= b.maxAnuladas || rnd() > dt / 80) return;
    var boleta = boletaSinUsar(b.orden);
    if (!boleta) return;
    // El cambio viaja por la integración: llega unos segundos después
    // o, si no hay enlace, cuando vuelva (ADR-010).
    boleta.anulacion = {
      emitidaEnS: e.ahoraS,
      recibidaEnS: e.integracion.enLinea ? e.ahoraS + 3 + rnd() * 12 : null
    };
    b.anuladas.push(boleta);
    e.integracion.enTransito.push(boleta);
  }

  /** Aplica los cambios que ya llegaron y detecta diferencias. */
  function recibirCambios(e) {
    var ev = e.evento;
    if (e.integracion.enLinea) {
      ev.ultimoCambioRecibidoS = e.ahoraS;
      if (e.integracion.enTransito.length) {
        e.integracion.enTransito = e.integracion.enTransito.filter(function (b) {
          if (b.anulacion.recibidaEnS === null || b.anulacion.recibidaEnS > e.ahoraS) return true;
          ev.versionPermisos++;
          if (b.consumidaEnS !== null && b.consumidaEnS < b.anulacion.recibidaEnS) difAnulacion(e, b);
          return false;
        });
      }
      if (!e.integracion.enTransito.length && incidenteAbiertoDe(e, T.PERMISOS)) cambiosAlDia(e);
    }
    // Antigüedad tolerable (ADR-010): pasado el umbral, se restringe.
    var edad = e.ahoraS - ev.ultimoCambioRecibidoS;
    if (edad > d.Umbral.ANTIGUEDAD_PERMISOS_S && !incidenteAbiertoDe(e, T.PERMISOS)) {
      var inc = abrirIncidente(e, {
        tipo: T.PERMISOS, prioridad: d.Prioridad.MEDIA, componente: 'Integración con la boletería',
        titulo: 'Los permisos superan 5 min sin cambios de la boletería',
        descripcion: 'Una anulación que no ha llegado no puede presumirse conocida. ' +
          'La restricción acordada es suspender los reingresos hasta recibir los cambios; los primeros ingresos continúan y se concilian después.',
        responsable: d.Rol.SUPERVISOR,
        checklist: ['Decidir si se suspenden los reingresos', 'Informar a los operadores de puerta', 'Confirmar la llegada de los cambios']
      });
      nuevaAccion(e, {
        tipo: 'reingresos', incidenteId: inc.id,
        titulo: 'Suspender reingresos hasta recibir los cambios',
        detalle: 'Los permisos tienen ' + fmt.duracion(edad) + ' de antigüedad. Límite acordado: 5 min.',
        si: 'Suspender', no: 'No aplicar', rol: d.Rol.SUPERVISOR, autoTrasS: 90
      });
    }
  }

  function cambiosAlDia(e) {
    var inc = incidenteAbiertoDe(e, T.PERMISOS);
    if (e.evento.politicas.reingresoSuspendido) {
      e.evento.politicas.reingresoSuspendido = false;
      actividad(e, 'Cambios de la boletería al día (v' + e.evento.versionPermisos + '). Se reanudan los reingresos.', 'ok');
    }
    if (inc) {
      marcarChecklist(inc);
      resolverIncidente(e, inc, 'Sistema', 'Cambios recibidos hasta la versión ' + e.evento.versionPermisos + '. Las aceptaciones afectadas pasaron a conciliación.');
      cerrarAccionesDe(e, inc, 'Ya no aplica: los cambios llegaron.');
    }
  }

  // ==========================================================
  //  puntos: latidos, diarios y buzón
  // ==========================================================

  function latidos(e) {
    e.puntos.forEach(function (p) {
      if (p.estado === EP.EN_LINEA) p.ultimaComunicacionS = e.ahoraS;
      // KR1.2: el incidente se abre cuando la interfaz ya lo muestra.
      if (p.estado === EP.SIN_COMUNICACION && e.ahoraS - p.ultimaComunicacionS >= d.Umbral.DETECCION_S &&
          !incidenteAbiertoDe(e, T.SIN_COMUNICACION, p.id)) {
        var inc = abrirIncidente(e, {
          tipo: T.SIN_COMUNICACION, prioridad: d.Prioridad.ALTA, puntoId: p.id,
          titulo: p.nombre + ' sin comunicación',
          descripcion: p.id + ' dejó de reportar al coordinador a las ' + fmt.hora(p.ultimaComunicacionS, true) +
            ' y se mostró «sin comunicación» ' + Math.round(e.ahoraS - p.ultimaComunicacionS) + ' s después (meta: 60 s). ' +
            'Sus intentos quedan en el diario del lector, sin aceptación: nadie entra por esta puerta hasta recuperarla.',
          responsable: d.Rol.SUPERVISOR,
          metaRecuperacionS: d.Umbral.SINCRONIZACION_S,
          relojAlRestablecer: true,
          checklist: ['Redirigir el flujo a las puertas vecinas', 'Revisar el enlace de red de la puerta', 'Confirmar la sincronización del diario']
        });
        nuevaAccion(e, {
          tipo: 'redirigir', incidenteId: inc.id,
          titulo: 'Redirigir el flujo de ' + p.id + ' a las puertas vecinas',
          detalle: 'Los asistentes de ' + p.nombre + ' pasan a ' + vecinas(e, p).join(' y ') + '.',
          si: 'Redirigir', no: 'Posponer', rol: d.Rol.SUPERVISOR, autoTrasS: 150
        });
        avisar({ titulo: p.nombre + ' sin comunicación', texto: 'Los intentos quedan pendientes, nunca aceptados.', tono: 'warn', enlace: '#/incidentes/' + inc.id });
      }
    });
  }

  function vecinas(e, p) {
    return e.puntos.filter(function (x) { return x.zona === p.zona && x.id !== p.id; })
      .slice(0, 2).map(function (x) { return x.id; });
  }

  /** KR2.1: al recuperar, los intentos del diario se consolidan. */
  function sincronizarDiarios(e) {
    e.puntos.forEach(function (p) {
      if (p.sincronizandoDesdeS === null || p.estado !== EP.EN_LINEA) return;
      if (e.coordinador.estado !== EC.OPERANDO) return;
      if (!p.syncInicial) p.syncInicial = p.pendientesDiario;
      var dur = 70 + (p.id.charCodeAt(3) % 5) * 18;        // entre 70 y 142 s
      var frac = Math.min(1, (e.ahoraS - p.sincronizandoDesdeS) / dur);
      var objetivo = Math.ceil(p.syncInicial * (1 - frac));
      if (objetivo < p.pendientesDiario) {
        var n = p.pendientesDiario - objetivo;
        p.pendientesDiario = objetivo;
        e.nube.buzon += n;          // la evidencia sigue su camino a la nube
      }
      if (p.pendientesDiario <= 0) {
        var total = p.syncInicial, t = e.ahoraS - p.sincronizandoDesdeS;
        e.metricas.sincronizaciones.push({ puntoId: p.id, pendientes: total, duracionS: t });
        registrarPunto(p, e, total + ' intentos del diario consolidados en ' + fmt.duracion(t) + ' (meta 5 min).', 'ok');
        p.sincronizandoDesdeS = null; p.syncInicial = 0;
        cerrarEpisodiosListos(e);
        var inc = incidenteAbiertoDe(e, T.SIN_COMUNICACION, p.id);
        if (inc) {
          inc.recuperadaEnS = e.ahoraS;
          marcarChecklist(inc);
          resolverIncidente(e, inc, 'Sistema', total + ' intentos del diario consolidados en ' + fmt.duracion(t) +
            '. Quedan registrados sin aceptación; la conciliación los agrupa.');
        }
      }
    });
  }

  function vaciarBuzon(e, dt) {
    if (!e.nube.enLinea || e.nube.buzon <= 0) return;
    var n = Math.min(e.nube.buzon, Math.ceil(90 * dt));
    e.nube.buzon -= n;
    e.nube.enviados += n;
    if (e.nube.buzon === 0) {
      var inc = incidenteAbiertoDe(e, T.ENLACE_NUBE);
      if (inc && e.nube.caidaDesdeS === null) {
        marcarChecklist(inc);
        resolverIncidente(e, inc, 'Sistema', 'Buzón vacío: todas las decisiones del corte llegaron a la nube sin duplicados.');
      }
    }
  }

  // ---------- episodios de intentos en diario ----------

  function abrirEpisodio(e, id, titulo, puntos) {
    e.episodios[id] = { id: id, titulo: titulo, puntos: puntos, intentos: 0, porPunto: {}, cerrado: false };
    return id;
  }

  /** Cuando un episodio terminó y todo se consolidó, pasa a conciliación. */
  function cerrarEpisodiosListos(e) {
    Object.keys(e.episodios).forEach(function (k) {
      var ep = e.episodios[k];
      if (ep.cerrado || !ep.intentos) return;
      var activo = e.puntos.some(function (p) { return p.episodio === k && p.estado !== EP.EN_LINEA; }) ||
                   e.coordinador.episodio === k;
      var pendientes = Object.keys(ep.porPunto).some(function (id) { return e.puntosPorId[id].pendientesDiario > 0; });
      if (activo || pendientes) return;
      ep.cerrado = true;
      nuevaDiferencia(e, {
        tipo: 'diario',
        titulo: fmt.entero(ep.intentos) + ' intentos sin decisión confirmada',
        origen: ep.titulo,
        detalle: 'Se presentaron cuando ' + (k.indexOf('pausa') === 0 ? 'el coordinador no tenía autoridad' : 'la puerta no alcanzaba al coordinador') +
          '. Quedaron en los diarios de ' + Object.keys(ep.porPunto).length + ' lector(es) y ya se sincronizaron. Ninguno fue aceptado.',
        casos: ep.intentos,
        opciones: [{ id: 'sin-aceptacion', texto: 'Registrar sin aceptación', nota: 'No generan admisión ni cobro.' }]
      });
    });
  }

  // ==========================================================
  //  generación de intentos
  // ==========================================================

  /** Curva de llegada: pico poco después de la apertura (factor 3). */
  function tasa(e) {
    var ev = e.evento;
    if (ev.estado !== 'abierto') return ev.estado === 'preparacion' && e.ahoraS > ev.aperturaS - 600 ? 0.05 : 0;
    if (e.conteo.admisiones >= 15300) return 0.04;
    var x = (e.ahoraS - ev.aperturaS) / (130 * 60);
    if (x < 0 || x > 1) return 0.12;
    return 9.8 * Math.exp(-Math.pow((x - 0.52) / 0.11, 2)) + 0.2;
  }

  function generarIntentos(e, dt) {
    var esperados = tasa(e) * dt;
    var n = Math.floor(esperados);
    if (rnd() < esperados - n) n++;
    for (var i = 0; i < n; i++) intentoAleatorio(e);
  }

  var pesosZona = null;

  function elegirPunto(e) {
    if (!pesosZona) {
      pesosZona = {};
      NEXO.datos.ZONAS.forEach(function (z) {
        var puertas = e.puntos.filter(function (p) { return p.zona === z.nombre; }).length;
        pesosZona[z.nombre] = z.estimadas / puertas;
      });
    }
    // Averiadas y redirigidas no reciben gente; las demás sí, aunque
    // estén sin comunicación (el asistente no lo sabe hasta llegar).
    var activos = e.puntos.filter(function (p) { return p.estado !== EP.AVERIADO && !p.redirigido; });
    var total = 0;
    var pesos = activos.map(function (p) { var w = pesosZona[p.zona]; total += w; return w; });
    var r = rnd() * total;
    for (var i = 0; i < activos.length; i++) { r -= pesos[i]; if (r <= 0) return activos[i]; }
    return activos[activos.length - 1];
  }

  function muestra(arr) { return arr.length ? arr[Math.floor(rnd() * arr.length)] : null; }

  function boletaSinUsar(bolsa) {
    for (var j = 0; j < 30; j++) { var b = muestra(bolsa); if (b && b.consumidaEnS === null && !b.anulacion) return b; }
    return null;
  }

  function intentoAleatorio(e) {
    var p = elegirPunto(e);
    if (!p) return;
    var r = rnd(), bolsa = e.boletas.porZona[p.zona], b;

    if (r < 0.012) b = null;                                                  // código desconocido
    else if (r < 0.045) {                                                     // puerta equivocada
      var otras = Object.keys(e.boletas.porZona).filter(function (z) { return p.zonas.indexOf(z) === -1; });
      b = muestra(e.boletas.porZona[muestra(otras)]);
    } else if (r < 0.052) {                                                   // boleta anulada revendida
      // Se revenden sobre todo las anuladas hace poco.
      b = muestra(e.boletas.anuladas.filter(function (x) { return p.zonas.indexOf(x.zona) !== -1; }).slice(-5)) ||
          boletaSinUsar(bolsa);
    } else if (r < 0.092) {                                                   // reingreso o reintento
      b = null;
      for (var k = 0; k < 25 && !b; k++) {
        var c = muestra(bolsa);
        if (c && c.consumidaEnS !== null) b = c;
      }
      b = b || boletaSinUsar(bolsa);
    } else {
      b = boletaSinUsar(bolsa) || boletaSinUsar(e.boletas.orden);
    }

    registrar(e, p, b);

    // Copia de la misma boleta en otra puerta, en el mismo instante:
    // el coordinador es una sola autoridad, así que solo una gana.
    if (b && r > 0.092 && r < 0.095) {
      var otra = muestra(e.puntos.filter(function (x) { return x.id !== p.id && x.zonas.indexOf(b.zona) !== -1 && x.estado === EP.EN_LINEA; }));
      if (otra) registrar(e, otra, b);
    }
  }

  /** Registra un intento completo: decisión, consumo, evidencia y efectos. */
  function registrar(e, p, b, manual) {
    var fallo = d.decidir({ boleta: b, punto: p, evento: e.evento, coordinador: e.coordinador, ahoraS: e.ahoraS });
    d.consumir(b, fallo, e.ahoraS, p.id);

    var lat = latencia(e, p, fallo);
    var it = {
      id: p.id + '-' + String(++e.totalIntentos).padStart(6, '0'),   // identificador de origen estable
      ref: b ? b.ref : 'XX-' + Math.floor(1000 + rnd() * 8999) + '-' + Math.floor(1000 + rnd() * 8999),
      zona: b ? b.zona : '—',
      puntoId: p.id,
      lector: p.lectores[0].id,
      t: e.ahoraS,
      decision: fallo.decision,
      motivo: fallo.motivo,
      proposito: fallo.proposito,
      admision: fallo.generaAdmision,
      concurrente: fallo.concurrente,
      latenciaMs: lat,
      evidencia: fallo.evidencia,
      enDiario: fallo.decision === D.SIN_RESPUESTA,
      manual: !!manual
    };

    efectos(e, it, b, p, fallo);
    archivar(e, it, p);
    return it;
  }

  function efectos(e, it, b, p, fallo) {
    var c = e.conteo;
    c.intentos++;

    if (fallo.decision === D.SIN_RESPUESTA) {
      c.sinRespuesta++;
      p.pendientesDiario++; p.diarioTotal++;
      var ep = e.coordinador.estado !== EC.OPERANDO ? e.coordinador.episodio : p.episodio;
      if (ep && e.episodios[ep]) {
        e.episodios[ep].intentos++;
        e.episodios[ep].porPunto[p.id] = (e.episodios[ep].porPunto[p.id] || 0) + 1;
      }
      return;
    }

    c.decisiones++;
    c.camposCompletos++;
    e.nube.buzon++;

    if (fallo.decision === D.ACEPTADO) {
      c.aceptados++;
      if (fallo.generaAdmision) {
        c.admisiones++;
        e.admisionesPorZona[b.zona]++;
        if (fallo.anulacionEnTransito) e.integracion.pendientesRevision = (e.integracion.pendientesRevision || 0) + 1;
      } else {
        c.reingresos++;
      }
    } else {
      c.rechazados++;
      if (fallo.motivo === M.CODIGO_DESCONOCIDO) c.desconocidos++;
      if (fallo.motivo === M.ZONA_NO_AUTORIZADA) c.zonaIncorrecta++;
      if (fallo.motivo === M.BOLETA_ANULADA) c.anuladas++;
      if (fallo.concurrente) c.concurrentes++;
      if (fallo.motivo === M.USO_YA_REGISTRADO || fallo.motivo === M.REINGRESO_SUSPENDIDO) c.usoRegistrado++;
    }
  }

  function archivar(e, it, p) {
    e.intentos.unshift(it);
    if (e.intentos.length > MAX_INTENTOS) e.intentos.pop();
    if (it.decision !== D.SIN_RESPUESTA) { p.decisionesMinutoActual++; ventana.push(e.ahoraS); }
    p.recientes.unshift(it);
    if (p.recientes.length > 12) p.recientes.pop();

    if (p.id === e.lector.puntoId) {
      e.lector.ultima = it;
      e.lector.historial.unshift(it);
      if (e.lector.historial.length > 6) e.lector.historial.pop();
    }

    var m = e.metricas;
    // CA2 y ADR-013: denominador completo, incluidas las sin respuesta.
    m.solicitudes++;
    if (it.decision !== D.SIN_RESPUESTA && it.latenciaMs <= d.Umbral.LATENCIA_MS) m.enPlazo++;
    if (it.decision !== D.SIN_RESPUESTA) {
      m.muestra.push(it.latenciaMs);
      if (m.muestra.length > 600) m.muestra.shift();
      p.latencias.push(it.latenciaMs);
      if (p.latencias.length > 60) p.latencias.shift();
      // KR1.1: visible en el panel central en 5 s. Las decisiones
      // tomadas durante un corte de enlace se informan aparte.
      if (e.nube.enLinea) {
        m.visiblesTotal++;
        if (rnd() > 0.006) m.visiblesEnPlazo++;
      } else {
        m.duranteCorte++;
      }
    }

    // Alerta de latencia: una por punto cada 25 minutos como máximo.
    if (it.latenciaMs > 1150 && e.evento.estado === 'abierto' &&
        e.ahoraS - (e.ultimaAlertaLatS || -1e9) > 900 && !saltando) {
      e.ultimaAlertaLatS = e.ahoraS;
      abrirIncidente(e, {
        tipo: T.LATENCIA, prioridad: d.Prioridad.BAJA, puntoId: p.id,
        titulo: 'Respuesta lenta en ' + p.nombre,
        descripcion: 'Una validación tardó ' + fmt.entero(it.latenciaMs) + ' ms medidos en el lector, de extremo a extremo (ADR-013). El umbral es 500 ms para el 95 % de las solicitudes.',
        responsable: d.Rol.LIDER_TECNICO,
        checklist: ['Revisar el enlace inalámbrico de la puerta', 'Comparar con la latencia de las puertas vecinas']
      });
    }
  }

  function latencia(e, p, fallo) {
    if (fallo.decision === D.SIN_RESPUESTA) return null;     // plazo vencido
    var base = 120 + rnd() * 170;
    if (rnd() < 0.012) base += 380 + rnd() * 900;            // cola larga
    return Math.round(base);
  }

  // ==========================================================
  //  incidentes, acciones y bitácoras
  // ==========================================================

  function abrirIncidente(e, o) {
    var inc = {
      id: 'INC-' + String(++e.secInc).padStart(4, '0'),
      tipo: o.tipo, clasificacion: o.tipo,
      prioridad: o.prioridad,
      puntoId: o.puntoId || null,
      componente: o.componente || (o.puntoId ? o.puntoId + ' · ' + e.puntosPorId[o.puntoId].nombre : '—'),
      zona: o.puntoId ? e.puntosPorId[o.puntoId].zona : null,
      titulo: o.titulo,
      descripcion: o.descripcion,
      responsable: o.responsable,
      estado: 'nuevo',                     // nuevo | en-curso | resuelto | descartado
      recibidaEnS: e.ahoraS,
      actuadaEnS: null,
      resueltaEnS: null,
      recuperadaEnS: null,
      metaRecuperacionS: o.metaRecuperacionS || null,
      // KR2.2 mide desde la falla; KR2.1, desde que vuelve la comunicación.
      relojDesdeS: o.relojAlRestablecer ? null : e.ahoraS,
      accion: null,
      destacado: false,
      checklist: (o.checklist || []).map(function (t) { return { texto: t, hecho: false }; }),
      // cuándo actuaría el personal simulado si nadie lo hace en la interfaz
      autoEnS: e.ahoraS + (rnd() < 0.85 ? 50 + rnd() * 200 : 320 + rnd() * 200),
      bitacora: []
    };
    bitacora(inc, e, 'NEXO', 'sistema', o.descripcion);
    e.incidentes.unshift(inc);
    actividad(e, inc.id + ' · ' + inc.titulo, tonoDe(inc.prioridad));
    return inc;
  }

  function tonoDe(prioridad) {
    return prioridad.id === 'critica' ? 'no' : prioridad.id === 'alta' ? 'warn' : 'info';
  }

  function bitacora(inc, e, autor, tipo, texto) {
    // ADR-004: solo adición. Nada se edita ni se borra.
    inc.bitacora.push({ t: e.ahoraS, autor: autor, tipo: tipo, texto: texto });
  }

  function marcarChecklist(inc, hasta) {
    inc.checklist.forEach(function (c, i) { if (hasta === undefined || i < hasta) c.hecho = true; });
  }

  function incidenteAbiertoDe(e, tipo, puntoId) {
    for (var i = 0; i < e.incidentes.length; i++) {
      var x = e.incidentes[i];
      if (x.tipo === tipo && (puntoId === undefined || x.puntoId === puntoId) &&
          x.estado !== 'resuelto' && x.estado !== 'descartado') return x;
    }
    return null;
  }

  function buscarIncidente(id) {
    return E().incidentes.filter(function (x) { return x.id === id; })[0] || null;
  }

  /** KR1.3: la primera acción o decisión detiene el reloj de actuación. */
  function registrarActuacion(e, inc, autor, texto) {
    if (inc.actuadaEnS === null) {
      inc.actuadaEnS = e.ahoraS;
      if (inc.estado === 'nuevo') inc.estado = 'en-curso';
      var dur = inc.actuadaEnS - inc.recibidaEnS;
      bitacora(inc, e, autor, 'accion', texto + ' · Actuación ' + fmt.duracion(dur) + ' después de recibirlo' +
        (dur < d.Umbral.ACTUACION_S ? ' (en meta).' : ' (fuera de la meta de 5 min).'));
    } else {
      bitacora(inc, e, autor, 'accion', texto);
    }
  }

  function resolverIncidente(e, inc, autor, texto) {
    if (inc.estado === 'resuelto' || inc.estado === 'descartado') return;
    if (inc.actuadaEnS === null) registrarActuacion(e, inc, autor, 'Atendido automáticamente');
    inc.estado = 'resuelto';
    inc.resueltaEnS = e.ahoraS;
    bitacora(inc, e, autor, 'estado', 'Resuelto. ' + texto);
    actividad(e, inc.id + ' resuelto · ' + inc.titulo, 'ok');
  }

  function nuevaAccion(e, o) {
    var a = {
      id: 'ACC-' + (++e.secAcc),
      tipo: o.tipo, titulo: o.titulo, detalle: o.detalle,
      si: o.si, no: o.no, rol: o.rol,
      incidenteId: o.incidenteId || null,
      enlace: o.enlace || (o.incidenteId ? '#/incidentes/' + o.incidenteId : null),
      decisiva: !!o.decisiva,
      estado: 'pendiente',
      creadaEnS: e.ahoraS,
      autoEnS: o.autoTrasS ? e.ahoraS + o.autoTrasS : null
    };
    e.acciones.unshift(a);
    if (a.decisiva && !saltando && e.velocidad > 1) {
      // Se baja la velocidad para que haya tiempo de decidir.
      e.velocidadPrevia = e.velocidad;
      e.velocidad = 1;
      avisar({ titulo: 'Tu decisión es necesaria', texto: a.titulo + '. La demo bajó a 1× para que puedas decidir.', tono: 'violet', enlace: a.enlace });
    }
    return a;
  }

  function cerrarAccionesDe(e, inc, motivo) {
    if (!inc) return;
    e.acciones.forEach(function (a) {
      if (a.incidenteId === inc.id && a.estado === 'pendiente') { a.estado = 'caducada'; a.nota = motivo; }
    });
  }

  /** Resolver una acción pendiente (desde la interfaz o el personal simulado). */
  function decidirAccion(id, aprobar, autor) {
    var e = E();
    var a = e.acciones.filter(function (x) { return x.id === id; })[0];
    if (!a || a.estado !== 'pendiente') return;
    autor = autor || e.rol;
    var inc = a.incidenteId ? buscarIncidente(a.incidenteId) : null;
    a.estado = aprobar ? 'aprobada' : 'rechazada';
    a.decididaEnS = e.ahoraS;
    a.autor = autor;

    if (a.decisiva && e.velocidadPrevia) { e.velocidad = e.velocidadPrevia; e.velocidadPrevia = null; }

    if (a.tipo === 'promover') {
      if (aprobar) {
        if (inc) registrarActuacion(e, inc, autor, 'Aprobó promover ' + e.coordinador.replica + ' a primario');
        promoverReplica(e, inc);
      } else {
        if (inc) registrarActuacion(e, inc, autor, 'Rechazó la promoción: se mantiene la pausa hasta verificar el aislamiento');
        reprogramar(e, a, 40);
      }
    } else if (a.tipo === 'credencial') {
      var p = inc ? e.puntosPorId[inc.puntoId] : null;
      if (aprobar && p) {
        if (inc) { registrarActuacion(e, inc, autor, 'Emitió credencial CRED-' + p.id + '-B para el repuesto'); marcarChecklist(inc, 3); }
        instalarRepuesto(e, p, inc);
      } else {
        if (inc) registrarActuacion(e, inc, autor, 'Rechazó la credencial: la puerta sigue fuera de servicio');
        reprogramar(e, a, 60);
      }
    } else if (a.tipo === 'redirigir') {
      var pr = inc ? e.puntosPorId[inc.puntoId] : null;
      if (aprobar && pr) {
        pr.redirigido = true;
        registrarPunto(pr, e, 'Flujo redirigido a ' + vecinas(e, pr).join(' y ') + '.', 'info');
        if (inc) { registrarActuacion(e, inc, autor, 'Redirigió el flujo a ' + vecinas(e, pr).join(' y ')); marcarChecklist(inc, 1); }
      } else {
        if (inc) registrarActuacion(e, inc, autor, 'Pospuso la redirección');
        reprogramar(e, a, 120);
      }
    } else if (a.tipo === 'reingresos') {
      if (aprobar) {
        e.evento.politicas.reingresoSuspendido = true;
        actividad(e, 'Reingresos suspendidos hasta recibir los cambios de la boletería.', 'warn');
        if (inc) { registrarActuacion(e, inc, autor, 'Suspendió los reingresos'); marcarChecklist(inc, 2); }
      } else if (inc) {
        registrarActuacion(e, inc, autor, 'Decidió no suspender los reingresos (decisión justificada)');
      }
    } else if (a.tipo === 'preliminar') {
      entregarPreliminar();
    }
    NEXO.store.notificar();
  }

  function reprogramar(e, a, trasS) {
    var copia = nuevaAccion(e, {
      tipo: a.tipo, incidenteId: a.incidenteId, decisiva: false,
      titulo: a.titulo, detalle: a.detalle, si: a.si, no: a.no, rol: a.rol, autoTrasS: trasS + 30
    });
    copia.reintento = true;
  }

  /** Personal simulado: actúa si nadie lo hace desde la interfaz. */
  function personalSimulado(e) {
    e.acciones.forEach(function (a) {
      if (a.estado === 'pendiente' && a.autoEnS !== null && e.ahoraS >= a.autoEnS) {
        decidirAccion(a.id, true, a.rol + ' (simulado)');
      }
    });
    e.incidentes.forEach(function (inc) {
      if (inc.estado !== 'nuevo' || e.ahoraS < inc.autoEnS) return;
      var pendiente = e.acciones.some(function (a) { return a.incidenteId === inc.id && a.estado === 'pendiente'; });
      if (pendiente) return;
      if (inc.tipo === T.LATENCIA) {
        registrarActuacion(e, inc, inc.responsable + ' (simulado)', 'Revisó el enlace; la latencia volvió a la normalidad');
        resolverIncidente(e, inc, inc.responsable + ' (simulado)', 'Pico aislado, sin cambios necesarios.');
      } else if (inc.tipo === T.ENLACE_NUBE) {
        registrarActuacion(e, inc, inc.responsable + ' (simulado)', 'Escaló el corte al proveedor de conectividad');
        marcarChecklist(inc, 2);
      } else {
        registrarActuacion(e, inc, inc.responsable + ' (simulado)', 'Tomó el incidente');
      }
    });
  }

  // ==========================================================
  //  acciones del usuario sobre incidentes
  // ==========================================================

  function tomarIncidente(id) {
    var e = E(), inc = buscarIncidente(id);
    if (!inc || inc.estado === 'resuelto' || inc.estado === 'descartado') return;
    inc.responsable = e.rol;
    registrarActuacion(e, inc, e.rol, 'Tomó el incidente');
    NEXO.store.notificar();
  }

  function actualizarIncidente(id, cambios) {
    var e = E(), inc = buscarIncidente(id);
    if (!inc) return;
    var partes = [];
    if (cambios.prioridad && cambios.prioridad !== inc.prioridad.id) {
      Object.keys(d.Prioridad).forEach(function (k) { if (d.Prioridad[k].id === cambios.prioridad) inc.prioridad = d.Prioridad[k]; });
      partes.push('prioridad ' + inc.prioridad.nombre);
    }
    if (cambios.clasificacion && cambios.clasificacion !== inc.clasificacion) {
      inc.clasificacion = cambios.clasificacion; partes.push('clasificación «' + cambios.clasificacion + '»');
    }
    if (cambios.responsable && cambios.responsable !== inc.responsable) {
      inc.responsable = cambios.responsable; partes.push('responsable ' + cambios.responsable);
    }
    if (!partes.length) return;
    registrarActuacion(e, inc, e.rol, 'Actualizó ' + partes.join(', '));
    NEXO.store.notificar();
  }

  function notaIncidente(id, texto) {
    var e = E(), inc = buscarIncidente(id);
    if (!inc || !texto.trim()) return;
    bitacora(inc, e, e.rol, 'nota', texto.trim());
    NEXO.store.notificar();
  }

  function resolverManual(id) {
    var e = E(), inc = buscarIncidente(id);
    if (!inc) return;
    var abierto = (inc.tipo === T.SIN_COMUNICACION && e.puntosPorId[inc.puntoId].pendientesDiario > 0) ||
                  (inc.tipo === T.LECTOR_AVERIADO && e.puntosPorId[inc.puntoId].estado === EP.AVERIADO) ||
                  (inc.tipo === T.COORDINADOR && e.coordinador.estado !== EC.OPERANDO) ||
                  (inc.tipo === T.ENLACE_NUBE && (!e.nube.enLinea || e.nube.buzon > 0));
    if (abierto) {
      avisar({ titulo: 'Todavía no se puede resolver', texto: 'La causa sigue activa. Resolver no borra el problema: primero hay que recuperarlo.', tono: 'warn' });
      return;
    }
    resolverIncidente(e, inc, e.rol, 'Cerrado manualmente.');
    NEXO.store.notificar();
  }

  function descartarIncidente(id) {
    var e = E(), inc = buscarIncidente(id);
    if (!inc || inc.estado === 'resuelto' || inc.estado === 'descartado') return;
    registrarActuacion(e, inc, e.rol, 'Clasificó como falsa alarma');
    inc.clasificacion = T.FALSA_ALARMA;
    inc.estado = 'descartado';
    inc.resueltaEnS = e.ahoraS;
    bitacora(inc, e, e.rol, 'estado', 'Descartado como falsa alarma. Sigue contando en el denominador de KR1.3 y se informa aparte.');
    NEXO.store.notificar();
  }

  function destacar(id) {
    var inc = buscarIncidente(id);
    if (inc) { inc.destacado = !inc.destacado; NEXO.store.notificar(); }
  }

  function alternarChecklist(id, i) {
    var inc = buscarIncidente(id);
    if (!inc || !inc.checklist[i]) return;
    inc.checklist[i].hecho = !inc.checklist[i].hecho;
    if (inc.checklist[i].hecho) registrarActuacion(E(), inc, E().rol, 'Completó «' + inc.checklist[i].texto + '»');
    NEXO.store.notificar();
  }

  // ==========================================================
  //  lector manual (pantalla del lector)
  // ==========================================================

  function escanear(caso) {
    var e = E();
    var p = e.puntosPorId[e.lector.puntoId];
    var bolsa = e.boletas.porZona[p.zona];
    var b = null;

    if (caso === 'valida') b = boletaSinUsar(bolsa);
    else if (caso === 'repetida') b = e.lector.ultimaBoleta || boletaSinUsar(bolsa);
    else if (caso === 'otra-zona') {
      var z = Object.keys(e.boletas.porZona).filter(function (x) { return p.zonas.indexOf(x) === -1; })[0];
      b = muestra(e.boletas.porZona[z]);
    } else if (caso === 'anulada') {
      b = boletaSinUsar(bolsa);
      if (b) {
        b.anulacion = { emitidaEnS: e.ahoraS - 120, recibidaEnS: e.ahoraS - 110 };
        e.boletas.anuladas.push(b);
      }
    } else if (caso === 'desconocida') b = null;
    else if (caso === 'copia') {
      b = boletaSinUsar(bolsa);
      var otra = e.puntos.filter(function (x) { return x.id !== p.id && x.zonas.indexOf(p.zona) !== -1; })[0];
      if (otra && b) registrar(e, otra, b, true);   // la copia llega primero a la otra puerta
    }

    var it = registrar(e, p, b, true);
    it.caso = caso;
    e.lector.manuales.unshift(it);
    if (e.lector.manuales.length > 5) e.lector.manuales.pop();
    if (b && caso !== 'copia') e.lector.ultimaBoleta = b;
    e.lector.ultimoCaso = caso;
    e.lector.escaneadoEnMs = Date.now();
    NEXO.store.notificar();
    return it;
  }

  function fijarPuntoLector(id) {
    var e = E();
    e.lector.puntoId = id;
    e.lector.ultima = e.intentos.filter(function (x) { return x.puntoId === id; })[0] || null;
    e.lector.historial = e.intentos.filter(function (x) { return x.puntoId === id; }).slice(0, 6);
    e.lector.ultimaBoleta = null;
    e.lector.manuales = [];
    NEXO.store.notificar();
  }

  // ==========================================================
  //  preparación
  // ==========================================================

  function alternarControl(id) {
    var e = E();
    e.preparacion.controles.forEach(function (c) { if (c.id === id) c.ok = !c.ok; });
    if (e.preparacion.controles.some(function (c) { return !c.ok; })) e.preparacion.confirmada = false;
    NEXO.store.notificar();
  }

  function confirmarApertura() {
    var e = E();
    if (e.preparacion.controles.some(function (c) { return !c.ok; })) return;
    e.preparacion.confirmada = true;
    actividad(e, 'Apertura confirmada por ' + e.rol + '. Todos los controles previos cumplen.', 'ok');
    NEXO.store.notificar();
  }

  // ==========================================================
  //  cierre y liquidación
  // ==========================================================

  function difAnulacion(e, b) {
    var intento = e.intentos.filter(function (x) { return x.ref === b.ref && x.admision; })[0];
    nuevaDiferencia(e, {
      tipo: 'anulacion',
      titulo: b.ref + ' aceptada antes de recibir su anulación',
      origen: 'Integración con la boletería',
      detalle: 'Aceptada en ' + b.consumidaEnPunto + ' a las ' + fmt.hora(b.consumidaEnS, true) +
        '. La boletería la anuló a las ' + fmt.hora(b.anulacion.emitidaEnS, true) +
        ' pero el cambio llegó a las ' + fmt.hora(b.anulacion.recibidaEnS, true) + '. La decisión en puerta se conserva tal como se emitió.',
      casos: 1,
      referencia: b.ref,
      intentoId: intento ? intento.id : null,
      opciones: [
        { id: 'excluir', texto: 'Excluir del cobro', nota: 'No cuenta como admisión facturable.' },
        { id: 'mantener', texto: 'Mantener la admisión', nota: 'Solo si el cliente lo acuerda por escrito.' }
      ]
    });
  }

  function nuevaDiferencia(e, o) {
    var dif = o;
    dif.id = 'DIF-' + String(e.conciliacion.diferencias.length + 1).padStart(3, '0');
    dif.estado = 'abierta';
    dif.detectadaEnS = e.ahoraS;
    dif.resolucion = null;
    e.conciliacion.diferencias.push(dif);
  }

  function resolverDiferencia(id, opcion) {
    var e = E();
    var dif = e.conciliacion.diferencias.filter(function (x) { return x.id === id; })[0];
    if (!dif || dif.estado !== 'abierta') return;
    var op = dif.opciones.filter(function (o) { return o.id === opcion; })[0] || dif.opciones[0];
    dif.estado = 'resuelta';
    dif.resolucion = op.texto;
    dif.resueltaPor = e.rol;
    dif.resueltaEnS = e.ahoraS;
    if (op.id === 'excluir') {
      var b = e.boletas.buscar(dif.referencia);
      if (b) b.excluida = true;
    }
    NEXO.store.notificar();
  }

  function resolverTodas(tipo) {
    var e = E();
    e.conciliacion.diferencias.forEach(function (x) {
      if (x.estado === 'abierta' && (!tipo || x.tipo === tipo)) resolverDiferencia(x.id, x.opciones[0].id);
    });
  }

  function entregarPreliminar() {
    var e = E();
    if (e.conciliacion.estado !== 'en-curso') return;
    e.conciliacion.estado = 'preliminar';
    e.conciliacion.preliminarEnS = e.ahoraS;
    e.acciones.forEach(function (a) { if (a.tipo === 'preliminar' && a.estado === 'pendiente') { a.estado = 'aprobada'; a.autor = e.rol; } });
    actividad(e, 'Informe preliminar entregado ' + fmt.duracion(e.ahoraS - e.evento.cierreS) + ' después del cierre.', 'ok');
    NEXO.store.notificar();
  }

  /** Condiciones para declarar conciliado (regla 7). */
  function condicionesCierre(e) {
    var pend = e.puntos.reduce(function (s, p) { return s + p.pendientesDiario; }, 0);
    var abiertas = e.conciliacion.diferencias.filter(function (x) { return x.estado === 'abierta'; }).length;
    var enTransito = e.integracion.enTransito.length;
    return [
      { id: 'ventana', texto: 'Ventana de ingreso cerrada', ok: e.evento.estado === 'cerrado' },
      { id: 'diarios', texto: 'Diarios de los 20 lectores sincronizados', ok: pend === 0, nota: pend ? fmt.entero(pend) + ' intentos pendientes' : null },
      { id: 'buzon', texto: 'Todas las decisiones llegaron a la nube', ok: e.nube.buzon === 0 && e.nube.enLinea, nota: e.nube.buzon ? fmt.entero(e.nube.buzon) + ' en el buzón' : null },
      { id: 'cambios', texto: 'Cambios de la boletería al día', ok: enTransito === 0 },
      { id: 'preliminar', texto: 'Informe preliminar entregado', ok: e.conciliacion.preliminarEnS !== null },
      { id: 'diferencias', texto: 'Todas las diferencias resueltas', ok: abiertas === 0, nota: abiertas ? abiertas + ' abiertas' : null }
    ];
  }

  function puedeConciliar(e) {
    return e.conciliacion.estado === 'preliminar' && condicionesCierre(e).every(function (c) { return c.ok; });
  }

  function declararConciliado() {
    var e = E();
    if (!puedeConciliar(e)) return;
    e.conciliacion.estado = 'conciliado';
    e.conciliacion.definitivoEnS = e.ahoraS;
    actividad(e, 'Cierre definitivo conciliado. La liquidación del evento ya se puede calcular.', 'ok');
    NEXO.store.notificar();
  }

  function registrarCobro() {
    var e = E();
    if (e.conciliacion.estado !== 'conciliado') return;
    e.conciliacion.saldoCobrado = true;
    actividad(e, 'Saldo del evento registrado como cobrado.', 'ok');
    NEXO.store.notificar();
  }

  /** Liquidación del evento a partir del uso real conciliado. */
  function liquidacion(e) {
    var excluidas = e.boletas.orden.filter(function (b) { return b.excluida && b.consumidaEnS !== null; }).length;
    var facturables = e.conteo.admisiones - excluidas;
    var T8 = d.Tarifa;
    var importe = T8.importe(facturables, e.evento.gratuito);
    var anticipo = T8.anticipo(e.evento.admisionesEstimadas, e.evento.gratuito);
    var escalacion = e.incidentes.some(function (x) { return x.tipo === T.COORDINADOR; }) ? 20 : 0;
    var costos = T8.trabajoPorEvento + escalacion;
    return {
      admisiones: e.conteo.admisiones, excluidas: excluidas, facturables: facturables,
      cargoEvento: T8.cargoPorEvento, cargoAdmisiones: T8.cargoPorAdmision * facturables,
      importe: importe, anticipo: anticipo, saldo: importe - anticipo,
      trabajo: T8.trabajoPorEvento, escalacion: escalacion, costos: costos,
      contribucion: T8.contribucion(facturables, costos, e.evento.gratuito),
      margen: importe ? (importe - costos) / importe * 100 : 0
    };
  }

  // ==========================================================
  //  métricas y bitácora general
  // ==========================================================

  function metricas(e) {
    var m = e.metricas;
    while (ventana.length && ventana[0] < e.ahoraS - 60) ventana.shift();
    m.dps = ventana.length / 60;
    m.p95Ms = Math.round(u.percentil(m.muestra, 0.95));

    var minuto = Math.floor(e.ahoraS / 60);
    if (minuto !== e.minutoPublicado) {
      e.minutoPublicado = minuto;
      var total = 0;
      e.puntos.forEach(function (p) {
        p.decisionesMinuto = p.decisionesMinutoActual;
        p.serie.push(p.decisionesMinutoActual);
        if (p.serie.length > 30) p.serie.shift();
        total += p.decisionesMinutoActual;
        p.decisionesMinutoActual = 0;
      });
      e.serie.push({ minuto: minuto, decisiones: total });
      if (e.serie.length > 40) e.serie.shift();
    }
  }

  function actividad(e, texto, tono) {
    e.actividad.unshift({ t: e.ahoraS, texto: texto, tono: tono || 'info' });
    if (e.actividad.length > 40) e.actividad.pop();
  }

  function registrarPunto(p, e, texto, tono) {
    p.actividad.push({ t: e.ahoraS, tipo: tono || 'info', texto: texto });
  }

  function avisar(a) { if (!saltando) NEXO.store.avisar(a); }

  function cambiarRol(rol) { E().rol = rol; NEXO.store.notificar(); }

  return {
    iniciar: iniciar, pausar: pausar, alternar: alternar, velocidad: velocidad,
    reiniciar: reiniciar, saltarA: saltarA,
    decidirAccion: decidirAccion,
    tomarIncidente: tomarIncidente, actualizarIncidente: actualizarIncidente,
    notaIncidente: notaIncidente, resolverIncidente: resolverManual,
    descartarIncidente: descartarIncidente, destacar: destacar, alternarChecklist: alternarChecklist,
    escanear: escanear, fijarPuntoLector: fijarPuntoLector,
    alternarControl: alternarControl, confirmarApertura: confirmarApertura,
    entregarPreliminar: entregarPreliminar, resolverDiferencia: resolverDiferencia,
    resolverTodas: resolverTodas, declararConciliado: declararConciliado,
    puedeConciliar: puedeConciliar, condicionesCierre: condicionesCierre,
    registrarCobro: registrarCobro, liquidacion: liquidacion,
    cambiarRol: cambiarRol,
    MINUTOS: { apertura: 0, incidentes: 60, coordinador: 83 }
  };
})();

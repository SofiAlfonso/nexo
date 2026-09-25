/* ============================================================
   modelo/dominio.js — modelo de dominio de NEXO

   Único lugar donde vive una regla de negocio. Las vistas no
   deciden nada: preguntan aquí. Sigue el modelo de dominio
   (11 conceptos, 10 reglas) y los ADR 001–013.

   Lenguaje ubicuo:
     Punto de validación  lugar habilitado para recibir intentos;
                          sobrevive al cambio de lector.
     Boleta               referencia de un permiso emitido por la
                          boletería para un evento. No es una persona.
     Intento              presentación de un código en un punto.
     Validación           decisión de aceptar o rechazar. NEXO decide
                          (coordinador local); el lector comunica.
     Admisión             PRIMERA aceptación correcta de una boleta
                          en el evento. Unidad facturable.
     Conciliación         cierre que reúne decisiones únicas y
                          resuelve pendientes y diferencias.
     Liquidación          importe del servicio por evento y sus cobros.
   ============================================================ */

NEXO.dominio = (function () {
  'use strict';

  // ==========================================================
  //  enumerados cerrados
  // ==========================================================

  var Decision = {
    ACEPTADO: 'aceptado',
    RECHAZADO: 'rechazado',
    // Regla 3 y ADR-011: un intento sin decisión confirmada queda en
    // el diario del lector y NUNCA equivale a aceptación.
    SIN_RESPUESTA: 'sin-respuesta'
  };

  var Motivo = {
    PERMISO_VIGENTE: 'Permiso vigente para esta puerta y horario',
    REINGRESO_AUTORIZADO: 'Reingreso autorizado por la política del evento',
    ZONA_NO_AUTORIZADA: 'La boleta no autoriza la zona de esta puerta',
    BOLETA_ANULADA: 'Boleta anulada por la boletería',
    FUERA_DE_HORARIO: 'Fuera de la ventana de ingreso',
    USO_YA_REGISTRADO: 'Uso ya registrado; reingreso no permitido todavía',
    USO_CONCURRENTE: 'Otra puerta consumió esta boleta en el mismo instante',
    REINGRESO_SUSPENDIDO: 'Reingresos suspendidos: permisos desactualizados',
    CODIGO_DESCONOCIDO: 'Código desconocido para este evento',
    SIN_COORDINADOR: 'Sin respuesta del coordinador local',
    PUNTO_SUSPENDIDO: 'Punto fuera de servicio'
  };

  /** Estado visible de un punto de validación. */
  var EstadoPunto = {
    EN_LINEA: 'en-linea',
    SIN_COMUNICACION: 'sin-comunicacion',   // no alcanza al coordinador
    AVERIADO: 'averiado',                   // lector fuera de servicio
    EN_PAUSA: 'en-pausa',                   // el coordinador se está recuperando
    SIN_ABRIR: 'sin-abrir'
  };

  /** ADR-005: una única autoridad lógica por evento. */
  var EstadoCoordinador = {
    OPERANDO: 'operando',
    SIN_AUTORIDAD: 'sin-autoridad',          // primario caído: no se autoriza
    PROTEGIENDO: 'protegiendo'               // promovido; restablece réplica síncrona
  };

  /**
   * Taxonomía de incidentes. Enumerado CERRADO y versionado con el
   * evento: si cambiara a mitad del piloto, los tres eventos dejarían
   * de ser comparables y el indicador de KR1.3 perdería su base.
   */
  var TipoIncidente = {
    SIN_COMUNICACION: 'Puerta sin comunicación',
    LECTOR_AVERIADO: 'Lector averiado',
    COORDINADOR: 'Falla del coordinador',
    ENLACE_NUBE: 'Sin enlace con la nube',
    PERMISOS: 'Permisos desactualizados',
    LATENCIA: 'Latencia sobre el umbral',
    FALSA_ALARMA: 'Falsa alarma'
  };
  var VERSION_TAXONOMIA = 'v1 · fijada antes del piloto';

  var Prioridad = {
    CRITICA: { id: 'critica', nombre: 'Crítica', orden: 0 },
    ALTA: { id: 'alta', nombre: 'Alta', orden: 1 },
    MEDIA: { id: 'media', nombre: 'Media', orden: 2 },
    BAJA: { id: 'baja', nombre: 'Baja', orden: 3 }
  };

  /** Roles del servicio (ADR-006 y ADR-009): no son asistentes. */
  var Rol = {
    SUPERVISOR: 'Supervisor del operador',
    LIDER_TECNICO: 'Líder técnico',
    LOGISTICA: 'Logística de puerta',
    CIERRE: 'Responsable de cierre',
    FINANZAS: 'Líder comercial y financiero'
  };

  // ==========================================================
  //  umbrales del taller (reglas medibles, no entidades)
  // ==========================================================

  var Umbral = {
    SIN_COMUNICACION_S: 60,        // KR1.2  «sin comunicación» a los 60 s como máximo
    DETECCION_S: 30,               // latido cada 10 s; tres perdidos = sin comunicación
    VISIBILIDAD_S: 5,              // KR1.1  95 % visibles en 5 s
    VISIBILIDAD_MIN_PCT: 95,
    SINCRONIZACION_S: 300,         // KR2.1  99,5 % de pendientes en 5 min
    SINCRONIZACION_MIN_PCT: 99.5,
    RECUPERACION_PUNTO_S: 180,     // KR2.2  punto restablecido en 3 min
    ACTUACION_S: 300,              // KR1.3  acción o decisión en menos de 5 min
    ACTUACION_MIN_PCT: 80,
    LATENCIA_MS: 500,              // CA2    respuesta en 500 ms
    LATENCIA_MIN_PCT: 95,
    TRAZABILIDAD_MIN_PCT: 99.9,    // KR4.2
    RECHAZOS_MAX_PCT: 0.5,         // KR4.1
    PRELIMINAR_S: 1800,            // KR4.3  preliminar en 30 min
    DEFINITIVO_S: 86400,           // KR4.3  definitivo en 24 h
    AUDITORIA_DIAS: 90,            // ADR-004 y ADR-012
    ANTIGUEDAD_PERMISOS_S: 300,    // ADR-010 antigüedad tolerable de permisos
    REINGRESO_MIN_S: 600,          // política del evento: reingreso tras 10 min
    COBRO_SALDO_DIAS: 30           // regla 8
  };

  // ==========================================================
  //  tarifa (regla 8)
  // ==========================================================

  var Tarifa = {
    moneda: 'USD',
    cargoPorEvento: 500,
    cargoPorAdmision: 0.40,
    trabajoPorEvento: 300,
    trabajoTope: 345,               // CA4: 115 % del estándar

    /** No se cobran rechazos, reingresos ni retransmisiones. */
    importe: function (admisiones, gratuito) {
      if (gratuito) return 0;
      return this.cargoPorEvento + this.cargoPorAdmision * admisiones;
    },
    /** Anticipo: cargo del evento más el 50 % del uso estimado. */
    anticipo: function (estimadas, gratuito) {
      if (gratuito) return 0;
      return this.cargoPorEvento + 0.5 * this.cargoPorAdmision * estimadas;
    },
    /** La contribución NO es utilidad: los fijos corren aparte. */
    contribucion: function (admisiones, costos, gratuito) {
      return this.importe(admisiones, gratuito) - costos;
    }
  };

  // ==========================================================
  //  el servicio de decisión (coordinador local, ADR-002/003)
  // ==========================================================

  /**
   * Decide un intento. Se ejecuta «dentro» del coordinador local
   * compartido: todos los lectores del evento le preguntan a la misma
   * autoridad, de modo que el consumo de una boleta es atómico y
   * global (ADR-003). No hay autorización autónoma en el lector.
   *
   * ctx: { boleta|null, punto, evento, coordinador, ahoraS, conocidaAnulacion }
   */
  function decidir(ctx) {
    var boleta = ctx.boleta, punto = ctx.punto, evento = ctx.evento, ahoraS = ctx.ahoraS;

    var evidencia = {
      via: 'Coordinador ' + ctx.coordinador.primario,
      versionPermisos: evento.versionPermisos,
      versionPoliticas: evento.politicas.version,
      antiguedadPermisosS: Math.max(0, Math.round(ahoraS - evento.ultimoCambioRecibidoS))
    };

    // ADR-002/011: si el lector no alcanza al coordinador, o este no
    // tiene autoridad válida, el intento se guarda en el diario del
    // lector SIN aceptación. No se transfiere autorización a nadie.
    if (punto.estado === EstadoPunto.AVERIADO) {
      return resultado(Decision.SIN_RESPUESTA, Motivo.PUNTO_SUSPENDIDO, evidencia);
    }
    if (punto.estado === EstadoPunto.SIN_COMUNICACION ||
        ctx.coordinador.estado !== EstadoCoordinador.OPERANDO) {
      evidencia.via = 'Diario del lector';
      return resultado(Decision.SIN_RESPUESTA, Motivo.SIN_COORDINADOR, evidencia);
    }

    // Regla 3: se registran los códigos desconocidos sin fabricar boleta.
    if (!boleta) return resultado(Decision.RECHAZADO, Motivo.CODIGO_DESCONOCIDO, evidencia);

    // ADR-010: una anulación aplicada antes de la validación la afecta;
    // una anulación no recibida no puede presumirse conocida.
    if (anulacionConocida(boleta, ahoraS)) {
      return resultado(Decision.RECHAZADO, Motivo.BOLETA_ANULADA, evidencia);
    }

    if (punto.zonas.indexOf(boleta.zona) === -1) {
      return resultado(Decision.RECHAZADO, Motivo.ZONA_NO_AUTORIZADA, evidencia);
    }

    if (ahoraS < evento.aperturaS || ahoraS > evento.cierreS) {
      return resultado(Decision.RECHAZADO, Motivo.FUERA_DE_HORARIO, evidencia);
    }

    // ADR-003: la clave de consumo es el permiso y el derecho de
    // ingreso, no la zona ni el lector. Si ya se consumió, solo cabe
    // un reingreso según la política vigente.
    if (boleta.consumidaEnS !== null) {
      if (ahoraS - boleta.consumidaEnS < 3) {
        return resultado(Decision.RECHAZADO, Motivo.USO_CONCURRENTE, evidencia, { concurrente: true });
      }
      if (!evento.politicas.reingresoPermitido) {
        return resultado(Decision.RECHAZADO, Motivo.USO_YA_REGISTRADO, evidencia);
      }
      if (evento.politicas.reingresoSuspendido) {
        return resultado(Decision.RECHAZADO, Motivo.REINGRESO_SUSPENDIDO, evidencia);
      }
      if (ahoraS - boleta.ultimoUsoS < Umbral.REINGRESO_MIN_S) {
        return resultado(Decision.RECHAZADO, Motivo.USO_YA_REGISTRADO, evidencia);
      }
      return resultado(Decision.ACEPTADO, Motivo.REINGRESO_AUTORIZADO, evidencia, { proposito: 'reingreso' });
    }

    // Regla 4: la primera aceptación correcta genera la admisión.
    // Si la anulación ya existía en la boletería pero no había llegado,
    // la decisión se emite con la información disponible y se marca
    // para conciliar: es la limitación admitida, no un defecto a tapar.
    return resultado(Decision.ACEPTADO, Motivo.PERMISO_VIGENTE, evidencia, {
      proposito: 'ingreso',
      generaAdmision: true,
      anulacionEnTransito: boleta.anulacion !== null && !anulacionConocida(boleta, ahoraS)
    });
  }

  function anulacionConocida(boleta, ahoraS) {
    return boleta.anulacion !== null &&
      boleta.anulacion.recibidaEnS !== null &&
      boleta.anulacion.recibidaEnS <= ahoraS;
  }

  function resultado(decision, motivo, evidencia, extra) {
    var r = {
      decision: decision, motivo: motivo, evidencia: evidencia,
      proposito: null, generaAdmision: false, concurrente: false, anulacionEnTransito: false
    };
    if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
    return r;
  }

  /** Aplica el consumo atómico sobre la boleta (misma transacción). */
  function consumir(boleta, fallo, ahoraS, puntoId) {
    if (!boleta || fallo.decision !== Decision.ACEPTADO) return;
    if (fallo.generaAdmision) {
      boleta.consumidaEnS = ahoraS;
      boleta.consumidaEnPunto = puntoId;
    }
    boleta.ultimoUsoS = ahoraS;
  }

  // ==========================================================
  //  presentación de estados (traducción al lenguaje visible)
  // ==========================================================

  var ESTADO_PUNTO = {
    'en-linea':         { texto: 'En línea',          tono: 'ok' },
    'sin-comunicacion': { texto: 'Sin comunicación',  tono: 'warn' },
    'averiado':         { texto: 'Lector averiado',   tono: 'no' },
    'en-pausa':         { texto: 'En pausa',          tono: 'violet' },
    'sin-abrir':        { texto: 'Sin abrir',         tono: 'mute' }
  };

  var DECISION = {
    'aceptado':      { texto: 'Aceptado',      tono: 'ok',   icono: 'circle-check' },
    'rechazado':     { texto: 'Rechazado',     tono: 'no',   icono: 'circle-x' },
    'sin-respuesta': { texto: 'Sin respuesta', tono: 'warn', icono: 'circle-pause' }
  };

  /**
   * Estado visible de un punto. KR1.2 obliga a mostrar «sin
   * comunicación» a los 60 s como máximo desde el último reporte.
   */
  function estadoVisible(punto, evento, coordinador, ahoraS) {
    if (evento.estado === 'preparacion') return EstadoPunto.SIN_ABRIR;
    if (punto.estado === EstadoPunto.AVERIADO) return EstadoPunto.AVERIADO;
    if (coordinador.estado !== EstadoCoordinador.OPERANDO) return EstadoPunto.EN_PAUSA;
    if (punto.estado === EstadoPunto.SIN_COMUNICACION &&
        ahoraS - punto.ultimaComunicacionS >= Umbral.DETECCION_S) return EstadoPunto.SIN_COMUNICACION;
    return EstadoPunto.EN_LINEA;
  }

  return {
    Decision: Decision,
    Motivo: Motivo,
    EstadoPunto: EstadoPunto,
    EstadoCoordinador: EstadoCoordinador,
    TipoIncidente: TipoIncidente,
    VERSION_TAXONOMIA: VERSION_TAXONOMIA,
    Prioridad: Prioridad,
    Rol: Rol,
    Umbral: Umbral,
    Tarifa: Tarifa,
    decidir: decidir,
    consumir: consumir,
    anulacionConocida: anulacionConocida,
    estadoVisible: estadoVisible,
    ESTADO_PUNTO: ESTADO_PUNTO,
    DECISION: DECISION
  };
})();

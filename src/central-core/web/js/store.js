/* ============================================================
   store.js — estado central observable

   Una sola fuente de verdad. Las vistas se suscriben y reciben el
   estado; ninguna guarda datos propios. Solo `api.js` (capa de
   aplicación real: REST + SSE contra C4) lo modifica.
   ============================================================ */

NEXO.store = (function () {
  'use strict';

  var suscriptores = [];
  var oyentesAviso = [];
  var estado = null;

  /**
   * Vacía el store antes de la hidratación real. Todos los datos de
   * evento/coordinador/puntos/etc. llegan por `api.js` (REST al
   * arrancar, SSE después); aquí solo se define la forma inicial.
   */
  function inicializar() {
    estado = {
      rol: null,                        // lo fija la sesión (ADR-016); null antes del login
      operador: null,

      evento: null,
      coordinador: null,
      puntos: [],
      puntosPorId: {},

      ahoraS: 0,
      cargando: true,

      // Estado de la conexión con C4 (SER-05: antigüedad de los datos).
      conexion: { sse: false, ultimoExitoMs: null },

      // Enlace del estadio con la nube (ADR-011: buzón transaccional)
      nube: { enLinea: true, caidaDesdeS: null, buzon: 0, enviados: 0 },
      // Integración con la boletería (ADR-010: cambios versionados)
      integracion: { enLinea: true, enTransito: [] },

      intentos: [],                     // los más recientes primero (acotado)
      conteo: {
        intentos: 0, decisiones: 0, aceptados: 0, admisiones: 0, reingresos: 0,
        rechazados: 0, desconocidos: 0, zonaIncorrecta: 0, anuladas: 0,
        concurrentes: 0, usoRegistrado: 0, sinRespuesta: 0, camposCompletos: 0
      },
      admisionesPorZona: {},

      serie: [],                        // [{minuto, decisiones}] últimos 40 minutos
      metricas: {
        dps: 0, p95Ms: 0,
        solicitudes: 0, enPlazo: 0,              // CA2 · denominador completo
        visiblesTotal: 0, visiblesEnPlazo: 0,    // KR1.1
        duranteCorte: 0,                          // informadas aparte
        sincronizaciones: []                      // KR2.1
      },

      incidentes: [],
      acciones: [],
      actividad: [],                    // bitácora general visible en el inicio

      lector: { puntoId: 'P-07', ultima: null, ultimaBoleta: null, historial: [], manuales: [] },

      preparacion: { confirmada: false, controles: [] },

      conciliacion: {
        estado: 'sin-iniciar',          // sin-iniciar | en-curso | preliminar | conciliado
        preliminarEnS: null,
        definitivoEnS: null,
        diferencias: [],
        condiciones: [],
        saldoCobrado: false
      }
    };
    return estado;
  }

  function get() { return estado; }

  function suscribir(fn) {
    suscriptores.push(fn);
    return function () {
      var i = suscriptores.indexOf(fn);
      if (i !== -1) suscriptores.splice(i, 1);
    };
  }

  function notificar() {
    for (var i = 0; i < suscriptores.length; i++) {
      try { suscriptores[i](estado); }
      catch (e) { console.error('Error en un suscriptor del store:', e); }
    }
  }

  /** Avisos puntuales para la interfaz (notificaciones emergentes). */
  function alAvisar(fn) { oyentesAviso.push(fn); }
  function avisar(aviso) {
    oyentesAviso.forEach(function (fn) {
      try { fn(aviso); } catch (e) { console.error(e); }
    });
  }

  function reiniciar() { inicializar(); notificar(); }

  return {
    inicializar: inicializar, get: get, suscribir: suscribir,
    notificar: notificar, reiniciar: reiniciar,
    alAvisar: alAvisar, avisar: avisar
  };
})();

/* ============================================================
   store.js — estado central observable

   Una sola fuente de verdad. Las vistas se suscriben y reciben el
   estado; ninguna guarda datos propios. Solo el simulador (que hace
   de capa de aplicación mientras no exista el backend) lo modifica.
   ============================================================ */

NEXO.store = (function () {
  'use strict';

  var suscriptores = [];
  var oyentesAviso = [];
  var estado = null;

  function inicializar() {
    var datos = NEXO.datos, d = NEXO.dominio;
    var puntos = datos.crearPuntos();
    var rnd = NEXO.util.prng(20260916);

    estado = {
      evento: datos.crearEvento(),
      coordinador: datos.crearCoordinador(),
      puntos: puntos,
      puntosPorId: puntos.reduce(function (m, p) { m[p.id] = p; return m; }, {}),
      boletas: datos.crearBoletas(rnd),
      rnd: rnd,

      ahoraS: datos.INICIO_S,
      corriendo: false,
      velocidad: 30,                    // segundos de evento por segundo real
      rol: d.Rol.SUPERVISOR,

      // Enlace del estadio con la nube (ADR-011: buzón transaccional)
      nube: { enLinea: true, caidaDesdeS: null, buzon: 0, enviados: 0 },
      // Integración con la boletería (ADR-010: cambios versionados)
      integracion: { enLinea: true, enTransito: [] },

      intentos: [],                     // los más recientes primero (acotado)
      totalIntentos: 0,
      conteo: {
        intentos: 0, decisiones: 0, aceptados: 0, admisiones: 0, reingresos: 0,
        rechazados: 0, desconocidos: 0, zonaIncorrecta: 0, anuladas: 0,
        concurrentes: 0, usoRegistrado: 0, sinRespuesta: 0, camposCompletos: 0
      },
      admisionesPorZona: datos.ZONAS.reduce(function (m, z) { m[z.nombre] = 0; return m; }, {}),

      serie: [],                        // [{minuto, decisiones}] últimos 40 minutos
      metricas: {
        dps: 0, p95Ms: 0, muestra: [],
        solicitudes: 0, enPlazo: 0,              // CA2 · denominador completo
        visiblesTotal: 0, visiblesEnPlazo: 0,    // KR1.1
        duranteCorte: 0,                          // informadas aparte
        sincronizaciones: []                      // KR2.1
      },

      incidentes: [], secInc: 0,
      acciones: [], secAcc: 0,
      actividad: [],                    // bitácora general visible en el inicio
      episodios: {},                    // intentos en diario agrupados por causa

      lector: { puntoId: 'P-07', ultima: null, ultimaBoleta: null, historial: [], manuales: [] },

      preparacion: {
        confirmada: false,
        controles: [
          { id: 'permisos', titulo: 'Boletas y reglas verificadas', ok: true,
            detalle: 'Instantánea inicial de 16.240 permisos y cambios hasta la versión 37 instalados en el coordinador. Casos de prueba de reglas: 48 de 48 correctos.' },
          { id: 'contingencia', titulo: 'Conectividad y contingencia acordadas', ok: true,
            detalle: 'Sin coordinador no se autoriza en ninguna puerta. Si los permisos superan 5 minutos de antigüedad se suspenden los reingresos. Responsables asignados por rol.' },
          { id: 'reemplazo', titulo: 'Puntos y repuestos probados', ok: false,
            detalle: '20 puntos con lector compatible y credencial individual. Falta confirmar los dos lectores de repuesto (LX-2210-0447 y LX-2210-0452).' },
          { id: 'integridad', titulo: 'Integridad comprobada', ok: true,
            detalle: 'Copias simultáneas de una boleta: una sola aceptación. Promoción del coordinador ensayada: pausa de 46 s y ningún consumo perdido.' },
          { id: 'privacidad', titulo: 'Seguimiento exclusivo a la boleta', ok: true,
            detalle: 'La integración descarta nombres, documentos, contactos, pagos y biometría antes de guardar nada, también en diarios y respaldos.' },
          { id: 'adicionales', titulo: 'Adicionales aceptados por el cliente', ok: false,
            detalle: 'Alquiler de 6 lectores y soporte remoto. La presencia en sitio no está contratada y se cotiza aparte.' }
        ]
      },

      conciliacion: {
        estado: 'sin-iniciar',          // sin-iniciar | en-curso | preliminar | conciliado
        preliminarEnS: null,
        definitivoEnS: null,
        diferencias: [],
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

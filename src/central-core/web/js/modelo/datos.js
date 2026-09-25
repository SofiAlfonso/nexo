/* ============================================================
   modelo/datos.js — datos semilla del piloto

   Cliente, contrato, recinto, boletería, los tres eventos del
   piloto (dos pagados y uno gratuito) y la configuración del evento
   en curso: cinco zonas y veinte puntos, los límites del taller.
   Todo es ficticio y reproducible (semilla fija).
   ============================================================ */

NEXO.datos = (function () {
  'use strict';

  var d = NEXO.dominio;

  var APERTURA_S = 17 * 3600;             // 17:00
  var CIERRE_S = 20 * 3600 + 15 * 60;      // 20:15
  var INICIO_S = APERTURA_S - 40 * 60;     // la demo arranca a las 16:20

  var CLIENTE = { id: 'CLI-001', razonSocial: 'Club Deportivo Cordillera (ficticio)' };

  var RECINTO = { id: 'REC-01', nombre: 'Estadio Cordillera', capacidad: 20000 };

  var BOLETERIA = {
    id: 'BOL-01', nombre: 'TaquillaAndina',
    adaptador: 'Adaptador TaquillaAndina v2.3',       // ADR-007: uno por boletería
    modeloCanonico: 'Modelo canónico de permisos v1'
  };

  /** El contrato conserva el acuerdo comercial y la tarifa. */
  var CONTRATO = {
    id: 'CT-2026-014',
    fechaAcuerdo: '20 ago. 2026',
    origen: 'Acuerdo nuevo · piloto de tres eventos',
    tarifa: 'USD 500 por evento + USD 0,40 por admisión',
    eventos: [
      {
        id: 'EVT-2026-01', nombre: 'Fecha 12 · Cordillera vs. Andes FC', fecha: '30 ago. 2026',
        modalidad: 'Pagado', estado: 'Liquidado',
        admisiones: 14212, anticipo: 3500, cobrado: 6184.80, costos: 318
      },
      {
        id: 'EVT-2026-02', nombre: 'Fecha 14 · Cordillera vs. Real Pacífico', fecha: 'Hoy · 16 sep. 2026',
        modalidad: 'Pagado', estado: 'En curso', actual: true
      },
      {
        id: 'EVT-2026-03', nombre: 'Fecha 16 · Cordillera vs. Unión Norte', fecha: '4 oct. 2026',
        modalidad: 'Gratuito', estado: 'Programado', costosTope: 600
      }
    ],
    recompra: 'Ventana de 60 días abierta desde el 30 ago. 2026 (KR5.2)'
  };

  var ZONAS = [
    { nombre: 'Norte',      boletas: 4980, estimadas: 4600, color: 'z1' },
    { nombre: 'Sur',        boletas: 3360, estimadas: 3100, color: 'z2' },
    { nombre: 'Oriental',   boletas: 4010, estimadas: 3700, color: 'z3' },
    { nombre: 'Occidental', boletas: 3360, estimadas: 3100, color: 'z4' },
    { nombre: 'Palcos',     boletas: 530,  estimadas: 500,  color: 'z5' }
  ];

  var REPARTO = [
    { zona: 'Norte', desde: 1, hasta: 5 },
    { zona: 'Sur', desde: 6, hasta: 9 },
    { zona: 'Oriental', desde: 10, hasta: 14 },
    { zona: 'Occidental', desde: 15, hasta: 18 },
    { zona: 'Palcos', desde: 19, hasta: 20 }
  ];

  function tramoDe(i) {
    for (var k = 0; k < REPARTO.length; k++) {
      if (i >= REPARTO[k].desde && i <= REPARTO[k].hasta) return REPARTO[k];
    }
    return REPARTO[0];
  }

  function crearEvento() {
    return {
      id: 'EVT-2026-02',
      nombre: 'Fecha 14 · Cordillera vs. Real Pacífico',
      nombreCorto: 'Fecha 14',
      recinto: RECINTO.nombre,
      boleteria: BOLETERIA.nombre,
      aperturaS: APERTURA_S,
      cierreS: CIERRE_S,
      admisionesEstimadas: 15000,
      gratuito: false,
      estado: 'preparacion',            // preparacion | abierto | cerrado
      versionPermisos: 37,               // cambios versionados recibidos (ADR-010)
      ultimoCambioRecibidoS: INICIO_S,
      politicas: {
        version: 2,
        reingresoPermitido: true,
        reingresoTrasMin: 10,
        reingresoSuspendido: false
      }
    };
  }

  /** ADR-005: candidata B del PoC, primario y réplica síncrona. */
  function crearCoordinador() {
    return {
      topologia: 'B · primario con réplica síncrona y promoción manual',
      primario: 'COORD-A',
      replica: 'COORD-B',
      repuesto: 'COORD-C',
      excluidos: [],
      estado: d.EstadoCoordinador.OPERANDO,
      desdeS: INICIO_S,
      pausas: []                        // [{desdeS, hastaS}] medidas por ADR-013
    };
  }

  function crearPuntos() {
    var puntos = [];
    for (var i = 1; i <= 20; i++) {
      var t = tramoDe(i);
      var zonas = [t.zona];
      if (i === 1 || i === 7) zonas.push('Palcos');   // algunas puertas validan hacia dos zonas
      var id = 'P-' + (i < 10 ? '0' + i : i);
      puntos.push({
        id: id,
        nombre: 'Puerta ' + t.zona + ' ' + (i - t.desde + 1),
        zona: t.zona,
        zonas: zonas,
        estado: d.EstadoPunto.EN_LINEA,
        ultimaComunicacionS: INICIO_S,
        pendientesDiario: 0,            // intentos sin decisión confirmada (ADR-011)
        diarioTotal: 0,
        sincronizandoDesdeS: null,
        decisionesMinuto: 0, decisionesMinutoActual: 0,
        serie: [],                      // decisiones por minuto, últimos 30 min
        latencias: [],
        recientes: [],
        averiadoDesdeS: null,
        preparacion: { lector: true, credencial: true, zonas: true, version: true, prueba: true },
        lectores: [{
          id: 'LX-2210-' + String(100 + i * 7).padStart(4, '0'),
          familia: 'Zebra TC21',
          procedencia: i <= 14 ? 'Cliente' : 'Alquiler',
          credencial: 'CRED-' + id + '-A',   // ADR-008: credencial individual por punto y período
          desdeS: INICIO_S - 3600,
          hastaS: null
        }],
        actividad: [{ t: INICIO_S - 3600, tipo: 'sistema', texto: 'Lector registrado con credencial individual (alcance: evento y punto).' },
                    { t: INICIO_S - 1800, tipo: 'sistema', texto: 'Permisos v37 y políticas v2 instalados en el coordinador.' }]
      });
    }
    return puntos;
  }

  /**
   * 16.240 permisos para 15.000 admisiones estimadas: no todo el que
   * compra entra. Las referencias son técnicas: no identifican a nadie.
   */
  function crearBoletas(rnd) {
    var porZona = {}, orden = [], indice = {}, n = 0;
    ZONAS.forEach(function (z) {
      porZona[z.nombre] = [];
      for (var i = 0; i < z.boletas; i++) {
        var ref = 'TA-' + (8800 + Math.floor(n / 1000)) + '-' + String(n % 1000).padStart(4, '0');
        var b = {
          ref: ref, zona: z.nombre,
          consumidaEnS: null, consumidaEnPunto: null, ultimoUsoS: null,
          anulacion: null,              // {emitidaEnS, recibidaEnS}
          excluida: false
        };
        porZona[z.nombre].push(b); orden.push(b); indice[ref] = b; n++;
      }
    });

    // Hasta un 0,5 % será anulado por la boletería durante el evento.
    return {
      porZona: porZona, orden: orden, total: n,
      anuladas: [], maxAnuladas: Math.round(n * 0.005),
      buscar: function (ref) { return indice[ref] || null; }
    };
  }

  return {
    APERTURA_S: APERTURA_S, CIERRE_S: CIERRE_S, INICIO_S: INICIO_S,
    CLIENTE: CLIENTE, RECINTO: RECINTO, BOLETERIA: BOLETERIA, CONTRATO: CONTRATO,
    ZONAS: ZONAS,
    crearEvento: crearEvento, crearCoordinador: crearCoordinador,
    crearPuntos: crearPuntos, crearBoletas: crearBoletas
  };
})();

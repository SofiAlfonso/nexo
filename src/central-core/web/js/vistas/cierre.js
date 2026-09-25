/* ============================================================
   vistas/cierre.js — Cierre conciliado y liquidación

   Convierte decisiones en dinero e impide hacerlo mal: solo se
   declara conciliado con cobertura completa y todas las diferencias
   resueltas (regla 7). Las resoluciones se agregan; el registro
   original nunca se borra (ADR-004).
   ============================================================ */

NEXO.vistas.cierre = (function () {
  'use strict';

  var u = NEXO.util, esc = u.esc, ico = u.icono, fmt = u.fmt;
  var d = NEXO.dominio, S = function () { return NEXO.simulador; };
  var c;

  function montar(cont) {
    c = NEXO.vistas.comunes;
    var raiz = document.createElement('div');
    raiz.className = 'page';
    raiz.innerHTML =
      c.cabecera({
        kicker: 'Después del evento', icono: 'file-check-2',
        titulo: 'Cierre y liquidación',
        texto: 'Del registro de cada decisión al importe que se cobra. Solo se declara conciliado con cobertura completa y todas las diferencias resueltas.',
        acciones: '<span data-slot="acc"></span>'
      }) +
      '<section class="card stepper" data-slot="pasos"></section>' +
      '<div data-slot="aviso"></div>' +
      '<div class="grid grid--main-side" style="margin-top:16px">' +
        '<div class="stack">' +
          '<section class="card"><div class="card__head"><h2>Diferencias</h2>' +
            c.tip('Casos en los que la evidencia no cuadra sola. Cada uno se resuelve con una decisión documentada; resolver no borra el registro original.', 'Regla 7 · KR4.3') +
            '<span class="spacer"></span><span data-slot="difAcc"></span></div>' +
            '<div class="card__body" data-slot="difs"></div></section>' +
          '<div class="grid grid--2">' +
            '<section class="card"><div class="card__head"><h2>Cobertura del cierre</h2>' +
              c.tip('Antes de conciliar, todo lo que ocurrió en las puertas tiene que haber llegado. Un registro perdido incumple, sin tolerancia.', 'KR4.2 · 99,9 % de campos completos') +
              '</div><div class="card__body lines" data-slot="cobertura"></div></section>' +
            '<section class="card"><div class="card__head"><h2>Conteo de decisiones</h2>' +
              c.tip('Lo que se concilia son decisiones únicas. Una misma boleta puede ser rechazada y luego admitida, así que <b>no se suman</b> boletas, rechazos y admisiones.', 'Regla 4 · reglas de contabilidad') +
              '</div><div class="card__body" data-slot="conteo"></div></section>' +
          '</div>' +
        '</div>' +
        '<aside class="stack">' +
          '<section class="card"><div class="card__head"><h2>Para declarar conciliado</h2></div><div class="card__body" data-slot="condiciones"></div></section>' +
          '<section class="card invoice"><div class="card__head"><h2>Liquidación del evento</h2><span class="spacer"></span><span data-slot="liqBadge"></span></div>' +
            '<div class="card__body" data-slot="liquidacion"></div></section>' +
          '<section class="card"><div class="card__head"><h2>Contrato</h2>' +
            c.tip('El contrato conserva el acuerdo y la tarifa; cada evento tiene su propia liquidación. Ejecutar un evento ya incluido no demuestra recompra.', 'KR5.1 · KR5.2') +
            '</div><div class="card__body" data-slot="contrato"></div></section>' +
        '</aside>' +
      '</div>';
    cont.appendChild(raiz);
    var s = u.ranuras(raiz);

    c.delegar(raiz, {
      adelantar: function () { S().saltarA(NEXO.datos.CIERRE_S + 90); },
      preliminar: function () { S().entregarPreliminar(); },
      conciliar: function () { S().declararConciliado(); },
      resolver: function (arg) { var p = arg.split('|'); S().resolverDiferencia(p[0], p[1]); },
      todas: function () { S().resolverTodas(); },
      cobrar: function () { S().registrarCobro(); }
    });

    return {
      actualizar: function (e) {
        var cerrado = e.evento.estado === 'cerrado';
        u.ranura(s.acc, cerrado ? '' : '<button type="button" class="btn btn--primary" data-accion="adelantar">' + ico('fast-forward', 16) + 'Adelantar la demo al cierre</button>');
        u.ranura(s.pasos, pasos(e));
        u.ranura(s.aviso, aviso(e));
        var abiertas = e.conciliacion.diferencias.filter(function (x) { return x.estado === 'abierta'; }).length;
        u.ranura(s.difAcc, abiertas > 1 ? '<button type="button" class="btn btn--sm" data-accion="todas">' + ico('list-checks', 14) + 'Resolver ' + abiertas + ' con la opción sugerida</button>' : '');
        u.ranura(s.difs, diferencias(e));
        u.ranura(s.cobertura, cobertura(e));
        u.ranura(s.conteo, conteo(e));
        u.ranura(s.condiciones, condiciones(e));
        u.ranura(s.liqBadge, e.conciliacion.estado === 'conciliado' ? (e.conciliacion.saldoCobrado ? c.badge('Cobrado', 'ok') : c.badge('Definitiva', 'info')) : c.badge('Estimada', 'warn'));
        u.ranura(s.liquidacion, liquidacion(e));
        u.ranura(s.contrato, contrato(e));
      },
      desmontar: function () {}
    };
  }

  // ---------- recorrido ----------

  function pasos(e) {
    var cn = e.conciliacion, ev = e.evento;
    var cond = S().condicionesCierre(e);
    var ok = function (id) { return cond.filter(function (x) { return x.id === id; })[0].ok; };
    var registros = ok('diarios') && ok('buzon') && ok('cambios');
    var abiertas = cn.diferencias.filter(function (x) { return x.estado === 'abierta'; }).length;
    var lista = [
      { t: 'Ventana cerrada', s: ev.estado === 'cerrado' ? 'a las ' + fmt.hora(ev.cierreS) : 'cierra a las ' + fmt.hora(ev.cierreS), ok: ev.estado === 'cerrado' },
      { t: 'Registros completos', s: registros ? 'diarios, buzón y cambios al día' : 'falta sincronizar', ok: ev.estado === 'cerrado' && registros },
      { t: 'Informe preliminar', s: cn.preliminarEnS !== null ? 'entregado a los ' + fmt.duracion(cn.preliminarEnS - ev.cierreS) : 'máximo 30 min', ok: cn.preliminarEnS !== null },
      { t: 'Diferencias resueltas', s: cn.diferencias.length ? (abiertas ? abiertas + ' abiertas' : 'todas resueltas') : 'ninguna detectada', ok: ev.estado === 'cerrado' && abiertas === 0 },
      { t: 'Conciliado', s: cn.definitivoEnS !== null ? 'a los ' + fmt.duracion(cn.definitivoEnS - ev.cierreS) : 'máximo 24 h', ok: cn.estado === 'conciliado' },
      { t: 'Saldo cobrado', s: cn.saldoCobrado ? 'registrado' : 'hasta 30 días después', ok: cn.saldoCobrado }
    ];
    var actual = lista.findIndex(function (x) { return !x.ok; });
    return lista.map(function (x, i) {
      var st = x.ok ? 'done' : i === actual ? 'now' : 'todo';
      return '<div class="stp stp--' + st + '"><span class="stp__dot">' + (x.ok ? ico('check', 14) : i + 1) + '</span>' +
        '<div><b>' + esc(x.t) + '</b><small>' + esc(x.s) + '</small></div></div>';
    }).join('<span class="stp__line"></span>');
  }

  function aviso(e) {
    var cn = e.conciliacion;
    if (e.evento.estado !== 'cerrado') {
      return '<div class="notice" style="margin-top:16px">' + ico('info', 18) + '<div><b>El ingreso sigue ' + (e.evento.estado === 'abierto' ? 'abierto' : 'sin empezar') + '.</b> El cierre arranca a las ' + fmt.hora(e.evento.cierreS) +
        '. Las diferencias que se detecten durante el evento ya aparecen aquí; la liquidación es una estimación con el uso registrado hasta ahora.</div></div>';
    }
    if (cn.estado === 'conciliado') {
      return '<div class="notice notice--ok" style="margin-top:16px">' + ico('circle-check', 18) + '<div><b>Cierre definitivo conciliado ' + fmt.duracion(cn.definitivoEnS - e.evento.cierreS) + ' después de la ventana.</b> La evidencia queda archivada 90 días sin cambios.</div></div>';
    }
    return '';
  }

  // ---------- diferencias ----------

  function diferencias(e) {
    var lista = e.conciliacion.diferencias.slice().sort(function (a, b) {
      return (a.estado === 'abierta' ? 0 : 1) - (b.estado === 'abierta' ? 0 : 1);
    });
    if (!lista.length) {
      return c.vacio('scale', 'Sin diferencias por ahora', 'Aparecen cuando un intento queda sin decisión confirmada o cuando una anulación llega después de una aceptación.');
    }
    return '<div class="difs">' + lista.map(function (x) {
      var abierta = x.estado === 'abierta';
      var icono = x.tipo === 'anulacion' ? 'ban' : 'history';
      return '<article class="dif' + (abierta ? '' : ' dif--done') + '">' +
        '<span class="bubble bubble--' + (abierta ? (x.tipo === 'anulacion' ? 'no' : 'warn') : 'ok') + '">' + ico(abierta ? icono : 'check', 18) + '</span>' +
        '<div class="dif__body"><div class="row row--wrap"><b>' + esc(x.titulo) + '</b><span class="idchip">' + x.id + '</span>' +
          (abierta ? c.badge('Abierta', 'warn') : c.badge('Resuelta', 'ok')) + '</div>' +
          '<small class="dim">' + esc(x.origen) + ' · detectada a las ' + fmt.hora(x.detectadaEnS, true) + '</small>' +
          '<p>' + esc(x.detalle) + '</p>' +
          (abierta
            ? '<div class="dif__opts">' + x.opciones.map(function (o, i) {
                return '<button type="button" class="btn btn--sm' + (i === 0 ? ' btn--primary' : '') + '" data-accion="resolver" data-arg="' + x.id + '|' + o.id + '" title="' + esc(o.nota) + '">' + esc(o.texto) + '</button>';
              }).join('') + '<span class="dim" style="font-size:12px">' + esc(x.opciones[0].nota) + '</span></div>'
            : '<div class="dif__res">' + ico('lock', 12) + 'Resolución agregada: <b>' + esc(x.resolucion) + '</b> · ' + esc(x.resueltaPor) + ' · ' + fmt.hora(x.resueltaEnS, true) + '</div>') +
        '</div></article>';
    }).join('') + '</div>';
  }

  // ---------- cobertura y conteo ----------

  function cobertura(e) {
    var pend = e.puntos.reduce(function (s, p) { return s + p.pendientesDiario; }, 0);
    var completos = e.puntos.filter(function (p) { return p.pendientesDiario === 0; }).length;
    var campos = e.conteo.decisiones ? e.conteo.camposCompletos / e.conteo.decisiones * 100 : 100;
    return linea('Puertas que entregaron todo', completos + ' / 20', completos === 20) +
      linea('Intentos en diarios de lectores', fmt.entero(pend), pend === 0) +
      linea('Decisiones en el buzón hacia la nube', fmt.entero(e.nube.buzon), e.nube.buzon === 0) +
      linea('Cambios de la boletería en camino', fmt.entero(e.integracion.enTransito.length), e.integracion.enTransito.length === 0) +
      linea('Campos completos', fmt.pct(campos, 2), campos >= d.Umbral.TRAZABILIDAD_MIN_PCT, 'meta 99,9 %') +
      linea('Registros perdidos', '0', true, 'tolerancia cero');
  }

  function linea(t, v, ok, nota) {
    return '<div><span>' + esc(t) + (nota ? '<small>' + esc(nota) + '</small>' : '') + '</span><b>' + v + '</b>' + ico(ok ? 'circle-check' : 'circle-dashed', 16, ok ? 'ok-t' : 'warn-t') + '</div>';
  }

  function conteo(e) {
    var k = e.conteo, tot = k.intentos || 1;
    var partes = [
      { t: 'Admisiones', v: k.admisiones, col: 'var(--ok)' },
      { t: 'Reingresos', v: k.reingresos, col: 'var(--info)' },
      { t: 'Rechazos', v: k.rechazados, col: 'var(--no)' },
      { t: 'Sin respuesta', v: k.sinRespuesta, col: 'var(--warn)' }
    ];
    return '<div class="stackbar">' + partes.map(function (p) {
        return '<span style="width:' + (p.v / tot * 100).toFixed(2) + '%;background:' + p.col + '" title="' + esc(p.t) + '"></span>';
      }).join('') + '</div>' +
      '<div class="lines" style="margin-top:10px">' +
      '<div><span>Intentos recibidos</span><b>' + fmt.entero(k.intentos) + '</b></div>' +
      partes.map(function (p) {
        return '<div><span><i class="zdot" style="background:' + p.col + '"></i>' + esc(p.t) + '</span><b>' + fmt.entero(p.v) + '</b></div>';
      }).join('') +
      '<div><span>de los rechazos: otra zona · anuladas · desconocidos · uso repetido</span><b class="nowrap">' +
        [k.zonaIncorrecta, k.anuladas, k.desconocidos, k.usoRegistrado + k.concurrentes].map(fmt.entero).join(' · ') + '</b></div>' +
      '</div><p class="dim" style="font-size:12px;margin-top:8px">La boletería habilitó ' + fmt.entero(e.boletas.total) +
      ' boletas. Esa cifra no se suma con las de arriba ni indica cuántas personas entraron.</p>';
  }

  // ---------- condiciones, liquidación y contrato ----------

  function condiciones(e) {
    var cn = e.conciliacion, ev = e.evento;
    var cond = S().condicionesCierre(e);
    var html = '<ul class="conds">' + cond.map(function (x) {
      return '<li class="' + (x.ok ? 'ok' : '') + '">' + ico(x.ok ? 'circle-check' : 'circle-dashed', 18) + '<span>' + esc(x.texto) + (x.nota ? '<small>' + esc(x.nota) + '</small>' : '') + '</span></li>';
    }).join('') + '</ul>';
    if (ev.estado === 'cerrado' && cn.estado !== 'conciliado') {
      var rp = ev.cierreS + d.Umbral.PRELIMINAR_S - e.ahoraS;
      var rd = ev.cierreS + d.Umbral.DEFINITIVO_S - e.ahoraS;
      html += '<div class="deadlines">' +
        (cn.preliminarEnS === null ? '<div><span>Preliminar</span><b class="' + (rp < 300 ? 'no-t' : '') + '">' + fmt.plazo(rp) + '</b></div>' : '') +
        '<div><span>Definitivo</span><b>' + fmt.plazo(rd) + '</b></div></div>';
    }
    if (cn.estado === 'conciliado') {
      return html + '<div class="notice notice--ok" style="margin-top:14px">' + ico('shield-check', 18) + '<div><b>Conciliado a las ' + fmt.hora(cn.definitivoEnS, true) + '.</b> Preliminar a los ' +
        fmt.duracion(cn.preliminarEnS - ev.cierreS) + ' y definitivo a los ' + fmt.duracion(cn.definitivoEnS - ev.cierreS) + ' (metas: 30 min y 24 h).</div></div>';
    }
    html += '<div class="stack" style="margin-top:14px">' +
      '<button type="button" class="btn btn--block" data-accion="preliminar"' + (cn.estado === 'en-curso' ? '' : ' disabled') + '>' + ico('send', 16) + 'Entregar informe preliminar</button>' +
      '<button type="button" class="btn btn--primary btn--block btn--lg" data-accion="conciliar"' + (S().puedeConciliar(e) ? '' : ' disabled') + '>' + ico('shield-check', 18) + 'Declarar conciliado</button>' +
      '</div>';
    if (ev.estado === 'cerrado' && !S().puedeConciliar(e) && cn.estado !== 'conciliado') {
      html += '<p class="dim" style="font-size:12px;margin-top:8px">El botón se habilita cuando todas las condiciones se cumplen. Emitir una excepción no convierte un incumplimiento en éxito.</p>';
    }
    return html;
  }

  function liquidacion(e) {
    var L = S().liquidacion(e);
    var cn = e.conciliacion;
    var conciliado = cn.estado === 'conciliado';
    var saldoTxt = L.saldo >= 0 ? 'Saldo por cobrar' : 'Devolución al cliente';
    var vence = new Date(2026, 8, 16 + d.Umbral.COBRO_SALDO_DIAS);
    var html = '<div class="lines">' +
      '<div><span>Cargo por evento</span><b>' + fmt.usd(L.cargoEvento) + '</b></div>' +
      '<div><span>Admisiones facturables<small>' + fmt.entero(L.facturables) + ' × USD 0,40' + (L.excluidas ? ' · ' + L.excluidas + ' excluidas en el cierre' : '') + '</small></span><b>' + fmt.usd(L.cargoAdmisiones) + '</b></div>' +
      '<div><span>Importe del servicio</span><b>' + fmt.usd(L.importe) + '</b></div>' +
      '<div><span>Anticipo cobrado<small>USD 500 + 50 % de 15.000 estimadas</small></span><b>−' + fmt.usd(L.anticipo).replace('USD ', 'USD ') + '</b></div>' +
      '<div class="lines__total"><span>' + saldoTxt + '</span><b>' + fmt.usd(Math.abs(L.saldo)) + '</b></div></div>' +
      '<p class="dim" style="font-size:12px;margin:8px 0 14px">' + (conciliado ? 'Se cobra hasta el ' + fmt.fecha(vence) + ' (30 días después de conciliar).' : 'Estimado con el uso registrado hasta ahora. Se confirma al conciliar.') + '</p>';
    html += '<div class="contrib"><div><span>Costos del evento</span><b>' + fmt.usd(L.costos) + '</b><small>trabajo ' + fmt.usd(L.trabajo) + (L.escalacion ? ' + escalación ' + fmt.usd(L.escalacion) : '') + '</small></div>' +
      '<div><span>Contribución</span><b>' + fmt.usd(L.contribucion) + '</b><small>margen ' + fmt.pct(L.margen) + ' · meta ≥ 55 %</small></div></div>' +
      '<p class="dim" style="font-size:11.5px;margin-top:8px">La contribución no es utilidad: los costos fijos (USD 9.050 al mes) van aparte. Tope de trabajo por evento: USD 345 (CA4).</p>';
    if (conciliado && !cn.saldoCobrado) {
      html += '<button type="button" class="btn btn--ok btn--block" style="margin-top:12px" data-accion="cobrar">' + ico('banknote', 16) + 'Registrar el cobro del saldo</button>';
    }
    return html;
  }

  function contrato(e) {
    var K = NEXO.datos.CONTRATO, C = NEXO.datos.CLIENTE;
    var L = S().liquidacion(e);
    return '<dl class="kv"><dt>Cliente</dt><dd>' + esc(C.razonSocial) + '</dd><dt>Contrato</dt><dd class="mono">' + K.id + '</dd>' +
      '<dt>Acordado</dt><dd>' + esc(K.fechaAcuerdo) + '</dd><dt>Origen</dt><dd>' + esc(K.origen) + '</dd></dl>' +
      '<div class="evlist">' + K.eventos.map(function (x) {
        var estado = x.actual ? (e.conciliacion.estado === 'conciliado' ? 'Conciliado' : e.evento.estado === 'cerrado' ? 'En cierre' : 'En curso') : x.estado;
        var tono = estado === 'Liquidado' || estado === 'Conciliado' ? 'ok' : estado === 'Programado' ? 'mute' : 'info';
        var monto = x.actual ? fmt.usd(L.importe) : x.modalidad === 'Gratuito' ? 'Sin tarifa · costos ≤ USD 600' : fmt.usd(x.cobrado);
        return '<div class="ev' + (x.actual ? ' ev--now' : '') + '"><div><b>' + esc(x.nombre) + '</b><small>' + esc(x.fecha) + ' · ' + esc(x.modalidad) + '</small></div>' +
          '<div class="right">' + c.badge(estado, tono, 'badge--sm') + '<small>' + esc(monto) + '</small></div></div>';
      }).join('') + '</div>' +
      '<p class="dim" style="font-size:12px;margin-top:10px">' + ico('repeat', 12) + ' Recompra: ' + esc(K.recompra) + '.</p>';
  }

  return { id: 'cierre', montar: montar };
})();

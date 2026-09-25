/* ============================================================
   vistas/punto.js — Puertas (lista y detalle)

   A la izquierda las 20 puertas; a la derecha la elegida. Un punto
   de validación es estable: cambiar su lector no cambia su identidad
   ni borra sus registros pendientes (regla 5, KR2.2).
   ============================================================ */

NEXO.vistas.punto = (function () {
  'use strict';

  var u = NEXO.util, esc = u.esc, ico = u.icono, fmt = u.fmt;
  var d = NEXO.dominio, EP = d.EstadoPunto;
  var c;
  var filtroZona = '';

  function montar(cont, params) {
    c = NEXO.vistas.comunes;
    var id = params.id || 'P-07';
    var raiz = document.createElement('div');
    raiz.className = 'page';
    raiz.innerHTML =
      c.cabecera({
        kicker: 'Operación en vivo', icono: 'door-open',
        titulo: 'Puertas',
        texto: 'Estado, lector asignado y actividad de cada punto de validación. Elige una puerta a la izquierda.'
      }) +
      '<div class="gsplit">' +
        '<aside class="card glist">' +
          '<div class="glist__head"><select class="select" data-campo="zona" aria-label="Filtrar por zona"><option value="">Todas las zonas</option>' +
            NEXO.datos.ZONAS.map(function (z) { return '<option' + (filtroZona === z.nombre ? ' selected' : '') + '>' + esc(z.nombre) + '</option>'; }).join('') +
          '</select></div>' +
          '<div class="glist__rows" data-slot="lista"></div>' +
        '</aside>' +
        '<div class="stack" style="min-width:0">' +
          '<section class="card gdet__head" data-slot="cabeza"></section>' +
          '<section class="grid grid--4" data-slot="cifras"></section>' +
          '<div class="grid grid--2">' +
            '<section class="card"><div class="card__head"><h2>Actividad de la puerta</h2></div><div class="card__body"><div class="feed" data-slot="actividad"></div></div></section>' +
            '<section class="card"><div class="card__head"><h2>Lector asignado</h2>' +
              c.tip('Cada lector tiene una credencial individual limitada a este evento, este punto y este período. Las respuestas quedan vinculadas al intento para que no puedan reutilizarse.', 'ADR-008') +
              '</div><div class="card__body" data-slot="lector"></div></section>' +
          '</div>' +
          '<section class="card"><div class="card__head"><h2>Últimos intentos en esta puerta</h2>' +
            c.tip('Cada intento conserva su identificador de origen, la versión de permisos y políticas usada y la regla aplicada. Una retransmisión no crea otra decisión.', 'Regla 3 · KR4.2') +
            '</div><div class="card__body" style="padding-top:8px" data-slot="intentos"></div></section>' +
        '</div>' +
      '</div>';
    cont.appendChild(raiz);
    var s = u.ranuras(raiz);

    raiz.addEventListener('input', function (ev) {
      if (ev.target.getAttribute('data-campo') === 'zona') { filtroZona = ev.target.value; u.ranura(s.lista, lista(NEXO.store.get(), id)); }
    });
    c.delegar(raiz, {
      ir: function (pid) { NEXO.router.ir('#/puertas/' + pid); },
      lector: function () { NEXO.simulador.fijarPuntoLector(id); NEXO.router.ir('#/lector'); }
    });

    return {
      actualizar: function (e) {
        var p = e.puntosPorId[id];
        if (!p) { u.ranura(s.cabeza, c.vacio('search', 'No existe ' + esc(id), 'Elige una puerta de la lista.')); return; }
        u.ranura(s.lista, lista(e, id));
        u.ranura(s.cabeza, cabeza(e, p));
        u.ranura(s.cifras, cifras(e, p));
        u.ranura(s.actividad, p.actividad.slice().reverse().slice(0, 8).map(function (a) {
          var tono = a.tipo === 'sistema' ? 'info' : a.tipo;
          return '<div class="feed__item"><span class="feed__dot feed__dot--' + tono + '"></span><div style="flex:1">' + esc(a.texto) + '</div><time>' + fmt.hora(a.t) + '</time></div>';
        }).join(''));
        u.ranura(s.lector, lector(e, p));
        u.ranura(s.intentos, intentos(p));
      },
      desmontar: function () {}
    };
  }

  function lista(e, sel) {
    return e.puntos.filter(function (p) { return !filtroZona || p.zona === filtroZona; }).map(function (p) {
      var v = d.estadoVisible(p, e.evento, e.coordinador, e.ahoraS);
      var x = d.ESTADO_PUNTO[v];
      return '<button type="button" class="grow' + (p.id === sel ? ' grow--sel' : '') + '" data-accion="ir" data-arg="' + p.id + '">' +
        '<i class="dot dot--' + x.tono + (v !== EP.EN_LINEA && v !== EP.SIN_ABRIR ? ' dot--pulse' : '') + '"></i>' +
        '<span class="grow__txt"><b>' + p.id + '</b><small>' + esc(p.nombre) + '</small></span>' +
        '<span class="grow__val num">' + (v === EP.EN_LINEA ? fmt.entero(p.decisionesMinuto) + '<small>/min</small>' : '<small class="' + x.tono + '-t">' + esc(x.texto) + '</small>') + '</span></button>';
    }).join('');
  }

  function cabeza(e, p) {
    var v = d.estadoVisible(p, e.evento, e.coordinador, e.ahoraS);
    var x = d.ESTADO_PUNTO[v];
    var incs = e.incidentes.filter(function (i) { return i.puntoId === p.id; });
    var abiertos = incs.filter(c.abierto);
    var explica = {
      'en-linea': 'Valida cada intento contra el coordinador local.',
      'sin-comunicacion': 'No alcanza al coordinador. Sus intentos quedan en el diario del lector, sin aceptación.',
      'averiado': 'El lector está fuera de servicio. La gente se dirige a otras puertas.',
      'en-pausa': 'El coordinador no tiene autoridad válida. Nadie acepta hasta recuperarla.',
      'sin-abrir': 'La ventana de ingreso todavía no ha empezado.'
    }[v];
    return '<div class="gdet"><span class="bubble bubble--' + x.tono + ' gdet__ico">' + ico('door-open', 24) + '</span>' +
      '<div class="gdet__txt"><div class="row row--wrap"><h2>' + esc(p.nombre) + '</h2>' + c.estadoPunto(v) +
      (p.redirigido ? c.badge('Flujo redirigido', 'info') : '') + '</div>' +
      '<p><span class="mono">' + p.id + '</span> · valida hacia ' + p.zonas.map(esc).join(' y ') + ' · ' + esc(explica) + '</p></div>' +
      '<div class="toolbar">' +
        (abiertos.length ? '<a class="btn" href="#/incidentes/' + abiertos[0].id + '">' + ico('siren', 16, 'no-t') + abiertos.length + ' incidente' + (abiertos.length > 1 ? 's' : '') + ' abierto' + (abiertos.length > 1 ? 's' : '') + '</a>'
          : '<span class="dim nowrap">' + incs.length + ' incidente' + (incs.length === 1 ? '' : 's') + ' en el evento</span>') +
        '<button type="button" class="btn btn--primary" data-accion="lector">' + ico('scan-line', 16) + 'Probar en el lector</button></div></div>';
  }

  function cifras(e, p) {
    var lat = p.latencias.length ? u.percentil(p.latencias, 0.95) : 0;
    var ult = e.ahoraS - p.ultimaComunicacionS;
    return mini('activity', 'info', 'Decisiones por minuto', fmt.entero(p.decisionesMinuto), c.sparkline(p.serie, 30)) +
      mini('timer', lat && lat > d.Umbral.LATENCIA_MS ? 'warn' : 'ok', 'p95 de respuesta', lat ? fmt.entero(lat) + ' ms' : '—', '<span class="dim">últimas ' + p.latencias.length + ' decisiones</span>') +
      mini('history', p.pendientesDiario ? 'warn' : 'ok', 'En el diario del lector', fmt.entero(p.pendientesDiario),
        '<span class="dim">' + (p.sincronizandoDesdeS !== null ? 'sincronizando hace ' + fmt.duracion(e.ahoraS - p.sincronizandoDesdeS) : fmt.entero(p.diarioTotal) + ' en todo el evento') + '</span>') +
      mini('radio-tower', ult >= d.Umbral.DETECCION_S ? 'no' : 'ok', 'Último reporte', fmt.hace(ult), '<span class="dim">«sin comunicación» a los 30 s (meta 60 s)</span>');
  }

  function mini(icono, tono, titulo, valor, pie) {
    return '<div class="card minik"><div class="row"><span class="bubble bubble--' + tono + '" style="width:30px;height:30px">' + ico(icono, 16) + '</span><span class="minik__lbl">' + esc(titulo) + '</span></div>' +
      '<div class="minik__val num">' + valor + '</div><div class="minik__foot">' + pie + '</div></div>';
  }

  function lector(e, p) {
    var l = p.lectores[0];
    return '<div class="reader"><span class="reader__art">' + ico('smartphone', 26) + '</span><div><b class="mono">' + esc(l.id) + '</b>' +
      '<small>' + esc(l.familia) + ' · ' + esc(l.procedencia) + '</small></div>' + c.badge('Autenticado', 'ok') + '</div>' +
      '<dl class="kv" style="margin:14px 0">' +
        '<dt>Credencial</dt><dd class="mono">' + esc(l.credencial) + '</dd>' +
        '<dt>Alcance</dt><dd>' + esc(e.evento.id) + ' · ' + p.id + '</dd>' +
        '<dt>Vigente desde</dt><dd class="mono">' + fmt.hora(l.desdeS, true) + '</dd>' +
        '<dt>Vence</dt><dd>al cerrar el evento</dd>' +
        '<dt>Canal</dt><dd>Autenticación mutua</dd></dl>' +
      '<div class="field__lbl" style="margin-bottom:6px">Historial de lectores</div>' +
      '<div class="tablewrap"><table class="table"><thead><tr><th>Lector</th><th>Desde</th><th>Hasta</th><th>Origen</th></tr></thead><tbody>' +
      p.lectores.map(function (x) {
        return '<tr><td class="mono">' + esc(x.id) + '</td><td class="mono">' + fmt.hora(x.desdeS) + '</td><td class="mono">' + (x.hastaS ? fmt.hora(x.hastaS) : '—') + '</td><td>' + esc(x.procedencia) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      (p.lectores.length > 1 ? '<p class="dim" style="font-size:12px;margin-top:8px">El punto conservó su identidad y sus registros al cambiar de lector' + (p.recuperacionS ? ' (recuperado en ' + fmt.duracion(p.recuperacionS) + ')' : '') + '.</p>' : '');
  }

  function intentos(p) {
    if (!p.recientes.length) return '<p class="dim">Esta puerta todavía no ha recibido intentos.</p>';
    return '<div class="tablewrap"><table class="table"><thead><tr><th>Hora</th><th>Identificador de origen</th><th>Boleta</th><th>Decisión</th><th>Motivo</th><th class="right">Respuesta</th><th>Vía</th></tr></thead><tbody>' +
      p.recientes.slice(0, 10).map(function (it) {
        return '<tr><td class="mono dim">' + fmt.hora(it.t, true) + '</td><td class="mono">' + esc(it.id) + '</td><td class="mono">' + esc(it.ref) + '</td>' +
          '<td>' + c.decision(it.decision, true) + '</td><td>' + esc(it.admision ? 'Primer ingreso · genera admisión' : it.motivo) + '</td>' +
          '<td class="right mono">' + (it.latenciaMs !== null ? it.latenciaMs + ' ms' : '—') + '</td><td class="dim">' + esc(it.evidencia.via) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  return { id: 'punto', montar: montar };
})();

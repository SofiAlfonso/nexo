/* ============================================================
   vistas/pmu.js — Resumen en vivo (puesto de mando)

   Responde una sola pregunta: ¿qué está pasando ahora en las
   puertas y qué necesita mi atención? Primero una frase en lenguaje
   llano, después las cifras y al final el detalle.
   ============================================================ */

NEXO.vistas.pmu = (function () {
  'use strict';

  var u = NEXO.util, esc = u.esc, ico = u.icono, fmt = u.fmt;
  var d = NEXO.dominio, EP = d.EstadoPunto, EC = d.EstadoCoordinador;
  var c;

  function montar(cont) {
    c = NEXO.vistas.comunes;
    var raiz = document.createElement('div');
    raiz.className = 'page';
    raiz.innerHTML =
      c.cabecera({
        kicker: 'Operación en vivo', icono: 'activity',
        titulo: 'Resumen del evento',
        texto: 'Qué está pasando ahora en las 20 puertas y qué necesita tu atención. Todo se actualiza solo.',
        acciones: '<a class="btn" href="#/lector">' + ico('scan-line', 16) + 'Probar el lector</a>' +
                  '<a class="btn btn--primary" href="#/incidentes" data-slot="btnInc"></a>'
      }) +
      '<section class="card hero" data-slot="hero"></section>' +
      '<section class="grid grid--4 kpis" data-slot="kpis"></section>' +
      '<div class="grid grid--main-side" style="margin-top:16px">' +
        '<div class="stack">' +
          '<section class="card"><div class="card__head"><h2>Cómo fluye cada decisión</h2>' +
            c.tip('Cada lector pregunta al <b>coordinador local</b> del estadio, que es la única autoridad del evento: así una boleta no puede entrar dos veces. La nube recibe la evidencia después y distribuye los cambios de la boletería.', 'ADR-002 · ADR-003 · ADR-005 · ADR-011') +
            '<span class="spacer"></span><span data-slot="archBadge"></span></div>' +
            '<div class="card__body" data-slot="arq"></div></section>' +
          '<section class="card"><div class="card__head"><h2>Puertas</h2>' +
            c.tip('Cada ficha es un punto de validación. El color indica su estado; la barra, cuántas decisiones tomó en el último minuto. Haz clic para ver el detalle.', 'KR1.2 · «sin comunicación» en máximo 60 s') +
            '<span class="spacer"></span><div class="legend" data-slot="leyenda"></div></div>' +
            '<div class="card__body"><div class="gates" data-slot="puertas"></div></div></section>' +
          '<div class="grid grid--2">' +
            '<section class="card"><div class="card__head"><h2>Admisiones por zona</h2>' +
              c.tip('Primeras aceptaciones correctas por zona autorizada, frente a lo estimado. <b>No son personas dentro del estadio</b> y no se suman con rechazos ni reingresos.', 'Reglas 4 y 10') +
              '</div><div class="card__body" data-slot="zonas"></div></section>' +
            '<section class="card"><div class="card__head"><h2>Ritmo de decisiones</h2>' +
              c.tip('Decisiones por minuto de todas las puertas en los últimos 40 minutos.', 'Pico previsto: factor 3 sobre la media') +
              '<span class="spacer"></span><span class="dim num" data-slot="ritmoTxt"></span></div>' +
              '<div class="card__body" data-slot="ritmo"></div></section>' +
          '</div>' +
        '</div>' +
        '<aside class="stack">' +
          '<section class="card"><div class="card__head"><h2>Requiere tu atención</h2><span class="spacer"></span>' +
            '<a class="btn btn--ghost btn--sm" href="#/incidentes">Ver todo' + ico('arrow-right', 14) + '</a></div>' +
            '<div class="card__body" data-slot="atencion"></div></section>' +
          '<section class="card"><div class="card__head"><h2>Últimas decisiones</h2>' +
            c.tip('Cada fila es un intento real, decidido por las mismas reglas del modelo de dominio. Las referencias son técnicas: no identifican a nadie.', 'ADR-006 · sin datos personales') +
            '</div><div class="card__body" data-slot="decisiones"></div></section>' +
          '<section class="card"><div class="card__head"><h2>Actividad</h2></div>' +
            '<div class="card__body"><div class="feed" data-slot="actividad"></div></div></section>' +
        '</aside>' +
      '</div>';
    cont.appendChild(raiz);
    var s = u.ranuras(raiz);

    return {
      actualizar: function (e) {
        var abiertos = e.incidentes.filter(c.abierto).length;
        u.ranura(s.btnInc, ico('siren', 16) + 'Incidentes' + (abiertos ? ' <span class="pillnum">' + abiertos + '</span>' : ''));
        u.ranura(s.hero, hero(e));
        u.ranura(s.kpis, kpis(e));
        u.ranura(s.arq, arquitectura(e));
        u.ranura(s.archBadge, e.coordinador.estado === EC.OPERANDO ? c.badge('Autoridad única activa', 'ok') : c.badge('Sin autoridad: no se acepta', 'no', 'badge--live'));
        u.ranura(s.leyenda, leyenda(e));
        u.ranura(s.puertas, puertas(e));
        u.ranura(s.zonas, zonas(e));
        u.ranura(s.ritmo, c.sparkline(e.serie.map(function (x) { return x.decisiones; }), 150));
        u.ranura(s.ritmoTxt, e.serie.length ? fmt.entero(e.serie[e.serie.length - 1].decisiones) + ' en el último minuto' : '');
        u.ranura(s.atencion, atencion(e));
        u.ranura(s.decisiones, decisiones(e));
        u.ranura(s.actividad, e.actividad.slice(0, 7).map(function (a) {
          return '<div class="feed__item"><span class="feed__dot feed__dot--' + a.tono + '"></span><div style="flex:1">' + esc(a.texto) + '</div><time>' + fmt.hora(a.t) + '</time></div>';
        }).join('') || '<p class="dim">Sin actividad todavía.</p>');
      },
      desmontar: function () {}
    };
  }

  // ---------- estado general en una frase ----------

  function problemas(e) {
    var lista = [];
    e.puntos.forEach(function (p) {
      var v = d.estadoVisible(p, e.evento, e.coordinador, e.ahoraS);
      if (v === EP.SIN_COMUNICACION) lista.push(p.id + ' sin comunicación');
      if (v === EP.AVERIADO) lista.push('lector averiado en ' + p.id);
    });
    if (!e.nube.enLinea) lista.push('sin enlace con la nube');
    if (e.evento.politicas.reingresoSuspendido) lista.push('reingresos suspendidos');
    return lista;
  }

  function hero(e) {
    var ev = e.evento, ahora = e.ahoraS;
    var enLinea = e.puntos.filter(function (p) { return d.estadoVisible(p, ev, e.coordinador, ahora) === EP.EN_LINEA; }).length;
    var tono, icono, titulo, texto, accion = '';
    var prob = problemas(e);

    if (ev.estado === 'preparacion') {
      var faltan = e.preparacion.controles.filter(function (x) { return !x.ok; }).length;
      tono = 'info'; icono = 'clipboard-check';
      titulo = 'El ingreso abre a las ' + fmt.hora(ev.aperturaS) + ' (' + fmt.plazo(ev.aperturaS - ahora) + ')';
      texto = faltan ? 'Faltan ' + faltan + ' controles previos por confirmar. Sin ellos no se debe abrir.' : 'Todos los controles previos están confirmados.';
      accion = '<a class="btn btn--primary" href="#/preparacion">Revisar la preparación</a>';
    } else if (ev.estado === 'cerrado') {
      tono = 'violet'; icono = 'file-check-2';
      titulo = 'La ventana de ingreso terminó';
      texto = 'Sigue el cierre: sincronizar, entregar el preliminar, resolver diferencias y conciliar.';
      accion = '<a class="btn btn--primary" href="#/cierre">Ir al cierre</a>';
    } else if (e.coordinador.estado !== EC.OPERANDO) {
      tono = 'no'; icono = 'server';
      titulo = 'Ninguna puerta puede aceptar ahora';
      texto = 'El coordinador está sin autoridad válida. Los intentos quedan en los diarios, sin aceptación, hasta que se promueva la réplica.';
      accion = '<a class="btn btn--primary" href="#/incidentes">Decidir ahora</a>';
    } else if (prob.length) {
      tono = 'warn'; icono = 'triangle-alert';
      titulo = enLinea + ' de 20 puertas validan con normalidad';
      texto = 'Atención: ' + prob.join(' · ') + '.';
      accion = '<a class="btn" href="#/incidentes">Ver incidentes</a>';
    } else {
      tono = 'ok'; icono = 'shield-check';
      titulo = 'Todo en orden';
      texto = 'Las 20 puertas validan contra el coordinador local y la evidencia llega a la nube a tiempo.';
    }

    var pct = u.limitar((ahora - ev.aperturaS) / (ev.cierreS - ev.aperturaS) * 100, 0, 100);
    var ventanaTxt = ev.estado === 'preparacion' ? 'Aún no empieza' :
      ev.estado === 'cerrado' ? 'Cerró a las ' + fmt.hora(ev.cierreS) :
      'Transcurrido ' + fmt.duracion(ahora - ev.aperturaS) + ' · quedan ' + fmt.duracion(ev.cierreS - ahora);

    return '<div class="hero__main"><span class="bubble bubble--' + tono + ' hero__ico">' + ico(icono, 22) + '</span>' +
      '<div><h2>' + esc(titulo) + '</h2><p>' + esc(texto) + '</p></div>' + (accion ? '<div class="hero__cta">' + accion + '</div>' : '') + '</div>' +
      '<div class="hero__win"><div class="hero__winhead"><span>Ventana de ingreso</span><b class="num">' + fmt.hora(ev.aperturaS) + ' – ' + fmt.hora(ev.cierreS) + '</b></div>' +
      '<div class="wbar"><span style="width:' + pct.toFixed(1) + '%"></span><i style="left:' + pct.toFixed(1) + '%"></i></div>' +
      '<div class="dim" style="font-size:12.5px;margin-top:6px">' + esc(ventanaTxt) + '</div></div>';
  }

  // ---------- indicadores ----------

  function kpis(e) {
    var m = e.metricas, U = d.Umbral;
    var adm = e.conteo.admisiones, est = e.evento.admisionesEstimadas;
    var enPlazo = m.solicitudes ? m.enPlazo / m.solicitudes * 100 : 100;
    var vis = m.visiblesTotal ? m.visiblesEnPlazo / m.visiblesTotal * 100 : 100;
    var sinResp = e.conteo.sinRespuesta;

    return kpi('ticket', 'info', 'Admisiones',
        c.tip('Primera aceptación correcta de cada boleta en el evento. Es lo que se cobra. <b>No equivale a personas dentro.</b>', 'Regla 4 · unidad facturable'),
        fmt.entero(adm), 'de ' + fmt.entero(est) + ' estimadas',
        '<div class="kpi__ring">' + c.anillo(adm / est * 100, 52) + '<span>' + Math.round(adm / est * 100) + '%</span></div>') +
      kpi('activity', 'violet', 'Decisiones por segundo',
        c.tip('Aceptaciones y rechazos por segundo en el último minuto, sumando todas las puertas.', 'Capacidad objetivo: 37,5 / s con tres eventos'),
        fmt.decimal(m.dps, 1), fmt.entero(e.conteo.decisiones) + ' decisiones en total',
        '<div class="kpi__spark">' + c.sparkline(e.serie.slice(-20).map(function (x) { return x.decisiones; }), 44) + '</div>') +
      kpi('timer', enPlazo >= U.LATENCIA_MIN_PCT ? 'ok' : 'no', 'Respuestas en ≤ 300 ms',
        c.tip('De todas las solicitudes de los lectores, cuántas recibieron respuesta en 300 milisegundos. <b>Las que no recibieron respuesta también cuentan</b> como fuera de plazo.', 'CA2 · meta 95 % · ADR-013 · D11'),
        m.solicitudes ? fmt.pct(enPlazo) : '—', 'p95 ' + (m.p95Ms ? fmt.entero(m.p95Ms) + ' ms' : '—') + ' · ' + fmt.entero(sinResp) + ' sin respuesta',
        c.meta(enPlazo >= U.LATENCIA_MIN_PCT, m.solicitudes > 0)) +
      kpi('eye', vis >= U.VISIBILIDAD_MIN_PCT ? 'ok' : 'no', 'Visibles en ≤ 5 s',
        c.tip('Decisiones que aparecieron en el panel central en menos de 5 segundos. Las tomadas durante un corte de enlace se informan aparte, no se esconden.', 'KR1.1 · meta 95 %'),
        m.visiblesTotal ? fmt.pct(vis) : '—',
        m.duranteCorte ? fmt.entero(m.duranteCorte) + ' durante el corte, aparte' : 'medido en el panel central',
        c.meta(vis >= U.VISIBILIDAD_MIN_PCT, m.visiblesTotal > 0));
  }

  function kpi(icono, tono, titulo, ayuda, valor, pie, lado) {
    return '<article class="card kpi"><div class="kpi__top"><span class="bubble bubble--' + tono + '">' + ico(icono, 18) + '</span>' +
      '<span class="kpi__lbl">' + esc(titulo) + '</span>' + ayuda + '</div>' +
      '<div class="kpi__row"><div><div class="kpi__val num">' + valor + '</div><div class="kpi__foot">' + esc(pie) + '</div></div>' + lado + '</div></article>';
  }

  // ---------- arquitectura en vivo ----------

  function arquitectura(e) {
    var ev = e.evento, co = e.coordinador;
    var vis = e.puntos.map(function (p) { return d.estadoVisible(p, ev, co, e.ahoraS); });
    var cuenta = function (x) { return vis.filter(function (v) { return v === x; }).length; };
    var enLinea = cuenta(EP.EN_LINEA), sinCom = cuenta(EP.SIN_COMUNICACION), aver = cuenta(EP.AVERIADO);
    var diario = e.puntos.reduce(function (s, p) { return s + p.pendientesDiario; }, 0);
    var edad = Math.max(0, e.ahoraS - ev.ultimoCambioRecibidoS);

    var lectTono = ev.estado === 'preparacion' ? 'mute' : co.estado !== EC.OPERANDO ? 'violet' : (sinCom || aver) ? 'warn' : 'ok';
    var coTono = co.estado === EC.OPERANDO ? 'ok' : co.estado === EC.PROTEGIENDO ? 'violet' : 'no';
    var nubeTono = e.nube.enLinea ? (e.nube.buzon > 50 ? 'warn' : 'ok') : 'no';
    var bolTono = !e.integracion.enLinea ? 'no' : 'ok';
    var edadTono = edad > d.Umbral.ANTIGUEDAD_PERMISOS_S ? 'no-t' : edad > 120 ? 'warn-t' : '';

    var coEstado = co.estado === EC.OPERANDO ? 'Decide cada intento' : co.estado === EC.PROTEGIENDO ? 'Restableciendo autoridad' : 'Sin autoridad: no se acepta';
    // SER-05: antigüedad del último reporte del coordinador (nodo único, D9).
    var coEdad = co.ultimoReporteS === null ? null : Math.max(0, e.ahoraS - co.ultimoReporteS);
    var coEdadTono = coEdad === null ? 'no-t' : coEdad >= d.Umbral.SIN_COMUNICACION_S ? 'no-t' : coEdad >= d.Umbral.DETECCION_S ? 'warn-t' : '';

    return '<div class="arch">' +
      nodo(lectTono, 'smartphone', 'Lectores', '20 puertas',
        '<li><b class="num">' + enLinea + '</b> en línea</li>' +
        (sinCom ? '<li class="warn-t"><b class="num">' + sinCom + '</b> sin comunicación</li>' : '') +
        (aver ? '<li class="no-t"><b class="num">' + aver + '</b> averiado</li>' : '') +
        '<li><b class="num">' + fmt.entero(diario) + '</b> en diarios</li>') +
      enlace(co.estado === EC.OPERANDO && ev.estado !== 'preparacion' ? 'on' : co.estado === EC.OPERANDO ? 'idle' : 'off', 'Consulta síncrona', '< 500 ms') +
      nodo(coTono, 'server', 'Coordinador local', coEstado,
        '<li>Nodo único <b class="mono">' + esc(co.id) + '</b></li>' +
        '<li class="dim">' + esc(co.topologia) + '</li>' +
        '<li class="' + coEdadTono + '">' + (coEdad === null ? 'Sin reportes todavía' : 'Último reporte ' + fmt.hace(coEdad)) + '</li>') +
      enlace(e.nube.enLinea ? 'on' : 'off', 'Evidencia y cambios', 'asíncrono') +
      nodo(nubeTono, e.nube.enLinea ? 'cloud' : 'cloud-off', 'Nube NEXO', e.nube.enLinea ? 'Panel central y conciliación' : 'Sin enlace con el estadio',
        '<li>Buzón <b class="num">' + fmt.entero(e.nube.buzon) + '</b></li>' +
        '<li>Recibidos <b class="num">' + fmt.entero(e.nube.enviados) + '</b></li>' +
        (e.nube.caidaDesdeS !== null ? '<li class="no-t">Corte hace ' + fmt.duracion(e.ahoraS - e.nube.caidaDesdeS) + '</li>' : '<li class="dim">Auditoría 90 días</li>')) +
      enlace(e.integracion.enLinea ? 'on' : 'off', 'Permisos y anulaciones', 'versionados') +
      nodo(bolTono, 'ticket', 'Boletería', esc(ev.boleteria),
        '<li>Permisos <b>v' + ev.versionPermisos + '</b></li>' +
        '<li class="' + edadTono + '">Último cambio ' + fmt.hace(edad) + '</li>' +
        '<li class="dim">' + (e.integracion.enTransito.length ? e.integracion.enTransito.length + (e.integracion.enTransito.length === 1 ? ' cambio en camino' : ' cambios en camino') : 'Sin cambios pendientes') + '</li>') +
      '</div>';
  }

  function nodo(tono, icono, titulo, sub, items) {
    return '<div class="arch__node arch__node--' + tono + '"><div class="arch__head"><span class="bubble bubble--' + tono + '">' + ico(icono, 18) + '</span>' +
      '<div><b>' + esc(titulo) + '</b><small>' + esc(sub) + '</small></div></div><ul>' + items + '</ul></div>';
  }

  function enlace(estado, titulo, sub) {
    return '<div class="arch__link arch__link--' + estado + '"><span class="arch__line"></span>' +
      '<span class="arch__lbl">' + esc(titulo) + '<small>' + (estado === 'off' ? 'interrumpido' : esc(sub)) + '</small></span></div>';
  }

  // ---------- puertas ----------

  function leyenda(e) {
    var cuenta = {};
    e.puntos.forEach(function (p) {
      var v = d.estadoVisible(p, e.evento, e.coordinador, e.ahoraS);
      cuenta[v] = (cuenta[v] || 0) + 1;
    });
    return Object.keys(d.ESTADO_PUNTO).filter(function (k) { return cuenta[k]; }).map(function (k) {
      return '<span class="legend__i"><i class="dot dot--' + d.ESTADO_PUNTO[k].tono + '"></i>' + esc(d.ESTADO_PUNTO[k].texto) + ' <b>' + cuenta[k] + '</b></span>';
    }).join('');
  }

  function puertas(e) {
    var max = Math.max.apply(null, e.puntos.map(function (p) { return p.decisionesMinuto; }).concat([10]));
    var zonas = zonasDeLosPuntos(e);
    return e.puntos.map(function (p) {
      var v = d.estadoVisible(p, e.evento, e.coordinador, e.ahoraS);
      var x = d.ESTADO_PUNTO[v];
      var extra = v === EP.SIN_COMUNICACION ? 'Sin reporte hace ' + fmt.duracion(e.ahoraS - p.ultimaComunicacionS)
        : v === EP.AVERIADO ? 'Fuera hace ' + fmt.duracion(e.ahoraS - p.averiadoDesdeS)
        : p.pendientesDiario ? fmt.entero(p.pendientesDiario) + ' por sincronizar'
        : fmt.entero(p.decisionesMinuto) + ' / min';
      return '<a class="gate gate--' + x.tono + '" href="#/puertas/' + p.id + '" title="' + esc(p.nombre + ' · ' + x.texto) + '">' +
        '<div class="gate__top"><b>' + p.id + '</b><i class="dot dot--' + x.tono + (v !== EP.EN_LINEA ? ' dot--pulse' : '') + '"></i></div>' +
        '<div class="gate__name"><i class="zdot" style="background:var(--' + c.colorZona(p.zona, zonas) + ')"></i>' + esc(p.nombre.replace('Puerta ', '')) + '</div>' +
        '<div class="bar bar--' + (v === EP.EN_LINEA ? 'ok' : x.tono) + '"><span style="width:' + (v === EP.EN_LINEA ? p.decisionesMinuto / max * 100 : 100).toFixed(0) + '%"></span></div>' +
        '<div class="gate__foot">' + esc(extra) + '</div></a>';
    }).join('');
  }

  function zonasDeLosPuntos(e) {
    var set = {};
    e.puntos.forEach(function (p) { if (p.zona) set[p.zona] = true; });
    return Object.keys(set).sort();
  }

  function zonas(e) {
    var lista = zonasDeLosPuntos(e);
    var admisiones = e.admisionesPorZona || {};
    var max = Math.max.apply(null, lista.map(function (z) { return admisiones[z] || 0; }).concat([1]));
    if (!lista.length) return '<p class="dim">Sin puertas cargadas todavía.</p>';
    return lista.map(function (z) {
      var n = admisiones[z] || 0, pct = n / max * 100;
      return '<div class="zrow"><div class="zrow__top"><span><i class="zdot" style="background:var(--' + c.colorZona(z, lista) + ')"></i>' + esc(z) + '</span>' +
        '<span class="num"><b>' + fmt.entero(n) + '</b></span></div>' +
        '<div class="bar"><span style="width:' + u.limitar(pct, 0, 100).toFixed(1) + '%;background:var(--' + c.colorZona(z, lista) + ')"></span></div></div>';
    }).join('') + '<p class="dim" style="font-size:12px;margin-top:12px">Primeras aceptaciones correctas por zona. No indican ocupación del recinto.</p>';
  }

  // ---------- panel lateral ----------

  function atencion(e) {
    var abiertos = e.incidentes.filter(c.abierto).sort(function (a, b) { return a.prioridad.orden - b.prioridad.orden; });
    var acciones = e.acciones.filter(function (a) { return a.estado === 'pendiente'; });
    var html = '';
    if (acciones.length) {
      html += '<a class="notice notice--violet" href="#/incidentes" style="margin-bottom:12px;text-decoration:none">' + ico('hand', 18) +
        '<div><b>' + acciones.length + (acciones.length === 1 ? ' acción espera' : ' acciones esperan') + ' tu decisión</b><br><span class="soft">' + esc(acciones[0].titulo) + '</span></div></a>';
    }
    if (!abiertos.length) {
      return html + c.vacio('shield-check', 'Nada pendiente', 'No hay incidentes abiertos. Si algo falla, aparecerá aquí con su plazo.');
    }
    return html + '<div class="minilist">' + abiertos.slice(0, 4).map(function (inc) {
      var t = c.tipoInc(inc);
      return '<a class="mini" href="#/incidentes/' + inc.id + '"><span class="bubble bubble--' + (inc.prioridad.id === 'critica' ? 'no' : inc.prioridad.id === 'alta' ? 'warn' : 'info') + '">' + ico(t.icono, 16) + '</span>' +
        '<div class="mini__txt"><b>' + esc(inc.titulo) + '</b><small>' + esc(inc.id) + ' · ' + esc(inc.prioridad.nombre) + ' · ' + fmt.hace(e.ahoraS - inc.recibidaEnS) + '</small>' +
        c.slaActuacion(inc, e.ahoraS).html + '</div></a>';
    }).join('') + '</div>';
  }

  function decisiones(e) {
    var filas = e.intentos.slice(0, 8);
    if (!filas.length) return '<p class="dim">Todavía no hay intentos. Las puertas abren a las ' + fmt.hora(e.evento.aperturaS) + '.</p>';
    return '<div class="dlist">' + filas.map(function (it) {
      return '<div class="dlist__row"><time class="mono dim">' + fmt.hora(it.t, true) + '</time>' +
        '<span class="mono">' + it.puntoId + '</span>' + c.decision(it.decision, true) +
        '<span class="dlist__why" title="' + esc(it.motivo) + '">' + esc(it.admision ? 'Primer ingreso' : it.motivo) + '</span></div>';
    }).join('') + '</div>';
  }

  return { id: 'pmu', montar: montar };
})();

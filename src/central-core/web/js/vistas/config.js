/* ============================================================
   vistas/config.js — Preparación y apertura

   Lo que tiene que estar probado antes de abrir (tabla 11 y CA1–CA4
   del taller). Los controles son obligatorios: un fallo bloquea la
   apertura y no se compensa con buenos resultados.
   ============================================================ */

NEXO.vistas.config = (function () {
  'use strict';

  var u = NEXO.util, esc = u.esc, ico = u.icono, fmt = u.fmt;
  var d = NEXO.dominio, EC = d.EstadoCoordinador;
  var c;

  function montar(cont) {
    c = NEXO.vistas.comunes;
    var raiz = document.createElement('div');
    raiz.className = 'page';
    raiz.innerHTML =
      c.cabecera({
        kicker: 'Antes del evento', icono: 'clipboard-check',
        titulo: 'Preparación y apertura',
        texto: 'Lo que tiene que estar probado antes de abrir las puertas. Un control pendiente bloquea la apertura y no se compensa con buenos resultados en otra parte.'
      }) +
      '<section class="card hero" data-slot="hero"></section>' +
      '<div class="grid grid--main-side" style="margin-top:16px">' +
        '<div class="stack">' +
          '<section class="card"><div class="card__head"><h2>Controles previos</h2>' +
            c.tip('Condiciones que habilitan la operación. El supervisor autoriza puntos y modalidades; un fallo técnico bloquea la modalidad afectada hasta corregir y repetir la prueba.', 'Tabla 11 del taller') +
            '</div><div class="card__body" data-slot="controles"></div></section>' +
          '<section class="card"><div class="card__head"><h2>Puertas listas para abrir</h2>' +
            c.tip('Antes de abrir, cada punto habilitado debe tener lector compatible con credencial, zonas autorizadas y la versión requerida de permisos.', 'Regla 5 · ADR-008') +
            '</div><div class="card__body" style="padding-top:8px" data-slot="puertas"></div></section>' +
        '</div>' +
        '<aside class="stack">' +
          '<section class="card"><div class="card__head"><h2>Pruebas de aceptación</h2>' +
            c.tip('Se ejecutan sin público antes de cada piloto. Superarlas demuestra capacidad técnica, no adopción.', 'CA1 a CA4') +
            '</div><div class="card__body" data-slot="pruebas"></div></section>' +
          '<section class="card"><div class="card__head"><h2>Coordinador del estadio</h2>' +
            c.tip('Una única autoridad lógica por evento. Durante los tres eventos se comparan tres topologías; aquí se usa la candidata B.', 'ADR-002 · ADR-005') +
            '</div><div class="card__body" data-slot="coord"></div></section>' +
          '<section class="card"><div class="card__head"><h2>Integración con la boletería</h2>' +
            c.tip('Un adaptador delgado por boletería traduce su contrato al modelo canónico, sin decidir reglas de acceso. Las diferencias entre eventos se resuelven por configuración.', 'ADR-007 · ADR-010') +
            '</div><div class="card__body" data-slot="integracion"></div></section>' +
          '<section class="card"><div class="card__head"><h2>Políticas del evento</h2></div><div class="card__body" data-slot="politicas"></div></section>' +
        '</aside>' +
      '</div>';
    cont.appendChild(raiz);
    var s = u.ranuras(raiz);

    c.delegar(raiz, {
      control: function (id) { NEXO.api.alternarControl(id); },
      confirmar: function () { NEXO.api.confirmarApertura(); }
    });

    return {
      actualizar: function (e) {
        u.ranura(s.hero, hero(e));
        u.ranura(s.controles, controles(e));
        u.ranura(s.puertas, puertas(e));
        u.ranura(s.pruebas, pruebas());
        u.ranura(s.coord, coordinador(e));
        u.ranura(s.integracion, integracion(e));
        u.ranura(s.politicas, politicas(e));
      },
      desmontar: function () {}
    };
  }

  function hero(e) {
    var ctl = e.preparacion.controles;
    var ok = ctl.filter(function (x) { return x.ok; }).length;
    var ev = e.evento;
    var titulo, texto, boton;
    if (ev.estado !== 'preparacion') {
      titulo = 'Ingreso abierto desde las ' + fmt.hora(ev.aperturaS);
      texto = 'Los controles quedaron confirmados. Esta pantalla sirve ahora de referencia de lo que se probó.';
      boton = '<a class="btn" href="#/inicio">Ir al resumen en vivo</a>';
    } else if (ok < ctl.length) {
      titulo = 'Faltan ' + (ctl.length - ok) + ' controles para poder abrir';
      texto = 'Marca cada control cuando tengas la evidencia. La apertura está programada para las ' + fmt.hora(ev.aperturaS) + ' (' + fmt.plazo(ev.aperturaS - e.ahoraS) + ').';
      boton = '<button type="button" class="btn btn--primary btn--lg" disabled>' + ico('lock', 16) + 'Confirmar apertura</button>';
    } else if (!e.preparacion.confirmada) {
      titulo = 'Todo listo para abrir';
      texto = 'Los seis controles se cumplen. Confirma la apertura para que las puertas empiecen a aceptar a las ' + fmt.hora(ev.aperturaS) + '.';
      boton = '<button type="button" class="btn btn--primary btn--lg" data-accion="confirmar">' + ico('door-open', 18) + 'Confirmar apertura</button>';
    } else {
      titulo = 'Apertura confirmada';
      texto = 'Las puertas empezarán a aceptar a las ' + fmt.hora(ev.aperturaS) + ' (' + fmt.plazo(ev.aperturaS - e.ahoraS) + ').';
      boton = c.badge('Confirmada', 'ok');
    }
    var pct = ok / ctl.length * 100;
    return '<div class="hero__main"><div class="kpi__ring kpi__ring--lg">' + c.anillo(pct, 64, ok === ctl.length ? 'var(--ok)' : null) + '<span>' + ok + '/' + ctl.length + '</span></div>' +
      '<div><h2>' + esc(titulo) + '</h2><p>' + esc(texto) + '</p></div><div class="hero__cta">' + boton + '</div></div>';
  }

  function controles(e) {
    var edita = e.evento.estado === 'preparacion';
    return '<div class="ctls">' + e.preparacion.controles.map(function (x) {
      return '<div class="ctl' + (x.ok ? ' ctl--ok' : '') + '">' +
        '<button type="button" class="check" role="checkbox" aria-checked="' + x.ok + '" data-accion="control" data-arg="' + x.id + '"' + (edita ? '' : ' disabled') + ' aria-label="' + esc(x.titulo) + '">' +
        '<span class="check__box">' + (x.ok ? ico('check', 13) : '') + '</span></button>' +
        '<div class="ctl__txt"><b>' + esc(x.titulo) + '</b><p>' + esc(x.detalle) + '</p></div>' +
        (x.ok ? c.badge('Confirmado', 'ok') : c.badge('Pendiente', 'warn')) + '</div>';
    }).join('') + '</div>';
  }

  function puertas(e) {
    var si = '<span class="yes">' + ico('check', 14) + '</span>';
    var no = '<span class="dim">—</span>';
    return '<div class="tablewrap"><table class="table"><thead><tr><th>Puerta</th><th>Zonas</th><th>Lector</th><th>Compatible</th><th>Credencial</th><th>Permisos</th><th>Lectura de prueba</th></tr></thead><tbody>' +
      e.puntos.map(function (p) {
        var prep = p.preparacion;
        return '<tr><td><b class="mono">' + p.id + '</b> <span class="dim">' + esc(p.nombre.replace('Puerta ', '')) + '</span></td>' +
          '<td>' + p.zonas.map(esc).join(', ') + '</td><td class="mono">' + (p.lectorActual ? esc(p.lectorActual.id) + ' <span class="dim">· ' + esc(p.lectorActual.procedencia) + '</span>' : no) + '</td>' +
          '<td>' + (prep ? (prep.lector ? si : no) : no) + '</td><td>' + (prep ? (prep.credencial ? si : no) : no) + '</td>' +
          '<td class="mono">v' + e.evento.versionPermisos + ' ' + (prep ? (prep.version ? si : no) : no) + '</td><td>' + (prep ? (prep.prueba ? si : no) : no) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function pruebas() {
    var filas = [
      ['CA1', 'Contingencia probada', 'Tres cortes de 15 min (internet, servicio central, integración) con todos los casos resueltos.'],
      ['CA2', 'Respuesta del motor', 'p95 del intervalo previsto de carga (meta: 500 ms para el 95 %).'],
      ['CA3', 'Reglas probadas', 'Duplicados concurrentes, anulaciones, zona y horario.'],
      ['CA4', 'Presupuesto', 'Trabajo y nube dentro de lo estimado del contrato.']
    ];
    return '<div class="calist">' + filas.map(function (f) {
      return '<div class="ca"><span class="ca__id">' + f[0] + '</span><div><b>' + esc(f[1]) + '</b><small>' + esc(f[2]) + '</small></div>' +
        '<span class="dim" style="font-size:12px">' + ico('circle-dashed', 18, 'dim') + ' No disponible todavía</span></div>';
    }).join('') + '</div><p class="dim" style="font-size:12px;margin-top:8px">Estas pruebas de aceptación aún no tienen una fuente de datos real conectada al panel; esta sección se completará cuando exista.</p>';
  }

  function coordinador(e) {
    var co = e.coordinador;
    var coEdad = co.ultimoReporteS === null ? null : Math.max(0, e.ahoraS - co.ultimoReporteS);
    var coEdadTono = coEdad === null ? 'no-t' : coEdad >= d.Umbral.SIN_COMUNICACION_S ? 'no-t' : coEdad >= d.Umbral.DETECCION_S ? 'warn-t' : '';
    var tono = co.estado === EC.OPERANDO ? 'ok' : co.estado === EC.PROTEGIENDO ? 'violet' : 'no';
    return '<div class="nodes">' + nodo(co.id, co.estado, tono) + '</div>' +
      '<dl class="kv" style="margin-top:12px"><dt>Topología</dt><dd>' + esc(co.topologia) + '</dd>' +
      '<dt>Autoridad desde</dt><dd class="mono">' + fmt.hora(co.desdeS) + '</dd>' +
      '<dt>Último reporte</dt><dd class="' + coEdadTono + '">' + (coEdad === null ? 'Sin reportes todavía' : fmt.hace(coEdad)) + '</dd>' +
      '<dt>Pausas</dt><dd>' + (co.pausas.length ? co.pausas.length : 'ninguna') + '</dd></dl>' +
      '<p class="dim" style="font-size:12px;margin-top:10px">Nodo único (D9): ningún otro componente decide un ingreso.</p>';
  }

  function nodo(id, estado, tono) {
    var texto = estado === EC.OPERANDO ? 'Decide cada intento' : estado === EC.PROTEGIENDO ? 'Restableciendo autoridad' : 'Sin autoridad: no se acepta';
    return '<div class="nodechip nodechip--' + tono + '">' + ico('server', 16) + '<b class="mono">' + esc(id) + '</b><small>' + esc(texto) + '</small></div>';
  }

  function integracion(e) {
    return '<dl class="kv"><dt>Boletería</dt><dd>' + esc(e.evento.boleteria) + '</dd>' +
      '<dt>Admisiones estimadas</dt><dd class="num">' + fmt.entero(e.evento.admisionesEstimadas) + '</dd>' +
      '<dt>Versión actual</dt><dd class="mono">v' + e.evento.versionPermisos + '</dd>' +
      '<dt>Antigüedad tolerable</dt><dd>5 min</dd>' +
      '<dt>Identidad del permiso</dt><dd>cliente + evento + boletería + referencia</dd></dl>';
  }

  function politicas(e) {
    var p = e.evento.politicas;
    return '<ul class="pols">' +
      '<li>' + ico('repeat', 16) + '<span><b>Reingreso</b> ' + (p.reingresoPermitido
        ? 'permitido tras ' + p.reingresoTrasMin + ' min desde el último uso' + (p.reingresoSuspendido ? ' · <span class="warn-t">suspendido ahora</span>' : '')
        : '<span class="no-t">no permitido (D10)</span>: cada boleta admite un único ingreso') + '</span></li>' +
      '<li>' + ico('wifi-off', 16) + '<span><b>Sin coordinador</b> no se autoriza: el intento queda en el diario del lector</span></li>' +
      '<li>' + ico('key-round', 16) + '<span><b>Permisos atrasados</b> más de 5 min: se suspenden los reingresos</span></li>' +
      '<li>' + ico('eye-off', 16) + '<span><b>Datos personales</b>: no se tratan nombres, documentos, pagos ni biometría</span></li>' +
      '<li>' + ico('door-open', 16) + '<span><b>Paso físico</b>: NEXO decide; abrir la puerta es del cliente</span></li>' +
      '</ul><p class="dim" style="font-size:12px;margin-top:8px">Políticas v' + p.version + ', acordadas antes de operar.</p>';
  }

  return { id: 'config', montar: montar };
})();

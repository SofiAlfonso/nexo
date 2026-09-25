/* ============================================================
   vistas/incidente.js — Detalle de un incidente

   Estilo ficha de mesa de ayuda: barra de acciones arriba, bitácora
   en el centro, propiedades y ficha técnica a los lados. La bitácora
   es de solo adición (ADR-004): las notas no se editan ni se borran.
   ============================================================ */

NEXO.vistas.incidente = (function () {
  'use strict';

  var u = NEXO.util, esc = u.esc, ico = u.icono, fmt = u.fmt;
  var d = NEXO.dominio, S = function () { return NEXO.simulador; };
  var c;

  function montar(cont, params) {
    c = NEXO.vistas.comunes;
    var id = params.id;
    var raiz = document.createElement('div');
    raiz.className = 'page';
    cont.appendChild(raiz);

    var e0 = NEXO.store.get();
    if (!buscar(e0, id)) {
      raiz.innerHTML = c.vacio('search', 'No encontramos ' + esc(id), 'Puede que la simulación se haya reiniciado. <a href="#/incidentes">Volver a la bandeja</a>.');
      return { actualizar: function () {}, desmontar: function () {} };
    }

    var tipos = Object.keys(d.TipoIncidente).map(function (k) { return d.TipoIncidente[k]; });
    var prios = Object.keys(d.Prioridad).map(function (k) { return d.Prioridad[k]; });

    raiz.innerHTML =
      '<div class="tbar card">' +
        '<a class="btn btn--ghost" href="#/incidentes">' + ico('arrow-left', 16) + 'Incidentes</a>' +
        '<span class="tbar__sep"></span>' +
        '<button type="button" class="btn" data-accion="destacar" data-slot="star" aria-label="Destacar"></button>' +
        '<div class="btngroup">' +
          '<button type="button" class="btn" data-accion="tomar">' + ico('hand', 16) + 'Tomar</button>' +
          '<button type="button" class="btn" data-accion="nota">' + ico('message-square-plus', 16) + 'Agregar nota</button>' +
          '<button type="button" class="btn" data-accion="escalar">' + ico('arrow-up-right', 16) + 'Escalar</button>' +
        '</div>' +
        '<button type="button" class="btn" data-accion="descartar">' + ico('eye-off', 16) + 'Falsa alarma</button>' +
        '<button type="button" class="btn btn--ok" data-accion="resolver">' + ico('circle-check', 16) + 'Resolver</button>' +
        '<span class="spacer"></span>' +
        '<span class="dim nowrap" data-slot="pos"></span>' +
        '<div class="btngroup"><button type="button" class="btn" data-accion="previo" aria-label="Anterior">' + ico('chevron-left', 16) + '</button>' +
        '<button type="button" class="btn" data-accion="siguiente" aria-label="Siguiente">' + ico('chevron-right', 16) + '</button></div>' +
      '</div>' +
      '<div class="ticket">' +
        '<section class="card ticket__main">' +
          '<div data-slot="cabeza"></div>' +
          '<div data-slot="pendiente"></div>' +
          '<div class="tl" data-slot="bitacora"></div>' +
          '<div class="composer" id="composer">' +
            '<label class="field__lbl" for="nota-' + esc(id) + '">Agregar a la bitácora</label>' +
            '<textarea class="textarea" id="nota-' + esc(id) + '" placeholder="Qué observaste, qué hiciste o qué decidiste…"></textarea>' +
            '<div class="row"><span class="dim" style="font-size:12px">' + ico('lock', 12) + ' Las notas no se editan ni se borran.</span><span class="spacer"></span>' +
            '<button type="button" class="btn btn--primary" data-accion="guardarNota">' + ico('send', 15) + 'Agregar nota</button></div>' +
          '</div>' +
        '</section>' +
        '<section class="card ticket__props">' +
          '<div class="props__state" data-slot="estado"></div>' +
          '<div class="props__body">' +
            '<div class="props__title">Propiedades</div>' +
            '<div class="field"><span class="field__lbl">Clasificación <i>*</i> ' + c.tip('Taxonomía cerrada y versionada, fijada antes del piloto. Si cambiara, los tres eventos dejarían de ser comparables.', 'KR1.3 · ' + d.VERSION_TAXONOMIA) + '</span>' +
              '<select class="select" data-prop="clasificacion">' + tipos.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><span class="field__lbl">Prioridad <i>*</i></span>' +
              '<select class="select" data-prop="prioridad">' + prios.map(function (p) { return '<option value="' + p.id + '">' + esc(p.nombre) + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><span class="field__lbl">Responsable ' + c.tip('Roles del servicio, no personas rastreadas. Cada rol ve solo los eventos de su cliente.', 'ADR-006 · ADR-009') + '</span>' +
              '<select class="select" data-prop="responsable">' + c.ROLES.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><span class="field__lbl">Componente afectado</span><div class="input input--ro" data-slot="componente"></div></div>' +
            '<div class="field"><span class="field__lbl">Recibido</span><div class="input input--ro mono" data-slot="recibido"></div></div>' +
          '</div>' +
          '<div class="props__foot"><button type="button" class="btn btn--primary btn--block" data-accion="actualizar" data-slot="btnAct" disabled>Actualizar</button></div>' +
        '</section>' +
        '<aside class="card ticket__side" data-slot="lado"></aside>' +
      '</div>';

    var s = u.ranuras(raiz);
    var props = {};
    raiz.querySelectorAll('[data-prop]').forEach(function (n) { props[n.getAttribute('data-prop')] = n; });
    var sucio = false;
    var abiertos = { punto: true, tiempos: true, lista: true, rel: false };

    raiz.addEventListener('change', function (ev) {
      if (ev.target.hasAttribute('data-prop')) { sucio = true; s.btnAct.disabled = false; }
    });
    raiz.addEventListener('toggle', function (ev) {
      var k = ev.target.getAttribute && ev.target.getAttribute('data-acc');
      if (k) abiertos[k] = ev.target.open;
    }, true);

    c.delegar(raiz, {
      destacar: function () { S().destacar(id); },
      tomar: function () { S().tomarIncidente(id); },
      nota: function () { var t = raiz.querySelector('textarea'); t.focus(); t.scrollIntoView({ block: 'center', behavior: 'smooth' }); },
      escalar: function () {
        var inc = buscar(NEXO.store.get(), id);
        var sube = { baja: 'media', media: 'alta', alta: 'critica', critica: 'critica' }[inc.prioridad.id];
        S().actualizarIncidente(id, { prioridad: sube, responsable: d.Rol.LIDER_TECNICO });
        S().notaIncidente(id, 'Escalado al líder técnico.');
      },
      descartar: function () { S().descartarIncidente(id); },
      resolver: function () { S().resolverIncidente(id); },
      guardarNota: function () {
        var t = raiz.querySelector('textarea');
        if (!t.value.trim()) { t.focus(); return; }
        S().notaIncidente(id, t.value);
        t.value = '';
      },
      actualizar: function () {
        S().actualizarIncidente(id, {
          clasificacion: props.clasificacion.value, prioridad: props.prioridad.value, responsable: props.responsable.value
        });
        sucio = false; s.btnAct.disabled = true;
      },
      previo: function () { mover(-1); },
      siguiente: function () { mover(1); },
      check: function (i) { S().alternarChecklist(id, Number(i)); },
      aprobar: function (a) { S().decidirAccion(a, true); },
      rechazar: function (a) { S().decidirAccion(a, false); }
    });

    function mover(paso) {
      var lista = NEXO.store.get().incidentes;
      var i = lista.map(function (x) { return x.id; }).indexOf(id);
      var j = i + paso;
      if (j >= 0 && j < lista.length) NEXO.router.ir('#/incidentes/' + lista[j].id);
    }

    return {
      actualizar: function (e) {
        var inc = buscar(e, id);
        if (!inc) return;
        var lista = e.incidentes, i = lista.indexOf(inc);
        u.ranura(s.pos, (i + 1) + ' de ' + lista.length);
        u.ranura(s.star, ico('star', 16, inc.destacado ? 'star-on' : ''));
        u.ranura(s.cabeza, cabeza(e, inc));
        u.ranura(s.pendiente, pendiente(e, inc));
        u.ranura(s.bitacora, bitacora(inc));
        u.ranura(s.estado, estado(e, inc));
        u.ranura(s.componente, esc(inc.componente));
        u.ranura(s.recibido, fmt.hora(inc.recibidaEnS, true));
        u.ranura(s.lado, lado(e, inc, abiertos));
        if (!sucio) {
          if (document.activeElement !== props.clasificacion) props.clasificacion.value = inc.clasificacion;
          if (document.activeElement !== props.prioridad) props.prioridad.value = inc.prioridad.id;
          if (document.activeElement !== props.responsable) props.responsable.value = inc.responsable;
        }
      },
      desmontar: function () {}
    };
  }

  function buscar(e, id) { return e.incidentes.filter(function (x) { return x.id === id; })[0] || null; }

  function cabeza(e, inc) {
    var t = c.tipoInc(inc);
    var sa = c.slaActuacion(inc, e.ahoraS);
    var slaBadge = sa.hecho ? (sa.tono === 'ok' ? c.badge('Actuación en meta', 'ok') : c.badge('Actuación fuera de meta', 'no'))
      : (sa.restante <= 0 ? c.badge('Actuación vencida', 'no') : c.badge('Sin actuar', 'warn'));
    return '<div class="tk-head"><span class="bubble bubble--' + (t.tag === 'gold' ? 'warn' : t.tag === 'mute' ? 'mute' : t.tag === 'violet' ? 'violet' : t.tag) + ' tk-head__ico">' + ico(t.icono, 20) + '</span>' +
      '<div class="tk-head__txt"><h1>' + esc(inc.titulo) + '</h1>' +
      '<p><b>NEXO</b> lo detectó automáticamente · ' + esc(inc.id) + ' · ' + fmt.hace(e.ahoraS - inc.recibidaEnS) + '</p>' +
      '<div class="row row--wrap" style="margin-top:8px">' + c.estadoInc(inc) + slaBadge + c.badge(inc.tipo, 'mute', 'badge--plain') + '</div></div>' +
      '<div class="tk-type">' + ico(t.icono, 18) + '<span>' + esc(t.corto) + '</span></div></div>';
  }

  function pendiente(e, inc) {
    var a = e.acciones.filter(function (x) { return x.incidenteId === inc.id && x.estado === 'pendiente'; })[0];
    if (!a) return '';
    return '<div class="notice notice--violet decide">' + ico('hand', 20) + '<div style="flex:1"><b>' + esc(a.titulo) + '</b><br><span class="soft">' + esc(a.detalle) + '</span>' +
      (a.autoEnS !== null ? '<div class="dim" style="font-size:12px;margin-top:4px">' + ico('timer', 12) + ' Si nadie decide, el rol simulado aprobará en ' + fmt.duracion(Math.max(0, a.autoEnS - e.ahoraS)) + '.</div>' : '') +
      '</div><div class="row">' +
      (a.no ? '<button type="button" class="btn btn--sm" data-accion="rechazar" data-arg="' + a.id + '">' + ico('x', 14, 'no-t') + esc(a.no) + '</button>' : '') +
      '<button type="button" class="btn btn--sm btn--ok" data-accion="aprobar" data-arg="' + a.id + '">' + ico('check', 14) + esc(a.si) + '</button></div></div>';
  }

  var ETIQ = { sistema: 'registró el incidente', nota: 'agregó una nota', accion: 'actuó', estado: 'cambió el estado' };

  function bitacora(inc) {
    return inc.bitacora.map(function (b) {
      return '<div class="tl__item tl__item--' + b.tipo + '">' + c.avatar(b.autor, true) +
        '<div class="tl__card"><div class="tl__head"><b>' + esc(b.autor) + '</b><span class="dim">' + ETIQ[b.tipo] + '</span>' +
        '<time>' + fmt.hora(b.t, true) + '</time></div><div class="tl__text">' + esc(b.texto) + '</div></div></div>';
    }).join('');
  }

  function estado(e, inc) {
    var x = { 'nuevo': 'Nuevo', 'en-curso': 'En curso', 'resuelto': 'Resuelto', 'descartado': 'Falsa alarma' }[inc.estado];
    var sa = c.slaActuacion(inc, e.ahoraS);
    var linea;
    if (!c.abierto(inc)) {
      linea = '<div class="due-line due-line--ok">' + ico('circle-check', 14) + 'CERRADO</div><div class="props__when">a las ' + fmt.hora(inc.resueltaEnS, true) + ' · duró ' + fmt.duracion(inc.resueltaEnS - inc.recibidaEnS) + '</div>';
    } else if (!sa.hecho) {
      linea = '<div class="due-line due-line--' + (sa.restante < 60 ? 'no' : 'warn') + '"><i class="dot dot--' + (sa.restante < 60 ? 'no' : 'warn') + ' dot--pulse"></i>ACTUACIÓN ' + (sa.restante > 0 ? 'VENCE' : 'VENCIDA') + '</div>' +
        '<div class="props__when">' + (sa.restante > 0 ? 'en ' + fmt.duracion(sa.restante) : 'hace ' + fmt.duracion(-sa.restante)) + ' · meta 5 min desde la recepción</div>';
    } else {
      linea = '<div class="due-line due-line--info">' + ico('loader', 14) + 'EN RECUPERACIÓN</div><div class="props__when">Primera acción a los ' + fmt.duracion(inc.actuadaEnS - inc.recibidaEnS) + '</div>';
    }
    return '<div class="props__big">' + x + '</div>' + linea + '<div class="props__sla">' + sa.html + c.slaRecuperacion(inc, e.ahoraS) + '</div>';
  }

  function lado(e, inc, abiertos) {
    var html = '';
    if (inc.puntoId) {
      var p = e.puntosPorId[inc.puntoId];
      var v = d.estadoVisible(p, e.evento, e.coordinador, e.ahoraS);
      var l = p.lectores[0];
      html += acc('punto', 'Puerta afectada', abiertos,
        '<a class="entity" href="#/puertas/' + p.id + '">' + '<span class="bubble bubble--' + d.ESTADO_PUNTO[v].tono + '">' + ico('door-open', 18) + '</span>' +
        '<span><b>' + esc(p.nombre) + '</b><small>' + p.id + ' · zona ' + esc(p.zona) + '</small></span></a>' +
        '<dl class="kv" style="margin-top:12px"><dt>Estado</dt><dd>' + c.estadoPunto(v) + '</dd>' +
        '<dt>Lector</dt><dd class="mono">' + esc(l.id) + '</dd>' +
        '<dt>Credencial</dt><dd class="mono">' + esc(l.credencial) + '</dd>' +
        '<dt>Último reporte</dt><dd>' + fmt.hace(e.ahoraS - p.ultimaComunicacionS) + '</dd>' +
        '<dt>En diario</dt><dd class="num">' + fmt.entero(p.pendientesDiario) + '</dd></dl>' +
        '<a class="btn btn--soft btn--sm btn--block" style="margin-top:12px" href="#/puertas/' + p.id + '">Ver la puerta' + ico('arrow-right', 14) + '</a>');
    } else {
      html += acc('punto', 'Componente', abiertos, componente(e, inc));
    }

    var filas = [['Recibido', fmt.hora(inc.recibidaEnS, true)],
      ['Primera acción', inc.actuadaEnS !== null ? fmt.hora(inc.actuadaEnS, true) + ' · ' + fmt.duracion(inc.actuadaEnS - inc.recibidaEnS) : '—'],
      ['Recuperado', inc.recuperadaEnS !== null ? fmt.hora(inc.recuperadaEnS, true) + ' · ' + fmt.duracion(inc.recuperadaEnS - inc.recibidaEnS) : '—'],
      ['Cerrado', inc.resueltaEnS !== null ? fmt.hora(inc.resueltaEnS, true) : '—']];
    html += acc('tiempos', 'Registro de tiempos', abiertos,
      '<dl class="kv">' + filas.map(function (f) { return '<dt>' + f[0] + '</dt><dd class="mono">' + f[1] + '</dd>'; }).join('') + '</dl>' +
      '<p class="dim" style="font-size:12px;margin-top:10px">Los tiempos se miden desde la recepción y sirven de evidencia para KR1.3, KR2.1 y KR2.2.</p>');

    var hechos = inc.checklist.filter(function (x) { return x.hecho; }).length;
    html += acc('lista', 'Pasos a seguir · ' + hechos + '/' + inc.checklist.length, abiertos,
      inc.checklist.map(function (x, i) {
        return '<button type="button" class="check" role="checkbox" aria-checked="' + x.hecho + '" data-accion="check" data-arg="' + i + '"' + (c.abierto(inc) ? '' : ' disabled') + '>' +
          '<span class="check__box">' + (x.hecho ? ico('check', 13) : '') + '</span><span class="check__txt">' + esc(x.texto) + '</span></button>';
      }).join('') || '<p class="dim">Sin pasos definidos.</p>');

    var rel = e.incidentes.filter(function (x) {
      return x !== inc && ((inc.puntoId && x.puntoId === inc.puntoId) || x.tipo === inc.tipo);
    }).slice(0, 4);
    html += acc('rel', 'Relacionados · ' + rel.length, abiertos,
      rel.length ? rel.map(function (x) {
        return '<a class="relrow" href="#/incidentes/' + x.id + '">' + ico('ticket', 14) + '<span><b>' + esc(x.titulo) + '</b><small>' + x.id + ' · ' + esc({ 'nuevo': 'Nuevo', 'en-curso': 'En curso', 'resuelto': 'Resuelto', 'descartado': 'Falsa alarma' }[x.estado]) + '</small></span></a>';
      }).join('') : '<p class="dim">No hay incidentes relacionados.</p>');
    return html;
  }

  function componente(e, inc) {
    var co = e.coordinador;
    if (inc.tipo === d.TipoIncidente.COORDINADOR) {
      return '<dl class="kv"><dt>Topología</dt><dd>Candidata B</dd><dt>Primario</dt><dd class="mono">' + esc(co.primario) + '</dd>' +
        '<dt>Réplica síncrona</dt><dd class="mono">' + esc(co.replica) + '</dd><dt>Excluidos</dt><dd class="mono">' + esc(co.excluidos.join(', ') || '—') + '</dd>' +
        '<dt>Estado</dt><dd>' + (co.estado === d.EstadoCoordinador.OPERANDO ? c.badge('Operando', 'ok') : c.badge('Sin autoridad', 'no')) + '</dd></dl>' +
        '<p class="dim" style="font-size:12px;margin-top:10px">Se comparan tres topologías durante el piloto; ninguna promueve una copia que pueda carecer de consumos (ADR-005, ADR-012).</p>';
    }
    if (inc.tipo === d.TipoIncidente.ENLACE_NUBE) {
      return '<dl class="kv"><dt>Enlace</dt><dd>' + (e.nube.enLinea ? c.badge('En línea', 'ok') : c.badge('Caído', 'no')) + '</dd>' +
        '<dt>Buzón</dt><dd class="num">' + fmt.entero(e.nube.buzon) + '</dd><dt>Entrega</dt><dd>Al menos una vez</dd><dt>Duplicados</dt><dd>Idempotente</dd></dl>' +
        '<p class="dim" style="font-size:12px;margin-top:10px">La nube confirma la recepción de evidencia; nunca concede otro uso de una boleta (ADR-011).</p>';
    }
    if (inc.tipo === d.TipoIncidente.PERMISOS) {
      return '<dl class="kv"><dt>Versión</dt><dd class="mono">v' + e.evento.versionPermisos + '</dd>' +
        '<dt>Antigüedad</dt><dd>' + fmt.duracion(e.ahoraS - e.evento.ultimoCambioRecibidoS) + '</dd>' +
        '<dt>Tolerable</dt><dd>5 min</dd><dt>Reingresos</dt><dd>' + (e.evento.politicas.reingresoSuspendido ? c.badge('Suspendidos', 'warn') : c.badge('Permitidos', 'ok')) + '</dd>' +
        '<dt>En camino</dt><dd class="num">' + e.integracion.enTransito.length + '</dd></dl>';
    }
    return '<p class="soft">' + esc(inc.componente) + '</p>';
  }

  function acc(k, titulo, abiertos, cuerpo) {
    return '<details class="acc" data-acc="' + k + '"' + (abiertos[k] ? ' open' : '') + '><summary>' + esc(titulo) + ico('chevron-down', 16, 'chev') + '</summary><div class="acc__body">' + cuerpo + '</div></details>';
  }

  return { id: 'incidente', montar: montar };
})();

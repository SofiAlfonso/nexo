/* ============================================================
   vistas/alertas.js — Bandeja de incidentes

   Estilo mesa de ayuda: contadores de color que filtran, tarjetas
   con responsable y plazo, y a la derecha las decisiones que
   esperan a alguien. Aquí se mide KR1.3: el reloj corre desde la
   RECEPCIÓN, no desde que alguien abre el incidente.
   ============================================================ */

NEXO.vistas.alertas = (function () {
  'use strict';

  var u = NEXO.util, esc = u.esc, ico = u.icono, fmt = u.fmt;
  var d = NEXO.dominio;
  var c;

  // Filtros de la bandeja: sobreviven a la navegación dentro de la sesión.
  var filtro = { grupo: 'abiertos', texto: '', tipo: '', orden: 'prioridad', vista: 'tarjetas' };

  function montar(cont) {
    c = NEXO.vistas.comunes;
    var raiz = document.createElement('div');
    raiz.className = 'page';
    raiz.innerHTML =
      c.cabecera({
        kicker: 'Mesa de incidentes', icono: 'siren',
        titulo: 'Incidentes',
        texto: 'Cada falla del evento se convierte en un incidente con responsable y plazo. La primera acción debe llegar en menos de 5 minutos desde que se recibe.',
        acciones: '<span data-slot="kr"></span>'
      }) +
      '<div class="grid grid--main-side">' +
        '<section class="card inbox">' +
          '<div class="tiles" data-slot="tiles" role="tablist" aria-label="Filtrar incidentes"></div>' +
          '<div class="inbox__bar">' +
            '<div class="inputwrap" style="flex:1;min-width:200px">' + ico('search', 16) +
              '<input class="input input--search" type="search" placeholder="Buscar por título, puerta o código INC" data-campo="texto" value="' + esc(filtro.texto) + '"></div>' +
            '<select class="select" style="width:auto" data-campo="tipo" aria-label="Tipo">' +
              '<option value="">Todos los tipos</option>' +
              Object.keys(d.TipoIncidente).map(function (k) {
                var t = d.TipoIncidente[k];
                return '<option' + (filtro.tipo === t ? ' selected' : '') + '>' + esc(t) + '</option>';
              }).join('') + '</select>' +
            '<select class="select" style="width:auto" data-campo="orden" aria-label="Orden">' +
              opcion('prioridad', 'Prioridad') + opcion('recientes', 'Más recientes') + opcion('vence', 'Vence antes') + '</select>' +
            '<div class="seg" data-slot="vista"></div>' +
          '</div>' +
          '<div data-slot="lista"></div>' +
        '</section>' +
        '<aside class="card side">' +
          '<div class="side__sec"><div class="side__head" data-slot="accHead"></div><div class="side__list" data-slot="acciones"></div></div>' +
          '<div class="side__sec"><div class="side__head" data-slot="venHead"></div><div class="side__list" data-slot="vencen"></div></div>' +
          '<div class="side__sec"><div class="side__head">' + cuadro('', 'history', 'mute') +
            '<div><b>Decisiones recientes</b><small>Quedan en la bitácora; no se editan</small></div></div><div class="side__list" data-slot="historial"></div></div>' +
        '</aside>' +
      '</div>';
    cont.appendChild(raiz);
    var s = u.ranuras(raiz);
    var ultimo = null;

    raiz.addEventListener('input', function (ev) {
      var campo = ev.target.getAttribute('data-campo');
      if (!campo) return;
      filtro[campo] = ev.target.value;
      if (ultimo) pintarLista(ultimo);
    });

    c.delegar(raiz, {
      grupo: function (g) { filtro.grupo = g; pintar(ultimo); },
      vista: function (v) { filtro.vista = v; pintar(ultimo); },
      destacar: function (id, n, ev) { ev.stopPropagation(); NEXO.api.destacar(id); },
      abrir: function (id) { NEXO.router.ir('#/incidentes/' + id); },
      aprobar: function (id) { NEXO.api.decidirAccion(id, true); },
      rechazar: function (id) { NEXO.api.decidirAccion(id, false); }
    });

    function pintarLista(e) { u.ranura(s.lista, lista(e)); }

    function pintar(e) {
      if (!e) return;
      ultimo = e;
      var m = medicion(e);
      u.ranura(s.kr, '<div class="krbox">' + ico('gauge', 16) + '<span>Actuación en &lt; 5 min</span><b class="num">' +
        (m.total ? fmt.pct(m.pct, 0) : '—') + '</b>' + c.tip('Incidentes con primera acción o decisión en menos de 5 minutos desde que se recibieron, sobre todos los recibidos. Sin casos suficientes no se declara cumplido.', 'KR1.3 · meta 80 % · aspiracional', true) + '</div>');
      u.ranura(s.tiles, tiles(e));
      u.ranura(s.vista, ['tarjetas', 'lista'].map(function (v) {
        return '<button type="button" data-accion="vista" data-arg="' + v + '" aria-pressed="' + (filtro.vista === v) + '" title="' + (v === 'tarjetas' ? 'Tarjetas' : 'Lista') + '">' + ico(v === 'tarjetas' ? 'layout-grid' : 'list', 15) + '</button>';
      }).join(''));
      pintarLista(e);
      var pend = e.acciones.filter(function (a) { return a.estado === 'pendiente'; });
      u.ranura(s.accHead, cuadro(pend.length, pend.length ? 'hand' : 'check', pend.length ? 'red' : 'gray') +
        '<div><b>Acciones pendientes</b><small>Aprobar, rechazar o posponer</small></div>');
      u.ranura(s.acciones, acciones(e, pend));
      var ven = vencimientos(e);
      u.ranura(s.venHead, cuadro(ven.length, 'calendar-clock', ven.length ? 'blue' : 'gray') + '<div><b>Por vencer</b><small>Próximos plazos del evento</small></div>');
      u.ranura(s.vencen, ven.length ? ven.map(function (v) {
        return '<a class="due" href="' + v.enlace + '">' + ico('calendar-clock', 16, v.tono + '-t') + '<span><b>' + esc(v.titulo) + '</b> ' + esc(v.texto) + '</span><time class="' + v.tono + '-t">' + esc(v.plazo) + '</time></a>';
      }).join('') : '<p class="dim side__empty">Ningún plazo abierto.</p>');
      u.ranura(s.historial, historial(e));
    }

    return { actualizar: pintar, desmontar: function () {} };
  }

  function opcion(v, t) { return '<option value="' + v + '"' + (filtro.orden === v ? ' selected' : '') + '>' + t + '</option>'; }

  function cuadro(n, icono, color) {
    return '<span class="sq sq--' + color + '">' + (n === '' || n === 0 && icono ? ico(icono, 18) : n) + '</span>';
  }

  // ---------- medición KR1.3 ----------

  function medicion(e) {
    // Cuentan los que ya actuaron o cuyo plazo venció; los que siguen
    // dentro de plazo todavía no son ni éxito ni fracaso.
    var total = e.incidentes.filter(function (x) {
      return x.actuadaEnS !== null || e.ahoraS - x.recibidaEnS >= d.Umbral.ACTUACION_S;
    }).length;
    var enMeta = e.incidentes.filter(function (x) {
      return x.actuadaEnS !== null && x.actuadaEnS - x.recibidaEnS < d.Umbral.ACTUACION_S;
    }).length;
    return { total: total, pct: total ? enMeta / total * 100 : 0 };
  }

  // ---------- contadores ----------

  function grupos(e) {
    var ahora = e.ahoraS;
    return [
      { id: 'abiertos', txt: 'Abiertos', color: 'red', f: c.abierto },
      { id: 'mios', txt: 'Asignados a mí', color: 'orange', f: function (x) { return c.abierto(x) && x.responsable === e.rol; } },
      { id: 'vencen', txt: 'Por vencer', color: 'blue', f: function (x) { return c.abierto(x) && x.actuadaEnS === null && d.Umbral.ACTUACION_S - (ahora - x.recibidaEnS) < 120; } },
      { id: 'destacados', txt: 'Destacados', color: 'gold', f: function (x) { return x.destacado; } },
      { id: 'resueltos', txt: 'Resueltos', color: 'violet', f: function (x) { return x.estado === 'resuelto'; }, check: true },
      { id: 'todos', txt: 'Todos', color: 'gray', f: function () { return true; }, check: true }
    ];
  }

  function tiles(e) {
    return grupos(e).map(function (g) {
      var n = e.incidentes.filter(g.f).length;
      var sel = filtro.grupo === g.id;
      return '<button type="button" class="tile' + (n ? '' : ' tile--zero') + '" role="tab" aria-selected="' + sel + '" data-accion="grupo" data-arg="' + g.id + '" style="--tc:var(--t-' + g.color + ')">' +
        '<span class="tile__num">' + (n === 0 && g.check ? ico('check', 20) : n) + '</span><span class="tile__lbl">' + esc(g.txt) + '</span></button>';
    }).join('');
  }

  // ---------- lista ----------

  function filtrados(e) {
    var g = grupos(e).filter(function (x) { return x.id === filtro.grupo; })[0] || grupos(e)[0];
    var q = filtro.texto.trim().toLowerCase();
    var lista = e.incidentes.filter(g.f).filter(function (x) {
      if (filtro.tipo && x.tipo !== filtro.tipo && x.clasificacion !== filtro.tipo) return false;
      if (!q) return true;
      return (x.titulo + ' ' + x.id + ' ' + x.componente + ' ' + (x.zona || '')).toLowerCase().indexOf(q) !== -1;
    });
    var ahora = e.ahoraS;
    lista.sort(function (a, b) {
      if (filtro.orden === 'recientes') return b.recibidaEnS - a.recibidaEnS;
      if (filtro.orden === 'vence') return restante(a, ahora) - restante(b, ahora);
      var ab = c.abierto(a) ? 0 : 1, bb = c.abierto(b) ? 0 : 1;
      return ab - bb || a.prioridad.orden - b.prioridad.orden || b.recibidaEnS - a.recibidaEnS;
    });
    return lista;
  }

  function restante(x, ahora) {
    if (x.actuadaEnS !== null || !c.abierto(x)) return 1e9;
    return d.Umbral.ACTUACION_S - (ahora - x.recibidaEnS);
  }

  function lista(e) {
    var items = filtrados(e);
    if (!items.length) {
      if (!e.incidentes.length) {
        return c.vacio('shield-check', 'Sin incidentes', e.evento.estado === 'abierto'
          ? 'Todo opera con normalidad. Usa «Ir a los incidentes» en la simulación para ver cómo se gestiona una falla.'
          : 'El ingreso todavía no ha empezado. Los incidentes aparecerán aquí con su plazo y responsable.');
      }
      return c.vacio('filter', 'Nada con estos filtros', 'Prueba con otro contador o borra la búsqueda.');
    }
    if (filtro.vista === 'lista') return tabla(e, items);
    return '<div class="tcards">' + items.map(function (x) { return tarjeta(e, x); }).join('') + '</div>';
  }

  function tarjeta(e, x) {
    var t = c.tipoInc(x);
    var lugar = x.puntoId ? esc(x.zona) + ' ' + ico('chevron-right', 12) + ' ' + esc(x.puntoId) : esc(x.componente);
    var mio = x.responsable === e.rol;
    return '<article class="tcard' + (c.abierto(x) ? '' : ' tcard--closed') + '" data-accion="abrir" data-arg="' + x.id + '" tabindex="0" role="link" aria-label="' + esc(x.titulo) + '">' +
      '<div class="tcard__top"><span class="tag tag--' + t.tag + '">' + ico(t.icono, 12) + esc(t.corto) + '</span>' +
        '<span class="prio prio--' + x.prioridad.id + '">' + esc(x.prioridad.nombre) + '</span><span class="spacer"></span>' +
        c.estadoInc(x) +
        '<button type="button" class="star' + (x.destacado ? ' star--on' : '') + '" data-accion="destacar" data-arg="' + x.id + '" aria-label="Destacar">' + ico('star', 15) + '</button></div>' +
      '<h3 class="tcard__title">' + esc(x.titulo) + '</h3>' +
      '<div class="tcard__where">' + ico(x.puntoId ? 'door-open' : 'workflow', 14) + '<span>' + lugar + '</span>' +
        '<span class="tcard__ago">' + ico('clock', 12) + fmt.hace(e.ahoraS - x.recibidaEnS) + '</span></div>' +
      '<div class="tcard__sla">' + c.slaActuacion(x, e.ahoraS).html + c.slaRecuperacion(x, e.ahoraS) + '</div>' +
      '<div class="tcard__foot">' + c.avatar(x.responsable, true) + '<div class="tcard__who"><b>' + esc(x.responsable) + '</b><small>' + (mio ? 'Asignado a ti' : 'Responsable') + '</small></div>' +
        '<span class="idchip">' + x.id + '</span></div>' +
      '</article>';
  }

  function tabla(e, items) {
    return '<div class="tablewrap"><table class="table table--hover"><thead><tr><th>Código</th><th>Incidente</th><th>Prioridad</th><th>Estado</th><th>Responsable</th><th>Actuación</th><th>Recibido</th></tr></thead><tbody>' +
      items.map(function (x) {
        var t = c.tipoInc(x), s = c.slaActuacion(x, e.ahoraS);
        return '<tr data-accion="abrir" data-arg="' + x.id + '"><td class="mono">' + x.id + '</td>' +
          '<td style="min-width:260px"><div class="row"><span class="tag tag--' + t.tag + '">' + ico(t.icono, 12) + '</span><b>' + esc(x.titulo) + '</b></div></td>' +
          '<td class="nowrap"><span class="prio-dot prio-dot--' + x.prioridad.id + '"></span>' + esc(x.prioridad.nombre) + '</td>' +
          '<td>' + c.estadoInc(x) + '</td>' +
          '<td><div class="row">' + c.avatar(x.responsable) + '<span class="nowrap">' + esc(x.responsable) + '</span></div></td>' +
          '<td style="min-width:150px">' + s.html + '</td>' +
          '<td class="mono dim nowrap">' + fmt.hora(x.recibidaEnS, true) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  // ---------- panel lateral ----------

  function acciones(e, pend) {
    if (!pend.length) return '<p class="dim side__empty">Nada espera tu decisión. Cuando una falla necesite aprobación aparecerá aquí.</p>';
    return pend.map(function (a) {
      return '<div class="act' + (a.decisiva ? ' act--hot' : '') + '"><div class="act__top"><b>' + esc(a.titulo) + '</b></div>' +
        '<p class="act__txt">' + esc(a.detalle) + '</p>' +
        '<div class="act__btns">' +
          (a.no ? '<button type="button" class="btn btn--sm" data-accion="rechazar" data-arg="' + a.id + '">' + ico('x', 14, 'no-t') + esc(a.no) + '</button>' : '') +
          '<button type="button" class="btn btn--sm btn--ok" data-accion="aprobar" data-arg="' + a.id + '">' + ico('check', 14) + esc(a.si) + '</button></div>' +
        '<div class="act__meta">' + ico('user-round', 13) + '<span>' + esc(a.rol) + (a.incidenteId ? ' · <a href="#/incidentes/' + a.incidenteId + '">' + a.incidenteId + '</a>' : '') + '</span>' +
          '<span class="spacer"></span><span>' + fmt.hace(e.ahoraS - a.creadaEnS) + '</span></div>' +
        '</div>';
    }).join('');
  }

  function vencimientos(e) {
    var out = [];
    e.incidentes.forEach(function (x) {
      if (!c.abierto(x) || x.actuadaEnS !== null) return;
      var r = d.Umbral.ACTUACION_S - (e.ahoraS - x.recibidaEnS);
      out.push({ orden: r, titulo: 'Actuación', texto: 'en «' + x.titulo + '»', plazo: fmt.plazo(r), tono: r < 60 ? 'no' : r < 120 ? 'warn' : 'soft', enlace: '#/incidentes/' + x.id });
    });
    e.incidentes.forEach(function (x) {
      if (!c.abierto(x) || !x.metaRecuperacionS || x.recuperadaEnS !== null || x.relojDesdeS === null) return;
      var r = x.metaRecuperacionS - (e.ahoraS - x.relojDesdeS);
      out.push({ orden: r + 1, titulo: x.tipo === d.TipoIncidente.LECTOR_AVERIADO ? 'Recuperación' : 'Sincronización', texto: 'de ' + (x.puntoId || x.componente), plazo: fmt.plazo(r), tono: r < 60 ? 'no' : 'soft', enlace: '#/incidentes/' + x.id });
    });
    var cn = e.conciliacion;
    if (e.evento.estado === 'cerrado' && cn.preliminarEnS === null) {
      var r = e.evento.cierreS + d.Umbral.PRELIMINAR_S - e.ahoraS;
      out.push({ orden: r, titulo: 'Informe preliminar', texto: 'del cierre', plazo: fmt.plazo(r), tono: r < 300 ? 'no' : 'soft', enlace: '#/cierre' });
    }
    if (e.evento.estado === 'cerrado' && cn.estado !== 'conciliado') {
      var r2 = e.evento.cierreS + d.Umbral.DEFINITIVO_S - e.ahoraS;
      out.push({ orden: r2, titulo: 'Cierre definitivo', texto: 'conciliado', plazo: fmt.plazo(r2), tono: 'soft', enlace: '#/cierre' });
    }
    if (e.evento.estado === 'preparacion') {
      var r3 = e.evento.aperturaS - e.ahoraS;
      out.push({ orden: r3, titulo: 'Apertura', texto: 'de la ventana de ingreso', plazo: fmt.plazo(r3), tono: 'soft', enlace: '#/preparacion' });
    }
    return out.sort(function (a, b) { return a.orden - b.orden; }).slice(0, 5);
  }

  function historial(e) {
    var hechas = e.acciones.filter(function (a) { return a.estado !== 'pendiente'; }).slice(0, 5);
    if (!hechas.length) return '<p class="dim side__empty">Aún no hay decisiones.</p>';
    return hechas.map(function (a) {
      var tono = a.estado === 'aprobada' ? 'ok' : a.estado === 'rechazada' ? 'no' : 'mute';
      var txt = a.estado === 'aprobada' ? 'Aprobada' : a.estado === 'rechazada' ? 'Rechazada' : 'Caducada';
      return '<div class="hist">' + c.avatar(a.autor || 'Sistema') + '<div><b>' + esc(a.titulo) + '</b><small>' + txt + (a.autor ? ' por ' + esc(a.autor) : '') +
        (a.decididaEnS ? ' · ' + fmt.hora(a.decididaEnS, true) : '') + '</small></div>' + c.badge(txt, tono, 'badge--sm') + '</div>';
    }).join('');
  }

  return { id: 'alertas', montar: montar };
})();

/* ============================================================
   app.js — arranque y armazón

   Une las piezas: exige sesión (ADR-016), crea el estado, construye
   el riel y la barra superior, registra las rutas y monta la vista
   que corresponde. Ninguna vista sabe de las otras.
   ============================================================ */

(function () {
  'use strict';

  var u = NEXO.util, esc = u.esc, ico = u.icono, fmt = u.fmt;
  var d = NEXO.dominio;

  var NAV = [
    { id: 'pmu', hash: '#/inicio', texto: 'Resumen', icono: 'layout-dashboard', seccion: 'Operación' },
    { id: 'alertas', hash: '#/incidentes', texto: 'Incidentes', icono: 'siren', seccion: 'Operación', cuenta: 'incidentes', tambien: ['incidente'] },
    { id: 'punto', hash: '#/puertas', texto: 'Puertas', icono: 'door-open', seccion: 'Operación' },
    { id: 'lector', hash: '#/lector', texto: 'Lector', icono: 'scan-line', seccion: 'Operación' },
    { id: 'cierre', hash: '#/cierre', texto: 'Cierre', icono: 'file-check-2', seccion: 'Después del evento', cuenta: 'diferencias' },
    { sep: true },
    { id: 'config', hash: '#/preparacion', texto: 'Preparación', icono: 'clipboard-check', seccion: 'Antes del evento', cuenta: 'controles' }
  ];

  var vista = null, vistaId = null, params = {};
  var refs = {};

  // ==========================================================
  //  armazón
  // ==========================================================

  function construir() {
    var app = document.createElement('div');
    app.className = 'app';
    app.innerHTML =
      '<nav class="rail" aria-label="Secciones">' +
        '<a class="rail__logo" href="#/inicio" title="NEXO · inicio">NE<span>X</span>O</a>' +
        NAV.map(function (n) {
          if (n.sep) return '<div class="rail__sep"></div>';
          return '<a class="rail__item" href="' + n.hash + '" data-nav="' + n.id + '">' + ico(n.icono, 22) + '<span>' + n.texto + '</span>' +
            (n.cuenta ? '<b class="rail__count" data-cuenta="' + n.cuenta + '"></b>' : '') + '</a>';
        }).join('') +
        '<div class="rail__grow"></div>' +
        '<button type="button" class="rail__item" data-app="ayuda">' + ico('circle-help', 22) + '<span>Ayuda</span></button>' +
        '<button type="button" class="rail__item" data-app="tema">' + '<span data-ref="temaIco"></span><span>Tema</span></button>' +
      '</nav>' +
      '<header class="topbar">' +
        '<div class="crumbs" data-ref="crumbs"></div>' +
        '<div class="search">' + ico('search', 16) +
          '<input type="search" placeholder="Buscar puerta o incidente…" title="Ejemplos: P-07, INC-0001. Atajo: /" data-ref="buscar" aria-label="Buscar" autocomplete="off">' +
          '<div class="search__results" data-ref="resultados" role="listbox"></div></div>' +
        '<div class="evchip" title="Evento en curso"><span data-ref="evDot"></span><div class="evchip__txt"><b data-ref="evNombre"></b><small data-ref="evSub"></small></div><span class="clock" data-ref="reloj"></span></div>' +
        '<a class="iconbtn" href="#/incidentes" title="Incidentes abiertos" aria-label="Incidentes abiertos">' + ico('bell', 20) + '<b class="iconbtn__dot" data-ref="campana"></b></a>' +
        '<div class="who who--sesion">' +
          '<span data-ref="avatar"></span>' +
          '<span class="who__nombre"><b data-ref="opNombre"></b><small data-ref="opRol"></small></span>' +
          '<button type="button" class="iconbtn" data-app="salir" title="Cerrar sesión" aria-label="Cerrar sesión">' + ico('log-out', 18) + '</button>' +
        '</div>' +
      '</header>' +
      '<main class="main" id="contenido" tabindex="-1"></main>';
    document.body.appendChild(app);

    var toasts = document.createElement('div');
    toasts.className = 'toasts';
    toasts.setAttribute('aria-live', 'polite');
    document.body.appendChild(toasts);

    app.querySelectorAll('[data-ref]').forEach(function (n) { refs[n.getAttribute('data-ref')] = n; });
    refs.app = app; refs.toasts = toasts;
    refs.nav = {};
    app.querySelectorAll('[data-nav]').forEach(function (n) { refs.nav[n.getAttribute('data-nav')] = n; });

    document.addEventListener('click', alClic);
    refs.buscar.addEventListener('input', buscar);
    refs.buscar.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { var h = refs.resultados.querySelector('[data-ir]'); if (h) h.click(); }
      if (ev.key === 'Escape') { refs.buscar.value = ''; u.ranura(refs.resultados, ''); }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        ev.preventDefault(); refs.buscar.focus();
      }
    });
  }

  function alClic(ev) {
    var n = ev.target.closest('[data-app]');
    if (!n) {
      if (!ev.target.closest('.search')) u.ranura(refs.resultados, '');
      return;
    }
    var a = n.getAttribute('data-app'), arg = n.getAttribute('data-arg');
    if (a === 'ayuda') NEXO.vistas.ayuda.abrir('inicio');
    else if (a === 'tema') alternarTema();
    else if (a === 'salir') cerrarSesion();
    else if (a === 'irA') {
      refs.buscar.value = '';
      u.ranura(refs.resultados, '');
      NEXO.router.ir(arg);
    }
  }

  // ==========================================================
  //  búsqueda global (puertas e incidentes: sin boletas, sin backend de listado)
  // ==========================================================

  function buscar() {
    var q = refs.buscar.value.trim().toLowerCase();
    if (q.length < 2) { u.ranura(refs.resultados, ''); return; }
    var e = NEXO.store.get(), hits = [];
    e.puntos.forEach(function (p) {
      if ((p.id + ' ' + p.nombre + ' ' + p.zona).toLowerCase().indexOf(q) !== -1) {
        hits.push({ ico: 'door-open', t: p.id + ' · ' + p.nombre, s: d.ESTADO_PUNTO[d.estadoVisible(p, e.evento, e.coordinador, e.ahoraS)].texto, h: '#/puertas/' + p.id });
      }
    });
    e.incidentes.forEach(function (x) {
      if ((x.id + ' ' + x.titulo).toLowerCase().indexOf(q) !== -1) hits.push({ ico: 'siren', t: x.id + ' · ' + x.titulo, s: x.prioridad.nombre + ' · ' + x.responsable, h: '#/incidentes/' + x.id });
    });
    u.ranura(refs.resultados, hits.slice(0, 7).map(function (h) {
      return '<button type="button" class="search__hit" data-app="irA" data-arg="' + h.h + '" data-ir>' + ico(h.ico, 16) +
        '<span><b>' + esc(h.t) + '</b><small>' + esc(h.s) + '</small></span></button>';
    }).join('') || '<div class="search__hit dim">Sin resultados para «' + esc(q) + '»</div>');
  }

  // ==========================================================
  //  tema
  // ==========================================================

  function temaActual() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function alternarTema() {
    var nuevo = temaActual() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nuevo);
    u.prefs.guardar('tema', nuevo);
    pintarArmazon(NEXO.store.get());
  }

  // ==========================================================
  //  sesión
  // ==========================================================

  function cerrarSesion() {
    NEXO.api.logout().then(reiniciarInicio, reiniciarInicio);
  }

  /** Vuelve a la pantalla de acceso sin recargar el documento. */
  function reiniciarInicio() { location.hash = ''; location.reload(); }

  // ==========================================================
  //  actualización del armazón
  // ==========================================================

  var MIGAS = {
    pmu: ['Operación', 'Resumen del evento'],
    alertas: ['Operación', 'Incidentes'],
    punto: ['Operación', 'Puertas'],
    lector: ['Operación', 'Lector en puerta'],
    cierre: ['Después del evento', 'Cierre y liquidación'],
    config: ['Antes del evento', 'Preparación y apertura']
  };

  var ESTADO_EVENTO_TXT = {
    preparacion: ['en preparación', 'info'],
    abierto: ['ingreso abierto', 'ok'],
    cerrado: ['ventana cerrada', 'violet']
  };

  function pintarArmazon(e) {
    var ev = e.evento;
    if (!ev) return; // aún cargando: la vista muestra su propio estado vacío
    var abiertos = e.incidentes.filter(function (x) { return x.estado === 'nuevo' || x.estado === 'en-curso'; }).length;
    var difs = e.conciliacion.diferencias.filter(function (x) { return x.estado === 'abierta'; }).length;
    var ctl = e.preparacion.controles.filter(function (x) { return !x.ok; }).length;
    var cuentas = { incidentes: abiertos || '', diferencias: difs || '', controles: ev.estado === 'preparacion' && ctl ? ctl : '' };
    refs.app.querySelectorAll('[data-cuenta]').forEach(function (n) { u.ranura(n, String(cuentas[n.getAttribute('data-cuenta')])); });
    u.ranura(refs.campana, abiertos ? String(abiertos) : '');

    var migas;
    if (vistaId === 'incidente') migas = '<a href="#/incidentes">Incidentes</a>' + ico('chevron-right', 14) + '<b>' + esc(params.id) + '</b>';
    else if (vistaId === 'punto') migas = '<a href="#/inicio">Operación</a>' + ico('chevron-right', 14) + '<b>Puertas · ' + esc(params.id || '') + '</b>';
    else { var m = MIGAS[vistaId] || MIGAS.pmu; migas = '<span class="dim">' + m[0] + '</span>' + ico('chevron-right', 14) + '<b>' + m[1] + '</b>'; }
    u.ranura(refs.crumbs, migas);

    u.ranura(refs.evNombre, esc(ev.recinto));
    var est = ESTADO_EVENTO_TXT[ev.estado] || ESTADO_EVENTO_TXT.preparacion;
    u.ranura(refs.evSub, esc(ev.nombreCorto) + ' · ' + est[0]);
    u.ranura(refs.evDot, '<i class="dot dot--' + est[1] + (ev.estado === 'abierto' ? ' dot--pulse' : '') + '"></i>');
    u.ranura(refs.reloj, fmt.hora(e.ahoraS, true));

    u.ranura(refs.avatar, NEXO.vistas.comunes.avatar(e.rol));
    if (e.operador) { u.ranura(refs.opNombre, esc(e.operador.nombre)); u.ranura(refs.opRol, esc(e.rol)); }
    u.ranura(refs.temaIco, ico(temaActual() === 'dark' ? 'sun' : 'moon', 22));

    Object.keys(refs.nav).forEach(function (id) {
      var n = NAV.filter(function (x) { return x.id === id; })[0];
      var activo = id === vistaId || (n.tambien && n.tambien.indexOf(vistaId) !== -1);
      if (activo) refs.nav[id].setAttribute('aria-current', 'page'); else refs.nav[id].removeAttribute('aria-current');
    });
  }

  // ==========================================================
  //  notificaciones
  // ==========================================================

  var ICONO_TONO = { ok: 'circle-check', no: 'circle-alert', warn: 'triangle-alert', info: 'info', violet: 'hand' };

  function notificar(a) {
    var t = document.createElement('div');
    t.className = 'toast';
    t.setAttribute('role', 'status');
    t.innerHTML = '<span class="toast__ico bubble--' + (a.tono || 'info') + '">' + ico(ICONO_TONO[a.tono] || 'info', 18) + '</span>' +
      '<div><b>' + esc(a.titulo) + '</b><p>' + esc(a.texto || '') + '</p>' +
      (a.enlace ? '<a href="' + a.enlace + '">Ver ' + ico('arrow-right', 13) + '</a>' : '') + '</div>' +
      '<button type="button" class="toast__x" aria-label="Cerrar">' + ico('x', 16) + '</button>';
    t.querySelector('.toast__x').addEventListener('click', function () { quitar(t); });
    t.addEventListener('click', function (ev) { if (ev.target.closest('a')) quitar(t); });
    refs.toasts.insertBefore(t, refs.toasts.firstChild);
    while (refs.toasts.children.length > 3) refs.toasts.removeChild(refs.toasts.lastChild);
    setTimeout(function () { quitar(t); }, a.tono === 'violet' ? 9000 : 6000);
  }

  function quitar(t) { if (t.parentNode) t.parentNode.removeChild(t); }

  // ==========================================================
  //  enrutado y montaje
  // ==========================================================

  var VISTAS = { pmu: 'pmu', alertas: 'alertas', incidente: 'incidente', punto: 'punto', lector: 'lector', cierre: 'cierre', config: 'config' };

  function alCambiarRuta(ruta) {
    if (vista && vista.desmontar) vista.desmontar();
    var cont = document.getElementById('contenido');
    cont.innerHTML = '';
    cont.scrollTop = 0;
    vistaId = ruta.vistaId;
    params = ruta.params;
    var modulo = NEXO.vistas[VISTAS[vistaId]];
    vista = modulo.montar(cont, params);
    var e = NEXO.store.get();
    vista.actualizar(e);
    pintarArmazon(e);
    var t = { pmu: 'Resumen', alertas: 'Incidentes', incidente: params.id, punto: 'Puertas', lector: 'Lector', cierre: 'Cierre', config: 'Preparación' }[vistaId];
    document.title = t + ' · NEXO';
  }

  /** Tras el login (o la sesión reanudada): arma la interfaz y arranca la carga real. */
  function arrancarConSesion() {
    construir();

    NEXO.store.suscribir(function (e) {
      if (vista) vista.actualizar(e);
      pintarArmazon(e);
    });
    NEXO.store.alAvisar(notificar);

    var R = NEXO.router;
    R.registrar('#/inicio', 'pmu');
    R.registrar('#/incidentes', 'alertas');
    R.registrar('#/incidentes/:id', 'incidente');
    R.registrar('#/puertas', 'punto');
    R.registrar('#/puertas/:id', 'punto');
    R.registrar('#/lector', 'lector');
    R.registrar('#/cierre', 'cierre');
    R.registrar('#/preparacion', 'config');

    // La hidratación inicial (REST) llega antes de montar la primera vista,
    // para que ninguna pantalla se encuentre con `evento === null`.
    NEXO.api.iniciar().then(function () {
      R.iniciar(alCambiarRuta);
      if (!u.prefs.leer('bienvenidaVista', false)) NEXO.vistas.ayuda.abrir('inicio');
    });
  }

  function iniciar() {
    var tema = u.prefs.leer('tema', null);
    if (tema) document.documentElement.setAttribute('data-theme', tema);

    NEXO.store.inicializar();
    NEXO.login.mostrar(arrancarConSesion);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();

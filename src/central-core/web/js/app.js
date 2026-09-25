/* ============================================================
   app.js — arranque y armazón

   Une las piezas: crea el estado, construye el riel, la barra
   superior y el dock de simulación, registra las rutas y monta la
   vista que corresponde. Ninguna vista sabe de las otras.
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
  var dockAbierto = u.prefs.leer('dockAbierto', false);

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
          '<input type="search" placeholder="Buscar puerta, incidente o boleta…" title="Ejemplos: P-07, INC-0001, TA-8804-0061. Atajo: /" data-ref="buscar" aria-label="Buscar" autocomplete="off">' +
          '<div class="search__results" data-ref="resultados" role="listbox"></div></div>' +
        '<div class="evchip" title="Evento en curso"><span data-ref="evDot"></span><div class="evchip__txt"><b>' + esc(NEXO.datos.RECINTO.nombre) + '</b><small data-ref="evSub"></small></div><span class="clock" data-ref="reloj"></span></div>' +
        '<a class="iconbtn" href="#/incidentes" title="Incidentes abiertos" aria-label="Incidentes abiertos">' + ico('bell', 20) + '<b class="iconbtn__dot" data-ref="campana"></b></a>' +
        '<label class="who" title="Rol con el que operas (ADR-009)"><span data-ref="avatar"></span>' +
          '<select data-ref="rol" aria-label="Rol">' + NEXO.vistas.comunes.ROLES.map(function (r) { return '<option>' + esc(r) + '</option>'; }).join('') + '</select>' +
          ico('chevron-down', 16) + '</label>' +
      '</header>' +
      '<main class="main" id="contenido" tabindex="-1"></main>';
    document.body.appendChild(app);

    var dock = document.createElement('section');
    dock.className = 'dock';
    dock.setAttribute('aria-label', 'Controles de la simulación');
    dock.innerHTML =
      '<div class="dock__bar"><span class="dock__tag">Demo</span>' +
        '<button type="button" class="dock__btn dock__btn--main" data-app="correr" data-ref="correr"></button>' +
        '<span class="dock__clock" data-ref="dockReloj"></span><span class="dock__speed" data-ref="dockVel"></span>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="dock__btn" data-app="dock" data-ref="dockChev" aria-label="Mostrar u ocultar controles"></button></div>' +
      '<div class="dock__body">' +
        '<div class="dock__label">Velocidad (segundos de evento por segundo)</div>' +
        '<div class="dock__seg" data-ref="velocidades">' + [1, 10, 30, 60].map(function (v) {
          return '<button type="button" data-app="vel" data-arg="' + v + '">' + v + '×</button>';
        }).join('') + '</div>' +
        '<div class="dock__label">Ir a un momento</div>' +
        '<div class="dock__jumps">' +
          salto('prep', 'clipboard-check', 'Antes de abrir', '16:20') +
          salto('pico', 'trending-up', 'Pico de ingreso', '17:50') +
          salto('inc', 'siren', 'Incidentes', '18:00') +
          salto('coord', 'server', 'Falla del coordinador', '18:23') +
          salto('cierre', 'file-check-2', 'Cierre', '20:16') +
          '<button type="button" class="dock__jump" data-app="reiniciar">' + ico('rotate-ccw', 16) + '<span>Reiniciar<small>misma semilla</small></span></button>' +
        '</div>' +
        '<p class="dock__note">Estos controles reemplazan al backend y no son parte del producto. La misma semilla produce el mismo evento.</p>' +
      '</div>';
    document.body.appendChild(dock);

    var toasts = document.createElement('div');
    toasts.className = 'toasts';
    toasts.setAttribute('aria-live', 'polite');
    document.body.appendChild(toasts);

    [app, dock].forEach(function (r) {
      r.querySelectorAll('[data-ref]').forEach(function (n) { refs[n.getAttribute('data-ref')] = n; });
    });
    refs.app = app; refs.dock = dock; refs.toasts = toasts;
    refs.nav = {};
    app.querySelectorAll('[data-nav]').forEach(function (n) { refs.nav[n.getAttribute('data-nav')] = n; });

    document.addEventListener('click', alClic);
    refs.rol.addEventListener('change', function () { NEXO.simulador.cambiarRol(refs.rol.value); });
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

  function salto(id, icono, t, h) {
    return '<button type="button" class="dock__jump" data-app="saltar" data-arg="' + id + '">' + ico(icono, 16) + '<span>' + t + '<small>' + h + '</small></span></button>';
  }

  function alClic(ev) {
    var n = ev.target.closest('[data-app]');
    if (!n) {
      if (!ev.target.closest('.search')) u.ranura(refs.resultados, '');
      return;
    }
    var a = n.getAttribute('data-app'), arg = n.getAttribute('data-arg');
    var S = NEXO.simulador, A = NEXO.datos.APERTURA_S;
    if (a === 'ayuda') NEXO.vistas.ayuda.abrir('inicio');
    else if (a === 'tema') alternarTema();
    else if (a === 'correr') S.alternar();
    else if (a === 'vel') S.velocidad(Number(arg));
    else if (a === 'reiniciar') S.reiniciar();
    else if (a === 'dock') { dockAbierto = !dockAbierto; u.prefs.guardar('dockAbierto', dockAbierto); pintarArmazon(NEXO.store.get()); }
    else if (a === 'saltar') {
      var destino = { prep: null, pico: A + 50 * 60, inc: A + 60 * 60, coord: A + 83 * 60, cierre: NEXO.datos.CIERRE_S + 60 }[arg];
      var e = NEXO.store.get();
      if (destino === null || destino < e.ahoraS) S.reiniciar();
      if (destino !== null) S.saltarA(destino);
      if (arg === 'inc' || arg === 'coord') NEXO.router.ir('#/incidentes');
      if (arg === 'cierre') NEXO.router.ir('#/cierre');
      if (arg === 'prep') NEXO.router.ir('#/preparacion');
    } else if (a === 'irA') {
      refs.buscar.value = '';
      u.ranura(refs.resultados, '');
      NEXO.router.ir(arg);
    }
  }

  // ==========================================================
  //  búsqueda global
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
    var b = e.boletas.buscar(refs.buscar.value.trim().toUpperCase());
    if (b) {
      var s = b.consumidaEnS !== null ? 'Admitida a las ' + fmt.hora(b.consumidaEnS, true) + ' en ' + b.consumidaEnPunto
        : b.anulacion ? 'Anulada por la boletería' : 'Habilitada, sin usar';
      hits.push({ ico: 'ticket', t: 'Boleta ' + b.ref + ' · zona ' + b.zona, s: s, h: b.consumidaEnPunto ? '#/puertas/' + b.consumidaEnPunto : '#/lector' });
    } else if (/^ta-\d{4}-\d{4}$/.test(q)) {
      hits.push({ ico: 'ticket', t: 'Boleta ' + q.toUpperCase(), s: 'No existe en este evento: se rechazaría como código desconocido', h: '#/lector' });
    }
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

  function pintarArmazon(e) {
    var ev = e.evento;
    var abiertos = e.incidentes.filter(function (x) { return x.estado === 'nuevo' || x.estado === 'en-curso'; }).length;
    var difs = e.conciliacion.diferencias.filter(function (x) { return x.estado === 'abierta'; }).length;
    var ctl = e.preparacion.controles.filter(function (x) { return !x.ok; }).length;
    var cuentas = { incidentes: abiertos || '', diferencias: difs || '', controles: ev.estado === 'preparacion' && ctl ? ctl : '' };
    refs.app.querySelectorAll('[data-cuenta]').forEach(function (n) { u.ranura(n, String(cuentas[n.getAttribute('data-cuenta')])); });
    u.ranura(refs.campana, abiertos ? String(abiertos) : '');

    var migas;
    if (vistaId === 'incidente') migas = '<a href="#/incidentes">Incidentes</a>' + ico('chevron-right', 14) + '<b>' + esc(params.id) + '</b>';
    else if (vistaId === 'punto') migas = '<a href="#/inicio">Operación</a>' + ico('chevron-right', 14) + '<b>Puertas · ' + esc(params.id || 'P-07') + '</b>';
    else { var m = MIGAS[vistaId] || MIGAS.pmu; migas = '<span class="dim">' + m[0] + '</span>' + ico('chevron-right', 14) + '<b>' + m[1] + '</b>'; }
    u.ranura(refs.crumbs, migas);

    var est = { preparacion: ['Fecha 14 · en preparación', 'info'], abierto: ['Fecha 14 · ingreso abierto', 'ok'], cerrado: ['Fecha 14 · ventana cerrada', 'violet'] }[ev.estado];
    u.ranura(refs.evSub, est[0]);
    u.ranura(refs.evDot, '<i class="dot dot--' + est[1] + (ev.estado === 'abierto' ? ' dot--pulse' : '') + '"></i>');
    u.ranura(refs.reloj, fmt.hora(e.ahoraS, true));

    if (document.activeElement !== refs.rol) refs.rol.value = e.rol;
    u.ranura(refs.avatar, NEXO.vistas.comunes.avatar(e.rol));
    u.ranura(refs.temaIco, ico(temaActual() === 'dark' ? 'sun' : 'moon', 22));

    Object.keys(refs.nav).forEach(function (id) {
      var n = NAV.filter(function (x) { return x.id === id; })[0];
      var activo = id === vistaId || (n.tambien && n.tambien.indexOf(vistaId) !== -1);
      if (activo) refs.nav[id].setAttribute('aria-current', 'page'); else refs.nav[id].removeAttribute('aria-current');
    });

    refs.dock.setAttribute('data-open', dockAbierto ? '1' : '0');
    refs.dock.setAttribute('data-run', e.corriendo ? '1' : '0');
    u.ranura(refs.correr, ico(e.corriendo ? 'pause' : 'play', 16));
    refs.correr.setAttribute('aria-label', e.corriendo ? 'Pausar' : 'Reanudar');
    u.ranura(refs.dockReloj, fmt.hora(e.ahoraS, true));
    u.ranura(refs.dockVel, e.corriendo ? e.velocidad + '×' : 'en pausa');
    u.ranura(refs.dockChev, ico(dockAbierto ? 'chevron-down' : 'sliders-horizontal', 16));
    refs.velocidades.querySelectorAll('button').forEach(function (b) {
      b.setAttribute('aria-pressed', Number(b.getAttribute('data-arg')) === e.velocidad ? 'true' : 'false');
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

  function iniciar() {
    var tema = u.prefs.leer('tema', null);
    if (tema) document.documentElement.setAttribute('data-theme', tema);

    NEXO.store.inicializar();
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

    // Arranca poco antes de los incidentes, con el ingreso cargado:
    // un panel en vivo se entiende mejor viéndolo trabajar.
    NEXO.simulador.saltarA(NEXO.datos.APERTURA_S + 52 * 60);
    R.iniciar(alCambiarRuta);

    if (u.prefs.leer('bienvenidaVista', false)) NEXO.simulador.iniciar();
    else NEXO.vistas.ayuda.abrir('inicio', function () { NEXO.simulador.iniciar(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();

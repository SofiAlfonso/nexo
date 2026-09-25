/* ============================================================
   api.js — capa de aplicación real (reemplaza a simulador.js)

   Llena el mismo `store` que usaban las vistas, pero con datos
   reales: REST (`/api/...`) para la carga inicial y las acciones,
   y SSE (`/api/stream`) para las actualizaciones en vivo. El panel
   nunca decide: pide, muestra y deja que una persona apruebe.

   Modo `?fixtures`: mientras C4 no esté listo, carga los mismos
   JSON de `tests/fixtures/O2` (copiados a `fixtures/o2/`) por fetch,
   y las acciones se aplican en memoria en vez de viajar por red.
   ============================================================ */

NEXO.api = (function () {
  'use strict';

  var store = NEXO.store, d = NEXO.dominio;
  var FIXTURES = /(?:^|[?&])fixtures\b/.test(location.search);
  var FDIR = 'fixtures/o2/';

  // ==========================================================
  //  traducción: claves del contrato O2 → objetos/texto locales
  //  (el contrato viaja por clave — p. ej. `SUPERVISOR`,
  //  `PERMISO_VIGENTE` — y el texto visible vive en dominio.js)
  // ==========================================================

  function rolTexto(k) { return k ? (d.Rol[k] || k) : k; }
  function prioridadObj(k) { return d.Prioridad[String(k || 'media').toUpperCase()] || d.Prioridad.MEDIA; }
  function tipoIncTexto(k) { return k ? (d.TipoIncidente[k] || k) : k; }
  function motivoTexto(k) { return k ? (d.Motivo[k] || k) : k; }
  function autorTexto(k) { return (k === null || k === 'sistema') ? (k === 'sistema' ? 'NEXO' : k) : rolTexto(k); }

  function traducirIntento(it) {
    var o = {};
    for (var k in it) o[k] = it[k];
    o.motivo = motivoTexto(it.motivo);
    return o;
  }

  function traducirIncidente(inc) {
    var o = {};
    for (var k in inc) o[k] = inc[k];
    o.tipo = tipoIncTexto(inc.tipo);
    o.clasificacion = tipoIncTexto(inc.clasificacion);
    o.prioridad = prioridadObj(inc.prioridad);
    o.responsable = rolTexto(inc.responsable);
    o.bitacora = (inc.bitacora || []).map(function (b) {
      var e = {}; for (var k2 in b) e[k2] = b[k2];
      e.autor = autorTexto(b.autor);
      return e;
    });
    return o;
  }

  function traducirAccion(a) {
    var o = {};
    for (var k in a) o[k] = a[k];
    o.rol = rolTexto(a.rol);
    o.autor = autorTexto(a.autor);
    return o;
  }

  function traducirDiferencia(dif) {
    var o = {};
    for (var k in dif) o[k] = dif[k];
    o.resueltaPor = autorTexto(dif.resueltaPor);
    return o;
  }

  function traducirConciliacion(c) {
    var o = {};
    for (var k in c) o[k] = c[k];
    o.diferencias = (c.diferencias || []).map(traducirDiferencia);
    return o;
  }

  function traducirPuntoDetalle(p) {
    var o = {};
    for (var k in p) o[k] = p[k];
    o.recientes = (p.recientes || []).map(traducirIntento);
    return o;
  }

  // ==========================================================
  //  transporte
  // ==========================================================

  function peticionReal(metodo, ruta, cuerpo) {
    return fetch(ruta, {
      method: metodo,
      credentials: 'include',
      headers: cuerpo !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined
    }).then(function (r) {
      if (r.status === 204) return null;
      if (!r.ok) {
        return r.json().catch(function () { return null; }).then(function (err) {
          var e = new Error((err && err.mensaje) || ('Error ' + r.status));
          e.status = r.status; e.codigo = err && err.codigo;
          throw e;
        });
      }
      return r.json();
    });
  }

  function cargarFixture(nombre) {
    return fetch(FDIR + nombre, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('No se encontró el fixture ' + nombre);
      return r.json();
    });
  }

  // ==========================================================
  //  autenticación (ADR-016)
  // ==========================================================

  /** Credenciales de laboratorio: solo válidas en modo `?fixtures`, nunca contra un backend real. */
  var OPERADORES_FIXTURES = [
    { usuario: 'supervisor', contrasena: 'nexo-2026', rol: 'SUPERVISOR', nombre: 'Ana Rueda' },
    { usuario: 'tecnico', contrasena: 'nexo-2026', rol: 'LIDER_TECNICO', nombre: 'Marco Peña' },
    { usuario: 'logistica', contrasena: 'nexo-2026', rol: 'LOGISTICA', nombre: 'Iris Camacho' },
    { usuario: 'cierre', contrasena: 'nexo-2026', rol: 'CIERRE', nombre: 'Diego Salas' },
    { usuario: 'finanzas', contrasena: 'nexo-2026', rol: 'FINANZAS', nombre: 'Paula Ortiz' }
  ];
  var sesionFixture = null;

  function aplicarSesion(sesion) {
    var e = store.get();
    e.operador = sesion.operador;
    e.rol = sesion.operador.rolTexto;
    return sesion;
  }

  function login(usuario, contrasena) {
    if (FIXTURES) {
      var op = OPERADORES_FIXTURES.filter(function (o) { return o.usuario === usuario && o.contrasena === contrasena; })[0];
      if (!op) return Promise.reject(new Error('Usuario o contraseña incorrectos.'));
      sesionFixture = {
        operador: { usuario: op.usuario, nombre: op.nombre, rol: op.rol, rolTexto: rolTexto(op.rol) },
        expiraEn: new Date(Date.now() + 8 * 3600 * 1000).toISOString()
      };
      return Promise.resolve(aplicarSesion(sesionFixture));
    }
    return peticionReal('POST', '/api/auth/login', { usuario: usuario, contrasena: contrasena }).then(aplicarSesion);
  }

  function logout() {
    var e = store.get();
    e.operador = null; e.rol = null;
    detener();
    if (FIXTURES) { sesionFixture = null; return Promise.resolve(null); }
    return peticionReal('POST', '/api/auth/logout');
  }

  function me() {
    if (FIXTURES) {
      return sesionFixture ? Promise.resolve(aplicarSesion(sesionFixture)) : Promise.reject(new Error('sin sesión'));
    }
    return peticionReal('GET', '/api/auth/me').then(aplicarSesion);
  }

  // ==========================================================
  //  hidratación inicial
  // ==========================================================

  function cargarEstado() {
    var p = FIXTURES ? cargarFixture('EstadoActual.abierto.json') : peticionReal('GET', '/api/eventos/actual/estado');
    return p.then(function (est) {
      var e = store.get();
      e.evento = est.evento;
      e.coordinador = est.coordinador;
      e.nube = est.nube;
      e.integracion = est.integracion;
      e.conteo = est.conteo;
      e.admisionesPorZona = est.admisionesPorZona;
      e.serie = est.serie;
      e.metricas = est.metricas;
      e.conciliacion = traducirConciliacion(est.conciliacion);
      e.preparacion = est.preparacion;
      e.ahoraS = est.ahoraS;
      registrarExito();
      return est;
    });
  }

  function cargarPuntos() {
    var p = FIXTURES ? cargarFixture('ListaPuntos.m1.json') : peticionReal('GET', '/api/puntos');
    return p.then(function (lista) {
      var e = store.get();
      e.puntos = lista;
      e.puntosPorId = lista.reduce(function (m, x) { m[x.id] = x; return m; }, {});
      return lista;
    });
  }

  /** Carga perezosa: la lista solo trae `PuntoResumen`; el detalle llega al ver la puerta. */
  function cargarPuntoDetalle(id) {
    var e = store.get();
    var p;
    if (FIXTURES) {
      p = id === 'P-07'
        ? cargarFixture('PuntoDetalle.p07.json')
        : Promise.resolve(detalleFixtureAproximado(id));
    } else {
      p = peticionReal('GET', '/api/puntos/' + encodeURIComponent(id));
    }
    return p.then(function (det) {
      if (!det) return null;
      var t = traducirPuntoDetalle(det);
      e.puntosPorId[t.id] = t;
      var i = e.puntos.findIndex(function (x) { return x.id === t.id; });
      if (i !== -1) e.puntos[i] = t; else e.puntos.push(t);
      store.notificar();
      return t;
    });
  }

  /** Sin detalle canónico en fixtures: se completa con el resumen ya cargado. */
  function detalleFixtureAproximado(id) {
    var r = store.get().puntosPorId[id];
    if (!r) return null;
    var o = {};
    for (var k in r) o[k] = r[k];
    o.latencias = []; o.recientes = []; o.lectores = r.lectorActual ? [r.lectorActual] : [];
    o.actividad = [];
    o.preparacion = { lector: true, credencial: true, zonas: true, version: true, prueba: true };
    return o;
  }

  function cargarIntentos(puntoId) {
    var p = FIXTURES ? cargarFixture('ListaIntentos.recientes.json')
      : peticionReal('GET', '/api/intentos' + (puntoId ? ('?puntoId=' + encodeURIComponent(puntoId) + '&limite=50') : '?limite=50'));
    return p.then(function (lista) {
      var traducida = lista.map(traducirIntento);
      if (!puntoId) store.get().intentos = traducida;
      return traducida;
    });
  }

  function cargarIncidentes() {
    var p = FIXTURES ? cargarFixture('ListaIncidentes.uno.json') : peticionReal('GET', '/api/incidentes');
    return p.then(function (lista) {
      store.get().incidentes = lista.map(traducirIncidente);
      return lista;
    });
  }

  function cargarAcciones() {
    var p = FIXTURES ? cargarFixture('ListaAcciones.una.json') : peticionReal('GET', '/api/acciones');
    return p.then(function (lista) {
      store.get().acciones = lista.map(traducirAccion);
      return lista;
    });
  }

  function cargarActividad() {
    var p = FIXTURES ? cargarFixture('ListaActividad.m1.json') : peticionReal('GET', '/api/actividad');
    return p.then(function (lista) {
      store.get().actividad = lista;
      return lista;
    });
  }

  // ==========================================================
  //  flujo en vivo (SSE) y arranque
  // ==========================================================

  var flujo = null, latidoFixtures = null;

  function conectarFlujo() {
    if (FIXTURES) {
      // No hay backend: un pulso ligero mantiene vivo el indicador de
      // conexión y da una señal de "esto se actualiza solo" sin recrear
      // el guion de incidentes del simulador.
      var e = store.get();
      latidoFixtures = setInterval(function () {
        e.conexion.sse = true;
        e.ahoraS += 5;
        registrarExito();
        store.notificar();
      }, 5000);
      e.conexion.sse = true;
      return;
    }
    if (typeof EventSource === 'undefined') return;
    if (flujo) flujo.close();
    flujo = new EventSource('/api/stream', { withCredentials: true });
    var e = store.get();

    flujo.onopen = function () { e.conexion.sse = true; store.notificar(); };
    flujo.onerror = function () {
      e.conexion.sse = false;
      store.notificar();
      // El propio EventSource reintenta la conexión; al reabrir, el
      // servidor reenvía primero el `estado` completo (recuperación T2 §5.4).
    };

    var manejadores = {
      estado: function (est) {
        var ev = store.get();
        ev.evento = est.evento; ev.coordinador = est.coordinador; ev.nube = est.nube;
        ev.integracion = est.integracion; ev.conteo = est.conteo; ev.admisionesPorZona = est.admisionesPorZona;
        ev.serie = est.serie; ev.metricas = est.metricas; ev.conciliacion = traducirConciliacion(est.conciliacion);
        ev.preparacion = est.preparacion; ev.ahoraS = est.ahoraS;
      },
      punto: function (res) {
        var ev = store.get();
        var previo = ev.puntosPorId[res.id];
        // conserva el detalle ya cargado (latencias/recientes/...) si lo había
        var fusion = previo ? Object.assign({}, previo, res) : res;
        ev.puntosPorId[res.id] = fusion;
        var i = ev.puntos.findIndex(function (x) { return x.id === res.id; });
        if (i !== -1) ev.puntos[i] = fusion; else ev.puntos.push(fusion);
      },
      intento: function (it) {
        var ev = store.get();
        ev.intentos.unshift(traducirIntento(it));
        if (ev.intentos.length > 60) ev.intentos.length = 60;
      },
      incidente: function (inc) {
        var ev = store.get();
        var t = traducirIncidente(inc);
        var i = ev.incidentes.findIndex(function (x) { return x.id === t.id; });
        if (i !== -1) ev.incidentes[i] = t; else ev.incidentes.unshift(t);
      },
      accion: function (a) {
        var ev = store.get();
        var t = traducirAccion(a);
        var i = ev.acciones.findIndex(function (x) { return x.id === t.id; });
        if (i !== -1) ev.acciones[i] = t; else ev.acciones.unshift(t);
      },
      diferencia: function (dif) {
        var ev = store.get();
        var t = traducirDiferencia(dif);
        var i = ev.conciliacion.diferencias.findIndex(function (x) { return x.id === t.id; });
        if (i !== -1) ev.conciliacion.diferencias[i] = t; else ev.conciliacion.diferencias.unshift(t);
      },
      aviso: function (a) { store.avisar({ titulo: a.texto, tono: a.tono }); }
    };

    Object.keys(manejadores).forEach(function (tipo) {
      flujo.addEventListener(tipo, function (ev) {
        try {
          var datos = JSON.parse(ev.data);
          manejadores[tipo](datos);
          registrarExito();
          store.notificar();
        } catch (err) { console.error('Error al procesar el evento SSE «' + tipo + '»:', err); }
      });
    });
  }

  function registrarExito() {
    var e = store.get();
    e.conexion.ultimoExitoMs = Date.now();
    e.cargando = false;
  }

  /**
   * Arranca la hidratación real y el flujo en vivo. Se llama una vez, tras el login.
   * Usa `allSettled` (no `all`) porque, mientras C4 termina de implementar cada
   * consulta, es normal que una falle (404) sin que eso deba tumbar las demás
   * vistas: cada `cargarX()` ya escribe su propio dato en el store al resolver.
   */
  function iniciar() {
    return Promise.allSettled([
      cargarEstado(), cargarPuntos(), cargarIntentos(), cargarIncidentes(), cargarAcciones(), cargarActividad()
    ]).then(function (resultados) {
      resultados.forEach(function (r) {
        // Aviso, no error: mientras C4 termina cada consulta es normal que
        // alguna aun no exista (404); la vista ya muestra su estado vacio.
        if (r.status === 'rejected') console.warn('No se pudo cargar parte del estado inicial:', r.reason);
      });
      store.get().cargando = false;
      store.notificar();
      conectarFlujo();
    });
  }

  function detener() {
    if (flujo) { flujo.close(); flujo = null; }
    if (latidoFixtures) { clearInterval(latidoFixtures); latidoFixtures = null; }
  }

  // ==========================================================
  //  acciones (mutan en el servidor; en `?fixtures` se aplican
  //  en memoria porque no hay backend)
  // ==========================================================

  function incidentePorId(id) { return store.get().incidentes.filter(function (x) { return x.id === id; })[0]; }
  function accionPorId(id) { return store.get().acciones.filter(function (x) { return x.id === id; })[0]; }

  function accionIncidente(id, cuerpo) {
    if (FIXTURES) {
      var inc = incidentePorId(id);
      if (!inc) return Promise.resolve(null);
      aplicarAccionLocal(inc, cuerpo);
      store.notificar();
      return Promise.resolve(inc);
    }
    return peticionReal('POST', '/api/incidentes/' + encodeURIComponent(id) + '/acciones', cuerpo).then(function (inc) {
      manejadorLocalIncidente(inc);
      store.notificar();
      return inc;
    });
  }

  function manejadorLocalIncidente(inc) {
    var t = traducirIncidente(inc);
    var e = store.get();
    var i = e.incidentes.findIndex(function (x) { return x.id === t.id; });
    if (i !== -1) e.incidentes[i] = t; else e.incidentes.unshift(t);
  }

  /** Aproxima en memoria (modo `?fixtures`) el mismo efecto que tendría C4. */
  function aplicarAccionLocal(inc, cuerpo) {
    var ahoraS = store.get().ahoraS;
    var rol = store.get().rol;
    if (cuerpo.accion === 'tomar') { if (inc.actuadaEnS === null) inc.actuadaEnS = ahoraS; if (inc.estado === 'nuevo') inc.estado = 'en-curso'; }
    else if (cuerpo.accion === 'nota') { inc.bitacora.push({ t: ahoraS, autor: rol, tipo: 'nota', texto: cuerpo.texto }); }
    else if (cuerpo.accion === 'escalar') { inc.prioridad = d.Prioridad.CRITICA; inc.bitacora.push({ t: ahoraS, autor: rol, tipo: 'estado', texto: 'Escalado.' }); }
    else if (cuerpo.accion === 'descartar') { inc.estado = 'descartado'; inc.resueltaEnS = ahoraS; }
    else if (cuerpo.accion === 'resolver') { inc.estado = 'resuelto'; inc.resueltaEnS = ahoraS; }
    else if (cuerpo.accion === 'actualizar') {
      if (cuerpo.clasificacion) inc.clasificacion = tipoIncTexto(cuerpo.clasificacion);
      if (cuerpo.prioridad) inc.prioridad = prioridadObj(cuerpo.prioridad);
      if (cuerpo.responsable) inc.responsable = rolTexto(cuerpo.responsable);
    } else if (cuerpo.accion === 'destacar') { inc.destacado = cuerpo.valor !== undefined ? cuerpo.valor : !inc.destacado; }
    else if (cuerpo.accion === 'checklist') { var it = inc.checklist[cuerpo.indice]; if (it) it.hecho = !it.hecho; }
  }

  function tomarIncidente(id) { return accionIncidente(id, { accion: 'tomar' }); }
  function notaIncidente(id, texto) { return accionIncidente(id, { accion: 'nota', texto: texto }); }
  function actualizarIncidente(id, cambios) {
    var cuerpo = { accion: 'actualizar' };
    if (cambios.clasificacion) cuerpo.clasificacion = clavePorTexto(d.TipoIncidente, cambios.clasificacion);
    if (cambios.prioridad) cuerpo.prioridad = (cambios.prioridad.id || cambios.prioridad);
    if (cambios.responsable) cuerpo.responsable = clavePorTexto(d.Rol, cambios.responsable);
    return accionIncidente(id, cuerpo);
  }
  function resolverIncidente(id) { return accionIncidente(id, { accion: 'resolver' }); }
  function descartarIncidente(id) { return accionIncidente(id, { accion: 'descartar' }); }
  function destacar(id) {
    var inc = incidentePorId(id);
    return accionIncidente(id, { accion: 'destacar', valor: inc ? !inc.destacado : true });
  }
  function alternarChecklist(id, indice) { return accionIncidente(id, { accion: 'checklist', indice: indice }); }

  function clavePorTexto(mapa, texto) {
    var claves = Object.keys(mapa);
    for (var i = 0; i < claves.length; i++) {
      var v = mapa[claves[i]];
      if (v === texto || (v && v.nombre === texto) || (v && v.id === texto)) return claves[i];
    }
    return texto;
  }

  function decidirAccion(id, aprobar, nota) {
    if (FIXTURES) {
      var a = accionPorId(id);
      if (a) {
        a.estado = aprobar ? 'aprobada' : 'rechazada';
        a.decididaEnS = store.get().ahoraS;
        a.autor = store.get().rol;
        if (nota) a.nota = nota;
      }
      store.notificar();
      return Promise.resolve(a);
    }
    return peticionReal('POST', '/api/acciones/' + encodeURIComponent(id), { aprobar: aprobar, nota: nota }).then(function (a) {
      var t = traducirAccion(a);
      var e = store.get();
      var i = e.acciones.findIndex(function (x) { return x.id === t.id; });
      if (i !== -1) e.acciones[i] = t; else e.acciones.unshift(t);
      store.notificar();
      return t;
    });
  }

  function alternarControl(id) {
    var e = store.get();
    var ctl = e.preparacion.controles.filter(function (c) { return c.id === id; })[0];
    var nuevo = !(ctl && ctl.ok);
    if (FIXTURES) {
      if (ctl) ctl.ok = nuevo;
      store.notificar();
      return Promise.resolve(e.preparacion);
    }
    return peticionReal('POST', '/api/preparacion/controles/' + encodeURIComponent(id), { ok: nuevo }).then(function (prep) {
      e.preparacion = prep;
      store.notificar();
      return prep;
    });
  }

  function confirmarApertura() {
    var e = store.get();
    if (FIXTURES) { e.preparacion.confirmada = true; store.notificar(); return Promise.resolve(e.preparacion); }
    return peticionReal('POST', '/api/preparacion/confirmar').then(function (prep) {
      e.preparacion = prep; store.notificar(); return prep;
    });
  }

  function cierreAccion(ruta, cuerpo) {
    var e = store.get();
    if (FIXTURES) {
      // Aproximación local: no hay backend de cierre en modo fixtures.
      store.notificar();
      return Promise.resolve(e.conciliacion);
    }
    return peticionReal('POST', ruta, cuerpo || {}).then(function (c) {
      e.conciliacion = traducirConciliacion(c);
      store.notificar();
      return e.conciliacion;
    });
  }
  function entregarPreliminar() { return cierreAccion('/api/cierre/preliminar', {}); }
  function declararConciliado() { return cierreAccion('/api/cierre/definitivo', {}); }
  function registrarCobro() { return cierreAccion('/api/cierre/cobro', {}); }
  function resolverDiferencia(id, opcion) {
    var e = store.get();
    if (FIXTURES) {
      var dif = e.conciliacion.diferencias.filter(function (x) { return x.id === id; })[0];
      if (dif) { dif.estado = 'resuelta'; dif.resolucion = opcion; dif.resueltaPor = e.rol; dif.resueltaEnS = e.ahoraS; }
      store.notificar();
      return Promise.resolve(e.conciliacion);
    }
    return peticionReal('POST', '/api/cierre/diferencias/' + encodeURIComponent(id), { opcion: opcion }).then(function (c) {
      e.conciliacion = traducirConciliacion(c);
      store.notificar();
      return e.conciliacion;
    });
  }
  function resolverTodas(tipo) {
    var abiertas = store.get().conciliacion.diferencias.filter(function (x) { return x.estado === 'abierta' && x.tipo === tipo; });
    return Promise.all(abiertas.map(function (x) {
      var op = (x.opciones && x.opciones[0] && x.opciones[0].id) || 'excluir';
      return resolverDiferencia(x.id, op);
    }));
  }

  // ==========================================================
  //  lector (fuera de alcance para M1: sin decisión real todavía)
  // ==========================================================

  function fijarPuntoLector(id) {
    var e = store.get();
    e.lector.puntoId = id;
    e.lector.historial = []; e.lector.ultima = null; e.lector.ultimaBoleta = null;
    store.notificar();
    cargarIntentos(id).then(function (lista) {
      e.lector.historial = lista;
      store.notificar();
    }).catch(function () {});
  }

  /** La validación real (V1) llega después de M1; por ahora solo informa el estado. */
  function escanear() {
    store.avisar({ titulo: 'Disponible después de M1', texto: 'La validación en vivo del lector se conecta en una siguiente entrega.', tono: 'info' });
    return null;
  }

  // ==========================================================
  //  cálculo puramente local (sin endpoint dedicado todavía)
  // ==========================================================

  /** Las condiciones y la posibilidad de conciliar ya llegan calculadas del servidor (O2 §Conciliacion). */
  function condicionesCierre(e) { return e.conciliacion.condiciones || []; }
  function puedeConciliar(e) {
    return e.conciliacion.estado === 'preliminar' && condicionesCierre(e).every(function (c) { return c.ok; });
  }

  /**
   * Liquidación (regla 8): se calcula en el panel con la tarifa pública y las
   * admisiones ya contadas por el servidor. Pendiente de un endpoint propio de
   * cierre; por ahora no hay una colección de boletas en el panel para
   * distinguir "excluidas", así que se reporta 0 hasta que exista `GET
   * /api/cierre/liquidacion` (post-M1).
   */
  function liquidacion(e) {
    var T = d.Tarifa;
    var admisiones = e.conteo.admisiones, estimadas = e.evento.admisionesEstimadas, gratuito = e.evento.gratuito;
    var excluidas = 0;
    var facturables = Math.max(0, admisiones - excluidas);
    var cargoEvento = gratuito ? 0 : T.cargoPorEvento;
    var importe = T.importe(facturables, gratuito);
    var cargoAdmisiones = importe - cargoEvento;
    var anticipo = T.anticipo(estimadas, gratuito);
    var costos = T.trabajoPorEvento;
    var contribucion = T.contribucion(facturables, costos, gratuito);
    return {
      moneda: T.moneda, admisiones: admisiones, excluidas: excluidas, facturables: facturables,
      cargoEvento: cargoEvento, cargoAdmisiones: cargoAdmisiones,
      importe: importe, anticipo: anticipo, saldo: importe - anticipo, costos: costos, trabajo: costos, escalacion: 0,
      contribucion: contribucion, margen: importe ? contribucion / importe * 100 : 0
    };
  }

  return {
    // sesión
    login: login, logout: logout, me: me,
    // ciclo de vida
    iniciar: iniciar, detener: detener,
    // carga perezosa
    cargarPuntoDetalle: cargarPuntoDetalle,
    // incidentes
    tomarIncidente: tomarIncidente, actualizarIncidente: actualizarIncidente, notaIncidente: notaIncidente,
    resolverIncidente: resolverIncidente, descartarIncidente: descartarIncidente, destacar: destacar,
    alternarChecklist: alternarChecklist,
    // acciones pendientes
    decidirAccion: decidirAccion,
    // preparación
    alternarControl: alternarControl, confirmarApertura: confirmarApertura,
    // lector (después de M1)
    escanear: escanear, fijarPuntoLector: fijarPuntoLector,
    // cierre
    entregarPreliminar: entregarPreliminar, declararConciliado: declararConciliado,
    registrarCobro: registrarCobro, resolverDiferencia: resolverDiferencia, resolverTodas: resolverTodas,
    condicionesCierre: condicionesCierre, puedeConciliar: puedeConciliar, liquidacion: liquidacion
  };
})();

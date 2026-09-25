/* ============================================================
   router.js — enrutador por fragmento (hash)

   Se usa el hash y no la History API a propósito: así el prototipo
   funciona abierto con doble clic desde el sistema de archivos.
   ============================================================ */

NEXO.router = (function () {
  'use strict';

  var rutas = [];
  var alCambiar = null;
  var actual = null;

  /** registrar('#/incidentes/:id', 'incidente') */
  function registrar(patron, vistaId) {
    rutas.push({ partes: patron.replace(/^#\//, '').split('/'), vistaId: vistaId, patron: patron });
  }

  function resolver() {
    var hash = window.location.hash || rutas[0].patron;
    var partes = hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
    for (var i = 0; i < rutas.length; i++) {
      var r = rutas[i];
      if (r.partes.length !== partes.length) continue;
      var params = {}, ok = true;
      for (var k = 0; k < r.partes.length; k++) {
        if (r.partes[k].charAt(0) === ':') params[r.partes[k].slice(1)] = decodeURIComponent(partes[k]);
        else if (r.partes[k] !== partes[k]) { ok = false; break; }
      }
      if (ok) return { vistaId: r.vistaId, params: params, hash: hash };
    }
    return { vistaId: rutas[0].vistaId, params: {}, hash: rutas[0].patron };
  }

  function ir(hash) {
    if (window.location.hash === hash) manejar();
    else window.location.hash = hash;
  }

  function manejar() {
    actual = resolver();
    if (alCambiar) alCambiar(actual);
  }

  function iniciar(cb) {
    alCambiar = cb;
    window.addEventListener('hashchange', manejar);
    if (!window.location.hash) window.location.hash = rutas[0].patron;
    else manejar();
  }

  return { registrar: registrar, iniciar: iniciar, ir: ir, rutaActual: function () { return actual; } };
})();

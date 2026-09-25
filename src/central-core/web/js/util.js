/* ============================================================
   util.js — ayudantes de formato, HTML y aleatoriedad

   Se usa un espacio de nombres global (NEXO) en lugar de módulos
   ES para que el prototipo abra con doble clic, sin servidor: los
   módulos fallan sobre file:// por CORS.
   ============================================================ */

window.NEXO = window.NEXO || {};

NEXO.util = (function () {
  'use strict';

  // ---------- HTML ----------

  var MAPA = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /** Escapa texto para insertarlo en una plantilla HTML. */
  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) { return MAPA[c]; });
  }

  /** Icono SVG de la colección incrustada (iconos.js). */
  function icono(nombre, tam, clase) {
    var cuerpo = (NEXO.iconos && NEXO.iconos[nombre]) || '';
    tam = tam || 18;
    return '<svg class="ico ' + (clase || '') + '" width="' + tam + '" height="' + tam +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + cuerpo + '</svg>';
  }

  /**
   * Ranura: un nodo cuyo contenido se reescribe solo si cambió.
   * Las vistas construyen su esqueleto una vez y después actualizan
   * ranuras; así no se pierde el foco de los campos ni el
   * desplazamiento de las listas con el repintado en vivo.
   */
  function ranura(nodo, html) {
    if (!nodo) return;
    if (nodo.__html !== html) {
      nodo.__html = html;
      nodo.innerHTML = html;
    }
  }

  /** Busca todos los nodos [data-slot] de una raíz y los indexa. */
  function ranuras(raiz) {
    var m = {};
    raiz.querySelectorAll('[data-slot]').forEach(function (n) { m[n.getAttribute('data-slot')] = n; });
    return m;
  }

  // ---------- formato ----------

  function dos(n) { return n < 10 ? '0' + n : String(n); }

  var fmt = {
    entero: function (n) {
      return Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
    },
    decimal: function (n, d) {
      d = d === undefined ? 1 : d;
      return Number(n || 0).toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });
    },
    usd: function (n) {
      var neg = n < 0;
      var s = 'USD ' + Math.abs(Number(n || 0)).toLocaleString('es-CO', {
        minimumFractionDigits: 2, maximumFractionDigits: 2
      });
      return neg ? '−' + s : s;
    },
    pct: function (n, d) { return fmt.decimal(n, d === undefined ? 1 : d) + ' %'; },

    /** Segundos desde medianoche a HH:MM(:SS). */
    hora: function (seg, conSegundos) {
      seg = Math.max(0, Math.floor(seg));
      var h = Math.floor(seg / 3600) % 24, m = Math.floor(seg / 60) % 60, s = seg % 60;
      var out = dos(h) + ':' + dos(m);
      return conSegundos ? out + ':' + dos(s) : out;
    },

    /** Duración corta: «41 s», «2 min 14 s», «1 h 05 min». */
    duracion: function (seg) {
      seg = Math.max(0, Math.floor(seg));
      if (seg < 60) return seg + ' s';
      if (seg < 3600) return Math.floor(seg / 60) + ' min ' + dos(seg % 60) + ' s';
      return Math.floor(seg / 3600) + ' h ' + dos(Math.floor(seg / 60) % 60) + ' min';
    },

    /** Duración compacta para medidores: «58 s», «4m 10s», «1h 05m». */
    corto: function (seg) {
      seg = Math.max(0, Math.floor(seg));
      if (seg < 60) return seg + ' s';
      if (seg < 3600) return Math.floor(seg / 60) + 'm ' + dos(seg % 60) + 's';
      return Math.floor(seg / 3600) + 'h ' + dos(Math.floor(seg / 60) % 60) + 'm';
    },

    /** «hace 2 min», «ahora». */
    hace: function (seg) {
      seg = Math.max(0, Math.floor(seg));
      if (seg < 10) return 'ahora';
      if (seg < 60) return 'hace ' + seg + ' s';
      if (seg < 3600) return 'hace ' + Math.floor(seg / 60) + ' min';
      return 'hace ' + Math.floor(seg / 3600) + ' h';
    },

    /** «en 2 min», «vencido hace 1 min». */
    plazo: function (seg) {
      if (seg <= 0) return 'vencido hace ' + fmt.duracion(-seg);
      return 'en ' + fmt.duracion(seg);
    },

    /** Fecha legible a partir de un objeto Date. */
    fecha: function (d) {
      return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
    }
  };

  // ---------- números ----------

  function percentil(muestra, p) {
    if (!muestra.length) return 0;
    var orden = muestra.slice().sort(function (a, b) { return a - b; });
    return orden[Math.min(orden.length - 1, Math.floor(p * orden.length))];
  }

  function limitar(v, min, max) { return Math.max(min, Math.min(max, v)); }

  /** Iniciales para los avatares de rol (nunca de asistentes). */
  function iniciales(texto) {
    return String(texto).split(/\s+/).filter(function (p) { return p.length > 2; })
      .slice(0, 2).map(function (p) { return p.charAt(0).toUpperCase(); }).join('');
  }

  // ---------- almacenamiento local (solo preferencias) ----------

  var prefs = {
    leer: function (k, def) {
      try { var v = window.localStorage.getItem('nexo.' + k); return v === null ? def : JSON.parse(v); }
      catch (e) { return def; }
    },
    guardar: function (k, v) {
      try { window.localStorage.setItem('nexo.' + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ }
    }
  };

  return {
    esc: esc, icono: icono, ranura: ranura, ranuras: ranuras,
    fmt: fmt, percentil: percentil, limitar: limitar,
    iniciales: iniciales, prefs: prefs
  };
})();

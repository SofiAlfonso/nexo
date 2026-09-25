/* ============================================================
   vistas/comunes.js — piezas de presentación compartidas

   Traduce conceptos del dominio a su forma visible. Vive aquí para
   que un mismo estado se vea igual en todas las pantallas.
   Todas las funciones devuelven cadenas HTML ya escapadas.
   ============================================================ */

NEXO.vistas = NEXO.vistas || {};

NEXO.vistas.comunes = (function () {
  'use strict';

  var u = NEXO.util, esc = u.esc, ico = u.icono, fmt = u.fmt;
  var d = NEXO.dominio;

  /** Cabecera de página: título, explicación y acciones. */
  function cabecera(o) {
    return '<header class="page-head"><div class="page-head__txt">' +
      (o.kicker ? '<div class="page-head__kicker">' + ico(o.icono || 'info', 14) + esc(o.kicker) + '</div>' : '') +
      '<h1>' + esc(o.titulo) + '</h1>' +
      (o.texto ? '<p>' + o.texto + '</p>' : '') +
      '</div>' + (o.acciones ? '<div class="toolbar">' + o.acciones + '</div>' : '') + '</header>';
  }

  /** Ayuda contextual: explicación en lenguaje llano y la meta asociada. */
  function tip(texto, meta, izquierda) {
    return '<span class="tip' + (izquierda ? ' tip--left' : '') + '" tabindex="0" aria-label="Ayuda">' + ico('circle-help', 15) +
      '<span class="tip__box" role="tooltip">' + texto + (meta ? '<em>' + esc(meta) + '</em>' : '') + '</span></span>';
  }

  function badge(texto, tono, extra) {
    return '<span class="badge badge--' + (tono || 'mute') + ' ' + (extra || '') + '">' + esc(texto) + '</span>';
  }

  function estadoPunto(estado) {
    var x = d.ESTADO_PUNTO[estado] || d.ESTADO_PUNTO['sin-abrir'];
    return badge(x.texto, x.tono);
  }

  function decision(dec, sm) {
    var x = d.DECISION[dec];
    return '<span class="badge badge--' + x.tono + (sm ? ' badge--sm' : '') + ' badge--plain">' + ico(x.icono, 13) + esc(x.texto) + '</span>';
  }

  var ROLES = [d.Rol.SUPERVISOR, d.Rol.LIDER_TECNICO, d.Rol.LOGISTICA, d.Rol.CIERRE, d.Rol.FINANZAS];

  /** Paleta fija de zonas (el contrato no define un catálogo ni colores por zona). */
  var PALETA_ZONA = ['z1', 'z2', 'z3', 'z4', 'z5'];
  function colorZona(nombre, todas) {
    var i = (todas || []).indexOf(nombre);
    return PALETA_ZONA[(i < 0 ? 0 : i) % PALETA_ZONA.length];
  }

  /** Avatar de un rol del servicio (nunca de un asistente). */
  function avatar(autor, grande) {
    var limpio = String(autor || '').replace(' (simulado)', '');
    var i = ROLES.indexOf(limpio);
    var sys = limpio === 'NEXO' || limpio === 'Sistema';
    var cls = 'avatar' + (grande ? ' avatar--lg' : '') + (sys ? ' avatar--sys' : ' avatar--r' + (i < 0 ? 0 : i));
    var txt = sys ? 'NX' : u.iniciales(limpio);
    return '<span class="' + cls + '" title="' + esc(autor) + '">' + esc(txt) + '</span>';
  }

  // ---------- incidentes ----------

  var TIPO = {};
  TIPO[d.TipoIncidente.SIN_COMUNICACION] = { corto: 'Conexión', tag: 'warn', icono: 'wifi-off' };
  TIPO[d.TipoIncidente.LECTOR_AVERIADO] = { corto: 'Lector', tag: 'no', icono: 'smartphone' };
  TIPO[d.TipoIncidente.COORDINADOR] = { corto: 'Coordinador', tag: 'no', icono: 'server' };
  TIPO[d.TipoIncidente.ENLACE_NUBE] = { corto: 'Nube', tag: 'info', icono: 'cloud-off' };
  TIPO[d.TipoIncidente.PERMISOS] = { corto: 'Permisos', tag: 'gold', icono: 'key-round' };
  TIPO[d.TipoIncidente.LATENCIA] = { corto: 'Latencia', tag: 'violet', icono: 'gauge' };
  TIPO[d.TipoIncidente.FALSA_ALARMA] = { corto: 'Falsa alarma', tag: 'mute', icono: 'eye-off' };

  function tipoInc(inc) { return TIPO[inc.tipo] || TIPO[d.TipoIncidente.LATENCIA]; }

  var ESTADO_INC = {
    'nuevo':      { texto: 'Nuevo',        tono: 'no' },
    'en-curso':   { texto: 'En curso',     tono: 'info' },
    'resuelto':   { texto: 'Resuelto',     tono: 'ok' },
    'descartado': { texto: 'Falsa alarma', tono: 'mute' }
  };

  function estadoInc(inc) {
    var x = ESTADO_INC[inc.estado];
    return badge(x.texto, x.tono, inc.estado === 'nuevo' ? 'badge--live' : '');
  }

  function abierto(inc) { return inc.estado === 'nuevo' || inc.estado === 'en-curso'; }

  /**
   * Medidor de actuación (KR1.3): de la recepción a la primera acción,
   * meta de 5 minutos.
   */
  function slaActuacion(inc, ahoraS) {
    var meta = d.Umbral.ACTUACION_S;
    var fin = inc.actuadaEnS !== null ? inc.actuadaEnS : ahoraS;
    var dur = fin - inc.recibidaEnS;
    var hecho = inc.actuadaEnS !== null;
    var tono = hecho ? (dur < meta ? 'ok' : 'no') : (dur >= meta ? 'no' : dur >= meta * 0.7 ? 'warn' : 'info');
    var pct = hecho ? 100 : u.limitar(dur / meta * 100, 2, 100);
    var icono = hecho ? (dur < meta ? ico('circle-check', 12, 'ok-t') : ico('circle-x', 12, 'no-t')) : ico('timer', 12);
    var txt = hecho ? fmt.corto(dur) : (dur >= meta ? 'vencida' : 'quedan ' + fmt.corto(meta - dur));
    return { html: sla('Actuación', txt, icono, pct, tono), tono: tono, restante: meta - dur, hecho: hecho };
  }

  /** Medidor de recuperación (KR2.1 / KR2.2) o de resolución. */
  function slaRecuperacion(inc, ahoraS) {
    var meta = inc.metaRecuperacionS;
    var fin = inc.recuperadaEnS !== null ? inc.recuperadaEnS : (inc.resueltaEnS !== null ? inc.resueltaEnS : ahoraS);
    var dur = fin - inc.recibidaEnS;
    var hecho = inc.recuperadaEnS !== null || inc.resueltaEnS !== null;
    if (!meta) {
      var t = fmt.corto(dur);
      return sla(hecho ? 'Resuelto en' : 'Abierto hace', t, hecho ? ico('circle-check', 12, 'ok-t') : ico('hourglass', 12), hecho ? 100 : 35, hecho ? 'ok' : 'mute');
    }
    var lbl = inc.tipo === d.TipoIncidente.LECTOR_AVERIADO ? 'Recuperación' : 'Sincronía';
    if (inc.relojDesdeS === null || inc.relojDesdeS === undefined) {
      // KR2.1: el plazo de 5 min empieza cuando vuelve la comunicación.
      return sla(lbl, hecho ? '—' : 'espera red', ico('hourglass', 12), 0, 'mute');
    }
    dur = fin - inc.relojDesdeS;
    var tono = hecho ? (dur <= meta ? 'ok' : 'no') : (dur > meta ? 'no' : 'warn');
    var pct = hecho ? 100 : u.limitar(dur / meta * 100, 2, 100);
    var icono = hecho ? (dur <= meta ? ico('circle-check', 12, 'ok-t') : ico('circle-x', 12, 'no-t')) : ico('hourglass', 12);
    return sla(lbl, hecho ? fmt.corto(dur) : 'quedan ' + fmt.corto(Math.max(0, meta - dur)), icono, pct, tono);
  }

  function sla(lbl, valor, icono, pct, tono) {
    return '<div class="sla"><div class="sla__lbl">' + icono + '<span>' + esc(lbl) + '</span><b>' + esc(valor) + '</b></div>' +
      '<div class="bar bar--' + tono + '"><span style="width:' + pct.toFixed(1) + '%"></span></div></div>';
  }

  // ---------- gráficos ----------

  function sparkline(valores, alto) {
    alto = alto || 40;
    if (!valores.length) valores = [0];
    var w = 200, max = Math.max.apply(null, valores.concat([1]));
    var paso = valores.length > 1 ? w / (valores.length - 1) : w;
    var pts = valores.map(function (v, i) { return [i * paso, alto - 3 - (v / max) * (alto - 8)]; });
    var linea = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var area = linea + ' L' + w + ' ' + alto + ' L0 ' + alto + ' Z';
    return '<svg class="spark" viewBox="0 0 ' + w + ' ' + alto + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<path class="a" d="' + area + '"/><path class="l" d="' + linea + '"/></svg>';
  }

  function anillo(pct, tam, color) {
    tam = tam || 64;
    var r = (tam - 8) / 2, c = 2 * Math.PI * r;
    var off = c * (1 - u.limitar(pct, 0, 100) / 100);
    return '<svg class="ring" width="' + tam + '" height="' + tam + '" viewBox="0 0 ' + tam + ' ' + tam + '" aria-hidden="true">' +
      '<circle class="ring__bg" cx="' + tam / 2 + '" cy="' + tam / 2 + '" r="' + r + '"/>' +
      '<circle class="ring__fg" cx="' + tam / 2 + '" cy="' + tam / 2 + '" r="' + r + '" stroke-dasharray="' + c.toFixed(2) +
      '" stroke-dashoffset="' + off.toFixed(2) + '"' + (color ? ' style="stroke:' + color + '"' : '') + '/></svg>';
  }

  function barra(pct, tono) {
    return '<div class="bar' + (tono ? ' bar--' + tono : '') + '"><span style="width:' + u.limitar(pct, 0, 100).toFixed(1) + '%"></span></div>';
  }

  /** Estado de cumplimiento frente a una meta. */
  function meta(cumple, evaluable) {
    if (evaluable === false) return badge('Sin datos aún', 'mute');
    return cumple ? badge('Cumple', 'ok') : badge('No cumple', 'no');
  }

  function vacio(icono, titulo, texto) {
    return '<div class="empty"><div class="empty__art">' + ico(icono, 28) + '</div><h3>' + esc(titulo) + '</h3><p>' + texto + '</p></div>';
  }

  /** Delegación de eventos: data-accion="nombre" y data-arg. */
  function delegar(raiz, acciones) {
    raiz.addEventListener('click', function (ev) {
      var n = ev.target.closest('[data-accion]');
      if (!n || !raiz.contains(n)) return;
      var f = acciones[n.getAttribute('data-accion')];
      if (f) { ev.preventDefault(); f(n.getAttribute('data-arg'), n, ev); }
    });
  }

  return {
    cabecera: cabecera, tip: tip, badge: badge, estadoPunto: estadoPunto, decision: decision,
    avatar: avatar, ROLES: ROLES, colorZona: colorZona, tipoInc: tipoInc, estadoInc: estadoInc, abierto: abierto,
    slaActuacion: slaActuacion, slaRecuperacion: slaRecuperacion,
    sparkline: sparkline, anillo: anillo, barra: barra, meta: meta, vacio: vacio, delegar: delegar
  };
})();

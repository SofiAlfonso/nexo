/* ============================================================
   vistas/lector.js — Lector en puerta

   Recorte honesto (T31, ola 2): el panel no simula ni ejecuta escaneos.
   Muestra el tráfico real de esta puerta (mismo `recientes` que `#/puertas`,
   proyectado desde D2). Los escaneos reales se hacen con el lector emulado
   C1 (`npm run dev:reader`), autenticado por mTLS ante C2 (ADR-008, PR #10):
   el panel web no tiene ni puede tener esa identidad de lector físico.
   ============================================================ */

NEXO.vistas.lector = (function () {
  'use strict';

  var u = NEXO.util, esc = u.esc, ico = u.icono, fmt = u.fmt;
  var d = NEXO.dominio, M = d.Motivo;
  var c;

  var PASOS = [
    { t: '¿El lector alcanzó al coordinador?', m: [M.SIN_COORDINADOR, M.PUNTO_SUSPENDIDO] },
    { t: '¿El código pertenece al evento?', m: [M.CODIGO_DESCONOCIDO] },
    { t: '¿La boleta sigue vigente?', m: [M.BOLETA_ANULADA] },
    { t: '¿Autoriza la zona de esta puerta?', m: [M.ZONA_NO_AUTORIZADA] },
    { t: '¿Está dentro de la ventana de ingreso?', m: [M.FUERA_DE_HORARIO] },
    { t: '¿Es su primer uso?', m: [M.USO_CONCURRENTE, M.USO_YA_REGISTRADO, M.REINGRESO_SUSPENDIDO], alt: M.REINGRESO_AUTORIZADO },
    { t: 'Acepta y consume el ingreso en una sola transacción', m: [] }
  ];

  function montar(cont) {
    c = NEXO.vistas.comunes;
    var raiz = document.createElement('div');
    raiz.className = 'page';
    var e0 = NEXO.store.get();
    raiz.innerHTML =
      c.cabecera({
        kicker: 'En la puerta', icono: 'scan-line',
        titulo: 'Lector en puerta',
        texto: 'Tráfico real de esta puerta. NEXO decide; el lector solo comunica el resultado.',
        acciones: '<label class="nowrap dim" for="sel-punto">Puerta</label><select id="sel-punto" class="select" style="width:auto" data-campo="punto">' +
          e0.puntos.map(function (p) { return '<option value="' + p.id + '"' + (p.id === e0.lector.puntoId ? ' selected' : '') + '>' + p.id + ' · ' + esc(p.nombre) + '</option>'; }).join('') + '</select>'
      }) +
      '<div class="rgrid">' +
        '<div class="phonewrap"><div class="phone"><div class="phone__screen" data-slot="pantalla"></div></div></div>' +
        '<div class="stack" style="min-width:0">' +
          '<div data-slot="aviso"></div>' +
          '<section class="card"><div class="card__head"><h2>Cómo se genera un intento aquí</h2></div>' +
            '<div class="card__body"><p class="dim" style="font-size:13px">El panel web no escanea ni simula boletas: no tiene ni puede tener la credencial de un lector físico (mTLS, ADR-008). ' +
            'Para ver una validación real en esta pantalla, ejecuta el lector emulado C1 en esta puerta (<code>npm run dev:reader</code>) y su resultado aparecerá aquí y en <code>#/puertas</code> en segundos.</p></div></section>' +
          '<div class="grid grid--2">' +
            '<section class="card"><div class="card__head"><h2>Cómo decidió el coordinador</h2>' +
              c.tip('Las reglas se evalúan en este orden. La primera que falla decide el rechazo. Si todas pasan, el consumo y la decisión se confirman juntos antes de responder.', 'ADR-003 · reglas 2 a 5') +
              '</div><div class="card__body" data-slot="pasos"></div></section>' +
            '<section class="card"><div class="card__head"><h2>Qué quedó registrado</h2>' +
              c.tip('Evidencia inmutable del intento. Se conserva 90 días y nunca incluye datos del asistente.', 'ADR-004 · ADR-006 · KR4.2') +
              '</div><div class="card__body" data-slot="evidencia"></div></section>' +
          '</div>' +
        '</div>' +
      '</div>';
    cont.appendChild(raiz);
    var s = u.ranuras(raiz);
    var detalleCargado = {};

    raiz.addEventListener('input', function (ev) {
      if (ev.target.getAttribute('data-campo') === 'punto') NEXO.api.fijarPuntoLector(ev.target.value);
    });

    return {
      actualizar: function (e) {
        var id = e.lector.puntoId;
        var p = e.puntosPorId[id];
        if (!Array.isArray(p.recientes) && !detalleCargado[id]) {
          detalleCargado[id] = true;
          NEXO.api.cargarPuntoDetalle(id);
        }
        var recientes = p.recientes || [];
        var it = recientes[0];
        u.ranura(s.pantalla, pantalla(e, p, it, recientes));
        u.ranura(s.aviso, aviso(e, p));
        u.ranura(s.pasos, pasos(it));
        u.ranura(s.evidencia, evidencia(e, it));
      },
      desmontar: function () {}
    };
  }

  function aviso(e, p) {
    if (e.evento.estado === 'preparacion') {
      return '<div class="notice">' + ico('clock', 18) + '<div><b>El ingreso todavía no abre.</b> Cualquier boleta se rechazará por horario: es la regla, no un error.</div></div>';
    }
    if (e.evento.estado === 'cerrado') {
      return '<div class="notice">' + ico('clock', 18) + '<div><b>La ventana de ingreso ya cerró.</b> Las boletas se rechazan por horario.</div></div>';
    }
    var v = d.estadoVisible(p, e.evento, e.coordinador, e.ahoraS);
    if (v !== d.EstadoPunto.EN_LINEA) {
      return '<div class="notice notice--warn">' + ico('triangle-alert', 18) + '<div><b>' + esc(p.nombre) + ': ' + esc(d.ESTADO_PUNTO[v].texto.toLowerCase()) + '.</b> Los intentos quedan en el diario del lector y ninguno se acepta.</div></div>';
    }
    return '';
  }

  function pantalla(e, p, it, hist) {
    var v = d.estadoVisible(p, e.evento, e.coordinador, e.ahoraS);
    var enLinea = v === d.EstadoPunto.EN_LINEA || v === d.EstadoPunto.SIN_ABRIR;
    var barra = '<div class="ph-status"><b>NEXO</b><span>' + p.id + '</span><span class="spacer"></span>' +
      ico(enLinea ? 'wifi' : 'wifi-off', 14) + '<span class="mono">' + fmt.hora(e.ahoraS) + '</span></div>' +
      '<div class="ph-gate"><b>' + esc(p.nombre) + '</b><small>Lector ' + esc((p.lectores && p.lectores[0] && p.lectores[0].id) || (p.lectorActual && p.lectorActual.id) || '—') + ' · zona ' + esc(p.zonas.join(' + ')) + '</small></div>';

    var cuerpo;
    if (!it) {
      cuerpo = '<div class="ph-idle">' + ico('scan-line', 56) + '<b>Sin intentos recientes</b><small>Esperando la próxima lectura del lector físico en esta puerta</small></div>';
    } else {
      var x = d.DECISION[it.decision];
      var palabra = { aceptado: 'ACEPTADO', rechazado: 'RECHAZADO', 'sin-respuesta': 'SIN RESPUESTA' }[it.decision];
      var sub = it.decision === 'aceptado'
        ? (it.admision ? 'Primer ingreso · puede pasar' : 'Reingreso · puede pasar')
        : it.decision === 'rechazado' ? 'No permitir el paso' : 'No permitir el paso · reintentar';
      cuerpo = '<div class="ph-result ph-result--' + x.tono + '" data-k="' + esc(it.id) + '">' +
        '<span class="ph-result__ico">' + ico(x.icono, 60) + '</span>' +
        '<b class="ph-result__word">' + palabra + '</b><span class="ph-result__sub">' + esc(sub) + '</span>' +
        '<span class="ph-result__why">' + esc(it.motivo) + '</span></div>' +
        '<dl class="ph-meta"><dt>Boleta</dt><dd class="mono">' + esc(it.ref) + '</dd>' +
        '<dt>Zona</dt><dd>' + esc(it.zona) + '</dd>' +
        '<dt>Respuesta</dt><dd class="mono">' + (it.latenciaMs !== null ? it.latenciaMs + ' ms' : 'sin respuesta') + '</dd></dl>';
    }
    var lista = hist.slice(it ? 1 : 0, it ? 5 : 4).map(function (h) {
      var x = d.DECISION[h.decision];
      return '<li><i class="dot dot--' + x.tono + '"></i><span class="mono">' + fmt.hora(h.t, true) + '</span><span>' + esc(x.texto) + '</span></li>';
    }).join('');
    return barra + '<div class="ph-body">' + cuerpo + '</div>' +
      (lista ? '<div class="ph-hist"><small>Lecturas anteriores</small><ul>' + lista + '</ul></div>' : '') +
      '<div class="ph-foot">' + ico('lock', 12) + 'Sin datos personales del asistente</div>';
  }

  function pasos(it) {
    if (!it) return '<p class="dim">Aún no hay un intento reciente en esta puerta.</p>';
    var falla = -1, alt = false;
    PASOS.forEach(function (p, i) {
      if (falla === -1 && p.m.indexOf(it.motivo) !== -1) falla = i;
      if (p.alt && p.alt === it.motivo) alt = i;
    });
    return '<ol class="steps">' + PASOS.map(function (p, i) {
      var cls, marca, nota = '';
      if (falla === -1) {
        cls = 'ok'; marca = ico('check', 13);
        if (alt === i) { nota = 'Ya se usó, pero la política permite reingresar tras 10 min: no genera cobro.'; }
        if (i === PASOS.length - 1 && it.decision === 'aceptado' && !it.admision) { cls = 'ok'; nota = 'Se registra como reingreso.'; }
      } else if (i < falla) { cls = 'ok'; marca = ico('check', 13); }
      else if (i === falla) { cls = it.decision === 'sin-respuesta' ? 'warn' : 'no'; marca = ico('x', 13); nota = it.motivo + '.'; }
      else { cls = 'off'; marca = ''; }
      return '<li class="step step--' + cls + '"><span class="step__mark">' + marca + '</span><span><b>' + esc(p.t) + '</b>' + (nota ? '<small>' + esc(nota) + '</small>' : '') + '</span></li>';
    }).join('') + '</ol>';
  }

  function evidencia(e, it) {
    if (!it) return '<p class="dim">Aún no hay un registro para mostrar.</p>';
    var ev = it.evidencia;
    return '<dl class="kv">' +
      '<dt>Identificador de origen</dt><dd class="mono">' + esc(it.id) + '</dd>' +
      '<dt>Decidió</dt><dd>' + esc(ev.via) + '</dd>' +
      '<dt>Permisos · políticas</dt><dd class="mono">v' + ev.versionPermisos + ' · v' + ev.versionPoliticas + '</dd>' +
      '<dt>Antigüedad de permisos</dt><dd>' + fmt.duracion(ev.antiguedadPermisosS) + '</dd>' +
      '<dt>Propósito</dt><dd>' + esc(it.proposito === 'reingreso' ? 'Reingreso' : it.proposito === 'ingreso' ? 'Ingreso' : '—') + '</dd>' +
      '<dt>¿Genera cobro?</dt><dd>' + (it.admision ? c.badge('Sí · 1 admisión', 'ok') : c.badge('No', 'mute')) + '</dd>' +
      '<dt>Datos del asistente</dt><dd>' + c.badge('Ninguno', 'ok', 'badge--plain') + '</dd>' +
      '<dt>Se conserva</dt><dd>90 días, sin cambios</dd></dl>' +
      (it.concurrente ? '<div class="notice notice--violet" style="margin-top:12px">' + ico('split', 16) + '<div>Otra puerta presentó la misma boleta en el mismo instante. El coordinador es una sola autoridad: <b>una se aceptó y esta se rechazó</b>.</div></div>' : '') +
      (it.decision === 'sin-respuesta' ? '<div class="notice notice--warn" style="margin-top:12px">' + ico('history', 16) + '<div>El intento quedó en el diario del lector. Se sincronizará al recuperar comunicación, <b>sin aceptación</b>.</div></div>' : '');
  }

  return { id: 'lector', montar: montar };
})();

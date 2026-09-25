/* ============================================================
   vistas/ayuda.js — Bienvenida, glosario y mapa de pantallas

   La primera barrera del prototipo anterior era entenderlo. Esta
   ventana explica en lenguaje llano qué es NEXO, cómo se usa la
   demostración y qué significa cada término del dominio.
   ============================================================ */

NEXO.vistas.ayuda = (function () {
  'use strict';

  var u = NEXO.util, esc = u.esc, ico = u.icono;
  var nodo = null, pestana = 'inicio', alCerrar = null;

  var GLOSARIO = [
    ['Cliente', 'Organización que contrata y paga el servicio. Su decisor presupuestal y sus usuarios operativos son papeles distintos.'],
    ['Evento', 'Unidad de operación contratada, en un recinto y con una ventana de ingreso.'],
    ['Zona', 'Localidad o área que una boleta puede autorizar (Norte, Sur, Palcos…).'],
    ['Punto de validación', 'Puerta habilitada para recibir intentos. Puede cambiar de lector sin perder su identidad ni sus registros.'],
    ['Boleta', 'Referencia del permiso emitido por la boletería para un evento. No representa a una persona.'],
    ['Intento', 'Cada vez que alguien presenta un código en una puerta. Reenviar el mismo registro no es otro intento.'],
    ['Validación', 'La decisión de aceptar o rechazar. NEXO decide; el lector solo muestra el resultado.'],
    ['Admisión', 'La primera aceptación correcta de una boleta en el evento. Es lo que se cobra y no prueba que alguien haya cruzado.'],
    ['Coordinador local', 'Servidor del estadio al que todos los lectores preguntan. Al ser una sola autoridad, una boleta no puede entrar dos veces.'],
    ['Diario del lector', 'Registro local de los intentos que no obtuvieron respuesta. Se sincroniza después y nunca cuenta como aceptación.'],
    ['Buzón', 'Cola del coordinador hacia la nube. Si se cae el enlace, la evidencia espera ahí sin detener el ingreso.'],
    ['Conciliación', 'Cierre que reúne decisiones únicas, resuelve pendientes y diferencias y conserva la evidencia.'],
    ['Liquidación', 'Cálculo del importe del evento (USD 500 + USD 0,40 por admisión) y seguimiento de anticipo, saldo o devolución.'],
    ['Recompra', 'Un contrato nuevo del mismo cliente después del primer piloto pagado. Ejecutar un evento ya incluido no cuenta.']
  ];

  var PANTALLAS = [
    ['layout-dashboard', 'Resumen', 'Qué pasa ahora en las puertas y qué requiere atención.', 'O1 · KR1.1 · KR1.2 · CA2'],
    ['siren', 'Incidentes', 'Bandeja con responsables, plazos y decisiones pendientes.', 'O1 · O2 · KR1.3 · KR2.2'],
    ['door-open', 'Puertas', 'Estado, lector, credencial y actividad de cada punto.', 'O2 · KR2.1 · KR2.2'],
    ['scan-line', 'Lector', 'Lo que ve el operador y por qué se decidió así.', 'R1 · KR4.1 · CA3'],
    ['file-check-2', 'Cierre', 'Diferencias, conciliación y liquidación del evento.', 'O4 · O5 · KR4.3 · KR5.1 · KR5.3'],
    ['clipboard-check', 'Preparación', 'Controles y pruebas que habilitan la apertura.', 'O3 · CA1 a CA4']
  ];

  function abrir(p, cb) {
    pestana = p || 'inicio';
    alCerrar = cb || null;
    if (!nodo) {
      nodo = document.createElement('div');
      nodo.className = 'modal';
      nodo.setAttribute('role', 'dialog');
      nodo.setAttribute('aria-modal', 'true');
      nodo.setAttribute('aria-label', 'Ayuda de NEXO');
      nodo.addEventListener('click', function (ev) {
        var t = ev.target.closest('[data-h]');
        if (ev.target.classList.contains('modal__veil')) return cerrar();
        if (!t) return;
        var a = t.getAttribute('data-h');
        if (a === 'cerrar') cerrar();
        else if (a === 'tab') { pestana = t.getAttribute('data-arg'); pintar(); }
      });
      document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && nodo.parentNode) cerrar(); });
    }
    pintar();
    document.body.appendChild(nodo);
    var b = nodo.querySelector('[data-foco]');
    if (b) b.focus();
  }

  function cerrar() {
    if (!nodo || !nodo.parentNode) return;
    var chk = nodo.querySelector('#no-mostrar');
    if (chk) u.prefs.guardar('bienvenidaVista', chk.checked);
    nodo.parentNode.removeChild(nodo);
    if (alCerrar) { var f = alCerrar; alCerrar = null; f(); }
  }

  function pintar() {
    var tabs = [['inicio', 'Bienvenida'], ['glosario', 'Glosario'], ['pantallas', 'Pantallas y metas']];
    nodo.innerHTML = '<div class="modal__veil"></div><div class="modal__box help">' +
      '<button type="button" class="iconbtn modal__close" data-h="cerrar" aria-label="Cerrar">' + ico('x', 18) + '</button>' +
      '<div class="help__hero"><div class="help__logo">NE<span>X</span>O</div>' +
      '<p>Control de acceso para estadios. <b>Una boleta. Una decisión. Un cierre verificable.</b></p>' +
      '<div class="seg help__tabs">' + tabs.map(function (t) {
        return '<button type="button" data-h="tab" data-arg="' + t[0] + '" aria-pressed="' + (pestana === t[0]) + '">' + t[1] + '</button>';
      }).join('') + '</div></div>' +
      '<div class="help__body">' + cuerpo() + '</div></div>';
  }

  function cuerpo() {
    if (pestana === 'glosario') {
      return '<p class="soft" style="margin-bottom:12px">Estos términos significan lo mismo en el negocio, en la interfaz y en el código.</p>' +
        '<dl class="gloss">' + GLOSARIO.map(function (g) { return '<dt>' + esc(g[0]) + '</dt><dd>' + esc(g[1]) + '</dd>'; }).join('') + '</dl>';
    }
    if (pestana === 'pantallas') {
      return '<div class="maplist">' + PANTALLAS.map(function (p) {
        return '<div class="mapi"><span class="bubble bubble--info">' + ico(p[0], 18) + '</span><div><b>' + esc(p[1]) + '</b><small>' + esc(p[2]) + '</small></div><span class="idchip">' + esc(p[3]) + '</span></div>';
      }).join('') + '</div><p class="dim" style="font-size:12px;margin-top:12px">KR5.2 (recompra) no tiene pantalla operativa: su evidencia son las fechas y el origen de un contrato nuevo.</p>';
    }
    var vista = u.prefs.leer('bienvenidaVista', false);
    return '<div class="help__three">' +
      paso('plug', 'Integrar', 'Recibe los permisos y anulaciones de la boletería.') +
      paso('scan-line', 'Validar', 'Decide cada intento en la puerta por zona, horario y uso.') +
      paso('file-check-2', 'Conciliar', 'Cierra el evento con evidencia y calcula lo que se cobra.') + '</div>' +
      '<h3 class="help__h">Cómo usar esta demostración</h3><ol class="howto">' +
      '<li><b>La simulación avanza sola.</b> Un evento de 15.000 admisiones corre 30 veces más rápido. Los controles están abajo a la derecha.</li>' +
      '<li><b>Cuando algo falla, aparece un incidente.</b> Una puerta sin red, un lector averiado, un corte de internet o una falla del coordinador. Algunos te piden una decisión y la demo se frena para que puedas tomarla.</li>' +
      '<li><b>Prueba el lector.</b> Presenta una boleta válida, repetida, anulada o de otra zona y mira qué regla decide.</li>' +
      '<li><b>Cierra el evento.</b> Resuelve las diferencias, concilia y mira la liquidación.</li></ol>' +
      '<div class="notice" style="margin-top:14px">' + ico('info', 18) + '<div>Las cifras son de ejemplo y el cliente es ficticio. El prototipo no demuestra viabilidad: hace visible qué habría que medir.</div></div>' +
      '<div class="help__foot"><label class="row dim" style="font-size:13px"><input type="checkbox" id="no-mostrar"' + (vista ? ' checked' : '') + '> No volver a mostrar al abrir</label>' +
      '<span class="spacer"></span><button type="button" class="btn" data-h="tab" data-arg="glosario">Ver el glosario</button>' +
      '<button type="button" class="btn btn--primary" data-h="cerrar" data-foco>' + ico('play', 16) + 'Empezar</button></div>';
  }

  function paso(icono, t, x) {
    return '<div class="help__card"><span class="bubble bubble--info">' + ico(icono, 20) + '</span><b>' + esc(t) + '</b><small>' + esc(x) + '</small></div>';
  }

  return { abrir: abrir, cerrar: cerrar };
})();

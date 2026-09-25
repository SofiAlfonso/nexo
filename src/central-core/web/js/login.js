/* ============================================================
   login.js — pantalla de acceso (ADR-016)

   Usuario y contraseña; el rol viene de la sesión que devuelve
   `POST /api/auth/login`, nunca de un selector en el cliente.
   ============================================================ */

NEXO.login = (function () {
  'use strict';

  var u = NEXO.util, esc = u.esc, ico = u.icono;
  var raiz = null;

  function construir(onExito) {
    raiz = document.createElement('div');
    raiz.className = 'modal';
    raiz.innerHTML =
      '<div class="modal__veil"></div>' +
      '<div class="modal__box login-box card">' +
        '<div class="login-box__marca">NE<span>X</span>O</div>' +
        '<p class="dim">Control de acceso del recinto</p>' +
        '<form novalidate>' +
          '<div class="field"><span class="field__lbl">Usuario</span>' +
            '<input class="input" type="text" name="usuario" autocomplete="username" required autofocus></div>' +
          '<div class="field"><span class="field__lbl">Contraseña</span>' +
            '<input class="input" type="password" name="contrasena" autocomplete="current-password" required></div>' +
          '<div class="notice notice--no" data-ref="error" hidden></div>' +
          '<button type="submit" class="btn btn--primary btn--block btn--lg" data-ref="entrar">' + ico('log-in', 16) + '<span>Entrar</span></button>' +
        '</form>' +
      '</div>';
    document.body.appendChild(raiz);

    var form = raiz.querySelector('form');
    var error = raiz.querySelector('[data-ref="error"]');
    var boton = raiz.querySelector('[data-ref="entrar"]');

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      error.hidden = true;
      boton.disabled = true;
      var datos = new FormData(form);
      NEXO.api.login(String(datos.get('usuario') || '').trim(), String(datos.get('contrasena') || ''))
        .then(function () { quitar(); onExito(); })
        .catch(function (err) {
          error.textContent = err.message || 'No se pudo iniciar sesión.';
          error.hidden = false;
          boton.disabled = false;
        });
    });
  }

  function quitar() {
    if (raiz && raiz.parentNode) raiz.parentNode.removeChild(raiz);
    raiz = null;
  }

  /** Intenta reanudar la sesión (`GET /api/auth/me`); si no hay, muestra el formulario. */
  function mostrar(onExito) {
    NEXO.api.me().then(onExito, function () { construir(onExito); });
  }

  return { mostrar: mostrar };
})();

/*
  Inicio de sesión: mostrar/ocultar la contraseña y validar antes de enviar.

  La comprobación real de las credenciales es del servidor; esto solo evita
  que el formulario viaje con campos vacíos o un correo mal escrito.
*/
(function () {
    'use strict';

    const form = document.getElementById('formLogin');
    if (!form) return;

    // --- Mostrar / ocultar contraseña --------------------------------------

    const clave = document.getElementById('password');
    const verClave = document.getElementById('verClave');

    if (clave && verClave) {
        verClave.addEventListener('click', function () {
            const visible = clave.type === 'text';
            clave.type = visible ? 'password' : 'text';

            verClave.setAttribute('aria-pressed', String(!visible));
            verClave.setAttribute(
                'aria-label',
                visible ? 'Mostrar la contraseña' : 'Ocultar la contraseña'
            );
            verClave.querySelector('.bi').className = visible ? 'bi bi-eye-slash' : 'bi bi-eye';

            // El foco vuelve al campo para poder seguir escribiendo.
            clave.focus();
        });
    }

    // --- Validación ---------------------------------------------------------

    const REGLAS = {
        email: function (v) {
            if (!v.trim()) return 'Escribe tu correo electrónico.';
            // Comprobación deliberadamente laxa: el correo de verdad se valida
            // enviándolo, no con una expresión regular imposible.
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return 'Ese correo no parece válido.';
            return '';
        },
        password: function (v) {
            if (!v) return 'Escribe tu contraseña.';
            return '';
        },
    };

    function validar(nombre) {
        const campo = form.elements[nombre];
        if (!campo || !REGLAS[nombre]) return true;

        const mensaje = REGLAS[nombre](campo.value);
        const grupo = campo.closest('.login-campo');
        const salida = grupo.querySelector('[data-error-de="' + nombre + '"]');

        grupo.classList.toggle('con-error', Boolean(mensaje));
        campo.setAttribute('aria-invalid', mensaje ? 'true' : 'false');
        if (salida) salida.textContent = mensaje;

        return !mensaje;
    }

    Object.keys(REGLAS).forEach(function (nombre) {
        const campo = form.elements[nombre];
        if (!campo) return;

        campo.addEventListener('blur', function () {
            validar(nombre);
        });
        // Una vez marcado el error, se corrige en cuanto se arregla.
        campo.addEventListener('input', function () {
            if (campo.closest('.login-campo').classList.contains('con-error')) validar(nombre);
        });
    });

    form.addEventListener('submit', function (evento) {
        // Se validan todos para marcarlos a la vez, no de uno en uno.
        const valido = Object.keys(REGLAS).map(validar).every(Boolean);
        if (valido) return;

        evento.preventDefault();
        const primerFallo = form.querySelector('.login-campo.con-error input');
        if (primerFallo) primerFallo.focus();
    });
})();

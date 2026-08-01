/*
  "Mi cuenta": confirmación antes de cerrar la sesión en todos los
  dispositivos, y que las dos contraseñas nuevas coincidan antes de enviar.
*/
(function () {
    'use strict';

    // Al desplegar "Contraseña", se lleva a la vista con margen real: es un
    // desplazamiento que decide el propio código, no algo que dependa de que
    // el navegador adivine cuánto desplazarse al enviar el formulario.
    const colContrasena = document.getElementById('colContrasena');
    if (colContrasena) {
        colContrasena.addEventListener('shown.bs.collapse', function () {
            colContrasena.scrollIntoView({ block: 'center', behavior: 'smooth' });
            const primerCampo = colContrasena.querySelector('input');
            if (primerCampo) primerCampo.focus({ preventScroll: true });
        });
    }

    const formCerrarTodo = document.getElementById('formCerrarTodo');
    if (formCerrarTodo) {
        formCerrarTodo.addEventListener('submit', function (evento) {
            const confirmado = window.confirm(
                'Se cerrará la sesión en TODOS los dispositivos donde hayas entrado, ' +
                    'incluido este. ¿Quieres continuar?'
            );
            if (!confirmado) evento.preventDefault();
        });
    }

    // Aviso temprano si las contraseñas nuevas no coinciden, sin esperar a
    // que el servidor responda.
    const nueva = document.getElementById('nueva');
    const confirmar = document.getElementById('confirmar');
    if (nueva && confirmar) {
        const comprobar = function () {
            confirmar.setCustomValidity(
                confirmar.value && confirmar.value !== nueva.value ? 'Las contraseñas no coinciden.' : ''
            );
        };
        nueva.addEventListener('input', comprobar);
        confirmar.addEventListener('input', comprobar);
    }
})();

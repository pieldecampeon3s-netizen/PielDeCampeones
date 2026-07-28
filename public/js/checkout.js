/*
  Envío del pedido por WhatsApp.

  Sustituye al script que iba dentro de la vista, que estaba roto: buscaba
  `input[name="Nombre"]` con mayúscula cuando el campo se llama `nombre`, así
  que lanzaba un TypeError y el botón no hacía absolutamente nada.

  Ahora los datos del pedido no se leen del HTML del resumen, sino de un JSON
  que escribe el servidor: así el mensaje no depende de cómo esté maquetada la
  página y no se rompe al cambiarla.
*/
(function () {
    'use strict';

    const form = document.getElementById('formPedido');
    if (!form) return;

    const datosPedido = document.getElementById('datosPedido');
    if (!datosPedido) return;

    const pedido = JSON.parse(datosPedido.textContent);

    const boton = form.querySelector('.btn-whatsapp');

    // --- Validación ---------------------------------------------------------

    const REGLAS = {
        nombre: (v) => (v.trim().length >= 3 ? '' : 'Escribe tu nombre completo.'),
        telefono: (v) => {
            const digitos = v.replace(/\D/g, '');
            if (!digitos) return 'Necesitamos un teléfono para contactarte.';
            // En Colombia los móviles son 10 dígitos; se admite el +57 delante.
            if (digitos.length < 10) return 'El teléfono debe tener al menos 10 dígitos.';
            return '';
        },
        ciudad: (v) => (v.trim().length >= 3 ? '' : 'Indica la ciudad de entrega.'),
        direccion: (v) => (v.trim().length >= 5 ? '' : 'Escribe la dirección completa.'),
    };

    function validarCampo(nombre) {
        const input = form.elements[nombre];
        if (!input || !REGLAS[nombre]) return true;

        const mensaje = REGLAS[nombre](input.value);
        const grupo = input.closest('.campo');
        const salida = grupo.querySelector('[data-error-de="' + nombre + '"]');

        grupo.classList.toggle('con-error', Boolean(mensaje));
        input.setAttribute('aria-invalid', mensaje ? 'true' : 'false');
        if (salida) salida.textContent = mensaje;

        return !mensaje;
    }

    // Revalida al salir del campo, y en cuanto se corrige un campo ya marcado.
    Object.keys(REGLAS).forEach((nombre) => {
        const input = form.elements[nombre];
        if (!input) return;

        input.addEventListener('blur', () => validarCampo(nombre));
        input.addEventListener('input', () => {
            if (input.closest('.campo').classList.contains('con-error')) validarCampo(nombre);
        });
    });

    // --- Mensaje ------------------------------------------------------------

    function construirMensaje(datos) {
        const lineas = [];

        lineas.push('*NUEVO PEDIDO — Piel de Campeón*');
        lineas.push('');
        lineas.push('*Datos de contacto*');
        lineas.push(`Nombre: ${datos.nombre}`);
        lineas.push(`Teléfono: ${datos.telefono}`);
        lineas.push(`Ciudad: ${datos.ciudad}`);
        lineas.push(`Dirección: ${datos.direccion}`);
        if (datos.referencia) lineas.push(`Referencia: ${datos.referencia}`);
        lineas.push('');
        lineas.push('*Pedido*');

        pedido.items.forEach((item) => {
            const talla = item.talla ? ` — talla ${item.talla}` : '';
            lineas.push(`• ${item.cantidad}x ${item.nombre}${talla} — ${item.subtotal}`);
        });

        lineas.push('');
        lineas.push(`*Total: ${pedido.total}*`);
        lineas.push('Envío: a coordinar');
        lineas.push('');
        lineas.push('Quedo atento para coordinar el pago y el envío. ¡Gracias!');

        return lineas.join('\n');
    }

    // --- Envío --------------------------------------------------------------

    form.addEventListener('submit', function (evento) {
        evento.preventDefault();

        // Se validan todos para marcarlos a la vez, no de uno en uno.
        const nombres = Object.keys(REGLAS);
        const valido = nombres.map(validarCampo).every(Boolean);

        if (!valido) {
            const primerFallo = form.querySelector('.campo.con-error input');
            if (primerFallo) {
                primerFallo.scrollIntoView({ block: 'center', behavior: 'smooth' });
                primerFallo.focus({ preventScroll: true });
            }
            return;
        }

        const datos = {
            nombre: form.elements.nombre.value.trim(),
            telefono: form.elements.telefono.value.trim(),
            ciudad: form.elements.ciudad.value.trim(),
            direccion: form.elements.direccion.value.trim(),
            referencia: form.elements.referencia.value.trim(),
        };

        const url = 'https://wa.me/' + pedido.whatsapp + '?text=' + encodeURIComponent(construirMensaje(datos));

        if (boton) {
            boton.disabled = true;
            boton.innerHTML = '<i class="bi bi-whatsapp"></i> Abriendo WhatsApp…';
        }

        // Algunos navegadores móviles bloquean window.open si no lo ven como
        // consecuencia directa del toque: navegar en la misma pestaña es más
        // fiable, y WhatsApp abre igual su aplicación.
        window.location.href = url;

        // Si a los 3 segundos seguimos aquí, WhatsApp no se abrió.
        setTimeout(function () {
            if (!boton) return;
            boton.disabled = false;
            boton.innerHTML = '<i class="bi bi-whatsapp"></i> Enviar pedido por WhatsApp';
        }, 3000);
    });
})();

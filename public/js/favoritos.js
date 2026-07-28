/*
  Corazón de favoritos.

  Vive aparte de catalogo.js a propósito: aquel sale antes de tiempo si no
  encuentra el panel de filtros, así que el corazón dejaba de funcionar en la
  página /favoritos. Al ser un archivo propio y global, funciona en cualquier
  sitio donde se pinte una tarjeta de producto.
*/
(function () {
    'use strict';

    // Delegación: las tarjetas se recrean al filtrar sin recargar.
    document.addEventListener('click', async function (evento) {
        const boton = evento.target.closest('[data-favorito]');
        if (!boton) return;

        const icono = boton.querySelector('.bi');
        const eraFavorito = boton.classList.contains('activo');

        // Se pinta al instante y se corrige si el servidor dice otra cosa: el
        // corazón debe responder al dedo sin esperar a la red.
        pintar(boton, icono, !eraFavorito);
        boton.classList.add('late');
        setTimeout(function () {
            boton.classList.remove('late');
        }, 180);

        try {
            const respuesta = await fetch('/favoritos/alternar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ productoId: boton.dataset.favorito }),
            });
            const datos = await respuesta.json();
            if (!datos.success) throw new Error(datos.message);

            pintar(boton, icono, datos.esFavorito);

            // En la propia página de favoritos, quitar uno lo saca de la lista
            // en el momento: dejarlo ahí con el corazón vacío confunde.
            if (!datos.esFavorito && document.body.dataset.pagina === 'favoritos') {
                const tarjeta = boton.closest('.col') || boton.closest('.product-card');
                if (tarjeta) {
                    tarjeta.style.transition = 'opacity .3s ease';
                    tarjeta.style.opacity = '0';
                    setTimeout(function () {
                        tarjeta.remove();
                        if (!document.querySelector('.product-card')) window.location.reload();
                    }, 300);
                }
            }
        } catch (error) {
            console.error('No se pudo guardar el favorito:', error);
            pintar(boton, icono, eraFavorito); // se deshace
        }
    });

    function pintar(boton, icono, activo) {
        boton.classList.toggle('activo', activo);
        boton.setAttribute('aria-pressed', String(activo));
        boton.setAttribute('aria-label', activo ? 'Quitar de favoritos' : 'Guardar en favoritos');
        if (icono) {
            icono.classList.toggle('bi-heart-fill', activo);
            icono.classList.toggle('bi-heart', !activo);
        }
    }
})();
